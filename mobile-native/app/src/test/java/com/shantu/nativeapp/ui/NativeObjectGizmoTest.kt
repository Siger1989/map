package com.shantu.nativeapp.ui

import android.graphics.PointF
import android.view.ContextThemeWrapper
import org.junit.Assert.*
import org.json.JSONObject
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[35])
class NativeObjectGizmoTest {
    @Test fun `annotation pose apply preserves native fields and rejects invalid coordinates`() {
        val source=JSONObject("""{"id":"x","kind":"box","coordinates":[11,28],"centerAltitude":20,"width":5,"length":6,"height":7,"privateField":{"kept":true}}""")
        val pose=NativeObjectPose.fromAnnotation(source)!!.copy(longitude=12.0,latitude=29.0,heading=45.0,width=8.0)
        val changed=pose.applyTo(source)!!
        assertEquals(11.0,source.getJSONArray("coordinates").getDouble(0),0.0)
        assertEquals(12.0,changed.getJSONArray("coordinates").getDouble(0),0.0)
        assertTrue(changed.getJSONObject("privateField").getBoolean("kept"))
        assertEquals(45.0,changed.getDouble("heading"),0.0)
        assertNull(pose.copy(longitude=Double.NaN).applyTo(source))
    }

    @Test fun `pins can move without a fabricated DEM altitude`() {
        val pin=JSONObject("""{"kind":"pin","coordinates":[0,0]}""")
        val pose=NativeObjectPose.fromAnnotation(pin)!!
        assertEquals(0.0,pose.altitudeMeters,0.0) // clamp-to-ground ignores this local transform value
        assertFalse(pin.has("groundElevation"))
    }
    @Test fun `map gizmo previews transforms and cancel restores initial pose`() {
        val context=ContextThemeWrapper(org.robolectric.RuntimeEnvironment.getApplication(),0)
        val chrome=HomeChrome(context){}
        val initial=NativeObjectPose(120.0,30.0,100.0,0.0,0.0,0.0,10.0,20.0,8.0)
        var preview:NativeObjectPose?=null;var saved:NativeObjectPose?=null;var cancelled=false
        val adapter=object:NativeObjectGizmoAdapter{
            override fun project(pose:NativeObjectPose,eastMeters:Double,northMeters:Double,upMeters:Double)=PointF((150+eastMeters).toFloat(),(200-northMeters-upMeters).toFloat())
            override fun transform(start:NativeObjectPose,mode:NativeGizmoMode,axis:NativeGizmoAxis,down:PointF,current:PointF)=when(mode){NativeGizmoMode.MOVE->start.copy(longitude=start.longitude+(current.x-down.x)*.00001);NativeGizmoMode.ROTATE->start.copy(heading=start.heading+current.x-down.x);NativeGizmoMode.SCALE->start.copy(width=(start.width+current.x-down.x).coerceAtLeast(.1))}
        }
        val gizmo=NativeObjectGizmo(context,chrome,initial,"box",adapter,{preview=it},{saved=it},{cancelled=true})
        assertTrue(gizmo.preview(NativeGizmoMode.MOVE,NativeGizmoAxis.FREE,PointF(0f,0f),PointF(30f,0f)))
        assertEquals(120.0003,preview!!.longitude,1e-8)
        assertTrue(gizmo.preview(NativeGizmoMode.MOVE,NativeGizmoAxis.FREE,PointF(0f,0f),PointF(20f,0f)))
        assertEquals(120.0005,preview!!.longitude,1e-8) // next drag starts from the current preview pose
        gizmo.cancel();assertEquals(initial,gizmo.currentPose());assertEquals(initial,preview);assertTrue(cancelled)
        gizmo.preview(NativeGizmoMode.ROTATE,NativeGizmoAxis.Z,PointF(0f,0f),PointF(20f,0f));gizmo.save()
        assertEquals(20.0,saved!!.heading,0.0)
    }
}
