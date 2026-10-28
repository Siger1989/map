package com.shantu.nativeapp.section

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.os.CancellationSignal
import java.io.ByteArrayOutputStream
import java.util.Locale
import kotlin.math.*

/** Canvas/PNG survey sheet: profile and plan use the same real DEM grid and measured station chainage. */
object NativeSurveySheetExporter {
    fun render(line: NativeSurveyLine, terrain: NativeSurveyTerrain, cancellation: CancellationSignal? = null): Bitmap {
        require(NativeSurveySectionEngine.key(line) == NativeSurveySectionEngine.key(terrain.line)) { "测线已变化，需重新采样后再导出" }
        require(terrain.heightsMeters.size == terrain.columns * terrain.rows) { "DEM网格数据不完整" }
        val bitmap = Bitmap.createBitmap(1800, 1500, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap); canvas.drawColor(0xffffffff.toInt())
        val text = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xff161b1c.toInt(); textSize = 22f }
        val title = Paint(text).apply { textSize = 34f; typeface = android.graphics.Typeface.create(android.graphics.Typeface.DEFAULT, android.graphics.Typeface.BOLD) }
        val axis = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xff222222.toInt(); strokeWidth = 2f; style = Paint.Style.STROKE }
        val grid = Paint(axis).apply { color = 0xffdddddd.toInt(); strokeWidth = 1f; pathEffect = android.graphics.DashPathEffect(floatArrayOf(5f, 5f), 0f) }
        val terrainPaint = Paint(axis).apply { color = 0xff222222.toInt(); strokeWidth = 3f }
        val guide = Paint(axis).apply { color = 0xff9ba4a5.toInt(); strokeWidth = 1.5f; pathEffect = android.graphics.DashPathEffect(floatArrayOf(6f, 6f), 0f) }
        val stationPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xff111111.toInt(); style = Paint.Style.FILL }
        val contour = Paint(axis).apply { color = 0xff946344.toInt(); strokeWidth = 1.3f }
        val left = 110f; val right = 1280f; val profileTop = 200f; val profileBottom = 640f
        val (start, end) = terrain.startMeters to terrain.endMeters
        val span = (end - start).coerceAtLeast(1.0)
        val row = terrain.rows / 2 * terrain.columns
        val profile = (0 until terrain.columns).map { terrain.heightsMeters[row + it] }
        val valid = terrain.heightsMeters.filterNotNull()
        require(valid.isNotEmpty()) { "测线范围没有有效DEM高程样本" }
        val minHeight = valid.minOrNull()!!; val maxHeight = valid.maxOrNull()!!
        val heightRange = max(10.0, maxHeight - minHeight)
        val low = floor((minHeight - heightRange * .15) / line.intervalMeters) * line.intervalMeters
        val high = ceil((maxHeight + heightRange * .15) / line.intervalMeters) * line.intervalMeters
        val yRange = (high - low).coerceAtLeast(1.0)
        fun x(distance: Double) = left + ((distance - start) / span * (right - left)).toFloat()
        fun y(height: Double) = profileBottom - ((height - low) / yRange * (profileBottom - profileTop)).toFloat()
        canvas.drawText(line.sourceJson.optJSONObject("info")?.optString("title")?.takeIf(String::isNotBlank) ?: "勘探线地形剖面及测站投影", 900f, 62f, title.apply { textAlign = Paint.Align.CENTER })
        title.textAlign = Paint.Align.LEFT
        canvas.drawText("方向角 A→B ${fmt(NativeSurveySectionEngine.bearingDegrees(line))}°（真北顺时针） · A为里程零点 · 等高距 ${line.intervalMeters} m", 110f, 110f, text)
        canvas.drawText("地形剖面 / 高程 m", left, 170f, text)
        for (i in 0..5) {
            cancellation?.throwIfCanceled()
            val xx = left + (right - left) * i / 5f; val yy = profileBottom - (profileBottom - profileTop) * i / 5f
            canvas.drawLine(xx, profileTop, xx, profileBottom, grid); canvas.drawLine(left, yy, right, yy, grid)
            canvas.drawText(fmt(start + span * i / 5), xx - 30, profileBottom + 32, text)
            canvas.drawText(fmt(low + yRange * i / 5), 8f, yy + 7f, text)
        }
        canvas.drawLine(left, profileTop, left, profileBottom, axis); canvas.drawLine(left, profileBottom, right, profileBottom, axis)
        val path = Path(); var open = false
        profile.forEachIndexed { index, value ->
            cancellation?.throwIfCanceled()
            if (value == null) { open = false; return@forEachIndexed }
            val xx = x(start + index.toDouble() / (terrain.columns - 1) * span); val yy = y(value)
            if (!open) path.moveTo(xx, yy) else path.lineTo(xx, yy)
            open = true
        }
        canvas.drawPath(path, terrainPaint)
        val stations = line.orderedStations()
        stations.forEach { station ->
            cancellation?.throwIfCanceled()
            val xx = x(station.distanceMeters); val h = terrain.heightAt(station.distanceMeters)
            canvas.drawLine(xx, h?.let(::y) ?: profileBottom, xx, profileBottom, guide)
            if (h != null) { canvas.drawCircle(xx, y(h), 5f, stationPaint); canvas.drawText(station.label, xx - 12f, y(h) - 13f, text) }
            canvas.drawText(station.label, xx - 12f, profileBottom + 58f, text)
        }
        canvas.drawText("沿线水平距离 / m", (left + right) / 2, profileBottom + 90, text)

        val halfWidth = line.halfWidthMeters
        val maxPlanWidth = right - left; val maxPlanHeight = 430f
        val metersPerPixel = min(maxPlanWidth / span, maxPlanHeight / (2 * halfWidth)).coerceAtLeast(1e-8)
        val planWidth = (span * metersPerPixel).toFloat(); val planHeight = (2 * halfWidth * metersPerPixel).toFloat()
        val planLeft = (left + right - planWidth) / 2f; val planRight = planLeft + planWidth
        val planTop = 1040f - planHeight / 2f; val planBottom = planTop + planHeight
        val planX = { distance: Double -> planLeft + ((distance - start) * metersPerPixel).toFloat() }
        val planY = { offset: Double -> planTop + ((offset + halfWidth) * metersPerPixel).toFloat() }
        canvas.drawText("测线平面投影（东 / 北方向局部等比例）", left, 820f, text)
        canvas.drawRect(planLeft, planTop, planRight, planBottom, axis)
        // Isolines are calculated only from complete four-cell DEM neighborhoods; nodata stays blank.
        val contourInterval = line.intervalMeters.toDouble()
        require((maxHeight - minHeight) / contourInterval <= 160.0) { "等高线过密，请增大等高距后重试" }
        val firstLevel = ceil(minHeight / contourInterval) * contourInterval
        var level = firstLevel
        while (level <= maxHeight) {
            cancellation?.throwIfCanceled()
            for (r in 0 until terrain.rows - 1) for (c in 0 until terrain.columns - 1) {
                val ids = intArrayOf(r * terrain.columns + c, r * terrain.columns + c + 1, (r + 1) * terrain.columns + c + 1, (r + 1) * terrain.columns + c)
                val values = ids.map { terrain.heightsMeters[it] }
                if (values.any { it == null }) continue
                val vertices = listOf(Triple(c.toDouble(), r.toDouble(), values[0]!!), Triple((c + 1).toDouble(), r.toDouble(), values[1]!!),
                    Triple((c + 1).toDouble(), (r + 1).toDouble(), values[2]!!), Triple(c.toDouble(), (r + 1).toDouble(), values[3]!!))
                fun triangle(a: Triple<Double, Double, Double>, b: Triple<Double, Double, Double>, d: Triple<Double, Double, Double>) {
                    val hits = mutableListOf<Pair<Float, Float>>()
                    listOf(a to b, b to d, d to a).forEach { (p, q) ->
                        if ((p.third >= level) != (q.third >= level)) {
                            val t = (level - p.third) / (q.third - p.third)
                            val px = planLeft + (((p.first + (q.first - p.first) * t) / (terrain.columns - 1) * planWidth).toFloat())
                            val py = planTop + (((p.second + (q.second - p.second) * t) / (terrain.rows - 1) * planHeight).toFloat())
                            hits += px to py
                        }
                    }
                    if (hits.size == 2) canvas.drawLine(hits[0].first, hits[0].second, hits[1].first, hits[1].second, contour)
                }
                triangle(vertices[0], vertices[1], vertices[2]); triangle(vertices[0], vertices[2], vertices[3])
            }
            level += contourInterval
        }
        canvas.drawLine(planX(start), planY(0.0), planX(end), planY(0.0), Paint(terrainPaint).apply { color = 0xffac372d.toInt(); strokeWidth = 4f })
        stations.forEach { station ->
            val xx = planX(station.distanceMeters); val yy = planY(0.0)
            canvas.drawCircle(xx, yy, 6f, stationPaint); canvas.drawText(station.label, xx - 14f, yy - 14f, text)
        }
        canvas.drawText("A→B ${fmt(NativeSurveySectionEngine.bearingDegrees(line))}° · 带宽 ±${fmt(halfWidth)} m · DEM ${terrain.source.take(85)}", 110f, 1370f, text)
        canvas.drawText("缺测位置不连接、不补零；剖面、测站高程与等高线共用实际采样网格。", 110f, 1410f, text)
        return bitmap
    }
    fun pngBytes(line: NativeSurveyLine, terrain: NativeSurveyTerrain, cancellation: CancellationSignal? = null): ByteArray =
        ByteArrayOutputStream().use { out -> render(line, terrain, cancellation).compress(Bitmap.CompressFormat.PNG, 100, out); out.toByteArray() }
    private fun fmt(value: Double) = String.format(Locale.ROOT, "%.1f", value)
}
