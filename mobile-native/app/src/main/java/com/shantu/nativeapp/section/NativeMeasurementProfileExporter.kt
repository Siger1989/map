package com.shantu.nativeapp.section

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.os.CancellationSignal
import com.shantu.nativeapp.geometry.GeoPoint
import com.shantu.nativeapp.geometry.NativeMeasurements
import java.io.ByteArrayOutputStream
import java.util.Locale
import kotlin.math.*

/** Android Canvas export matching measurement/profile.ts page and missing-height semantics. */
object NativeMeasurementProfileExporter {
    const val SEGMENTS_PER_PAGE = 10
    data class Page(val index: Int, val count: Int, val bitmap: Bitmap) {
        fun pngBytes(): ByteArray = ByteArrayOutputStream().use { out -> bitmap.compress(Bitmap.CompressFormat.PNG, 100, out); out.toByteArray() }
    }
    fun render(points: List<GeoPoint>, name: String, page: Int = 0, cancellation: CancellationSignal? = null): Page {
        require(points.size >= 2) { "至少需要两个测量点才能导出剖面图" }
        val pageCount = (points.size - 1 + SEGMENTS_PER_PAGE - 1) / SEGMENTS_PER_PAGE
        require(page in 0 until pageCount) { "测量图页码无效" }
        val start = page * SEGMENTS_PER_PAGE; val end = min(points.lastIndex, start + SEGMENTS_PER_PAGE)
        val chainage = DoubleArray(points.size); val metrics = points.zipWithNext().map { NativeMeasurements.segment(it.first, it.second) }
        metrics.forEachIndexed { i, metric -> chainage[i + 1] = chainage[i] + metric.horizontal }
        val visible = points.subList(start, end + 1); val heights = visible.mapNotNull { it.altitude }
        val low = heights.minOrNull(); val high = heights.maxOrNull()
        val range = if (low != null && high != null) max(10.0, high - low) else 10.0
        val hLow = low?.minus(range * .15); val hHigh = high?.plus(range * .15)
        val bitmap = Bitmap.createBitmap(1200, 960, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap); canvas.drawColor(0xfff6faf8.toInt())
        val text = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xff193c41.toInt(); textSize = 20f }
        val title = Paint(text).apply { textSize = 32f; typeface = android.graphics.Typeface.create(android.graphics.Typeface.DEFAULT, android.graphics.Typeface.BOLD) }
        val axis = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xff506b78.toInt(); strokeWidth = 2f }
        val grid = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xffd9e3e7.toInt(); strokeWidth = 1f }
        val measured = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xff174d57.toInt(); strokeWidth = 3f; style = Paint.Style.STROKE }
        val horizontal = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xffaa6e23.toInt(); strokeWidth = 1.5f; pathEffect = android.graphics.DashPathEffect(floatArrayOf(8f, 5f), 0f) }
        val projection = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xff769aaa.toInt(); strokeWidth = 1.3f; pathEffect = android.graphics.DashPathEffect(floatArrayOf(3f, 5f), 0f) }
        val dot = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xff3478ed.toInt() }
        val missing = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xff899895.toInt() }
        canvas.drawText("山兔 · 测量连线剖面图", 40f, 54f, title)
        canvas.drawText(name.take(70), 40f, 88f, text)
        canvas.drawText("第 ${page + 1} / $pageCount 页 · 每页最多${SEGMENTS_PER_PAGE}段", 850f, 54f, text)
        val left = 105f; val right = 1130f; val top = 150f; val bottom = 480f
        canvas.drawLine(left, top, left, bottom, axis); canvas.drawLine(left, bottom, right, bottom, axis)
        val firstChain = chainage[start]; val lastChain = chainage[end]; val span = (lastChain - firstChain).coerceAtLeast(1.0)
        fun x(index: Int) = left + ((chainage[index] - firstChain) / span * (right - left)).toFloat()
        val chartLow = hLow ?: 0.0; val chartHigh = hHigh ?: 10.0
        fun y(altitude: Double) = bottom - ((altitude - chartLow) / (chartHigh - chartLow) * (bottom - top)).toFloat()
        for (i in 0..5) {
            cancellation?.throwIfCanceled()
            val xx = left + (right - left) * i / 5f
            val yy = bottom - (bottom - top) * i / 5f
            canvas.drawLine(xx, top, xx, bottom, grid); canvas.drawLine(left, yy, right, yy, grid)
            canvas.drawText(fmt(firstChain + span * i / 5), xx - 24, bottom + 28, text)
            if (hLow != null && hHigh != null) canvas.drawText(fmt(hLow + (hHigh - hLow) * i / 5), 12f, yy + 7f, text)
        }
        if (heights.isEmpty()) canvas.drawText("此页没有有效高程；未绘制虚构的零高程", left, (top + bottom) / 2, text)
        else {
            var previous: Pair<Float, Float>? = null
            for (index in start..end) {
                cancellation?.throwIfCanceled()
                val point = points[index]; val px = x(index)
                val py = point.altitude?.let(::y)
                if (py == null) { previous = null; canvas.drawCircle(px, bottom - 5f, 5f, missing); canvas.drawText("${label(index)} ?", px - 10f, bottom - 16f, text) }
                else {
                    previous?.let { canvas.drawLine(it.first, it.second, px, py, measured) }
                    previous = px to py
                    canvas.drawLine(px, py, px, bottom, projection); canvas.drawCircle(px, py, 5f, dot)
                    canvas.drawText(label(index), px - 8f, py - 12f, text)
                }
                if (index > start) {
                    val prior = points[index - 1]; val a = prior.altitude; val b = point.altitude
                    if (a != null && b != null) {
                        val ay = y(a); val by = y(b)
                        canvas.drawLine(x(index - 1), ay, px, ay, horizontal)
                        canvas.drawLine(px, ay, px, by, projection)
                    }
                }
            }
        }
        canvas.drawText("实线：测量连线   长虚线：水平参考   短虚线：垂直投影   WGS84", 40f, 530f, text)
        val totalHorizontal = metrics.sumOf { it.horizontal }
        val spatial = if (metrics.any { it.spatial == null }) null else metrics.sumOf { it.spatial!! }
        canvas.drawText("总水平 ${fmt(totalHorizontal)} m  ·  总斜距 ${spatial?.let { "${fmt(it)} m" } ?: "待定（缺高程）"}", 40f, 565f, text)
        val rowTop = 612f
        canvas.drawText("点      经度 / °               纬度 / °               高程 / m            累计 / m       本段水平 / m       高差 / m       朝向 / °", 40f, rowTop, text)
        for (index in start..end) {
            cancellation?.throwIfCanceled()
            val point = points[index]; val m = if (index == 0) null else metrics[index - 1]
            val fields = listOf(label(index), fmt(point.longitude), fmt(point.latitude), point.altitude?.let(::fmt) ?: "—", fmt(chainage[index]), m?.let { fmt(it.horizontal) } ?: "—", m?.rise?.let(::fmt) ?: "—", m?.bearing?.let(::fmt) ?: "—")
            val widths = floatArrayOf(42f, 126f, 260f, 400f, 540f, 675f, 820f, 950f)
            fields.forEachIndexed { i, value -> canvas.drawText(value, widths[i], rowTop + 32f + (index - start) * 27f, text) }
        }
        return Page(page, pageCount, bitmap)
    }
    private fun fmt(v: Double) = String.format(Locale.ROOT, "%.1f", v)
    private fun label(index: Int): String { var n = index + 1; var out = ""; while (n > 0) { n--; out = ('A'.code + n % 26).toChar() + out; n /= 26 }; return out }
}
