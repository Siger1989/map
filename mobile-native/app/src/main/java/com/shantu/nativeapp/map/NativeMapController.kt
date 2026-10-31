package com.shantu.nativeapp.map

import android.content.Context
import android.app.ActivityManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color as AndroidColor
import android.os.Handler
import android.os.Looper
import android.view.View
import earth.worldwind.WorldWindow
import earth.worldwind.geom.AltitudeMode
import earth.worldwind.geom.Angle.Companion.degrees
import earth.worldwind.geom.Position
import earth.worldwind.geom.LookAt
import earth.worldwind.geom.Vec2
import earth.worldwind.layer.BackgroundLayer
import earth.worldwind.layer.RenderableLayer
import earth.worldwind.layer.mercator.MercatorTiledImageLayer
import earth.worldwind.layer.mercator.MercatorTileFactory
import earth.worldwind.layer.mercator.MercatorTiledSurfaceImage
import earth.worldwind.render.Color
import earth.worldwind.render.Renderable
import earth.worldwind.render.RenderResourceCache
import earth.worldwind.render.AFLevel
import earth.worldwind.render.Texture
import earth.worldwind.render.image.ImageSource
import earth.worldwind.render.image.ImageConfig
import earth.worldwind.render.image.ImageOptions
import earth.worldwind.render.image.ArgbImage
import earth.worldwind.render.image.toImageSource
import earth.worldwind.shape.Path
import earth.worldwind.shape.Polygon
import earth.worldwind.shape.Placemark
import earth.worldwind.shape.PlacemarkAttributes
import earth.worldwind.shape.OrientationMode
import earth.worldwind.shape.ShapeAttributes
import java.net.URLEncoder
import kotlin.math.pow
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean
import java.util.WeakHashMap
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.cancel
import kotlinx.coroutines.withTimeoutOrNull

private val NO_RASTER_DECODE_CALLBACK: () -> Unit = {}
private val NO_RASTER_LOAD_CALLBACK: () -> Unit = {}

/** Serializable view state. Range is eye-to-look-at distance in meters. */
data class NativeCameraSnapshot(
    val latitude: Double,
    val longitude: Double,
    val rangeMeters: Double,
    val headingDegrees: Double,
    val pitchDegrees: Double,
    val rollDegrees: Double = 0.0,
)

/** Safe diagnostics; null first-frame state means this controller has no verified render signal. */
data class NativeMapDiagnostics(
    val worldWindowCreated: Boolean,
    val viewAttached: Boolean,
    /** Null means no verifiable first-render signal is currently wired by this controller. */
    val firstFrameRendered: Boolean?,
    val selectedSourceId: String?,
    val camera: NativeCameraSnapshot,
)

/**
 * Native WorldWind map surface. Tile requests use the process-wide map/cache network pool.
 * Tile URLs (and the private key in them) are never logged or surfaced through status text.
 */
class NativeMapController internal constructor(
    context: Context,
    tiandituKey: String,
    sharedNetwork: BoundedTileNetwork? = null,
    private val onStatus: (String) -> Unit,
) {
    private val appContext = context.applicationContext
    private val key = tiandituKey.trim()
    private val encodedKey = URLEncoder.encode(key, "UTF-8")
    private val bridgeRasterLoads = NativeRasterLoadTracker()
    @Volatile private var bridgePrintRasterFrameCoverage: NativePrintRasterFrameCoverage? = null
    private val memoryManager = appContext.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
    private val physicalMemory = ActivityManager.MemoryInfo().also { memoryManager?.getMemoryInfo(it) }.totalMem
    private val worldWindow = WorldWindow(context, renderResourceCache = RenderResourceCache(
        context, capacity = NativeRenderMemoryBudget.textureCapacityBytes(
            Runtime.getRuntime().maxMemory(), physicalMemory, memoryManager?.isLowRamDevice == true),
    ))
    val view: View get() = worldWindow
    private val mainHandler = Handler(Looper.getMainLooper())
    private val pickScope = CoroutineScope(SupervisorJob()+Dispatchers.Main.immediate)
    private var pickGeneration = 0
    @Volatile private var pendingPickCount = 0

    private val networkLease = if (sharedNetwork == null) NativeTileNetworkPool.acquire(appContext) { message -> reportStatus(message) } else null
    private val network = sharedNetwork ?: checkNotNull(networkLease).network
    private val cacheRefreshObserver = network.observeRefresh { factory ->
        mainHandler.post {
            if (disposed) return@post
            val imageSource = ImageSource.fromImageFactory(factory)
            synchronized(worldWindow.engine.renderResourceCache) {
                worldWindow.engine.renderResourceCache.remove(imageSource)
            }
            worldWindow.requestRedraw()
        }
    }
    private val cartography = NativeCartographyLayers(
        worldWindow, { key }, sharedNetwork = network,
        tileIdentityFor = { source, layer, z, x, y, style -> tileIdentityAndRegister(source, layer, z, x, y, style) },
        viewId = { tileViewId }, generation = { tileDemandGeneration },
    ) { status ->
        if (status.message.isNotBlank()) reportStatus(status.message)
        imageryStatusListener?.invoke(status)
    }
    @Volatile private var imageryStatusListener: ((NativeImageryStatus) -> Unit)? = null
    private val skyLayer = ClearDaySkyLayer()
    private val baseLayer: RenderableLayer = RenderableLayer("Tianditu base")
    private val fixedDetailLayer=NativeRasterDetailLayer(worldWindow,network,::reportStatus,::tileDemandFocusPx,::currentTileDemandGeneration,::fixedDetailTileRank)
    private val terrainBackgroundLayer = BackgroundLayer(
        ImageSource.fromBitmap(Bitmap.createBitmap(1, 1, Bitmap.Config.RGB_565).apply { eraseColor(0xFF203B3F.toInt()) }),
        ImageOptions(ImageConfig.RGB_565),
    ).apply { isEnabled = false }
    private val terrainBasemapLayer: RenderableLayer = RenderableLayer("Native DEM terrain base")
    private val terrainOverlayLayer: RenderableLayer = RenderableLayer("Terrain overlays")
    private val labelLayer: RenderableLayer = RenderableLayer("Tianditu labels")
    private val markerLayer: RenderableLayer = RenderableLayer("Markers")
    private val terrainCutLayer=NativeTerrainCutLayer().apply { isEnabled = false }
    private val markerDocuments=linkedMapOf<String,org.json.JSONObject>()
    private var modelTerrainStamp: NativeModelTerrainInput.Stamp? = null
    private var bridgeMarkerZoom = Double.NaN
    private var bridgeSelectedMarker: String? = null
    private var bridgeMarkerCssScale = 1.0
    private val markerPresentation = NativeMarkerPresentationState()
    private var bridgeMarkerMode: String? = null
    internal fun setBridgeMarkerCssScale(cssScale: Double) {
        val safe = cssScale.takeIf { it.isFinite() && it > 0.0 } ?: 1.0
        if (safe == bridgeMarkerCssScale) return
        bridgeMarkerCssScale = safe
        setBridgeMarkerPresentation(bridgeMarkerZoom, bridgeSelectedMarker)
        if (positionArrowVisible) {
            positionRenderables.filterIsInstance<Placemark>().forEach { it.attributes.imageScale = nativePositionArrowScale(safe) }
            worldWindow.requestRedraw()
        }
    }
    internal fun setBridgeMarkerPresentation(zoom: Double, selectedId: String?) {
        bridgeMarkerZoom = zoom
        bridgeSelectedMarker = selectedId
        val update = markerPresentation.update(zoom, bridgeMarkerCssScale)
        bridgeMarkerMode = update.mode
        if (!update.resize) return
        val documents = markerDocuments.values.toList()
        val rebuild = mutableListOf<org.json.JSONObject>()
        synchronized(worldWindow.engine.renderResourceCache) {
            documents.forEach { document ->
                val rendered = markers[document.optString("id")]
                if (rendered != null && !NativeModelRenderer.updateMarkerPresentation(
                        rendered, zoom, bridgeMarkerCssScale, update.mode)) rebuild += document
            }
        }
        rebuild.forEach(::renderMarker)
        if (documents.isNotEmpty()) worldWindow.requestRedraw()
    }
    internal fun refreshModelTerrain(): List<NativeMarkerRenderResult>? {
        val stamp=modelPlacementRevision()
        if(stamp==modelTerrainStamp)return null
        modelTerrainStamp=stamp
        return markerDocuments.values.toList().filter(NativeModelTerrainInput::needsTerrainRefresh).map(::renderMarker)
    }
    internal fun modelPlacementRevision()=NativeModelTerrainInput.Stamp(
        worldWindow.engine.globe.elevationModel.timestamp,terrainEnabled,worldWindow.engine.globe.verticalExaggeration)
    private val positionLayer: RenderableLayer = RenderableLayer("Current position")
    private val photoLayer=NativePhotoLayer()
    internal fun replacePhotos(photos:org.json.JSONArray){photoLayer.replace(photos);worldWindow.requestRedraw()}
    private var geology:com.shantu.nativeapp.geology.NativeGeologyLayer?=null
    internal fun configureGeology(provider:com.shantu.nativeapp.geology.NativeGeologyCredentialProvider,onState:(com.shantu.nativeapp.geology.NativeGeologyState)->Unit){
        geology?.let { worldWindow.engine.layers.removeLayer(it.renderLayer);worldWindow.engine.layers.removeLayer(it.cloudRenderLayer);it.close() }
        geology=com.shantu.nativeapp.geology.NativeGeologyLayer(worldWindow,onState,com.shantu.nativeapp.geology.NativeGeologyCloudClient(provider)).also {
            worldWindow.engine.layers.addLayer(1,it.renderLayer);worldWindow.engine.layers.addLayer(2,it.cloudRenderLayer)
        }
    }
    internal fun setGeology(enabled:Boolean,source:com.shantu.nativeapp.geology.NativeGeologySource,opacity:Double){geology?.setSource(source);geology?.setOpacity(opacity);geology?.setEnabled(enabled)}
    internal fun retryGeology(){geology?.retry()}
    internal fun selectGeology(key:String){geology?.selectFeature(key)}
    private var positionRenderables: List<Renderable> = emptyList()
    private val routeLayer: RenderableLayer = RenderableLayer("Routes")
    private val areaLayer: RenderableLayer = RenderableLayer("Areas")
    private val markers = linkedMapOf<String, List<Renderable>>()
    private val routes = linkedMapOf<String, Path>()
    private val areas = linkedMapOf<String, Polygon>()
    private val areaEditRenderables = linkedMapOf<String, List<Renderable>>()
    private var areaDraftRenderables: List<Renderable> = emptyList()
    private val areaVertexImageCache = linkedMapOf<Int, ImageSource>()
    private var selectedSourceId: String? = null
    private var selectedSource: NativeMapSourceSelection? = null
    private var customSource: NativeMapSource? = null
    private var quality: NativeMapQuality = NativeMapQuality.HIGH
    private var fixedRasterZoom: Int? = null
    private var rasterLabelOpacity = 1f
    private var legacyRasterLayersVisible = true
    private var terrainEnabled = false
    private var terrainCoverage: NativeTerrariumCoverage? = null
    private var terrainCoverageAttached = false
    private var terrainBasemapRenderer: NativeTerrainBasemap? = null
    private var terrainBasemapEnabled = false
    private var terrainOverlayRenderer: NativeTerrainOverlays? = null
    private var terrainOverlayUiZoom = Double.NaN
    private var terrainOverlayCssScale = 1f
    private var terrainOverlayOptions = NativeTerrainOverlayOptions(false, false)
    private var appliedTerrainOverlayOptions: NativeTerrainOverlayOptions? = null
    private var terrainOverlayGeneration = 0
    @Volatile private var disposed = false
    @Volatile private var frameDrawn = false
    @Volatile private var lastFrameStatusAt = 0L
    private var reportedImageCount = -1L
    @Volatile private var bridgeFrameListener: ((DoubleArray, Int, Int) -> Unit)? = null
    @Volatile private var bridgeCameraMotionListener: ((DoubleArray) -> Unit)? = null
    @Volatile private var bridgeFrameActivityListener: (() -> Unit)? = null
    @Volatile private var lastBridgeFrameMatrix: DoubleArray? = null
    private val bridgeFrameWitnesses = NativeBridgeFrameWitnessQueue<NativeBridgeFrameWitness<*>>()
    private var bridgeCameraConfigured = false
    private var bridgeGroundAnchor: NativeCameraSnapshot? = null
    private var bridgeAnchorElevation: Double? = null
    private var bridgeAnchorExaggeration = Double.NaN
    private val tileFootprints = object : LinkedHashMap<TileRequestIdentity, List<Pair<Double, Double>>>(128, .75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<TileRequestIdentity, List<Pair<Double, Double>>>?): Boolean = size > MAX_TILE_FOOTPRINTS
    }
    @Volatile private var tileDemandGeneration = 1L
    private var lastTileDemandSignature: List<Long>? = null
    private var drawingFocus: TileScreenPoint? = null
    @Volatile private var tileDemandDirty = true
    private val tileViewId = "map-${java.util.UUID.randomUUID()}"
    private val tileDemandPostPending = AtomicBoolean(false)
    private val namespaceHashes = object : LinkedHashMap<String, String>(64, .75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, String>?): Boolean = size > MAX_NAMESPACE_HASHES
    }
    private val customStyleFingerprints = WeakHashMap<NativeMapSource, List<String>>()

    internal fun clearBridgeGroundAnchor() { bridgeGroundAnchor = null; bridgeAnchorElevation = null }

    /** Keep an explicitly requested ground target stable while its real DEM arrives/refines. */
    internal fun refreshBridgeGroundAnchor(): Boolean {
        val anchor = bridgeGroundAnchor ?: return false
        if (!bridgeCameraConfigured || !terrainEnabled || disposed) return false
        val elevation = getElevation(anchor.latitude, anchor.longitude) ?: return false
        val exaggeration = worldWindow.engine.globe.verticalExaggeration
        if (bridgeAnchorElevation == elevation && bridgeAnchorExaggeration == exaggeration) return false
        restoreCamera(anchor)
        return true
    }

    val centerLatitude: Double get() = cameraSnapshot().latitude
    val centerLongitude: Double get() = cameraSnapshot().longitude

    internal fun loadingSnapshot() = network.snapshot()
    /** Successful base-image bitmap decodes for this controller's current source generation. */
    internal fun bridgeRasterTileSnapshot(): Long = bridgeRasterLoads.decodedTiles()
    /** This map's selected source work, including its requests queued in the shared network pool. */
    internal fun bridgeRasterPendingLoads(): Int = bridgeRasterLoads.pendingLoads()
    /** Enables exact visible-tile accounting for an isolated print renderer only. */
    internal fun enableBridgePrintRasterFrameCoverage() {
        check(Looper.myLooper() == Looper.getMainLooper())
        if (bridgePrintRasterFrameCoverage == null) bridgePrintRasterFrameCoverage = NativePrintRasterFrameCoverage()
    }
    internal fun bridgePrintRasterFrameSnapshot(): NativePrintRasterFrameSnapshot =
        bridgePrintRasterFrameCoverage?.snapshot() ?: NativePrintRasterFrameSnapshot()
    internal fun bridgePrintRasterFrameSnapshotsAfter(sequence: Long): List<NativePrintRasterFrameSnapshot> =
        bridgePrintRasterFrameCoverage?.snapshotsAfter(sequence).orEmpty()

    private fun resetBridgeRasterEvidence(): Long = bridgeRasterLoads.reset()

    private fun bridgeRasterCallbacks(generation: Long): NativeRasterLoadCallbacks = bridgeRasterLoads.callbacks(generation)
    internal fun isTerrainEnabled(): Boolean = terrainEnabled
    internal fun tileNetwork(): BoundedTileNetwork = network
    internal fun demRevision(): Long = worldWindow.engine.globe.elevationModel.timestamp
    internal fun createSectionSurfaceLayer() = com.shantu.nativeapp.section.NativeSectionSurfaceLayer(worldWindow)
    internal fun createSectionDemSampler():com.shantu.nativeapp.section.NativeSectionDemSampler {
        check(Looper.myLooper()==Looper.getMainLooper())
        return com.shantu.nativeapp.section.NativeSectionDemSampler(ensureTerrainCoverage())
    }
    internal suspend fun sampleBridgeDemTile(z:Int,x:Int,y:Int,outputSize:Int=256):DoubleArray? =
        ensureTerrainCoverage().sampleMercatorTile(z,x,y,256,outputSize)
    internal fun prepareBridgeDemCoverage(){check(Looper.myLooper()==Looper.getMainLooper());ensureTerrainCoverage()}
    internal fun configureCartography(settings:NativeCartographySettings,activeCustomSource:Boolean,baseSelectionAllowed:Boolean,maxRasterZoom:Int?=null) {
        check(Looper.myLooper()==Looper.getMainLooper())
        cartography.apply(settings,activeCustomSource,baseSelectionAllowed,maxRasterZoom)
        refreshTileDemand(forceGeneration = true)
        val builtInTerrainBase = !activeCustomSource &&
            (settings.sourceId == "terrain" || settings.sourceId == "offline" || settings.offlineBasemap)
        setTerrainBasemapEnabled(builtInTerrainBase)
    }
    private fun setTerrainBasemapEnabled(enabled:Boolean) {
        if (disposed || terrainBasemapEnabled == enabled) return
        terrainBasemapEnabled = enabled
        val rasterCallbacks = if (enabled) bridgeRasterCallbacks(resetBridgeRasterEvidence()) else null
        terrainBasemapRenderer?.close(); terrainBasemapRenderer = null
        terrainBasemapLayer.clearRenderables()
        terrainBasemapLayer.isEnabled = enabled
        terrainBackgroundLayer.isEnabled = enabled
        if (enabled) {
            val callbacks = rasterCallbacks ?: NativeRasterLoadCallbacks(
                NO_RASTER_DECODE_CALLBACK, NO_RASTER_LOAD_CALLBACK, NO_RASTER_LOAD_CALLBACK,
            )
            val renderer = NativeTerrainBasemap(
                ensureTerrainCoverage(), callbacks.onBitmapDecoded, callbacks.onLoadStarted, callbacks.onLoadFinished,
            )
            terrainBasemapRenderer = renderer
            renderer.renderables().forEach(terrainBasemapLayer::addRenderable)
        } else if (!terrainEnabled && !terrainOverlayOptions.contoursEnabled && !terrainOverlayOptions.elevationColorsEnabled) {
            terrainCoverage = null
        }
        worldWindow.requestRedraw()
    }
    /** Hides the controller's legacy TDT/custom raster stack when another effective base is selected. */
    internal fun setLegacyRasterLayersVisible(visible: Boolean) {
        check(Looper.myLooper() == Looper.getMainLooper())
        if (disposed) return
        legacyRasterLayersVisible = visible
        baseLayer.isEnabled = visible
        labelLayer.isEnabled = visible && rasterLabelOpacity > 0f
        fixedDetailLayer.renderLayer.isEnabled = visible
        refreshTileDemand(forceGeneration = true)
        if (!visible && !terrainBasemapEnabled) {
            resetBridgeRasterEvidence()
        }
        if (!visible) {
            baseLayer.clearRenderables()
            labelLayer.clearRenderables()
            fixedDetailLayer.sync(null, null)
            if (customSource == null) {
                selectedSource = null
                selectedSourceId = null
            }
        }
        worldWindow.requestRedraw()
    }
    internal fun cartographyForBridge():NativeCartographyLayers=cartography
    internal fun cancelBridgePickRequests():Boolean {
        check(Looper.myLooper()==Looper.getMainLooper())
        val pending=pendingPickCount>0
        if(pending)pickGeneration++
        return pending
    }
    internal fun retrySatellite() = cartography.retryLatestImagery()
    internal fun satelliteStatus() = cartography.imageryStatus()
    internal fun setImageryStatusListener(listener:((NativeImageryStatus)->Unit)?){imageryStatusListener=listener}

    init {
        // Keep oblique imagery readable instead of isotropic mipmaps smearing it into bands.
        Texture.anisotropicFiltering = AFLevel.AF8X
        // WorldWind 2.1.1's RenderResourceCache remote lane is a separate admission cap from our
        // shared HTTP scheduler. Raise only its network-image slot count to the same 20-request cap.
        worldWindow.engine.renderResourceCache.remoteRetrievalQueueSize = BoundedTileNetwork.MAX_ACTIVE_REQUESTS
        val initial = LookAt().apply {
            set(
                28.0.degrees, 10.0.degrees, 0.0, AltitudeMode.ABSOLUTE,
                19_000_000.0, 0.0.degrees, 22.0.degrees, 0.0.degrees,
            )
        }
        worldWindow.engine.cameraFromLookAt(initial)
        worldWindow.engine.frameMetrics=object:earth.worldwind.frame.FrameMetrics{
            override fun beginRendering(rc:earth.worldwind.render.RenderContext){bridgePrintRasterFrameCoverage?.beginFrame()}
            override fun endRendering(rc:earth.worldwind.render.RenderContext){
                bridgePrintRasterFrameCoverage?.let { coverage ->
                    val candidate = coverage.freezeFrame()
                    rc.offerScreenDrawable(NativePrintFrameWitnessDrawable {
                        val cache = worldWindow.engine.renderResourceCache
                        coverage.publishDrawnFrame(candidate, cache.usedCapacity, cache.capacity, cache.entryCount) { source ->
                            cache[source] is Texture
                        }
                    }, Double.MAX_VALUE)
                }
                val bridgeWitness = if (bridgeFrameWitnesses.hasPending()) {
                    check(Looper.myLooper() == Looper.getMainLooper()) { "Bridge frame metadata factories must run on the Android main thread" }
                    bridgeFrameWitnesses.take()
                } else null
                bridgeWitness?.let { witness ->
                    rc.offerScreenDrawable(NativeBridgeFrameWitnessDrawable { dc ->
                        witness.draw(dc.modelviewProjection.m.copyOf(), dc.viewport.width, dc.viewport.height)
                    }, Double.MAX_VALUE)
                }
                rc.sortDrawables()
            }
            override fun beginDrawing(dc:earth.worldwind.draw.DrawContext){}
            override fun endDrawing(dc:earth.worldwind.draw.DrawContext){
                frameDrawn=true
                NativeTileStageTelemetry.recordRenderedFrame()
                val mvp = dc.modelviewProjection.m
                val previous = lastBridgeFrameMatrix
                val changed = previous?.contentEquals(mvp) != true
                val frameListener = bridgeFrameListener
                val copy = if (changed || frameListener != null) mvp.copyOf() else null
                if (changed) {
                    lastBridgeFrameMatrix = copy
                    copy?.let { matrix -> runCatching { bridgeCameraMotionListener?.invoke(matrix) } }
                }
                if (frameListener != null && copy != null) runCatching { frameListener.invoke(copy, dc.viewport.width, dc.viewport.height) }
                runCatching { bridgeFrameActivityListener?.invoke() }
                val demandMatrix = mvp.copyOf()
                if (tileDemandPostPending.compareAndSet(false, true)) mainHandler.post {
                    tileDemandPostPending.set(false)
                    refreshTileDemand(projectionMatrix = demandMatrix)
                }
                val now=android.os.SystemClock.elapsedRealtime()
                if(now-lastFrameStatusAt<750)return
                lastFrameStatusAt=now
                mainHandler.post{
                    if(disposed)return@post
                    val state=network.snapshot()
                    val images=state.successes.toLong()+state.memoryHits+state.diskHits
                    if(images>0&&images!=reportedImageCount&&state.activeNetworkRequests==0&&state.queuedNetworkRequests==0){
                        reportedImageCount=images
                        onStatus(if(state.errors>0)"地图已绘制，部分瓦片可点击重试" else "地图画面已更新")
                    }
                }
            }
            override fun reset(){frameDrawn=false}
        }
        worldWindow.engine.layers.addLayer(cartography.underlayRenderLayer)
        worldWindow.engine.layers.addLayer(baseLayer)
        worldWindow.engine.layers.addLayer(cartography.baseRenderLayer)
        worldWindow.engine.layers.addLayer(fixedDetailLayer.renderLayer)
        worldWindow.engine.layers.addLayer(terrainBackgroundLayer)
        worldWindow.engine.layers.addLayer(terrainBasemapLayer)
        cartography.layers.forEach(worldWindow.engine.layers::addLayer)
        worldWindow.engine.layers.addLayer(terrainOverlayLayer)
        worldWindow.engine.layers.addLayer(skyLayer)
        worldWindow.engine.layers.addLayer(routeLayer)
        worldWindow.engine.layers.addLayer(areaLayer)
        worldWindow.engine.layers.addLayer(labelLayer)
        worldWindow.engine.layers.addLayer(markerLayer)
        worldWindow.engine.layers.addLayer(positionLayer)
        worldWindow.engine.layers.addLayer(photoLayer.layer)
        worldWindow.engine.layers.addLayer(terrainCutLayer)
        reportStatus("原生地图视图已创建，等待首屏瓦片请求")
        setSource(SOURCE_IMAGERY)
    }

    fun onResume() { if (!disposed) { worldWindow.onResume(); fixedDetailLayer.resume() } }
    fun onPause() { if (!disposed) { fixedDetailLayer.pause(); worldWindow.onPause() } }

    /** Receives the exact WorldWind view-projection matrix after a real rendered frame. */
    internal fun setBridgeFrameListener(listener: ((DoubleArray, Int, Int) -> Unit)?) {
        bridgeFrameListener = listener
        if (listener == null) {
            lastBridgeFrameMatrix = null
            bridgeFrameWitnesses.clear()
        }
    }
    internal fun setBridgeCameraMotionListener(listener: ((DoubleArray) -> Unit)?) {
        bridgeCameraMotionListener = listener
        if (listener == null) {
            lastBridgeFrameMatrix = null
            bridgeFrameWitnesses.clear()
        }
    }
    internal fun setBridgeFrameActivityListener(listener: (() -> Unit)?) { bridgeFrameActivityListener = listener }
    internal fun prepareBridgeFrameWitness(factory: () -> NativeBridgeFrameWitness<*>?) {
        check(Looper.myLooper() == Looper.getMainLooper()) { "Bridge frame metadata must be prepared on the Android main thread" }
        if (disposed) return
        bridgeFrameWitnesses.offer(factory)
    }
    internal fun worldWindowForBridge(): WorldWindow = worldWindow
    /** The React camera contract converts zoom using a fixed 45-degree vertical field of view. */
    internal fun configureBridgeCameraScale() {
        check(Looper.myLooper() == Looper.getMainLooper())
        worldWindow.engine.isKeepScale = false
        worldWindow.engine.camera.fieldOfView = 45.0.degrees
        bridgeCameraConfigured = true
    }
    internal fun addBridgeOverlayLayer(layer:earth.worldwind.layer.Layer) {
        check(Looper.myLooper()==Looper.getMainLooper())
        val target=worldWindow.engine.layers.indexOfLayer(labelLayer).takeIf { it>=0 } ?: worldWindow.engine.layers.count()
        worldWindow.engine.layers.addLayer(target,layer)
    }

    /** Reports only observable state; tile receipt is deliberately not treated as a rendered frame. */
    fun diagnostics(): NativeMapDiagnostics {
        check(Looper.myLooper() == Looper.getMainLooper()) { "Map diagnostics must run on the Android main thread" }
        return NativeMapDiagnostics(
            worldWindowCreated = true,
            viewAttached = worldWindow.isAttachedToWindow,
            firstFrameRendered = frameDrawn,
            selectedSourceId = selectedSourceId,
            camera = cameraSnapshot(),
        )
    }

    fun dispose() {
        if (disposed) return
        disposed = true
        network.removeViewDemand(tileViewId)
        cacheRefreshObserver.close()
        resetBridgeRasterEvidence()
        geology?.close();geology=null
        cartography.close()
        pickGeneration++;pickScope.cancel()
        fixedDetailLayer.close()
        networkLease?.close()
        terrainOverlayGeneration++
        terrainBasemapRenderer?.close(); terrainBasemapRenderer = null
        terrainBasemapLayer.clearRenderables(); terrainBasemapLayer.isEnabled = false
        terrainOverlayRenderer?.close()
        terrainOverlayRenderer = null
        terrainOverlayLayer.clearRenderables()
        if (terrainCoverageAttached) terrainCoverage?.let(worldWindow.engine.globe.elevationModel::removeCoverage)
        terrainCoverageAttached = false
        terrainCoverage = null
        // Avoid queueEvent here: the host may already have paused the GLSurfaceView and
        // Android is then allowed to drop queued GL-thread work during destruction.
        worldWindow.onPause()
    }

    fun setSource(id: String) {
        require(id in SOURCE_IDS) { "Unknown native map source" }
        if (key.isBlank()) {
            reportStatus("天地图尚未配置授权，图源未请求")
            return
        }
        selectedSourceId = id
        customSource = null
        selectedSource = NativeMapSourceSelection(
            id,
            when (id) { SOURCE_VECTOR -> "天地图矢量"; SOURCE_TERRAIN -> "天地图地形影像"; else -> "天地图影像" },
            "天地图",
            custom = false,
        )
        applySelectedSource()
        refreshTileDemand(forceGeneration = true)
        reportStatus("已选择内置${selectedSource?.name}图源，等待首屏瓦片请求")
    }

    /** Select a validated private/user raster source without changing the camera. */
    fun setCustomSource(source: NativeMapSource) {
        check(Looper.myLooper() == Looper.getMainLooper()) { "Map source selection must run on the Android main thread" }
        check(!disposed) { "Map controller is disposed" }
        customSource = source
        selectedSourceId = source.id
        selectedSource = NativeMapSourceSelection(source.id, source.name, source.attribution, custom = true, limitations = source.limitations)
        applySelectedSource()
        refreshTileDemand(forceGeneration = true)
        val limitationStatus = source.limitations.takeIf { it.isNotEmpty() }?.joinToString("；")?.let { "；$it" }.orEmpty()
        reportStatus("已选择自定义图源，等待首屏瓦片请求$limitationStatus")
    }
    internal fun clearCustomSource() {
        check(Looper.myLooper() == Looper.getMainLooper())
        if (customSource == null || disposed) return
        resetBridgeRasterEvidence()
        customSource = null
        selectedSource = null
        selectedSourceId = null
        baseLayer.clearRenderables(); labelLayer.clearRenderables()
        fixedDetailLayer.sync(null, null)
        worldWindow.requestRedraw()
    }

    fun currentSource(): NativeMapSourceSelection? = selectedSource
    fun currentCustomSource(): NativeMapSource? = customSource
    fun currentQuality(): NativeMapQuality = quality
    fun currentCamera(): NativeCameraSnapshot = cameraSnapshot()
    fun restoreLegacyView(value:org.json.JSONObject){
        val center=value.getJSONArray("center");val lat=center.getDouble(1);val zoom=value.getDouble("zoom")
        val height=view.height/appContext.resources.displayMetrics.density
        val span=40_075_016.6856*kotlin.math.cos(Math.toRadians(lat))*height.coerceAtLeast(1f)/(512*2.0.pow(zoom))
        val range=span/(2*kotlin.math.tan(Math.toRadians(45.0)/2))
        restoreCamera(NativeCameraSnapshot(lat,center.getDouble(0),range,value.optDouble("bearing",0.0),value.optDouble("pitch",0.0)))
    }
    fun setTerrainExaggeration(value:Double){require(value.isFinite()&&value in .1..5.0);worldWindow.engine.globe.verticalExaggeration=value;worldWindow.requestRedraw()}

    /** Locks raster requests to one source zoom without touching camera/terrain state. Null restores adaptive detail. */
    fun setFixedRasterZoom(zoom: Int?) {
        check(Looper.myLooper() == Looper.getMainLooper()) { "Raster level must be changed on the Android main thread" }
        require(zoom == null || zoom in 0..24) { "Raster zoom must be within 0..24" }
        if (fixedRasterZoom == zoom || disposed) return
        fixedRasterZoom = zoom
        applySelectedSource()
    }

    /** Controls only the labels/roads overlay alpha; imagery, terrain and camera remain unchanged. */
    fun setRasterLabelOpacity(opacity: Double) {
        check(Looper.myLooper() == Looper.getMainLooper()) { "Label opacity must be changed on the Android main thread" }
        require(opacity.isFinite() && opacity in 0.0..1.0)
        rasterLabelOpacity = opacity.toFloat()
        mainHandler.post { if (!disposed) { labelLayer.opacity = rasterLabelOpacity; labelLayer.isEnabled = legacyRasterLayersVisible && rasterLabelOpacity > 0f; refreshTileDemand(forceGeneration = true); worldWindow.requestRedraw() } }
    }

    /** Updates the shared GPS/heading overlay. Heading must come from trusted sensors or GPS course. */
    private var positionArrowVisible = false
    fun setPosition(state: NativePositionState) {
        check(Looper.myLooper() == Looper.getMainLooper()) { "Position updates must run on the Android main thread" }
        if (disposed) return
        val presentation = NativePositionPolicy.present(state)
        positionLayer.clearRenderables()
        positionRenderables = emptyList()
        positionArrowVisible = false
        val fix = state.fix
        if (!presentation.visible || fix == null) { worldWindow.requestRedraw(); return }
        val lat = fix.latitude; val lon = fix.longitude
        val radius = presentation.accuracyMeters ?: 0.0
        val ring = (0..48).map { i ->
            val angle = i / 48.0 * Math.PI * 2
            val north = kotlin.math.cos(angle) * radius
            val east = kotlin.math.sin(angle) * radius
            val dLat = north / 6_371_008.8 * 180.0 / Math.PI
            val dLon = east / (6_371_008.8 * kotlin.math.cos(Math.toRadians(lat)).coerceAtLeast(0.01)) * 180.0 / Math.PI
            Position((lat + dLat).coerceIn(-89.9, 89.9).degrees, (lon + dLon).degrees, 0.0)
        }
        val ringAttrs = ShapeAttributes().apply { isDrawInterior = false; isDrawOutline = true; outlineColor = Color(0.78f, 0.83f, 0.81f, 0.55f); outlineWidth = 1.5f; isDepthTest = true }
        val ringPath = Path(ring, ringAttrs).apply { altitudeMode = AltitudeMode.CLAMP_TO_GROUND }
        val heading = presentation.headingDegrees
        positionArrowVisible = heading != null
        val puck = Placemark(Position(lat.degrees, lon.degrees, 0.0), PlacemarkAttributes().apply {
            if (heading != null) imageSource = nativePositionArrowImage()
            imageScale = if (heading != null) nativePositionArrowScale(bridgeMarkerCssScale) else 9.0
            imageColor = Color(0.18f, 0.76f, 1f, 1f); isDrawLeader = false; isDepthTest = true
        }, if (heading == null) "当前位置" else "当前位置，方向可信").apply {
            altitudeMode = AltitudeMode.CLAMP_TO_GROUND; isAlwaysOnTop = false
            if (heading != null) { imageRotation = heading.degrees; imageRotationReference = OrientationMode.RELATIVE_TO_GLOBE }
        }
        val drawables = mutableListOf<Renderable>(ringPath, puck)
        positionRenderables = drawables
        drawables.forEach(positionLayer::addRenderable)
        worldWindow.requestRedraw()
    }

    /** Changes detail selection only; the camera and its orientation stay as-is. */
    fun setQuality(value: NativeMapQuality) {
        check(Looper.myLooper() == Looper.getMainLooper()) { "Map quality must be changed on the Android main thread" }
        if (disposed) return
        cartography.setRasterQuality(value)
        if (quality == value) return
        quality = value
        applySelectedSource()
        reportStatus(if (value == NativeMapQuality.HIGH) "地图画质已切换为高清" else "地图画质已切换为标准")
    }

    private fun applySelectedSource() {
        val id = selectedSourceId ?: return
        val custom = customSource
        val sourceGeneration = resetBridgeRasterEvidence()
        val rasterCallbacks = bridgeRasterCallbacks(sourceGeneration)
        if (custom == null && key.isBlank()) {
            reportStatus("天地图尚未配置授权，图源未请求")
            return
        }
        val (base, labels) = when (id) {
            SOURCE_VECTOR -> "vec" to "cva"
            SOURCE_TERRAIN -> "ter" to "cta"
            SOURCE_IMAGERY -> "img" to "cia"
            else -> null to null
        }
        mainHandler.post {
            if (disposed) return@post
            baseLayer.clearRenderables()
            labelLayer.clearRenderables()
            labelLayer.opacity = rasterLabelOpacity
            labelLayer.isEnabled = legacyRasterLayersVisible && rasterLabelOpacity > 0f
            if (custom != null) {
                if(custom.kind!="online"){
                    val local=com.shantu.nativeapp.offlineMaps.NativeOfflineMapStore(appContext).list().firstOrNull{it.filePath==custom.localFilePath}
                    if(local==null)reportStatus("本地地图文件未找到，请从离线地图管理重新导入")
                    else baseLayer.addRenderable(when(local.kind){
                        "mbtiles"->com.shantu.nativeapp.offlineMaps.NativeOfflineMapLayer.mbtiles(
                            local, onBitmapReady = rasterCallbacks.onBitmapDecoded,
                            onLoadStarted = rasterCallbacks.onLoadStarted, onLoadFinished = rasterCallbacks.onLoadFinished,
                        )
                        "image"->com.shantu.nativeapp.offlineMaps.NativeOfflineMapLayer.image(
                            local, onBitmapReady = rasterCallbacks.onBitmapDecoded,
                            onLoadStarted = rasterCallbacks.onLoadStarted, onLoadFinished = rasterCallbacks.onLoadFinished,
                        )
                        else->com.shantu.nativeapp.offlineMaps.NativeOfflineMapLayer.geotiff(
                            local, onBitmapReady = rasterCallbacks.onBitmapDecoded,
                            onLoadStarted = rasterCallbacks.onLoadStarted, onLoadFinished = rasterCallbacks.onLoadFinished,
                        )
                    })
                } else makeTileSurfaceImages(custom,rasterCallbacks).forEachIndexed{index,image->if(index==0)baseLayer.addRenderable(image) else labelLayer.addRenderable(image)}
            } else {
                require(base != null && labels != null)
                baseLayer.addRenderable(makeTileSurfaceImage(base, false, rasterCallbacks = rasterCallbacks))
                labelLayer.addRenderable(makeTileSurfaceImage(labels, true))
            }
            fixedDetailLayer.sync(fixedRasterZoom,fixedRasterDetailProvider(custom,id,rasterCallbacks))
            refreshTileDemand(forceGeneration = true)
            worldWindow.requestRedraw()
        }
    }

    /** Explicitly requeue tiles held by WorldWind's absent-resource backoff. */
    fun retryPendingTiles() {
        if (disposed) return
        val cooldown = network.cooldownRemainingMillis()
        if (cooldown > 0L) {
            reportStatus("天地图服务器冷却中，约${(cooldown / 1_000L + if (cooldown % 1_000L == 0L) 0 else 1)}秒后可重试")
            return
        }
        worldWindow.engine.renderResourceCache.absentResourceList.clear()
        worldWindow.requestRedraw()
        reportStatus("已请求地图引擎重试暂缓瓦片")
    }

    fun setTerrain(enabled: Boolean) {
        val apply = Runnable {
            if (disposed || terrainEnabled == enabled) return@Runnable
            val preserved = if (bridgeCameraConfigured && frameDrawn) cameraSnapshot() else null
            terrainEnabled = enabled
            terrainCutLayer.isEnabled = enabled
            syncTerrainAttachment()
            // Retain the bounded DEM coverage while detached so a 2D/3D round trip
            // does not discard loaded ground or shift the logical camera target.
            preserved?.let(::restoreCamera)
            if (enabled) reportStatus("已启用本地区域FABDEM/修补高程与Terrarium公共数据回退；高程内部按整数米量化，缺失区不显示伪高程")
            else reportStatus("真实地形已关闭")
            worldWindow.requestRedraw()
        }
        if (Looper.myLooper() == Looper.getMainLooper()) apply.run() else mainHandler.post(apply)
    }

    /** Adds DEM-derived surface overlays without changing camera, terrain priority, or mesh state. */
    fun setTerrainOverlay(
        contoursEnabled: Boolean,
        elevationColorsEnabled: Boolean,
        contourIntervalMeters: Int = 30,
        elevationColorsOpacity: Double = 1.0,
    ) {
        check(Looper.myLooper() == Looper.getMainLooper()) { "Terrain overlay settings must run on the Android main thread" }
        check(!disposed) { "Map controller is disposed" }
        val options = NativeTerrainOverlayOptions(
            contoursEnabled, elevationColorsEnabled, contourIntervalMeters, elevationColorsOpacity,
        )
        if (terrainOverlayOptions == options) return
        terrainOverlayOptions = options
        val generation = ++terrainOverlayGeneration
        mainHandler.post {
            if (disposed || generation != terrainOverlayGeneration) return@post
            applyTerrainOverlays(options)
            worldWindow.requestRedraw()
        }
    }

    /** Attribution for active DEM terrain or its color/contour overlays; null when all are off. */
    fun terrainOverlayAttribution(): String? =
        if (terrainEnabled || terrainBasemapEnabled || terrainOverlayOptions.contoursEnabled ||
            terrainOverlayOptions.elevationColorsEnabled && terrainOverlayOptions.elevationColorsOpacity > 0.0)
            NativeTerrainOverlays.ATTRIBUTION else null

    private fun ensureTerrainCoverage(): NativeTerrariumCoverage = terrainCoverage
        ?: NativeTerrariumCoverage(
            appContext, network,
            tileIdentityFor = { z, x, y -> tileIdentityAndRegister("public-terrain-dem", "terrarium", z, x, y, "rgb-encoding-v1", "public") },
            viewId = { if (terrainEnabled || terrainBasemapEnabled || terrainOverlayOptions.contoursEnabled || terrainOverlayOptions.elevationColorsEnabled) tileViewId else null },
            demandGeneration = { tileDemandGeneration },
        ).also { terrainCoverage = it }

    private fun syncTerrainAttachment() {
        val coverage = if (terrainEnabled) ensureTerrainCoverage() else terrainCoverage
        if (terrainEnabled && !terrainCoverageAttached && coverage != null) {
            worldWindow.engine.globe.elevationModel.addCoverage(coverage)
            terrainCoverageAttached = true
        } else if (!terrainEnabled && terrainCoverageAttached && coverage != null) {
            worldWindow.engine.globe.elevationModel.removeCoverage(coverage)
            terrainCoverageAttached = false
        }
    }

    private fun applyTerrainOverlays(options: NativeTerrainOverlayOptions) {
        if (appliedTerrainOverlayOptions == options) return
        terrainOverlayLayer.clearRenderables()
        terrainOverlayRenderer?.close()
        terrainOverlayRenderer = null
        if (options.contoursEnabled || options.elevationColorsEnabled && options.elevationColorsOpacity > 0.0) {
            val renderer = NativeTerrainOverlays(ensureTerrainCoverage()).apply {
                setViewportStyle(terrainOverlayUiZoom, terrainOverlayCssScale, tileDemandFocusPx())
            }
            renderer.renderables(options).forEach(terrainOverlayLayer::addRenderable)
            terrainOverlayRenderer = renderer
        } else if (!terrainEnabled && !terrainBasemapEnabled) {
            terrainCoverage = null
        }
        appliedTerrainOverlayOptions = options
    }

    fun zoomBy(delta: Double) {
        require(delta.isFinite())
        mutateCamera { look ->
            look.range = (look.range / 2.0.pow(delta)).coerceIn(80.0, 40_000_000.0)
        }
    }

    internal fun setTerrainOverlayViewportStyle(uiZoom: Double, cssScale: Float) {
        if (!uiZoom.isFinite() || !cssScale.isFinite() || cssScale <= 0f) return
        terrainOverlayUiZoom = uiZoom
        terrainOverlayCssScale = cssScale
        if (terrainOverlayRenderer?.setViewportStyle(uiZoom, cssScale, tileDemandFocusPx()) == true) {
            worldWindow.requestRedraw()
        }
    }

    fun setHeading(degrees: Double) {
        require(degrees.isFinite())
        mutateCamera { it.heading = degrees.normalizeDegrees().degrees }
    }

    fun setPitch(degrees: Double) {
        require(degrees.isFinite())
        mutateCamera { it.tilt = degrees.coerceIn(0.0, 85.0).degrees }
    }

    fun resetNorth() = mutateCamera { it.heading = 0.0.degrees }

    /** Centers the camera while preserving range and orientation. */
    fun centerTo(latitude: Double, longitude: Double) {
        require(latitude.isFinite() && latitude in -90.0..90.0 && longitude.isFinite())
        mutateCamera { look ->
            look.position.latitude = latitude.degrees
            look.position.longitude = longitude.wrapLongitude().degrees
        }
    }

    fun cameraSnapshot(): NativeCameraSnapshot {
        check(Looper.myLooper() == Looper.getMainLooper()) { "Camera snapshots must run on the Android main thread" }
        // Recompute the viewing transform explicitly after selecting the real rendered ground.
        // In terrain mode the crosshair is on the raised mesh, not the ellipsoid behind it.
        val viewport = worldWindow.engine.viewport
        val anchor = bridgeGroundAnchor.takeIf { bridgeCameraConfigured && !disposed }
        val ground = if (anchor != null) Position(anchor.latitude.degrees, anchor.longitude.wrapLongitude().degrees,
            (bridgeAnchorElevation ?: 0.0) * if (terrainEnabled) worldWindow.engine.globe.verticalExaggeration else 1.0) else Position()
        // Invert the real eye against the still-valid explicit ground anchor. Picking the
        // center terrain triangle again introduces mesh interpolation error into every
        // linked-map round trip. Real gestures/zoom/view invalidate this anchor first.
        val hit = anchor != null || !viewport.isEmpty && (
            terrainEnabled && worldWindow.engine.pickTerrainPosition(viewport.width / 2.0, viewport.height / 2.0, ground) ||
                worldWindow.engine.screenPointToGroundPosition(viewport.width / 2.0, viewport.height / 2.0, ground))
        val look = if (hit) worldWindow.engine.cameraAsLookAt(LookAt(), ground)
        else worldWindow.engine.cameraAsLookAt(LookAt())
        return NativeCameraSnapshot(
            look.position.latitude.inDegrees,
            look.position.longitude.inDegrees,
            look.range,
            look.heading.inDegrees.let { if (kotlin.math.abs(it) < 1e-8) 0.0 else it },
            // React's original 2D/3D controls test pitch > 0. Matrix round-off at
            // an exactly vertical view must not turn 2D back into a selected 3D state.
            look.tilt.inDegrees.let { if (kotlin.math.abs(it) < 1e-8) 0.0 else it },
            look.roll.inDegrees,
        )
    }

    /** Copy the actual eye camera, not a look-at reconstructed from a different terrain frame. */
    internal fun synchronizeCameraFrom(source: NativeMapController) {
        check(Looper.myLooper() == Looper.getMainLooper())
        if (disposed || source.disposed || source === this) return
        clearBridgeGroundAnchor()
        val from = source.worldWindow.engine.camera
        val to = worldWindow.engine.camera
        if (to.position == from.position && to.altitudeMode == from.altitudeMode &&
            to.heading == from.heading && to.tilt == from.tilt && to.roll == from.roll &&
            to.fieldOfView == from.fieldOfView) return
        to.copy(from)
        worldWindow.requestRedraw()
    }

    fun restoreCamera(snapshot: NativeCameraSnapshot) {
        require(snapshot.latitude.isFinite() && snapshot.latitude in -90.0..90.0)
        require(snapshot.longitude.isFinite() && snapshot.rangeMeters.isFinite())
        require(snapshot.headingDegrees.isFinite() && snapshot.pitchDegrees.isFinite() && snapshot.rollDegrees.isFinite())
        check(Looper.myLooper() == Looper.getMainLooper()) { "Camera operations must run on the Android main thread" }
        // Before the first terrain frame, cameraAsLookAt falls back to a horizon point
        // whose altitude is not a ground anchor. Never inherit it when restoring a view.
        val knownGround = if (bridgeCameraConfigured && terrainEnabled) getElevation(snapshot.latitude, snapshot.longitude) else null
        val anchorAltitude = (knownGround ?: 0.0) * if (terrainEnabled) worldWindow.engine.globe.verticalExaggeration else 1.0
        val look = LookAt().apply {
            set(
                snapshot.latitude.degrees, snapshot.longitude.wrapLongitude().degrees,
                if (bridgeCameraConfigured) anchorAltitude else 0.0,
                if (bridgeCameraConfigured) AltitudeMode.ABSOLUTE else AltitudeMode.CLAMP_TO_GROUND,
                snapshot.rangeMeters.coerceIn(80.0, 40_000_000.0),
                snapshot.headingDegrees.normalizeDegrees().degrees,
                snapshot.pitchDegrees.coerceIn(0.0, 85.0).degrees,
                snapshot.rollDegrees.normalizeDegrees().degrees,
            )
        }
        worldWindow.engine.cameraFromLookAt(look)
        if (bridgeCameraConfigured) {
            bridgeGroundAnchor = snapshot
            bridgeAnchorElevation = knownGround
            bridgeAnchorExaggeration = worldWindow.engine.globe.verticalExaggeration
        }
        worldWindow.requestRedraw()
    }

    fun addMarker(id: String, title: String, lat: Double, lon: Double, color: Int) {
        require(id.isNotBlank() && lat.isFinite() && lat in -90.0..90.0 && lon.isFinite())
        val marker = Placemark(Position(lat.degrees, lon.wrapLongitude().degrees, 0.0), PlacemarkAttributes().apply {
            imageScale = 9.0
            imageColor = toWorldWindColor(color)
            isDrawLeader = true
            isDepthTest = true
        }, title)
        marker.altitudeMode = AltitudeMode.CLAMP_TO_GROUND
        marker.pickDelegate = "shantu-object:$id"
        marker.isAlwaysOnTop = false
        mainHandler.post {
            if (disposed) return@post
            markers.remove(id)?.forEach(markerLayer::removeRenderable)
            markers[id] = listOf(marker)
            markerLayer.addRenderable(marker)
            worldWindow.requestRedraw()
        }
    }

    /** One raw-meter placement copy for both visible models and their section intersections. */
    internal fun modelRenderInput(marker: org.json.JSONObject): org.json.JSONObject {
        val coordinate=marker.optJSONArray("coordinates")
        val lat=coordinate?.optDouble(1,Double.NaN) ?: Double.NaN
        val lon=coordinate?.optDouble(0,Double.NaN) ?: Double.NaN
        val needsGround=NativeModelTerrainInput.needsTerrainRefresh(marker)
        val liveGround=if(needsGround && terrainEnabled && lat.isFinite() && lat in -90.0..90.0 && lon.isFinite()) getElevation(lat,lon) else null
        return NativeModelTerrainInput.prepare(marker,terrainEnabled,liveGround)
    }

    /** Renders a complete Web annotation record; unsupported or groundless models are reported explicitly. */
    fun renderMarker(marker: org.json.JSONObject): NativeMarkerRenderResult {
        check(!disposed) { "Map controller is disposed" }
        val input=modelRenderInput(marker)
        input.put("_mapZoom", if (bridgeMarkerZoom.isFinite()) bridgeMarkerZoom else org.json.JSONObject.NULL)
        input.put("_selected", marker.optString("id") == bridgeSelectedMarker)
        input.put("_cssScale", bridgeMarkerCssScale)
        input.put("_markerMode", bridgeMarkerMode ?: NativeMarkerPresentation.mode(bridgeMarkerZoom, false))
        val markerId=marker.optString("id")
        if(markerId.isNotBlank())markerDocuments[markerId]=org.json.JSONObject(marker.toString())
        val previousPresentation = synchronized(worldWindow.engine.renderResourceCache) {
            markers[markerId]?.filterIsInstance<NativeMarkerPlacemark>()?.firstOrNull()?.snapshotForReplacement()
        }
        val result = NativeModelRenderer.render(
            input,
            NativeTerrainSampler{sampleLat,sampleLon->if(terrainEnabled)getElevation(sampleLat,sampleLon) else 0.0},
            previousPresentation,
        )
        val id = result.id ?: return result
        if (result.status != NativeMarkerStatus.INVALID) {
            val apply = {
                if (!disposed) {
                    synchronized(worldWindow.engine.renderResourceCache) {
                        markers.remove(id)?.forEach(markerLayer::removeRenderable)
                        val cut=result.terrainCutMesh
                        if(input.optBoolean("terrainCut", input.optString("placement") == "underground")&&result.status==NativeMarkerStatus.RENDERED&&cut!=null)terrainCutLayer.upsert(cut) else terrainCutLayer.remove(id)
                        if (result.status == NativeMarkerStatus.RENDERED) {
                            result.renderables.forEach { it.pickDelegate = "shantu-object:$id" }
                            markers[id] = result.renderables
                            result.renderables.forEach(markerLayer::addRenderable)
                        }
                    }
                    worldWindow.requestRedraw()
                }
            }
            // Camera presentation changes already run on main. Deferring them
            // could install an old label mode after the next frame resized it.
            if (Looper.myLooper() == Looper.getMainLooper()) apply() else mainHandler.post { apply() }
        }
        return result
    }

    fun removeMarker(id: String) {
        markerDocuments.remove(id);terrainCutLayer.remove(id)
        mainHandler.post {
            if (disposed) return@post
            markers.remove(id)?.forEach(markerLayer::removeRenderable)
            worldWindow.requestRedraw()
        }
    }

    /** Remove all user-created overlays when a workspace is replaced. */
    fun clearUserObjects() {
        markerDocuments.clear();terrainCutLayer.clear()
        pickGeneration++
        mainHandler.post {
            if (disposed) return@post
            markers.clear()
            routes.clear()
            areas.clear()
            markerLayer.clearRenderables()
            routeLayer.clearRenderables()
            areaLayer.clearRenderables()
            areaEditRenderables.clear()
            areaDraftRenderables = emptyList()
            worldWindow.requestRedraw()
        }
    }

    /** Remove a route by stable ID, for undo and draft replacement. */
    fun removeRoute(id: String) {
        mainHandler.post {
            if (disposed) return@post
            routes.remove(id)?.let(routeLayer::removeRenderable)
            worldWindow.requestRedraw()
        }
    }

    fun replaceRoute(id: String, coords: List<Pair<Double, Double>>, color: Int, width: Float) {
        require(id.isNotBlank() && width.isFinite() && width > 0f)
        val positions = coords.map { (lat, lon) ->
            require(lat.isFinite() && lat in -90.0..90.0 && lon.isFinite())
            Position(lat.degrees, lon.wrapLongitude().degrees, 0.0)
        }
        if (positions.size < 2) {
            removeRoute(id)
            return
        }
        val route = Path(positions, ShapeAttributes().apply {
            isDrawInterior = false
            isDrawOutline = true
            outlineColor = toWorldWindColor(color)
            outlineWidth = width
            isDepthTest = true
        })
        route.altitudeMode = AltitudeMode.CLAMP_TO_GROUND
        route.pickDelegate = "shantu-object:$id"
        route.isFollowTerrain = true
        mainHandler.post {
            if (disposed) return@post
            routes.remove(id)?.let(routeLayer::removeRenderable)
            routes[id] = route
            routeLayer.addRenderable(route)
            worldWindow.requestRedraw()
        }
    }

    /** Adds a ground-clamped area ring; coordinates are latitude/longitude pairs. */
    fun addArea(id: String, coords: List<Pair<Double, Double>>, color: Int, width: Float = 2f) {
        check(Looper.myLooper() == Looper.getMainLooper()) { "Area operations must run on the Android main thread" }
        require(id.isNotBlank() && id !in areas) { "Area ID already exists" }
        replaceArea(id, coords, color, width)
    }

    /** Replaces an area by stable ID, preserving its ground-relative placement. */
    fun replaceArea(id: String, coords: List<Pair<Double, Double>>, color: Int, width: Float = 2f) {
        check(Looper.myLooper() == Looper.getMainLooper()) { "Area operations must run on the Android main thread" }
        require(id.isNotBlank() && width.isFinite() && width > 0f)
        val points = coords.map { (lat, lon) ->
            require(lat.isFinite() && lat in -90.0..90.0 && lon.isFinite())
            Position(lat.degrees, lon.wrapLongitude().degrees, 0.0)
        }
        require(points.size >= 3) { "An area requires at least three vertices" }
        val ring = if (points.first() == points.last()) points else points + points.first()
        val area = Polygon(ring, NativeAreaStyle.attributes(color, width)).apply {
            altitudeMode = AltitudeMode.CLAMP_TO_GROUND
            isFollowTerrain = true
            pickDelegate = "shantu-object:$id"
        }
        if (disposed) return
        areas.remove(id)?.let(areaLayer::removeRenderable)
        areas[id] = area
        areaLayer.addRenderable(area)
        worldWindow.requestRedraw()
    }

    /** Replaces screen-sized editable vertices for the currently selected area. Coordinates are lat/lon. */
    fun replaceAreaEditVertices(id: String, coords: List<Pair<Double, Double>>, color: Int) {
        check(Looper.myLooper() == Looper.getMainLooper()) { "Area operations must run on the Android main thread" }
        if (disposed) return
        areaEditRenderables.remove(id)?.forEach(areaLayer::removeRenderable)
        val nodes = coords.mapNotNull { (lat, lon) ->
            if (!lat.isFinite() || lat !in -90.0..90.0 || !lon.isFinite()) return@mapNotNull null
            Placemark(Position(lat.degrees, lon.wrapLongitude().degrees, 0.0), PlacemarkAttributes().apply {
                imageSource = areaVertexImage(color)
                imageScale = 1.0
                isDrawLeader = false
                isDepthTest = true
            }, "区域顶点").apply {
                altitudeMode = AltitudeMode.CLAMP_TO_GROUND
                isAlwaysOnTop = false
                pickDelegate = "shantu-object:$id"
            }
        }
        if (nodes.isNotEmpty()) {
            areaEditRenderables[id] = nodes
            nodes.forEach(areaLayer::addRenderable)
        }
        worldWindow.requestRedraw()
    }

    /** Renders an in-progress area polyline and its actual vertices. */
    fun replaceAreaDraft(coords: List<Pair<Double, Double>>, color: Int = AndroidColor.rgb(102, 207, 162)) {
        check(Looper.myLooper() == Looper.getMainLooper()) { "Area operations must run on the Android main thread" }
        if (disposed) return
        areaDraftRenderables.forEach(areaLayer::removeRenderable)
        val next = mutableListOf<Renderable>()
        val positions = coords.mapNotNull { (lat, lon) ->
            if (lat.isFinite() && lat in -90.0..90.0 && lon.isFinite()) Position(lat.degrees, lon.wrapLongitude().degrees, 0.0) else null
        }
        if (positions.size >= 2) next += Path(positions, ShapeAttributes().apply {
            isDrawInterior = false; isDrawOutline = true; outlineColor = toWorldWindColor(color); outlineWidth = 2f; isDepthTest = true
        }).apply { altitudeMode = AltitudeMode.CLAMP_TO_GROUND }
        positions.forEach { position -> next += Placemark(position, PlacemarkAttributes().apply {
            imageSource = areaVertexImage(color); imageScale = 1.0; isDrawLeader = false; isDepthTest = true
        }, "区域草稿顶点").apply { altitudeMode = AltitudeMode.CLAMP_TO_GROUND; isAlwaysOnTop = false } }
        areaDraftRenderables = next
        next.forEach(areaLayer::addRenderable)
        worldWindow.requestRedraw()
    }

    fun clearAreaDraft() = replaceAreaDraft(emptyList())

    private fun areaVertexImage(color: Int): ImageSource = areaVertexImageCache.getOrPut(color) {
        val dark = AndroidColor.rgb(18, 35, 30)
        val pixels = IntArray(24 * 24)
        for (y in 0 until 24) for (x in 0 until 24) {
            val distance = kotlin.math.hypot((x - 11.5).toDouble(), (y - 11.5).toDouble())
            pixels[y * 24 + x] = when {
                distance <= 5.0 -> color
                distance <= 8.0 -> AndroidColor.WHITE
                distance <= 10.0 -> dark
                else -> 0
            }
        }
        ArgbImage(24, 24, pixels).toImageSource()
    }

    fun removeArea(id: String) {
        check(Looper.myLooper() == Looper.getMainLooper()) { "Area operations must run on the Android main thread" }
        if (disposed) return
        areas.remove(id)?.let(areaLayer::removeRenderable)
        areaEditRenderables.remove(id)?.forEach(areaLayer::removeRenderable)
        worldWindow.requestRedraw()
    }

    /** Returns a real terrain hit from the last rendered frame, or null for sky/space/no terrain. */
    fun screenToCoordinate(x: Float, y: Float): Pair<Double, Double>? {
        check(Looper.myLooper() == Looper.getMainLooper()) { "Terrain picking must run on the Android main thread" }
        if (disposed || !x.isFinite() || !y.isFinite()) return null
        val position = Position()
        if (!worldWindow.engine.pickTerrainPosition(x.toDouble(), y.toDouble(), position)) return null
        val lat = position.latitude.inDegrees
        val lon = position.longitude.inDegrees
        return if (lat.isFinite() && lon.isFinite()) lat to lon.wrapLongitude() else null
    }

    fun groundMetersAcross(pixels: Float): Double? {
        if(disposed || pixels<=0 || view.width<=pixels || view.height<=0) return null
        val x=view.width/2f;val y=view.height/2f
        val a=screenToCoordinate(x-pixels/2,y) ?: return null
        val b=screenToCoordinate(x+pixels/2,y) ?: return null
        val result=FloatArray(1)
        android.location.Location.distanceBetween(a.first,a.second,b.first,b.second,result)
        return result[0].toDouble().takeIf { it.isFinite() && it>0 }
    }

    /** Uses the native rendered picking buffer; no bounds-only substitute for actual geometry. */
    fun pickObjectIds(rect:android.graphics.RectF, finished:(List<String>)->Unit) {
        check(Looper.myLooper()==Looper.getMainLooper())
        val generation=++pickGeneration
        val point=rect.width()<2f && rect.height()<2f
        pickScope.launch {
            pendingPickCount++
            try {
            val picked=withTimeoutOrNull(3000) {
                worldWindow.pickAsync(rect.left,rect.top,if(point)0f else rect.width(),if(point)0f else rect.height(),point).await()
            }
            if(disposed || generation!=pickGeneration)return@launch
            finished(NativeRenderedPickResults.objectIds(picked))
            } finally { pendingPickCount-- }
        }
    }

    /** Returns terrain elevation only when an enabled coverage has a real sample available. */
    fun getElevation(latitude: Double, longitude: Double, retrieve: Boolean = false): Double? {
        check(Looper.myLooper() == Looper.getMainLooper()) { "Elevation reads must run on the Android main thread" }
        require(latitude.isFinite() && latitude in -90.0..90.0 && longitude.isFinite())
        if (disposed) return null
        val lat = latitude.degrees
        val lon = longitude.wrapLongitude().degrees
        val hasSample = worldWindow.engine.globe.elevationModel.toList().asReversed().any { coverage ->
            if (!coverage.isEnabled) false else {
                val value = coverage.getElevation(lat, lon, retrieve = retrieve)
                value != earth.worldwind.globe.elevation.coverage.ElevationCoverage.MISSING_DATA && value.isFinite()
            }
        }
        if (!hasSample) return null
        val elevation = worldWindow.engine.globe.getElevation(lat, lon, retrieve = retrieve).toDouble()
        return elevation.takeIf { it.isFinite() }
    }

    /** Screen coordinates in this WorldWindow's physical pixels, using its real rendered camera. */
    internal fun projectCoordinate(latitude: Double, longitude: Double): Pair<Double, Double>? {
        check(Looper.myLooper() == Looper.getMainLooper()) { "Projection reads must run on the Android main thread" }
        if (disposed || !latitude.isFinite() || latitude !in -90.0..90.0 || !longitude.isFinite()) return null
        val result = Vec2(0.0, 0.0)
        if (!worldWindow.engine.geographicToScreenPoint(Position(latitude.degrees, longitude.wrapLongitude().degrees, 0.0), result)) return null
        return (result.x to result.y).takeIf { it.first.isFinite() && it.second.isFinite() }
    }

    /** Screen-pixel focus used by every raster request path; ordinary browsing is the actual viewport center. */
    internal fun tileDemandFocusPx(): TileScreenPoint = drawingFocus ?: TileScreenPoint(view.width / 2.0, view.height / 2.0)
    internal fun currentTileDemandGeneration(): Long = tileDemandGeneration
    internal fun tileDemandViewId(): String = tileViewId
    internal fun tileStageTelemetrySnapshot(): NativeTileStageSnapshot = NativeTileStageTelemetry.snapshot()
    internal fun refreshTileViewDemand() = refreshTileDemand()

    internal fun setTileDemandDrawingFocus(xPx: Double?, yPx: Double?) {
        check(Looper.myLooper() == Looper.getMainLooper())
        val next = if (xPx != null && yPx != null && xPx.isFinite() && yPx.isFinite()) TileScreenPoint(xPx, yPx) else null
        if (next != null && drawingFocus != null) {
            val remaining = 50L - (android.os.SystemClock.uptimeMillis() - lastDrawingFocusAt)
            if (remaining > 0L) {
                pendingDrawingFocus = next
                if (!drawingFocusUpdatePosted) {
                    drawingFocusUpdatePosted = true
                    mainHandler.postDelayed(drawingFocusUpdate, remaining)
                }
                return
            }
        }
        mainHandler.removeCallbacks(drawingFocusUpdate)
        drawingFocusUpdatePosted = false
        pendingDrawingFocus = null
        commitDrawingFocus(next)
    }

    private var lastDrawingFocusAt = 0L
    private var pendingDrawingFocus: TileScreenPoint? = null
    private var drawingFocusUpdatePosted = false
    private val drawingFocusUpdate = Runnable {
        drawingFocusUpdatePosted = false
        val next = pendingDrawingFocus
        pendingDrawingFocus = null
        if (!disposed && next != null) commitDrawingFocus(next)
    }

    private fun commitDrawingFocus(next: TileScreenPoint?) {
        if (drawingFocus == next) return
        lastDrawingFocusAt = android.os.SystemClock.uptimeMillis()
        drawingFocus = next
        terrainOverlayRenderer?.setViewportStyle(terrainOverlayUiZoom, terrainOverlayCssScale, tileDemandFocusPx())
        refreshTileDemand(forceGeneration = true)
    }

    internal fun tileIdentity(source: String, layer: String, z: Int, x: Int, y: Int, style: String = "default", credential: String = key): TileRequestIdentity =
        TileRequestIdentity(stableNamespace(source), layer, z, x, y, stableNamespace(style), stableNamespace(credential, cacheInput = false))

    /** Register only primitive geographic corners; bounded LRU does not retain image factories or URLs. */
    internal fun tileIdentityAndRegister(source: String, layer: String, z: Int, x: Int, y: Int, style: String = "default", credential: String = key): TileRequestIdentity? {
        val corners = TileProjectedPriority.mercatorCorners(z, x, y) ?: return null
        val identity = tileIdentity(source, layer, z, x, y, style, credential)
        synchronized(tileFootprints) {
            if (tileFootprints[identity] != corners) {
                tileFootprints[identity] = corners
                tileDemandDirty = true
            }
        }
        return identity
    }

    private fun customRasterStyleFingerprint(source: NativeMapSource, layerIndex: Int): String {
        val fingerprints = synchronized(customStyleFingerprints) {
            customStyleFingerprints[source] ?: run {
                val fields = buildList {
                    add("format=${source.format}"); add("datum=${source.datum}"); add("tileSize=${source.tileSize}")
                    add("matrixSet=${source.tileMatrixSet.orEmpty()}")
                    add("subdomains=${source.subdomains.joinToString(separator = "\u0000")}")
                    source.layers.forEachIndexed { index, layer ->
                        add("layer=$index"); add("minZoom=${layer.minZoom}"); add("maxZoom=${layer.maxZoom}")
                        add("tileSize=${layer.tileSize}"); add("scheme=${layer.scheme}"); add("subdivide=${layer.subdivide}")
                        add("ovmap=${layer.ovmapTemplate}"); layer.tiles.forEach { add("template=$it") }
                    }
                }
                val fingerprint = NativeRasterStyleFingerprint.create(fields)
                List(source.layers.size) { fingerprint }.also { customStyleFingerprints[source] = it }
            }
        }
        return fingerprints.getOrNull(layerIndex) ?: NativeRasterStyleFingerprint.create(listOf("format=${source.format}", "layer=$layerIndex"))
    }

    internal fun fixedDetailTileRank(providerIdentity: String, z: Int, x: Int, y: Int): Double? {
        val custom = customSource
        val identity = if (providerIdentity.startsWith("tianditu:")) {
            val layer = providerIdentity.substringAfterLast(':')
            tileIdentityAndRegister("tianditu", layer, z, x, y)
        } else {
            val layer = custom?.layers?.firstOrNull() ?: return null
            val requestTile = NativeRasterSourceTileKey.requestKey(layer, z, x, y) ?: return null
            tileIdentityAndRegister(custom.id, "raster-0", requestTile.z, requestTile.x, requestTile.y, customRasterStyleFingerprint(custom, 0), custom.token)
        }
        return identity?.let(::tileProjectedRank)
    }

    internal fun tileProjectedRank(identity: TileRequestIdentity): Double? {
        val geographicCorners = synchronized(tileFootprints) { tileFootprints[identity] } ?: return null
        val corners = geographicCorners.mapNotNull { (lon, lat) ->
            projectCoordinate(lat, lon)?.let { TileScreenPoint(it.first, it.second) }
        }
        val cornerHull = TileProjectedPriority.convexHull(corners)
        val polygon = if (corners.size == 4 && cornerHull.size >= 3) cornerHull else {
            val geographicGrid = TileProjectedPriority.mercatorGrid(identity.z, identity.x, identity.y, segmentsPerSide = 3) ?: return null
            TileProjectedPriority.convexHull(geographicGrid.mapNotNull { (lon, lat) ->
                projectCoordinate(lat, lon)?.let { TileScreenPoint(it.first, it.second) }
            })
        }
        if (!TileProjectedPriority.intersectsViewport(polygon, view.width.toDouble(), view.height.toDouble())) return null
        return TileProjectedPriority.distanceToQuad(tileDemandFocusPx(), polygon).takeIf(Double::isFinite)
    }

    private fun refreshTileDemand(forceGeneration: Boolean = false, projectionMatrix: DoubleArray? = null) {
        if (Looper.myLooper() != Looper.getMainLooper() || disposed) return
        val camera = cameraSnapshot()
        val focus = tileDemandFocusPx()
        val signature = listOf(camera.latitude, camera.longitude, camera.rangeMeters, camera.headingDegrees, camera.pitchDegrees,
            camera.rollDegrees, view.width.toDouble(), view.height.toDouble(), focus.x, focus.y, if (view.visibility == View.VISIBLE) 1.0 else 0.0)
            .map { java.lang.Double.doubleToLongBits(it) } + (projectionMatrix ?: doubleArrayOf()).map { java.lang.Double.doubleToLongBits(it) }
        val cameraChanged = signature != lastTileDemandSignature
        if (!forceGeneration && !cameraChanged && !tileDemandDirty) return
        if (forceGeneration || cameraChanged) tileDemandGeneration++
        lastTileDemandSignature = signature
        tileDemandDirty = false
        val visible = view.visibility == View.VISIBLE && view.width > 0 && view.height > 0
        val registeredIdentities = synchronized(tileFootprints) { tileFootprints.keys.toList() }
        val activeIdentities = ArrayList<TileRequestIdentity>(registeredIdentities.size)
        val inactiveIdentities = LinkedHashSet<TileRequestIdentity>()
        if (visible) {
            val visibilityState = snapshotTileLayerVisibilityState()
            registeredIdentities.forEach { identity ->
                if (NativeTileLayerVisibility.isActive(identity, visibilityState)) activeIdentities += identity
                else inactiveIdentities += identity
            }
        } else {
            inactiveIdentities.addAll(registeredIdentities)
        }
        val ranks = if (!visible) emptyMap() else activeIdentities.asSequence().mapNotNull { identity ->
                tileProjectedRank(identity)?.let { identity to it }
            }.toMap()
        network.updateViewDemand(TileViewDemand(tileViewId, tileDemandGeneration, visible, ranks, inactiveIdentities))
    }

    private fun snapshotTileLayerVisibilityState(): NativeTileLayerVisibilityState {
        val custom = customSource
        val selectedTdtBase = when (selectedSourceId) {
            SOURCE_VECTOR -> "vec"
            SOURCE_TERRAIN -> "ter"
            SOURCE_IMAGERY -> "img"
            else -> null
        }
        val customStyles = custom?.layers?.indices?.associate { index ->
            "raster-$index" to stableNamespace(customRasterStyleFingerprint(custom, index))
        }.orEmpty()
        val customEnabled = custom?.layers?.indices?.associate { index ->
            "raster-$index" to if (index == 0) baseLayer.isEnabled else labelLayer.isEnabled && labelLayer.opacity > 0f
        }.orEmpty()
        return NativeTileLayerVisibilityState(
            tiandituSourceNamespace = stableNamespace("tianditu"),
            selectedTiandituBaseLayer = selectedTdtBase,
            legacyRasterVisible = legacyRasterLayersVisible,
            legacyBaseLayerEnabled = baseLayer.isEnabled,
            tiandituKeyConfigured = key.isNotBlank(),
            cartographyLabelLayer = cartography.plan.tiandituLabels,
            cartographyLabelEnabled = cartography.tiandituLabelRenderLayer.isEnabled,
            cartographyLabelOpacity = cartography.tiandituLabelRenderLayer.opacity,
            boundaryEnabled = cartography.tiandituBoundaryRenderLayer.isEnabled &&
                cartography.plan.tiandituBoundaries && cartography.tiandituBoundaryRenderLayer.opacity > 0f,
            currentCustomSourceNamespace = custom?.id?.let(::stableNamespace),
            customLayerStyles = customStyles,
            customLayerEnabled = customEnabled,
            sentinelDetailSourceNamespace = stableNamespace("sentinel-eox"),
            gibsSourceNamespace = stableNamespace("nasa-gibs-viirs"),
            gibsProbeSourceNamespace = stableNamespace("nasa-gibs-probe"),
            terrainDemSourceNamespace = stableNamespace("public-terrain-dem"),
            sentinelDetailVisible = cartography.plan.effectiveBase == "sentinel-detail" &&
                cartography.baseRenderLayer.isEnabled && cartography.baseRenderLayer.opacity > 0f,
            sentinelLatestVisible = cartography.plan.effectiveBase == "sentinel-latest" &&
                cartography.baseRenderLayer.isEnabled && cartography.baseRenderLayer.opacity > 0f,
            terrainDemVisible = terrainEnabled || terrainBasemapEnabled || terrainOverlayOptions.contoursEnabled ||
                terrainOverlayOptions.elevationColorsEnabled,
        )
    }

    private fun stableNamespace(value: String, cacheInput: Boolean = true): String = if (cacheInput) synchronized(namespaceHashes) {
        namespaceHashes[value] ?: run {
            val digest = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
            val hex = CharArray(24); val digits = "0123456789abcdef"
            for (index in 0 until 12) {
                val byte = digest[index].toInt() and 0xff
                hex[index * 2] = digits[byte ushr 4]; hex[index * 2 + 1] = digits[byte and 0x0f]
            }
            String(hex).also { namespaceHashes[value] = it }
        }
    } else shortHash(value)

    private fun shortHash(value: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
        val hex = CharArray(24); val digits = "0123456789abcdef"
        for (index in 0 until 12) {
            val byte = digest[index].toInt() and 0xff
            hex[index * 2] = digits[byte ushr 4]; hex[index * 2 + 1] = digits[byte and 0x0f]
        }
        return String(hex)
    }

    /** A real ground hit for a physical-pixel screen coordinate, null for sky/space. */
    internal fun unprojectCoordinate(x: Float, y: Float): Pair<Double, Double>? {
        check(Looper.myLooper() == Looper.getMainLooper()) { "Unprojection reads must run on the Android main thread" }
        if (disposed || !x.isFinite() || !y.isFinite()) return null
        val result = Position()
        val hit = if (terrainEnabled) worldWindow.engine.pickTerrainPosition(x.toDouble(), y.toDouble(), result)
            else worldWindow.engine.screenPointToGroundPosition(x.toDouble(), y.toDouble(), result)
        if (!hit) return null
        val latitude = result.latitude.inDegrees
        val longitude = result.longitude.inDegrees.wrapLongitude()
        return (latitude to longitude).takeIf { it.first.isFinite() && it.second.isFinite() }
    }
    internal fun objectGizmoAdapter():com.shantu.nativeapp.ui.NativeObjectGizmoAdapter = object:com.shantu.nativeapp.ui.NativeObjectGizmoAdapter {
        override fun project(pose:com.shantu.nativeapp.ui.NativeObjectPose,eastMeters:Double,northMeters:Double,upMeters:Double):android.graphics.PointF?{
            val latitude=pose.latitude+Math.toDegrees(northMeters/6_371_008.8)
            val longitude=pose.longitude+Math.toDegrees(eastMeters/(6_371_008.8*kotlin.math.cos(Math.toRadians(pose.latitude)).coerceAtLeast(.01)))
            val point=earth.worldwind.geom.Vec2()
            if(!worldWindow.engine.geographicToScreenPoint(Position(latitude.degrees,longitude.degrees,pose.altitudeMeters+upMeters),point))return null
            return android.graphics.PointF(point.x.toFloat()+view.left,point.y.toFloat()+view.top)
        }
        override fun transform(start:com.shantu.nativeapp.ui.NativeObjectPose,mode:com.shantu.nativeapp.ui.NativeGizmoMode,axis:com.shantu.nativeapp.ui.NativeGizmoAxis,down:android.graphics.PointF,current:android.graphics.PointF):com.shantu.nativeapp.ui.NativeObjectPose?{
            val center=project(start,0.0,0.0,0.0)?:return null
            when(mode){
                com.shantu.nativeapp.ui.NativeGizmoMode.MOVE->{
                    if(axis==com.shantu.nativeapp.ui.NativeGizmoAxis.Z){
                        val top=project(start,0.0,0.0,20.0)?:return null
                        val dx=top.x-center.x;val dy=top.y-center.y;val length=dx*dx+dy*dy
                        if(length<.01)return null
                        val metres=((current.x-down.x)*dx+(current.y-down.y)*dy)/length*20.0
                        return start.copy(altitudeMeters=start.altitudeMeters+metres)
                    }
                    val a=Position();val b=Position()
                    if(!worldWindow.engine.screenPointToPositionAtAltitude((down.x-view.left).toDouble(),(down.y-view.top).toDouble(),start.altitudeMeters,a)||!worldWindow.engine.screenPointToPositionAtAltitude((current.x-view.left).toDouble(),(current.y-view.top).toDouble(),start.altitudeMeters,b))return null
                    val dlon=(b.longitude.inDegrees-a.longitude.inDegrees+540)%360-180
                    return start.copy(longitude=if(axis==com.shantu.nativeapp.ui.NativeGizmoAxis.Y)start.longitude else (start.longitude+dlon+540)%360-180,latitude=if(axis==com.shantu.nativeapp.ui.NativeGizmoAxis.X)start.latitude else start.latitude+b.latitude.inDegrees-a.latitude.inDegrees)
                }
                com.shantu.nativeapp.ui.NativeGizmoMode.ROTATE->{
                    val change=Math.toDegrees(kotlin.math.atan2((current.y-center.y).toDouble(),(current.x-center.x).toDouble())-kotlin.math.atan2((down.y-center.y).toDouble(),(down.x-center.x).toDouble()))
                    fun turn(v:Double)=(v+change+540)%360-180
                    return when(axis){com.shantu.nativeapp.ui.NativeGizmoAxis.X->start.copy(pitch=turn(start.pitch));com.shantu.nativeapp.ui.NativeGizmoAxis.Y->start.copy(roll=turn(start.roll));else->start.copy(heading=turn(start.heading))}
                }
                com.shantu.nativeapp.ui.NativeGizmoMode.SCALE->{
                    val a=kotlin.math.hypot((down.x-center.x).toDouble(),(down.y-center.y).toDouble());if(a<2)return null
                    val f=(kotlin.math.hypot((current.x-center.x).toDouble(),(current.y-center.y).toDouble())/a).coerceIn(.01,100.0)
                    fun scale(v:Double)=(v*f).coerceIn(.1,10000.0)
                    return start.copy(width=if(axis in listOf(com.shantu.nativeapp.ui.NativeGizmoAxis.X,com.shantu.nativeapp.ui.NativeGizmoAxis.FREE))scale(start.width)else start.width,length=if(axis in listOf(com.shantu.nativeapp.ui.NativeGizmoAxis.Y,com.shantu.nativeapp.ui.NativeGizmoAxis.FREE))scale(start.length)else start.length,height=if(axis in listOf(com.shantu.nativeapp.ui.NativeGizmoAxis.Z,com.shantu.nativeapp.ui.NativeGizmoAxis.FREE))scale(start.height)else start.height)
                }
            }
        }
    }

    private fun mutateCamera(edit: (LookAt) -> Unit) {
        if (disposed) return
        // WorldWind's Android gesture controller edits the same camera on the UI thread.
        check(Looper.myLooper() == Looper.getMainLooper()) { "Camera operations must run on the Android main thread" }
        clearBridgeGroundAnchor()
        val look = worldWindow.engine.cameraAsLookAt(LookAt())
        edit(look)
        worldWindow.engine.cameraFromLookAt(look)
        worldWindow.requestRedraw()
    }

    private fun reportStatus(message: String) {
        mainHandler.post { if (!disposed) onStatus(message) }
    }

    private fun makeTileSurfaceImage(
        layerName: String,
        transparent: Boolean,
        rasterCallbacks: NativeRasterLoadCallbacks? = null,
    ): MercatorTiledSurfaceImage {
        val maxZoom = NativeTiandituZoomPolicy.effectiveMaxZoom(layerName, fixedRasterZoom)
        return makeTileSurfaceImage("Tianditu WMTS $layerName", 1, maxZoom, transparent, 256,
            { x, y, z -> tileUrl(layerName, x, y, z) },
            { x, y, z -> TiandituImageFactory(network, tileUrl(layerName, x, y, z),
                rasterCallbacks?.onBitmapDecoded ?: NO_RASTER_DECODE_CALLBACK,
                rasterCallbacks?.onLoadStarted ?: NO_RASTER_LOAD_CALLBACK,
                rasterCallbacks?.onLoadFinished ?: NO_RASTER_LOAD_CALLBACK,
                tileIdentityAndRegister("tianditu", layerName, z, x, y), tileViewId, { tileDemandGeneration },
                rawIdentityFor = { rawX, rawY, rawZ -> tileIdentityAndRegister("tianditu", layerName, rawZ, rawX, rawY) }) },
            onBaseBitmapDecoded = rasterCallbacks?.onBitmapDecoded ?: NO_RASTER_DECODE_CALLBACK,
            onImageLoadStarted = rasterCallbacks?.onLoadStarted ?: NO_RASTER_LOAD_CALLBACK,
            onImageLoadFinished = rasterCallbacks?.onLoadFinished ?: NO_RASTER_LOAD_CALLBACK,
            trackPrintFrameCoverage = rasterCallbacks != null && bridgePrintRasterFrameCoverage != null)
    }

    private fun makeTileSurfaceImages(source: NativeMapSource, rasterCallbacks: NativeRasterLoadCallbacks): List<MercatorTiledSurfaceImage> =
        source.layers.mapIndexed { layerIndex, layer ->
            val callbacks = if (layerIndex == 0) rasterCallbacks else null
            val styleNamespace = customRasterStyleFingerprint(source, layerIndex)
            makeTileSurfaceImage(
                "Custom ${source.format} ${if (layerIndex == 0) "base" else "overlay $layerIndex"}",
                layer.outputMinZoom, fixedRasterZoom?.coerceIn(layer.outputMinZoom,layer.outputMaxZoom)?:layer.outputMaxZoom, layerIndex > 0, layer.outputTileSize,
                { x, y, z -> source.tileUrl(layerIndex, x, y, z) },
                { x, y, z -> NativeRasterImageFactory(network, source, layerIndex, x, y, z,
                    callbacks?.onBitmapDecoded ?: NO_RASTER_DECODE_CALLBACK,
                    callbacks?.onLoadStarted ?: NO_RASTER_LOAD_CALLBACK,
                    callbacks?.onLoadFinished ?: NO_RASTER_LOAD_CALLBACK,
                    tileIdentity(source.id, "raster-$layerIndex", z, x, y, styleNamespace, source.token), tileViewId, { tileDemandGeneration },
                    rawIdentityFor = { rawX, rawY, rawZ -> tileIdentityAndRegister(source.id, "raster-$layerIndex", rawZ, rawX, rawY, styleNamespace, source.token) }) },
                trackPrintFrameCoverage = callbacks != null && bridgePrintRasterFrameCoverage != null,
            )
        }

    private fun fixedRasterDetailProvider(custom:NativeMapSource?,sourceId:String,rasterCallbacks:NativeRasterLoadCallbacks):NativeRasterDetailProvider? {
        if(custom!=null) {
            if(custom.kind!="online")return null
            val layer=custom.layers.firstOrNull() ?: return null
            val styleNamespace=customRasterStyleFingerprint(custom,0)
            val stableProviderIdentity = "custom:${tileIdentity(custom.id, "raster-0", 0, 0, 0, styleNamespace, custom.token).cacheKey}:base"
            return NativeRasterDetailProvider(stableProviderIdentity,
                layer.outputMinZoom,layer.outputMaxZoom,layer.outputTileSize) { x,y,z ->
                NativeRasterImageFactory(
                    network,custom,0,x,y,z,rasterCallbacks.onBitmapDecoded,
                    rasterCallbacks.onLoadStarted,rasterCallbacks.onLoadFinished,
                    tileIdentity(custom.id,"raster-0",z,x,y,styleNamespace,custom.token),
                    tileViewId,{ tileDemandGeneration },
                    rawIdentityFor = { rawX, rawY, rawZ -> tileIdentityAndRegister(custom.id,"raster-0",rawZ,rawX,rawY,styleNamespace,custom.token) },
                ).createBitmap()
            }
        }
        val name=when(sourceId) {
            SOURCE_VECTOR -> "vec"
            SOURCE_TERRAIN -> "ter"
            SOURCE_IMAGERY -> "img"
            else -> return null
        }
        return NativeRasterDetailProvider("tianditu:$sourceId:$name",1,NativeTiandituZoomPolicy.sourceMaxZoom(name),256) { x,y,z ->
            TiandituImageFactory(network,tileUrl(name,x,y,z),rasterCallbacks.onBitmapDecoded,
                rasterCallbacks.onLoadStarted,rasterCallbacks.onLoadFinished,
                tileIdentityAndRegister("tianditu",name,z,x,y),tileViewId,{ tileDemandGeneration },
                rawIdentityFor = { rawX, rawY, rawZ -> tileIdentityAndRegister("tianditu",name,rawZ,rawX,rawY) }).createBitmap()
        }
    }

    private fun makeTileSurfaceImage(
        contentType: String,
        minZoom: Int,
        maxZoom: Int,
        transparent: Boolean,
        tileSize: Int,
        urlFor: (x: Int, y: Int, z: Int) -> String,
        imageFactoryFor: ((x: Int, y: Int, z: Int) -> ImageSource.NetworkBoundImageFactory)? = null,
        onBaseBitmapDecoded: () -> Unit = {},
        onImageLoadStarted: () -> Unit = {},
        onImageLoadFinished: () -> Unit = {},
        trackPrintFrameCoverage: Boolean = false,
    ): MercatorTiledSurfaceImage {
        val factory = object : MercatorTileFactory {
            override val contentType = contentType

            // MercatorTileFactory converts the engine's row to XYZ's north-origin y before this call.
            override fun getImageSource(x: Int, y: Int, z: Int): ImageSource = ImageSource.fromImageFactory(
                imageFactoryFor?.invoke(x, y, z) ?: TiandituImageFactory(
                    network,urlFor(x,y,z),onBaseBitmapDecoded,onImageLoadStarted,onImageLoadFinished,
                )
            )
        }
        // WorldWind LevelSet owns the requested zoom range; public map schemas allow levels through 24.
        val image = if (trackPrintFrameCoverage) {
            val coverage = bridgePrintRasterFrameCoverage
            if (coverage != null) NativePrintTrackedMercatorSurfaceImage.build(factory, coverage, transparent, maxZoom, minZoom, tileSize)
            else MercatorTiledImageLayer.buildTiledSurfaceImage(factory, transparent, tileSize = tileSize, maxZoom = maxZoom, minZoom = minZoom)
        } else MercatorTiledImageLayer.buildTiledSurfaceImage(factory, transparent, tileSize = tileSize, maxZoom = maxZoom, minZoom = minZoom)
        return image.apply {
            // Keep rendering the closest available source tile when descendants exceed source coverage.
            useAncestorTileTexture = true
            // Lower screen-space thresholds refine tiles sooner; both modes keep the camera unchanged.
            detailControl = NativeCartographyRasterQuality.detailControl(quality)
        }
    }

    private fun tileUrl(layerName: String, x: Int, y: Int, z: Int): String =
        tiandituTileUrl(layerName, x, y, z, encodedKey)

    companion object {
        private const val MAX_TILE_FOOTPRINTS = 1024
        private const val MAX_NAMESPACE_HASHES = 256
        const val SOURCE_IMAGERY = "tianditu-imagery"
        const val SOURCE_VECTOR = "tianditu-vector"
        const val SOURCE_TERRAIN = "tianditu-terrain"
        val SOURCE_IDS = setOf(SOURCE_IMAGERY, SOURCE_VECTOR, SOURCE_TERRAIN)
    }
}

internal data class TiandituImageFactory(
    private val network: BoundedTileNetwork,
    private val url: String,
    private val onBitmapDecoded: () -> Unit = NO_RASTER_DECODE_CALLBACK,
    private val onLoadStarted: () -> Unit = NO_RASTER_LOAD_CALLBACK,
    private val onLoadFinished: () -> Unit = NO_RASTER_LOAD_CALLBACK,
    private val identity: TileRequestIdentity? = null,
    private val viewId: String? = null,
    private val generation: (() -> Long?)? = null,
    private val rawIdentityFor: ((x: Int, y: Int, z: Int) -> TileRequestIdentity?)? = null,
) : ImageSource.NetworkBoundImageFactory {
    override suspend fun createCachedBitmap(): Bitmap? {
        onLoadStarted()
        try {
            return network.readCached(url, this, identity, viewId, generation?.invoke())?.let { bytes ->
                NativeTileStageTelemetry.measureDecode { BitmapFactory.decodeByteArray(bytes, 0, bytes.size) }?.also { onBitmapDecoded() }
            }
        } finally {
            onLoadFinished()
        }
    }

    override suspend fun createBitmap(): Bitmap? {
        onLoadStarted()
        try {
            val bytes = network.fetch(url, renderedFactory = this, identity = identity, viewId = viewId, generation = generation?.invoke())
                ?: fetchMissingAncestor()
            return bytes?.let { bytes ->
                NativeTileStageTelemetry.measureDecode { BitmapFactory.decodeByteArray(bytes, 0, bytes.size) }?.also { onBitmapDecoded() }
            }
        } finally {
            onLoadFinished()
        }
    }

    private suspend fun fetchMissingAncestor(): ByteArray? {
        val child = NativeMissingTileFallback.parseTdt(url) ?: return null
        if (!network.isKnownMissing(url)) return null
        for (parentZ in child.z - 1 downTo 1) {
            val shift = child.z - parentZ
            val parent = NativeMissingTileFallback.TdtTile(child.layer, child.x shr shift, child.y shr shift, parentZ)
            val parentUrl = NativeMissingTileFallback.tdtUrl(url, parent) ?: return null
            val parentIdentity = rawIdentityFor?.invoke(parent.x, parent.y, parent.z)
            val bytes = network.fetch(parentUrl, identity = parentIdentity, viewId = viewId, generation = generation?.invoke())
            if (bytes == null) {
                if (network.isKnownMissing(parentUrl)) continue
                return null
            }
            val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return null
            return try {
                val cropped = NativeMissingTileFallback.cropDescendant(bitmap, child.x, child.y, parentZ, child.z, 256) ?: return null
                try { NativeMissingTileFallback.bytesForBitmap(cropped) }
                finally { cropped.recycle() }
            } finally { bitmap.recycle() }
        }
        return null
    }

    // ImageSource is a render-cache key. Keep diagnostics credential-free even though the
    // generated data-class equality intentionally includes source URL and generation callback.
    override fun toString() = "TiandituImageFactory"

    private fun sourceIdentity() = NativeImageSourceIdentity(network, network, identity, url, onBitmapDecoded, onLoadStarted, onLoadFinished, generation)
    override fun equals(other: Any?) = other is TiandituImageFactory && sourceIdentity() == other.sourceIdentity()
    override fun hashCode() = sourceIdentity().hashCode()
}

/** Custom rasters share the bounded network/cache path; datum conversion is applied to pixels before display. */
internal data class NativeRasterImageFactory(
    private val network: BoundedTileNetwork,
    private val source: NativeMapSource,
    private val layerIndex: Int,
    private val outputX: Int,
    private val outputY: Int,
    private val outputZoom: Int,
    private val onBitmapDecoded: () -> Unit = NO_RASTER_DECODE_CALLBACK,
    private val onLoadStarted: () -> Unit = NO_RASTER_LOAD_CALLBACK,
    private val onLoadFinished: () -> Unit = NO_RASTER_LOAD_CALLBACK,
    private val identity: TileRequestIdentity? = null,
    private val viewId: String? = null,
    private val generation: (() -> Long?)? = null,
    private val rawIdentityFor: ((x: Int, y: Int, z: Int) -> TileRequestIdentity?)? = null,
) : ImageSource.NetworkBoundImageFactory {
    private val layer = source.layers[layerIndex]

    override suspend fun createCachedBitmap(): Bitmap? {
        if (source.datum != NativeRasterDatum.WGS84 || layer.subdivide) return null
        onLoadStarted()
        try {
            return network.readCached(sourceUrl(outputX, outputY, outputZoom), this, identity, viewId, generation?.invoke())
                ?.let { bytes -> NativeTileStageTelemetry.measureDecode { BitmapFactory.decodeByteArray(bytes, 0, bytes.size) }?.also { onBitmapDecoded() } }
        } finally {
            onLoadFinished()
        }
    }

    override suspend fun createBitmap(): Bitmap? {
        onLoadStarted()
        try {
            return createBitmapTracked()
        } finally {
            onLoadFinished()
        }
    }

    private suspend fun createBitmapTracked(): Bitmap? {
        if (source.datum == NativeRasterDatum.WGS84 && !layer.subdivide) {
            return fetchSource(outputX, outputY, outputZoom)
        }

        if (source.datum == NativeRasterDatum.WGS84 && layer.subdivide) {
            val parent = fetchSource(outputX, outputY, outputZoom) ?: return null
            return try { NativeRasterProjection.cropSubdivided(parent, outputX, outputY, layer.outputTileSize) }
            finally { parent.recycle() }
        }

        val outputTileSize = layer.outputTileSize
        val plan = NativeRasterProjection.plan(outputZoom, outputX, outputY, outputTileSize, source.datum)
        val mosaic = Bitmap.createBitmap(plan.width * outputTileSize, plan.height * outputTileSize, Bitmap.Config.ARGB_8888)
        try {
            val canvas = Canvas(mosaic)
            val worldTiles = 1 shl outputZoom
            for (row in 0 until plan.height) for (column in 0 until plan.width) {
                val logicalX = plan.left + column
                val logicalY = plan.top + row
                val fetched = if (layer.subdivide) {
                    val parent = fetchSource(Math.floorMod(logicalX, worldTiles), logicalY, outputZoom) ?: return null
                    try {
                        NativeRasterProjection.cropSubdivided(parent, logicalX, logicalY, outputTileSize)
                    } finally { parent.recycle() }
                } else {
                    fetchSource(Math.floorMod(logicalX, worldTiles), logicalY, outputZoom) ?: return null
                }
                try {
                    val normalized = if (fetched.width != outputTileSize || fetched.height != outputTileSize) {
                        Bitmap.createScaledBitmap(fetched, outputTileSize, outputTileSize, true)
                    } else fetched
                    try { canvas.drawBitmap(normalized, (column * outputTileSize).toFloat(), (row * outputTileSize).toFloat(), null) }
                    finally { if (normalized !== fetched) normalized.recycle() }
                } finally { fetched.recycle() }
            }
            return NativeRasterProjection.resample(plan, mosaic)
        } finally { mosaic.recycle() }
    }

    private suspend fun fetchSource(x: Int, y: Int, z: Int): Bitmap? {
        val urlTile = NativeRasterSourceTileKey.from(z, x, y) ?: return null
        val requestTile = NativeRasterSourceTileKey.requestKey(layer, z, x, y) ?: return null
        val rawIdentity = rawIdentityFor?.invoke(requestTile.x, requestTile.y, requestTile.z) ?: identity
        val url = sourceUrl(urlTile.x, urlTile.y, urlTile.z)
        val bytes = network.fetch(url, renderedFactory = this, identity = rawIdentity, viewId = viewId, generation = generation?.invoke())
            ?: fetchMissingAncestor(urlTile.x, urlTile.y, urlTile.z, url)
        return bytes?.let { tileBytes -> NativeTileStageTelemetry.measureDecode { BitmapFactory.decodeByteArray(tileBytes, 0, tileBytes.size) }?.also { onBitmapDecoded() } }
    }

    private suspend fun fetchMissingAncestor(x: Int, y: Int, z: Int, childUrl: String): ByteArray? {
        if (!network.isKnownMissing(childUrl)) return null
        for (parentZ in z - 1 downTo layer.minZoom) {
            val shift = z - parentZ
            val parentX = x shr shift
            val parentY = y shr shift
            val parentUrl = sourceUrl(parentX, parentY, parentZ)
            val parentRequest = NativeRasterSourceTileKey.requestKey(layer, parentZ, parentX, parentY) ?: return null
            val parentIdentity = rawIdentityFor?.invoke(parentRequest.x, parentRequest.y, parentRequest.z)
            val bytes = network.fetch(parentUrl, identity = parentIdentity, viewId = viewId, generation = generation?.invoke())
            if (bytes == null) {
                if (network.isKnownMissing(parentUrl)) continue
                return null
            }
            val parent = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return null
            return try {
                val cropped = NativeMissingTileFallback.cropDescendant(parent, x, y, parentZ, z, layer.tileSize) ?: return null
                try { NativeMissingTileFallback.bytesForBitmap(cropped) }
                finally { cropped.recycle() }
            } finally { parent.recycle() }
        }
        return null
    }

    private fun sourceUrl(x: Int, y: Int, z: Int): String {
        val side = 1 shl z
        return source.tileUrl(layerIndex, Math.floorMod(x, side), y, z)
    }

    // Avoid data-class output of NativeMapSource/template/token values.
    override fun toString() = "NativeRasterImageFactory"

    private fun sourceIdentity() = NativeImageSourceIdentity(network, source, identity, outputFallbackKey(), onBitmapDecoded, onLoadStarted, onLoadFinished, generation)
    override fun equals(other: Any?) = other is NativeRasterImageFactory && sourceIdentity() == other.sourceIdentity()
    override fun hashCode() = sourceIdentity().hashCode()

    private fun outputFallbackKey() = "${source.id}:$layerIndex:$outputZoom:$outputX:$outputY:${source.format}:${layer.tileSize}:${layer.scheme}"
}

/** Disk cache is capped at 64 MiB; memory cache at 12 MiB; map rendering retains two reserved requests. */
private fun toWorldWindColor(color: Int) = Color(
    AndroidColor.red(color) / 255f,
    AndroidColor.green(color) / 255f,
    AndroidColor.blue(color) / 255f,
    AndroidColor.alpha(color) / 255f,
)

private fun Double.normalizeDegrees() = ((this % 360.0) + 360.0) % 360.0
private fun Double.wrapLongitude() = (((this + 180.0) % 360.0 + 360.0) % 360.0) - 180.0
