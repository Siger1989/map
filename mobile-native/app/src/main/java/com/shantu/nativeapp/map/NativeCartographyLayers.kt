package com.shantu.nativeapp.map

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import earth.worldwind.WorldWindow
import earth.worldwind.layer.Layer
import earth.worldwind.layer.RenderableLayer
import earth.worldwind.layer.mercator.MercatorTileFactory
import earth.worldwind.layer.mercator.MercatorTiledImageLayer
import earth.worldwind.layer.mercator.MercatorTiledSurfaceImage
import earth.worldwind.layer.mvt.DefaultMvtStyle
import earth.worldwind.layer.mvt.MvtFilter
import earth.worldwind.layer.mvt.MvtGeometryType
import earth.worldwind.layer.mvt.MvtRuleBasedStyle
import earth.worldwind.layer.mvt.MvtStyle
import earth.worldwind.layer.mvt.MvtVectorLayer
import earth.worldwind.layer.mvt.mvtStyle
import earth.worldwind.layer.source.TileBlob
import earth.worldwind.layer.source.TileSource
import earth.worldwind.render.Color
import earth.worldwind.render.image.ImageSource
import earth.worldwind.shape.ShapeAttributes
import com.shantu.nativeapp.data.NativeRuntimeSettings
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.LinkedHashMap
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.atomic.AtomicReference
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.math.min

data class NativeCartographySettings(
    val roads: Boolean = false,
    val labels: Boolean = true,
    val roadsOpacity: Float = 1f,
    val rasterLabelOpacity: Float = 1f,
    val satellite: Boolean = false,
    val satelliteProvider: String = "sentinel",
    val imageryMode: String = "detail",
    val tiandituBase: String = "img",
    val tiandituLabels: String = "auto",
    val tiandituBoundaries: Boolean = false,
    val offlineBasemap: Boolean = false,
    val sourceId: String = "tianditu-imagery",
) {
    companion object {
        fun fromRuntime(s: NativeRuntimeSettings) = NativeCartographySettings(
            roads = s.roadsEnabled,
            labels = s.labelsEnabled,
            roadsOpacity = s.roadsOpacity,
            rasterLabelOpacity = s.rasterLabelOpacity,
            satellite = s.satelliteEnabled,
            satelliteProvider = s.satelliteProvider,
            imageryMode = s.imageryMode,
            tiandituBase = s.tiandituBase,
            tiandituLabels = s.tiandituLabels,
            tiandituBoundaries = s.tiandituBoundaries,
            offlineBasemap = s.offlineBasemap,
            sourceId = s.source,
        )
    }
}

/** Mirrors modules/cartography/sentinel.ts and tianditu.ts for native basemap selection. */
object NativeCartographySelection {
    fun sourceId(
        hasCustomSource: Boolean,
        offlineBasemap: Boolean,
        satellite: Boolean,
        satelliteProvider: String,
        imageryMode: String,
        tiandituBase: String,
        tiandituConfigured: Boolean,
    ): String = when {
        hasCustomSource -> "custom"
        offlineBasemap -> "offline"
        tiandituConfigured && satelliteProvider == "tianditu" -> when (tiandituBase) {
            "vec" -> "tianditu-vector"
            "ter" -> "tianditu-terrain"
            else -> "tianditu-imagery"
        }
        satellite && imageryMode == "latest" -> "sentinel-latest"
        satellite && imageryMode == "detail" && satelliteProvider != "tianditu" -> "sentinel-detail"
        else -> "terrain"
    }

    fun rasterDatumKey(
        customSourceId: String?, satellite: Boolean, offlineBasemap: Boolean,
        satelliteProvider: String, imageryMode: String, tiandituBase: String,
    ): String = when {
        !customSourceId.isNullOrBlank() -> "custom:$customSourceId"
        !offlineBasemap && satellite && imageryMode == "detail" && satelliteProvider != "tianditu" -> "sentinel"
        !offlineBasemap && satelliteProvider == "tianditu" -> "tianditu:${tiandituBase.takeIf { it in setOf("vec", "img", "ter") } ?: "vec"}"
        satellite -> imageryMode
        else -> "terrain"
    }
}

/** Resolves the old auto sentinel and offline cap before a fixed raster LOD is applied. */
internal object NativeRasterZoomPolicy {
    fun resolve(level: Int?, offlineMax: Int?, minZoom: Int, maxZoom: Int): Int? {
        require(minZoom >= 0 && maxZoom >= minZoom)
        val requested = level?.takeIf { it >= 0 }
        val cap = offlineMax?.takeIf { it >= 0 }
        val fixed = when {
            requested != null && cap != null -> minOf(requested, cap)
            requested != null -> requested
            else -> cap
        } ?: return null
        return fixed.coerceIn(minZoom, maxZoom)
    }
}

data class NativeCartographyPlan(
    val roads: Boolean,
    val roadNames: Boolean,
    val placeLabels: Boolean,
    val tiandituLabels: String?,
    val tiandituBoundaries: Boolean,
    val satelliteUnderlay: Boolean,
    val effectiveBase: String,
    val roadsOpacity: Float,
    val rasterLabelOpacity: Float,
) {
    companion object {
        fun resolve(s: NativeCartographySettings): NativeCartographyPlan {
            // The host only selects a Tianditu source when the provider is explicitly chosen,
            // non-offline, and configured. Do not infer it from the camera/satellite toggle.
            val tdt = s.sourceId.startsWith("tianditu-") && s.sourceId != "custom" && !s.offlineBasemap
            val vectorLabels = tdt && s.tiandituLabels == "vector"
            val tdtLabelMode = when (s.tiandituLabels) {
                "auto" -> when (s.tiandituBase) { "vec" -> "cva"; "ter" -> "cta"; else -> "cia" }
                "cva", "cia", "cta" -> s.tiandituLabels
                else -> null
            }
            val base = when {
                s.sourceId == "custom" -> "custom"
                s.offlineBasemap -> "offline"
                s.satellite && tdt -> "tianditu:${s.tiandituBase.takeIf { it in setOf("vec", "img", "ter") } ?: "img"}"
                s.satellite && s.imageryMode == "latest" -> "sentinel-latest"
                s.satellite -> "sentinel-detail"
                s.sourceId in setOf("tianditu-imagery", "tianditu-vector", "tianditu-terrain") -> "tianditu:${when (s.sourceId) { "tianditu-vector" -> "vec"; "tianditu-terrain" -> "ter"; else -> "img" }}"
                s.sourceId in setOf("sentinel", "sentinel-2025", "sentinel-detail") -> "sentinel-detail"
                s.sourceId == "sentinel-latest" -> "sentinel-latest"
                s.sourceId == "offline" -> "offline"
                else -> "terrain"
            }
            val domestic = tdt && !s.offlineBasemap
            return NativeCartographyPlan(
                roads = s.roads,
                roadNames = s.roads && s.labels && (!domestic || vectorLabels),
                placeLabels = s.labels && (!domestic || vectorLabels),
                tiandituLabels = tdtLabelMode?.takeIf { s.labels && domestic },
                tiandituBoundaries = tdt && !s.offlineBasemap && s.tiandituBoundaries,
                satelliteUnderlay = s.sourceId == "custom" || (s.satellite || s.sourceId in setOf("sentinel", "sentinel-2025", "sentinel-detail", "sentinel-latest")) && !s.offlineBasemap,
                effectiveBase = base,
                roadsOpacity = s.roadsOpacity.coerceIn(0f, 1f),
                rasterLabelOpacity = s.rasterLabelOpacity.coerceIn(0f, 1f),
            )
        }
    }
}

/**
 * Independent native world roads, road names, place labels, Tianditu annotation WMTS, and boundary WMTS.
 * The host mounts [layers] once beside its basemap and calls [apply] for every imported/runtime settings
 * change. Both primary and comparison WorldWindows use the same API with separate instances.
 */
class NativeCartographyLayers(
    private val window: WorldWindow,
    private val tiandituKey: () -> String,
    private val source: TileSource = SharedOpenFreeMapTileSource(),
    private val onImageryStatus: (NativeImageryStatus) -> Unit = {},
) : AutoCloseable {
    private val vectorTileBudget = NativeRenderMemoryBudget.vectorTileCount(Runtime.getRuntime().maxMemory())
    private val labelTileBudget = vectorTileBudget

    /** Real OpenFreeMap land/water polygons over the native DEM-backed dark base surface. */
    val terrainLandWaterLayer = MvtVectorLayer(source, minZoom = 0, maxZoom = 14, maxLoadedTiles = vectorTileBudget,
        maxConcurrentFetches = 2, maxConcurrentAssembly = 1, style = NativeTerrainLandWaterStyle, displayName = "Terrain land and water")
    val roadsLayer = MvtVectorLayer(source, minZoom = 0, maxZoom = 14, maxLoadedTiles = vectorTileBudget,
        maxConcurrentFetches = 2, maxConcurrentAssembly = 1, style = roadStyle, displayName = "Roads and waterways")
    private val snapDataLayer = MvtVectorLayer(source, minZoom = 0, maxZoom = 14, maxLoadedTiles = minOf(12, vectorTileBudget),
        maxConcurrentFetches = 1, maxConcurrentAssembly = 1, style = mvtStyle {}, displayName = "River snapping data")
    val roadNamesLayer = MvtVectorLayer(source, minZoom = 3, maxZoom = 14, maxLoadedTiles = labelTileBudget,
        maxConcurrentFetches = 2, maxConcurrentAssembly = 1, style = roadNameStyle, displayName = "Road labels")
    val placeLabelsLayer = MvtVectorLayer(source, minZoom = 2, maxZoom = 14, maxLoadedTiles = labelTileBudget,
        maxConcurrentFetches = 2, maxConcurrentAssembly = 1, style = placeLabelStyle, displayName = "Place labels")
    val tiandituLabelRenderLayer = RenderableLayer("Tianditu raster annotations")
    val tiandituBoundaryRenderLayer = RenderableLayer("Tianditu global boundaries")
    private val imagery = NativeImageryBasemap(window.context, window, onImageryStatus)
    /** Mount above the controller's standard basemap for explicitly selected Sentinel/GIBS imagery. */
    val baseRenderLayer: RenderableLayer get() = imagery.baseRenderLayer
    /** Mount below the controller's standard TDT/custom base for the bundled historical overview. */
    val underlayRenderLayer: RenderableLayer get() = imagery.underlayLayer
    val layers: List<Layer> = listOf(terrainLandWaterLayer, roadsLayer, snapDataLayer, roadNamesLayer, placeLabelsLayer, tiandituLabelRenderLayer, tiandituBoundaryRenderLayer)
    var plan: NativeCartographyPlan = NativeCartographyPlan.resolve(NativeCartographySettings())
        private set
    private var labelMode: String? = null
    private var boundaryEnabled = false
    private var closed = false
    private var riverSnapping = false
    private val raster = TiandituRasterSource(tiandituKey)

    init {
        // No vector source may start decoding a world overview before React supplies its selection.
        layers.forEach { it.isEnabled = false }
    }

    fun apply(settings: NativeCartographySettings, activeCustomSource: Boolean = false, baseSelectionAllowed: Boolean = false, maxRasterZoom: Int? = null) {
        if (closed) return
        val effectiveSettings = if (activeCustomSource) settings.copy(sourceId = "custom") else settings
        val next = NativeCartographyPlan.resolve(effectiveSettings)
        plan = next
        imagery.apply(
            requestedBase = if (activeCustomSource) "custom" else next.effectiveBase,
            showOverview = next.satelliteUnderlay,
            baseSelectionAllowed = activeCustomSource || baseSelectionAllowed,
            maxRasterZoom = maxRasterZoom,
        )
        terrainLandWaterLayer.isEnabled = next.effectiveBase == "terrain" || next.effectiveBase == "offline"
        roadsLayer.isEnabled = next.roads
        roadsLayer.opacity = next.roadsOpacity
        roadNamesLayer.isEnabled = next.roadNames
        roadNamesLayer.opacity = next.roadsOpacity
        placeLabelsLayer.isEnabled = next.placeLabels
        placeLabelsLayer.opacity = next.roadsOpacity
        syncSnapDataLayer()
        if (labelMode != next.tiandituLabels) {
            tiandituLabelRenderLayer.clearRenderables()
            next.tiandituLabels?.let { mode -> tiandituLabelRenderLayer.addRenderable(raster.labelImage(mode)) }
            labelMode = next.tiandituLabels
        }
        tiandituLabelRenderLayer.isEnabled = next.tiandituLabels != null
        tiandituLabelRenderLayer.opacity = next.rasterLabelOpacity
        if (boundaryEnabled != next.tiandituBoundaries) {
            tiandituBoundaryRenderLayer.clearRenderables()
            if (next.tiandituBoundaries) tiandituBoundaryRenderLayer.addRenderable(raster.boundaryImage())
            boundaryEnabled = next.tiandituBoundaries
        }
        tiandituBoundaryRenderLayer.isEnabled = next.tiandituBoundaries
        window.requestRedraw()
    }

    fun imageryStatus(): NativeImageryStatus = imagery.status()
    fun imageryRenderedTileCount(): Long = imagery.renderedTileCount()
    fun retryLatestImagery() = imagery.retryLatest()

    /** Read-only snapshot of real MVT responses already fetched for the requested visible bounds. */
    internal fun cachedSnapTiles(boundsWgs84: List<Double>): List<NativeCachedSnapTile>? =
        (source as? NativeSnapTileCache)?.visibleTiles(boundsWgs84)

    /** Registers a read-only callback for tiles fetched by the shared OpenFreeMap source. */
    internal fun observeSnapTileFetches(observer: (NativeCachedSnapTile) -> Unit): AutoCloseable? =
        (source as? NativeSnapTileCache)?.observe(observer)

    fun snapRoadLayerVisible(): Boolean = !closed && roadsLayer.isEnabled

    internal fun setRiverSnapping(enabled: Boolean) {
        if (riverSnapping == enabled) return
        riverSnapping = enabled
        syncSnapDataLayer()
    }

    private fun syncSnapDataLayer() {
        // Rivers remain available independently of the road display toggle. Fetch the
        // shared real MVT source without drawing a second road overlay when needed.
        val enabled = !closed && riverSnapping && !roadsLayer.isEnabled &&
            !terrainLandWaterLayer.isEnabled && !placeLabelsLayer.isEnabled
        if (snapDataLayer.isEnabled != enabled) {
            snapDataLayer.isEnabled = enabled
            window.requestRedraw()
        }
    }

    override fun close() {
        if (closed) return
        closed = true
        terrainLandWaterLayer.close(); roadsLayer.close(); snapDataLayer.close(); roadNamesLayer.close(); placeLabelsLayer.close()
        raster.close(); imagery.close()
        tiandituLabelRenderLayer.clearRenderables(); tiandituBoundaryRenderLayer.clearRenderables()
    }

    companion object {
        const val ATTRIBUTION = "OpenFreeMap © OpenMapTiles · Data from OpenStreetMap contributors"
        const val TIANDITU_ATTRIBUTION = "© 国家基础地理信息中心 · 天地图"
        private const val OPENFREEMAP_TEMPLATE = "https://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf"

        val roadStyle: MvtStyle = object : MvtStyle {
            override fun styleFor(layerName: String, geometryType: MvtGeometryType, properties: Map<String, Any?>): ShapeAttributes? =
                if (layerName in setOf("transportation", "waterway")) DefaultMvtStyle.styleFor(layerName, geometryType, properties) else null
            override fun zOrderFor(layerName: String, geometryType: MvtGeometryType, properties: Map<String, Any?>): Int =
                if (layerName in setOf("transportation", "waterway")) DefaultMvtStyle.zOrderFor(layerName, geometryType, properties) else Int.MIN_VALUE
        }

        val roadNameStyle: MvtRuleBasedStyle = mvtStyle {
            rule("transportation_name") { filter = MvtFilter.has("ref"); minZoom = 8; paint { text("ref") { placement = earth.worldwind.layer.mvt.MvtStyleRule.LabelPlacement.LINE; color(Color(.96f,.96f,.86f)); size = earth.worldwind.layer.mvt.MvtZoomInterp.floats(8 to 9f, 13 to 12f); halo(Color(.08f,.14f,.18f), 1.7f) } } }
            for (field in listOf("name:zh", "name:nonlatin", "name")) rule("transportation_name") { filter = MvtFilter.has(field); minZoom = 12; paint { text(field) { placement = earth.worldwind.layer.mvt.MvtStyleRule.LabelPlacement.LINE; color(Color(.96f,.96f,.86f)); size = earth.worldwind.layer.mvt.MvtZoomInterp.floats(12 to 10f, 16 to 13f); halo(Color(.08f,.14f,.18f), 1.8f) } } }
        }

        val placeLabelStyle: MvtRuleBasedStyle = mvtStyle {
            for (field in listOf("name:zh", "name:nonlatin", "name")) rule("place") { filter = MvtFilter.has(field); minZoom = 3; paint { text(field) { color(Color(.96f,.96f,.90f)); size = earth.worldwind.layer.mvt.MvtZoomInterp.floats(3 to 12f, 8 to 14f, 13 to 17f); halo(Color(.07f,.13f,.16f), 2f) } } }
            for (field in listOf("name:zh", "name:nonlatin", "name")) rule("water_name") { filter = MvtFilter.has(field); minZoom = 7; paint { text(field) { color(Color(.55f,.82f,.94f)); size = earth.worldwind.layer.mvt.MvtZoomInterp.floats(7 to 10f, 13 to 13f); halo(Color(.07f,.13f,.16f), 1.6f) } } }
            for (field in listOf("name:zh", "name:nonlatin", "name")) rule("mountain_peak") { filter = MvtFilter.has(field); minZoom = 10; paint { text(field) { color(Color(.96f,.93f,.82f)); size = earth.worldwind.layer.mvt.MvtZoomInterp.floats(10 to 11f, 14 to 14f); halo(Color(.07f,.13f,.16f), 1.8f) } } }
        }
    }
}

/** Memory-bounded MVT source shared by the three independent style layers. */
internal data class NativeCachedSnapTile(val z: Int, val x: Int, val y: Int, val bytes: ByteArray, val cacheToken: Any)
private interface NativeSnapTileCache {
    fun visibleTiles(boundsWgs84: List<Double>): List<NativeCachedSnapTile>
    fun observe(observer: (NativeCachedSnapTile) -> Unit): AutoCloseable
}

private class SharedOpenFreeMapTileSource : TileSource, NativeSnapTileCache {
    private val executor = Executors.newFixedThreadPool(2)
    private val requestPermits = Semaphore(2)
    private val active = ConcurrentHashMap.newKeySet<HttpURLConnection>()
    private val snapObservers = java.util.concurrent.CopyOnWriteArraySet<(NativeCachedSnapTile) -> Unit>()
    private val cache = object : LinkedHashMap<String, TileBlob>(80, .75f, true) {
        private var bytes = 0
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, TileBlob>?): Boolean {
            if (size <= MAX_CACHED_TILES && bytes <= MAX_CACHE_BYTES) return false
            eldest?.let { bytes -= it.value.bytes.size }
            return true
        }
        fun clearTiles() { synchronized(this) { clear(); bytes = 0 } }
        fun putTile(key: String, value: TileBlob) { synchronized(this) { remove(key)?.let { bytes -= it.bytes.size }; bytes += value.bytes.size; put(key, value) } }
    }
    @Volatile private var closed = false

    override suspend fun tryReadCachedTile(z: Int, x: Int, y: Int): TileBlob? = synchronized(cache) { cache["$z/$x/$y"] }

    override fun visibleTiles(boundsWgs84: List<Double>): List<NativeCachedSnapTile> {
        require(boundsWgs84.size == 4 && boundsWgs84.all(Double::isFinite))
        val (west, south, east, north) = boundsWgs84
        require(west >= -180 && east <= 180 && south >= -85.051129 && north <= 85.051129 && west <= east && south <= north)
        return synchronized(cache) {
            cache.entries.mapNotNull { (key, blob) ->
                if (blob.bytes.isEmpty()) return@mapNotNull null
                val parts = key.split('/'); if (parts.size != 3) return@mapNotNull null
                val z = parts[0].toIntOrNull() ?: return@mapNotNull null
                val x = parts[1].toIntOrNull() ?: return@mapNotNull null
                val y = parts[2].toIntOrNull() ?: return@mapNotNull null
                if (z !in 0..14) return@mapNotNull null
                val n = 1 shl z
                val tileWest = x.toDouble() / n * 360.0 - 180.0
                val tileEast = (x + 1.0) / n * 360.0 - 180.0
                fun latitude(row: Double): Double = Math.toDegrees(kotlin.math.atan(kotlin.math.sinh(Math.PI * (1 - 2 * row / n))))
                val tileNorth = latitude(y.toDouble()); val tileSouth = latitude(y + 1.0)
                if (tileEast < west || tileWest > east || tileNorth < south || tileSouth > north) null
                else NativeCachedSnapTile(z, x, y, blob.bytes.copyOf(), blob)
            }
        }
    }
    override fun observe(observer: (NativeCachedSnapTile) -> Unit): AutoCloseable {
        snapObservers += observer
        return AutoCloseable { snapObservers -= observer }
    }
    override suspend fun fetchTile(z: Int, x: Int, y: Int, previousEtag: String?, previousLastModified: String?): TileBlob? {
        require(!closed && z in 0..14 && x in 0 until (1 shl z) && y in 0 until (1 shl z))
        val key = "$z/$x/$y"
        val policy = NativeOfflineDisplayPolicy.snapshot()
        val url = if (policy.enabled) NativeOfflineDisplayPolicy.selectedOpenFreeMapTileUrl(z, x, y)
            ?: run { NativeOfflineDisplayPolicy.reportMissingOpenFreeMapTemplate(); return TileBlob.EMPTY }
        else "https://tiles.openfreemap.org/planet/latest/$z/$x/$y.pbf"
        if (policy.enabled) {
            val bytes = NativeOfflineDisplayPolicy.readSelectedCache(url) ?: return TileBlob.EMPTY
            val cached = TileBlob(bytes, null, null, "application/vnd.mapbox-vector-tile")
            synchronized(cache) { cache.putTile(key, cached) }
            if (bytes.isNotEmpty()) {
                val loaded = NativeCachedSnapTile(z, x, y, bytes.copyOf(), cached)
                snapObservers.forEach { observer -> runCatching { observer(loaded) } }
            }
            return cached
        }
        synchronized(cache) { cache[key]?.let { return it } }
        val blob = requestPermits.withPermit { fetch(url) }
        synchronized(cache) { cache.putTile(key, blob) }
        if (blob.bytes.isNotEmpty()) {
            val loaded = NativeCachedSnapTile(z, x, y, blob.bytes.copyOf(), blob)
            snapObservers.forEach { observer -> runCatching { observer(loaded) } }
        }
        return blob
    }

    private suspend fun fetch(url: String): TileBlob {
        if (NativeOfflineDisplayPolicy.snapshot().enabled) {
            val bytes = NativeOfflineDisplayPolicy.readSelectedCache(url) ?: return TileBlob.EMPTY
            return TileBlob(bytes, null, null, "application/vnd.mapbox-vector-tile")
        }
        return suspendCancellableCoroutine { cont ->
        val connection = AtomicReference<HttpURLConnection?>(); val future = AtomicReference<Future<*>?>()
        val task = executor.submit {
            try {
                val c = URL(url).openConnection() as HttpURLConnection; connection.set(c)
                if (!cont.isActive || Thread.currentThread().isInterrupted) { c.disconnect(); throw CancellationException("request cancelled") }
                active += c
                c.instanceFollowRedirects = false; c.connectTimeout = 10000; c.readTimeout = 12000
                c.setRequestProperty("Accept", "application/vnd.mapbox-vector-tile,application/x-protobuf")
                c.setRequestProperty("User-Agent", "ShantuNativeMap/1")
                if (c.responseCode == 404) { if (cont.isActive) cont.resume(TileBlob.EMPTY); return@submit }
                if (c.responseCode !in 200..299) error("OpenFreeMap vector tile request failed")
                checkResponseLength(c.getHeaderFieldLong("Content-Length", -1L), MAX_TILE_BYTES)
                val bytes = c.inputStream.use { readBounded(it, MAX_TILE_BYTES) }
                if (cont.isActive) cont.resume(TileBlob(bytes, c.getHeaderField("ETag"), c.getHeaderField("Last-Modified"), c.contentType))
            } catch (e: CancellationException) { if (cont.isActive) cont.resumeWithException(e) }
            catch (_: Exception) { if (cont.isActive) cont.resumeWithException(IllegalStateException("道路与地名图层读取失败")) }
            finally { connection.get()?.let { active.remove(it); it.disconnect() } }
        }
        future.set(task); if (!cont.isActive) task.cancel(true)
        cont.invokeOnCancellation { connection.get()?.disconnect(); future.get()?.cancel(true) }
        }
    }

    override fun close() {
        if (closed) return
        closed = true; active.toList().forEach { it.disconnect() }; executor.shutdownNow()
        snapObservers.clear()
        synchronized(cache) { cache.clearTiles() }
    }

    companion object { private const val MAX_TILE_BYTES = 4 * 1024 * 1024; private const val MAX_CACHE_BYTES = 32 * 1024 * 1024; private const val MAX_CACHED_TILES = 256 }
}

private const val MAX_RASTER_BYTES = 4 * 1024 * 1024
private fun checkResponseLength(length: Long, limit: Int) {
    check(length == -1L || length in 0..limit.toLong()) { "Map tile response exceeds limit" }
}

private class TiandituRasterSource(private val keyProvider: () -> String) : AutoCloseable {
    private val active = ConcurrentHashMap.newKeySet<HttpURLConnection>()
    private val executor = Executors.newFixedThreadPool(4)
    private val requestPermits = Semaphore(4)
    @Volatile private var closed = false
    fun labelImage(layer: String) = surface("天地图 $layer", layer, if (layer == "cva") 19 else 18)
    fun boundaryImage() = surface("天地图全球境界 ibo", "ibo", 18)

    private fun surface(name: String, layer: String, maxZoom: Int): MercatorTiledSurfaceImage {
        val factory = object : MercatorTileFactory {
            override val contentType = name
            override fun getImageSource(x: Int, y: Int, z: Int): ImageSource = ImageSource.fromImageFactory(object : ImageSource.NetworkBoundImageFactory {
                override suspend fun createCachedBitmap(): Bitmap? = null
                override suspend fun createBitmap(): Bitmap? = withContext(Dispatchers.IO) {
                    val bytes = fetch(tiandituUrl(layer, x, y, z))
                    if (bytes.isEmpty()) return@withContext null
                    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                    require(bounds.outWidth in 1..1024 && bounds.outHeight in 1..1024 && bounds.outWidth.toLong() * bounds.outHeight <= 1_048_576) { "地图注记图片尺寸无效" }
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: error("地图注记图片解码失败")
                }
            })
        }
        return MercatorTiledImageLayer.buildTiledSurfaceImage(factory, true, tileSize = 256, maxZoom = maxZoom, minZoom = 0)
    }

    private suspend fun fetch(url: String): ByteArray = requestPermits.withPermit { fetchOne(url) }

    private suspend fun fetchOne(url: String): ByteArray {
        val policy = NativeOfflineDisplayPolicy.snapshot()
        if (policy.enabled) {
            return NativeOfflineDisplayPolicy.readSelectedCache(url)?.takeIf { it.size <= MAX_RASTER_BYTES } ?: ByteArray(0)
        }
        return suspendCancellableCoroutine { cont ->
        val connection = AtomicReference<HttpURLConnection?>(); val future = AtomicReference<Future<*>?>()
        val task = executor.submit {
            try {
                val c = URL(url).openConnection() as HttpURLConnection; connection.set(c)
                if (!cont.isActive || Thread.currentThread().isInterrupted) { c.disconnect(); throw CancellationException("request cancelled") }
                active += c
                c.instanceFollowRedirects = false; c.connectTimeout = 10000; c.readTimeout = 12000
                if (c.responseCode !in 200..299) error("Tianditu annotation tile unavailable")
                checkResponseLength(c.getHeaderFieldLong("Content-Length", -1L), MAX_RASTER_BYTES)
                val bytes = c.inputStream.use { readBounded(it, MAX_RASTER_BYTES) }
                if (cont.isActive) cont.resume(bytes)
            } catch (e: CancellationException) { if (cont.isActive) cont.resumeWithException(e) }
            catch (_: Exception) { if (cont.isActive) cont.resumeWithException(IllegalStateException("天地图注记瓦片读取失败")) }
            finally { connection.get()?.let { active.remove(it); it.disconnect() } }
        }
        future.set(task); if (!cont.isActive) task.cancel(true)
        cont.invokeOnCancellation { connection.get()?.disconnect(); future.get()?.cancel(true) }
        }
    }

    private fun tiandituUrl(layer: String, x: Int, y: Int, z: Int): String {
        require(layer in setOf("cva", "cia", "cta", "ibo") && !closed)
        val key = keyProvider().trim(); require(key.isNotEmpty()) { "Tianditu key unavailable" }
        val tk = URLEncoder.encode(key, "UTF-8")
        return "https://t0.tianditu.gov.cn/${layer}_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=$layer&STYLE=default&TILEMATRIXSET=w&TILEMATRIX=$z&TILEROW=$y&TILECOL=$x&FORMAT=tiles&tk=$tk"
    }

    override fun close() { closed = true; active.toList().forEach { it.disconnect() }; executor.shutdownNow() }
}

private fun readBounded(input: java.io.InputStream, limit: Int): ByteArray {
    val out = ByteArrayOutputStream(min(limit, 32 * 1024)); val buffer = ByteArray(8192); var total = 0
    while (true) {
        if (Thread.currentThread().isInterrupted) throw CancellationException("network request cancelled")
        val n = input.read(buffer, 0, min(buffer.size, limit - total + 1)); if (n < 0) break
        total += n; check(total <= limit) { "map tile payload exceeds limit" }; out.write(buffer, 0, n)
    }
    return out.toByteArray()
}
