package com.shantu.nativeapp.ui

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.view.View
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import com.shantu.nativeapp.navigation.NativeRouteDisplayData
import com.shantu.nativeapp.navigation.NativeRouteColorMode
import kotlin.math.max
import kotlin.math.min

/** Elevation profile that breaks across route segments and missing measured elevations. */
class NativeRouteChartView(context: Context) : View(context) {
    private val axis = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xff89918d.toInt(); strokeWidth = dp(1f); style = Paint.Style.STROKE }
    private val line = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xffd0f76b.toInt(); strokeWidth = dp(2f); style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND }
    private val label = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xfff2f5ed.toInt(); textSize = dp(10f) }
    var data: NativeRouteDisplayData? = null
        set(value) { field = value; invalidate() }
    private var chartScale=1f
    private val zoomDetector=ScaleGestureDetector(context,object:ScaleGestureDetector.SimpleOnScaleGestureListener(){
        override fun onScale(detector:ScaleGestureDetector):Boolean { chartScale=(chartScale*detector.scaleFactor).coerceIn(.7f,3f); invalidate(); return true }
    })
    init { isClickable=true }
    override fun onTouchEvent(event:MotionEvent):Boolean { zoomDetector.onTouchEvent(event); return true }
    private fun dp(v: Float) = v * resources.displayMetrics.density
    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val d = data ?: return
        canvas.save()
        // All plot coordinates, axes and their labels share one transform, preserving text proportions.
        canvas.scale(chartScale,chartScale,width/2f,height/2f)
        val left = dp(34f); val right = width - dp(8f); val top = dp(8f); val bottom = height - dp(20f)
        if (right <= left || bottom <= top) { canvas.restore(); return }
        canvas.drawLine(left, top, left, bottom, axis); canvas.drawLine(left, bottom, right, bottom, axis)
        val minH = d.minimumElevation ?: run { canvas.drawText("暂无有效高程样本", left, height / 2f, label); canvas.restore(); return }
        val maxH = d.maximumElevation ?: minH
        canvas.drawText("${"%.0f".format(minH)} m", 0f, bottom, label)
        canvas.drawText("${"%.0f".format(maxH)} m", 0f, top + label.textSize, label)
        canvas.drawText("0 m",left,bottom+label.textSize+dp(2f),label)
        canvas.drawText("${(d.distanceMeters/2).let(::formatDistance)}",(left+right)/2f,bottom+label.textSize+dp(2f),label)
        canvas.drawText(formatDistance(d.distanceMeters),right-label.measureText(formatDistance(d.distanceMeters)),bottom+label.textSize+dp(2f),label)
        val count = d.elevation.sumOf { it.size }.coerceAtLeast(1)
        var globalIndex = 0
        val span = max(1.0, maxH - minH)
        for (segment in d.elevation) {
            var previous: Pair<Float, Float>? = null
            for (heightValue in segment) {
                val x = left + ((right - left) * globalIndex.toFloat() / max(1, count - 1))
                globalIndex++
                if (heightValue == null) { previous = null; continue }
                val y = bottom - ((heightValue - minH) / span * (bottom - top)).toFloat()
                previous?.let { canvas.drawLine(it.first, it.second, x, y, line) }
                previous = x to y
            }
            // Do not bridge gaps between separate route segments.
            previous = null
        }
        canvas.restore()
    }
    private fun formatDistance(meters:Double)=if(meters>=1000) "%.1f km".format(meters/1000) else "${meters.toInt()} m"
}
