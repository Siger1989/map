package com.shantu.nativeapp.ui
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.view.MotionEvent
import android.view.View
import kotlin.math.abs

class NativeBoxSelectionView(context:Context,private val onSelected:(RectF)->Unit):View(context) {
    private val paint=Paint(Paint.ANTI_ALIAS_FLAG)
    private var startX=0f;private var startY=0f
    private var rect:RectF?=null
    init { contentDescription="拖动地图框选对象";isClickable=true }
    override fun onTouchEvent(event:MotionEvent):Boolean {
        when(event.actionMasked) {
            MotionEvent.ACTION_DOWN->{startX=event.x;startY=event.y;rect=RectF(startX,startY,startX,startY)}
            MotionEvent.ACTION_MOVE,MotionEvent.ACTION_UP->{
                rect=RectF(minOf(startX,event.x),minOf(startY,event.y),maxOf(startX,event.x),maxOf(startY,event.y))
                if(event.actionMasked==MotionEvent.ACTION_UP && abs(event.x-startX)>4 && abs(event.y-startY)>4) onSelected(RectF(rect!!))
            }
            MotionEvent.ACTION_CANCEL->rect=null
        }
        invalidate();return true
    }
    override fun onDraw(canvas:Canvas) {
        val r=rect ?: return
        paint.style=Paint.Style.FILL;paint.color=(ShantuColors.accent and 0x00ffffff) or 0x22000000;canvas.drawRect(r,paint)
        paint.style=Paint.Style.STROKE;paint.color=ShantuColors.accent;paint.strokeWidth=2*resources.displayMetrics.density;canvas.drawRect(r,paint)
    }
}
