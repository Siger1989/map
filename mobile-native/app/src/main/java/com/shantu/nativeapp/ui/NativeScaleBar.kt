package com.shantu.nativeapp.ui

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.view.View
import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.pow

internal data class NativeScaleMark(val meters: Double, val width: Float, val label: String)
internal object NativeScaleMath {
    fun mark(metersAcross: Double, maxWidth: Float): NativeScaleMark? {
        if (!metersAcross.isFinite() || metersAcross <= 0 || !maxWidth.isFinite() || maxWidth <= 0) return null
        val magnitude=10.0.pow(floor(log10(metersAcross)))
        val units=metersAcross/magnitude
        val meters=(if(units>=5)5.0 else if(units>=2)2.0 else 1.0)*magnitude
        val display=if(meters>=1000)meters/1000 else meters
        val number=if(display>=1)display.toLong().toString() else java.math.BigDecimal.valueOf(display).stripTrailingZeros().toPlainString()
        return NativeScaleMark(meters,(maxWidth*meters/metersAcross).toFloat(),number+if(meters>=1000)" km" else " m")
    }
}

/** A real 44dp maximum ground scale. Missing terrain intersections hide the mark. */
class NativeScaleBar(context: Context): View(context) {
    private val density=resources.displayMetrics.density
    private val paint=Paint(Paint.ANTI_ALIAS_FLAG)
    private var mark:NativeScaleMark?=null
    fun update(metersAcross:Double?) {
        mark=metersAcross?.let { NativeScaleMath.mark(it,44*density) }
        contentDescription=mark?.let { "比例尺 ${it.label}" } ?: "比例尺暂不可用"
        invalidate()
    }
    override fun onDraw(canvas:Canvas) {
        val value=mark ?: return
        val right=width-2*density;val left=right-value.width;val y=8*density
        paint.style=Paint.Style.STROKE;paint.strokeWidth=3*density;paint.color=android.graphics.Color.BLACK
        fun line(){canvas.drawLine(left,y,right,y,paint);canvas.drawLine(left,y-4*density,left,y,paint);canvas.drawLine(right,y-4*density,right,y,paint)}
        line();paint.strokeWidth=density;paint.color=android.graphics.Color.WHITE;line()
        paint.style=Paint.Style.FILL;paint.textSize=10*density;paint.textAlign=Paint.Align.RIGHT
        paint.setShadowLayer(2*density,0f,0f,android.graphics.Color.BLACK)
        canvas.drawText(value.label,right,22*density,paint);paint.clearShadowLayer()
    }
}
