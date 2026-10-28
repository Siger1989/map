package com.shantu.nativeapp.section

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.os.CancellationSignal
import java.io.ByteArrayOutputStream
import java.util.Locale

/** Single measured section curve PNG. Missing terrain is represented only by absent curve segments. */
object NativeSectionProfilePngExporter {
    fun render(curve: NativeSectionCurve, title: String, cancellation: CancellationSignal? = null): Bitmap {
        require(curve.points.size >= 2 && curve.points.all { it.altitudeMeters.isFinite() }) { "当前剖面曲线没有足够的真实测点" }
        val bitmap = Bitmap.createBitmap(1400, 900, Bitmap.Config.ARGB_8888); val canvas = Canvas(bitmap); canvas.drawColor(0xfff6faf8.toInt())
        val text = Paint(3).apply { color = 0xff193c41.toInt(); textSize = 22f }
        val heading = Paint(text).apply { textSize = 32f; typeface = android.graphics.Typeface.create(android.graphics.Typeface.DEFAULT, android.graphics.Typeface.BOLD) }
        val grid = Paint(3).apply { color = 0xffd9e3e7.toInt(); strokeWidth = 1f }
        val axis = Paint(3).apply { color = 0xff506b78.toInt(); strokeWidth = 2f }
        val line = Paint(3).apply { color = 0xff174d57.toInt(); strokeWidth = 3f; style = Paint.Style.STROKE }
        val dots = Paint(3).apply { color = 0xffd0f76b.toInt() }
        val left = 110f; val right = 1340f; val top = 150f; val bottom = 670f
        val min = curve.minAltitudeMeters; val max = curve.maxAltitudeMeters; val span = (max - min).coerceAtLeast(1.0)
        val dist = curve.lengthMeters.coerceAtLeast(1e-9)
        fun x(d: Double) = left + (d / dist * (right - left)).toFloat()
        fun y(h: Double) = bottom - ((h - min) / span * (bottom - top)).toFloat()
        canvas.drawText("山兔 · 三维剖面", 55f, 60f, heading); canvas.drawText(title.take(80), 55f, 100f, text)
        canvas.drawText("${curve.name} · ${curve.source} · 实际采样 ${curve.points.size} 点 · 距离 ${fmt(curve.lengthMeters)} m", 55f, 132f, text)
        for (tick in 0..5) {
            cancellation?.throwIfCanceled()
            val xx = left + (right - left) * tick / 5f; val yy = bottom - (bottom - top) * tick / 5f
            canvas.drawLine(xx, top, xx, bottom, grid); canvas.drawLine(left, yy, right, yy, grid)
            canvas.drawText(fmt(dist * tick / 5), xx - 28f, bottom + 30f, text)
            canvas.drawText(fmt(min + span * tick / 5), 5f, yy + 8f, text)
        }
        canvas.drawLine(left, top, left, bottom, axis); canvas.drawLine(left, bottom, right, bottom, axis)
        val path = Path()
        curve.points.forEachIndexed { i, p ->
            cancellation?.throwIfCanceled()
            val px = x(p.distanceMeters); val py = y(p.altitudeMeters)
            if (i == 0) path.moveTo(px, py) else path.lineTo(px, py)
            canvas.drawCircle(px, py, 4f, dots)
        }
        canvas.drawPath(path, line)
        canvas.drawText("累计距离 / m", 600f, 730f, text); canvas.drawText("高程 / m", 12f, 170f, text)
        canvas.drawText("WGS84采样点坐标列于JSON数据；此图只绘制已采样的曲线，不补空缺地形。", 55f, 835f, text)
        return bitmap
    }
    fun pngBytes(curve: NativeSectionCurve, title: String, cancellation: CancellationSignal? = null): ByteArray =
        ByteArrayOutputStream().use { out -> render(curve, title, cancellation).compress(Bitmap.CompressFormat.PNG, 100, out); out.toByteArray() }
    private fun fmt(value: Double) = String.format(Locale.ROOT, "%.1f", value)
}
