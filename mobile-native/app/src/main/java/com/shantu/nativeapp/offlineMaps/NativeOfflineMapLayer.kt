package com.shantu.nativeapp.offlineMaps

import android.database.sqlite.SQLiteDatabase
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Bitmap
import com.shantu.nativeapp.coordinates.NativeCoordinateTransform
import earth.worldwind.layer.mercator.MercatorTileFactory
import earth.worldwind.layer.mercator.MercatorTiledImageLayer
import earth.worldwind.layer.mercator.MercatorTiledSurfaceImage
import earth.worldwind.render.image.ImageSource
import java.io.File

/** WorldWind render layer backed by a read-only MBTiles database (XYZ engine rows -> TMS rows). */
object NativeOfflineMapLayer {
    fun mbtiles(
        source:NativeOfflineMap,
        detailControl:Double=0.5,
        onBitmapReady:()->Unit={},
        onLoadStarted:()->Unit={},
        onLoadFinished:()->Unit={},
    ):MercatorTiledSurfaceImage {
        require(source.kind=="mbtiles"&&File(source.filePath).isFile)
        val factory=object:MercatorTileFactory {
            override val contentType="${source.id} MBTiles"
            override fun getImageSource(x:Int,y:Int,z:Int):ImageSource = ImageSource.fromImageFactory(object:ImageSource.NetworkBoundImageFactory {
                override suspend fun createCachedBitmap():Bitmap? {
                    onLoadStarted()
                    try { return readTile(source.filePath,x,y,z).also { notifyIfDecoded(it,onBitmapReady) } }
                    finally { onLoadFinished() }
                }
                override suspend fun createBitmap():Bitmap? {
                    onLoadStarted()
                    try { return readTile(source.filePath,x,y,z).also { notifyIfDecoded(it,onBitmapReady) } }
                    finally { onLoadFinished() }
                }
            })
        }
        return MercatorTiledImageLayer.buildTiledSurfaceImage(factory,false,tileSize=256,maxZoom=source.maxZoom,minZoom=source.minZoom).apply{this.detailControl=detailControl}
    }
    fun geotiff(
        source:NativeOfflineMap,
        detailControl:Double=0.5,
        onBitmapReady:()->Unit={},
        onLoadStarted:()->Unit={},
        onLoadFinished:()->Unit={},
    ):MercatorTiledSurfaceImage {
        require(source.kind=="geotiff"&&File(source.filePath).isFile);val raster by lazy(LazyThreadSafetyMode.SYNCHRONIZED){NativeGeoTiff.load(File(source.filePath))};val crs by lazy(LazyThreadSafetyMode.SYNCHRONIZED){NativeCoordinateTransform.resolve("EPSG:${raster.epsg}")}
        val factory=object:MercatorTileFactory {
            override val contentType="${source.id} GeoTIFF"
            override fun getImageSource(x:Int,y:Int,z:Int):ImageSource=ImageSource.fromImageFactory(object:ImageSource.NetworkBoundImageFactory {
                override suspend fun createCachedBitmap():Bitmap? {
                    onLoadStarted()
                    try { return renderGeoTile(raster,crs,x,y,z).also { notifyIfDecoded(it,onBitmapReady) } }
                    finally { onLoadFinished() }
                }
                override suspend fun createBitmap():Bitmap? {
                    onLoadStarted()
                    try { return renderGeoTile(raster,crs,x,y,z).also { notifyIfDecoded(it,onBitmapReady) } }
                    finally { onLoadFinished() }
                }
            })
        }
        return MercatorTiledImageLayer.buildTiledSurfaceImage(factory,true,tileSize=256,maxZoom=22,minZoom=0).apply{this.detailControl=detailControl}
    }
    /** Calibrated PNG/JPEG/WebP images use their stored six-term affine and source CRS. */
    fun image(
        source:NativeOfflineMap,
        detailControl:Double=0.5,
        onBitmapReady:()->Unit={},
        onLoadStarted:()->Unit={},
        onLoadFinished:()->Unit={},
    ):MercatorTiledSurfaceImage {
        require(source.kind=="image"&&File(source.filePath).isFile&&source.imageAffine?.size==6&&source.sourceCrs!=null)
        val raster by lazy(LazyThreadSafetyMode.SYNCHRONIZED){NativeCalibratedImage.load(source)}
        val factory=object:MercatorTileFactory {
            override val contentType="${source.id} calibrated image"
            override fun getImageSource(x:Int,y:Int,z:Int):ImageSource=ImageSource.fromImageFactory(object:ImageSource.NetworkBoundImageFactory {
                override suspend fun createCachedBitmap():Bitmap? {
                    onLoadStarted()
                    try { return renderRasterTile(raster,x,y,z).also { notifyIfDecoded(it,onBitmapReady) } }
                    finally { onLoadFinished() }
                }
                override suspend fun createBitmap():Bitmap? {
                    onLoadStarted()
                    try { return renderRasterTile(raster,x,y,z).also { notifyIfDecoded(it,onBitmapReady) } }
                    finally { onLoadFinished() }
                }
            })
        }
        return MercatorTiledImageLayer.buildTiledSurfaceImage(factory,true,tileSize=256,maxZoom=22,minZoom=0).apply{this.detailControl=detailControl}
    }
    internal fun renderImageTile(source:NativeOfflineMap,x:Int,y:Int,z:Int):Bitmap? = renderRasterTile(NativeCalibratedImage.load(source),x,y,z)
    private fun renderGeoTile(r:NativeGeoTiffRaster,crs:com.shantu.nativeapp.coordinates.NativeProjectCrs,x:Int,y:Int,z:Int):Bitmap? =
        renderRasterTile(r.width,r.height,r.rgba,r.affine,r.bounds,crs,x,y,z)
    private fun renderRasterTile(r:NativeCalibratedRaster,x:Int,y:Int,z:Int):Bitmap? =
        renderRasterTile(r.width,r.height,r.rgba,r.affine,r.bounds,r.crs,x,y,z)
    private fun renderRasterTile(width:Int,height:Int,rgba:ByteArray,affine:List<Double>,bounds:List<Double>,crs:com.shantu.nativeapp.coordinates.NativeProjectCrs,x:Int,y:Int,z:Int):Bitmap? {
        if(z !in 0..22||x<0||y<0||x >= (1 shl z)||y >= (1 shl z))return null
        val n=1 shl z;val west=x.toDouble()/n*360-180;val east=(x+1.0)/n*360-180
        if(east<bounds[0]||west>bounds[2])return null
        val north=Math.toDegrees(kotlin.math.atan(kotlin.math.sinh(Math.PI*(1-2*y.toDouble()/n))));val south=Math.toDegrees(kotlin.math.atan(kotlin.math.sinh(Math.PI*(1-2*(y+1.0)/n))))
        if(north<bounds[1]||south>bounds[3])return null
        val pixels=IntArray(256*256);val a=affine;val det=a[0]*a[4]-a[1]*a[3];if(!det.isFinite()||kotlin.math.abs(det)<1e-20)return null
        for(py in 0 until 256)for(px in 0 until 256){val lon=(x+(px+.5)/256)/n*360-180;val lat=Math.toDegrees(kotlin.math.atan(kotlin.math.sinh(Math.PI*(1-2*(y+(py+.5)/256)/n))));val p=NativeCoordinateTransform.transform(listOf(lon,lat),NativeCoordinateTransform.resolve("EPSG:4326"),crs);val dx=p[0]-a[2];val dy=p[1]-a[5];val col=kotlin.math.floor((dx*a[4]-a[1]*dy)/det).toInt();val row=kotlin.math.floor((a[0]*dy-a[3]*dx)/det).toInt();if(col !in 0 until width||row !in 0 until height)continue;val i=(row*width+col)*4;pixels[py*256+px]=Color.argb(rgba[i+3].toInt() and 255,rgba[i].toInt() and 255,rgba[i+1].toInt() and 255,rgba[i+2].toInt() and 255)}
        return Bitmap.createBitmap(pixels,256,256,Bitmap.Config.ARGB_8888)
    }
    internal fun tmsRow(z:Int,xyzY:Int):Int {require(z in 0..22&&xyzY in 0 until (1 shl z));return (1 shl z)-1-xyzY}
    private fun readTile(path:String,x:Int,y:Int,z:Int):Bitmap? {
        if(z !in 0..22||x<0||y<0||x >= (1 shl z)||y >= (1 shl z))return null
        val db=SQLiteDatabase.openDatabase(path,null,SQLiteDatabase.OPEN_READONLY or SQLiteDatabase.NO_LOCALIZED_COLLATORS)
        return try {db.rawQuery("SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=? LIMIT 1",arrayOf(z.toString(),x.toString(),tmsRow(z,y).toString())).use{c->if(!c.moveToFirst())null else {val bytes=c.getBlob(0);if(bytes.size>4*1024*1024)null else BitmapFactory.decodeByteArray(bytes,0,bytes.size)}}} finally {db.close()}
    }

    private fun notifyIfDecoded(bitmap:Bitmap?,onBitmapReady:()->Unit) {
        if(bitmap==null||bitmap.isRecycled||bitmap.width<=0||bitmap.height<=0)return
        // A fully transparent raster tile is still a valid decoded map tile, including
        // nodata/overlay tiles. Coverage bounds and null decodes already exclude misses.
        onBitmapReady()
    }
}
