// Shantu Android review patch, 2026-11-05. Licensed under Apache-2.0.
package earth.worldwind.layer.mvt

import earth.worldwind.geom.Vec2
import kotlin.math.atan2
import kotlin.math.ceil
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.PI
import kotlin.math.sin
import kotlin.math.sqrt

/** Pure geometry shared by the Android metrics adapter and the host-only checks. */
internal object MvtLabelCollisionMath {
    // Keys own no window/context. Each collider invocation installs a fresh lightweight pass token.
    val linePassKey = Any()
    val lineMetricsKey = Any()
    const val LINE_STATS_SIZE = 11
    const val MAX_PROJECTION_ERROR_PX = 2.0
    const val MAX_ADJACENT_TURN_RADIANS = PI / 6.0
    const val MAX_RUN_TURN_RADIANS = PI / 3.0

    fun textureHeight(top: Float, bottom: Float, lines: Int, strokePad: Int): Double =
        (ceil(-top) + ceil(bottom)).toDouble() * lines + 2.0 + 2.0 * strokePad

    /** Same bottom-left OpenGL coordinates, textOffset and scale as Label.makeDrawable. */
    fun bounds(
        screenX: Double, screenY: Double,
        width: Double, height: Double,
        offsetX: Double, offsetY: Double,
        scale: Double, padding: Float,
        result: FloatArray,
    ) {
        val x0 = screenX - offsetX * scale
        val y0 = screenY - offsetY * scale
        val x1 = x0 + width * scale
        val y1 = y0 + height * scale
        result[0] = min(x0, x1).toFloat() - padding
        result[1] = min(y0, y1).toFloat() - padding
        result[2] = max(x0, x1).toFloat() + padding
        result[3] = max(y0, y1).toFloat() + padding
    }

    /** Exact XY order of Label.makeDrawable, including its unscaled rotation pivot at scale != 1. */
    fun rotatedBounds(
        screenX: Double, screenY: Double,
        width: Double, height: Double,
        offsetX: Double, offsetY: Double,
        scale: Double, angle: Double, padding: Float,
        result: FloatArray,
    ) {
        val c = cos(angle)
        val s = sin(angle)
        val tx = screenX - offsetX * scale + offsetX
        val ty = screenY - offsetY * scale + offsetY
        var minX = Double.POSITIVE_INFINITY
        var minY = Double.POSITIVE_INFINITY
        var maxX = Double.NEGATIVE_INFINITY
        var maxY = Double.NEGATIVE_INFINITY
        for (i in 0..3) {
            val x = (if (i and 1 == 0) 0.0 else width * scale) - offsetX
            val y = (if (i and 2 == 0) 0.0 else height * scale) - offsetY
            val rx = tx + x * c - y * s
            val ry = ty + x * s + y * c
            minX = min(minX, rx); maxX = max(maxX, rx)
            minY = min(minY, ry); maxY = max(maxY, ry)
        }
        result[0] = minX.toFloat() - padding
        result[1] = minY.toFloat() - padding
        result[2] = maxX.toFloat() + padding
        result[3] = maxY.toFloat() + padding
    }

    /** Row-major MVP W, exactly the fourth row used by RenderContext.project. */
    fun clipW(m: DoubleArray, x: Double, y: Double, z: Double): Double =
        m[12] * x + m[13] * y + m[14] * z + m[15]

    /** Screen fraction -> affine segment fraction. Exact for a straight homogeneous segment. */
    fun perspectiveFraction(u: Double, w0: Double, w1: Double): Double {
        if (!u.isFinite() || u < 0.0 || u > 1.0 || !w0.isFinite() || !w1.isFinite() || w0 <= 0.0 || w1 <= 0.0)
            return Double.NaN
        val denominator = (1.0 - u) * w1 + u * w0
        return if (denominator > 0.0 && denominator.isFinite()) u * w0 / denominator else Double.NaN
    }

    /** Recover u from the precise projected segment, avoiding the SDK GlyphPlacement's Float u
     * losing several glyph widths when its source segment extends far beyond the viewport. */
    fun screenFraction(x: Double, y: Double, ax: Double, ay: Double, bx: Double, by: Double): Double {
        val dx = bx - ax; val dy = by - ay
        val u = if (abs(dx) >= abs(dy) && dx != 0.0) (x - ax) / dx
            else if (dy != 0.0) (y - ay) / dy else 0.0
        return u.coerceIn(0.0, 1.0)
    }

    fun projectionMatches(actualX: Double, actualY: Double, desiredX: Double, desiredY: Double): Boolean {
        val dx = actualX - desiredX
        val dy = actualY - desiredY
        return dx.isFinite() && dy.isFinite() && dx * dx + dy * dy <= MAX_PROJECTION_ERROR_PX * MAX_PROJECTION_ERROR_PX
    }

    /** Reject a whole repeat, never flip individual characters or remove a road. OpenGL Y points up. */
    fun readableAngles(angles: FloatArray, count: Int): Boolean {
        if (count <= 0) return false
        var low = Double.POSITIVE_INFINITY
        var high = Double.NEGATIVE_INFINITY
        var previous = 0.0
        for (i in 0 until count) {
            val angle = angles[i].toDouble()
            if (!angle.isFinite() || abs(angle) > PI * 0.5 + 1e-6) return false
            if (i > 0 && abs(angle - previous) > MAX_ADJACENT_TURN_RADIANS + 1e-6) return false
            low = min(low, angle); high = max(high, angle)
            if (high - low > MAX_RUN_TURN_RADIANS + 1e-6) return false
            previous = angle
        }
        return true
    }

    /**
     * WorldWind 2.1.1's arc-length placement formula, restricted to potentially visible repeats.
     * Keep its middle-waypoint phase, glyph advances/tangents and public GlyphRun representation.
     * Segment/viewport intersection computes repeat-index intervals, so a near-plane segment with
     * millions of screen pixels does not first allocate millions of offscreen glyphs. No repeat cap
     * hides visible content. counts = [all planned repeats, repeats skipped outside expanded viewport].
     */
    fun placeVisible(
        polyline: List<Vec2>, text: String, widths: FloatArray, width: Float, gap: Float,
        minX: Double, minY: Double, maxX: Double, maxY: Double, counts: LongArray,
    ): List<MvtCurvedTextPlacer.GlyphRun> {
        counts[0] = 0; counts[1] = 0
        if (polyline.size < 2 || text.isEmpty() || widths.size < text.length ||
            !width.isFinite() || width <= 0f || !gap.isFinite() || gap < 0f) return emptyList()
        val cumulative = DoubleArray(polyline.size)
        for (i in 1 until polyline.size) {
            val dx = polyline[i].x - polyline[i - 1].x
            val dy = polyline[i].y - polyline[i - 1].y
            cumulative[i] = cumulative[i - 1] + sqrt(dx * dx + dy * dy)
            if (!cumulative[i].isFinite()) return emptyList()
        }
        val total = cumulative.last()
        val cycle = (width + gap).toDouble()
        if (total < width || !cycle.isFinite() || cycle <= 0.0) return emptyList()
        val planned = floor((total + gap) / cycle).coerceAtLeast(1.0)
        if (!planned.isFinite() || planned >= Long.MAX_VALUE.toDouble() - 2.0) return emptyList()
        val occupied = planned * cycle - gap
        val center = if (polyline.size > 2) cumulative[polyline.size / 2] else total * 0.5
        val first = (center - occupied * 0.5).coerceIn(0.0, (total - occupied).coerceAtLeast(0.0))
        val last = floor((total - width - first) / cycle).toLong()
        if (last < 0) return emptyList()
        counts[0] = last + 1
        val clipped = DoubleArray(2)
        val result = ArrayList<MvtCurvedTextPlacer.GlyphRun>()
        var next = 0L
        for (segment in 0 until polyline.size - 1) {
            val a = polyline[segment]
            val b = polyline[segment + 1]
            if (!clipSegment(a.x, a.y, b.x, b.y, minX, minY, maxX, maxY, clipped)) continue
            val length = cumulative[segment + 1] - cumulative[segment]
            val visibleStart = cumulative[segment] + length * clipped[0]
            val visibleEnd = cumulative[segment] + length * clipped[1]
            // One extra candidate on either side protects float arc-length boundary rounding.
            val from = maxOf(0L, next, floor((visibleStart - width - first) / cycle).toLong() - 1L)
            val through = minOf(last, ceil((visibleEnd - first) / cycle).toLong() + 1L)
            var repeat = from
            while (repeat <= through) {
                var cursor = first + repeat * cycle
                var sumX = 0f; var sumY = 0f
                var visible = false
                val glyphs = ArrayList<MvtCurvedTextPlacer.GlyphPlacement>(text.length)
                for (i in text.indices) {
                    val distance = (cursor + widths[i] * 0.5).coerceIn(0.0, cumulative.last())
                    var lo = 0
                    var hi = cumulative.size - 1
                    while (lo < hi) {
                        val mid = (lo + hi) ushr 1
                        if (cumulative[mid + 1] < distance) lo = mid + 1 else hi = mid
                    }
                    val segmentLength = cumulative[lo + 1] - cumulative[lo]
                    val u = if (segmentLength == 0.0) 0.0 else (distance - cumulative[lo]) / segmentLength
                    val ax = polyline[lo].x; val ay = polyline[lo].y
                    val bx = polyline[lo + 1].x; val by = polyline[lo + 1].y
                    val x = (ax + (bx - ax) * u).toFloat(); val y = (ay + (by - ay) * u).toFloat()
                    val angle = atan2(by - ay, bx - ax).toFloat()
                    glyphs.add(MvtCurvedTextPlacer.GlyphPlacement(text[i], x, y, angle, lo, u.toFloat()))
                    sumX += x; sumY += y
                    if (x >= minX && x <= maxX && y >= minY && y <= maxY) visible = true
                    cursor += widths[i]
                }
                if (visible) result.add(MvtCurvedTextPlacer.GlyphRun(glyphs, sumX / glyphs.size, sumY / glyphs.size))
                repeat++
            }
            next = maxOf(next, through + 1L)
        }
        counts[1] = counts[0] - result.size
        return result
    }

    /** Liang-Barsky segment clip; computes fractions only and never changes the road geometry. */
    private fun clipSegment(
        x0: Double, y0: Double, x1: Double, y1: Double,
        minX: Double, minY: Double, maxX: Double, maxY: Double, out: DoubleArray,
    ): Boolean {
        val dx = x1 - x0; val dy = y1 - y0
        var start = 0.0; var end = 1.0
        for (edge in 0..3) {
            val p = when (edge) { 0 -> -dx; 1 -> dx; 2 -> -dy; else -> dy }
            val q = when (edge) { 0 -> x0 - minX; 1 -> maxX - x0; 2 -> y0 - minY; else -> maxY - y0 }
            if (p == 0.0) { if (q < 0.0) return false } else {
                val r = q / p
                if (p < 0.0) start = max(start, r) else end = min(end, r)
                if (start > end) return false
            }
        }
        out[0] = start; out[1] = end
        return true
    }

    fun overlapsAccepted(
        bounds: FloatArray, x1: FloatArray, y1: FloatArray, x2: FloatArray, y2: FloatArray, count: Int,
    ): Boolean {
        for (i in 0 until count) {
            if (bounds[0] < x2[i] && bounds[2] > x1[i] && bounds[1] < y2[i] && bounds[3] > y1[i]) return true
        }
        return false
    }
}
