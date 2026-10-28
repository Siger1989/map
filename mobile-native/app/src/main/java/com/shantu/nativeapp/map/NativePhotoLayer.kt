package com.shantu.nativeapp.map

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import earth.worldwind.geom.AltitudeMode
import earth.worldwind.geom.Angle.Companion.degrees
import earth.worldwind.geom.Position
import earth.worldwind.layer.RenderableLayer
import earth.worldwind.render.image.ImageSource
import earth.worldwind.shape.Placemark
import earth.worldwind.shape.PlacemarkAttributes
import org.json.JSONArray
import java.util.Base64

/** Photos are real map pickables with terrain depth testing, shared by both maps. */
class NativePhotoLayer {
    val layer=RenderableLayer("Track photos")
    fun replace(photos:JSONArray){
        layer.clearRenderables()
        for(i in 0 until photos.length()){
            val photo=photos.optJSONObject(i)?:continue
            if(photo.optBoolean("hidden") || !photo.optBoolean("visible",true))continue
            val c=photo.optJSONArray("coordinates")?:continue
            val lon=c.optDouble(0);val lat=c.optDouble(1)
            if(!lon.isFinite()||!lat.isFinite()||lon !in -180.0..180.0||lat !in -90.0..90.0)continue
            val image=photo.optString("previewBase64").takeIf{it.length in 1..1_400_000}?:continue
            val attributes=PlacemarkAttributes().apply{
                imageSource=ImageSource.fromImageFactory(PhotoImageFactory(image,
                    photo.optJSONArray("groupIds")?.length()?.coerceAtLeast(1) ?: 1,
                    if(photo.optString("kind")=="annotation")photo.optString("mapIcon","pin") else null,
                    photo.optString("mapColor","#176b68")));
                imageScale=photo.optDouble("pixelScale",1.0).coerceIn(0.5,8.0);isDrawLabel=false;isDepthTest=true
            }
            layer.addRenderable(Placemark(Position(lat.degrees,lon.degrees,0.0),attributes).apply{
                altitudeMode=AltitudeMode.CLAMP_TO_GROUND;isAlwaysOnTop=false;pickDelegate="shantu-photo:${photo.optString("id")}";displayName=photo.optString("name","照片")
            })
        }
    }
}
private data class PhotoImageFactory(val encoded:String,val count:Int=1,val mapIcon:String?=null,val mapColor:String="#176b68"):ImageSource.NetworkBoundImageFactory {
    override suspend fun createCachedBitmap():Bitmap?=createBitmap()
    override suspend fun createBitmap():Bitmap?=runCatching{
        val bytes=Base64.getDecoder().decode(encoded)
        val bounds=BitmapFactory.Options().apply{inJustDecodeBounds=true};BitmapFactory.decodeByteArray(bytes,0,bytes.size,bounds)
        require(bounds.outWidth>0&&bounds.outHeight>0&&bounds.outWidth.toLong()*bounds.outHeight<=4_000_000)
        val original=BitmapFactory.decodeByteArray(bytes,0,bytes.size,BitmapFactory.Options().apply{inSampleSize=(maxOf(bounds.outWidth,bounds.outHeight)/64).coerceAtLeast(1)})?:return@runCatching null
        val result=Bitmap.createBitmap(44,44,Bitmap.Config.ARGB_8888)
        Canvas(result).apply{
            val paint=Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
            paint.color=android.graphics.Color.WHITE;drawRoundRect(4f,4f,40f,40f,6f,6f,paint)
            val side=minOf(original.width,original.height);val left=(original.width-side)/2;val top=(original.height-side)/2
            save();clipRect(6,6,38,38);drawBitmap(original,android.graphics.Rect(left,top,left+side,top+side),android.graphics.Rect(6,6,38,38),paint);restore()
            if(mapIcon!=null){
                paint.color=android.graphics.Color.WHITE;drawRoundRect(26f,26f,44f,44f,5f,5f,paint)
                val color=runCatching{android.graphics.Color.parseColor(mapColor)}.getOrDefault(android.graphics.Color.rgb(23,107,104))
                save();translate(19f,23f);scale(.5f,.5f);NativeModelRenderer.drawMarkerGlyph(this,mapIcon,color);restore()
            }
            if(count>1){
                val text=count.toString();paint.textSize=10f;paint.typeface=android.graphics.Typeface.DEFAULT_BOLD
                val width=paint.measureText(text)+8f;paint.color=android.graphics.Color.rgb(22,56,57)
                drawRoundRect(44f-width,0f,44f,14f,7f,7f,paint);paint.color=android.graphics.Color.WHITE
                drawText(text,44f-width+4f,10.5f,paint)
            }
        }
        original.recycle();result
    }.getOrNull()
}
