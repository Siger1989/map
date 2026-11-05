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

/** Small non-GL overlay. Geometry is supplied by a bounded service cache and drawn only when invalidated. */
internal class FloatingNavigationView(context: Context) : View(context) {
    var route: List<FloatingCoordinate> = emptyList(); set(value) { if (field !== value) { field = value; routePath = null; invalidate() } }
    var center: FloatingCoordinate? = null; set(value) {
        if (field != value) {
            val prior = routePathCenter
            if (value == null || prior == null || worldPixelDistance(prior, value) > .75) routePath = null
            field = value; invalidate()
        }
    }
    var hasRealLocation: Boolean = false; set(value) { field = value; invalidate() }
    var heading: Double? = null; set(value) { field = value; invalidate() }
    var mode: String = "north"; set(value) { field = value; invalidate() }
    var stateText: String = "等待定位"; set(value) { field = value; invalidate() }
    var routeRemainingMeters: Double? = null; set(value) { field = value; invalidate() }
    var routeOffRoute: Boolean = false; set(value) { field = value; invalidate() }
    var label: String = "路线"; set(value) { field = value; invalidate() }
    var tiles: List<FloatingTileGeometry> = emptyList(); set(value) { field = value; invalidate() }
    var onMode: (() -> Unit)? = null
    var onReturn: (() -> Unit)? = null
    var onClose: (() -> Unit)? = null
    var onDrag: ((Float, Float) -> Unit)? = null

    private val density = resources.displayMetrics.density
    private val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val line = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND }
    private val round = density * 8f
    private var downX = 0f; private var downY = 0f; private var dragging = false
    private var routePath: Path? = null
    private var routePathCenter: FloatingCoordinate? = null
    private fun px(dp: Float) = dp * density
    private fun text(canvas: Canvas, value: String, x: Float, baseline: Float, size: Float, color: Int, align: Paint.Align = Paint.Align.LEFT, maxWidthPx: Float = width - px(16f)) {
        p.color = color; p.textSize = px(size); p.typeface = android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.NORMAL); p.textAlign = align
        val safe = value.take(42)
        val shown = if (p.measureText(safe) > maxWidthPx) android.text.TextUtils.ellipsize(safe, android.text.TextPaint(p), maxWidthPx, android.text.TextUtils.TruncateAt.END).toString() else safe
        canvas.drawText(shown, x, baseline, p)
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        p.color = 0xff07130e.toInt(); canvas.drawRoundRect(0f, 0f, width.toFloat(), height.toFloat(), round, round, p)
        val header = px(40f); val footer = px(42f)
        p.color = 0xff10251a.toInt(); canvas.drawRoundRect(RectF(px(2f), px(2f), width - px(2f), header), round, round, p)
        text(canvas, "‹", px(15f), px(27f), 24f, 0xffbdff54.toInt())
        text(canvas, label.ifBlank { "路线" }, px(33f), px(25f), 11.5f, 0xfff2f7f1.toInt(), maxWidthPx = width - px(97f))
        text(canvas, if (mode == "north") "北向" else "行进", width - px(47f), px(25f), 10f, 0xffbdff54.toInt(), Paint.Align.CENTER)
        text(canvas, "×", width - px(13f), px(25f), 21f, 0xffbdff54.toInt(), Paint.Align.CENTER)
        val left = px(5f); val top = header; val right = width - px(5f); val bottom = height - footer
        p.color = 0xff0a1a12.toInt(); canvas.drawRect(left, top, right, bottom, p)
        canvas.save(); canvas.clipRect(left, top, right, bottom)
        val navCenter = center
        if (navCenter != null) {
            val bearing = heading?.takeIf { it.isFinite() && it in 0.0..<360.0 }
            val cX = (left + right) / 2f; val cY = (top + bottom) / 2f
            canvas.save(); if (mode == "motion" && bearing != null) canvas.rotate(-bearing.toFloat(), cX, cY)
            drawTiles(canvas, navCenter, cX, cY)
            drawRoute(canvas, navCenter, cX, cY)
            // The center glyph is shown only when supplied by a real current location.
            if (hasRealLocation && heading != null) {
                canvas.save(); canvas.rotate(heading!!.toFloat(), cX, cY)
                val arrow = Path().apply { moveTo(cX, cY - px(9f)); lineTo(cX + px(5f), cY + px(6f)); lineTo(cX, cY + px(3f)); lineTo(cX - px(5f), cY + px(6f)); close() }
                p.color = 0xffe9f3eb.toInt(); canvas.drawPath(arrow, p); p.color = 0xffbdff54.toInt(); canvas.drawCircle(cX, cY, px(1.8f), p)
                canvas.restore()
            } else if (hasRealLocation) { p.color = 0xffbdff54.toInt(); canvas.drawCircle(cX, cY, px(3f), p) }
            canvas.restore()
        } else {
            text(canvas, "等待定位", (left + right) / 2f, (top + bottom) / 2f, 12f, 0xffbdff54.toInt(), Paint.Align.CENTER)
        }
        canvas.restore()
        p.color = 0xff10251a.toInt(); canvas.drawRect(px(2f), height - footer, width - px(2f), height - px(2f), p)
        val routeStatus = if (routeOffRoute) "偏离路线" else routeRemainingMeters?.let { "剩余 ${if (it >= 1000) String.format(java.util.Locale.ROOT, "%.1fkm", it / 1000.0) else "${it.roundToInt()}m"}" }
        text(canvas, routeStatus?.let { "$stateText · $it" } ?: stateText, px(8f), height - px(30f), 8f, if (routeOffRoute) 0xffffca73.toInt() else 0xffbdff54.toInt())
        text(canvas, "OpenFreeMap · © OpenMapTiles", px(8f), height - px(17f), 7f, 0xffc1cfc5.toInt())
        text(canvas, "© OpenStreetMap", px(8f), height - px(5f), 7f, 0xffc1cfc5.toInt())
        // Direction reference; never substitute route direction when heading is absent.
        text(canvas, if (mode == "north" || heading == null) "N ↑" else "↑", width - px(17f), (top + bottom) / 2f + px(4f), 10f, 0xffe9f3eb.toInt(), Paint.Align.CENTER)
    }

    private fun drawTiles(canvas: Canvas, center: FloatingCoordinate, cx: Float, cy: Float) {
        val z = 14; val n = 1 shl z
        val worldX = (center.longitude + 180.0) / 360.0 * n
        val lat = Math.toRadians(center.latitude.coerceIn(-85.05112878, 85.05112878))
        val worldY = (1.0 - ln(tan(lat) + 1.0 / cos(lat)) / Math.PI) / 2.0 * n
        val scale = px(256f)
        var vertexBudget = 8_000
        var labelBudget = 14
        for (tile in tiles) {
            if (tile.z != z) continue
            var dxTile = tile.x - worldX
            if (dxTile > n / 2.0) dxTile -= n
            if (dxTile < -n / 2.0) dxTile += n
            val dyTile = tile.y - worldY
            for (feature in tile.features) {
                if (vertexBudget <= 0) break
                val layer = feature.layer.lowercase()
                val isBuilding = layer.contains("building")
                val isRoad = layer in setOf("transportation", "road", "roads") || layer.contains("transport") || layer.contains("road")
                val isWater = layer in setOf("water", "waterway", "landuse") && (layer != "landuse" || feature.properties["class"]?.contains("water", true) == true)
                val isLabel = layer.contains("label") || layer.contains("place") || layer.contains("poi")
                if (!isBuilding && !isRoad && !isWater && !isLabel) continue
                if (isLabel && feature.type != 1) continue
                if (isLabel && labelBudget <= 0) continue
                if (isBuilding) { p.color = 0xff294331.toInt(); line.color = 0xff41604a.toInt(); line.strokeWidth = px(.45f) }
                else if (isRoad) { line.color = if (feature.properties["class"] in setOf("motorway", "trunk", "primary")) 0xff78916b.toInt() else 0xff4d6651.toInt(); line.strokeWidth = px(if (feature.properties["class"] in setOf("motorway", "trunk", "primary")) 1.5f else .8f) }
                else if (isWater) { p.color = 0xff12352e.toInt(); line.color = p.color; line.strokeWidth = px(1f) }
                else { p.color = 0xffc7d4c9.toInt(); p.textSize = px(7f); p.textAlign = Paint.Align.CENTER }
                for (points in feature.paths) {
                    if (points.isEmpty() || vertexBudget <= 0) continue
                    // Never cut a ring or road part at the budget edge; that would invent a false polygon closure.
                    if (points.size > vertexBudget) continue
                    val path = Path()
                    var minX = Float.POSITIVE_INFINITY; var maxX = Float.NEGATIVE_INFINITY; var minY = Float.POSITIVE_INFINITY; var maxY = Float.NEGATIVE_INFINITY
                    points.forEachIndexed { index, xy ->
                        val x = cx + ((dxTile + xy.first.toDouble() / feature.extent) * scale).toFloat()
                        val y = cy + ((dyTile + xy.second.toDouble() / feature.extent) * scale).toFloat()
                        minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y)
                        if (index == 0) path.moveTo(x, y) else path.lineTo(x, y)
                    }
                    // The final Canvas clip runs after camera rotation. An unrotated box
                    // cannot reject geometry in motion mode: corners can rotate into view.
                    if (mode == "north" && (maxX < 0f || minX > width || maxY < px(40f) || minY > height - px(42f))) continue
                    vertexBudget -= points.size
                    if (isLabel) labelBudget--
                    when {
                        isBuilding && feature.type == 3 -> { canvas.drawPath(path, p); canvas.drawPath(path, line) }
                        isWater && feature.type == 3 -> { p.color = 0xff12352e.toInt(); line.color = 0xff1d463a.toInt(); line.strokeWidth = px(.6f); canvas.drawPath(path, p); canvas.drawPath(path, line) }
                        (isRoad || isWater) && feature.type != 1 -> canvas.drawPath(path, line)
                        isLabel -> {
                            val point = points.first(); val x = cx + ((dxTile + point.first.toDouble() / feature.extent) * scale).toFloat(); val y = cy + ((dyTile + point.second.toDouble() / feature.extent) * scale).toFloat()
                            val title = feature.properties["name:en"] ?: feature.properties["name"] ?: feature.properties["name:latin"]
                            if (!title.isNullOrBlank() && x in 10f..width - 10f && y in px(47f)..height - px(47f)) canvas.drawText(title.take(14), x, y, p)
                        }
                    }
                }
            }
        }
    }

    private fun drawRoute(canvas: Canvas, c: FloatingCoordinate, cx: Float, cy: Float) {
        if (route.size < 2) return
        // Both MVT geometry and route use identical z14 world pixels. The motion camera rotates once outside.
        // Preserve bends with subpixel Douglas-Peucker simplification; the source route is never truncated.
        val path = cachedRoutePath(c, cx, cy)
        line.color = 0xfff0f4ed.toInt(); line.strokeWidth = px(5f); canvas.drawPath(path, line)
        line.color = 0xffbaff42.toInt(); line.strokeWidth = px(2.8f); canvas.drawPath(path, line)
    }

    private fun cachedRoutePath(c: FloatingCoordinate, cx: Float, cy: Float): Path {
        routePath?.let { return it }
        val points = route.map { FloatingNavigationGeometry.projectTileAligned(c, it, 14, cx, cy, px(256f)) }
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

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) { super.onSizeChanged(w, h, oldw, oldh); routePath = null }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> { downX = event.rawX; downY = event.rawY; dragging = event.y < px(40f) && event.x in px(27f)..width - px(72f); return true }
            MotionEvent.ACTION_MOVE -> if (dragging) { val dx = event.rawX - downX; val dy = event.rawY - downY; downX = event.rawX; downY = event.rawY; onDrag?.invoke(dx, dy); return true }
            MotionEvent.ACTION_UP -> {
                if (dragging) return true
                val x = event.x; val y = event.y
                if (y < px(40f) && x < px(28f)) onReturn?.invoke()
                else if (y < px(40f) && x > width - px(28f)) onClose?.invoke()
                else if (y < px(40f) && x > width - px(72f)) onMode?.invoke()
                performClick(); return true
            }
        }
        return true
    }

    override fun performClick(): Boolean { super.performClick(); return true }
}
