package com.shantu.nativeapp.map

import earth.worldwind.geom.Angle
import earth.worldwind.WorldWind
import earth.worldwind.geom.AltitudeMode
import earth.worldwind.geom.Location
import earth.worldwind.geom.Offset
import earth.worldwind.geom.Position
import earth.worldwind.geom.Sector
import earth.worldwind.geom.Vec3
import earth.worldwind.layer.TiledVectorLayer
import earth.worldwind.layer.mercator.MercatorImageTile
import earth.worldwind.layer.mercator.MercatorSector
import earth.worldwind.layer.mercator.SlippyTiles
import earth.worldwind.layer.mvt.MvtBatchedLineTile
import earth.worldwind.render.AbstractRenderable
import earth.worldwind.render.Color
import earth.worldwind.render.Font
import earth.worldwind.render.RenderContext
import earth.worldwind.render.Renderable
import earth.worldwind.shape.Label
import earth.worldwind.shape.OrientationMode
import earth.worldwind.shape.ShapeAttributes
import earth.worldwind.shape.TextAttributes
import earth.worldwind.util.Level
import earth.worldwind.util.LevelSet
import earth.worldwind.util.Tile
import earth.worldwind.util.TileFactory
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.CancellationException
import java.util.Collections
import java.util.IdentityHashMap
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.PI
import kotlin.math.atan
import kotlin.math.atan2
import kotlin.math.sinh

/** Geographic conversion and vector styling for the legacy XYZ contour tiles. */
internal object NativeContourVectorGeometry {
    const val SOURCE_MIN_ZOOM = 7
    const val SOURCE_MAX_ZOOM = 13
    const val SOURCE_TILE_SIZE = 256
    const val TILE_CACHE_SIZE = 40
    const val NETWORK_CONCURRENCY = 4
    val CONTENT_CACHE_BYTES: Long
        get() = NativeRenderMemoryBudget.contourCapacityBytes(Runtime.getRuntime().maxMemory())
    const val MAX_PREPARED_TILES = 2
    const val ADMIT_BYTES_PER_FRAME = 2 * 1024 * 1024
    const val MINOR_WIDTH = 0.45f
    const val MAJOR_WIDTH = 1.05f
    const val LINE_OPACITY = 0.8f
    const val LABEL_SIZE = 11f
    const val LABEL_HALO_WIDTH = 2.8f
    const val LABEL_SPACING_PIXELS = 210f
    const val MAX_VISIBLE_LABELS = 80

    fun levelSet(): LevelSet {
        val world = MercatorSector()
        // Generic root assembly asks tileOrigin.computeRow at the world boundary.
        // MercatorSector reprojects -85.0511287798066 to -1.0000000000000002,
        // whose floor becomes row -1. A geographic copy gives an exact zero
        // boundary difference; the factory restores MercatorSector before refinement.
        return LevelSet(world, Sector(world), Location(world.deltaLatitude, world.deltaLongitude),
        // Keep one non-source sentinel level so effectiveDetailControl can observe current z13
        // leaves. The layer returns an effectively infinite detail factor there, preserving the
        // same terminal source level without ever requesting fabricated z14 data.
        SOURCE_MAX_ZOOM + 2, SOURCE_TILE_SIZE, SOURCE_TILE_SIZE, SOURCE_MIN_ZOOM)
    }

    val tileFactory = object : TileFactory {
        override val contentType = "Shantu contour vector quadtree"
        // TiledVectorLayer uses generic Tile.assembleTilesForLevel for its roots:
        // those sectors are plain Sector, while subdivided children are MercatorSector.
        // Match the SDK MercatorTiledVectorLayer factory for BOTH entry paths.
        override fun createTile(sector: Sector, level: Level, row: Int, column: Int): Tile =
            MercatorImageTile(sector as? MercatorSector ?: MercatorSector.fromSector(sector), level, row, column)
    }

    /** Converts local top-left-origin XYZ tile pixels to WGS84 without treating Mercator Y as latitude. */
    fun tilePixelPosition(z: Int, x: Int, y: Int, pixelX: Double, pixelY: Double, tileSize: Int = SOURCE_TILE_SIZE): Position {
        require(z in 0..SOURCE_MAX_ZOOM && tileSize > 0)
        val count = 1 shl z
        require(x in 0 until count && y in 0 until count)
        require(pixelX.isFinite() && pixelY.isFinite())
        // DEM tile values sample pixel centers, including the z=13 parent overzoom.
        val mercatorX = (x + (pixelX + 0.5) / tileSize) / count
        val mercatorY = (y + (pixelY + 0.5) / tileSize) / count
        val longitude = mercatorX * 360.0 - 180.0
        val latitude = Math.toDegrees(atan(sinh(PI * (1.0 - 2.0 * mercatorY))))
        return Position.fromDegrees(latitude, longitude, 0.0)
    }

    fun contourColor(elevationMeters: Int, interval: Int): Color =
        Color(NativeTerrainOverlayMath.elevationColor(elevationMeters.toDouble(), interval)).apply { alpha = LINE_OPACITY }

    fun contourWidth(elevationMeters: Int, interval: Int): Float =
        if (Math.floorMod(elevationMeters / interval, 5) == 0) MAJOR_WIDTH else MINOR_WIDTH
}

/** A WorldWind vector layer using the same bounded DEM sampler as terrain/elevation colors. */
internal class NativeContourLayer(
    intervalMeters: Int,
    /** UI zoom visibility, not the SDK's source-level fetch floor. */
    private val minimumZoom: Int,
    private val loadSamples: suspend (z: Int, x: Int, y: Int) -> DoubleArray?,
) : TiledVectorLayer<NativeContourTileContent>(
    levelSet = NativeContourVectorGeometry.levelSet(),
    tileFactory = NativeContourVectorGeometry.tileFactory,
    maxLoadedTiles = NativeContourVectorGeometry.TILE_CACHE_SIZE,
    maxConcurrentFetches = NativeContourVectorGeometry.NETWORK_CONCURRENCY,
    displayName = "等高线",
    maxLoadedTileBytes = NativeContourVectorGeometry.CONTENT_CACHE_BYTES,
    maxTileAdmitWeightPerFrame = NativeContourVectorGeometry.ADMIT_BYTES_PER_FRAME,
) {
    private val interval = intervalMeters.also { require(it in NativeTerrainOverlayMath.INTERVALS) }
    @Volatile private var closed = false
    private data class ViewStyle(val zoom: Double, val cssScale: Float, val focusPx: TileScreenPoint? = null)
    /** Keeps the XYZ sample row and the SDK's cache/invalidation row together. */
    private data class TileRequest(val z: Int, val x: Int, val sourceY: Int, val sdkRow: Int)
    @Volatile private var viewStyle = ViewStyle(Double.NaN, 1f)
    // The SDK's completed-results channel is unbounded. The local queue stays bounded through
    // content admission; a separate process lane bounds only concurrent DEM/geometry assembly.
    private val generationQueue = NativeContourPriorityQueue<TileRequest>(
        NativeContourVectorGeometry.MAX_PREPARED_TILES, maxPendingFetches,
    ) { if (!closed) WorldWind.requestRedraw() }
    // Tracks each pane's wrapper until eviction/close even when the SDK has no latest RenderContext.
    private val owned = Collections.newSetFromMap(IdentityHashMap<NativeContourTileContent, Boolean>())
    private val prepared = Collections.newSetFromMap(IdentityHashMap<NativeContourTileContent, Boolean>())
    private val forcedRefinements = NativeContourRefinementState<TileRequest>()
    // Filled only by the SDK's current visible quadtree walk. Pending, unstarted jobs outside
    // this set are obsolete; active work and resident content are deliberately unaffected.
    private val visitedThisFrame = linkedSetOf<TileRequest>()
    private val labelCollision = NativeContourLabelCollision()
    private val cartesian = Vec3()
    private val screen = Vec3()

    init { require(minimumZoom in 0..24) }

    override val coarseAncestorFallback get() = false

    /** UI zoom and CSS/native-pixel scale come from the same actual frame as the React map. */
    fun setViewportStyle(uiZoom: Double, cssScale: Float): Boolean {
        if (!uiZoom.isFinite() || !cssScale.isFinite() || cssScale <= 0f) return false
        val previous = viewStyle
        if (previous.zoom.isFinite() && kotlin.math.abs(previous.zoom - uiZoom) < .001 &&
            kotlin.math.abs(previous.cssScale - cssScale) < .0001f &&
            (previous.zoom >= minimumZoom) == (uiZoom >= minimumZoom)) return false
        viewStyle = previous.copy(zoom = uiZoom, cssScale = cssScale)
        return true
    }

    /** View-relative physical pixels. Null means the real viewport centre. */
    fun setPriorityFocus(focusPx: TileScreenPoint?): Boolean {
        if (focusPx != null && (!focusPx.x.isFinite() || !focusPx.y.isFinite())) return false
        val previous = viewStyle
        val current = previous.focusPx
        if (current == focusPx || current != null && focusPx != null &&
            kotlin.math.abs(current.x - focusPx.x) < .25 && kotlin.math.abs(current.y - focusPx.y) < .25) return false
        viewStyle = previous.copy(focusPx = focusPx)
        return true
    }

    private fun visibleAtUiZoom(): Boolean = viewStyle.zoom.isFinite() && viewStyle.zoom >= minimumZoom

    override fun render(rc: RenderContext) {
        if (closed || rc.isPickMode) return
        // UI-hidden contours have no current SDK selection. Drop only queued, not-yet-permitted
        // requests so they cannot consume admission slots until the user returns to this layer.
        if (!visibleAtUiZoom()) {
            pruneUnvisitedPending(emptySet())
            return
        }
        forcedRefinements.advanceFrame()
        super.render(rc)
    }

    override fun effectiveDetailControl(rc: RenderContext, tile: Tile): Double {
        val z = tile.level.levelNumber
        val key = TileRequest(z, tile.column,
            SlippyTiles.latToTileY(tile.sector.centroidLatitude.inDegrees, z), tile.row)
        visitedThisFrame += key
        // LevelSet.levelOffset only suppresses fetches; it does not force subdivision. Without
        // this, an SSE leaf below z7 can remain a permanent blank despite a visible UI layer.
        if (z < NativeContourVectorGeometry.SOURCE_MIN_ZOOM) return 0.0
        // z13 used to be the SDK terminal level, bypassing this hook. Its sentinel child level is
        // never reached: a huge detail factor reproduces the old terminal behavior while exposing
        // the real z13 tile to the current-view visit set.
        if (z >= NativeContourVectorGeometry.SOURCE_MAX_ZOOM) return Double.POSITIVE_INFINITY
        // Keep the original interval and DEM. An oversized coarse tile is calculated
        // as smaller real tiles instead of assembling one enormous SDK float array.
        return if (z < NativeContourVectorGeometry.SOURCE_MAX_ZOOM && forcedRefinements.shouldRefine(key)) 0.0 else detailControl
    }

    /** Clone configuration only; every copy owns a fresh SDK tile cache, scope and fetch jobs. */
    override fun clone(): NativeContourLayer = NativeContourLayer(interval, minimumZoom, loadSamples).also { copy ->
        copy.displayName = displayName
        copy.isEnabled = isEnabled
        copy.isPickEnabled = isPickEnabled
        copy.isDynamic = isDynamic
        copy.opacity = opacity
        copy.minActiveAltitude = minActiveAltitude
        copy.maxActiveAltitude = maxActiveAltitude
        copy.detailControl = detailControl
        val current = viewStyle
        copy.setViewportStyle(current.zoom, current.cssScale)
        copy.setPriorityFocus(current.focusPx)
    }

    public override suspend fun loadTileContent(z: Int, x: Int, y: Int, sector: Sector): NativeContourTileContent? {
        if (closed || z !in NativeContourVectorGeometry.SOURCE_MIN_ZOOM..NativeContourVectorGeometry.SOURCE_MAX_ZOOM) return null
        // The SDK quadtree row grows from south to north, while DEM/contour XYZ Y
        // grows from north to south. Derive the source row from the actual sector
        // instead of flipping an SDK row whose convention may change by version.
        val sourceY = SlippyTiles.latToTileY(sector.centroidLatitude.inDegrees, z)
        val request = TileRequest(z, x, sourceY, y)
        val permit = generationQueue.acquire(request) ?: return null
        var handedOff = false
        var unhandedContent: NativeContourTileContent? = null
        try {
            return semaphore.withPermit {
                if (closed) return@withPermit null
                // This suspends fairly across panes before samples/geometry are allocated, but
                // releases as soon as assembly returns. A prepared result may wait for contentWeight
                // in a hidden layer without monopolizing the process-wide CPU assembly lane.
                val content = NativeContourProcessBudget.process.withAssemblyPermit {
                    if (closed) return@withAssemblyPermit null
                    val samples = loadSamples(z, x, sourceY) ?: return@withAssemblyPermit null
                    if (closed) return@withAssemblyPermit null
                    val buildContext = currentCoroutineContext()
                    try {
                        val key = NativeContourGeometryKey.fromSamples(z, x, sourceY, interval, samples)
                        buildContext.ensureActive()
                        if (closed) throw CancellationException("Contour layer closed")
                        val lease = NativeContourSharedGeometryStore.process.acquireOrCreate(key) {
                            NativeContourVectorTileBuilder.build(samples, z, x, sourceY, interval) {
                                buildContext.ensureActive()
                                if (closed) throw CancellationException("Contour layer closed")
                            }
                        }
                        try {
                            NativeContourTileContent(lease) { permit.close() }
                        } catch (failure: Throwable) {
                            lease.release()
                            throw failure
                        }
                    } catch (budget: NativeContourGeometryBudgetExceeded) {
                        val canSubdivide = z < NativeContourVectorGeometry.SOURCE_MAX_ZOOM
                        val refined = canSubdivide && forcedRefinements.requestRefinement(request) { !closed }
                        NativeContourGeometryTelemetry.rejected(z, refined, !canSubdivide)
                        if (refined && !closed) WorldWind.requestRedraw()
                        return@withAssemblyPermit null
                    }
                } ?: return@withPermit null
                unhandedContent = content
                val retained = synchronized(prepared) {
                    if (closed) false else {
                        try {
                            owned += content
                            prepared += content
                            true
                        } catch (failure: Throwable) {
                            owned.remove(content)
                            prepared.remove(content)
                            throw failure
                        }
                    }
                }
                if (!retained) {
                    content.discard(latestRc)
                    unhandedContent = null
                    return@withPermit null
                }
                handedOff = true
                unhandedContent = null
                content
            }
        } finally {
            if (!handedOff) {
                try { unhandedContent?.discard(latestRc) } finally { permit.close() }
            }
        }
    }

    override fun contentWeight(content: NativeContourTileContent): Int {
        synchronized(prepared) { prepared.remove(content) }
        content.admitted()
        return content.byteWeight
    }

    override fun beginFrame(rc: RenderContext) {
        visitedThisFrame.clear()
        labelCollision.beginFrame()
    }

    override fun endFrame(rc: RenderContext) {
        // The SDK invokes effectiveDetailControl only after its private isVisible check. Prune
        // after traversal so parents and leaves in this actual cut remain eligible, then award
        // permits only to requests still represented by that cut.
        pruneUnvisitedPending(visitedThisFrame)
        dispatchGeneration(rc)
    }

    private fun pruneUnvisitedPending(visited: Set<TileRequest>) {
        if (closed) return
        generationQueue.removePendingNotIn(visited) { tile ->
            // SDK requestTile starts a job only after contentFor misses and deduplicates the same
            // tileKey in inFlight. Thus this exact cache key cannot also be resident while its
            // coroutine waits here. drainInvalidations removes/cancels only that SDK job next
            // frame; permit-owning work and all unrelated resident tiles remain untouched.
            invalidateTile(tile.z, tile.x, tile.sdkRow)
        }
    }

    private fun dispatchGeneration(rc: RenderContext) {
        if (closed || generationQueue.pendingCount == 0 ||
            generationQueue.activeCount >= NativeContourVectorGeometry.MAX_PREPARED_TILES) return
        // All SDK jobs from this cut must register before any generation slot is awarded.
        // Otherwise the first edge coroutine could win before the centre job even registers.
        if (generationQueue.registeredCount < pendingTileCount) return
        val focus = viewStyle.focusPx ?: TileScreenPoint(rc.viewport.width / 2.0, rc.viewport.height / 2.0)
        generationQueue.dispatch { tile -> projectedPriority(rc, tile, focus) }
    }

    private fun projectedPriority(rc: RenderContext, tile: TileRequest, focus: TileScreenPoint): Double? {
        fun project(points: List<Pair<Double, Double>>): List<TileScreenPoint> = points.mapNotNull { (lon, lat) ->
            rc.geographicToCartesian(Position.fromDegrees(lat, lon, 0.0), AltitudeMode.CLAMP_TO_GROUND, cartesian)
            if (!rc.projectWithDepth(cartesian, 0.0, screen)) null
            else TileScreenPoint(screen.x - rc.viewport.x, rc.viewport.height - (screen.y - rc.viewport.y))
        }
        val corners = TileProjectedPriority.mercatorCorners(tile.z, tile.x, tile.sourceY) ?: return null
        val projectedCorners = project(corners)
        val cornerHull = TileProjectedPriority.convexHull(projectedCorners)
        val polygon = if (projectedCorners.size == 4 && cornerHull.size >= 3) cornerHull else {
            val grid = TileProjectedPriority.mercatorGrid(tile.z, tile.x, tile.sourceY, 3) ?: return null
            TileProjectedPriority.convexHull(project(grid))
        }
        if (!TileProjectedPriority.intersectsViewport(polygon, rc.viewport.width.toDouble(), rc.viewport.height.toDouble())) return null
        return TileProjectedPriority.distanceToQuad(focus, polygon)
    }

    override fun renderTileContent(rc: RenderContext, content: NativeContourTileContent) {
        if (rc.isPickMode) return // Contours are visual overlays, not pick targets.
        val geometry = content.geometryIfActive() ?: return
        synchronized(geometry.renderLock) {
            // Close/eviction may win between taking the snapshot and entering this lock.
            if (!content.ownsGeometry(geometry)) return
            val cssScale = viewStyle.cssScale
            geometry.renderables.forEach { renderable ->
                NativeContourVectorTileBuilder.applyScreenDensity(renderable, cssScale)
                if (renderable is Label) {
                    rc.geographicToCartesian(renderable.position, AltitudeMode.CLAMP_TO_GROUND, cartesian)
                    if (!rc.projectWithDepth(cartesian, 0.0, screen)) return@forEach
                    val density = cssScale.coerceAtLeast(0.1f)
                    val width = (renderable.text.orEmpty().length * NativeContourVectorGeometry.LABEL_SIZE * 0.62f + 10f) * density
                    val height = 22f * density
                    if (screen.x < rc.viewport.x || screen.x > rc.viewport.x + rc.viewport.width ||
                        screen.y < rc.viewport.y || screen.y > rc.viewport.y + rc.viewport.height ||
                        !labelCollision.accept(screen.x.toFloat(), screen.y.toFloat(), width, height)) return@forEach
                }
                renderable.render(rc)
            }
        }
    }

    override fun onContentEvicted(rc: RenderContext, content: NativeContourTileContent) {
        synchronized(prepared) { owned.remove(content) }
        content.admitted()
        content.releaseGeometry(rc)
    }

    override fun closeSource() {
        closed = true
        visitedThisFrame.clear()
        forcedRefinements.clear()
        generationQueue.close()
        synchronized(prepared) {
            val outstanding = owned.toList()
            owned.clear()
            prepared.clear()
            outstanding.forEach { it.discard(latestRc) }
        }
    }
}

/** AbstractRenderable adapter because the SDK tile layer is a Layer, not a Renderable. */
internal class NativeContourLayerRenderable(private val layer: NativeContourLayer) : AbstractRenderable("等高线") {
    override fun doRender(rc: RenderContext) = layer.render(rc)
    fun setViewportStyle(uiZoom: Double, cssScale: Float): Boolean = layer.setViewportStyle(uiZoom, cssScale)
    fun setPriorityFocus(focusPx: TileScreenPoint?): Boolean = layer.setPriorityFocus(focusPx)
    fun close() = layer.close()
}

/** One lease-shared tile geometry with one batched line buffer instead of one Path per contour. */
internal class NativeContourSharedGeometry(
    val renderables: List<Renderable>,
    val batch: MvtBatchedLineTile?,
    val sourcePathCount: Int,
    val sourcePointCount: Int,
    val geometryBounds: Sector,
    val byteWeight: Int,
) : List<Renderable> by renderables {
    /** SDK batch and Label style fields are mutable per frame; panes serialize their use here. */
    val renderLock = Any()
}

internal object NativeContourSharedGeometryStore {
    val process = NativeContourGeometryStore<NativeContourGeometryKey, NativeContourSharedGeometry>()
}

internal class NativeContourTileContent(
    private val geometryLease: NativeContourGeometryStore.Lease<NativeContourSharedGeometry>,
    private val releasePrepared: () -> Unit = {},
) : AbstractList<Renderable>() {
    private val cachedByteWeight = geometryLease.value.byteWeight
    override val size: Int get() = geometryLease.value.renderables.size
    override fun get(index: Int): Renderable = geometryLease.value.renderables[index]
    val geometry get() = geometryLease.value
    val batch get() = geometry.batch
    val sourcePathCount get() = geometry.sourcePathCount
    val sourcePointCount get() = geometry.sourcePointCount
    val geometryBounds get() = geometry.geometryBounds
    // The SDK may finish admitting an already-queued result while close is racing; keep only this scalar.
    val byteWeight get() = cachedByteWeight
    private val admissionReleased = AtomicBoolean(false)
    private val geometryReleased = AtomicBoolean(false)

    fun admitted() { if (admissionReleased.compareAndSet(false, true)) releasePrepared() }
    fun releaseGeometry(rc: RenderContext? = null): Boolean {
        val shared = geometryLease.valueIfActive() ?: return false
        synchronized(shared.renderLock) {
            if (!geometryReleased.compareAndSet(false, true)) return false
            // Release under the same lock as rendering; this local is the only temporary strong reference.
            val last = geometryLease.release()
            if (last && rc != null) shared.batch?.releaseRenderResources(rc)
            return last
        }
    }
    fun geometryIfActive(): NativeContourSharedGeometry? = geometryLease.valueIfActive()
    fun ownsGeometry(value: NativeContourSharedGeometry): Boolean =
        !geometryReleased.get() && geometryLease.valueIfActive() === value
    fun discard(rc: RenderContext?) {
        admitted()
        releaseGeometry(rc)
    }
}

/** Screen-space collision is independent of data density: all contour lines remain rendered. */
internal class NativeContourLabelCollision(private val maximumLabels: Int = NativeContourVectorGeometry.MAX_VISIBLE_LABELS) {
    private val boxes = FloatArray(maximumLabels * 4)
    private var count = 0
    fun beginFrame() { count = 0 }
    fun accept(x: Float, y: Float, width: Float, height: Float): Boolean {
        if (count >= maximumLabels) return false
        val left = x - width * 0.5f
        val right = x + width * 0.5f
        val bottom = y - height * 0.5f
        val top = y + height * 0.5f
        for (i in 0 until count) {
            val offset = i * 4
            if (left < boxes[offset + 2] && right > boxes[offset] &&
                bottom < boxes[offset + 3] && top > boxes[offset + 1]) return false
        }
        val offset = count++ * 4
        boxes[offset] = left
        boxes[offset + 1] = bottom
        boxes[offset + 2] = right
        boxes[offset + 3] = top
        return true
    }
}

/** Converts every stitched contour vertex to one batched surface-line tile without simplification. */
internal object NativeContourVectorTileBuilder {
    fun applyScreenDensity(renderable: Renderable, densityFactor: Float) {
        if (!densityFactor.isFinite() || densityFactor <= 0f) return
        when (renderable) {
            is MvtBatchedLineTile -> renderable.widthScale = densityFactor
            is Label -> renderable.attributes.scale = densityFactor.toDouble()
        }
    }

    fun build(values: DoubleArray, z: Int, x: Int, y: Int, interval: Int,
        ensureActive: () -> Unit = {},
    ): NativeContourSharedGeometry {
        require(values.isNotEmpty())
        val size = kotlin.math.sqrt(values.size.toDouble()).toInt()
        require(size >= 2 && size * size == values.size)
        val segments = NativeTerrainOverlayMath.contourSegments(values, size, interval, ensureActive)
        if (segments.isEmpty()) return NativeContourSharedGeometry(emptyList(), null, 0, 0, Sector(), 256)
        val paths = NativeTerrainOverlayMath.contourPaths(segments, ensureActive)
        val logicalVertices = NativeContourGeometryBudget.preflight(paths, ensureActive)
        val labels = NativeTerrainOverlayMath.contourLabelsForPaths(paths, interval, NativeContourVectorGeometry.LABEL_SPACING_PIXELS, ensureActive)
        val output = ArrayList<Renderable>(1 + labels.size)
        val features = ArrayList<MvtBatchedLineTile.BatchLineFeature>(paths.size)
        var minLatitude = Double.POSITIVE_INFINITY
        var maxLatitude = Double.NEGATIVE_INFINITY
        var minLongitude = Double.POSITIVE_INFINITY
        var maxLongitude = Double.NEGATIVE_INFINITY
        var sourcePointCount = 0
        val lineAttributes = HashMap<Int, ShapeAttributes>()
        for (contour in paths) {
            ensureActive()
            if (contour.points.size < 2) continue
            val attributes = lineAttributes.getOrPut(contour.elevationMeters) {
                ShapeAttributes().apply {
                    isDrawInterior = false
                    isDrawOutline = true
                    isDrawVerticals = false
                    isDepthTest = false
                    isPickOutline = false
                    outlineColor = NativeContourVectorGeometry.contourColor(contour.elevationMeters, interval)
                    outlineWidth = NativeContourVectorGeometry.contourWidth(contour.elevationMeters, interval)
                }
            }
            val coords = DoubleArray(contour.points.size * 2)
            contour.points.forEachIndexed { index, point ->
                val position = NativeContourVectorGeometry.tilePixelPosition(z, x, y, point.first.toDouble(), point.second.toDouble(), size)
                coords[index * 2] = position.longitude.inDegrees
                coords[index * 2 + 1] = position.latitude.inDegrees
                minLatitude = minOf(minLatitude, position.latitude.inDegrees)
                maxLatitude = maxOf(maxLatitude, position.latitude.inDegrees)
                minLongitude = minOf(minLongitude, position.longitude.inDegrees)
                maxLongitude = maxOf(maxLongitude, position.longitude.inDegrees)
            }
            sourcePointCount += contour.points.size
            features += MvtBatchedLineTile.BatchLineFeature(coords, attributes)
        }
        val batch = MvtBatchedLineTile(features, SlippyTiles.tileToSector(z, x, y), "等高线批量线").apply {
            isPickEnabled = false
            assemble(null) // Pure degree-space assembly off the UI thread; frees source coordinate arrays.
        }
        NativeContourGeometryTelemetry.accepted(logicalVertices)
        output += batch
        labels.forEach { point ->
                val attributes = TextAttributes().apply {
                    font = Font(NativeContourVectorGeometry.LABEL_SIZE)
                    textOffset = Offset.center()
                    textColor = Color(0xfffff1c9.toInt())
                    outlineColor = Color(0xff1a3034.toInt())
                    outlineWidth = NativeContourVectorGeometry.LABEL_HALO_WIDTH
                    isOutlineEnabled = true
                    isDepthTest = false
                }
                output += Label(
                    NativeContourVectorGeometry.tilePixelPosition(z, x, y, point.x.toDouble(), point.y.toDouble(), size),
                    "${point.elevationMeters} m",
                    attributes,
                ).apply {
                    altitudeMode = AltitudeMode.CLAMP_TO_GROUND
                    rotation = Angle.fromDegrees(point.rotationDegrees.toDouble())
                    rotationMode = OrientationMode.RELATIVE_TO_GLOBE
                    isAlwaysOnTop = true
                    isPickEnabled = false
                }
            }
        // SDK arrays are exact after assembly. Account conservatively for retained feature,
        // style and label objects as well as those arrays, rather than counting dense tiles as one.
        val byteWeight = (batch.gpuByteEstimate.toLong() + features.size * 192L + labels.size * 1536L + 512L)
            .coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
        val geometryBounds = if (sourcePointCount == 0) Sector() else Sector.fromDegrees(
            minLatitude, minLongitude, maxLatitude - minLatitude, maxLongitude - minLongitude,
        )
        return NativeContourSharedGeometry(output, batch, features.size, sourcePointCount, geometryBounds, byteWeight)
    }
}
