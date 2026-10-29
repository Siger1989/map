package com.shantu.nativeapp.map

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.SystemClock
import android.util.AtomicFile
import android.util.LruCache
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.selects.select
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
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
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

internal data class TileHttpResponse(val statusCode: Int, val retryAfter: String?, val body: ByteArray?)

/** URL/key-free cumulative counters and timings for this loader instance. */
internal data class TileNetworkSnapshot(
    val memoryHits: Long,
    val diskHits: Long,
    val networkRequests: Long,
    val successes: Long,
    val errors: Long,
    val rateLimits: Long,
    val cancellations: Long,
    val receivedBytes: Long,
    val queueWaitMs: Long,
    val networkMs: Long,
    val queuedNetworkRequests: Int,
    val activeNetworkRequests: Int,
)

internal fun interface TileHttpClient {
    fun execute(url: String): TileHttpResponse
}

/** Build the registered Tianditu WMTS endpoint without exposing the key to logs/status text. */
internal fun tiandituTileUrl(layer: String, x: Int, y: Int, z: Int, encodedKey: String): String {
    require(layer in setOf("img", "cia", "vec", "cva", "ter", "cta"))
    return "https://t0.tianditu.gov.cn/${layer}_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0" +
        "&LAYER=$layer&STYLE=default&TILEMATRIXSET=w&TILEMATRIX=$z&TILEROW=$y&TILECOL=$x&FORMAT=tiles&tk=$encodedKey"
}

private class UrlConnectionTileHttpClient : TileHttpClient {
    override fun execute(url: String): TileHttpResponse {
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = CONNECT_TIMEOUT_MS
            readTimeout = READ_TIMEOUT_MS
            instanceFollowRedirects = false
            setRequestProperty("Accept", "image/png,image/*;q=0.9,*/*;q=0.5")
            setRequestProperty("User-Agent", "ShantuNativeMap/1")
        }
        return try {
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
            TileHttpResponse(code, connection.getHeaderField("Retry-After"), body)
        } finally {
            connection.disconnect()
        }
    }

    private companion object {
        const val CONNECT_TIMEOUT_MS = 8_000
        const val READ_TIMEOUT_MS = 12_000
        const val MAX_TILE_BYTES = 4 * 1024 * 1024
    }
}

/** Shared scheduler: four foreground map slots plus a separate, bounded sixteen-request bulk lane. */
internal class BoundedTileNetwork(
    private val directory: File,
    private val onStatus: (String) -> Unit,
    private val client: TileHttpClient = UrlConnectionTileHttpClient(),
    private val isValidImage: (ByteArray) -> Boolean = { bytes ->
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.also(Bitmap::recycle) != null
    },
    private val sleepBeforeRetry: (Long) -> Unit = { Thread.sleep(it) },
) {
    private data class MemoryTile(val bytes: ByteArray, val savedAtMillis: Long)

    private val mapSemaphore = Semaphore(MAX_MAP_REQUESTS)
    private val bulkSemaphore = Semaphore(MAX_BULK_REQUESTS)
    private val bulkHostLock=Any()
    private val bulkHostSemaphores=linkedMapOf<String,Semaphore>()
    private val overflowBulkHostSemaphore=Semaphore(MAX_CUSTOM_BULK_PER_HOST)
    // Keep the shared DataServer class bounded without serializing it: the web loader's
    // established contract is four active requests with a 250 ms start cadence. Bulk is
    // capped at two of those slots and always yields to waiting map work; map work can use
    // all four slots when bulk is idle.
    private val tiandituBulkSemaphore = Semaphore(MAX_TIANDITU_BULK_REQUESTS)
    private val tiandituActiveSemaphore = Semaphore(MAX_TIANDITU_ACTIVE_REQUESTS)
    private val tiandituStartSemaphore = Semaphore(1)
    private val tiandituMapWaiters = AtomicInteger()
    private val tiandituBulkWaiters = AtomicInteger()
    private val lastTiandituRequestAt = AtomicLong(0L)
    private val closeSignal = CompletableDeferred<Unit>()
    private val queuedNetworkRequests = AtomicInteger()
    private val memory = object : LruCache<String, MemoryTile>(MEMORY_CACHE_BYTES) {
        override fun sizeOf(key: String, value: MemoryTile) = value.bytes.size
    }
    private val inFlight = ConcurrentHashMap<String, CompletableFuture<ByteArray?>>()
    private val hostCooldownUntilElapsed = ConcurrentHashMap<String, Long>()
    private val memoryHits = AtomicLong()
    private val diskHits = AtomicLong()
    private val networkRequests = AtomicLong()
    private val successes = AtomicLong()
    private val errors = AtomicLong()
    private val rateLimits = AtomicLong()
    private val cancellations = AtomicLong()
    private val receivedBytes = AtomicLong()
    private val queueWaitMs = AtomicLong()
    private val networkMs = AtomicLong()
    private val diskCacheLock = Any()
    private val lifecycleLock=Any()
    @Volatile private var lastStatusAt = 0L
    @Volatile private var closed = false
    @Volatile var cacheOnly = false
        set(value) { synchronized(lifecycleLock) { field=value } }
    @Volatile internal var archive: NativeTileArchive? = null
    @Volatile internal var legacyReader: ((String)->ByteArray?)? = null

    suspend fun readCached(url: String): ByteArray? = withContext(Dispatchers.IO) { readCachedBlocking(url) }

    suspend fun fetch(url: String, bulkDownload: Boolean = false): ByteArray? = withContext(Dispatchers.IO) {
        try {
            if (closed) {
                errors.incrementAndGet()
                return@withContext null
            }
            val offlinePolicy = NativeOfflineDisplayPolicy.snapshot()
            if (offlinePolicy.enabled && !bulkDownload) {
                val cached = NativeOfflineDisplayPolicy.readSelectedCache(url)
                if (cached == null) {
                    errors.incrementAndGet()
                    report("当前缓存包缺少此瓦片；离线模式不会联网补取")
                } else successes.incrementAndGet()
                return@withContext cached
            }
            readCachedBlocking(url)?.let {
                successes.incrementAndGet()
                return@withContext it
            }
            if (cacheOnly) return@withContext null

            val mine = CompletableFuture<ByteArray?>()
            val existing = inFlight.putIfAbsent(url, mine)
            if (existing != null) {
                val shared = awaitExisting(existing)
                if (shared == null) errors.incrementAndGet() else successes.incrementAndGet()
                return@withContext shared
            }

            var result: ByteArray? = null
            try {
                result = fetchSingle(url,bulkDownload)
                if (result == null) errors.incrementAndGet() else successes.incrementAndGet()
                result
            } finally {
                mine.complete(result)
                inFlight.remove(url, mine)
            }
        } catch (cancelled: CancellationException) {
            cancellations.incrementAndGet()
            throw cancelled
        }
    }

    /** Read-only, URL/key-free cumulative telemetry; safe to call from any thread. */
    fun snapshot(): TileNetworkSnapshot = TileNetworkSnapshot(
        memoryHits = memoryHits.get(),
        diskHits = diskHits.get(),
        networkRequests = networkRequests.get(),
        successes = successes.get(),
        errors = errors.get(),
        rateLimits = rateLimits.get(),
        cancellations = cancellations.get(),
        receivedBytes = receivedBytes.get(),
        queueWaitMs = queueWaitMs.get(),
        networkMs = networkMs.get(),
        queuedNetworkRequests = queuedNetworkRequests.get(),
        activeNetworkRequests = MAX_MAP_REQUESTS-mapSemaphore.availablePermits + MAX_BULK_REQUESTS-bulkSemaphore.availablePermits,
    )

    /** Remaining server cooldown shared by every tile for the same host. */
    fun cooldownRemainingMillis(): Long {
        val now = SystemClock.elapsedRealtime()
        hostCooldownUntilElapsed.entries.removeIf { it.value <= now }
        return hostCooldownUntilElapsed.values.maxOrNull()?.minus(now)?.coerceAtLeast(0L) ?: 0L
    }

    fun close() {
        synchronized(lifecycleLock) {
            closed = true
            memory.evictAll()
            archive = null
            legacyReader = null
        }
        closeSignal.complete(Unit)
        inFlight.values.forEach { it.complete(null) }
        inFlight.clear()
    }

    internal fun memorySizeBytesForTest():Int=memory.size()
    internal fun tiandituBulkWaiterCountForTest():Int=tiandituBulkWaiters.get()
    internal fun tiandituMapWaiterCountForTest():Int=tiandituMapWaiters.get()

    private suspend fun fetchSingle(url: String,bulkDownload:Boolean): ByteArray? {
        if (closed || cacheOnly || !NativeOfflineDisplayPolicy.permitsNetwork(bulkDownload) || Thread.currentThread().isInterrupted) return null
        val host = runCatching { URL(url).host.lowercase() }.getOrNull()
            ?: return reportAndNull("地图瓦片地址无效")
        val serverClass=serverClass(host)
        cooldownRemainingMillis(serverClass).takeIf { it > 0L }?.let { remaining ->
            report("${serverLabel(serverClass)}服务器冷却中，约${ceilSeconds(remaining)}秒后可重试")
            return null
        }
        var bulkHostPermit=false
        var tiandituPermit=false
        var tiandituBulkPermit=false
        var networkPermit=false
        val requestSemaphore=if(bulkDownload) bulkSemaphore else mapSemaphore
        try {
        if(bulkDownload) {
            if(serverClass!=TIANDITU_SERVER_CLASS) {
                bulkHostSemaphore(serverClass).acquire()
                bulkHostPermit=true
            }
        }
        if(serverClass==TIANDITU_SERVER_CLASS) {
            if(!acquireTiandituHostPermit(bulkDownload)) return null
            tiandituPermit=true
            tiandituBulkPermit=bulkDownload
        }
        val queueStartedAtNanos = System.nanoTime()
        val acquired = try {
            acquireNetworkPermit(requestSemaphore)
        } finally {
            queueWaitMs.addAndGet(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - queueStartedAtNanos).coerceAtLeast(0L))
        }
        if (!acquired) {
            report("地图请求队列已满或图层已关闭，当前瓦片暂缓；可点重试")
            return null
        }
        networkPermit=true
        try {
            // A different tile may receive 429 while this tile waits for a network slot.
            cooldownRemainingMillis(serverClass).takeIf { it > 0L }?.let { remaining ->
                report("${serverLabel(serverClass)}服务器冷却中，约${ceilSeconds(remaining)}秒后可重试")
                return null
            }

            val cacheFile = cacheFile(url)
            var attempt = 0
            while (attempt < 2) {
                if (closed || cacheOnly || !NativeOfflineDisplayPolicy.permitsNetwork(bulkDownload) || Thread.currentThread().isInterrupted) return null
                if(serverClass==TIANDITU_SERVER_CLASS && cooldownRemainingMillis(serverClass)>0L) return null
                val admitted=if(serverClass==TIANDITU_SERVER_CLASS) awaitTiandituStartSlot(bulkDownload) else synchronized(lifecycleLock) {
                    if(closed || cacheOnly || !NativeOfflineDisplayPolicy.permitsNetwork(bulkDownload) || Thread.currentThread().isInterrupted) false
                    else { networkRequests.incrementAndGet(); true }
                }
                if(!admitted)return null
                val requestStartedAtNanos = System.nanoTime()
                val response = try {
                    client.execute(url)
                } finally {
                    networkMs.addAndGet(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - requestStartedAtNanos).coerceAtLeast(0L))
                }
                // A cache-only toggle or last-owner release may race an in-flight socket. Its
                // response must not repopulate memory/disk after that policy/lifecycle change.
                if (closed || cacheOnly || !NativeOfflineDisplayPolicy.permitsNetwork(bulkDownload) || Thread.currentThread().isInterrupted) return null
                response.body?.let { receivedBytes.addAndGet(it.size.toLong()) }
                if (response.statusCode == 429) {
                    rateLimits.incrementAndGet()
                    val delay = retryAfterMillis(response.retryAfter)
                    setCooldown(serverClass, delay)
                    report("${serverLabel(serverClass)}请求受限，服务器冷却${ceilSeconds(delay)}秒")
                    if (attempt != 0 || delay > MAX_INLINE_RETRY_DELAY_MS) return null
                    if (delay > 0) sleepBeforeRetry(delay)
                    // Another tile may have received a later 429 while this request waited.
                    cooldownRemainingMillis(serverClass).takeIf { it > 0L }?.let { remaining ->
                        report("${serverLabel(serverClass)}服务器冷却已延长，约${ceilSeconds(remaining)}秒后可重试")
                        return null
                    }
                    attempt++
                    continue
                }
                if (response.statusCode !in 200..299) {
                    report("天地图瓦片加载失败（HTTP ${response.statusCode}）；可点重试")
                    return null
                }
                val bytes = response.body
                if (bytes == null || bytes.size > MAX_TILE_BYTES) {
                    report("天地图瓦片响应为空或超过大小限制；可点重试")
                    return null
                }
                if (!runCatching { isValidImage(bytes) }.getOrDefault(false)) {
                    report("天地图瓦片图像无效，未写入缓存；可点重试")
                    return null
                }
                if (closed || cacheOnly || !NativeOfflineDisplayPolicy.permitsNetwork(bulkDownload) || Thread.currentThread().isInterrupted) return null
                synchronized(lifecycleLock) {
                    if(closed || cacheOnly || !NativeOfflineDisplayPolicy.permitsNetwork(bulkDownload) || Thread.currentThread().isInterrupted)return null
                    val entry = MemoryTile(bytes, System.currentTimeMillis())
                    memory.put(cacheFile.name, entry)
                    // Disk persistence is opportunistic. An I/O failure never rejects a valid tile.
                    runCatching { synchronized(diskCacheLock) { writeCacheAtomically(cacheFile, bytes); trimDiskCache() } }
                }
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
            if(networkPermit) requestSemaphore.release()
        }
        } finally {
            if(tiandituPermit) tiandituActiveSemaphore.release()
            if(tiandituBulkPermit) tiandituBulkSemaphore.release()
            if(bulkHostPermit) bulkHostSemaphore(serverClass).release()
        }
    }

    /** Maps wait FIFO for shared active slots; bulk never queues ahead of map demand. */
    private suspend fun acquireTiandituHostPermit(bulkDownload:Boolean):Boolean {
        if(!bulkDownload) {
            tiandituMapWaiters.incrementAndGet()
            try {
                if(closed) return false
                return acquireNetworkPermit(tiandituActiveSemaphore)
            } finally {
                tiandituMapWaiters.decrementAndGet()
            }
        }
        tiandituBulkWaiters.incrementAndGet()
        try {
            while(!closed && !Thread.currentThread().isInterrupted) {
                if(tiandituMapWaiters.get()==0 && tiandituBulkSemaphore.tryAcquire()) {
                    if(tiandituMapWaiters.get()==0 && tiandituActiveSemaphore.tryAcquire()) return true
                    tiandituBulkSemaphore.release()
                }
                delay(10)
            }
            return false
        } finally {
            tiandituBulkWaiters.decrementAndGet()
        }
    }

    /** Atomically spaces actual TDT request starts while allowing prior requests to stay in flight. */
    private suspend fun awaitTiandituStartSlot(bulkDownload:Boolean):Boolean {
        tiandituStartSemaphore.acquire()
        try {
            val elapsed=SystemClock.elapsedRealtime()-lastTiandituRequestAt.get()
            val wait=(TIANDITU_MIN_INTERVAL_MS-elapsed).coerceAtLeast(0L)
            if(wait>0L) delay(wait)
            return synchronized(lifecycleLock) {
                if(closed || cacheOnly || !NativeOfflineDisplayPolicy.permitsNetwork(bulkDownload) || Thread.currentThread().isInterrupted) false
                else {
                    lastTiandituRequestAt.set(SystemClock.elapsedRealtime())
                    networkRequests.incrementAndGet()
                    true
                }
            }
        } finally {
            tiandituStartSemaphore.release()
        }
    }

    private fun bulkHostSemaphore(serverClass:String):Semaphore = synchronized(bulkHostLock) {
        bulkHostSemaphores[serverClass] ?: if(bulkHostSemaphores.size<MAX_TRACKED_BULK_HOSTS) {
            Semaphore(MAX_CUSTOM_BULK_PER_HOST).also { bulkHostSemaphores[serverClass]=it }
        } else overflowBulkHostSemaphore
    }

    /** Cancellable bounded gate with a finite waiter budget and close wakeup. */
    private suspend fun acquireNetworkPermit(semaphore:Semaphore): Boolean {
        if (closed) return false
        if (semaphore.tryAcquire()) {
            if (closed) {
                semaphore.release()
                return false
            }
            return true
        }
        while (true) {
            val waiting = queuedNetworkRequests.get()
            if (waiting >= MAX_QUEUED_NETWORK_REQUESTS) return false
            if (queuedNetworkRequests.compareAndSet(waiting, waiting + 1)) break
        }
        return try {
            if (closed) return false
            coroutineScope {
                val permitAcquired = AtomicInteger(0)
                var ownershipTransferred = false
                val acquireTask = async {
                    semaphore.acquire()
                    permitAcquired.set(1)
                    true
                }
                try {
                    val selected =
                    select<Boolean> {
                        acquireTask.onAwait { true }
                        closeSignal.onAwait { false }
                    }
                    if (selected && permitAcquired.get() != 0 && !closed) {
                        ownershipTransferred = true
                        true
                    } else false
                } finally {
                    if (permitAcquired.get() == 0) {
                        withContext(NonCancellable) { acquireTask.cancelAndJoin() }
                    } else acquireTask.cancel()
                    if (permitAcquired.get() != 0 && !ownershipTransferred) semaphore.release()
                }
            }
        } finally {
            queuedNetworkRequests.decrementAndGet()
        }
    }

    private fun awaitExisting(future: CompletableFuture<ByteArray?>): ByteArray? = try {
        future.get(IN_FLIGHT_WAIT_MS, TimeUnit.MILLISECONDS)
    } catch (_: InterruptedException) {
        Thread.currentThread().interrupt()
        null
    } catch (_: Exception) {
        null
    }

    private fun readCachedBlocking(url: String): ByteArray? {
        if (closed) return null
        legacyReader?.invoke(url)?.takeIf{runCatching{isValidImage(it)}.getOrDefault(false)}?.let{diskHits.incrementAndGet();return it}
        archive?.read(url)?.let { bytes ->
            if (runCatching { isValidImage(bytes) }.getOrDefault(false)) {
                diskHits.incrementAndGet()
                return bytes
            }
        }
        val file = cacheFile(url)
        memory.get(file.name)?.let { cached ->
            if (isFresh(cached.savedAtMillis)) {
                memoryHits.incrementAndGet()
                return cached.bytes
            }
            memory.remove(file.name)
            AtomicFile(file).delete()
            return null
        }
        val bytes = synchronized(diskCacheLock) {
            if (!file.isFile || file.length() > MAX_TILE_BYTES) return null
            val diskAge = System.currentTimeMillis() - file.lastModified()
            if (diskAge !in 0L..CACHE_TTL_MS) {
                AtomicFile(file).delete()
                return null
            }
            val cached = runCatching { AtomicFile(file).openRead().use { it.readBytes() } }.getOrNull() ?: return null
            if (cached.size > MAX_TILE_BYTES || !runCatching { isValidImage(cached) }.getOrDefault(false)) {
                AtomicFile(file).delete()
                return null
            }
            cached
        }
        diskHits.incrementAndGet()
        memory.put(file.name, MemoryTile(bytes, file.lastModified()))
        return bytes
    }

    private fun isFresh(savedAtMillis: Long): Boolean {
        val age = System.currentTimeMillis() - savedAtMillis
        return age >= 0L && age <= CACHE_TTL_MS
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

    private fun cacheFile(url: String): File {
        val digest = sha256Hex(url.toByteArray(Charsets.UTF_8))
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
        val now = SystemClock.elapsedRealtime()
        val until = if (Long.MAX_VALUE - now < delayMillis) Long.MAX_VALUE else now + delayMillis
        hostCooldownUntilElapsed.merge(host, until, ::maxOf)
    }

    private fun cooldownRemainingMillis(host: String): Long {
        val until = hostCooldownUntilElapsed[host] ?: return 0L
        val remaining = until - SystemClock.elapsedRealtime()
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
        const val MAX_MAP_REQUESTS=4
        const val MAX_BULK_REQUESTS=16
        internal const val MAX_CUSTOM_BULK_PER_HOST=4
        internal const val MAX_TIANDITU_ACTIVE_REQUESTS=4
        internal const val MAX_TIANDITU_BULK_REQUESTS=2
        const val MAX_TRACKED_BULK_HOSTS=64
        const val TIANDITU_MIN_INTERVAL_MS=250L
        const val TIANDITU_SERVER_CLASS="tianditu-shared"
        const val MAX_TILE_BYTES = 4 * 1024 * 1024
        const val MEMORY_CACHE_BYTES = 12 * 1024 * 1024
        const val MAX_DISK_CACHE_BYTES = 64L * 1024 * 1024
        const val CACHE_TTL_MS = 24L * 60L * 60L * 1_000L
        const val MAX_QUEUED_NETWORK_REQUESTS = 256
        const val IN_FLIGHT_WAIT_MS = 25_000L
        const val STATUS_INTERVAL_MS = 4_000L
        const val DEFAULT_429_COOLDOWN_MS = 1_000L
        const val MAX_INLINE_RETRY_DELAY_MS = 1_000L
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
