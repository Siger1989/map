package com.shantu.nativeapp.map

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.SystemClock
import android.util.AtomicFile
import android.util.LruCache
import earth.worldwind.render.image.ImageSource
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.delay
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.Job
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.Executors
import java.util.concurrent.CopyOnWriteArrayList
import java.lang.ref.WeakReference
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import java.util.concurrent.Future

internal data class TileHttpResponse(val statusCode: Int, val retryAfter: String?, val body: ByteArray?, val bingTileInfo: String? = null)
internal enum class TileCachePolicy { NORMAL, NO_STORE }

/** Per-attempt cancellation hook used to disconnect a live socket when its deadline/last observer ends. */
internal class TileRequestCancellation {
    private val cancelled = java.util.concurrent.atomic.AtomicBoolean(false)
    private val hook = java.util.concurrent.atomic.AtomicReference<(() -> Unit)?>(null)
    val isCancelled: Boolean get() = cancelled.get()
    fun register(onCancel: () -> Unit) {
        if (cancelled.get()) { runCatching(onCancel); return }
        hook.set(onCancel)
        if (cancelled.get()) hook.getAndSet(null)?.let { runCatching(it) }
    }
    fun clear() { hook.set(null) }
    fun cancel() {
        if (cancelled.compareAndSet(false, true)) hook.getAndSet(null)?.let { runCatching(it) }
    }
}

/** URL/key-free cumulative counters and timings for this loader instance. */
internal data class TileNetworkSnapshot(
    val memoryHits: Long,
    val diskHits: Long,
    val networkRequests: Long,
    val retries: Long,
    val successes: Long,
    val errors: Long,
    val rateLimits: Long,
    val cancellations: Long,
    val receivedBytes: Long,
    val queueWaitMs: Long,
    val networkMs: Long,
    val decodeMs: Long,
    val queuedNetworkRequests: Int,
    val activeNetworkRequests: Int,
    val pendingCacheWriteBytes: Long,
    val droppedCacheWrites: Long,
    val completedCacheWrites: Long,
    val failedCacheWrites: Long,
    val activeBackgroundRequests: Int,
)

internal fun interface TileHttpClient {
    fun execute(url: String): TileHttpResponse
    fun execute(url: String, cancellation: TileRequestCancellation): TileHttpResponse {
        if (cancellation.isCancelled) throw InterruptedException("cancelled")
        return execute(url)
    }
}

/** Build the registered Tianditu WMTS endpoint without exposing the key to logs/status text. */
internal fun tiandituTileUrl(layer: String, x: Int, y: Int, z: Int, encodedKey: String): String {
    require(layer in setOf("img", "cia", "vec", "cva", "ter", "cta"))
    return "https://t0.tianditu.gov.cn/${layer}_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0" +
        "&LAYER=$layer&STYLE=default&TILEMATRIXSET=w&TILEMATRIX=$z&TILEROW=$y&TILECOL=$x&FORMAT=tiles&tk=$encodedKey"
}

private class UrlConnectionTileHttpClient : TileHttpClient {
    override fun execute(url: String): TileHttpResponse = execute(url, TileRequestCancellation())

    override fun execute(url: String, cancellation: TileRequestCancellation): TileHttpResponse {
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = REQUEST_DEADLINE_MS
            readTimeout = REQUEST_DEADLINE_MS
            instanceFollowRedirects = false
            setRequestProperty("Accept", "image/png,image/*;q=0.9,*/*;q=0.5")
            setRequestProperty("User-Agent", "ShantuNativeMap/1")
        }
        cancellation.register { connection.disconnect() }
        return try {
            if (cancellation.isCancelled) throw InterruptedException("cancelled")
            val code = connection.responseCode
            val body = if (code in 200..299) connection.inputStream.use { input ->
                val output = ByteArrayOutputStream()
                val buffer = ByteArray(8192)
                var total = 0
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    total += count
                    if (total > MAX_TILE_BYTES) return@use null
                    output.write(buffer, 0, count)
                }
                output.toByteArray()
            } else null
            TileHttpResponse(code, connection.getHeaderField("Retry-After"), body, connection.getHeaderField("X-VE-Tile-Info"))
        } finally {
            cancellation.clear()
            connection.disconnect()
        }
    }

    private companion object {
        const val REQUEST_DEADLINE_MS = 15_000
        const val MAX_TILE_BYTES = 4 * 1024 * 1024
    }
}

/** Shared 20-slot scheduler for foreground tiles, background tiles, bulk work, refreshes and retries. */
internal class BoundedTileNetwork(
    private val directory: File,
    private val onStatus: (String) -> Unit,
    private val client: TileHttpClient = UrlConnectionTileHttpClient(),
    private val isValidImage: (ByteArray) -> Boolean = { bytes ->
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.also(Bitmap::recycle) != null
    },
    private val persistentCache: NativePersistentBrowseCache? = null,
    private val elapsedRealtimeMillis: () -> Long = SystemClock::elapsedRealtime,
    private val waitForCooldownMillis: suspend (Long) -> Unit = { delay(it) },
    @Suppress("UNUSED_PARAMETER") private val sleepBeforeRetry: (Long) -> Unit = { Thread.sleep(it) },
) {
    private data class MemoryTile(val bytes: ByteArray, val savedAtMillis: Long)
    private data class CacheWrite(val url: String, val cacheIdentity: String?, val bytes: ByteArray, val generationToken: Long, val epoch: Long)
    private data class RefreshEntry(val url: String, val identity: TileRequestIdentity?, val viewId: String?, val generation: Long?)
    private class SharedTileRequest {
        val result = CompletableFuture<ByteArray?>()
        private var observers = 0
        private var cancellationRequested = false
        @Volatile var job: Job? = null

        @Synchronized fun addObserver(): Boolean {
            if (cancellationRequested || result.isDone) return false
            observers++
            return true
        }

        @Synchronized fun removeObserverAndShouldCancel(): Boolean {
            observers = (observers - 1).coerceAtLeast(0)
            if (observers == 0 && !result.isDone && !cancellationRequested) {
                cancellationRequested = true
                return true
            }
            return false
        }

        @Synchronized fun installJob(candidate: Job): Boolean {
            if (cancellationRequested || observers == 0 || result.isDone) {
                candidate.cancel()
                return false
            }
            job = candidate
            return true
        }
    }

    private val bulkHostLock=Any()
    private val bulkHostSemaphores=linkedMapOf<String,Semaphore>()
    private val overflowBulkHostSemaphore=Semaphore(MAX_CUSTOM_BULK_PER_HOST)
    // A single global gate owns every image request. Server Retry-After is the only rate-limit backoff.
    private val queuedNetworkRequests = AtomicInteger()
    private val memory = object : LruCache<String, MemoryTile>(MEMORY_CACHE_BYTES) {
        override fun sizeOf(key: String, value: MemoryTile) = value.bytes.size
    }
    private val inFlight = ConcurrentHashMap<String, SharedTileRequest>()
    private val uniqueInFlightCount = AtomicInteger()
    private val inFlightLock = Any()
    private val hostCooldownUntilElapsed = ConcurrentHashMap<String, Long>()
    private val missingTiles = ConcurrentHashMap<String, Long>()
    private val retryAttemptsByGeneration = ConcurrentHashMap<String, AtomicInteger>()
    private val memoryHits = AtomicLong()
    private val diskHits = AtomicLong()
    private val networkRequests = AtomicLong()
    private val retries = AtomicLong()
    private val successes = AtomicLong()
    private val errors = AtomicLong()
    private val rateLimits = AtomicLong()
    private val cancellations = AtomicLong()
    private val receivedBytes = AtomicLong()
    private val queueWaitNanos = AtomicLong()
    private val networkMs = AtomicLong()
    private val decodeMs = AtomicLong()
    private val refreshScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val requestScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val cacheWriteScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val cacheWriteQueue = Channel<CacheWrite>(MAX_PENDING_CACHE_WRITES)
    private val pendingCacheWriteBytes = AtomicLong()
    private val droppedCacheWrites = AtomicLong()
    private val completedCacheWrites = AtomicLong()
    private val failedCacheWrites = AtomicLong()
    private val cacheWriteEpoch = AtomicLong()
    private val networkExecutor = Executors.newFixedThreadPool(MAX_ACTIVE_REQUESTS) { runnable ->
        Thread(runnable, "shantu-tile-http").apply { isDaemon = true }
    }
    private val refreshLock = Any()
    private val refreshQueue = ArrayDeque<String>()
    private val refreshQueued = mutableSetOf<String>()
    private val refreshCooldown = mutableMapOf<String, Long>()
    private val refreshEntries = mutableMapOf<String, RefreshEntry>()
    private val refreshFactories = mutableMapOf<String, MutableList<WeakReference<ImageSource.NetworkBoundImageFactory>>>()
    private val refreshObservers = CopyOnWriteArrayList<(ImageSource.NetworkBoundImageFactory) -> Unit>()
    private val viewDemands = ConcurrentHashMap<String, TileViewDemand>()
    private val closedViewLock = Any()
    private val closedViewTombstones = LinkedHashMap<String, Unit>()
    private val queuePolicy = TileRequestQueuePolicy()
    private val requestSequence = AtomicLong()
    private val permitScheduler = TileRequestPermitScheduler(
        capacity = MAX_ACTIVE_REQUESTS,
        maxQueued = MAX_QUEUED_NETWORK_REQUESTS,
        demands = { viewDemands.toMap() },
        policy = queuePolicy,
        removedViewIds = ::closedViewIdsSnapshot,
    )
    private var refreshWorker = false
    private val diskCacheLock = Any()
    private val lifecycleLock=Any()
    @Volatile private var lastStatusAt = 0L
    @Volatile private var closed = false
    @Volatile var cacheOnly = false
        set(value) {
            synchronized(lifecycleLock) { field=value }
            if (value) cacheWriteEpoch.incrementAndGet()
            if (value) synchronized(refreshLock) { refreshQueue.clear(); refreshQueued.clear(); refreshEntries.clear(); refreshFactories.clear() }
        }
    @Volatile internal var archive: NativeTileArchive? = null
    @Volatile internal var legacyReader: ((String)->ByteArray?)? = null

    init {
        cacheWriteScope.launch {
            for (item in cacheWriteQueue) {
                try {
                    if (!closed && !cacheOnly && item.epoch == cacheWriteEpoch.get()) {
                        val ok = runCatching {
                            persistentCache?.write(item.url, item.bytes, generationToken = item.generationToken, cacheIdentity = item.cacheIdentity)
                        }.getOrNull() == true
                        if (ok) completedCacheWrites.incrementAndGet() else failedCacheWrites.incrementAndGet()
                    }
                } finally {
                    pendingCacheWriteBytes.addAndGet(-item.bytes.size.toLong())
                }
            }
        }
    }

    fun observeRefresh(listener: (ImageSource.NetworkBoundImageFactory) -> Unit): AutoCloseable {
        refreshObservers += listener
        return AutoCloseable { refreshObservers.remove(listener) }
    }

    fun updateViewDemand(snapshot: TileViewDemand) {
        if (closed) return
        synchronized(closedViewLock) { closedViewTombstones.remove(snapshot.viewId) }
        viewDemands[snapshot.viewId] = snapshot.copy(
            ranks = snapshot.ranks.toMap(),
            inactiveIdentities = snapshot.inactiveIdentities.toSet(),
        )
        permitScheduler.onDemandChanged()
    }

    fun removeViewDemand(viewId: String) {
        viewDemands.remove(viewId)
        synchronized(closedViewLock) {
            closedViewTombstones[viewId] = Unit
            while (closedViewTombstones.size > MAX_CLOSED_VIEW_TOMBSTONES) {
                closedViewTombstones.remove(closedViewTombstones.keys.first())
            }
        }
        permitScheduler.onDemandChanged()
    }

    /** Explicit user retry resets the finite per-tile/per-generation attempt budget; host 429 cooldown stays in force. */
    fun retryTile(url: String, identity: TileRequestIdentity? = null, generation: Long? = null) {
        synchronized(retryAttemptsByGeneration) { retryAttemptsByGeneration.remove(retryBudgetKey(url, identity, generation)) }
    }

    suspend fun readCached(
        url: String,
        renderedFactory: ImageSource.NetworkBoundImageFactory? = null,
        identity: TileRequestIdentity? = null,
        viewId: String? = null,
        generation: Long? = null,
    ): ByteArray? = withContext(Dispatchers.IO) {
        if (closed) return@withContext null
        @Suppress("UNUSED_VARIABLE") val demandOwner = viewId to generation
        val logicalKey = identity?.cacheKey
        if (NativeOfflineDisplayPolicy.snapshot().enabled) {
            val selected = NativeOfflineDisplayPolicy.readSelectedCache(url)?.takeIf { acceptCachedTile(url, it, identity) }
            if (selected == null) errors.incrementAndGet() else successes.incrementAndGet()
            return@withContext selected
        }
        memoryEntry(url, identity)?.takeIf { isFresh(it.savedAtMillis) }?.let {
            if (acceptCachedTile(url, it.bytes, identity)) { memoryHits.incrementAndGet(); successes.incrementAndGet(); return@withContext it.bytes }
        }
        val entry = persistentCache?.read(url, allowStale = true, cacheIdentity = logicalKey)
        if (entry != null && acceptCachedTile(url, entry.bytes, identity) && isValidImageMeasured(entry.bytes)) {
            if (!entry.isFresh) enqueueRefresh(url, renderedFactory, identity, viewId, generation)
            memory.put(cacheFile(url, identity).name, MemoryTile(entry.bytes, entry.savedAtMillis))
            diskHits.incrementAndGet(); successes.incrementAndGet()
            return@withContext entry.bytes
        }
        readCachedBlocking(url, identity)?.also { successes.incrementAndGet() }
    }

    suspend fun fetch(
        url: String,
        bulkDownload: Boolean = false,
        renderedFactory: ImageSource.NetworkBoundImageFactory? = null,
        identity: TileRequestIdentity? = null,
        viewId: String? = null,
        generation: Long? = null,
        cachePolicy: TileCachePolicy = TileCachePolicy.NORMAL,
        forceNetwork: Boolean = false,
        backgroundRequest: Boolean = false,
    ): ByteArray? = withContext(Dispatchers.IO) {
        try {
            if (closed) {
                errors.incrementAndGet()
                return@withContext null
            }
            val offlinePolicy = NativeOfflineDisplayPolicy.snapshot()
            if (offlinePolicy.enabled && !bulkDownload) {
                val cached = NativeOfflineDisplayPolicy.readSelectedCache(url)?.takeIf { acceptCachedTile(url, it, identity) }
                if (cached == null) {
                    errors.incrementAndGet()
                    report("当前缓存包缺少此瓦片；离线模式不会联网补取")
                } else successes.incrementAndGet()
                return@withContext cached
            }
            if (!forceNetwork && cachePolicy == TileCachePolicy.NORMAL) memoryEntry(url, identity)?.takeIf { isFresh(it.savedAtMillis) }?.let {
                if (acceptCachedTile(url, it.bytes, identity)) { memoryHits.incrementAndGet(); successes.incrementAndGet(); return@withContext it.bytes }
            }
            if (forceNetwork) missingTiles.remove(url) else if (knownMissing(url)) return@withContext null
            if (!forceNetwork && cachePolicy == TileCachePolicy.NORMAL) persistentCache?.read(url, allowStale = true, cacheIdentity = identity?.cacheKey)?.let { entry ->
                if ((entry.isFresh || !bulkDownload) && acceptCachedTile(url, entry.bytes, identity) && isValidImageMeasured(entry.bytes)) {
                    diskHits.incrementAndGet()
                    memory.put(cacheFile(url, identity).name, MemoryTile(entry.bytes, entry.savedAtMillis))
                    if (!entry.isFresh) enqueueRefresh(url, renderedFactory, identity, viewId, generation)
                    successes.incrementAndGet()
                    return@withContext entry.bytes
                }
            }
            if (!forceNetwork && cachePolicy == TileCachePolicy.NORMAL) readCachedBlocking(url, identity)?.let { successes.incrementAndGet(); return@withContext it }
            if (cacheOnly) return@withContext null

            val stableRequestKey = "${identity?.cacheKey ?: cacheFile(url).name}:mode=${cachePolicy.name}"
            val candidate = SharedTileRequest()
            var isNew = false
            val shared = synchronized(inFlightLock) {
                if (closed) return@withContext null
                inFlight[stableRequestKey] ?: run {
                    if (uniqueInFlightCount.get() >= MAX_SHARED_REQUESTS) {
                        errors.incrementAndGet()
                        return@withContext null
                    }
                    uniqueInFlightCount.incrementAndGet()
                    isNew = true
                    inFlight[stableRequestKey] = candidate
                    candidate
                }
            }
            if (!shared.addObserver()) {
                errors.incrementAndGet()
                return@withContext null
            }
            if (isNew) {
                val job = requestScope.launch(start = CoroutineStart.LAZY) {
                    val result = try { fetchSingle(url, bulkDownload, identity, viewId, generation,
                        backgroundRequest = backgroundRequest, cachePolicy = cachePolicy) }
                    catch (_: CancellationException) { null }
                    catch (_: Exception) { null }
                    shared.result.complete(result)
                    synchronized(inFlightLock) {
                        if (inFlight.remove(stableRequestKey, shared)) uniqueInFlightCount.decrementAndGet()
                    }
                }
                if (shared.installJob(job)) job.start()
            }
            val result = try { awaitExisting(shared.result) }
            finally {
                if (shared.removeObserverAndShouldCancel()) withContext(NonCancellable) { shared.job?.cancelAndJoin() }
            }
            if (result == null) errors.incrementAndGet() else successes.incrementAndGet()
            result
        } catch (cancelled: CancellationException) {
            cancellations.incrementAndGet()
            throw cancelled
        }
    }

    suspend fun fetchProbe(url: String, identity: TileRequestIdentity, viewId: String? = null, generation: Long? = null): ByteArray? =
        fetch(url, identity = identity, viewId = viewId, generation = generation, cachePolicy = TileCachePolicy.NO_STORE)

    /** Read-only, URL/key-free cumulative telemetry; safe to call from any thread. */
    fun snapshot(): TileNetworkSnapshot = TileNetworkSnapshot(
        memoryHits = memoryHits.get(),
        diskHits = diskHits.get(),
        networkRequests = networkRequests.get(),
        retries = retries.get(),
        successes = successes.get(),
        errors = errors.get(),
        rateLimits = rateLimits.get(),
        cancellations = cancellations.get(),
        receivedBytes = receivedBytes.get(),
        queueWaitMs = TimeUnit.NANOSECONDS.toMillis(queueWaitNanos.get()),
        networkMs = networkMs.get(),
        decodeMs = decodeMs.get(),
        queuedNetworkRequests = queuedNetworkRequests.get(),
        activeNetworkRequests = permitScheduler.activeCount(),
        pendingCacheWriteBytes = pendingCacheWriteBytes.get(),
        droppedCacheWrites = droppedCacheWrites.get(),
        completedCacheWrites = completedCacheWrites.get(),
        failedCacheWrites = failedCacheWrites.get(),
        activeBackgroundRequests = permitScheduler.activeBackgroundCount(),
    )

    /** Remaining server cooldown shared by every tile for the same host. */
    fun cooldownRemainingMillis(): Long {
        val now = elapsedRealtimeMillis()
        hostCooldownUntilElapsed.entries.removeIf { it.value <= now }
        return hostCooldownUntilElapsed.values.maxOrNull()?.minus(now)?.coerceAtLeast(0L) ?: 0L
    }

    fun close() {
        synchronized(lifecycleLock) {
            closed = true
            memory.evictAll()
            missingTiles.clear()
            archive = null
            legacyReader = null
        }
        permitScheduler.close()
        refreshScope.cancel()
        requestScope.cancel()
        networkExecutor.shutdownNow()
        cacheWriteEpoch.incrementAndGet()
        cacheWriteQueue.cancel()
        cacheWriteScope.cancel()
        Thread({ runCatching { persistentCache?.close() } }, "shantu-tile-cache-close").apply { isDaemon = true }.start()
        synchronized(refreshLock) { refreshQueue.clear(); refreshQueued.clear(); refreshCooldown.clear(); refreshEntries.clear(); refreshFactories.clear() }
        refreshObservers.clear()
        synchronized(inFlightLock) {
            inFlight.values.forEach { it.result.complete(null); it.job?.cancel() }
            inFlight.clear()
            uniqueInFlightCount.set(0)
        }
    }

    internal fun memorySizeBytesForTest():Int=memory.size()
    private fun enqueueRefresh(
        url: String,
        renderedFactory: ImageSource.NetworkBoundImageFactory?,
        identity: TileRequestIdentity? = null,
        viewId: String? = null,
        generation: Long? = null,
    ) {
        if (closed || cacheOnly || NativeOfflineDisplayPolicy.snapshot().enabled) return
        val key = identity?.cacheKey ?: url
        synchronized(refreshLock) {
            if (closed || (refreshCooldown[key] ?: 0L) > SystemClock.elapsedRealtime()) return
            val existing = refreshFactories[key]
            if (refreshQueued.contains(key)) {
                if (viewId != null) refreshEntries[key] = RefreshEntry(url, identity, viewId, generation)
                addRefreshFactory(existing, renderedFactory)
                return
            }
            if (refreshQueue.size >= MAX_REFRESH_QUEUE || (refreshFactories.size >= MAX_REFRESH_QUEUE && existing == null)) return
            refreshEntries[key] = RefreshEntry(url, identity, viewId, generation)
            val factories = existing ?: mutableListOf<WeakReference<ImageSource.NetworkBoundImageFactory>>().also { refreshFactories[key] = it }
            addRefreshFactory(factories, renderedFactory)
            refreshQueued += key
            refreshQueue.addLast(key)
            if (!refreshWorker) { refreshWorker = true; refreshScope.launch { drainRefreshQueue() } }
        }
    }

    private suspend fun drainRefreshQueue() {
        try {
            while (!closed) {
                val key = synchronized(refreshLock) { if (refreshQueue.isEmpty()) null else refreshQueue.removeFirst() } ?: break
                val entry = synchronized(refreshLock) { refreshEntries[key] } ?: continue
                var ok = false
                try {
                    if (!closed && !cacheOnly && !NativeOfflineDisplayPolicy.snapshot().enabled)
                        ok = fetch(entry.url, identity = entry.identity, viewId = entry.viewId, generation = entry.generation,
                            forceNetwork = true, backgroundRequest = true) != null
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (_: Exception) { ok = false }
                synchronized(refreshLock) {
                    refreshQueued.remove(key)
                    refreshEntries.remove(key)
                    if (!ok) refreshFactories.remove(key)
                    if (ok) refreshCooldown.remove(key)
                    else {
                        if (refreshCooldown.size >= MAX_REFRESH_COOLDOWN_ENTRIES) refreshCooldown.entries.removeIf { it.value <= SystemClock.elapsedRealtime() }
                        if (refreshCooldown.size >= MAX_REFRESH_COOLDOWN_ENTRIES) refreshCooldown.remove(refreshCooldown.keys.first())
                        refreshCooldown[key] = SystemClock.elapsedRealtime() + REFRESH_FAILURE_COOLDOWN_MS
                    }
                }
                if (ok) notifyRefreshed(key)
            }
        } finally {
            synchronized(refreshLock) {
                refreshWorker = false
                if (!closed && refreshQueue.isNotEmpty()) { refreshWorker = true; refreshScope.launch { drainRefreshQueue() } }
            }
        }
    }

    private fun addRefreshFactory(factories: MutableList<WeakReference<ImageSource.NetworkBoundImageFactory>>?, factory: ImageSource.NetworkBoundImageFactory?) {
        if (factories == null || factory == null) return
        factories.removeIf { it.get() == null }
        if (factories.any { it.get() === factory } || factories.size >= MAX_REFRESH_FACTORIES_PER_URL) return
        factories += WeakReference(factory)
    }

    private fun notifyRefreshed(url: String) {
        val factories = synchronized(refreshLock) {
            refreshFactories.remove(url).orEmpty().mapNotNull { it.get() }
        }
        factories.forEach { factory -> refreshObservers.forEach { listener -> runCatching { listener(factory) } } }
    }

    private suspend fun fetchSingle(
        url: String,
        bulkDownload: Boolean,
        identity: TileRequestIdentity? = null,
        viewId: String? = null,
        generation: Long? = null,
        backgroundRequest: Boolean = false,
        cachePolicy: TileCachePolicy = TileCachePolicy.NORMAL,
    ): ByteArray? {
        if (closed || cacheOnly || !NativeOfflineDisplayPolicy.permitsNetwork(bulkDownload) || Thread.currentThread().isInterrupted) return null
        val host = runCatching { URL(url).host.lowercase() }.getOrNull()
            ?: return reportAndNull("地图瓦片地址无效")
        val serverClass=serverClass(host)
        val generationToken = if (!bulkDownload && cachePolicy == TileCachePolicy.NORMAL) runCatching { persistentCache?.generationToken() }.getOrNull() else null
        if (cooldownRemainingMillis(serverClass) > 0L) {
            report("${serverLabel(serverClass)}服务器冷却中，约${ceilSeconds(cooldownRemainingMillis(serverClass))}秒后可重试")
            waitForCooldown(serverClass)
        }
        if (closed || cacheOnly || !NativeOfflineDisplayPolicy.permitsNetwork(bulkDownload)) return null
        val retryKey = retryBudgetKey(url, identity, generation)
        val retryBudget = retryBudgetFor(retryKey)
        if (retryBudget.get() >= MAX_ATTEMPTS) {
            report("此瓦片本轮重试次数已用完；可显式重试或更新视野")
            return null
        }
        var bulkHostPermit=false
        var networkPermit: TileRequestPermitScheduler.TileRequestPermit? = null
        try {
        if(bulkDownload) {
            if(serverClass!=TIANDITU_SERVER_CLASS) {
                bulkHostSemaphore(serverClass).acquire()
                bulkHostPermit=true
            }
        }
        val queueStartedAtNanos = System.nanoTime()
        val acquired = try {
            val sequence = requestSequence.incrementAndGet()
            val requestIdentity = identity ?: TileRequestIdentity("url", "url", 0, sequence.toInt(), 0, "", "")
            acquireNetworkPermit(TilePendingRequest(sequence, viewId, generation, System.nanoTime(), requestIdentity,
                background = bulkDownload || backgroundRequest,
                allowForegroundPromotion = identity != null && !bulkDownload,
                respectInactiveLayers = !bulkDownload))
        } finally {
            queueWaitNanos.addAndGet((System.nanoTime() - queueStartedAtNanos).coerceAtLeast(0L))
        }
        if (acquired == null) {
            report("地图请求队列已满或图层已关闭，当前瓦片暂缓；可点重试")
            return null
        }
        networkPermit=acquired
        try {
            // A different tile may receive 429 while this tile waits for a network slot.
            if (cooldownRemainingMillis(serverClass) > 0L) {
                val remaining = cooldownRemainingMillis(serverClass)
                report("${serverLabel(serverClass)}服务器冷却中，约${ceilSeconds(remaining)}秒后可重试")
                networkPermit?.let(permitScheduler::release)
                networkPermit = null
                waitForCooldown(serverClass)
                if (closed || cacheOnly) return null
                networkPermit = reacquireNetworkPermit(networkPermit, identity, viewId, generation, bulkDownload || backgroundRequest,
                    allowForegroundPromotion = identity != null && !bulkDownload, respectInactiveLayers = !bulkDownload)
                if (networkPermit == null) return null
            }

            val cacheFile = cacheFile(url, identity)
        while (retryBudget.get() < MAX_ATTEMPTS) {
                if (closed || cacheOnly || !NativeOfflineDisplayPolicy.permitsNetwork(bulkDownload) || Thread.currentThread().isInterrupted) return null
                if (cooldownRemainingMillis(serverClass) > 0L) {
                    networkPermit?.let(permitScheduler::release)
                    networkPermit = null
                    waitForCooldown(serverClass)
                    if (closed || cacheOnly) return null
                    networkPermit = reacquireNetworkPermit(null, identity, viewId, generation, bulkDownload || backgroundRequest,
                        allowForegroundPromotion = identity != null && !bulkDownload, respectInactiveLayers = !bulkDownload)
                    if (networkPermit == null) return null
                    continue
                }
                if (isLayerInactive(identity, viewId, bulkDownload)) return null
                val admitted=synchronized(lifecycleLock) {
                    if(closed || cacheOnly || !NativeOfflineDisplayPolicy.permitsNetwork(bulkDownload) || Thread.currentThread().isInterrupted) false
                    else true
                }
                if(!admitted)return null
                // A layer may be hidden after it acquired a permit. Do not start a new socket in that race.
                if (isLayerInactive(identity, viewId, bulkDownload)) return null
                networkRequests.incrementAndGet()
                retryBudget.incrementAndGet()
                val response = try {
                    val ioPermit = networkPermit ?: return null
                    networkPermit = null // Ownership moves to the HTTP worker and returns only when that worker exits.
                    executeNetworkRequest(url, ioPermit)
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (_: Exception) {
                    if (retryBudget.get() >= MAX_ATTEMPTS) {
                        report("地图网络请求失败，已达到本轮重试上限")
                        return null
                    }
                    retries.incrementAndGet()
                    networkPermit = reacquireNetworkPermit(networkPermit, identity, viewId, generation, bulkDownload || backgroundRequest,
                        allowForegroundPromotion = identity != null && !bulkDownload, respectInactiveLayers = !bulkDownload)
                    if (networkPermit == null) return null
                    continue
                }
                // A cache-only toggle or last-owner release may race an in-flight socket. Its
                // response must not repopulate memory/disk after that policy/lifecycle change.
                if (closed || cacheOnly || !NativeOfflineDisplayPolicy.permitsNetwork(bulkDownload) || Thread.currentThread().isInterrupted) return null
                response.body?.let { receivedBytes.addAndGet(it.size.toLong()) }
                if (response.statusCode == 429) {
                    val delay = retryAfterMillis(response.retryAfter).coerceAtLeast(MIN_429_COOLDOWN_MS)
                    setCooldown(serverClass, delay)
                    rateLimits.incrementAndGet()
                    report("${serverLabel(serverClass)}请求受限，服务器冷却${ceilSeconds(delay)}秒")
                    if (retryBudget.get() >= MAX_ATTEMPTS) return null
                    retries.incrementAndGet()
                    networkPermit = reacquireNetworkPermit(networkPermit, identity, viewId, generation, bulkDownload || backgroundRequest,
                        waitForServerCooldown = true, serverClass = serverClass,
                        allowForegroundPromotion = identity != null && !bulkDownload, respectInactiveLayers = !bulkDownload)
                    if (networkPermit == null) return null
                    continue
                }
                if (NativeMissingTileFallback.isExplicitMissing(response.statusCode, response.bingTileInfo)) {
                    rememberMissing(url)
                    return null
                }
                if (response.statusCode !in 200..299) {
                    report("天地图瓦片加载失败（HTTP ${response.statusCode}）；可点重试")
                    if (response.statusCode !in RETRYABLE_HTTP_STATUS || retryBudget.get() >= MAX_ATTEMPTS) {
                        retryBudget.set(MAX_ATTEMPTS)
                        return null
                    }
                    retries.incrementAndGet()
                    networkPermit = reacquireNetworkPermit(networkPermit, identity, viewId, generation, bulkDownload || backgroundRequest,
                        allowForegroundPromotion = identity != null && !bulkDownload, respectInactiveLayers = !bulkDownload)
                    if (networkPermit == null) return null
                    continue
                }
                val bytes = response.body
                if (bytes == null || bytes.size > MAX_TILE_BYTES) {
                    report("天地图瓦片响应为空或超过大小限制；可点重试")
                    if (retryBudget.get() >= MAX_ATTEMPTS) return null
                    retries.incrementAndGet()
                    networkPermit = reacquireNetworkPermit(networkPermit, identity, viewId, generation, bulkDownload || backgroundRequest,
                        allowForegroundPromotion = identity != null && !bulkDownload, respectInactiveLayers = !bulkDownload)
                    if (networkPermit == null) return null
                    continue
                }
                if (!acceptCachedTile(url, bytes, identity)) return null
                if (!isValidImageMeasured(bytes)) {
                    report("天地图瓦片图像无效，未写入缓存；可点重试")
                    if (retryBudget.get() >= MAX_ATTEMPTS) return null
                    retries.incrementAndGet()
                    networkPermit = reacquireNetworkPermit(networkPermit, identity, viewId, generation, bulkDownload || backgroundRequest,
                        allowForegroundPromotion = identity != null && !bulkDownload, respectInactiveLayers = !bulkDownload)
                    if (networkPermit == null) return null
                    continue
                }
                if (closed || cacheOnly || !NativeOfflineDisplayPolicy.permitsNetwork(bulkDownload) || Thread.currentThread().isInterrupted) return null
                if (cachePolicy == TileCachePolicy.NORMAL) {
                    synchronized(lifecycleLock) {
                        if(closed || cacheOnly || !NativeOfflineDisplayPolicy.permitsNetwork(bulkDownload) || Thread.currentThread().isInterrupted)return null
                        val entry = MemoryTile(bytes, System.currentTimeMillis())
                        memory.put(cacheFile.name, entry)
                    }
                }
                if (!bulkDownload && generationToken != null && cachePolicy == TileCachePolicy.NORMAL) enqueueCacheWrite(url, identity?.cacheKey, bytes, generationToken)
                synchronized(retryAttemptsByGeneration) { retryAttemptsByGeneration.remove(retryKey, retryBudget) }
                // The network loader cannot know whether WorldWind has drawn this tile.
                // Rendering/idle status belongs to the map renderer, not this HTTP layer.
                return bytes
            }
            return null
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
            report("地图请求已中断；可点重试")
            return null
        } catch (_: Exception) {
            report("地图网络请求失败，当前瓦片暂缓；可点重试")
            return null
        } finally {
            networkPermit?.let(permitScheduler::release)
        }
        } finally {
            if(bulkHostPermit) bulkHostSemaphore(serverClass).release()
        }
    }

    private fun bulkHostSemaphore(serverClass:String):Semaphore = synchronized(bulkHostLock) {
        bulkHostSemaphores[serverClass] ?: if(bulkHostSemaphores.size<MAX_TRACKED_BULK_HOSTS) {
            Semaphore(MAX_CUSTOM_BULK_PER_HOST).also { bulkHostSemaphores[serverClass]=it }
        } else overflowBulkHostSemaphore
    }

    /** Cancellable bounded gate with a finite waiter budget and close wakeup. */
    private suspend fun acquireNetworkPermit(request: TilePendingRequest): TileRequestPermitScheduler.TileRequestPermit? {
        if (closed) return null
        queuedNetworkRequests.incrementAndGet()
        return try { permitScheduler.acquire(request) }
        finally { queuedNetworkRequests.decrementAndGet() }
    }

    private fun isLayerInactive(identity: TileRequestIdentity?, viewId: String?, bulkDownload: Boolean): Boolean {
        if (bulkDownload || identity == null || viewId == null) return false
        return queuePolicy.isSuppressed(
            TilePendingRequest(0L, viewId, null, System.nanoTime(), identity),
            viewDemands.toMap(),
            closedViewIdsSnapshot(),
        )
    }

    private fun closedViewIdsSnapshot(): Set<String> = synchronized(closedViewLock) { closedViewTombstones.keys.toSet() }

    private suspend fun waitForCooldown(serverClass: String) {
        while (!closed && !cacheOnly) {
            val remaining = cooldownRemainingMillis(serverClass)
            if (remaining <= 0L) return
            waitForCooldownMillis(minOf(remaining, 60_000L))
        }
    }

    private fun retryBudgetFor(key: String): AtomicInteger = synchronized(retryAttemptsByGeneration) {
        retryAttemptsByGeneration[key]?.let { return@synchronized it }
        while (retryAttemptsByGeneration.size >= MAX_RETRY_BUDGET_ENTRIES) {
            val oldest = retryAttemptsByGeneration.keys.firstOrNull() ?: break
            retryAttemptsByGeneration.remove(oldest)
        }
        AtomicInteger().also { retryAttemptsByGeneration[key] = it }
    }

    private fun retryBudgetKey(url: String, identity: TileRequestIdentity?, generation: Long?): String =
        "${identity?.cacheKey ?: cacheFile(url).name}:g=${generation ?: 0L}"

    private fun enqueueCacheWrite(url: String, cacheIdentity: String?, bytes: ByteArray, generationToken: Long) {
        if (persistentCache == null || closed || cacheOnly || bytes.size > MAX_PENDING_CACHE_WRITE_BYTES) return
        val size = bytes.size.toLong()
        while (true) {
            val pending = pendingCacheWriteBytes.get()
            if (pending + size > MAX_PENDING_CACHE_WRITE_BYTES) {
                droppedCacheWrites.incrementAndGet()
                return
            }
            if (pendingCacheWriteBytes.compareAndSet(pending, pending + size)) break
        }
        val write = CacheWrite(url, cacheIdentity, bytes, generationToken, cacheWriteEpoch.get())
        if (cacheWriteQueue.trySend(write).isFailure) {
            pendingCacheWriteBytes.addAndGet(-size)
            droppedCacheWrites.incrementAndGet()
        }
    }

    private suspend fun reacquireNetworkPermit(
        previous: TileRequestPermitScheduler.TileRequestPermit?,
        identity: TileRequestIdentity?,
        viewId: String?,
        generation: Long?,
        background: Boolean,
        waitForServerCooldown: Boolean = false,
        serverClass: String = "",
        allowForegroundPromotion: Boolean = false,
        respectInactiveLayers: Boolean = true,
    ): TileRequestPermitScheduler.TileRequestPermit? {
        previous?.let(permitScheduler::release)
        if (waitForServerCooldown) waitForCooldown(serverClass)
        if (closed || cacheOnly) return null
        val sequence = requestSequence.incrementAndGet()
        val requestIdentity = identity ?: TileRequestIdentity("url", "url", 0, sequence.toInt(), 0, "", "")
        val queueStartedAt = System.nanoTime()
        return try {
            acquireNetworkPermit(TilePendingRequest(sequence, viewId, generation, System.nanoTime(), requestIdentity, background,
                allowForegroundPromotion, respectInactiveLayers))
        } finally {
            queueWaitNanos.addAndGet((System.nanoTime() - queueStartedAt).coerceAtLeast(0L))
        }
    }

    private suspend fun executeNetworkRequest(url: String, permit: TileRequestPermitScheduler.TileRequestPermit): TileHttpResponse {
        val cancellation = TileRequestCancellation()
        val response = CompletableFuture<TileHttpResponse>()
        val taskRef = java.util.concurrent.atomic.AtomicReference<Future<*>?>(null)
        val workerState = AtomicInteger(0) // 0 pending, 1 running, 2 cancelled before start, 3 finished.
        val permitReleased = java.util.concurrent.atomic.AtomicBoolean(false)
        fun releasePermitOnce() {
            if (permitReleased.compareAndSet(false, true)) permitScheduler.release(permit)
        }
        val task = try {
            networkExecutor.submit {
                if (!workerState.compareAndSet(0, 1)) return@submit
                val startedAt = System.nanoTime()
                try { response.complete(client.execute(url, cancellation)) }
                catch (error: Throwable) { response.completeExceptionally(error) }
                finally {
                    networkMs.addAndGet(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startedAt).coerceAtLeast(0L))
                    workerState.set(3)
                    releasePermitOnce()
                }
            }
        } catch (error: Throwable) {
            workerState.compareAndSet(0, 2)
            releasePermitOnce()
            throw error
        }
        taskRef.set(task)
        try {
            return withTimeout(REQUEST_DEADLINE_MS) { awaitCompletable(response) }
        } catch (cancelled: CancellationException) {
            cancellation.cancel()
            if (workerState.compareAndSet(0, 2)) releasePermitOnce()
            taskRef.get()?.cancel(true)
            // If the worker is already running, it owns the permit until its actual I/O exits.
            if (cancelled is TimeoutCancellationException) {
                throw java.net.SocketTimeoutException("tile request exceeded the network deadline").apply { initCause(cancelled) }
            }
            throw cancelled
        }
    }

    private suspend fun <T> awaitCompletable(future: CompletableFuture<T>): T = suspendCancellableCoroutine { continuation ->
        future.whenComplete { value, error ->
            if (!continuation.isActive) return@whenComplete
            if (error == null) continuation.resume(value)
            else continuation.resumeWithException(error.cause ?: error)
        }
    }

    private suspend fun awaitExisting(future: CompletableFuture<ByteArray?>): ByteArray? = suspendCancellableCoroutine { continuation ->
        future.whenComplete { value, error ->
            if (continuation.isActive) continuation.resume(if (error == null) value else null)
        }
    }

    private fun readCachedBlocking(url: String, identity: TileRequestIdentity? = null): ByteArray? {
        if (closed) return null
        val file = cacheFile(url, identity)
        memory.get(file.name)?.let { cached ->
            if (isFresh(cached.savedAtMillis)) { memoryHits.incrementAndGet(); return cached.bytes }
            memory.remove(file.name)
        }
        var bytes = synchronized(diskCacheLock) {
            if (!file.isFile || file.length() > MAX_TILE_BYTES) null
            else {
                val diskAge = System.currentTimeMillis() - file.lastModified()
                if (diskAge !in 0L..CACHE_TTL_MS) null
                else runCatching { AtomicFile(file).openRead().use { it.readBytes() } }.getOrNull()
                    ?.takeIf { it.size <= MAX_TILE_BYTES && acceptCachedTile(url, it, identity) && isValidImageMeasured(it) }
            }
        }
        if (bytes == null && identity != null) {
            // Read-only compatibility path for the legacy URL-hash directory. New writes use identity keys.
            val legacyFile = cacheFile(url)
            bytes = synchronized(diskCacheLock) {
                if (!legacyFile.isFile || legacyFile.length() > MAX_TILE_BYTES) null
                else {
                    val age = System.currentTimeMillis() - legacyFile.lastModified()
                    if (age !in 0L..CACHE_TTL_MS) null
                    else runCatching { AtomicFile(legacyFile).openRead().use { it.readBytes() } }.getOrNull()
                        ?.takeIf { it.size <= MAX_TILE_BYTES && acceptCachedTile(url, it, identity) && isValidImageMeasured(it) }
                }
            }
        }
        if (bytes != null) {
            diskHits.incrementAndGet()
            memory.put(file.name, MemoryTile(bytes, file.lastModified()))
            return bytes
        }
        // Keep the existing URL-based selected-package/archive reader path for persisted offline data.
        legacyReader?.invoke(url)?.takeIf { acceptCachedTile(url, it, identity) && isValidImageMeasured(it) }?.let { diskHits.incrementAndGet(); return it }
        archive?.read(url)?.takeIf { acceptCachedTile(url, it, identity) && isValidImageMeasured(it) }?.let { diskHits.incrementAndGet(); return it }
        return null
    }

    private fun memoryEntry(url: String, identity: TileRequestIdentity? = null): MemoryTile? = memory.get(cacheFile(url, identity).name)

    private fun isFresh(savedAtMillis: Long): Boolean {
        val age = System.currentTimeMillis() - savedAtMillis
        return age >= 0L && age <= CACHE_TTL_MS
    }

    private fun isValidImageMeasured(bytes: ByteArray): Boolean {
        val started = System.nanoTime()
        return try { isValidImage(bytes) }
        catch (_: Throwable) { false }
        finally { decodeMs.addAndGet(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started).coerceAtLeast(0L)) }
    }

    /** True only for a recent explicit no-coverage response or a byte-exact known placeholder. */
    internal fun isKnownMissing(url: String): Boolean = knownMissing(url)

    private fun acceptCachedTile(url: String, bytes: ByteArray, identity: TileRequestIdentity? = null): Boolean {
        if (!NativeMissingTileFallback.isKnownPlaceholder(bytes)) return true
        rememberMissing(url)
        memory.remove(cacheFile(url, identity).name)
        return false
    }

    private fun rememberMissing(url: String) {
        if (closed) return
        synchronized(missingTiles) {
            val now = elapsedRealtimeMillis()
            if ((missingTiles[url] ?: 0L) > now) return
            if (missingTiles.size >= NativeMissingTileFallback.MAX_NEGATIVE_CACHE_ENTRIES && !missingTiles.containsKey(url)) {
                val expiredOrOldest = missingTiles.entries.minByOrNull { it.value }?.key
                if (expiredOrOldest != null) missingTiles.remove(expiredOrOldest)
            }
            missingTiles[url] = now + NativeMissingTileFallback.MAX_NEGATIVE_CACHE_MILLIS
        }
    }

    private fun knownMissing(url: String): Boolean {
        val until = missingTiles[url] ?: return false
        if (elapsedRealtimeMillis() < until) return true
        missingTiles.remove(url, until)
        return false
    }

    private fun writeCacheAtomically(file: File, bytes: ByteArray) {
        directory.mkdirs()
        val atomicFile = AtomicFile(file)
        var output: FileOutputStream? = null
        try {
            output = atomicFile.startWrite()
            output.write(bytes)
            atomicFile.finishWrite(output)
            output = null
        } catch (error: Exception) {
            output?.let(atomicFile::failWrite)
            throw error
        }
    }

    private fun cacheFile(url: String, identity: TileRequestIdentity? = null): File {
        val digest = if (identity == null) sha256Hex(url.toByteArray(Charsets.UTF_8))
        else sha256Hex(identity.cacheKey.toByteArray(Charsets.UTF_8))
        return File(directory, "$digest.tile")
    }

    private fun trimDiskCache() {
        if (!directory.isDirectory) return
        val now = System.currentTimeMillis()
        // Only finalized entries participate. AtomicFile .new/.bak files belong to in-progress writes.
        val files = directory.listFiles()?.filter { it.isFile && it.name.endsWith(".tile") }
            ?.sortedBy { it.lastModified() } ?: return
        var total = 0L
        for (file in files) {
            if (now - file.lastModified() > CACHE_TTL_MS) {
                AtomicFile(file).delete()
            } else {
                total += file.length()
            }
        }
        for (file in files) {
            if (total <= MAX_DISK_CACHE_BYTES) break
            if (!file.exists()) continue
            total -= file.length()
            AtomicFile(file).delete()
        }
    }

    private fun setCooldown(host: String, delayMillis: Long) {
        val now = elapsedRealtimeMillis()
        val until = if (Long.MAX_VALUE - now < delayMillis) Long.MAX_VALUE else now + delayMillis
        hostCooldownUntilElapsed.merge(host, until, ::maxOf)
    }

    private fun cooldownRemainingMillis(host: String): Long {
        val until = hostCooldownUntilElapsed[host] ?: return 0L
        val remaining = until - elapsedRealtimeMillis()
        if (remaining <= 0L) hostCooldownUntilElapsed.remove(host, until)
        return remaining.coerceAtLeast(0L)
    }

    private fun serverClass(host:String):String = if(host=="tianditu.gov.cn" || host.endsWith(".tianditu.gov.cn") ||
        host=="tianditu.com" || host.endsWith(".tianditu.com")) TIANDITU_SERVER_CLASS else host
    private fun serverLabel(serverClass:String)=if(serverClass==TIANDITU_SERVER_CLASS) "天地图" else "图源"

    private fun reportAndNull(message: String): Nothing? {
        report(message)
        return null
    }

    @Synchronized
    private fun report(message: String) {
        val now = SystemClock.elapsedRealtime()
        if (lastStatusAt == 0L || now - lastStatusAt > STATUS_INTERVAL_MS) {
            lastStatusAt = now
            onStatus(message)
        }
    }

    private fun retryAfterMillis(value: String?): Long {
        val trimmed = value?.trim().orEmpty()
        val seconds = trimmed.toBigIntegerOrNull()
        if (seconds != null) {
            if (seconds.signum() <= 0) return 0L
            val millis = seconds.multiply(THOUSAND_BIG_INTEGER)
            return if (millis > LONG_MAX_BIG_INTEGER) Long.MAX_VALUE else millis.toLong()
        }
        val dateDelay = runCatching {
            ZonedDateTime.parse(trimmed, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toEpochMilli() - System.currentTimeMillis()
        }.getOrNull()
        return dateDelay?.coerceAtLeast(0L) ?: DEFAULT_429_COOLDOWN_MS
    }

    private fun ceilSeconds(millis: Long): Long {
        val value = millis.coerceAtLeast(0L)
        return value / 1_000L + if (value % 1_000L == 0L) 0L else 1L
    }

    internal companion object {
        const val MAX_ACTIVE_REQUESTS=20
        internal const val MAX_CUSTOM_BULK_PER_HOST=4
        const val MAX_TRACKED_BULK_HOSTS=64
        const val TIANDITU_SERVER_CLASS="tianditu-shared"
        const val MAX_TILE_BYTES = 4 * 1024 * 1024
        const val MEMORY_CACHE_BYTES = 12 * 1024 * 1024
        const val MAX_DISK_CACHE_BYTES = 64L * 1024 * 1024
        const val MAX_REFRESH_QUEUE = 64
        const val MAX_REFRESH_FACTORIES_PER_URL = 32
        const val MAX_REFRESH_COOLDOWN_ENTRIES = 256
        const val REFRESH_FAILURE_COOLDOWN_MS = 30_000L
        const val CACHE_TTL_MS = 24L * 60L * 60L * 1_000L
        const val MAX_QUEUED_NETWORK_REQUESTS = 256
        const val MAX_SHARED_REQUESTS = MAX_ACTIVE_REQUESTS + MAX_QUEUED_NETWORK_REQUESTS
        const val MAX_CLOSED_VIEW_TOMBSTONES = MAX_SHARED_REQUESTS
        const val STATUS_INTERVAL_MS = 4_000L
        const val DEFAULT_429_COOLDOWN_MS = 1_000L
        const val MIN_429_COOLDOWN_MS = 1_000L
        const val MAX_ATTEMPTS = 5
        const val MAX_RETRY_BUDGET_ENTRIES = 4_096
        const val REQUEST_DEADLINE_MS = 15_000L
        const val MAX_PENDING_CACHE_WRITES = 32
        const val MAX_PENDING_CACHE_WRITE_BYTES = 16 * 1024 * 1024L
        val RETRYABLE_HTTP_STATUS = setOf(408, 425, 429, 500, 502, 503, 504)
        val THOUSAND_BIG_INTEGER = java.math.BigInteger.valueOf(1_000L)
        val LONG_MAX_BIG_INTEGER = java.math.BigInteger.valueOf(Long.MAX_VALUE)
    }
}

/** Lowercase SHA-256 hex without Formatter/locale work on the tile request path. */
internal fun sha256Hex(bytes: ByteArray): String {
    val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
    val hex = "0123456789abcdef"
    return CharArray(digest.size * 2).also { chars ->
        digest.forEachIndexed { index, byte ->
            val value = byte.toInt() and 0xff
            chars[index * 2] = hex[value ushr 4]
            chars[index * 2 + 1] = hex[value and 0x0f]
        }
    }.concatToString()
}
