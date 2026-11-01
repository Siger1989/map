package com.shantu.nativeapp.map

import earth.worldwind.layer.source.TileBlob
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.util.LinkedHashMap
import java.util.concurrent.atomic.AtomicBoolean

/** Offline selection identity is part of the raw tile key, never telemetry. */
internal data class NativeOpenFreeMapRawSourceIdentity(
    val enabled: Boolean,
    val version: Int,
    val packageId: String?,
    val sourceId: String?,
    val provider: String?,
    val templates: List<String>,
) {
    companion object {
        fun from(state: NativeOfflineDisplayPolicyState) = if (state.enabled) {
            NativeOpenFreeMapRawSourceIdentity(
                true, state.version, state.packageId, state.sourceId, state.provider, state.vectorTileTemplates.toList(),
            )
        } else {
            NativeOpenFreeMapRawSourceIdentity(
                false, 1, null, null, "openfreemap", listOf("https://tiles.openfreemap.org/planet/latest/{z}/{x}/{y}.pbf"),
            )
        }
    }
}

internal data class NativeOpenFreeMapRawTileKey(
    val identity: NativeOpenFreeMapRawSourceIdentity,
    val z: Int,
    val x: Int,
    val y: Int,
)

/**
 * Bounded process-shared storage for immutable raw tile payloads. Decoders must treat
 * returned byte arrays as read-only; each consumer still builds its own renderables.
 */
internal class NativeSharedRawTileStore<K : Any>(
    private val maxBytes: Int = DEFAULT_MAX_BYTES,
    private val maxTiles: Int = DEFAULT_MAX_TILES,
    private val maxTileBytes: Int = DEFAULT_MAX_TILE_BYTES,
    private val loader: suspend (K) -> TileBlob?,
) {
    data class Snapshot(
        val rawBytes: Long,
        val rawTiles: Int,
        val hits: Long,
        val misses: Long,
        val fetches: Long,
        val deduplicated: Long,
        val inFlight: Int,
        val owners: Int,
        val evictions: Long,
    )

    private data class Flight(
        val result: CompletableDeferred<TileBlob?>,
        var waiters: Int,
        var job: Job? = null,
    )

    private val lock = Any()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val cache = LinkedHashMap<K, TileBlob>(80, .75f, true)
    private val flights = HashMap<K, Flight>()
    private val observers = LinkedHashMap<Long, LinkedHashMap<Long, (K, TileBlob) -> Unit>>()
    private var nextOwnerId = 1L
    private var nextObserverId = 1L
    private var bytes = 0L
    private var hits = 0L
    private var misses = 0L
    private var fetches = 0L
    private var deduplicated = 0L
    private var evictions = 0L
    private var closed = false

    init {
        require(maxBytes > 0 && maxTiles > 0 && maxTileBytes > 0 && maxTileBytes <= maxBytes)
    }

    inner class Lease internal constructor(private val ownerId: Long) : AutoCloseable {
        private val released = AtomicBoolean(false)

        suspend fun cached(key: K): TileBlob? {
            if (released.get()) return null
            return cachedFor(key)
        }

        suspend fun fetch(key: K): TileBlob? {
            if (released.get()) return null
            return fetchFor(key)
        }

        fun observe(observer: (K, TileBlob) -> Unit): AutoCloseable {
            check(!released.get()) { "raw tile lease is closed" }
            val observerId = synchronized(lock) {
                check(!closed)
                val id = nextObserverId++
                observers.getOrPut(ownerId) { LinkedHashMap() }[id] = observer
                id
            }
            val active = AtomicBoolean(true)
            return AutoCloseable {
                if (active.compareAndSet(true, false)) synchronized(lock) {
                    observers[ownerId]?.let { set ->
                        set.remove(observerId)
                        if (set.isEmpty()) observers.remove(ownerId)
                    }
                }
            }
        }

        fun cachedEntries(): List<Pair<K, TileBlob>> = synchronized(lock) {
            if (released.get() || closed) emptyList() else cache.entries.map { it.key to it.value }
        }

        override fun close() {
            if (!released.compareAndSet(false, true)) return
            releaseOwner(ownerId)
        }
    }

    fun acquire(): Lease = synchronized(lock) {
        check(!closed) { "raw tile store is closed" }
        val id = nextOwnerId++
        activeOwners += id
        observers[id] = LinkedHashMap()
        Lease(id)
    }

    fun snapshot(): Snapshot = synchronized(lock) {
        Snapshot(bytes, cache.size, hits, misses, fetches, deduplicated, flights.size, activeOwners.size, evictions)
    }

    private fun cachedFor(key: K): TileBlob? = synchronized(lock) {
        if (closed) return@synchronized null
        val blob = cache[key]
        if (blob != null) hits++
        blob
    }

    private suspend fun fetchFor(key: K): TileBlob? {
        val flight: Flight
        var start: Job? = null
        synchronized(lock) {
            check(!closed) { "raw tile store is closed" }
            cache[key]?.let { hits++; return it }
            misses++
            val existing = flights[key]
            if (existing != null) {
                deduplicated++
                existing.waiters++
                flight = existing
            } else {
                val created = Flight(CompletableDeferred(), 1)
                flights[key] = created
                fetches++
                flight = created
                start = scope.launch {
                    try {
                        val loaded = loader(key)
                        val blob = loaded?.takeIf { it.bytes.size <= maxTileBytes }
                        synchronized(lock) {
                            if (!closed && flights[key] === created && blob != null) putLocked(key, blob)
                        }
                        created.result.complete(blob)
                        if (blob != null && blob.bytes.isNotEmpty()) notifyObservers(key, blob)
                    } catch (t: Throwable) {
                        created.result.completeExceptionally(t)
                    } finally {
                        synchronized(lock) { if (flights[key] === created) flights.remove(key) }
                    }
                }
                created.job = start
            }
        }
        try {
            return flight.result.await()
        } finally {
            synchronized(lock) {
                flight.waiters--
                if (flight.waiters <= 0 && !flight.result.isCompleted && flights[key] === flight) {
                    flights.remove(key)
                    flight.job?.cancel()
                    flight.result.cancel()
                }
            }
        }
    }

    private fun putLocked(key: K, blob: TileBlob) {
        if (blob.bytes.size > maxTileBytes) return
        cache.remove(key)?.let { bytes -= it.bytes.size.toLong() }
        cache[key] = blob
        bytes += blob.bytes.size.toLong()
        while (cache.size > maxTiles || bytes > maxBytes) {
            val eldest = cache.entries.iterator()
            if (!eldest.hasNext()) break
            val entry = eldest.next()
            bytes -= entry.value.bytes.size.toLong()
            eldest.remove()
            evictions++
        }
    }

    private fun notifyObservers(key: K, blob: TileBlob) {
        val callbacks = synchronized(lock) {
            if (closed) emptyList() else observers.values.flatMap { it.values.toList() }
        }
        callbacks.forEach { callback -> runCatching { callback(key, blob) } }
    }

    private fun releaseOwner(ownerId: Long) {
        synchronized(lock) {
            observers.remove(ownerId)
            activeOwners.remove(ownerId)
            if (activeOwners.isEmpty()) disposeLocked()
        }
    }

    private val activeOwners = LinkedHashSet<Long>()

    private fun disposeLocked() {
        if (closed) return
        closed = true
        flights.values.forEach { flight -> flight.job?.cancel(); flight.result.cancel() }
        flights.clear()
        cache.clear()
        bytes = 0L
        observers.clear()
        scope.cancel()
    }

    companion object {
        const val DEFAULT_MAX_BYTES = 32 * 1024 * 1024
        const val DEFAULT_MAX_TILES = 256
        const val DEFAULT_MAX_TILE_BYTES = 4 * 1024 * 1024
    }
}
