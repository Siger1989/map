package com.shantu.nativeapp.floating

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.view.MotionEvent
import android.view.View
import com.shantu.nativeapp.geology.NativeMvtFeature
import kotlin.math.*

internal data class FloatingTileGeometry(val z: Int, val x: Int, val y: Int, val features: List<NativeMvtFeature>)
internal data class FloatingTileRenderCounters(
    val visibleTiles: Int = 0,
    val candidatePaths: Int = 0,
    val acceptedPaths: Int = 0,
    val acceptedVertices: Int = 0,
    val pathsSkippedByBudget: Int = 0,
    val pathsSkippedByCandidateLimit: Int = 0,
)

/** Small non-GL overlay. Geometry is supplied by a bounded service cache and drawn only when invalidated. */
internal class FloatingNavigationView(context: Context) : View(context) {
    /** The lock-screen map fills its fade canvas; it has no compact-window panels. */
    var lockscreenPresentation: Boolean = false; set(value) {
        if (field != value) { field = value; routePath = null; recordedPath = null; invalidate() }
    }
    var route: List<FloatingCoordinate> = emptyList(); set(value) { if (field !== value) { field = value; routePath = null; invalidate() } }
    var kind: String = "route"
    var routeColor: Int = FloatingNavigationGeometry.DEFAULT_ROUTE_COLOR; set(value) { if (field != value) { field = value; invalidate() } }
    var recordedSegments: List<List<FloatingCoordinate>> = emptyList(); set(value) { if (field !== value) { field = value; recordedPath = null; invalidate() } }
    var recordingPhase: String = "idle"; set(value) { if (field != value) { field = value; invalidate() } }
    var zoom: Int = 14; set(value) { if (field != value) { field = value; routePath = null; recordedPath = null; invalidate() } }
    var center: FloatingCoordinate? = null; set(value) {
        if (field != value) {
            val prior = routePathCenter
            val priorTrack = recordedPathCenter
            if (value == null || prior == null || worldPixelDistance(prior, value) > .75 / FloatingNavigationGeometry.overzoomScale(zoom)) routePath = null
            if (value == null || priorTrack == null || worldPixelDistance(priorTrack, value) > .75 / FloatingNavigationGeometry.overzoomScale(zoom)) recordedPath = null
            field = value; invalidate()
        }
    }
    var hasRealLocation: Boolean = false; set(value) { field = value; invalidate() }
    /** Bearing used only to rotate the motion-up map; it may remain at the last trusted course. */
    var mapBearing: Double? = null; set(value) { if (field != value) { field = value; invalidate() } }
    /** Fresh direction for the location glyph. Never reuse this as camera state. */
    var heading: Double? = null; set(value) { field = value; invalidate() }
    var mode: String = "north"; set(value) { field = value; invalidate() }
    var stateText: String = "等待定位"; set(value) { field = value; invalidate() }
    var routeRemainingMeters: Double? = null; set(value) { field = value; invalidate() }
    var routeOffRoute: Boolean = false; set(value) { field = value; invalidate() }
    var label: String = "路线"; set(value) { field = value; invalidate() }
    var outdoorContours: Boolean = false; set(value) { field = value; invalidate() }
    var terrainScene: FloatingTerrainScene? = null; set(value) { field = value; invalidate() }
    var terrainLoading: Boolean = false; set(value) { field = value; invalidate() }
    private val contourTerrainRenderer = FloatingContourTerrainRenderer()
    var tiles: List<FloatingTileGeometry> = emptyList(); set(value) {
        field = value
        rebuildTileSummaries(value)
        invalidate()
    }
    var onMode: (() -> Unit)? = null
    var onReturn: (() -> Unit)? = null
    var onClose: (() -> Unit)? = null
    var onDrag: ((Float, Float) -> Unit)? = null
    var onResize: ((Float, Float) -> Unit)? = null
    var onZoom: ((Int) -> Unit)? = null
    var onRecordAction: ((String) -> Unit)? = null
    var onContentSizeChanged: (() -> Unit)? = null

    private val density = resources.displayMetrics.density
    private val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val line = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND }
    private val arrowPath = Path().apply { moveTo(0f, -1f); lineTo(.58f, .72f); lineTo(0f, .43f); lineTo(-.58f, .72f); close() }
    private val round = density * 8f
    private var downX = 0f; private var downY = 0f; private var initialRawX = 0f; private var initialRawY = 0f; private var dragging = false; private var resizing = false
    private var routePath: Path? = null
    private var routePathCenter: FloatingCoordinate? = null
    private var recordedPath: Path? = null
    private var recordedPathCenter: FloatingCoordinate? = null
    private data class MapLabel(val text: String, val x: Float, val y: Float)
    private data class TileCacheKey(val z: Int, val x: Int, val y: Int)
    private data class TileLabelSummary(val text: String, val x: Int, val y: Int, val extent: Int)
    private data class TilePathSummary(
        val tile: FloatingTileGeometry,
        val feature: NativeMvtFeature,
        val points: List<Pair<Int, Int>>,
        val candidate: FloatingPathBudgetCandidate,
        val isBuilding: Boolean,
        val isRoad: Boolean,
        val isWater: Boolean,
        val minX: Int,
        val minY: Int,
        val maxX: Int,
        val maxY: Int,
    )
    private data class TileRenderSummary(
        val tile: FloatingTileGeometry,
        val index: FloatingTileIndex,
        val labels: List<TileLabelSummary>,
        val paths: List<TilePathSummary>,
    )
    private data class TilePlacement(val summary: TileRenderSummary, val dxTile: Double, val dyTile: Double)
    private val tileSummaryCache = LinkedHashMap<TileCacheKey, TileRenderSummary>(40, .75f, true)
    private var tileSummaries: List<TileRenderSummary> = emptyList()
    private var tileSummaryByIndex: Map<FloatingTileIndex, TileRenderSummary> = emptyMap()
    private var tileIndices: List<FloatingTileIndex> = emptyList()
    private val visiblePathsScratch = ArrayList<TilePathSummary>()
    private val budgetCandidatesScratch = ArrayList<FloatingPathBudgetCandidate>()
    private val budgetTilesScratch = ArrayList<FloatingTileIndex>()
    private val visibleTilePlacementsScratch = ArrayList<TilePlacement>()
    internal var renderCounters: FloatingTileRenderCounters = FloatingTileRenderCounters()
        private set
    private val mapLabels = ArrayList<MapLabel>(64)
    private fun px(dp: Float) = dp * density
    private fun text(canvas: Canvas, value: String, x: Float, baseline: Float, size: Float, color: Int, align: Paint.Align = Paint.Align.LEFT, maxWidthPx: Float = width - px(16f)) {
        p.color = color; p.textSize = px(size); p.typeface = android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.NORMAL); p.textAlign = align
        val safe = value.take(42)
        val shown = if (p.measureText(safe) > maxWidthPx) android.text.TextUtils.ellipsize(safe, android.text.TextPaint(p), maxWidthPx, android.text.TextUtils.TruncateAt.END).toString() else safe
        canvas.drawText(shown, x, baseline, p)
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        p.color = if (lockscreenPresentation || outdoorContours) android.graphics.Color.BLACK else 0xff07130e.toInt()
        if (lockscreenPresentation) canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), p)
        else canvas.drawRoundRect(0f, 0f, width.toFloat(), height.toFloat(), round, round, p)
        val header = if (lockscreenPresentation) 0f else px(32f)
        if (!lockscreenPresentation) drawCompactToolbar(canvas)
        val left = 0f
        val top = header
        val right = width - left
        val bottom = height.toFloat()
        p.color = if (lockscreenPresentation || outdoorContours) android.graphics.Color.BLACK else 0xff0a1a12.toInt()
        canvas.drawRect(left, top, right, bottom, p)
        canvas.save(); canvas.clipRect(left, top, right, bottom)
        mapLabels.clear()
        val navCenter = center
        if (navCenter != null) {
            val bearing = mapBearing?.takeIf { it.isFinite() && it in 0.0..<360.0 }
            val cX = (left + right) / 2f; val cY = (top + bottom) / 2f
            if (mode == "compass" && bearing == null) {
                renderCounters = FloatingTileRenderCounters()
                text(canvas, stateText.ifBlank { "等待罗盘方向" }, cX, top + (bottom - top) * .72f,
                    10f, 0xffb7c59c.toInt(), Paint.Align.CENTER)
                drawPositionGlyph(canvas, cX, cY, null)
            } else if (outdoorContours) {
                val cameraBearing = if (mode == "north") 0.0 else bearing ?: 0.0
                renderCounters = FloatingTileRenderCounters()
                val scene = terrainScene
                if (scene != null && scene.tiles.isNotEmpty()) {
                    contourTerrainRenderer.draw(canvas, RectF(left, top, right, bottom), scene, navCenter, zoom,
                        cameraBearing, route, recordedSegments, routeColor)
                    if (!contourTerrainRenderer.lastFrameHasTerrain) {
                        text(canvas, if (terrainLoading) "正在加载真实高程" else "当前位置高程暂不可用", cX,
                            top + (bottom - top) * .72f, 10f, 0xff9bb477.toInt(), Paint.Align.CENTER)
                    }
                } else {
                    text(canvas, if (terrainLoading) "正在加载真实高程" else "当前高程暂不可用", cX,
                        top + (bottom - top) * .72f, 10f, 0xff9bb477.toInt(), Paint.Align.CENTER)
                }
                drawPositionGlyph(canvas, cX, cY, heading?.minus(cameraBearing))
            } else {
                canvas.save(); if ((mode == "motion" || mode == "compass") && bearing != null) canvas.rotate(-bearing.toFloat(), cX, cY)
                drawTiles(canvas, navCenter, cX, cY)
                drawRoute(canvas, navCenter, cX, cY)
                drawRecordedTrack(canvas, navCenter, cX, cY)
                // The center glyph is shown only when supplied by a real current location.
                if (hasRealLocation && heading != null) {
                    canvas.save(); canvas.translate(cX, cY); canvas.rotate(heading!!.toFloat()); canvas.scale(px(11.5f), px(11.5f))
                    p.color = 0x5537dfff.toInt(); canvas.drawCircle(0f, 0f, .92f, p)
                    p.color = 0xaa37dfff.toInt(); canvas.drawCircle(0f, 0f, .68f, p)
                    p.color = 0xff8af0f3.toInt(); canvas.drawPath(arrowPath, p)
                    p.color = 0xff21bdd0.toInt(); canvas.drawCircle(0f, .24f, .15f, p)
                    canvas.restore()
                } else if (hasRealLocation) {
                    p.color = 0x3337dfff; canvas.drawCircle(cX, cY, px(13f), p)
                    p.color = 0x7737dfff.toInt(); canvas.drawCircle(cX, cY, px(9f), p)
                    p.color = 0xff45dbe7.toInt(); canvas.drawCircle(cX, cY, px(5f), p)
                }
                canvas.restore()
                drawMapLabels(canvas, left, top, right, bottom)
            }
        } else {
            renderCounters = FloatingTileRenderCounters()
            text(canvas, "等待定位", (left + right) / 2f, (top + bottom) / 2f, 12f, 0xffbdff54.toInt(), Paint.Align.CENTER)
        }
        canvas.restore()
        if (mode != "compass" || mapBearing?.let { it.isFinite() && it in 0.0..<360.0 } == true) {
            drawNorthReference(canvas, (left + right) / 2f, (top + bottom) / 2f,
                min(right - left, bottom - top) * .32f)
        }
        if (lockscreenPresentation) {
            // The activity fades the complete drawing, including text, into pure black.
            // Attribution remains available in Tools source details.
            text(canvas, if (kind == "route") "山兔导航 · $label" else "山兔定位", width / 2f, height * .18f,
                12f, 0xffbdff54.toInt(), Paint.Align.CENTER, width * .6f)
            return
        }
        // Direction reference; never substitute route direction when heading is absent.
        drawResizeGrip(canvas)
    }

    /** Screen-space direction stays readable; route geometry never supplies a heading. */
    private fun drawPositionGlyph(canvas: Canvas, x: Float, y: Float, relativeHeading: Double?) {
        if (!hasRealLocation) return
        if (relativeHeading != null && relativeHeading.isFinite()) {
            canvas.save()
            canvas.translate(x, y)
            canvas.rotate(relativeHeading.toFloat())
            canvas.scale(px(14f), px(14f))
            p.color = 0x4437dfff; canvas.drawCircle(0f, 0f, 1.05f, p)
            p.color = 0xff9af7ff.toInt(); canvas.drawPath(arrowPath, p)
            canvas.restore()
        } else {
            p.color = 0x5537dfff; canvas.drawCircle(x, y, px(10f), p)
            p.color = 0xff45dbe7.toInt(); canvas.drawCircle(x, y, px(5f), p)
        }
    }

    private fun drawNorthReference(canvas: Canvas, cx: Float, cy: Float, radius: Float) {
        val cameraBearing = if (mode == "motion" || mode == "compass")
            mapBearing?.takeIf { it.isFinite() && it in 0.0..<360.0 } ?: 0.0 else 0.0
        val radians = Math.toRadians(cameraBearing)
        val x = cx - (sin(radians) * radius).toFloat()
        val y = cy - (cos(radians) * radius).toFloat()
        p.style = Paint.Style.FILL; p.color = 0xc0000000.toInt()
        canvas.drawCircle(x, y, px(11f), p)
        p.style = Paint.Style.STROKE; p.strokeWidth = px(1f); p.color = 0xffbdff54.toInt()
        canvas.drawCircle(x, y, px(11f), p)
        p.style = Paint.Style.FILL
        text(canvas, "N", x, y + px(5f), 14f, 0xffeaffc2.toInt(), Paint.Align.CENTER, px(20f))
    }

    /** Labels use screen coordinates after the map rotation, so text stays upright. */
    private fun drawMapLabels(canvas: Canvas, left: Float, top: Float, right: Float, bottom: Float) {
        p.textSize = px(7.5f); p.textAlign = Paint.Align.CENTER
        p.typeface = android.graphics.Typeface.create("sans-serif", android.graphics.Typeface.NORMAL)
        val occupied = ArrayList<RectF>(14)
        for (label in mapLabels) {
            if (occupied.size >= 14) break
            val halfWidth = p.measureText(label.text) / 2f + px(2f)
            val bounds = RectF(label.x - halfWidth, label.y - p.textSize, label.x + halfWidth, label.y + px(2f))
            if (bounds.left < left + px(2f) || bounds.right > right - px(2f) ||
                bounds.top < top + px(2f) || bounds.bottom > bottom - px(2f) ||
                occupied.any { RectF.intersects(it, bounds) }) continue
            p.style = Paint.Style.STROKE; p.strokeWidth = px(1.6f); p.color = android.graphics.Color.BLACK
            canvas.drawText(label.text, label.x, label.y, p)
            p.style = Paint.Style.FILL; p.color = 0xffc7d4c9.toInt()
            canvas.drawText(label.text, label.x, label.y, p)
            occupied += bounds
        }
        p.style = Paint.Style.FILL
    }

    private fun drawCompactToolbar(canvas: Canvas) {
        p.color = 0xff10251a.toInt()
        canvas.drawRect(0f, 0f, width.toFloat(), px(32f), p)
        val symbols = arrayOf("‹", when (mode) { "north" -> "N"; "compass" -> "罗"; else -> "↑" },
            when (recordingPhase) { "recording" -> "Ⅱ"; "paused" -> "▶"; "finished" -> "✓"; else -> "●" },
            "−", "+", "×")
        val slot = width / symbols.size.toFloat()
        symbols.forEachIndexed { i, symbol ->
            text(canvas, symbol, slot * (i + .5f), px(22f), if (i == 1 || i == 2) 14f else 21f,
                if (i == 2) 0xffffdf4f.toInt() else if (i == 5) 0xffd6c66e.toInt() else 0xffbdff54.toInt(),
                Paint.Align.CENTER, slot - px(2f))
        }
        contentDescription = "悬浮地图：返回应用，${when (mode) { "north" -> "指北"; "compass" -> "罗盘朝上"; else -> "运动朝上" }}，轨迹${recordingPhase}，缩小，放大，关闭小窗。拖动地图移动窗口，拖右下角改变大小"
    }

    private fun drawResizeGrip(canvas: Canvas) {
        val right = width - px(4f); val bottom = height - px(3f)
        line.color = 0xffbdff54.toInt(); line.strokeWidth = px(1.4f)
        for (i in 0..2) canvas.drawLine(right - px(12f + i * 4f), bottom, right, bottom - px(12f + i * 4f), line)
    }

    private fun drawRecordedTrack(canvas: Canvas, center: FloatingCoordinate, cx: Float, cy: Float) {
        val path = cachedRecordedPath(center, cx, cy) ?: return
        line.color = 0x38ffda38; line.strokeWidth = px(9f); canvas.drawPath(path, line)
        line.color = 0x76ffda38; line.strokeWidth = px(5.5f); canvas.drawPath(path, line)
        line.color = 0xffffdf4f.toInt(); line.strokeWidth = px(2.6f); canvas.drawPath(path, line)
    }

    private fun cachedRecordedPath(center: FloatingCoordinate, cx: Float, cy: Float): Path? {
        recordedPath?.let { return it }
        if (recordedSegments.none { it.size >= 2 }) return null
        val path = Path()
        val tileSize = px(256f * FloatingNavigationGeometry.overzoomScale(zoom).toFloat())
        for (segment in recordedSegments) {
            if (segment.size < 2) continue
            segment.forEachIndexed { index, coordinate ->
                val point = FloatingNavigationGeometry.projectTileAligned(center, coordinate, 14, cx, cy, tileSize)
                if (index == 0) path.moveTo(point.x, point.y) else path.lineTo(point.x, point.y)
            }
        }
        recordedPathCenter = center
        recordedPath = path
        return path
    }

    private fun rebuildTileSummaries(value: List<FloatingTileGeometry>) {
        val next = ArrayList<TileRenderSummary>()
        val byIndex = HashMap<FloatingTileIndex, TileRenderSummary>()
        for (tile in value) {
            if (tile.z != 14) continue
            val key = TileCacheKey(tile.z, tile.x, tile.y)
            val summary = tileSummaryCache[key]?.takeIf { it.tile === tile } ?: summarizeTile(tile).also {
                tileSummaryCache[key] = it
                while (tileSummaryCache.size > 32) tileSummaryCache.entries.iterator().run { next(); remove() }
            }
            next += summary
            byIndex[summary.index] = summary
        }
        tileSummaries = next
        tileSummaryByIndex = byIndex
        tileIndices = next.map { it.index }
    }

    /** Build immutable per-path bounds once per tile object, never by walking vertices on compass frames. */
    private fun summarizeTile(tile: FloatingTileGeometry): TileRenderSummary {
        val index = FloatingTileIndex(tile.x, tile.y)
        val labels = ArrayList<TileLabelSummary>()
        val paths = ArrayList<TilePathSummary>()
        for (feature in tile.features) {
            val layer = feature.layer.lowercase()
            val isBuilding = layer.contains("building")
            val isRoad = layer in setOf("transportation", "road", "roads") || layer.contains("transport") || layer.contains("road")
            val isWater = layer in setOf("water", "waterway", "landuse") && (layer != "landuse" || feature.properties["class"]?.contains("water", true) == true)
            val isLabel = layer.contains("label") || layer.contains("place") || layer.contains("poi")
            if (isLabel) {
                if (feature.type != 1) continue
                val title = feature.properties["name:zh"] ?: feature.properties["name"] ?: feature.properties["name:en"] ?: feature.properties["name:latin"]
                if (title.isNullOrBlank() || feature.extent <= 0) continue
                feature.paths.forEach { points -> points.firstOrNull()?.let { labels += TileLabelSummary(title.take(16), it.first, it.second, feature.extent) } }
                continue
            }
            if (!isBuilding && !isRoad && !isWater) continue
            for (points in feature.paths) {
                if (points.isEmpty() || feature.extent <= 0) continue
                var minX = Int.MAX_VALUE; var minY = Int.MAX_VALUE; var maxX = Int.MIN_VALUE; var maxY = Int.MIN_VALUE
                for (point in points) {
                    minX = min(minX, point.first); minY = min(minY, point.second)
                    maxX = max(maxX, point.first); maxY = max(maxY, point.second)
                }
                val roadClass = feature.properties["class"]
                val skeleton = isRoad && roadClass in setOf("motorway", "trunk", "primary")
                paths += TilePathSummary(
                    tile, feature, points,
                    FloatingPathBudgetCandidate(index, points.size, skeleton),
                    isBuilding, isRoad, isWater, minX, minY, maxX, maxY,
                )
            }
        }
        return TileRenderSummary(tile, index, labels, paths)
    }

    private fun drawTiles(canvas: Canvas, center: FloatingCoordinate, cx: Float, cy: Float) {
        val z = 14; val n = 1 shl z
        val worldX = (center.longitude + 180.0) / 360.0 * n
        val lat = Math.toRadians(center.latitude.coerceIn(-85.05112878, 85.05112878))
        val worldY = (1.0 - ln(tan(lat) + 1.0 / cos(lat)) / Math.PI) / 2.0 * n
        val scale = px(256f * FloatingNavigationGeometry.overzoomScale(zoom).toFloat())
        val cameraBearing = if (mode == "motion" || mode == "compass") mapBearing?.takeIf { it.isFinite() && it in 0.0..<360.0 } ?: 0.0 else 0.0
        val viewportWidth = width.toFloat().coerceAtLeast(0f)
        val viewportHeight = (height - if (lockscreenPresentation) 0f else px(32f)).coerceAtLeast(0f)
        val orderedIndices = FloatingNavigationGeometry.prioritizeTileIndices(tileIndices, worldX, worldY, n, cameraBearing)
        visiblePathsScratch.clear(); budgetCandidatesScratch.clear(); budgetTilesScratch.clear(); visibleTilePlacementsScratch.clear()
        var visibleTileCount = 0
        for (tileIndex in orderedIndices) {
            val summary = tileSummaryByIndex[tileIndex] ?: continue
            val tile = summary.tile
            var dxTile = tile.x - worldX
            if (dxTile > n / 2.0) dxTile -= n
            if (dxTile < -n / 2.0) dxTile += n
            val dyTile = tile.y - worldY
            val tileBuffer = scale * .10
            if (!FloatingNavigationGeometry.intersectsRotatedViewport(
                    cx.toDouble() + dxTile * scale.toDouble() - tileBuffer.toDouble(),
                    cy.toDouble() + dyTile * scale.toDouble() - tileBuffer.toDouble(),
                    cx.toDouble() + (dxTile + 1.0) * scale.toDouble() + tileBuffer.toDouble(),
                    cy.toDouble() + (dyTile + 1.0) * scale.toDouble() + tileBuffer.toDouble(),
                    cx.toDouble(), cy.toDouble(), viewportWidth.toDouble(), viewportHeight.toDouble(), cameraBearing,
                )) continue
            visibleTileCount++
            visibleTilePlacementsScratch += TilePlacement(summary, dxTile, dyTile)

            // Labels use their own small cap and never consume geometry vertices.
            for (label in summary.labels) {
                if (mapLabels.size >= 64) break
                val x = ((dxTile + label.x.toDouble() / label.extent) * scale).toFloat()
                val y = ((dyTile + label.y.toDouble() / label.extent) * scale).toFloat()
                val radians = Math.toRadians(-cameraBearing)
                val sx = cx + (x * cos(radians) - y * sin(radians)).toFloat()
                val sy = cy + (x * sin(radians) + y * cos(radians)).toFloat()
                if (sx in 0f..width.toFloat() && sy in 0f..height.toFloat()) mapLabels += MapLabel(label.text, sx, sy)
            }

        }

        var oversizePathCount = 0
        var candidateLimitSkipped = 0
        for ((tileOrdinal, placement) in visibleTilePlacementsScratch.withIndex()) {
            val summary = placement.summary
            val dxTile = placement.dxTile
            val dyTile = placement.dyTile
            val tileCandidateLimit = FloatingNavigationGeometry.pathCandidateLimit(tileOrdinal, visibleTilePlacementsScratch.size)
            var tileCandidateCount = 0
            var tileHasVisiblePath = false
            for (path in summary.paths) {
                val feature = path.feature
                val minX = cx + ((dxTile + path.minX.toDouble() / feature.extent) * scale).toFloat()
                val minY = cy + ((dyTile + path.minY.toDouble() / feature.extent) * scale).toFloat()
                val maxX = cx + ((dxTile + path.maxX.toDouble() / feature.extent) * scale).toFloat()
                val maxY = cy + ((dyTile + path.maxY.toDouble() / feature.extent) * scale).toFloat()
                if (!FloatingNavigationGeometry.intersectsRotatedViewport(
                        minX.toDouble(), minY.toDouble(), maxX.toDouble(), maxY.toDouble(),
                        cx.toDouble(), cy.toDouble(), viewportWidth.toDouble(), viewportHeight.toDouble(), cameraBearing,
                    )) continue
                if (path.points.size > FloatingNavigationGeometry.MAX_TILE_DRAW_VERTICES) {
                    oversizePathCount++
                    continue
                }
                if (tileCandidateCount >= tileCandidateLimit) {
                    candidateLimitSkipped++
                    continue
                }
                visiblePathsScratch += path
                budgetCandidatesScratch += path.candidate
                tileCandidateCount++
                tileHasVisiblePath = true
            }
            if (tileHasVisiblePath) budgetTilesScratch += summary.index
        }

        val allocation = FloatingNavigationGeometry.allocatePathBudget(
            budgetTilesScratch, budgetCandidatesScratch, FloatingNavigationGeometry.MAX_TILE_DRAW_VERTICES,
        )
        for (candidateIndex in allocation.selected) {
            val pathSummary = visiblePathsScratch[candidateIndex]
            val feature = pathSummary.feature
            val tile = pathSummary.tile
            var dxTile = tile.x - worldX
            if (dxTile > n / 2.0) dxTile -= n
            if (dxTile < -n / 2.0) dxTile += n
            val dyTile = tile.y - worldY
            when {
                pathSummary.isBuilding -> { p.color = 0xff294331.toInt(); line.color = 0xff41604a.toInt(); line.strokeWidth = px(.45f) }
                pathSummary.isRoad -> {
                    val major = feature.properties["class"] in setOf("motorway", "trunk", "primary")
                    line.color = if (major) 0xff78916b.toInt() else 0xff4d6651.toInt()
                    line.strokeWidth = px(if (major) 1.5f else .8f)
                }
                pathSummary.isWater -> { p.color = 0xff12352e.toInt(); line.color = p.color; line.strokeWidth = px(1f) }
            }
            val path = Path()
            pathSummary.points.forEachIndexed { pointIndex, xy ->
                val x = cx + ((dxTile + xy.first.toDouble() / feature.extent) * scale).toFloat()
                val y = cy + ((dyTile + xy.second.toDouble() / feature.extent) * scale).toFloat()
                if (pointIndex == 0) path.moveTo(x, y) else path.lineTo(x, y)
            }
            when {
                pathSummary.isBuilding && feature.type == 3 -> { canvas.drawPath(path, p); canvas.drawPath(path, line) }
                pathSummary.isWater && feature.type == 3 -> { p.color = 0xff12352e.toInt(); line.color = 0xff1d463a.toInt(); line.strokeWidth = px(.6f); canvas.drawPath(path, p); canvas.drawPath(path, line) }
                (pathSummary.isRoad || pathSummary.isWater) && feature.type != 1 -> canvas.drawPath(path, line)
            }
        }
        renderCounters = FloatingTileRenderCounters(
            visibleTileCount,
            budgetCandidatesScratch.size,
            allocation.selected.size,
            allocation.acceptedVertices,
            allocation.skippedPaths + oversizePathCount,
            candidateLimitSkipped,
        )
    }

    private fun drawRoute(canvas: Canvas, c: FloatingCoordinate, cx: Float, cy: Float) {
        if (route.size < 2) return
        // Both MVT geometry and route use identical z14 world pixels. The motion camera rotates once outside.
        // Preserve bends with subpixel Douglas-Peucker simplification; the source route is never truncated.
        val path = cachedRoutePath(c, cx, cy)
        // Low-alpha solid strokes give a restrained neon halo without blur filters or per-frame allocations.
        val rgb = routeColor and 0x00ffffff
        line.color = (0x28 shl 24) or rgb; line.strokeWidth = px(10f); canvas.drawPath(path, line)
        line.color = (0x54 shl 24) or rgb; line.strokeWidth = px(6.5f); canvas.drawPath(path, line)
        line.color = (0xff shl 24) or rgb; line.strokeWidth = px(3.1f); canvas.drawPath(path, line)
    }

    private fun cachedRoutePath(c: FloatingCoordinate, cx: Float, cy: Float): Path {
        routePath?.let { return it }
        val points = route.map { FloatingNavigationGeometry.projectTileAligned(c, it, 14, cx, cy, px(256f * FloatingNavigationGeometry.overzoomScale(zoom).toFloat())) }
        val keep = BooleanArray(points.size)
        if (points.isNotEmpty()) { keep[0] = true; keep[points.lastIndex] = true }
        val ranges = java.util.ArrayDeque<IntRange>()
        if (points.size > 2) ranges.addLast(0..points.lastIndex)
        val toleranceSquared = .35f * .35f
        while (ranges.isNotEmpty()) {
            val range = ranges.removeLast(); val first = points[range.first]; val last = points[range.last]
            val dx = last.x - first.x; val dy = last.y - first.y; val denom = dx * dx + dy * dy
            var maxDistance = toleranceSquared; var farthest = -1
            for (i in range.first + 1 until range.last) {
                val point = points[i]
                val t = if (denom <= 1e-12f) 0f else (((point.x - first.x) * dx + (point.y - first.y) * dy) / denom).coerceIn(0f, 1f)
                val px = first.x + t * dx; val py = first.y + t * dy
                val ddx = point.x - px; val ddy = point.y - py; val distance = ddx * ddx + ddy * ddy
                if (distance > maxDistance) { maxDistance = distance; farthest = i }
            }
            if (farthest >= 0) { keep[farthest] = true; ranges.addLast(range.first..farthest); ranges.addLast(farthest..range.last) }
        }
        val path = Path()
        var started = false
        for (i in points.indices) if (keep[i]) {
            val point = points[i]
            if (!started) { path.moveTo(point.x, point.y); started = true } else path.lineTo(point.x, point.y)
        }
        routePathCenter = c; routePath = path
        return path
    }

    private fun worldPixelDistance(a: FloatingCoordinate, b: FloatingCoordinate): Double {
        val n = 1 shl 14
        var dx = (b.longitude - a.longitude) / 360.0 * n
        if (dx > n / 2.0) dx -= n
        if (dx < -n / 2.0) dx += n
        fun y(lat: Double): Double { val r = Math.toRadians(lat.coerceIn(-85.05112878, 85.05112878)); return (1.0 - ln(tan(r) + 1.0 / cos(r)) / Math.PI) / 2.0 * n }
        return hypot(dx, y(b.latitude) - y(a.latitude)) * 256.0 * px(1f)
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        routePath = null; recordedPath = null
        if (w > 0 && h > 0 && (w != oldw || h != oldh)) post { onContentSizeChanged?.invoke() }
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (lockscreenPresentation) return false
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                downX = event.rawX; downY = event.rawY
                initialRawX = downX; initialRawY = downY
                dragging = false
                resizing = event.x >= width - px(26f) && event.y >= height - px(26f)
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                val dx = event.rawX - downX; val dy = event.rawY - downY
                downX = event.rawX; downY = event.rawY
                if (resizing) { onResize?.invoke(dx, dy); return true }
                if (hypot(event.rawX - initialRawX, event.rawY - initialRawY) > px(6f)) dragging = true
                if (dragging) onDrag?.invoke(dx, dy)
                return true
            }
            MotionEvent.ACTION_UP -> {
                if (dragging || resizing) { dragging = false; resizing = false; return true }
                if (event.y < px(32f)) when ((event.x / (width / 6f)).toInt().coerceIn(0, 5)) {
                    0 -> onReturn?.invoke()
                    1 -> onMode?.invoke()
                    2 -> {
                        val action = when (recordingPhase) { "recording" -> "pause"; "paused" -> "resume"; "idle" -> "start"; else -> null }
                        if (action == null) onReturn?.invoke() else onRecordAction?.invoke(action)
                    }
                    3 -> onZoom?.invoke(-1)
                    4 -> onZoom?.invoke(1)
                    5 -> onClose?.invoke()
                }
                performClick(); return true
            }
            MotionEvent.ACTION_CANCEL -> { dragging = false; resizing = false; return true }
        }
        return true
    }

    override fun performClick(): Boolean { super.performClick(); return true }
}
