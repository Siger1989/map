package com.shantu.nativeapp.ui

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.PointF
import android.view.MotionEvent
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import kotlin.math.hypot
import org.json.JSONArray
import org.json.JSONObject

data class NativeObjectPose(val longitude:Double,val latitude:Double,val altitudeMeters:Double,val heading:Double,val pitch:Double,val roll:Double,val width:Double,val length:Double,val height:Double) {
    fun isValid(): Boolean = longitude.isFinite() && longitude in -180.0..180.0 &&
        latitude.isFinite() && latitude in -85.0..85.0 && altitudeMeters.isFinite() &&
        heading.isFinite() && heading in -360.0..360.0 && pitch.isFinite() && pitch in -360.0..360.0 &&
        roll.isFinite() && roll in -360.0..360.0 && width.isFinite() && width in 0.1..10000.0 &&
        length.isFinite() && length in 0.1..10000.0 && height.isFinite() && height in 0.1..10000.0

    companion object {
        /** Converts the original annotation record without inventing a missing ground height. */
        fun fromAnnotation(annotation: JSONObject): NativeObjectPose? {
            val coordinate = annotation.optJSONArray("coordinates") ?: return null
            if (coordinate.length() < 2) return null
            val kind=annotation.optString("kind")
            val heading=annotation.optDouble("heading",0.0);val pitch=annotation.optDouble("pitch",0.0);val roll=annotation.optDouble("roll",0.0)
            val width=annotation.optDouble("width",10.0);val length=annotation.optDouble("length",10.0);val height=annotation.optDouble("height",10.0)
            val altitude = when {
                annotation.has("centerAltitude") && !annotation.isNull("centerAltitude") -> annotation.optDouble("centerAltitude",Double.NaN)
                kind!="pin"&&annotation.has("groundElevation")&&!annotation.isNull("groundElevation") -> {
                    val ground=annotation.optDouble("groundElevation",Double.NaN)
                    val extents=verticalExtents(annotation,kind,width,length,height,heading,pitch,roll)
                    val offset=annotation.optDouble("offset",0.0);if(!ground.isFinite()||!offset.isFinite()||extents==null)Double.NaN
                    else if(annotation.optString("placement")=="underground")ground-offset-extents.second else ground+offset-extents.first
                }
                annotation.optString("kind")=="pin" -> 0.0 // pins clamp to ground; this is not a GPS/DEM claim
                else -> Double.NaN
            }
            val pose = NativeObjectPose(
                coordinate.optDouble(0, Double.NaN), coordinate.optDouble(1, Double.NaN), altitude,
                heading,pitch,roll,width,length,height,
            )
            return pose.takeIf { it.isValid() }
        }

        private fun verticalExtents(a:JSONObject,kind:String,w:Double,l:Double,h:Double,heading:Double,pitch:Double,roll:Double):Pair<Double,Double>? {
            if(listOf(w,l,h,heading,pitch,roll).any{!it.isFinite()})return null
            if(kind=="sphere")return -w/2 to w/2
            val points=when(kind){
                "cylinder"->(0 until 48).flatMap{i->val angle=2*kotlin.math.PI*i/48;listOf(Triple(w/2*kotlin.math.cos(angle),w/2*kotlin.math.sin(angle),-h/2),Triple(w/2*kotlin.math.cos(angle),w/2*kotlin.math.sin(angle),h/2))}
                "prism"->(a.optJSONArray("footprint")?:return null).let{poly->(0 until poly.length()).flatMap{i->val p=poly.optJSONArray(i)?:return null;listOf(Triple(p.optDouble(0)*w,p.optDouble(1)*l,-h/2),Triple(p.optDouble(0)*w,p.optDouble(1)*l,h/2))}}
                else->buildList{for(z in listOf(-h/2,h/2))for(y in listOf(-l/2,l/2))for(x in listOf(-w/2,w/2))add(Triple(x,y,z))}
            }
            val px=pitch*kotlin.math.PI/180;val ry=roll*kotlin.math.PI/180
            val values=points.map{(x,y,z)->
                val sx=kotlin.math.sin(px);val cx=kotlin.math.cos(px);val cy=kotlin.math.cos(ry);val sy=kotlin.math.sin(ry)
                (-sy)*x+(cy*sx)*y+(cy*cx)*z
            }
            return (values.minOrNull()?:return null) to (values.maxOrNull()?:return null)
        }
    }

    /** Applies a committed pose while retaining all annotation fields unknown to this editor. */
    fun applyTo(annotation: JSONObject): JSONObject? {
        if (!isValid()) return null
        val result = JSONObject(annotation.toString())
        result.put("coordinates", JSONArray().put(longitude).put(latitude))
        if (result.optString("kind") != "pin") {
            result.put("centerAltitude", altitudeMeters)
            result.put("heading", heading).put("pitch", pitch).put("roll", roll)
            result.put("width", width).put("length", length).put("height", height)
        }
        return result
    }
}
enum class NativeGizmoMode { MOVE, ROTATE, SCALE }
enum class NativeGizmoAxis { X, Y, Z, FREE }

/** Host supplies camera projection plus inverse-projection/axis transform. */
interface NativeObjectGizmoAdapter {
    fun project(pose:NativeObjectPose,eastMeters:Double,northMeters:Double,upMeters:Double):PointF?
    fun transform(start:NativeObjectPose,mode:NativeGizmoMode,axis:NativeGizmoAxis,down:PointF,current:PointF):NativeObjectPose?
}

/** Temporary map overlay; previews never persist until Save and Cancel restores the original pose. */
class NativeObjectGizmo(context:Context,private val chrome:HomeChrome,private val initial:NativeObjectPose,private val kind:String,private val adapter:NativeObjectGizmoAdapter,private val onPreview:(NativeObjectPose)->Unit,private val onSave:(NativeObjectPose)->Unit,private val onCancel:()->Unit):FrameLayout(context){
    private var pose=initial;private var mode=NativeGizmoMode.MOVE;private var dragMode=mode;private var dragStartPose=initial;private var activeAxis:NativeGizmoAxis?=null;private var down=PointF();private val canvas=HandleCanvas(context)
    init{
        isClickable=true;addView(canvas,LayoutParams(-1,-1))
        val controls=LinearLayout(context).apply{orientation=LinearLayout.HORIZONTAL;setPadding(chrome.dp(4),chrome.dp(2),chrome.dp(4),chrome.dp(2));background=chrome.surface(8)}
        (if(kind=="pin")listOf("移动" to NativeGizmoMode.MOVE) else listOf("移动" to NativeGizmoMode.MOVE,"旋转" to NativeGizmoMode.ROTATE,"缩放" to NativeGizmoMode.SCALE)).forEach{(label,value)->controls.addView(chrome.row(label){mode=value;canvas.invalidate()},LinearLayout.LayoutParams(0,chrome.dp(28),1f))}
        controls.addView(chrome.row("保存"){save()},LinearLayout.LayoutParams(0,chrome.dp(28),1f))
        controls.addView(chrome.row("取消"){cancel()},LinearLayout.LayoutParams(0,chrome.dp(28),1f))
        addView(controls,LayoutParams(-1,chrome.dp(32),android.view.Gravity.BOTTOM))
    }
    fun currentPose()=pose
    fun preview(mode:NativeGizmoMode,axis:NativeGizmoAxis,down:PointF,current:PointF):Boolean {
        return previewFrom(pose,mode,axis,down,current)
    }
    private fun previewFrom(start:NativeObjectPose,mode:NativeGizmoMode,axis:NativeGizmoAxis,down:PointF,current:PointF):Boolean {
        if(kind=="pin"&&mode!=NativeGizmoMode.MOVE)return false
        val next=adapter.transform(start,mode,axis,down,current)?.takeIf { it.isValid() }?:return false
        pose=next;onPreview(next);canvas.invalidate();return true
    }
    fun save(){onSave(pose)}
    fun cancel(){pose=initial;onPreview(initial);onCancel()}
    private inner class HandleCanvas(context:Context):View(context){
        private val paints=listOf("#ef5652","#5fdf79","#598fff").map{Paint(Paint.ANTI_ALIAS_FLAG).apply{color=android.graphics.Color.parseColor(it);strokeWidth=chrome.dp(3).toFloat();style=Paint.Style.STROKE}}
        private val centerPaint=Paint(Paint.ANTI_ALIAS_FLAG).apply{color=android.graphics.Color.WHITE;style=Paint.Style.FILL}
        private fun axisPoint(axis:NativeGizmoAxis,meters:Double):PointF?=when(axis){NativeGizmoAxis.X->adapter.project(pose,meters,0.0,0.0);NativeGizmoAxis.Y->adapter.project(pose,0.0,meters,0.0);NativeGizmoAxis.Z->adapter.project(pose,0.0,0.0,meters);NativeGizmoAxis.FREE->null}
        private fun handleLength(axis:NativeGizmoAxis):Double{
            val center=adapter.project(pose,0.0,0.0,0.0)?:return 20.0
            val target=chrome.dp(56).toDouble();var lo=.001;var hi=1.0
            fun distance(m:Double):Double{val p=axisPoint(axis,m)?:return Double.NaN;return hypot((p.x-center.x).toDouble(),(p.y-center.y).toDouble())}
            var highDistance=distance(hi)
            repeat(20){if(highDistance.isFinite()&&highDistance<target){hi*=2.0;highDistance=distance(hi)}}
            if(!highDistance.isFinite())return 20.0
            if(highDistance<target)return hi
            repeat(24){val mid=(lo+hi)/2;val d=distance(mid);if(!d.isFinite())return 20.0;if(d<target)lo=mid else hi=mid}
            return (lo+hi)/2
        }
        override fun onDraw(c:Canvas){super.onDraw(c);val center=adapter.project(pose,0.0,0.0,0.0)?:return;c.drawCircle(center.x,center.y,chrome.dp(8).toFloat(),centerPaint);val axes=listOf(NativeGizmoAxis.X,NativeGizmoAxis.Y,NativeGizmoAxis.Z);axes.forEachIndexed{i,axis->val end=axisPoint(axis,handleLength(axis))?:return@forEachIndexed;c.drawLine(center.x,center.y,end.x,end.y,paints[i]);c.drawCircle(end.x,end.y,chrome.dp(10).toFloat(),paints[i])};if(kind!="pin"&&mode==NativeGizmoMode.ROTATE){val r=chrome.dp(48).toFloat();c.drawCircle(center.x,center.y,r,paints[0]);c.drawCircle(center.x,center.y,r*1.3f,paints[1]);c.drawCircle(center.x,center.y,r*1.6f,paints[2])}}
        override fun onTouchEvent(event:MotionEvent):Boolean{when(event.actionMasked){MotionEvent.ACTION_DOWN->{down=PointF(event.x,event.y);dragStartPose=pose;dragMode=mode;val center=adapter.project(pose,0.0,0.0,0.0)?:return false;activeAxis=NativeGizmoAxis.FREE
                if(kind!="pin"&&mode==NativeGizmoMode.ROTATE){
                    val radius=hypot((event.x-center.x).toDouble(),(event.y-center.y).toDouble())
                    val rings=listOf(chrome.dp(48).toDouble() to NativeGizmoAxis.X,chrome.dp(62).toDouble() to NativeGizmoAxis.Y,chrome.dp(76).toDouble() to NativeGizmoAxis.Z)
                    val ringAxis=rings.minByOrNull{ kotlin.math.abs(it.first-radius) }?.takeIf{ kotlin.math.abs(it.first-radius)<=chrome.dp(10) }?.second
                    if(ringAxis!=null)activeAxis=ringAxis else if(radius>chrome.dp(38))return false
                } else {
                    val endpoints=listOf(NativeGizmoAxis.X,NativeGizmoAxis.Y,NativeGizmoAxis.Z).mapNotNull{a->axisPoint(a,handleLength(a))?.let{a to it}}
                    val handle=endpoints.minByOrNull{hypot((it.second.x-event.x).toDouble(),(it.second.y-event.y).toDouble())}?.takeIf{hypot((it.second.x-event.x).toDouble(),(it.second.y-event.y).toDouble())<=chrome.dp(22)}
                    if(handle!=null)activeAxis=handle.first else if(hypot((center.x-event.x).toDouble(),(center.y-event.y).toDouble())>chrome.dp(16))return false
                };return true}
            MotionEvent.ACTION_MOVE->{val axis=activeAxis?:return true;previewFrom(dragStartPose,dragMode,axis,down,PointF(event.x,event.y));invalidate();return true}
            MotionEvent.ACTION_UP,MotionEvent.ACTION_CANCEL->{activeAxis=null;return true}}
            return true
        }
    }
}
