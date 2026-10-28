package com.shantu.nativeapp.photos

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.Base64

/** Photo strokes use normalized, unrotated image coordinates, exactly as the original archive. */
internal object NativePhotoExport {
    fun drawStrokes(canvas:Canvas,strokes:JSONArray,width:Float,height:Float) {
        val paint=Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style=Paint.Style.STROKE;strokeCap=Paint.Cap.ROUND;strokeJoin=Paint.Join.ROUND
            strokeWidth=maxOf(width,height)/200f
        }
        for(i in 0 until minOf(strokes.length(),80)) {
            val stroke=strokes.optJSONObject(i) ?: continue
            val points=stroke.optJSONArray("points") ?: continue
            val color=stroke.optString("color").takeIf { it in setOf("#ff625c","#ffda63","#ffffff") } ?: continue
            paint.color=Color.parseColor(color)
            val values=(0 until minOf(points.length(),400)).mapNotNull { j ->
                val p=points.optJSONArray(j) ?: return@mapNotNull null
                val x=p.optDouble(0);val y=p.optDouble(1)
                if(x.isFinite()&&y.isFinite()&&x in 0.0..1.0&&y in 0.0..1.0) x.toFloat()*width to y.toFloat()*height else null
            }
            if(values.size==1) canvas.drawPoint(values[0].first,values[0].second,paint)
            else if(values.isNotEmpty()) {
                val path=Path().apply { moveTo(values[0].first,values[0].second); values.drop(1).forEach { lineTo(it.first,it.second) } }
                canvas.drawPath(path,paint)
            }
        }
    }
    fun jpeg(photo:JSONObject):ByteArray {
        val encoded=photo.optString("detailBase64").ifBlank { photo.optString("previewBase64") }
        require(encoded.length in 1..6*1024*1024)
        val bytes=Base64.getDecoder().decode(encoded)
        val bounds=BitmapFactory.Options().apply { inJustDecodeBounds=true }
        BitmapFactory.decodeByteArray(bytes,0,bytes.size,bounds)
        require(bounds.outWidth>0&&bounds.outHeight>0&&bounds.outWidth.toLong()*bounds.outHeight<=30_000_000)
        var sample=1;while(maxOf(bounds.outWidth,bounds.outHeight)/sample>2560) sample*=2
        val source=BitmapFactory.decodeByteArray(bytes,0,bytes.size,BitmapFactory.Options().apply { inSampleSize=sample }) ?: error("照片无法读取")
        val rotation=photo.optInt("rotation").also { require(it in setOf(0,90,180,270)) }
        val rotated=rotation%180!=0
        val output=Bitmap.createBitmap(if(rotated)source.height else source.width,if(rotated)source.width else source.height,Bitmap.Config.ARGB_8888)
        try {
            val canvas=Canvas(output)
            canvas.drawColor(Color.WHITE)
            canvas.translate(output.width/2f,output.height/2f);canvas.rotate(rotation.toFloat());canvas.translate(-source.width/2f,-source.height/2f)
            canvas.drawBitmap(source,0f,0f,null)
            drawStrokes(canvas,photo.optJSONArray("strokes") ?: JSONArray(),source.width.toFloat(),source.height.toFloat())
            return ByteArrayOutputStream().use { require(output.compress(Bitmap.CompressFormat.JPEG,92,it));it.toByteArray() }
        } finally { source.recycle();output.recycle() }
    }
}
