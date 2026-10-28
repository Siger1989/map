package com.shantu.nativeapp.map

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Rect
import android.os.Handler
import android.os.Looper
import android.view.View
import earth.worldwind.WorldWindow
import earth.worldwind.geom.LookAt
import earth.worldwind.geom.Position
import earth.worldwind.geom.Sector
import earth.worldwind.layer.RenderableLayer
import earth.worldwind.render.image.ImageSource
import earth.worldwind.shape.SurfaceImage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.asinh
import kotlin.math.atan
import kotlin.math.floor
import kotlin.math.min
import kotlin.math.sinh
import kotlin.math.tan
import kotlin.coroutines.coroutineContext

internal data class NativeRasterDetailTile(val z:Int,val x:Int,val y:Int,val col:Int,val row:Int)
internal data class NativeRasterDetailBounds(val west:Double,val south:Double,val east:Double,val north:Double)
internal data class NativeRasterDetailPatch(
    val z:Int,val left:Int,val top:Int,val width:Int,val height:Int,
    val fullViewport:Boolean,val west:Double,val south:Double,val east:Double,val north:Double,
    val tiles:List<NativeRasterDetailTile>,
) {
    val key get()="$z/$left/$top/$width/$height"
}

/** Same 12x12 centre / <=144 current-viewport budget as web RasterDetailPatch. */
internal object NativeRasterDetailPlan {
    fun create(longitude:Double,latitude:Double,zoom:Int,bounds:NativeRasterDetailBounds?=null,maxSide:Int=MAX_VIEWPORT_SIDE):NativeRasterDetailPatch {
        require(longitude.isFinite() && latitude.isFinite() && zoom in 0..24)
        val boundedSide=maxSide.coerceIn(1,MAX_VIEWPORT_SIDE)
        val n=1 shl zoom
        val size=min(min(MAX_CENTER_SIDE,boundedSide),n)
        val centerX=floor((longitude+180.0)/360.0*n).toInt()
        val centerY=tileY(latitude,zoom)
        var left=(centerX-size/2).coerceIn(0,n-size)
        var top=(centerY-size/2).coerceIn(0,n-size)
        var width=size;var height=size;var fullViewport=false
        if(bounds!=null && bounds.west.isFinite() && bounds.south.isFinite() && bounds.east.isFinite() && bounds.north.isFinite() &&
            bounds.east>=bounds.west && bounds.west>=-180.0 && bounds.east<=180.0 && bounds.south<=bounds.north) {
            val west=floor((bounds.west+180.0)/360.0*n).toInt().coerceAtLeast(0)
            val east=floor((bounds.east+180.0)/360.0*n).toInt().coerceAtMost(n-1)
            val north=tileY(bounds.north,zoom).coerceAtLeast(0)
            val south=tileY(bounds.south,zoom).coerceAtMost(n-1)
            val w=east-west+1;val h=south-north+1
            if(w>0 && h>0 && w<=boundedSide && h<=boundedSide && w.toLong()*h<=MAX_TILES) {
                left=west;top=north;width=w;height=h;fullViewport=true
            }
        }
        val eastX=left+width
        val southY=top+height
        val northLat=latitudeAtTile(top.toDouble(),zoom)
        val southLat=latitudeAtTile(southY.toDouble(),zoom)
        return NativeRasterDetailPatch(zoom,left,top,width,height,fullViewport,
            left.toDouble()/n*360.0-180.0,southLat,eastX.toDouble()/n*360.0-180.0,northLat,
            List(width*height) { i -> NativeRasterDetailTile(zoom,left+i%width,top+i/width,i%width,i/width) })
    }

    fun tileY(latitude:Double,zoom:Int):Int {
        val n=1 shl zoom
        val lat=latitude.coerceIn(-MAX_MERCATOR_LAT,MAX_MERCATOR_LAT)
        return floor((1.0-asinh(tan(Math.toRadians(lat)))/Math.PI)/2.0*n).toInt().coerceIn(0,n-1)
    }

    fun latitudeAtTile(y:Double,zoom:Int):Double {
        val n=1 shl zoom
        return Math.toDegrees(atan(sinh(Math.PI*(1.0-2.0*y/n))))
    }

    private const val MAX_CENTER_SIDE=12
    private const val MAX_VIEWPORT_SIDE=16
    private const val MAX_TILES=144L
    private const val MAX_MERCATOR_LAT=85.05112878
}

internal class NativeRasterDetailProvider(
    val identity:String,
    val minZoom:Int,
    val maxZoom:Int,
    val tileSize:Int,
    /** Produces one WGS84-output tile; custom datum sources use NativeRasterProjection here. */
    val fetchOutputTile:suspend (x:Int,y:Int,z:Int)->Bitmap?,
) {
    init { require(minZoom in 0..24 && maxZoom in minZoom..24 && tileSize in setOf(256,512,1024,2048)) }
    override fun toString()="NativeRasterDetailProvider(identity=$identity, credentials=redacted)"
}

/**
 * Fixed raster detail is an independent bounded image overlay. The ordinary base remains an adaptive
 * overview capped at the chosen level, so camera levels below that cap never go blank.
 */
internal class NativeRasterDetailLayer(
    private val window:WorldWindow,
    private val network:BoundedTileNetwork,
    private val onStatus:(String)->Unit,
) : AutoCloseable {
    val renderLayer=RenderableLayer("Fixed raster detail")
    private val main=Handler(Looper.getMainLooper())
    private val scope=CoroutineScope(SupervisorJob()+Dispatchers.IO)
    private var activeJob:kotlinx.coroutines.Job?=null
    private var provider:NativeRasterDetailProvider?=null
    private var fixedZoom:Int?=null
    private var lastPatchKey:String?=null
    private var generation=0
    private var currentBitmap:Bitmap?=null
    private var closed=false
    private var resumed=true
    private val layoutListener=View.OnLayoutChangeListener { _,_,_,_,_,_,_,_,_ -> updateViewport() }
    private val attachmentListener=object:android.view.View.OnAttachStateChangeListener {
        override fun onViewAttachedToWindow(v:android.view.View) { schedulePoll(0L) }
        override fun onViewDetachedFromWindow(v:android.view.View) { main.removeCallbacks(poll) }
    }
    private val poll=object:Runnable {
        override fun run() {
            if(closed || fixedZoom==null)return
            updateViewport()
            if(resumed && window.isAttachedToWindow)main.postDelayed(this,POLL_INTERVAL_MS)
        }
    }

    init {
        window.addOnLayoutChangeListener(layoutListener)
        window.addOnAttachStateChangeListener(attachmentListener)
    }

    fun sync(zoom:Int?,nextProvider:NativeRasterDetailProvider?) {
        check(Looper.myLooper()==Looper.getMainLooper()) { "Fixed detail must be synchronized on the main thread" }
        if(closed)return
        require(zoom==null || zoom in 0..24)
        val providerChanged=provider?.identity!=nextProvider?.identity
        if(fixedZoom==zoom && !providerChanged)return
        fixedZoom=zoom;provider=nextProvider
        generation++;activeJob?.cancel();activeJob=null;lastPatchKey=null
        clearImage()
        if(zoom==null) { main.removeCallbacks(poll);onStatus("");return }
        if(nextProvider==null) { main.removeCallbacks(poll);onStatus("当前图源不支持固定级别细节拼图");return }
        if(zoom !in nextProvider.minZoom..nextProvider.maxZoom) {
            main.removeCallbacks(poll)
            onStatus("当前图源支持 ${nextProvider.minZoom}—${nextProvider.maxZoom} 级，固定级别 $zoom 暂不可用")
            return
        }
        onStatus("固定级别 $zoom：等待当前视野瓦片")
        schedulePoll(0L)
    }

    private fun schedulePoll(delay:Long) {
        main.removeCallbacks(poll)
        if(!closed && resumed && fixedZoom!=null)main.postDelayed(poll,delay)
    }

    fun pause() { resumed=false;main.removeCallbacks(poll) }
    fun resume() { if(closed)return;resumed=true;schedulePoll(0L) }

    private fun updateViewport() {
        if(closed || !resumed || !window.isAttachedToWindow || window.width<=0 || window.height<=0)return
        val z=fixedZoom ?: return
        val source=provider ?: return
        if(z !in source.minZoom..source.maxZoom)return
        val look=window.engine.cameraAsLookAt(LookAt())
        val centerLon=look.position.longitude.inDegrees
        val centerLat=look.position.latitude.inDegrees
        val bounds=viewportBounds()
        val maxSide=NativeRenderMemoryBudget.rasterPatchSide(Runtime.getRuntime().maxMemory(),source.tileSize)
        val patch=runCatching { NativeRasterDetailPlan.create(centerLon,centerLat,z,bounds,maxSide) }.getOrNull() ?: return
        if(lastPatchKey==patch.key)return
        lastPatchKey=patch.key
        val mine=++generation
        activeJob?.cancel()
        clearImage()
        onStatus(if(patch.fullViewport)"正在加载固定级别 $z（覆盖当前视野）…" else "正在加载固定级别 $z（中心细节，外围概览）…")
        activeJob=scope.launch(start=CoroutineStart.ATOMIC) {
            val bitmap=runCatching { loadPatch(source,patch) }.getOrNull()
            if(bitmap==null) {
                withContext(Dispatchers.Main.immediate) {
                    if(!closed && generation==mine)onStatus("固定级别 $z 瓦片暂缺；外围保持同源概览，可移动后重试")
                }
                return@launch
            }
            withContext(Dispatchers.Main.immediate) {
                if(closed || generation!=mine || fixedZoom!=z || provider?.identity!=source.identity) {
                    bitmap.recycle();return@withContext
                }
                val sector=Sector.fromDegrees(patch.south,patch.west,patch.north,patch.east)
                renderLayer.clearRenderables()
                renderLayer.addRenderable(SurfaceImage(sector,ImageSource.fromBitmap(bitmap)))
                retire(currentBitmap)
                currentBitmap=bitmap
                window.requestRedraw()
                onStatus(if(patch.fullViewport)"当前视野使用固定级别 $z" else "中心为固定级别 $z，外围同源概览")
            }
        }
    }

    private suspend fun loadPatch(source:NativeRasterDetailProvider,patch:NativeRasterDetailPatch):Bitmap?=coroutineScope {
        val bitmap=Bitmap.createBitmap(patch.width*source.tileSize,patch.height*source.tileSize,Bitmap.Config.ARGB_8888)
        val canvas=Canvas(bitmap)
        val cursor=AtomicInteger()
        val completed=AtomicInteger()
        try {
            repeat(TILE_WORKERS) {
                launch {
                    while(true) {
                        coroutineContext.ensureActive()
                        val index=cursor.getAndIncrement()
                        if(index>=patch.tiles.size)break
                        val tile=patch.tiles[index]
                        val fetched=source.fetchOutputTile(tile.x,tile.y,tile.z) ?: throw IllegalStateException("fixed tile unavailable")
                        try {
                            val normalized=if(fetched.width!=source.tileSize || fetched.height!=source.tileSize)
                                Bitmap.createScaledBitmap(fetched,source.tileSize,source.tileSize,true) else fetched
                            try {
                                synchronized(canvas) {
                                    canvas.drawBitmap(normalized,null,Rect(tile.col*source.tileSize,tile.row*source.tileSize,
                                        (tile.col+1)*source.tileSize,(tile.row+1)*source.tileSize),null)
                                }
                            } finally { if(normalized!==fetched)normalized.recycle() }
                        } finally { fetched.recycle() }
                        completed.incrementAndGet()
                    }
                }
            }
            if(completed.get()!=patch.tiles.size)throw IllegalStateException("incomplete fixed tile patch")
            NativeRasterDetailWarp.toGeographicLatitude(bitmap,patch)
        } catch(error:CancellationException) {
            bitmap.recycle();throw error
        } catch(error:Exception) {
            bitmap.recycle();throw error
        }
    }

    /** WorldWind SurfaceImage maps texture rows linearly in latitude; source tiles are Mercator. */
    private object NativeRasterDetailWarp {
        private val lock=Any()
        fun toGeographicLatitude(bitmap:Bitmap,patch:NativeRasterDetailPatch):Bitmap = synchronized(lock) {
            val width=bitmap.width;val height=bitmap.height
            if(height<=1)return@synchronized bitmap
            val source=IntArray(width*height);bitmap.getPixels(source,0,width,0,0,width,height)
            val outputRow=IntArray(width)
            val n=1 shl patch.z
            val sourceTop=patch.top.toDouble()
            val sourceSpan=patch.height.toDouble()
            for(y in 0 until height) {
                val latitude=patch.north+(patch.south-patch.north)*y/(height-1.0)
                val clamped=latitude.coerceIn(-85.05112878,85.05112878)
                val mercY=(1.0-asinh(tan(Math.toRadians(clamped)))/Math.PI)/2.0*n
                val sourceY=((mercY-sourceTop)/sourceSpan*height).coerceIn(0.0,height-1.0)
                val y0=floor(sourceY).toInt();val y1=min(height-1,y0+1);val fy=sourceY-y0
                for(x in 0 until width) {
                    val c0=source[y0*width+x];val c1=source[y1*width+x]
                    fun channel(a:Int,b:Int)=((a*(1.0-fy)+b*fy).toInt()).coerceIn(0,255)
                    outputRow[x]=Color.argb(channel(Color.alpha(c0),Color.alpha(c1)),channel(Color.red(c0),Color.red(c1)),
                        channel(Color.green(c0),Color.green(c1)),channel(Color.blue(c0),Color.blue(c1)))
                }
                bitmap.setPixels(outputRow,0,width,0,y,width,1)
            }
            bitmap
        }
    }

    private fun viewportBounds():NativeRasterDetailBounds? {
        val corners=listOf(0f to 0f,window.width.toFloat() to 0f,window.width.toFloat() to window.height.toFloat(),0f to window.height.toFloat())
        val positions=corners.map { (x,y) ->
            Position().takeIf { window.engine.screenPointToPositionAtAltitude(x.toDouble(),y.toDouble(),0.0,it) }
        }
        if(positions.any { it==null })return null
        val values=positions.filterNotNull().map { it.longitude.inDegrees to it.latitude.inDegrees }
        val center=window.engine.cameraAsLookAt(LookAt()).position.longitude.inDegrees
        val unwrapped=values.map { (lon,lat) ->
            var value=lon
            while(value-center>180.0)value-=360.0
            while(value-center < -180.0)value+=360.0
            value to lat
        }
        val west=unwrapped.minOf { it.first };val east=unwrapped.maxOf { it.first }
        if(west < -180.0 || east > 180.0)return null
        return NativeRasterDetailBounds(west,unwrapped.minOf { it.second },east,unwrapped.maxOf { it.second })
    }

    private fun clearImage() {
        renderLayer.clearRenderables()
        window.requestRedraw()
        retire(currentBitmap);currentBitmap=null
    }

    private fun retire(bitmap:Bitmap?) {
        if(bitmap==null)return
        main.postDelayed({ if(!bitmap.isRecycled)bitmap.recycle() },BITMAP_RETIRE_DELAY_MS)
    }

    override fun close() {
        if(closed)return
        closed=true;generation++
        main.removeCallbacks(poll)
        window.removeOnLayoutChangeListener(layoutListener)
        window.removeOnAttachStateChangeListener(attachmentListener)
        activeJob?.cancel();activeJob=null
        scope.cancel()
        renderLayer.clearRenderables()
        retire(currentBitmap);currentBitmap=null
        provider=null
        window.requestRedraw()
    }

    private companion object {
        const val TILE_WORKERS=2
        const val POLL_INTERVAL_MS=500L
        const val BITMAP_RETIRE_DELAY_MS=750L
    }
}
