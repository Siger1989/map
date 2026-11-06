package com.shantu.nativeapp.floating

import android.content.Context
import com.shantu.nativeapp.map.NativeTerrariumCoverage
import com.shantu.nativeapp.map.NativeTileNetworkPool
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.joinAll
import java.util.LinkedHashMap

/** Bounded terrain-only source for the two floating map views; raw DEM comes from the shared map pool. */
internal class FloatingTerrainSource(context: Context) : AutoCloseable {
    private val lease = NativeTileNetworkPool.acquire(context.applicationContext) { }
    private val coverage = NativeTerrariumCoverage(context.applicationContext, lease.network)
    private val permits = Semaphore(2)
    private val lock = Any()
    private val tileCache = object : LinkedHashMap<Key, FloatingTerrainTile>(24, .75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Key, FloatingTerrainTile>?): Boolean = size > TILE_CACHE_LIMIT
    }
    private val parentCache = object : LinkedHashMap<Key, DoubleArray>(6, .75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Key, DoubleArray>?): Boolean = size > PARENT_CACHE_LIMIT
    }
    private val pendingParents = HashMap<Key, CompletableDeferred<DoubleArray?>>()
    @Volatile private var closed = false

    fun visibleTileIds(z: Int, centerX: Int, centerY: Int): List<Pair<Int, Int>> {
        require(z in MIN_ZOOM..MAX_ZOOM)
        return FloatingTerrainSampling.visibleTileIds(z, centerX, centerY)
    }

    fun cachedVisibleTiles(z: Int, centerX: Int, centerY: Int): List<FloatingTerrainTile> {
        val targets = visibleTileIds(z, centerX, centerY)
        return synchronized(lock) { targets.mapNotNull { tileCache[Key(z, it.first, it.second)] } }
    }

    /** Calls onTile on the caller dispatcher as each tile completes, allowing partial real terrain to render. */
    suspend fun loadVisibleTiles(
        z: Int,
        centerX: Int,
        centerY: Int,
        onTile: (FloatingTerrainTile) -> Unit,
    ) = coroutineScope {
        check(!closed) { "terrain source closed" }
        val targets = visibleTileIds(z, centerX, centerY)
        val results = Channel<FloatingTerrainTile?>(targets.size)
        val jobs: List<Job> = targets.map { (x, y) ->
            launch {
                val tile = try { sampleTile(z, x, y) }
                catch (cancelled: CancellationException) { throw cancelled }
                catch (_: Exception) { null }
                results.send(tile)
            }
        }
        try {
            repeat(targets.size) { results.receive()?.let(onTile) }
            jobs.joinAll()
        } finally {
            results.cancel()
            jobs.forEach { it.cancel() }
        }
    }

    private suspend fun sampleTile(z: Int, x: Int, y: Int): FloatingTerrainTile? = permits.withPermit {
        currentCoroutineContext().ensureActive()
        if (closed) return@withPermit null
        val key = Key(z, x, y)
        synchronized(lock) { tileCache[key] }?.let { return@withPermit it }
        val values = if (z == TERRAIN_SOURCE_ZOOM) {
            val sampled = coverage.sampleMercatorTile(z, x, y, tileSize = 256, outputSize = DIRECT_SAMPLE_SIDE) ?: return@withPermit null
            FloatingTerrainSampling.resampleCenters(sampled, DIRECT_SAMPLE_SIDE, GRID_SIDE)
        } else {
            val parentScale = 1 shl (z - TERRAIN_SOURCE_ZOOM)
            val parentX = x / parentScale
            val parentY = y / parentScale
            val parent = parentTile(parentX, parentY) ?: return@withPermit null
            FloatingTerrainSampling.cropParentCenters(parent, parentX = x % parentScale, parentY = y % parentScale, scale = parentScale)
        }
        currentCoroutineContext().ensureActive()
        if (values.none(Double::isFinite)) return@withPermit null
        val tile = FloatingTerrainTile(z, x, y, GRID_SIDE, values)
        synchronized(lock) { tileCache[key] = tile }
        tile
    }

    private suspend fun parentTile(x: Int, y: Int): DoubleArray? {
        val key = Key(TERRAIN_SOURCE_ZOOM, x, y)
        var owner = false
        val pending = synchronized(lock) {
            parentCache[key]?.let { return it }
            pendingParents[key] ?: CompletableDeferred<DoubleArray?>().also {
                pendingParents[key] = it
                owner = true
            }
        }
        if (!owner) return pending.await()
        try {
            val values = coverage.sampleMercatorTile(TERRAIN_SOURCE_ZOOM, x, y, tileSize = 256, outputSize = 256)
            currentCoroutineContext().ensureActive()
            if (values != null) synchronized(lock) { parentCache[key] = values }
            pending.complete(values)
            return values
        } catch (cancelled: CancellationException) {
            pending.cancel(cancelled)
            throw cancelled
        } catch (error: Exception) {
            pending.completeExceptionally(error)
            throw error
        } finally {
            synchronized(lock) { if (pendingParents[key] === pending) pendingParents.remove(key) }
        }
    }

    override fun close() {
        if (closed) return
        closed = true
        synchronized(lock) {
            pendingParents.values.forEach { it.cancel() }
            pendingParents.clear()
            tileCache.clear()
            parentCache.clear()
        }
        lease.close()
    }

    private data class Key(val z: Int, val x: Int, val y: Int)

    companion object {
        const val GRID_SIDE = 33
        const val MIN_ZOOM = 13
        const val MAX_ZOOM = 16
        private const val TERRAIN_SOURCE_ZOOM = 13
        private const val DIRECT_SAMPLE_SIDE = 64
        private const val TILE_CACHE_LIMIT = 32
        private const val PARENT_CACHE_LIMIT = 8

    }
}
