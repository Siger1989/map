package com.shantu.nativeapp.map

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import earth.worldwind.WorldWindow
import earth.worldwind.layer.Layer
import earth.worldwind.layer.RenderableLayer
import earth.worldwind.layer.mercator.MercatorTileFactory
import earth.worldwind.layer.mercator.MercatorTiledImageLayer
import earth.worldwind.layer.mercator.MercatorTiledSurfaceImage
import earth.worldwind.layer.mvt.MvtFilter
import earth.worldwind.layer.mvt.MvtRuleBasedStyle
import earth.worldwind.layer.mvt.MvtStyle
import earth.worldwind.layer.mvt.MvtVectorLayer
import earth.worldwind.layer.mvt.mvtStyle
import earth.worldwind.layer.source.TileBlob
import earth.worldwind.layer.source.TileSource
import earth.worldwind.render.Color
import earth.worldwind.render.image.ImageSource
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
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.atomic.AtomicReference
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.math.min

/** Keep independently drawn raster annotations at the selected basemap quality. */
internal object NativeCartographyRasterQuality {
    fun detailControl(quality: NativeMapQuality): Double = if (quality == NativeMapQuality.HIGH) 0.5 else 1.0
}

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
    /** Explicit datum override for built-in Tianditu raster layers; default keeps legacy WGS84 behavior. */
    val tiandituRasterDatum: NativeRasterDatum = NativeRasterDatum.WGS84,
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

/** Resolve only the explicit user override. Missing/unknown values preserve the existing WGS84 default. */
internal object NativeRasterDatumOverride {
    fun resolve(value: String?): NativeRasterDatum = when (value?.lowercase()) {
        "gcj02" -> NativeRasterDatum.GCJ02
        "bd09" -> NativeRasterDatum.BD09
        else -> NativeRasterDatum.WGS84
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
class NativeCartographyLayers internal constructor(
    private val window: WorldWindow,
    private val tiandituKey: () -> String,
    private val source: TileSource = SharedOpenFreeMapTileSource(),
    private val sharedNetwork: BoundedTileNetwork? = null,
    private val tileIdentityFor: (String, String, Int, Int, Int, String) -> TileRequestIdentity? = { _, _, _, _, _, _ -> null },
    private val viewId: () -> String? = { null },
    private val generation: () -> Long? = { null },
    private val onImageryStatus: (NativeImageryStatus) -> Unit = {},
) : AutoCloseable {
    private val vectorTileBudget = NativeRenderMemoryBudget.vectorTileCount(Runtime.getRuntime().maxMemory())
    private val labelTileBudget = vectorTileBudget

    /** Real OpenFreeMap land/water polygons over the native DEM-backed dark base surface. */
    private val timedTerrainLayer = NativeTimedMvtLayer(source, minZoom = 0, maxZoom = 14, maxLoadedTiles = vectorTileBudget,
        maxConcurrentFetches = 2, maxConcurrentAssembly = 1, style = NativeTerrainLandWaterStyle,
        displayName = "Terrain land and water", metricPrefix = "terrainLandWater")
    private val nativeRoadLayer = NativeRoadVectorLayer(source, vectorTileBudget)
    val roadsLayer: MvtVectorLayer get() = nativeRoadLayer
    private val snapDataLayer = NativeTimedMvtLayer(source, minZoom = 0, maxZoom = 14, maxLoadedTiles = minOf(12, vectorTileBudget),
        maxConcurrentFetches = 1, maxConcurrentAssembly = 1, style = mvtStyle {},
        displayName = "Road and river snapping data", metricPrefix = "snapData")
    private val timedRoadNamesLayer = NativeTimedMvtLayer(source, minZoom = 3, maxZoom = 14, maxLoadedTiles = labelTileBudget,
        maxConcurrentFetches = 2, maxConcurrentAssembly = 1, style = roadNameStyle,
        displayName = "Road labels", metricPrefix = "roadNames")
    private val timedPlaceLabelsLayer = NativeTimedMvtLayer(source, minZoom = 2, maxZoom = 14, maxLoadedTiles = labelTileBudget,
        maxConcurrentFetches = 2, maxConcurrentAssembly = 1, style = placeLabelStyle,
        displayName = "Place labels", metricPrefix = "placeLabels")
    val terrainLandWaterLayer: MvtVectorLayer get() = timedTerrainLayer
    val roadNamesLayer: MvtVectorLayer get() = timedRoadNamesLayer
    val placeLabelsLayer: MvtVectorLayer get() = timedPlaceLabelsLayer
    val tiandituLabelRenderLayer = RenderableLayer("Tianditu raster annotations")
    val tiandituBoundaryRenderLayer = RenderableLayer("Tianditu global boundaries")
    private val timedMvtLayers: List<NativeTimedMvtLayer> =
        listOf(timedTerrainLayer, nativeRoadLayer, snapDataLayer, timedRoadNamesLayer, timedPlaceLabelsLayer)
    private val imagery = NativeImageryBasemap(
        window.context, window, onImageryStatus, sharedNetwork,
        tileIdentityFor = { source, z, x, y, style -> tileIdentityFor(source, "imagery", z, x, y, style) },
        viewId = viewId, demandGeneration = generation,
    )
    /** Mount above the controller's standard basemap for explicitly selected Sentinel/GIBS imagery. */
    val baseRenderLayer: RenderableLayer get() = imagery.baseRenderLayer
    /** Mount below the controller's standard TDT/custom base for the bundled historical overview. */
    val underlayRenderLayer: RenderableLayer get() = imagery.underlayLayer
    val layers: List<Layer> = listOf(terrainLandWaterLayer, roadsLayer, snapDataLayer, roadNamesLayer,
        placeLabelsLayer, tiandituLabelRenderLayer, tiandituBoundaryRenderLayer)
    var plan: NativeCartographyPlan = NativeCartographyPlan.resolve(NativeCartographySettings())
        private set
    private var labelMode: String? = null
    private var boundaryEnabled = false
    private var closed = false
    private var roadSnapping = false
    private var riverSnapping = false
    private val raster = TiandituRasterSource(tiandituKey, sharedNetwork, tileIdentityFor, viewId, generation)

    init {
        // These MVT layers are backgrounds, not business pick targets: the bridge consumes String
        // delegates for app objects, while snapping reads the shared raw MVT cache independently.
        // Keep SDK per-feature pick payloads and pick draws off. Re-enable explicitly if a future
        // feature-state or vector-feature inspection flow needs them.
        listOf(terrainLandWaterLayer, roadsLayer, snapDataLayer, roadNamesLayer, placeLabelsLayer).forEach {
            it.isPickEnabled = false
        }
        // No vector source may start decoding a world overview before React supplies its selection.
        layers.forEach { it.isEnabled = false }
    }

    fun apply(settings: NativeCartographySettings, activeCustomSource: Boolean = false, baseSelectionAllowed: Boolean = false, maxRasterZoom: Int? = null) {
        if (closed) return
        val effectiveSettings = if (activeCustomSource) settings.copy(sourceId = "custom") else settings
        val next = NativeCartographyPlan.resolve(effectiveSettings)
        plan = next
        val rasterDatumChanged = raster.setDatum(effectiveSettings.tiandituRasterDatum)
        imagery.apply(
            requestedBase = if (activeCustomSource) "custom" else next.effectiveBase,
            showOverview = next.satelliteUnderlay,
            baseSelectionAllowed = activeCustomSource || baseSelectionAllowed,
            maxRasterZoom = maxRasterZoom,
        )
        setVectorLayerEnabled(timedTerrainLayer, next.effectiveBase == "terrain" || next.effectiveBase == "offline")
        setVectorLayerEnabled(nativeRoadLayer, next.roads)
        roadsLayer.opacity = next.roadsOpacity
        setVectorLayerEnabled(timedRoadNamesLayer, next.roadNames)
        roadNamesLayer.opacity = next.roadsOpacity
        setVectorLayerEnabled(timedPlaceLabelsLayer, next.placeLabels)
        placeLabelsLayer.opacity = next.roadsOpacity
        syncSnapDataLayer()
        if (labelMode != next.tiandituLabels || rasterDatumChanged) {
            tiandituLabelRenderLayer.clearRenderables()
            next.tiandituLabels?.let { mode -> tiandituLabelRenderLayer.addRenderable(raster.labelImage(mode, effectiveSettings.tiandituRasterDatum)) }
            labelMode = next.tiandituLabels
        }
        tiandituLabelRenderLayer.isEnabled = next.tiandituLabels != null
        tiandituLabelRenderLayer.opacity = next.rasterLabelOpacity
        if (boundaryEnabled != next.tiandituBoundaries || rasterDatumChanged) {
            tiandituBoundaryRenderLayer.clearRenderables()
            if (next.tiandituBoundaries) tiandituBoundaryRenderLayer.addRenderable(raster.boundaryImage(effectiveSettings.tiandituRasterDatum))
            boundaryEnabled = next.tiandituBoundaries
        }
        tiandituBoundaryRenderLayer.isEnabled = next.tiandituBoundaries
        window.requestRedraw()
    }

    fun imageryStatus(): NativeImageryStatus = imagery.status()
    fun imageryRenderedTileCount(): Long = imagery.renderedTileCount()
    fun retryLatestImagery() = imagery.retryLatest()

    /** Explicit diagnostics snapshot: normal-render wall ns and bounded predecode queue counts. */
    fun frameCostSnapshot(): Map<String, Long> = buildMap(timedMvtLayers.size * 3) {
        timedMvtLayers.forEach { it.appendFrameCost(this) }
    }

    fun setRasterQuality(quality: NativeMapQuality) {
        val detail = NativeCartographyRasterQuality.detailControl(quality)
        if (raster.detailControl == detail) return
        raster.detailControl = detail
        for (layer in listOf(tiandituLabelRenderLayer, tiandituBoundaryRenderLayer)) {
            for (renderable in layer) if (renderable is MercatorTiledSurfaceImage) renderable.detailControl = detail
        }
        window.requestRedraw()
    }

    /** Per-frame presentation only: never invalidates or fetches an MVT tile. */
    fun setViewportStyle(uiZoom: Double, cssScale: Float) {
        // A first/changed style needs one draw even when all source tiles are already cached.
        // Ignore matrix-roundoff zoom jitter so a frame callback cannot sustain its own redraw loop.
        if (!closed && nativeRoadLayer.setViewportStyle(uiZoom, cssScale)) window.requestRedraw()
    }

    /** Read-only snapshot of real MVT responses already fetched for the requested visible bounds. */
    internal fun cachedSnapTiles(boundsWgs84: List<Double>): List<NativeCachedSnapTile>? =
        (source as? NativeSnapTileCache)?.visibleTiles(boundsWgs84)

    /** Registers a read-only callback for tiles fetched by the shared OpenFreeMap source. */
    internal fun observeSnapTileFetches(observer: (NativeCachedSnapTile) -> Unit): AutoCloseable? =
        (source as? NativeSnapTileCache)?.observe(observer)

    /** True while any bounded visible MVT layer can populate the shared snap cache. */
    fun snapSourceVisible(): Boolean = !closed && (
        snapDataLayer.isEnabled || roadsLayer.isEnabled || roadNamesLayer.isEnabled ||
            placeLabelsLayer.isEnabled || terrainLandWaterLayer.isEnabled
        )

    internal fun setRoadSnapping(enabled: Boolean) {
        if (roadSnapping == enabled) return
        roadSnapping = enabled
        syncSnapDataLayer()
    }

    internal fun setRiverSnapping(enabled: Boolean) {
        if (riverSnapping == enabled) return
        riverSnapping = enabled
        syncSnapDataLayer()
    }

    private fun setVectorLayerEnabled(layer: NativeTimedMvtLayer, enabled: Boolean) {
        layer.isEnabled = enabled
        // Disabled layers may never reach SDK endFrame. Also catches jobs registering just after
        // this transition via the layer's work-change callback; started work and cache survive.
        if (!enabled) layer.discardPendingViewportWork()
    }

    private fun syncSnapDataLayer() {
        // Road and river snapping read the shared real MVT source independently of
        // display toggles. The empty style only populates the bounded cache; it draws
        // no duplicate roads. Other visible MVT layers already populate this source.
        val visibleMvtLayerAlreadyFetching = roadsLayer.isEnabled || roadNamesLayer.isEnabled ||
            placeLabelsLayer.isEnabled || terrainLandWaterLayer.isEnabled
        val enabled = !closed && NativeSnapDataLayerPolicy.shouldEnable(
            roadSnapping, riverSnapping, visibleMvtLayerAlreadyFetching,
        )
        if (snapDataLayer.isEnabled != enabled) {
            setVectorLayerEnabled(snapDataLayer, enabled)
            window.requestRedraw()
        }
    }

    override fun close() {
        if (closed) return
        closed = true
        terrainLandWaterLayer.close(); roadsLayer.close(); snapDataLayer.close(); roadNamesLayer.close(); placeLabelsLayer.close()
        // MvtVectorLayer closes its TileSource. The shared adapter's close is intentionally
        // non-owning; release this map's process-pool lease only after all five layers stop.
        (source as? SharedOpenFreeMapTileSource)?.release()
        raster.close(); imagery.close()
        tiandituLabelRenderLayer.clearRenderables(); tiandituBoundaryRenderLayer.clearRenderables()
    }

    companion object {
        const val ATTRIBUTION = "OpenFreeMap © OpenMapTiles · Data from OpenStreetMap contributors"
        const val TIANDITU_ATTRIBUTION = "© 国家基础地理信息中心 · 天地图"
        private const val OPENFREEMAP_TEMPLATE = "https://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf"
        private const val VECTOR_LABEL_SCALE = .84f
        private fun labelPx(value: Float) = value * VECTOR_LABEL_SCALE

        val roadStyle: MvtStyle = NativeRoadStyle.style

        val roadNameStyle: MvtRuleBasedStyle = mvtStyle {
            rule("transportation_name") { filter = MvtFilter.has("ref"); minZoom = 8; paint { text("ref") { placement = earth.worldwind.layer.mvt.MvtStyleRule.LabelPlacement.LINE; color(Color(.96f,.96f,.86f)); size = earth.worldwind.layer.mvt.MvtZoomInterp.floats(8 to labelPx(9f), 13 to labelPx(12f)); halo(Color(.08f,.14f,.18f), labelPx(1.7f)) } } }
            for (field in listOf("name:zh", "name:nonlatin", "name")) rule("transportation_name") { filter = MvtFilter.has(field); minZoom = 12; paint { text(field) { placement = earth.worldwind.layer.mvt.MvtStyleRule.LabelPlacement.LINE; color(Color(.96f,.96f,.86f)); size = earth.worldwind.layer.mvt.MvtZoomInterp.floats(12 to labelPx(10f), 16 to labelPx(13f)); halo(Color(.08f,.14f,.18f), labelPx(1.8f)) } } }
        }

        val placeLabelStyle: MvtRuleBasedStyle = mvtStyle {
            for (field in listOf("name:zh", "name:nonlatin", "name")) rule("place") { filter = MvtFilter.has(field); minZoom = 3; paint { text(field) { color(Color(.96f,.96f,.90f)); size = earth.worldwind.layer.mvt.MvtZoomInterp.floats(3 to labelPx(12f), 8 to labelPx(14f), 13 to labelPx(17f)); halo(Color(.07f,.13f,.16f), labelPx(2f)) } } }
            for (field in listOf("name:zh", "name:nonlatin", "name")) rule("water_name") { filter = MvtFilter.has(field); minZoom = 7; paint { text(field) { color(Color(.55f,.82f,.94f)); size = earth.worldwind.layer.mvt.MvtZoomInterp.floats(7 to labelPx(10f), 13 to labelPx(13f)); halo(Color(.07f,.13f,.16f), labelPx(1.6f)) } } }
            for (field in listOf("name:zh", "name:nonlatin", "name")) rule("mountain_peak") { filter = MvtFilter.has(field); minZoom = 10; paint { text(field) { color(Color(.96f,.93f,.82f)); size = earth.worldwind.layer.mvt.MvtZoomInterp.floats(10 to labelPx(11f), 14 to labelPx(14f)); halo(Color(.07f,.13f,.16f), labelPx(1.8f)) } } }
        }
    }
}

internal object NativeSnapDataLayerPolicy {
    fun shouldEnable(roadSnapping: Boolean, riverSnapping: Boolean, anotherMvtLayerFetching: Boolean): Boolean =
        (roadSnapping || riverSnapping) && !anotherMvtLayerFetching
}

/** Memory-bounded MVT source shared by the three independent style layers. */
internal data class NativeCachedSnapTile(val z: Int, val x: Int, val y: Int, val bytes: ByteArray, val cacheToken: Any)
private interface NativeSnapTileCache {
    fun visibleTiles(boundsWgs84: List<Double>): List<NativeCachedSnapTile>
    fun observe(observer: (NativeCachedSnapTile) -> Unit): AutoCloseable
}

/** The SDK closes a TileSource once per MVT layer; this adapter deliberately does not own the lease. */
private class SharedOpenFreeMapTileSource : TileSource, NativeSnapTileCache {
    private val leaseBundle = NativeOpenFreeMapRawTilePool.acquireLease()
    private val core = leaseBundle.first
    private val lease = leaseBundle.second
    private val released = java.util.concurrent.atomic.AtomicBoolean(false)

    override suspend fun tryReadCachedTile(z: Int, x: Int, y: Int): TileBlob? =
        lease.cached(key(identity(), z, x, y))

    override suspend fun fetchTile(z: Int, x: Int, y: Int, previousEtag: String?, previousLastModified: String?): TileBlob? =
        lease.fetch(key(identity(), z, x, y))

    override fun visibleTiles(boundsWgs84: List<Double>): List<NativeCachedSnapTile> {
        require(boundsWgs84.size == 4 && boundsWgs84.all(Double::isFinite))
        val (west, south, east, north) = boundsWgs84
        require(west >= -180 && east <= 180 && south >= -85.051129 && north <= 85.051129 && west <= east && south <= north)
        val current = identity()
        return lease.cachedEntries().mapNotNull { (key, blob) ->
            if (key.identity != current || blob.bytes.isEmpty()) return@mapNotNull null
            if (key.z !in 0..14) return@mapNotNull null
            val n = 1 shl key.z
            val tileWest = key.x.toDouble() / n * 360.0 - 180.0
            val tileEast = (key.x + 1.0) / n * 360.0 - 180.0
            fun latitude(row: Double): Double = Math.toDegrees(kotlin.math.atan(kotlin.math.sinh(Math.PI * (1 - 2 * row / n))))
            val tileNorth = latitude(key.y.toDouble()); val tileSouth = latitude(key.y + 1.0)
            if (tileEast < west || tileWest > east || tileNorth < south || tileSouth > north) null
            else NativeCachedSnapTile(key.z, key.x, key.y, blob.bytes.copyOf(), blob)
        }
    }

    @Synchronized override fun observe(observer: (NativeCachedSnapTile) -> Unit): AutoCloseable {
        if (released.get()) return AutoCloseable { }
        return lease.observe { key, blob ->
            val current = identity()
            if (key.identity == current && blob.bytes.isNotEmpty()) {
                observer(NativeCachedSnapTile(key.z, key.x, key.y, blob.bytes.copyOf(), blob))
            }
        }
    }

    /** Called once by NativeCartographyLayers after its MVT layers close. */
    @Synchronized
    fun release() {
        if (!released.compareAndSet(false, true)) return
        NativeOpenFreeMapRawTilePool.release(core, lease)
    }

    override fun close() = Unit

    private fun identity() = NativeOpenFreeMapRawSourceIdentity.from(NativeOfflineDisplayPolicy.snapshot())
    private fun key(identity: NativeOpenFreeMapRawSourceIdentity, z: Int, x: Int, y: Int) = NativeOpenFreeMapRawTileKey(identity, z, x, y)
}

private class NativeOpenFreeMapRawCore {
    val executor = Executors.newFixedThreadPool(2)
    val requestPermits = Semaphore(2)
    val active = ConcurrentHashMap.newKeySet<HttpURLConnection>()
    val store = NativeSharedRawTileStore<NativeOpenFreeMapRawTileKey>(loader = ::load)

    private suspend fun load(key: NativeOpenFreeMapRawTileKey): TileBlob? {
        val identity = key.identity
        val url = if (identity.enabled) {
            val current = NativeOfflineDisplayPolicy.snapshot()
            if (identity != NativeOpenFreeMapRawSourceIdentity.from(current)) return null
            NativeOfflineDisplayPolicy.selectedOpenFreeMapTileUrl(key.z, key.x, key.y)
                ?: run { NativeOfflineDisplayPolicy.reportMissingOpenFreeMapTemplate(); return TileBlob.EMPTY }
        } else "https://tiles.openfreemap.org/planet/latest/${key.z}/${key.x}/${key.y}.pbf"

        if (identity.enabled) {
            val bytes = NativeOfflineDisplayPolicy.readSelectedCache(url) ?: return TileBlob.EMPTY
            if (identity != NativeOpenFreeMapRawSourceIdentity.from(NativeOfflineDisplayPolicy.snapshot())) return null
            return TileBlob(bytes, null, null, "application/vnd.mapbox-vector-tile")
        }
        if (identity != NativeOpenFreeMapRawSourceIdentity.from(NativeOfflineDisplayPolicy.snapshot())) return null
        return requestPermits.withPermit { fetch(url) }
    }

    private suspend fun fetch(url: String): TileBlob = suspendCancellableCoroutine { cont ->
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

    fun close() { active.toList().forEach { it.disconnect() }; executor.shutdownNow() }

    companion object { private const val MAX_TILE_BYTES = 4 * 1024 * 1024 }
}

private object NativeOpenFreeMapRawTilePool {
    private var current: NativeOpenFreeMapRawCore? = null

    @Synchronized fun acquireLease(): Pair<NativeOpenFreeMapRawCore, NativeSharedRawTileStore<NativeOpenFreeMapRawTileKey>.Lease> {
        val core = current ?: NativeOpenFreeMapRawCore().also { current = it }
        return core to core.store.acquire()
    }

    @Synchronized fun release(core: NativeOpenFreeMapRawCore, lease: NativeSharedRawTileStore<NativeOpenFreeMapRawTileKey>.Lease) {
        lease.close()
        if (current !== core || core.store.snapshot().owners != 0) return
        current = null
        core.close()
    }

    @Synchronized fun numericSnapshot(): NativeSharedRawTileStore.Snapshot? = current?.store?.snapshot()
}

/** URL-free raw MVT pool counters for the bounded performance probe. */
internal fun nativeOpenFreeMapRawTileSnapshot(): NativeSharedRawTileStore.Snapshot? =
    NativeOpenFreeMapRawTilePool.numericSnapshot()

private const val MAX_RASTER_BYTES = 4 * 1024 * 1024
private fun checkResponseLength(length: Long, limit: Int) {
    check(length == -1L || length in 0..limit.toLong()) { "Map tile response exceeds limit" }
}

private class TiandituRasterSource(
    private val keyProvider: () -> String,
    private val sharedNetwork: BoundedTileNetwork?,
    private val tileIdentityFor: (String, String, Int, Int, Int, String) -> TileRequestIdentity?,
    private val viewId: () -> String?,
    private val generation: () -> Long?,
) : AutoCloseable {
    private val active = ConcurrentHashMap.newKeySet<HttpURLConnection>()
    private val executor = Executors.newFixedThreadPool(4)
    private val requestPermits = Semaphore(4)
    @Volatile private var closed = false
    @Volatile private var datum = NativeRasterDatum.WGS84
    var detailControl = NativeCartographyRasterQuality.detailControl(NativeMapQuality.HIGH)
    fun setDatum(value: NativeRasterDatum): Boolean {
        if (datum == value) return false
        datum = value
        return true
    }
    fun labelImage(layer: String, datum: NativeRasterDatum = this.datum) = surface("天地图 $layer", layer, if (layer == "cva") 19 else 18, datum)
    fun boundaryImage(datum: NativeRasterDatum = this.datum) = surface("天地图全球境界 ibo", "ibo", 18, datum)

    private fun surface(name: String, layer: String, maxZoom: Int, datum: NativeRasterDatum): MercatorTiledSurfaceImage {
        val factory = object : MercatorTileFactory {
            override val contentType = name
            override fun getImageSource(x: Int, y: Int, z: Int): ImageSource {
                val url = tiandituUrl(layer, x, y, z)
                val identity = tileIdentityFor("tianditu", layer, z, x, y, if (datum == NativeRasterDatum.WGS84) "raster" else "raster-warp-${datum.name.lowercase()}")
                val imageFactory = if (datum == NativeRasterDatum.WGS84) {
                    RasterImageFactory(url, identity, viewId(), generation)
                } else {
                    NativeRasterImageFactory.tianditu(
                        network = checkNotNull(sharedNetwork) { "Explicit Tianditu datum correction requires the shared tile network" },
                        layer = layer, outputX = x, outputY = y, outputZoom = z, datum = datum,
                        tileUrl = ::tiandituUrl,
                        identity = identity,
                        rawIdentityFor = { rawX, rawY, rawZ -> tileIdentityFor("tianditu", layer, rawZ, rawX, rawY, "raster") },
                        viewId = viewId(), generation = generation,
                    )
                }
                return ImageSource.fromImageFactory(imageFactory)
            }
        }
        return MercatorTiledImageLayer.buildTiledSurfaceImage(factory, true, tileSize = 256, maxZoom = maxZoom, minZoom = 1).apply {
            // The SDK default is 1.0; leaving it here while the HIGH basemap is
            // 0.5 selects coarser annotation tiles and magnifies already-rasterized text.
            detailControl = this@TiandituRasterSource.detailControl
        }
    }

    private suspend fun fetch(url: String, renderedFactory: ImageSource.NetworkBoundImageFactory? = null, identity: TileRequestIdentity? = null, view: String? = null, generation: Long? = null): ByteArray {
        if (sharedNetwork != null) return sharedNetwork.fetch(url, renderedFactory = renderedFactory, identity = identity, viewId = view, generation = generation) ?: ByteArray(0)
        return requestPermits.withPermit { fetchOne(url) }
    }

    private fun decodeRasterBitmap(bytes: ByteArray): Bitmap {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        require(bounds.outWidth in 1..1024 && bounds.outHeight in 1..1024 && bounds.outWidth.toLong() * bounds.outHeight <= 1_048_576) { "地图注记图片尺寸无效" }
        return NativeTileStageTelemetry.measureDecode { BitmapFactory.decodeByteArray(bytes, 0, bytes.size) } ?: error("地图注记图片解码失败")
    }

    private inner class RasterImageFactory(private val url: String, private val identity: TileRequestIdentity?, private val view: String?, private val generation: () -> Long?) : ImageSource.NetworkBoundImageFactory {
        override suspend fun createCachedBitmap(): Bitmap? = withContext(Dispatchers.IO) {
            val bytes = sharedNetwork?.readCached(url, this@RasterImageFactory, identity, view, generation()) ?: return@withContext null
            decodeRasterBitmap(bytes)
        }

        override suspend fun createBitmap(): Bitmap? = withContext(Dispatchers.IO) {
            val bytes = fetch(url, this@RasterImageFactory, identity, view, generation())
            if (bytes.isEmpty()) return@withContext null
            decodeRasterBitmap(bytes)
        }

        override fun toString() = "TiandituRasterImageFactory"
        override fun equals(other: Any?): Boolean = other is TiandituRasterSource.RasterImageFactory &&
            this@TiandituRasterSource === other.outer() && (identity?.cacheKey ?: url) == (other.identity?.cacheKey ?: other.url)
        override fun hashCode(): Int = 31 * System.identityHashCode(this@TiandituRasterSource) + (identity?.cacheKey ?: url).hashCode()
        private fun outer(): TiandituRasterSource = this@TiandituRasterSource
    }

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
