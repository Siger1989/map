package com.shantu.nativeapp.map

import android.os.Trace
import earth.worldwind.WorldWind
import earth.worldwind.layer.mvt.MvtTile
import earth.worldwind.layer.mvt.MvtStyle
import earth.worldwind.layer.mvt.MvtVectorLayer
import earth.worldwind.layer.source.TileSource
import earth.worldwind.render.RenderContext
import earth.worldwind.render.Renderable
import earth.worldwind.util.Tile
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.job
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/**
 * Adds viewport-ranked bounded admission to one background MVT layer while preserving its render policy.
 *
 * The elapsed wall time includes the SDK tile-selection/assembly-result drain, drawable submission,
 * and the MVT endFrame label pass. It is not GPU execution time. Tile detail selection, style,
 * geometry, and cache policy are unchanged. Pick passes are delegated without recording; the
 * application does not use background MVT features as pick targets.
 */
internal open class NativeTimedMvtLayer(
    source: TileSource,
    minZoom: Int,
    maxZoom: Int,
    maxLoadedTiles: Int,
    maxConcurrentFetches: Int,
    maxConcurrentAssembly: Int,
    style: MvtStyle,
    displayName: String,
    private val metricPrefix: String,
) : MvtVectorLayer(
    source = source,
    minZoom = minZoom,
    // Keep the requested last level as an ordinary SDK level so effectiveDetailControl can observe
    // and mark it. The extra level is a non-fetchable sentinel; see the override below.
    maxZoom = maxZoom + 1,
    maxLoadedTiles = maxLoadedTiles,
    maxConcurrentFetches = maxConcurrentFetches,
    maxConcurrentAssembly = maxConcurrentAssembly,
    style = style,
    displayName = displayName,
) {
    private val sourceMaximumZoom = maxZoom

    init { require(sourceMaximumZoom in 0..29) }
    private val renderCount = AtomicLong()
    private val renderTotalNanos = AtomicLong()
    private val renderMaxNanos = AtomicLong()
    private val renderTraceName = "ShantuMvt/$metricPrefix/render"
    private val labelTraceName = "ShantuMvt/$metricPrefix/labels"
    private val assemblyTraceName = "ShantuMvt/$metricPrefix/assemble"
    private val viewportCapacity = maxConcurrentFetches.coerceAtLeast(1) + maxConcurrentAssembly.coerceAtLeast(1)
    private val viewportClosed = AtomicBoolean(false)
    private var trackingViewportDemand = false
    private val viewportDemand = NativeViewportTileDemand(sourceMaximumZoom)
    private val viewportQueue = NativeViewportTileQueue<NativeViewportTileKey>(
        capacity = viewportCapacity,
        maximumRequests = maxPendingFetches,
    ) { onViewportWorkChanged() }
    private val decodeCapacity = maxConcurrentAssembly.coerceAtLeast(1)
    private val decodeQueue = NativeViewportTileQueue<NativeViewportTileKey>(decodeCapacity, maxPendingFetches) {
        onViewportWorkChanged()
    }
    private val decodePermits = ConcurrentHashMap<Job, NativeViewportTileQueue.Permit>()
    private val predecodeDroppedCount = AtomicLong()

    init {
        this.source = NativeMvtPredecodeSource.wrap(source,
            checkNeeded = { z, x, sourceY -> ensureDecodeStillNeeded(sourceKey(z, x, sourceY)) },
            beforeCachedDecode = { z, x, sourceY -> awaitCachedDecode(sourceKey(z, x, sourceY)) },
        )
    }

    override fun render(rc: RenderContext) {
        // Preserve SDK pick and visibility gating, while excluding pick/disabled frames from the
        // normal-render metric. LayerList still sees this concrete MVT subclass as currentLayer.
        if (!isEnabled && !rc.isPickMode) discardPendingViewportWork()
        if (rc.isPickMode || !isEnabled || !isWithinActiveAltitudes(rc)) {
            super.render(rc)
            return
        }

        val startedAt = System.nanoTime()
        Trace.beginSection(renderTraceName)
        try {
            super.render(rc)
        } finally {
            Trace.endSection()
            recordRender(System.nanoTime() - startedAt)
        }
    }

    override fun endFrame(rc: RenderContext) {
        try {
            Trace.beginSection(labelTraceName)
            try { super.endFrame(rc) } finally { Trace.endSection() }
        } finally {
            if (trackingViewportDemand) finishViewportFrame(rc)
        }
    }

    override fun beginFrame(rc: RenderContext) {
        super.beginFrame(rc)
        trackingViewportDemand = pendingTileCount > 0
        if (trackingViewportDemand) viewportDemand.beginFrame()
    }

    override fun effectiveDetailControl(rc: RenderContext, tile: Tile): Double {
        if (trackingViewportDemand) viewportDemand.mark(tile.level.levelNumber, tile.column, tile.row)
        // MvtVectorLayer's SDK-visible last-level short circuit is bypassed by the sentinel. Return
        // the coarsest possible detail factor only when the true source maximum was visited, so the
        // SDK requests through sourceMaximumZoom but never subdivides into the sentinel.
        if (tile.level.levelNumber >= sourceMaximumZoom) return Double.POSITIVE_INFINITY
        return super.effectiveDetailControl(rc, tile)
    }

    override suspend fun loadTileContent(z: Int, x: Int, y: Int, sector: earth.worldwind.geom.Sector): List<Renderable>? {
        val key = NativeViewportTileKey(z, x, y)
        val requestJob = currentCoroutineContext().job
        val permit = viewportQueue.acquire(key)
            ?: throw CancellationException("MVT tile is no longer in the active viewport demand")
        try {
            return super.loadTileContent(z, x, y, sector)
        } finally {
            // Ownership follows this SDK coroutine, not tile coordinates: an invalidated tile's
            // old CPU work may overlap a replacement job for the same key.
            decodePermits.remove(requestJob)?.close()
            permit.close()
        }
    }

    /** Drop only not-yet-started viewport requests; active tile work finishes and may enter cache. */
    fun discardPendingViewportWork() {
        viewportQueue.removePendingNotIn(emptySet()) { key -> invalidateTile(key.z, key.x, key.sdkRow) }
        pruneDecodeWork(emptySet())
    }

    private fun sourceKey(z: Int, x: Int, sourceY: Int) = NativeViewportTileKey(z, x, (1 shl z) - 1 - sourceY)

    private fun ensureDecodeStillNeeded(key: NativeViewportTileKey) {
        if (!viewportClosed.get() && isEnabled && viewportDemand.isRetained(key)) return
        predecodeDroppedCount.incrementAndGet()
        if (!viewportClosed.get()) invalidateTile(key.z, key.x, key.sdkRow)
        throw CancellationException("MVT tile became obsolete before decode")
    }

    private suspend fun awaitCachedDecode(key: NativeViewportTileKey) {
        ensureDecodeStillNeeded(key)
        val permit = decodeQueue.acquire(key)
            ?: throw CancellationException("MVT decode request was removed from viewport demand")
        try {
            // Re-check after suspension: the camera may have changed while raw bytes waited.
            ensureDecodeStillNeeded(key)
            check(decodePermits.putIfAbsent(currentCoroutineContext().job, permit) == null) {
                "Duplicate cached decode admission for one SDK request"
            }
        } catch (failure: Throwable) {
            permit.close()
            throw failure
        }
    }

    private fun pruneDecodeWork(retained: Set<NativeViewportTileKey>) {
        decodeQueue.removePendingNotIn(retained) { key ->
            predecodeDroppedCount.incrementAndGet()
            invalidateTile(key.z, key.x, key.sdkRow)
        }
    }

    private fun onViewportWorkChanged() {
        if (viewportClosed.get()) return
        // A coroutine may register after the host disabled the layer and already discarded its
        // pending set. Re-prune here; active permits are intentionally untouched by the queue.
        if (!isEnabled) discardPendingViewportWork()
        WorldWind.requestRedraw()
    }

    override fun close() {
        if (viewportClosed.compareAndSet(false, true)) {
            viewportQueue.close()
            decodeQueue.close()
        }
        super.close()
    }

    override fun clone(): NativeTimedMvtLayer = NativeTimedMvtLayer(
        source = NativeMvtPredecodeSource.unwrap(source),
        minZoom = minZoom,
        maxZoom = sourceMaximumZoom,
        maxLoadedTiles = maxLoadedTiles,
        maxConcurrentFetches = maxConcurrentFetches,
        maxConcurrentAssembly = maxConcurrentAssembly,
        style = style,
        displayName = displayName ?: "Vector Tiles",
        metricPrefix = metricPrefix,
    ).also {
        it.sector.copy(sector)
        it.spriteAtlas = spriteAtlas
    }

    private fun finishViewportFrame(rc: RenderContext) {
        val retained = viewportDemand.endFrame()
        viewportQueue.removePendingNotIn(retained) { key -> invalidateTile(key.z, key.x, key.sdkRow) }
        pruneDecodeWork(retained)
        if (viewportClosed.get()) return
        // Loading admission waits for the complete SDK batch. Cached bytes compete separately
        // before decode; network results are checked but never hold HTTP slots waiting here.
        val dispatchLoading = viewportQueue.pendingCount > 0 && viewportQueue.activeCount < viewportCapacity &&
            viewportQueue.registeredCount >= pendingTileCount
        val dispatchDecode = decodeQueue.pendingCount > 0 && decodeQueue.activeCount < decodeCapacity
        if (!dispatchLoading && !dispatchDecode) return

        val projection = runCatching {
            NativeTileProjectionBatch(rc.modelviewProjection.m, rc.viewport, rc.globe)
        }.getOrNull()
        val focus = TileScreenPoint(rc.viewport.width / 2.0, rc.viewport.height / 2.0)
        val rankCache = HashMap<NativeViewportTileKey, Double?>()
        val rank: (NativeViewportTileKey) -> Double? = { key ->
            rankCache.getOrPut(key) {
                viewportDemand.rankForRetained(key, projectedRank(key, projection, focus, rc))
            }
        }
        if (dispatchDecode) decodeQueue.dispatch(rank)
        if (dispatchLoading) viewportQueue.dispatch(rank)
    }

    private fun projectedRank(
        key: NativeViewportTileKey,
        projection: NativeTileProjectionBatch?,
        focus: TileScreenPoint,
        rc: RenderContext,
    ): Double? {
        if (projection == null) return null
        val corners = TileProjectedPriority.mercatorCorners(key.z, key.x, key.sourceY) ?: return null
        fun project(points: List<Pair<Double, Double>>) = points.mapNotNull { (longitude, latitude) ->
            projection.project(latitude, longitude)
        }
        val projectedCorners = project(corners)
        val hull = TileProjectedPriority.convexHull(projectedCorners)
        val polygon = if (projectedCorners.size == 4 && hull.size >= 3) hull else {
            val grid = TileProjectedPriority.mercatorGrid(key.z, key.x, key.sourceY, segmentsPerSide = 3) ?: return null
            TileProjectedPriority.convexHull(project(grid))
        }
        if (!TileProjectedPriority.intersectsViewport(polygon, rc.viewport.width.toDouble(), rc.viewport.height.toDouble())) return null
        return TileProjectedPriority.distanceToQuad(focus, polygon).takeIf { it.isFinite() && it >= 0.0 }
    }

    override fun toRenderables(key: TileKey, tile: MvtTile): List<Renderable> {
        Trace.beginSection(assemblyTraceName)
        return try { super.toRenderables(key, tile) } finally { Trace.endSection() }
    }

    /** Called only by an explicit diagnostics snapshot, never from the render loop. */
    fun appendFrameCost(destination: MutableMap<String, Long>) {
        destination["${metricPrefix}Count"] = renderCount.get()
        destination["${metricPrefix}TotalNanos"] = renderTotalNanos.get()
        destination["${metricPrefix}MaxNanos"] = renderMaxNanos.get()
        destination["${metricPrefix}CachedDecodePending"] = decodeQueue.pendingCount.toLong()
        destination["${metricPrefix}CachedDecodeActive"] = decodeQueue.activeCount.toLong()
        destination["${metricPrefix}PredecodeDroppedCount"] = predecodeDroppedCount.get()
    }

    private fun recordRender(elapsedNanos: Long) {
        val elapsed = elapsedNanos.coerceAtLeast(0L)
        renderCount.incrementAndGet()
        renderTotalNanos.addAndGet(elapsed)
        while (true) {
            val previousMax = renderMaxNanos.get()
            if (elapsed <= previousMax || renderMaxNanos.compareAndSet(previousMax, elapsed)) break
        }
    }
}
