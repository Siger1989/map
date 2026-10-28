package com.shantu.nativeapp.ui

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.view.View
import com.shantu.nativeapp.geometry.GeoPoint
import com.shantu.nativeapp.geometry.NativeMeasurements
import kotlin.math.max

/** Measured-point profile preview; unknown altitude breaks the line and is never mapped to zero. */
class NativeMeasurementProjectionView(context: Context, private val points: List<GeoPoint>) : View(context) {
    private val axis = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xff899895.toInt(); strokeWidth = dp(1f) }
    private val pathPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xff174d57.toInt(); strokeWidth = dp(2f); style = Paint.Style.STROKE }
    private val guide = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xffaa6e23.toInt(); strokeWidth = dp(1f); pathEffect = android.graphics.DashPathEffect(floatArrayOf(dp(4f), dp(3f)), 0f) }
    private val dot = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xff3478ed.toInt() }
    private val missing = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xff899895.toInt() }
    private val text = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xfff2f5ed.toInt(); textSize = dp(10f) }
    private fun dp(v: Float) = v * resources.displayMetrics.density
    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val naturalWidth = dp(max(280f, (points.size - 1) * 62f + 48f)).toInt()
        setMeasuredDimension(resolveSize(naturalWidth, widthMeasureSpec), resolveSize(dp(132f).toInt(), heightMeasureSpec))
    }
    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (points.isEmpty()) return
        val left = dp(32f); val right = width - dp(12f); val top = dp(16f); val bottom = height - dp(24f)
        if (right <= left || bottom <= top) return
        canvas.drawLine(left, bottom, right, bottom, axis); canvas.drawLine(left, top, left, bottom, axis)
        val distances = DoubleArray(points.size); for (i in 1 until points.size) distances[i] = distances[i - 1] + NativeMeasurements.segment(points[i - 1], points[i]).horizontal
        val elevations = points.mapNotNull { it.altitude }; val minH = elevations.minOrNull(); val maxH = elevations.maxOrNull()
        val span = if (minH != null && maxH != null) max(10.0, maxH - minH) else 10.0
        fun x(i: Int) = left + ((right - left) * (if (distances.last() > 0) distances[i] / distances.last() else i.toDouble() / (points.size - 1).coerceAtLeast(1)).toFloat())
        fun y(h: Double) = bottom - ((h - (minH ?: 0.0)) / span * (bottom - top)).toFloat()
        if (minH == null) canvas.drawText("暂无有效高程", left, top + text.textSize, text)
        else {
            val profile = Path(); var connected = false
            points.forEachIndexed { i, p ->
                val px = x(i); val h = p.altitude
                if (h == null) { connected = false; canvas.drawCircle(px, bottom - dp(4f), dp(3f), missing) }
                else {
                    val py = y(h); if (!connected) profile.moveTo(px, py) else profile.lineTo(px, py)
                    connected = true; canvas.drawCircle(px, py, dp(3f), dot); canvas.drawLine(px, py, px, bottom, guide)
                }
            }
            canvas.drawPath(profile, pathPaint)
            canvas.drawText("${minH.toInt()}–${maxH!!.toInt()} m", 2f, top + text.textSize, text)
        }
        canvas.drawText("测点连线 · 缺高程断开 · 里程 ${(distances.last() / 1000).format()} km", left, height - dp(5f), text)
    }
    private fun Double.format() = String.format(java.util.Locale.ROOT, "%.2f", this)
}
