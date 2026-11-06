package com.shantu.nativeapp.floating

import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Color
import android.os.SystemClock
import com.shantu.nativeapp.map.NativeContourSegment
import com.shantu.nativeapp.map.NativeContourVectorGeometry
import java.util.ArrayDeque
import java.util.LinkedHashMap
import kotlin.math.*

/** Immutable source snapshot. The renderer reads but never mutates [heights]. */
internal data class FloatingTerrainTile(
    val z: Int,
    val x: Int,
    val y: Int,
    val side: Int,
    val heights: DoubleArray,
)

/** A revision changes whenever any tile or height array is replaced. */
internal data class FloatingTerrainScene(val tiles: List<FloatingTerrainTile>, val revision: Long)

/** One sample cell around a four-tile junction, ordered NW, NE, SE, SW. */
internal data class FloatingTerrainJunctionCell(
    val northwest: FloatingTerrainTile,
    val northeast: FloatingTerrainTile,
    val southeast: FloatingTerrainTile,
    val southwest: FloatingTerrainTile,
    val northwestIndex: Int,
    val northeastIndex: Int,
    val southeastIndex: Int,
    val southwestIndex: Int,
) {
    fun heightsOrNull(): DoubleArray? {
        val values = doubleArrayOf(
            northwest.heights[northwestIndex], northeast.heights[northeastIndex],
            southeast.heights[southeastIndex], southwest.heights[southwestIndex],
        )
        return values.takeIf { corners -> corners.all { it.isFinite() } }
    }
}

/** Enumerates only complete center-sample quads; missing tiles never get synthesized. */
internal object FloatingTerrainJunctionMath {
    fun cells(tiles: List<FloatingTerrainTile>): List<FloatingTerrainJunctionCell> {
        val valid = tiles.filter { tile ->
            tile.z in 13..16 && tile.side >= 2 && tile.heights.size == tile.side * tile.side &&
                tile.x in 0 until (1 shl tile.z) && tile.y in 0 until (1 shl tile.z)
        }
        val byTile = valid.associateBy { Triple(it.z, it.x, it.y) }
        val cells = ArrayList<FloatingTerrainJunctionCell>()
        valid.forEach { northwest ->
            val z = northwest.z
            val count = 1 shl z
            val x = northwest.x
            val y = northwest.y
            val side = northwest.side
            val northeast = byTile[Triple(z, (x + 1) % count, y)] ?: return@forEach
            val southwest = byTile[Triple(z, x, y + 1)] ?: return@forEach
            val southeast = byTile[Triple(z, (x + 1) % count, y + 1)] ?: return@forEach
            if (northeast.side != side || southwest.side != side || southeast.side != side) return@forEach
            cells += FloatingTerrainJunctionCell(
                northwest, northeast, southeast, southwest,
                (side - 1) * side + (side - 1), // NW bottom-right
                (side - 1) * side, // NE bottom-left
                0, // SE top-left
                side - 1, // SW top-right
            )
        }
        return cells
    }
}

/** Contours follow the same NW-SE triangle split as the depth mesh. */
internal object FloatingTerrainMeshMath {
    private data class Vertex(val x: Double, val y: Double, val height: Double)

    fun contourSegments(values: DoubleArray, side: Int, interval: Int): List<NativeContourSegment> {
        require(side >= 2 && values.size == side * side && interval > 0)
        val segments = ArrayList<NativeContourSegment>()
        var candidates = 0
        loop@ for (row in 0 until side - 1) for (column in 0 until side - 1) {
            val aIndex = row * side + column
            val bIndex = aIndex + 1
            val dIndex = (row + 1) * side + column
            val cIndex = dIndex + 1
            val a = Vertex(column.toDouble(), row.toDouble(), values[aIndex])
            val b = Vertex((column + 1).toDouble(), row.toDouble(), values[bIndex])
            val c = Vertex((column + 1).toDouble(), (row + 1).toDouble(), values[cIndex])
            val d = Vertex(column.toDouble(), (row + 1).toDouble(), values[dIndex])
            if (listOf(a, b, c, d).any { !it.height.isFinite() }) continue
            if (appendTriangleContours(segments, a, b, c, interval, candidates) { candidates = it } ||
                appendTriangleContours(segments, a, c, d, interval, candidates) { candidates = it }) break@loop
        }
        return segments
    }

    /** Returns true when the per-tile geometry budget is exhausted. */
    private fun appendTriangleContours(
        output: MutableList<NativeContourSegment>,
        a: Vertex,
        b: Vertex,
        c: Vertex,
        interval: Int,
        candidatesBefore: Int,
        setCandidates: (Int) -> Unit,
    ): Boolean {
        val minimum = min(a.height, min(b.height, c.height))
        val maximum = max(a.height, max(b.height, c.height))
        if (maximum - minimum <= LEVEL_EPSILON) return false
        var level = ceil(minimum / interval) * interval
        val last = floor(maximum / interval) * interval
        var candidates = candidatesBefore
        while (level <= last) {
            if (++candidates > MAX_CANDIDATES_PER_TILE || output.size >= MAX_SEGMENTS_PER_TILE) {
                setCandidates(candidates)
                return true
            }
            val points = ArrayList<Pair<Double, Double>>(3)
            addEdgeIntersection(points, a, b, level)
            addEdgeIntersection(points, b, c, level)
            addEdgeIntersection(points, c, a, level)
            val distinct = ArrayList<Pair<Double, Double>>(3)
            points.forEach { point ->
                if (distinct.none { hypot(it.first - point.first, it.second - point.second) <= POINT_EPSILON }) distinct += point
            }
            if (distinct.size == 2) {
                val first = distinct[0]
                val second = distinct[1]
                output += NativeContourSegment(first.first.toFloat(), first.second.toFloat(),
                    second.first.toFloat(), second.second.toFloat(), level.roundToInt())
            }
            level += interval
        }
        setCandidates(candidates)
        return false
    }

    private fun addEdgeIntersection(points: MutableList<Pair<Double, Double>>, first: Vertex, second: Vertex, level: Double) {
        val a = first.height
        val b = second.height
        if (abs(a - b) <= LEVEL_EPSILON) {
            if (abs(a - level) <= LEVEL_EPSILON) {
                points += first.x to first.y
                points += second.x to second.y
            }
            return
        }
        if (level < min(a, b) - LEVEL_EPSILON || level > max(a, b) + LEVEL_EPSILON) return
        val t = ((level - a) / (b - a)).coerceIn(0.0, 1.0)
        points += (first.x + (second.x - first.x) * t) to (first.y + (second.y - first.y) * t)
    }

    private const val LEVEL_EPSILON = 1e-9
    private const val POINT_EPSILON = 1e-7
    private const val MAX_CANDIDATES_PER_TILE = 200_000
    private const val MAX_SEGMENTS_PER_TILE = 24_000
}

/** Canvas renderer for the compact floating and lock-screen maps; it owns no GL resources. */
internal class FloatingContourTerrainRenderer {
    private data class GeoPoint(val east: Double, val north: Double, val height: Double)
    private data class ProjectedPoint(val x: Double, val y: Double, val depth: Double)
    private data class TileGeometry(
        val source: FloatingTerrainTile,
        val longitudes: DoubleArray,
        val latitudes: DoubleArray,
        val contours: List<NativeContourSegment>,
        val finiteHeights: DoubleArray,
    )
    private data class WorldContourLine(val a: FloatingCoordinate, val b: FloatingCoordinate, val elevationMeters: Int)
    private data class SceneGeometry(
        val revision: Long,
        val tiles: List<TileGeometry>,
        val seamContours: List<WorldContourLine>,
        val contourInterval: Int,
    )
    private data class BoundsKey(val left: Int, val top: Int, val width: Int, val height: Int)
    private data class FrameKey(
        val revision: Long,
        val latCell: Long,
        val lonCell: Long,
        val zoom: Int,
        val bearing: Int,
        val routeRef: Int,
        val recordingRef: Int,
        val routeColor: Int,
    )
    private data class PreparedFrame(
        val key: FrameKey,
        val nearMinorContours: Path,
        val nearMajorContours: Path,
        val midMajorContours: Path,
        val farMajorContours: Path,
        val route: Path,
        val recorded: Path,
        val hasTerrain: Boolean,
        val preparedAt: Long,
    )
    private data class TrackPathResult(val path: Path, val usedSamples: Int)

    private val contourPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.BUTT
        strokeJoin = Paint.Join.ROUND
        color = OUTDOOR_CONTOUR_COLOR
    }
    private val routePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }
    private val recordedPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
        color = RECORDED_TRACK_COLOR
        strokeWidth = 2f
    }
    private val blackPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.BLACK; style = Paint.Style.FILL }
    private var cachedScene: SceneGeometry? = null
    internal var lastFrameHasTerrain: Boolean = false
        private set
    /** Two differently-sized panes can share this renderer and the prepared source geometry. */
    private val preparedByBounds = object : LinkedHashMap<BoundsKey, PreparedFrame>(2, .75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<BoundsKey, PreparedFrame>?): Boolean = size > MAX_VIEW_CACHES
    }

    @Synchronized
    fun draw(
        canvas: Canvas,
        bounds: RectF,
        scene: FloatingTerrainScene,
        center: FloatingCoordinate,
        zoom: Int,
        mapBearing: Double,
        route: List<FloatingCoordinate>,
        recordedSegments: List<List<FloatingCoordinate>>,
        routeColor: Int,
    ) {
        if (bounds.width() <= 0f || bounds.height() <= 0f) return
        val saveCount = canvas.save()
        canvas.clipRect(bounds)
        canvas.drawRect(bounds, blackPaint)

        val geometry = sceneGeometry(scene)
        val centerIsValid = center.longitude.isFinite() && center.latitude.isFinite() && center.latitude in -90.0..90.0
        val safeCenter = FloatingCoordinate(
            center.longitude.takeIf { it.isFinite() }?.let(::wrapLongitude) ?: 0.0,
            center.latitude.takeIf { it.isFinite() }?.coerceIn(-MAX_MERCATOR_LAT, MAX_MERCATOR_LAT) ?: 0.0,
        )
        val safeZoom = zoom.coerceIn(MIN_CAMERA_ZOOM, MAX_CAMERA_ZOOM)
        val bearing = mapBearing.takeIf { it.isFinite() } ?: 0.0
        val key = frameKey(geometry.revision, safeCenter, safeZoom, bearing, route, recordedSegments, routeColor)
        val boundsKey = boundsKey(bounds)
        val now = SystemClock.uptimeMillis()
        val prior = preparedByBounds[boundsKey]
        val heightSampler = FloatingTerrainHeightSampler(geometry.tiles.map { it.source })
        val centerHeight = if (centerIsValid) heightSampler.sample(safeCenter.longitude, safeCenter.latitude) else null
        val prepared = when {
            centerHeight == null -> if (prior != null && prior.key == key && !prior.hasTerrain) prior else
                prepareFrame(bounds, geometry, safeCenter, safeZoom, bearing, route, recordedSegments, routeColor,
                    heightSampler, null, key, now).also { preparedByBounds[boundsKey] = it }
            prior?.key == key -> prior
            prior != null && canThrottleTo(prior.key, key) && now - prior.preparedAt < PREPARE_INTERVAL_MS -> prior
            else -> prepareFrame(bounds, geometry, safeCenter, safeZoom, bearing, route, recordedSegments, routeColor,
                heightSampler, centerHeight, key, now)
                .also { preparedByBounds[boundsKey] = it }
        }
        lastFrameHasTerrain = prepared.hasTerrain

        contourPaint.strokeWidth = 1f
        contourPaint.alpha = 255; contourPaint.strokeWidth = MINOR_CONTOUR_WIDTH_PX
        canvas.drawPath(prepared.nearMinorContours, contourPaint)
        contourPaint.strokeWidth = MAJOR_CONTOUR_WIDTH_PX
        canvas.drawPath(prepared.nearMajorContours, contourPaint)
        contourPaint.alpha = MID_CONTOUR_ALPHA
        canvas.drawPath(prepared.midMajorContours, contourPaint)
        contourPaint.alpha = FAR_CONTOUR_ALPHA
        canvas.drawPath(prepared.farMajorContours, contourPaint)
        contourPaint.alpha = 255
        routePaint.color = routeColor
        routePaint.strokeWidth = 3f
        canvas.drawPath(prepared.route, routePaint)
        canvas.drawPath(prepared.recorded, recordedPaint)
        canvas.restoreToCount(saveCount)
    }

    private fun sceneGeometry(scene: FloatingTerrainScene): SceneGeometry {
        cachedScene?.let { if (it.revision == scene.revision) return it }
        if (scene.tiles.size > MAX_TILES) return SceneGeometry(scene.revision, emptyList(), emptyList(), DEFAULT_CONTOUR_INTERVAL)

        val valid = scene.tiles.filter { tile ->
            tile.z in 13..16 && tile.side in 2..MAX_TILE_SIDE &&
                tile.heights.size == tile.side * tile.side &&
                tile.x in 0 until (1 shl tile.z) && tile.y in 0 until (1 shl tile.z)
        }
        val provisional = valid.map { tile -> tileGeometryWithoutContours(tile) }
        var finiteMin = Double.POSITIVE_INFINITY
        var finiteMax = Double.NEGATIVE_INFINITY
        provisional.forEach { tile ->
            tile.finiteHeights.forEach { value ->
                if (value.isFinite()) { finiteMin = min(finiteMin, value); finiteMax = max(finiteMax, value) }
            }
        }
        val contourInterval = when {
            !finiteMin.isFinite() || !finiteMax.isFinite() -> DEFAULT_CONTOUR_INTERVAL
            (finiteMax - finiteMin) > 8_000.0 -> 200
            (finiteMax - finiteMin) > 3_000.0 -> 100
            else -> DEFAULT_CONTOUR_INTERVAL
        }
        val tiles = provisional.map { raw ->
            val contours = FloatingTerrainMeshMath.contourSegments(raw.source.heights, raw.source.side, contourInterval)
            TileGeometry(raw.source, raw.longitudes, raw.latitudes, contours, raw.finiteHeights)
        }
        val seamContours = buildSeamContours(tiles, contourInterval)
        return SceneGeometry(scene.revision, tiles, seamContours, contourInterval).also { cachedScene = it }
    }

    private fun tileGeometryWithoutContours(tile: FloatingTerrainTile): TileGeometry {
        val count = tile.side * tile.side
        val longitudes = DoubleArray(count)
        val latitudes = DoubleArray(count)
        val finite = DoubleArray(count) { Double.NaN }
        for (row in 0 until tile.side) for (column in 0 until tile.side) {
            val index = row * tile.side + column
            val coordinate = FloatingTerrainProjectionMath.tileSampleCoordinate(tile.z, tile.x, tile.y, tile.side, column, row)
            longitudes[index] = coordinate.longitude
            latitudes[index] = coordinate.latitude
            val height = tile.heights[index]
            if (height.isFinite()) finite[index] = height
        }
        return TileGeometry(tile, longitudes, latitudes, emptyList(), finite)
    }

    private fun prepareFrame(
        bounds: RectF,
        scene: SceneGeometry,
        center: FloatingCoordinate,
        zoom: Int,
        bearing: Double,
        route: List<FloatingCoordinate>,
        recordedSegments: List<List<FloatingCoordinate>>,
        routeColor: Int,
        heightSampler: FloatingTerrainHeightSampler,
        centerHeight: Double?,
        key: FrameKey,
        now: Long,
    ): PreparedFrame {
        if (centerHeight == null) return PreparedFrame(key, Path(), Path(), Path(), Path(), Path(), Path(), false, now)
        val camera = FloatingTerrainProjectionMath.camera(center, centerHeight, lookRange(zoom), bearing, bounds)
        val grid = FloatingTerrainDepthBuffer(bounds.width().toDouble(), bounds.height().toDouble())
        rasterTerrainDepth(scene.tiles, camera, bounds, grid)
        val nearMinor = Path(); val nearMajor = Path(); val midMajor = Path(); val farMajor = Path()
        scene.tiles.forEach { tile ->
            tile.contours.forEach { segment ->
                val aIndexX = segment.x1.toDouble()
                val aIndexY = segment.y1.toDouble()
                val bIndexX = segment.x2.toDouble()
                val bIndexY = segment.y2.toDouble()
                val a = tilePoint(tile, aIndexX, aIndexY, center)
                val b = tilePoint(tile, bIndexX, bIndexY, center)
                if (a != null && b != null) {
                    val aDepth = camera.project(a.east, a.north, segment.elevationMeters.toDouble())?.depth ?: return@forEach
                    val bDepth = camera.project(b.east, b.north, segment.elevationMeters.toDouble())?.depth ?: return@forEach
                    val major = NativeContourVectorGeometry.contourWidth(segment.elevationMeters, scene.contourInterval) > 0.5f
                    val band = FloatingTerrainContourLod.band((aDepth + bDepth) * 0.5, camera.rangeMeters, major)
                    val target = when (band) {
                        FloatingTerrainContourLod.Band.NEAR_MINOR -> nearMinor
                        FloatingTerrainContourLod.Band.NEAR_MAJOR -> nearMajor
                        FloatingTerrainContourLod.Band.MID_MAJOR -> midMajor
                        FloatingTerrainContourLod.Band.FAR_MAJOR -> farMajor
                        FloatingTerrainContourLod.Band.HIDDEN -> return@forEach
                    }
                    appendVisibleLine(target, a, b, camera, bounds, grid, segment.elevationMeters.toDouble() + SURFACE_BIAS_METERS)
                }
            }
        }
        scene.seamContours.forEach { segment ->
            val a = geographicPoint(segment.a, center)
            val b = geographicPoint(segment.b, center)
            val aDepth = camera.project(a.east, a.north, segment.elevationMeters.toDouble())?.depth ?: return@forEach
            val bDepth = camera.project(b.east, b.north, segment.elevationMeters.toDouble())?.depth ?: return@forEach
            val major = NativeContourVectorGeometry.contourWidth(segment.elevationMeters, scene.contourInterval) > 0.5f
            val band = FloatingTerrainContourLod.band((aDepth + bDepth) * 0.5, camera.rangeMeters, major)
            val target = when (band) {
                FloatingTerrainContourLod.Band.NEAR_MINOR -> nearMinor
                FloatingTerrainContourLod.Band.NEAR_MAJOR -> nearMajor
                FloatingTerrainContourLod.Band.MID_MAJOR -> midMajor
                FloatingTerrainContourLod.Band.FAR_MAJOR -> farMajor
                FloatingTerrainContourLod.Band.HIDDEN -> return@forEach
            }
            appendVisibleLine(target, a, b, camera, bounds, grid, segment.elevationMeters.toDouble() + SURFACE_BIAS_METERS)
        }
        val routePath = buildTrackPath(heightSampler, route, camera, bounds, grid, ROUTE_SIMPLIFY_PIXELS, MAX_ROUTE_PATH_POINTS).path
        val recordedPath = Path()
        var remainingRecordedBudget = MAX_RECORDED_PATH_POINTS
        recordedSegments.forEach { segment ->
            if (remainingRecordedBudget < 2) return@forEach
            val result = buildTrackPath(heightSampler, segment, camera, bounds, grid, RECORDING_SIMPLIFY_PIXELS, remainingRecordedBudget)
            recordedPath.addPath(result.path)
            remainingRecordedBudget = (remainingRecordedBudget - result.usedSamples).coerceAtLeast(0)
        }
        return PreparedFrame(key, nearMinor, nearMajor, midMajor, farMajor, routePath, recordedPath, true, now)
    }

    /** Only small pose changes may reuse the last frame for the 5 Hz preparation limit. */
    private fun canThrottleTo(previous: FrameKey, next: FrameKey): Boolean =
        previous.revision == next.revision && previous.zoom == next.zoom &&
            previous.routeRef == next.routeRef && previous.recordingRef == next.recordingRef &&
            previous.routeColor == next.routeColor

    private fun rasterTerrainDepth(
        tiles: List<TileGeometry>,
        camera: FloatingTerrainProjectionMath.Camera,
        bounds: RectF,
        depth: FloatingTerrainDepthBuffer,
    ) {
        val projectedTiles = LinkedHashMap<Triple<Int, Int, Int>, ProjectedTile>(tiles.size)
        tiles.forEach { tile ->
            val side = tile.source.side
            val cameraX = DoubleArray(side * side)
            val cameraY = DoubleArray(side * side)
            val cameraDepth = DoubleArray(side * side)
            val valid = BooleanArray(side * side)
            val cameraScratch = DoubleArray(3)
            for (index in cameraDepth.indices) {
                val h = tile.source.heights[index]
                if (!h.isFinite()) continue
                val en = localMeters(camera, tile.longitudes[index], tile.latitudes[index])
                camera.cameraCoordinates(en.first, en.second, h, cameraScratch)
                cameraX[index] = cameraScratch[0]
                cameraY[index] = cameraScratch[1]
                cameraDepth[index] = cameraScratch[2]
                valid[index] = true
            }
            for (row in 0 until side - 1) for (column in 0 until side - 1) {
                val a = row * side + column
                val b = a + 1
                val d = (row + 1) * side + column
                val c = d + 1
                if (valid[a] && valid[b] && valid[c] && valid[d]) {
                    depth.rasterizeCameraTriangle(camera, bounds,
                        cameraX[a], cameraY[a], cameraDepth[a], cameraX[b], cameraY[b], cameraDepth[b], cameraX[c], cameraY[c], cameraDepth[c])
                    depth.rasterizeCameraTriangle(camera, bounds,
                        cameraX[a], cameraY[a], cameraDepth[a], cameraX[c], cameraY[c], cameraDepth[c], cameraX[d], cameraY[d], cameraDepth[d])
                }
            }
            projectedTiles[Triple(tile.source.z, tile.source.x, tile.source.y)] = ProjectedTile(tile, cameraX, cameraY, cameraDepth, valid)
        }
        projectedTiles.values.forEach { first ->
            val source = first.geometry.source
            val count = 1 shl source.z
            val side = source.side
            val right = projectedTiles[Triple(source.z, (source.x + 1) % count, source.y)]
            if (right != null && right.geometry.source.side == side) {
                for (row in 0 until side - 1) {
                    val tl = row * side + side - 1; val bl = (row + 1) * side + side - 1
                    val tr = row * side; val br = (row + 1) * side
                    rasterSeamCell(first, tl, right, tr, right, br, first, bl, camera, bounds, depth)
                }
            }
            if (source.y + 1 < count) {
                val below = projectedTiles[Triple(source.z, source.x, source.y + 1)]
                if (below != null && below.geometry.source.side == side) {
                    for (column in 0 until side - 1) {
                        val tl = (side - 1) * side + column; val tr = tl + 1
                        val bl = column; val br = column + 1
                        rasterSeamCell(first, tl, first, tr, below, br, below, bl, camera, bounds, depth)
                    }
                }
            }
        }
        FloatingTerrainJunctionMath.cells(projectedTiles.values.map { it.geometry.source }).forEach { cell ->
            if (cell.heightsOrNull() == null) return@forEach
            val nw = projectedTiles[Triple(cell.northwest.z, cell.northwest.x, cell.northwest.y)] ?: return@forEach
            val ne = projectedTiles[Triple(cell.northeast.z, cell.northeast.x, cell.northeast.y)] ?: return@forEach
            val se = projectedTiles[Triple(cell.southeast.z, cell.southeast.x, cell.southeast.y)] ?: return@forEach
            val sw = projectedTiles[Triple(cell.southwest.z, cell.southwest.x, cell.southwest.y)] ?: return@forEach
            rasterSeamCell(
                nw, cell.northwestIndex, ne, cell.northeastIndex,
                se, cell.southeastIndex, sw, cell.southwestIndex,
                camera, bounds, depth,
            )
        }
    }

    private data class ProjectedTile(
        val geometry: TileGeometry,
        val x: DoubleArray,
        val y: DoubleArray,
        val depth: DoubleArray,
        val valid: BooleanArray,
    )

    private fun rasterSeamCell(
        firstTile: ProjectedTile, firstIndex: Int,
        secondTile: ProjectedTile, secondIndex: Int,
        thirdTile: ProjectedTile, thirdIndex: Int,
        fourthTile: ProjectedTile, fourthIndex: Int,
        camera: FloatingTerrainProjectionMath.Camera,
        bounds: RectF,
        depthBuffer: FloatingTerrainDepthBuffer,
    ) {
        if (!firstTile.valid[firstIndex] || !secondTile.valid[secondIndex] ||
            !thirdTile.valid[thirdIndex] || !fourthTile.valid[fourthIndex]) return
        fun draw(aTile: ProjectedTile, a: Int, bTile: ProjectedTile, b: Int, cTile: ProjectedTile, c: Int) {
            depthBuffer.rasterizeCameraTriangle(
                camera, bounds,
                aTile.x[a], aTile.y[a], aTile.depth[a], bTile.x[b], bTile.y[b], bTile.depth[b], cTile.x[c], cTile.y[c], cTile.depth[c],
            )
        }
        draw(firstTile, firstIndex, secondTile, secondIndex, thirdTile, thirdIndex)
        draw(firstTile, firstIndex, thirdTile, thirdIndex, fourthTile, fourthIndex)
    }

    /** Fills the one-cell gap between adjacent center-sampled tile grids without inventing heights. */
    private fun buildSeamContours(tiles: List<TileGeometry>, interval: Int): List<WorldContourLine> {
        val byTile = tiles.associateBy { Triple(it.source.z, it.source.x, it.source.y) }
        val result = ArrayList<WorldContourLine>()
        tiles.forEach { first ->
            val source = first.source
            val count = 1 shl source.z
            val side = source.side
            val right = byTile[Triple(source.z, (source.x + 1) % count, source.y)]
            if (right != null && right.source.side == side) {
                for (row in 0 until side - 1) {
                    val tl = row * side + side - 1
                    val bl = (row + 1) * side + side - 1
                    val tr = row * side
                    val br = (row + 1) * side
                    addSeamContours(
                        doubleArrayOf(first.source.heights[tl], right.source.heights[tr], right.source.heights[br], first.source.heights[bl]),
                        listOf(geo(first, tl), geo(right, tr), geo(right, br), geo(first, bl)), interval, result,
                    )
                }
            }
            if (source.y + 1 < count) {
                val below = byTile[Triple(source.z, source.x, source.y + 1)]
                if (below != null && below.source.side == side) {
                    for (column in 0 until side - 1) {
                        val tl = (side - 1) * side + column
                        val tr = tl + 1
                        val bl = column
                        val br = column + 1
                        addSeamContours(
                            doubleArrayOf(first.source.heights[tl], first.source.heights[tr], below.source.heights[br], below.source.heights[bl]),
                            listOf(geo(first, tl), geo(first, tr), geo(below, br), geo(below, bl)), interval, result,
                        )
                    }
                }
            }
        }
        FloatingTerrainJunctionMath.cells(tiles.map { it.source }).forEach { cell ->
            val values = cell.heightsOrNull() ?: return@forEach
            val nw = byTile[Triple(cell.northwest.z, cell.northwest.x, cell.northwest.y)] ?: return@forEach
            val ne = byTile[Triple(cell.northeast.z, cell.northeast.x, cell.northeast.y)] ?: return@forEach
            val se = byTile[Triple(cell.southeast.z, cell.southeast.x, cell.southeast.y)] ?: return@forEach
            val sw = byTile[Triple(cell.southwest.z, cell.southwest.x, cell.southwest.y)] ?: return@forEach
            addSeamContours(
                values,
                listOf(
                    geo(nw, cell.northwestIndex), geo(ne, cell.northeastIndex),
                    geo(se, cell.southeastIndex), geo(sw, cell.southwestIndex),
                ),
                interval,
                result,
            )
        }
        return result
    }

    private fun addSeamContours(
        values: DoubleArray,
        corners: List<FloatingCoordinate>,
        interval: Int,
        output: MutableList<WorldContourLine>,
    ) {
        FloatingTerrainMeshMath.contourSegments(values, 2, interval).forEach { segment ->
            output += WorldContourLine(
                meshCoordinate(corners, segment.x1.toDouble(), segment.y1.toDouble()),
                meshCoordinate(corners, segment.x2.toDouble(), segment.y2.toDouble()),
                segment.elevationMeters,
            )
        }
    }

    private fun geo(tile: TileGeometry, index: Int) = FloatingCoordinate(tile.longitudes[index], tile.latitudes[index])

    private fun meshCoordinate(corners: List<FloatingCoordinate>, x: Double, y: Double): FloatingCoordinate {
        val lon0 = corners[0].longitude
        val lon1 = unwrapLongitude(lon0, corners[1].longitude)
        val lon2 = unwrapLongitude(lon0, corners[2].longitude)
        val lon3 = unwrapLongitude(lon0, corners[3].longitude)
        val lon: Double
        val lat: Double
        if (x >= y) {
            val wa = 1.0 - x; val wb = x - y; val wc = y
            lon = lon0 * wa + lon1 * wb + lon2 * wc
            lat = corners[0].latitude * wa + corners[1].latitude * wb + corners[2].latitude * wc
        } else {
            val wa = 1.0 - y; val wb = x; val wc = y - x
            lon = lon0 * wa + lon2 * wb + lon3 * wc
            lat = corners[0].latitude * wa + corners[2].latitude * wb + corners[3].latitude * wc
        }
        return FloatingCoordinate(wrapLongitude(lon), lat)
    }

    private fun unwrapLongitude(reference: Double, value: Double): Double = reference + wrapLongitude(value - reference)

    private fun geographicPoint(point: FloatingCoordinate, center: FloatingCoordinate): GeoPoint {
        val east = Math.toRadians(wrapLongitude(point.longitude - center.longitude)) * EARTH_RADIUS * cos(Math.toRadians(center.latitude))
        val north = Math.toRadians(point.latitude - center.latitude) * EARTH_RADIUS
        return GeoPoint(east, north, 0.0)
    }

    private fun tilePoint(tile: TileGeometry, sampleX: Double, sampleY: Double, center: FloatingCoordinate): GeoPoint? {
        val side = tile.source.side
        val x0 = floor(sampleX).toInt().coerceIn(0, side - 1)
        val y0 = floor(sampleY).toInt().coerceIn(0, side - 1)
        val x1 = min(side - 1, x0 + 1); val y1 = min(side - 1, y0 + 1)
        val fx = (sampleX - x0).coerceIn(0.0, 1.0); val fy = (sampleY - y0).coerceIn(0.0, 1.0)
        val i00 = y0 * side + x0; val i10 = y0 * side + x1; val i01 = y1 * side + x0; val i11 = y1 * side + x1
        val first: Int
        val second: Int
        val third: Int
        val firstWeight: Double
        val secondWeight: Double
        val thirdWeight: Double
        if (fx >= fy) {
            first = i00; second = i10; third = i11
            firstWeight = 1.0 - fx; secondWeight = fx - fy; thirdWeight = fy
        } else {
            first = i00; second = i11; third = i01
            firstWeight = 1.0 - fy; secondWeight = fx; thirdWeight = fy - fx
        }
        val h1 = tile.source.heights[first]
        val h2 = tile.source.heights[second]
        val h3 = tile.source.heights[third]
        if ((firstWeight > 1e-9 && !h1.isFinite()) || (secondWeight > 1e-9 && !h2.isFinite()) ||
            (thirdWeight > 1e-9 && !h3.isFinite())) return null
        val lat0 = Math.toRadians(center.latitude)
        fun east(index: Int) = Math.toRadians(wrapLongitude(tile.longitudes[index] - center.longitude)) * EARTH_RADIUS * cos(lat0)
        fun north(index: Int) = Math.toRadians(tile.latitudes[index] - center.latitude) * EARTH_RADIUS
        return GeoPoint(
            east(first) * firstWeight + east(second) * secondWeight + east(third) * thirdWeight,
            north(first) * firstWeight + north(second) * secondWeight + north(third) * thirdWeight,
            h1 * firstWeight + h2 * secondWeight + h3 * thirdWeight,
        )
    }

    private fun appendVisibleLine(
        path: Path,
        a: GeoPoint,
        b: GeoPoint,
        camera: FloatingTerrainProjectionMath.Camera,
        bounds: RectF,
        depth: FloatingTerrainDepthBuffer,
        lineHeight: Double? = null,
    ) {
        val h0 = lineHeight ?: a.height + SURFACE_BIAS_METERS
        val h1 = lineHeight ?: b.height + SURFACE_BIAS_METERS
        val p0 = camera.project(a.east, a.north, h0) ?: return
        val p1 = camera.project(b.east, b.north, h1) ?: return
        val screenDistance = hypot(p1.x - p0.x, p1.y - p0.y)
        if (screenDistance > MAX_PROJECTED_SEGMENT_PX) return
        val steps = ceil(screenDistance / DEPTH_SAMPLE_SPACING_PX).toInt().coerceIn(1, MAX_SEGMENT_SAMPLES)
        var drawing = false
        for (step in 0..steps) {
            val t = step.toDouble() / steps
            val x = lerp(p0.x, p1.x, t)
            val y = lerp(p0.y, p1.y, t)
            val z = FloatingTerrainProjectionMath.perspectiveDepthAtScreenFraction(t, p0.depth, p1.depth)
            val visible = x in bounds.left.toDouble()..bounds.right.toDouble() &&
                y in bounds.top.toDouble()..bounds.bottom.toDouble() && depth.isVisible(x, y, z, bounds, DEPTH_TOLERANCE_METERS)
            if (visible) {
                if (!drawing) path.moveTo(x.toFloat(), y.toFloat()) else path.lineTo(x.toFloat(), y.toFloat())
                drawing = true
            } else drawing = false
        }
    }

    private fun buildTrackPath(
        heightSampler: FloatingTerrainHeightSampler,
        coordinates: List<FloatingCoordinate>,
        camera: FloatingTerrainProjectionMath.Camera,
        bounds: RectF,
        depth: FloatingTerrainDepthBuffer,
        simplifyPx: Double,
        pointBudget: Int,
    ): TrackPathResult {
        val path = Path()
        if (coordinates.size < 2 || pointBudget < 2) return TrackPathResult(path, 0)
        val runs = ArrayList<MutableList<Pair<Double, Double>>>()
        var local: MutableList<Pair<Double, Double>>? = null
        val maxRadius = camera.rangeMeters * MAX_TRACK_RANGE_MULTIPLIER
        val centerLat = camera.center.latitude
        for (coord in coordinates) {
            if (!coord.longitude.isFinite() || !coord.latitude.isFinite() || coord.latitude !in -90.0..90.0) { local = null; continue }
            val lat = coord.latitude.coerceIn(-MAX_MERCATOR_LAT, MAX_MERCATOR_LAT)
            val east = Math.toRadians(wrapLongitude(coord.longitude - camera.center.longitude)) * EARTH_RADIUS * cos(Math.toRadians(centerLat))
            val north = Math.toRadians(lat - centerLat) * EARTH_RADIUS
            if (hypot(east, north) <= maxRadius) {
                val run = local ?: ArrayList<Pair<Double, Double>>().also { runs += it; local = it }
                run += east to north
            } else local = null
        }
        var remainingBudget = pointBudget
        runs.forEach { run ->
            if (run.size < 2 || remainingBudget < 2) return@forEach
            val simplified = simplifyLocalPoints(run, camera, simplifyPx, remainingBudget)
            fun pointAt(east: Double, north: Double): GeoPoint? {
                val longitude = camera.center.longitude + Math.toDegrees(east / (EARTH_RADIUS * cos(Math.toRadians(centerLat)).coerceAtLeast(0.01)))
                val latitude = camera.center.latitude + Math.toDegrees(north / EARTH_RADIUS)
                val height = heightSampler.sample(wrapLongitude(longitude), latitude) ?: return null
                return GeoPoint(east, north, height)
            }
            var prior = pointAt(simplified.first().first, simplified.first().second)
            remainingBudget--
            for (index in 1 until simplified.size) {
                if (remainingBudget <= 0) { prior = null; break }
                val from = simplified[index - 1]
                val to = simplified[index]
                val distance = hypot(to.first - from.first, to.second - from.second)
                val desiredSteps = ceil(distance / MAX_TRACK_SURFACE_SPACING_METERS).toInt().coerceAtLeast(1)
                val steps = min(desiredSteps, remainingBudget)
                for (step in 1..steps) {
                    val t = step.toDouble() / steps
                    val current = pointAt(lerp(from.first, to.first, t), lerp(from.second, to.second, t))
                    if (current == null) prior = null else prior?.let { appendVisibleLine(path, it, current, camera, bounds, depth) }
                    prior = current
                    remainingBudget--
                }
            }
        }
        return TrackPathResult(path, pointBudget - remainingBudget)
    }

    private fun simplifyLocalPoints(
        points: List<Pair<Double, Double>>,
        camera: FloatingTerrainProjectionMath.Camera,
        tolerancePx: Double,
        pointBudget: Int,
    ): List<Pair<Double, Double>> {
        if (points.size <= 2) return points
        val projected = Array(points.size) { index ->
            val p = points[index]
            camera.project(p.first, p.second, camera.centerHeight)?.let { it.x to it.y } ?: Double.NaN to Double.NaN
        }
        val keep = BooleanArray(points.size)
        keep[0] = true; keep[points.lastIndex] = true
        val pending = ArrayDeque<IntRange>()
        pending.addLast(0..points.lastIndex)
        val toleranceSquared = tolerancePx * tolerancePx
        while (pending.isNotEmpty()) {
            val range = pending.removeLast()
            val a = projected[range.first]; val b = projected[range.last]
            val dx = b.first - a.first; val dy = b.second - a.second; val denominator = dx * dx + dy * dy
            var farthest = -1; var maxDistance = toleranceSquared
            for (i in range.first + 1 until range.last) {
                val p = projected[i]
                if (!p.first.isFinite() || !p.second.isFinite()) continue
                val t = if (denominator <= 1e-12) 0.0 else (((p.first - a.first) * dx + (p.second - a.second) * dy) / denominator).coerceIn(0.0, 1.0)
                val ddx = p.first - (a.first + t * dx); val ddy = p.second - (a.second + t * dy)
                val distance = ddx * ddx + ddy * ddy
                if (distance > maxDistance) { maxDistance = distance; farthest = i }
            }
            if (farthest >= 0) { keep[farthest] = true; pending.addLast(range.first..farthest); pending.addLast(farthest..range.last) }
        }
        val selected = ArrayList<Pair<Double, Double>>(min(points.size, pointBudget))
        keep.forEachIndexed { index, use -> if (use) selected += points[index] }
        if (selected.size <= pointBudget) return selected
        // Increase the screen-space tolerance until the projected path fits its hard budget.
        // This remains Douglas-Peucker simplification and preserves the endpoints.
        return simplifyLocalPoints(points, camera, tolerancePx * 2.0, pointBudget)
    }

    private fun localMeters(camera: FloatingTerrainProjectionMath.Camera, longitude: Double, latitude: Double): Pair<Double, Double> {
        val east = Math.toRadians(wrapLongitude(longitude - camera.center.longitude)) * EARTH_RADIUS * cos(Math.toRadians(camera.center.latitude))
        val north = Math.toRadians(latitude - camera.center.latitude) * EARTH_RADIUS
        return east to north
    }

    private fun frameKey(
        revision: Long,
        center: FloatingCoordinate,
        zoom: Int,
        bearing: Double,
        route: List<FloatingCoordinate>,
        recordings: List<List<FloatingCoordinate>>,
        routeColor: Int,
    ) = FrameKey(
        revision,
        (center.latitude * 111_320.0 / POSITION_QUANTIZATION_METERS).roundToLong(),
        (center.longitude * 111_320.0 * cos(Math.toRadians(center.latitude)) / POSITION_QUANTIZATION_METERS).roundToLong(),
        zoom,
        (bearing / BEARING_QUANTIZATION_DEGREES).roundToInt(),
        System.identityHashCode(route), System.identityHashCode(recordings), routeColor,
    )

    private fun boundsKey(bounds: RectF) = BoundsKey(
        bounds.left.roundToInt(), bounds.top.roundToInt(), bounds.width().roundToInt().coerceAtLeast(1), bounds.height().roundToInt().coerceAtLeast(1),
    )

    private fun lookRange(zoom: Int): Double = (600.0 / 2.0.pow(zoom - 14)).coerceIn(80.0, 1_200.0)

    companion object {
        const val OUTDOOR_CONTOUR_COLOR = 0xffc8e978.toInt()
        const val RECORDED_TRACK_COLOR = 0xffffdf38.toInt()
        private const val EARTH_RADIUS = 6_378_137.0
        private const val MAX_MERCATOR_LAT = 85.0511287798066
        private const val MIN_CAMERA_ZOOM = 14
        private const val MAX_CAMERA_ZOOM = 18
        private const val DEFAULT_CONTOUR_INTERVAL = 30
        private const val MAX_TILES = 9
        private const val MAX_TILE_SIDE = 33
        private const val MAX_VIEW_CACHES = 2
        private const val PREPARE_INTERVAL_MS = 200L
        private const val POSITION_QUANTIZATION_METERS = 3.0
        private const val BEARING_QUANTIZATION_DEGREES = 2.0
        private const val CAMERA_TILT_DEGREES = 72.0
        private const val VERTICAL_FOV_DEGREES = 52.0
        private const val SURFACE_BIAS_METERS = 1.0
        private const val DEPTH_TOLERANCE_METERS = 3.0
        private const val DEPTH_SAMPLE_SPACING_PX = 2.0
        private const val MAX_SEGMENT_SAMPLES = 1_280
        private const val MAX_PROJECTED_SEGMENT_PX = 2_500.0
        private const val MAX_TRACK_RANGE_MULTIPLIER = 10.0
        private const val MAX_TRACK_SURFACE_SPACING_METERS = 15.0
        private const val ROUTE_SIMPLIFY_PIXELS = 0.35
        private const val RECORDING_SIMPLIFY_PIXELS = 0.5
        private const val MAX_ROUTE_PATH_POINTS = 30_000
        private const val MAX_RECORDED_PATH_POINTS = 12_000
        private const val MINOR_CONTOUR_WIDTH_PX = 1f
        private const val MAJOR_CONTOUR_WIDTH_PX = 1.5f
        private const val MID_CONTOUR_ALPHA = 176
        private const val FAR_CONTOUR_ALPHA = 72

        private fun worldY(latitude: Double): Double {
            val r = Math.toRadians(latitude.coerceIn(-MAX_MERCATOR_LAT, MAX_MERCATOR_LAT))
            return (1.0 - ln(tan(r) + 1.0 / cos(r)) / PI) / 2.0
        }

        private fun wrapLongitude(longitude: Double): Double {
            var value = (longitude + 180.0) % 360.0
            if (value < 0.0) value += 360.0
            return value - 180.0
        }

        private fun lerp(a: Double, b: Double, t: Double) = a + (b - a) * t
    }
}

/** Center-sampled DEM lookup. It interpolates across a tile seam only when both samples exist. */
internal class FloatingTerrainHeightSampler(tiles: List<FloatingTerrainTile>) {
    private val tiles = tiles
    private val z = tiles.asSequence()
        .filter { it.z in 13..16 && it.side >= 2 && it.heights.size == it.side * it.side }
        .maxOfOrNull { it.z } ?: -1
    private val side = tiles.firstOrNull { it.z == z && it.side >= 2 && it.heights.size == it.side * it.side }?.side ?: 0

    fun sample(longitude: Double, latitude: Double): Double? {
        if (!longitude.isFinite() || !latitude.isFinite() || latitude !in -90.0..90.0) return null
        if (z < 0 || side < 2) return null
        val n = 1 shl z
        val sampleX = ((wrapLongitude(longitude) + 180.0) / 360.0 * n * side) - 0.5
        val sampleY = worldY(latitude) * n * side - 0.5
        val x0 = floor(sampleX).toInt(); val y0 = floor(sampleY).toInt()
        val x1 = x0 + 1; val y1 = y0 + 1
        val fx = sampleX - x0; val fy = sampleY - y0
        fun value(globalX: Int, globalY: Int): Double {
            if (globalY < 0 || globalY >= n * side) return Double.NaN
            val tileX = Math.floorDiv(globalX, side).mod(n)
            val tileY = Math.floorDiv(globalY, side)
            val column = Math.floorMod(globalX, side)
            val row = Math.floorMod(globalY, side)
            val tile = tiles.firstOrNull { it.z == z && it.x == tileX && it.y == tileY } ?: return Double.NaN
            if (tile.side != side) return Double.NaN
            return tile.heights[row * side + column]
        }
        val northwest = value(x0, y0)
        val northeast = value(x1, y0)
        val southeast = value(x1, y1)
        val southwest = value(x0, y1)
        return if (fx >= fy) {
            triangleHeight(northwest, northeast, southeast, 1.0 - fx, fx - fy, fy)
        } else {
            triangleHeight(northwest, southeast, southwest, 1.0 - fy, fx, fy - fx)
        }
    }

    private fun worldY(latitude: Double): Double {
        val r = Math.toRadians(latitude.coerceIn(-MAX_MERCATOR_LAT, MAX_MERCATOR_LAT))
        return (1.0 - ln(tan(r) + 1.0 / cos(r)) / PI) / 2.0
    }

    private fun wrapLongitude(longitude: Double): Double {
        var value = (longitude + 180.0) % 360.0
        if (value < 0.0) value += 360.0
        return value - 180.0
    }

    private fun triangleHeight(a: Double, b: Double, c: Double, wa: Double, wb: Double, wc: Double): Double? {
        if ((wa > 1e-9 && !a.isFinite()) || (wb > 1e-9 && !b.isFinite()) || (wc > 1e-9 && !c.isFinite())) return null
        var total = 0.0
        var weight = 0.0
        if (wa > 1e-9) { total += a * wa; weight += wa }
        if (wb > 1e-9) { total += b * wb; weight += wb }
        if (wc > 1e-9) { total += c * wc; weight += wc }
        return if (weight > 0.0) total / weight else null
    }

    companion object {
        private const val MAX_MERCATOR_LAT = 85.0511287798066
    }
}

/** Perspective ENU camera: 72 degrees from nadir, looking toward [center]. */
internal object FloatingTerrainProjectionMath {
    internal data class Camera(
        val center: FloatingCoordinate,
        val centerHeight: Double,
        val rangeMeters: Double,
        val sinBearing: Double,
        val cosBearing: Double,
        val sinTilt: Double,
        val cosTilt: Double,
        val focal: Double,
        val centerX: Double,
        val centerY: Double,
    ) {
        fun cameraCoordinates(east: Double, north: Double, height: Double, result: DoubleArray) {
            val horizontal = rangeMeters * sinTilt
            val eyeEast = -sinBearing * horizontal
            val eyeNorth = -cosBearing * horizontal
            val eyeUp = rangeMeters * cosTilt
            val x = east - eyeEast
            val y = north - eyeNorth
            val z = height - centerHeight - eyeUp
            val right = x * cosBearing - y * sinBearing
            val up = x * sinBearing * cosTilt + y * cosBearing * cosTilt + z * sinTilt
            val depth = x * sinBearing * sinTilt + y * cosBearing * sinTilt - z * cosTilt
            result[0] = right; result[1] = up; result[2] = depth
        }

        fun project(east: Double, north: Double, height: Double): FloatingTerrainScreenPoint? {
            if (!east.isFinite() || !north.isFinite() || !height.isFinite()) return null
            val horizontal = rangeMeters * sinTilt
            val x = east + sinBearing * horizontal
            val y = north + cosBearing * horizontal
            val z = height - centerHeight - rangeMeters * cosTilt
            val right = x * cosBearing - y * sinBearing
            val up = x * sinBearing * cosTilt + y * cosBearing * cosTilt + z * sinTilt
            val depth = x * sinBearing * sinTilt + y * cosBearing * sinTilt - z * cosTilt
            if (depth <= NEAR_CLIP_METERS) return null
            val screenX = centerX + focal * right / depth
            val screenY = centerY - focal * up / depth
            return if (screenX.isFinite() && screenY.isFinite()) FloatingTerrainScreenPoint(screenX, screenY, depth) else null
        }

        companion object { private const val NEAR_CLIP_METERS = 0.5 }
    }

    data class GridSize(val width: Int, val height: Int)

    fun perspectiveDepthAtScreenFraction(screenFraction: Double, startDepth: Double, endDepth: Double): Double {
        require(screenFraction.isFinite() && screenFraction in 0.0..1.0)
        require(startDepth.isFinite() && endDepth.isFinite() && startDepth > 0.0 && endDepth > 0.0)
        val inverseDepth = (1.0 - screenFraction) / startDepth + screenFraction / endDepth
        return 1.0 / inverseDepth
    }

    fun lookRange(zoom: Int): Double = (600.0 / 2.0.pow(zoom.coerceIn(14, 18) - 14)).coerceIn(80.0, 1_200.0)

    fun depthGridSize(width: Double, height: Double): GridSize {
        require(width.isFinite() && height.isFinite() && width > 0 && height > 0)
        return GridSize(min(MAX_DEPTH_GRID_SIDE, ceil(width).toInt()).coerceAtLeast(2), min(MAX_DEPTH_GRID_SIDE, ceil(height).toInt()).coerceAtLeast(2))
    }

    /** Center-sampled north-to-south row-major grid used by FloatingTerrainSource. */
    fun tileSampleCoordinate(z: Int, x: Int, y: Int, side: Int, column: Int, row: Int): FloatingCoordinate {
        require(z in 0..22 && side >= 2 && x in 0 until (1 shl z) && y in 0 until (1 shl z))
        require(column in 0 until side && row in 0 until side)
        val n = 1 shl z
        val worldX = (x + (column + 0.5) / side) / n
        val worldY = (y + (row + 0.5) / side) / n
        val longitude = worldX * 360.0 - 180.0
        val latitude = Math.toDegrees(atan(sinh(PI * (1.0 - 2.0 * worldY))))
        return FloatingCoordinate(longitude, latitude)
    }

    fun camera(center: FloatingCoordinate, centerHeight: Double, rangeMeters: Double, bearingDegrees: Double, bounds: RectF): Camera {
        require(center.latitude.isFinite() && center.longitude.isFinite() && centerHeight.isFinite())
        require(rangeMeters.isFinite() && rangeMeters > 0 && bearingDegrees.isFinite())
        require(bounds.width() > 0f && bounds.height() > 0f)
        val bearing = Math.toRadians(bearingDegrees)
        val tilt = Math.toRadians(CAMERA_TILT_DEGREES)
        val focal = bounds.height() * 0.5 / tan(Math.toRadians(VERTICAL_FOV_DEGREES) / 2.0)
        return Camera(center, centerHeight, rangeMeters, sin(bearing), cos(bearing), sin(tilt), cos(tilt), focal, bounds.centerX().toDouble(), bounds.centerY().toDouble())
    }

    private const val MAX_DEPTH_GRID_SIDE = 200
    private const val CAMERA_TILT_DEGREES = 72.0
    private const val VERTICAL_FOV_DEGREES = 52.0
}

internal data class FloatingTerrainScreenPoint(val x: Double, val y: Double, val depth: Double)

/** Conservative inverse-depth z-buffer. A coarse cell keeps its nearest terrain sample. */
internal class FloatingTerrainDepthBuffer(width: Double, height: Double) {
    val size = FloatingTerrainProjectionMath.depthGridSize(width, height)
    private val inverseDepth = FloatArray(size.width * size.height)
    private val clipInX = DoubleArray(4)
    private val clipInY = DoubleArray(4)
    private val clipInZ = DoubleArray(4)
    private val clipOutX = DoubleArray(6)
    private val clipOutY = DoubleArray(6)
    private val clipOutZ = DoubleArray(6)

    fun rasterizeCameraTriangle(
        camera: FloatingTerrainProjectionMath.Camera,
        bounds: RectF,
        ax: Double, ay: Double, az: Double,
        bx: Double, by: Double, bz: Double,
        cx: Double, cy: Double, cz: Double,
    ) {
        // Clip a triangle against the near plane before perspective division; at most four vertices.
        clipInX[0] = ax; clipInX[1] = bx; clipInX[2] = cx; clipInX[3] = ax
        clipInY[0] = ay; clipInY[1] = by; clipInY[2] = cy; clipInY[3] = ay
        clipInZ[0] = az; clipInZ[1] = bz; clipInZ[2] = cz; clipInZ[3] = az
        var count = 0
        for (index in 0..2) {
            val next = index + 1
            val x0 = clipInX[index]; val y0 = clipInY[index]; val z0 = clipInZ[index]
            val x1 = clipInX[next]; val y1 = clipInY[next]; val z1 = clipInZ[next]
            val inside0 = z0 > NEAR_CLIP; val inside1 = z1 > NEAR_CLIP
            if (inside0) { clipOutX[count] = x0; clipOutY[count] = y0; clipOutZ[count++] = z0 }
            if (inside0 != inside1) {
                val t = ((NEAR_CLIP - z0) / (z1 - z0)).coerceIn(0.0, 1.0)
                clipOutX[count] = x0 + (x1 - x0) * t
                clipOutY[count] = y0 + (y1 - y0) * t
                clipOutZ[count++] = NEAR_CLIP
            }
        }
        if (count < 3) return
        // Project clipped camera-space vertices directly so no inverse camera transform is needed.
        val p0 = projectCamera(camera, clipOutX[0], clipOutY[0], clipOutZ[0]) ?: return
        for (index in 1 until count - 1) {
            val p1 = projectCamera(camera, clipOutX[index], clipOutY[index], clipOutZ[index]) ?: continue
            val p2 = projectCamera(camera, clipOutX[index + 1], clipOutY[index + 1], clipOutZ[index + 1]) ?: continue
            rasterizeProjected(bounds, p0, p1, p2)
        }
    }

    fun isVisible(x: Double, y: Double, lineDepth: Double, bounds: RectF, toleranceMeters: Double): Boolean {
        if (x !in bounds.left.toDouble()..bounds.right.toDouble() || y !in bounds.top.toDouble()..bounds.bottom.toDouble()) return false
        val gx = (((x - bounds.left) / bounds.width() * (size.width - 1)) - 0.5).coerceIn(0.0, size.width - 1.0)
        val gy = (((y - bounds.top) / bounds.height() * (size.height - 1)) - 0.5).coerceIn(0.0, size.height - 1.0)
        val x0 = floor(gx).toInt()
        val y0 = floor(gy).toInt()
        val x1 = min(size.width - 1, x0 + 1)
        val y1 = min(size.height - 1, y0 + 1)
        val fx = gx - x0
        val fy = gy - y0
        var inverseSum = 0.0
        var weightSum = 0.0
        fun accumulate(sampleX: Int, sampleY: Int, weight: Double) {
            if (weight <= 1e-9) return
            val inverse = inverseDepth[sampleY * size.width + sampleX].toDouble()
            if (inverse > 0.0) { inverseSum += inverse * weight; weightSum += weight }
        }
        accumulate(x0, y0, (1 - fx) * (1 - fy))
        accumulate(x1, y0, fx * (1 - fy))
        accumulate(x1, y1, fx * fy)
        accumulate(x0, y1, (1 - fx) * fy)
        if (weightSum <= 1e-9) return false
        // Reciprocal depth is affine over a projected triangle. Bilinear sampling avoids
        // nearest-grid quantization hiding a contour that lies on that same terrain face.
        val terrainDepth = 1.0 / (inverseSum / weightSum)
        return lineDepth <= terrainDepth + toleranceMeters
    }

    private fun rasterizeProjected(bounds: RectF, a: FloatingTerrainScreenPoint, b: FloatingTerrainScreenPoint, c: FloatingTerrainScreenPoint) {
        fun gx(x: Double) = (x - bounds.left) / bounds.width() * (size.width - 1)
        fun gy(y: Double) = (y - bounds.top) / bounds.height() * (size.height - 1)
        val x0 = gx(a.x); val y0 = gy(a.y); val x1 = gx(b.x); val y1 = gy(b.y); val x2 = gx(c.x); val y2 = gy(c.y)
        val area = edge(x0, y0, x1, y1, x2, y2)
        if (!area.isFinite() || abs(area) < 1e-10) return
        val minX = floor(min(x0, min(x1, x2))).toInt().coerceIn(0, size.width - 1)
        val maxX = ceil(max(x0, max(x1, x2))).toInt().coerceIn(0, size.width - 1)
        val minY = floor(min(y0, min(y1, y2))).toInt().coerceIn(0, size.height - 1)
        val maxY = ceil(max(y0, max(y1, y2))).toInt().coerceIn(0, size.height - 1)
        val invA = 1.0 / a.depth; val invB = 1.0 / b.depth; val invC = 1.0 / c.depth
        for (y in minY..maxY) for (x in minX..maxX) {
            val px = x + 0.5; val py = y + 0.5
            val wa = edge(x1, y1, x2, y2, px, py) / area
            val wb = edge(x2, y2, x0, y0, px, py) / area
            val wc = 1.0 - wa - wb
            if (wa < -1e-7 || wb < -1e-7 || wc < -1e-7) continue
            val inv = wa * invA + wb * invB + wc * invC
            val index = y * size.width + x
            if (inv > inverseDepth[index]) inverseDepth[index] = inv.toFloat()
        }
    }

    private fun projectCamera(camera: FloatingTerrainProjectionMath.Camera, right: Double, up: Double, depth: Double): FloatingTerrainScreenPoint? {
        if (depth <= 0 || !depth.isFinite()) return null
        val x = camera.centerX + camera.focal * right / depth
        val y = camera.centerY - camera.focal * up / depth
        return FloatingTerrainScreenPoint(x, y, depth).takeIf { x.isFinite() && y.isFinite() }
    }

    private fun edge(ax: Double, ay: Double, bx: Double, by: Double, px: Double, py: Double) = (px - ax) * (by - ay) - (py - ay) * (bx - ax)

    internal fun rasterizeScreenTriangle(bounds: RectF, a: FloatingTerrainScreenPoint, b: FloatingTerrainScreenPoint, c: FloatingTerrainScreenPoint) {
        rasterizeProjected(bounds, a, b, c)
    }

    companion object { private const val NEAR_CLIP = 0.5 }
}

/** Screen-space contour LOD avoids painting subpixel far-field lines as dense noise. */
internal object FloatingTerrainContourLod {
    enum class Band { NEAR_MINOR, NEAR_MAJOR, MID_MAJOR, FAR_MAJOR, HIDDEN }

    fun band(cameraDepthMeters: Double, lookRangeMeters: Double, major: Boolean): Band {
        if (!cameraDepthMeters.isFinite() || !lookRangeMeters.isFinite() || lookRangeMeters <= 0.0 || cameraDepthMeters <= 0.0) return Band.HIDDEN
        if (cameraDepthMeters <= lookRangeMeters * 2.0) return if (major) Band.NEAR_MAJOR else Band.NEAR_MINOR
        if (!major) return Band.HIDDEN
        if (cameraDepthMeters <= lookRangeMeters * 4.0) return Band.MID_MAJOR
        if (cameraDepthMeters <= lookRangeMeters * 8.0) return Band.FAR_MAJOR
        return Band.HIDDEN
    }
}
