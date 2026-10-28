package com.shantu.nativeapp.ui

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.view.MotionEvent
import android.view.View
import kotlin.math.hypot

/** Touch joystick emitting relative camera heading/pitch input; it never ends GPS follow. */
class NativeCameraJoystick(
    context:Context,
    private val onCameraInput:(headingDeltaDegrees:Float,pitchDeltaDegrees:Float)->Unit,
    private val onGestureState:(active:Boolean)->Unit={},
):View(context) {
    private val density=resources.displayMetrics.density
    private val ring=Paint(Paint.ANTI_ALIAS_FLAG).apply { color=0x99303835.toInt(); style=Paint.Style.FILL }
    private val outline=Paint(Paint.ANTI_ALIAS_FLAG).apply { color=0x88d0f76b.toInt(); style=Paint.Style.STROKE; strokeWidth=2*density }
    private val knob=Paint(Paint.ANTI_ALIAS_FLAG).apply { color=ShantuColors.accent; style=Paint.Style.FILL }
    private var x=0f; private var y=0f; private var active=false
    private val cameraTick=object:Runnable { override fun run() { if(!active) return; onCameraInput(x*2.8f,-y*2.2f); postDelayed(this,32) } }
    init { contentDescription="相机摇杆；调整视角时继续定位跟随"; isFocusable=true; isClickable=true }
    fun setAccentColor(color:Int) { knob.color=color; outline.color=(color and 0x00ffffff) or 0x88000000.toInt(); invalidate() }
    override fun onDraw(canvas:Canvas) {
        val cx=width/2f; val cy=height/2f; val radius=(minOf(width,height)*.47f)
        canvas.drawCircle(cx,cy,radius,ring); canvas.drawCircle(cx,cy,radius,outline)
        val k=radius*.32f; val offset=radius*.62f
        canvas.drawCircle(cx+x*offset,cy+y*offset,k,knob)
    }
    override fun onTouchEvent(event:MotionEvent):Boolean {
        val cx=width/2f; val cy=height/2f; val radius=(minOf(width,height)*.4f).coerceAtLeast(1f)
        when(event.actionMasked) {
            MotionEvent.ACTION_DOWN -> { active=true; parent?.requestDisallowInterceptTouchEvent(true); onGestureState(true); update(event.x,event.y,cx,cy,radius); post(cameraTick); return true }
            MotionEvent.ACTION_MOVE -> { if(active) update(event.x,event.y,cx,cy,radius); return true }
            MotionEvent.ACTION_UP,MotionEvent.ACTION_CANCEL -> { if(active) { active=false; removeCallbacks(cameraTick); x=0f;y=0f;invalidate();onGestureState(false);performClick() }; return true }
        }
        return true
    }
    private fun update(px:Float,py:Float,cx:Float,cy:Float,radius:Float) {
        val dx=px-cx; val dy=py-cy; val length=hypot(dx.toDouble(),dy.toDouble()).toFloat(); val scale=if(length>radius) radius/length else 1f
        x=dx*scale/radius; y=dy*scale/radius; invalidate()
    }
    override fun performClick():Boolean { super.performClick(); return true }
}
