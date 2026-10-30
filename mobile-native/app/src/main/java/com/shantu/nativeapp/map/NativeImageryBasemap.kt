package com.shantu.nativeapp.map

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Handler
import android.os.Looper
import earth.worldwind.WorldWindow
import earth.worldwind.layer.RenderableLayer
import earth.worldwind.layer.mercator.MercatorTileFactory
import earth.worldwind.layer.mercator.MercatorTiledImageLayer
import earth.worldwind.layer.mercator.MercatorTiledSurfaceImage
import earth.worldwind.render.image.ImageSource
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.time.LocalDate
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.atomic.AtomicReference
import java.util.concurrent.atomic.AtomicLong
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.math.floor
import kotlin.math.min
import kotlin.math.asinh
import kotlin.math.tan

data class NativeImageryStatus(
    val sourceId: String? = null,
    val ready: Boolean = false,
    val dateUtc: String? = null,
    val message: String = "",
    val attribution: String? = null,
)
private val NO_IMAGERY_STAGE_CALLBACK: () -> Unit = {}

/** Real imagery surfaces used beneath a selected map source. The overview is the original bundled z0-z5 set. */
class NativeImageryBasemap internal constructor(
    private val context: Context,
    private val window: WorldWindow,
    private val onStatus: (NativeImageryStatus) -> Unit = {},
    private val sharedNetwork: BoundedTileNetwork? = null,
    private val tileIdentityFor: (String, Int, Int, Int, String) -> TileRequestIdentity? = { _, _, _, _, _ -> null },
    private val viewId: () -> String? = { null },
    private val demandGeneration: () -> Long? = { null },
) : AutoCloseable {
    /** Insert below the normal map base; contains only the original low-resolution z0-z5 local imagery. */
    val underlayLayer = RenderableLayer("EOxCloudless low-resolution global underlay")
    /** Insert above the normal map base only for an explicit Sentinel/GIBS source selection. */
    val baseRenderLayer = RenderableLayer("Selected satellite imagery basemap")
    private val http = BoundedImageryHttp()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val main = Handler(Looper.getMainLooper())
    private var sourceId: String? = null
    private var underlay = false
    private var rasterZoomCap: Int? = null
    private var generation = 0
    private var closed = false
    @Volatile private var latestDate: String? = null
    private var latestCenterKey: String? = null
    private var latestCheckAt = 0L
    private var latestBusy = false
    private var latestJob: Job? = null
    private var currentStatus = NativeImageryStatus()
    private val renderedTileCount = AtomicLong()
    private val sentinelLoadedCallback: () -> Unit = { onSentinelTileLoaded() }
    private val viewportTick = object : Runnable {
        override fun run() {
            if (closed) return
            if (sourceId == "sentinel-latest" && !latestBusy) {
                val p = window.engine.camera.position
                val tile = satelliteProbeTile(p.longitude.inDegrees, p.latitude.inDegrees)
                val key = "${tile.z}/${tile.x}/${tile.y}"
                val elapsed = System.currentTimeMillis() - latestCheckAt
                if ((key != latestCenterKey && elapsed >= LATEST_VIEWPORT_COOLDOWN_MILLIS) || elapsed >= LATEST_RECHECK_MILLIS) beginLatestCheck(generation)
            }
            main.postDelayed(this, VIEWPORT_CHECK_MILLIS)
        }
    }

    private val overview = surface("EOxCloudless 2025 bundled overview z0-5", 5) { x, y, z ->
        ImageSource.fromImageFactory(object : ImageSource.NetworkBoundImageFactory {
            override suspend fun createCachedBitmap(): Bitmap? = readOverview(x, y, z)
            override suspend fun createBitmap(): Bitmap? = readOverview(x, y, z)
        })
    }
    init { underlayLayer.isEnabled = false; baseRenderLayer.isEnabled = false; main.postDelayed(viewportTick, VIEWPORT_CHECK_MILLIS) }

    /**
     * [baseSelectionAllowed] is true only when a complete imported workspace explicitly supplied
     * its basemap setting. A selected custom map source keeps precedence and can still use the
     * historical overview underneath, matching the browser map's behavior.
     */
    fun apply(requestedBase: String?, showOverview: Boolean, baseSelectionAllowed: Boolean, maxRasterZoom: Int? = null) {
        if (closed) return
        val desiredSource = if (baseSelectionAllowed && requestedBase != null) nativeImageryBaseSource(requestedBase) else sourceId
        val normalizedUnderlay = showOverview && desiredSource != "host"
        val desiredCap = when (desiredSource) {
            "sentinel-detail" -> maxRasterZoom?.coerceIn(0, 14)
            "sentinel-latest" -> maxRasterZoom?.coerceIn(0, 9)
            else -> null
        }
        if (desiredSource == sourceId && normalizedUnderlay == underlay && desiredCap == rasterZoomCap) return
        if (desiredSource != sourceId) {
            generation++
            latestJob?.cancel(); latestJob = null; latestBusy = false; latestDate = null
            sourceId = desiredSource
        }
        underlay = normalizedUnderlay
        rasterZoomCap = desiredCap
        val expected = generation
        underlayLayer.clearRenderables()
        baseRenderLayer.clearRenderables()
        if (underlay) underlayLayer.addRenderable(overview)
        val active = when (sourceId) {
            "sentinel-detail" -> surface("EOxCloudless Sentinel-2 2025", rasterZoomCap ?: 14) { x, y, z ->
                val url = SENTINEL_TILE.replace("{z}", z.toString()).replace("{y}", y.toString()).replace("{x}", x.toString())
                val identity = tileIdentityFor("sentinel-eox", z, x, y, "s2cloudless-2025-jpg")
                ImageSource.fromImageFactory(RemoteImageryFactory(http, url, sentinelLoadedCallback, sharedNetwork, identity, viewId(), demandGeneration))
            }.also { publish(NativeImageryStatus(sourceId, false, null, "Sentinel-2 2025 少云合成影像；非实时，等待瓦片", SENTINEL_ATTRIBUTION)) }
            "sentinel-latest" -> surface("NASA GIBS VIIRS latest available UTC day", rasterZoomCap ?: 9) { x, y, z ->
                val identity = tileIdentityFor("nasa-gibs-viirs", z, x, y, latestDate ?: "gibs-latest")
                ImageSource.fromImageFactory(LatestGibsTileFactory(x, y, z, identity))
            }.also { beginLatestCheck(expected) }
            else -> null
        }
        if (active != null) baseRenderLayer.addRenderable(active)
        if (sourceId != "sentinel-latest" && sourceId != "sentinel-detail") {
            publish(NativeImageryStatus(sourceId, underlay, null,
                when {
                    sourceId == "host" -> "底图由当前WorldWind图源提供"
                    underlay -> "显示低分辨率全球影像概览"
                    else -> ""
                }, if (underlay) EOX_ATTRIBUTION else null))
        }
        underlayLayer.isEnabled = underlay
        baseRenderLayer.isEnabled = active != null
        window.requestRedraw()
    }

    fun status(): NativeImageryStatus = currentStatus
    /** Successful imagery bitmap fetches for readiness checks; never includes capability/date probes. */
    fun renderedTileCount(): Long = renderedTileCount.get()

    private fun onSentinelTileLoaded() {
        renderedTileCount.incrementAndGet()
        main.post {
            if (!closed && sourceId == "sentinel-detail" && !currentStatus.ready) {
                publish(NativeImageryStatus("sentinel-detail", true, null, "Sentinel-2 2025 少云合成影像已加载；非实时", SENTINEL_ATTRIBUTION))
            }
        }
    }

    fun retryLatest() {
        if (closed || sourceId != "sentinel-latest" || latestBusy) return
        latestCheckAt = 0L; latestCenterKey = null; beginLatestCheck(generation)
    }

    private fun beginLatestCheck(requestGeneration: Int) {
        val cam = window.engine.camera.position
        val tile = satelliteProbeTile(cam.longitude.inDegrees, cam.latitude.inDegrees)
        val centerKey = "${tile.z}/${tile.x}/${tile.y}"
        val now = System.currentTimeMillis()
        if (latestBusy || centerKey == latestCenterKey && now - latestCheckAt < LATEST_RECHECK_MILLIS) return
        latestCenterKey = centerKey
        latestCheckAt = now
        latestDate = null
        latestBusy = true
        publish(NativeImageryStatus("sentinel-latest", false, null, "正在检查当前位置最新可用卫星影像", GIBS_ATTRIBUTION))
        latestJob = scope.launch {
            try {
                val chosen = resolveLatestDate(tile)
                if (closed || generation != requestGeneration) return@launch
                latestDate = chosen
                publish(if (chosen == null) NativeImageryStatus("sentinel-latest", false, null,
                    "近5日当前位置暂无可用影像；仅显示z0–5低分辨率概览", EOX_ATTRIBUTION)
                else NativeImageryStatus("sentinel-latest", true, chosen,
                    "当前位置最新可用 · VIIRS 真彩色 · 日期为 UTC", GIBS_ATTRIBUTION))
                window.requestRedraw()
            } catch (_: CancellationException) {
            } catch (_: Exception) {
                if (!closed && generation == requestGeneration) {
                    latestDate = null
                    publish(NativeImageryStatus("sentinel-latest", false, null,
                        "卫星日期或当前位置覆盖检查失败；仅显示z0–5低分辨率概览", EOX_ATTRIBUTION))
                }
            } finally {
                if (generation == requestGeneration) latestBusy = false
                val p = window.engine.camera.position
                val nowTile = satelliteProbeTile(p.longitude.inDegrees, p.latitude.inDegrees)
                val nowKey = "${nowTile.z}/${nowTile.x}/${nowTile.y}"
                if (!closed && generation == requestGeneration && sourceId == "sentinel-latest" && nowKey != latestCenterKey) beginLatestCheck(generation)
            }
        }
    }

    private suspend fun resolveLatestDate(tile: NativeSatelliteProbeTile): String? {
        val xml = http.fetch(GIBS_CAPABILITIES, MAX_CAPABILITIES_BYTES).toString(Charsets.UTF_8)
        val latestDay = parseGibsDefaultDate(xml)
        for (days in 0..4) {
            val candidate = latestDay.minusDays(days.toLong()).toString()
            val identity = tileIdentityFor("nasa-gibs-probe", tile.z, tile.x, tile.y, candidate) ?: return null
            val probeUrl = gibsImageTileUrl(candidate, tile.z, tile.x, tile.y)
            val bytes = sharedNetwork?.fetchProbe(probeUrl, identity, viewId(), demandGeneration())
                ?: if (sharedNetwork == null) http.fetch(probeUrl, MAX_IMAGERY_TILE_BYTES) else null
            val bitmap = bytes?.let(::decodeImageryTile) ?: continue
            val covered = try { hasSatelliteCoverage(bitmap, tile.pixelX, tile.pixelY) } finally { bitmap.recycle() }
            if (covered) return candidate
        }
        return null
    }

    private suspend fun fetchLatestTile(x: Int, y: Int, z: Int, identity: TileRequestIdentity?, view: String?, generation: Long?): Bitmap? {
        val date = latestDate ?: return null
        val url = gibsImageTileUrl(date, z, x, y)
        val data = sharedNetwork?.fetch(url, identity = identity, viewId = view, generation = generation)
            ?: if (sharedNetwork == null) http.fetch(url, MAX_IMAGERY_TILE_BYTES) else null
        return data?.let(::decodeImageryTile)?.also { renderedTileCount.incrementAndGet() }
    }

    private fun readOverview(x: Int, y: Int, z: Int): Bitmap? {
        if (z !in 0..5 || x !in 0 until (1 shl z) || y !in 0 until (1 shl z)) return null
        return runCatching { context.assets.open("basemaps/satellite-overview-v1/$z/$x/$y.jpg").use { BitmapFactory.decodeStream(it) } }.getOrNull()
    }

    private fun surface(name: String, maxZoom: Int, source: (x: Int, y: Int, z: Int) -> ImageSource): MercatorTiledSurfaceImage {
        val factory = object : MercatorTileFactory {
            override val contentType = name
            override fun getImageSource(x: Int, y: Int, z: Int): ImageSource = source(x, y, z)
        }
        return MercatorTiledImageLayer.buildTiledSurfaceImage(factory, true, minZoom = 0, maxZoom = maxZoom, tileSize = 256)
    }

    private fun publish(status: NativeImageryStatus) { currentStatus = status; onStatus(status) }

    override fun close() {
        if (closed) return
        closed = true; generation++; main.removeCallbacks(viewportTick); scope.cancel(); http.close()
        underlayLayer.clearRenderables(); baseRenderLayer.clearRenderables()
        underlayLayer.isEnabled = false; baseRenderLayer.isEnabled = false; latestDate = null
    }

    private class RemoteImageryFactory(private val http: BoundedImageryHttp, private val url: String, private val onLoaded: () -> Unit, private val network: BoundedTileNetwork?, private val identity: TileRequestIdentity?, private val view: String?, private val generation: () -> Long?) : ImageSource.NetworkBoundImageFactory {
        override suspend fun createCachedBitmap(): Bitmap? = null
        override suspend fun createBitmap(): Bitmap? {
            val bytes = network?.fetch(url, identity = identity, viewId = view, generation = generation())
                ?: if (network == null) http.fetch(url, MAX_IMAGERY_TILE_BYTES) else null
            return bytes?.let(::decodeImageryTile)?.also { onLoaded() }
        }

        override fun toString() = "SatelliteRasterImageFactory"
        private fun stableKey() = NativeImageSourceIdentity(network ?: http, http, identity, url, onLoaded, NO_IMAGERY_STAGE_CALLBACK, NO_IMAGERY_STAGE_CALLBACK, generation)
        override fun equals(other: Any?) = other is RemoteImageryFactory && stableKey() == other.stableKey()
        override fun hashCode() = stableKey().hashCode()
    }

    private inner class LatestGibsTileFactory(private val x: Int, private val y: Int, private val z: Int, private val identity: TileRequestIdentity?) : ImageSource.NetworkBoundImageFactory {
        override suspend fun createCachedBitmap(): Bitmap? = null
        override suspend fun createBitmap(): Bitmap? = fetchLatestTile(x, y, z, identity, viewId(), demandGeneration())
        override fun toString() = "GibsLatestTileFactory"
        private fun stableKey() = NativeImageSourceIdentity(sharedNetwork ?: this@NativeImageryBasemap, this@NativeImageryBasemap,
            identity, "$z/$x/$y", NO_IMAGERY_STAGE_CALLBACK, NO_IMAGERY_STAGE_CALLBACK, NO_IMAGERY_STAGE_CALLBACK, demandGeneration)
        override fun equals(other: Any?) = other is NativeImageryBasemap.LatestGibsTileFactory && stableKey() == other.stableKey()
        override fun hashCode() = stableKey().hashCode()
    }

    companion object {
        const val EOX_ATTRIBUTION = "EOxCloudless by EOX IT Services GmbH · Contains modified Copernicus Sentinel data 2025 · CC BY-NC-SA 4.0"
        const val SENTINEL_ATTRIBUTION = "EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2025) · CC BY-NC-SA 4.0"
        const val GIBS_ATTRIBUTION = "NASA GIBS / VIIRS Suomi NPP · Worldview Earthdata"
        private const val SENTINEL_TILE = "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg"
        private const val GIBS_CAPABILITIES = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml"
        private const val MAX_IMAGERY_TILE_BYTES = 4 * 1024 * 1024
        private const val MAX_CAPABILITIES_BYTES = 4 * 1024 * 1024
        private const val MAX_PIXELS = 1_048_576L
        private const val LATEST_RECHECK_MILLIS = 15 * 60 * 1000L
        private const val LATEST_VIEWPORT_COOLDOWN_MILLIS = 30 * 1000L
        private const val VIEWPORT_CHECK_MILLIS = 5 * 1000L
    }
}

internal data class NativeSatelliteProbeTile(val z: Int, val x: Int, val y: Int, val pixelX: Double, val pixelY: Double)

/** Offline vector packages remain owned by the host/source layer; this imagery layer must not erase that base. */
internal fun nativeImageryBaseSource(requestedBase: String): String = if (requestedBase == "offline") "host" else requestedBase

internal fun satelliteProbeTile(lon: Double, lat: Double, z: Int = 8): NativeSatelliteProbeTile {
    require(lon.isFinite() && lon in -180.0..180.0 && lat.isFinite() && lat in -90.0..90.0 && z in 0..9)
    val n = 1 shl z; val safeLat = lat.coerceIn(-80.0, 80.0)
    val xf = (lon + 180) / 360 * n
    val rad = Math.toRadians(safeLat)
    val yf = (1 - asinh(tan(rad)) / Math.PI) / 2 * n
    val x = floor(xf).toInt().coerceIn(0, n - 1); val y = floor(yf).toInt().coerceIn(0, n - 1)
    return NativeSatelliteProbeTile(z, x, y, (xf % 1) * 256, (yf % 1) * 256)
}

internal fun parseGibsDefaultDate(xml: String): LocalDate {
    require(xml.length <= 4 * 1024 * 1024)
    val start = xml.indexOf("<ows:Identifier>VIIRS_SNPP_CorrectedReflectance_TrueColor</ows:Identifier>")
    require(start >= 0) { "Satellite layer unavailable" }
    val end = xml.indexOf("</Layer>", start)
    require(end > start) { "Satellite metadata unavailable" }
    val defaultDate = Regex("<Default>(\\d{4}-\\d{2}-\\d{2})</Default>")
        .find(xml.substring(start, end))?.groupValues?.get(1) ?: error("Satellite date unavailable")
    return LocalDate.parse(defaultDate)
}

internal fun gibsImageTileUrl(date: String, z: Int, x: Int, y: Int): String {
    require(LocalDate.parse(date).toString() == date && z in 0..9 && x in 0 until (1 shl z) && y in 0 until (1 shl z))
    return "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/$date/GoogleMapsCompatible_Level9/$z/$y/$x.jpeg"
}

internal fun hasSatelliteCoverage(bitmap: Bitmap, px: Double, py: Double): Boolean {
    if (bitmap.width != 256 || bitmap.height != 256 || !px.isFinite() || !py.isFinite()) return false
    val left = (px.toInt() - 8).coerceIn(0, 240); val top = (py.toInt() - 8).coerceIn(0, 240)
    var valid = 0
    for (y in top until top + 16) for (x in left until left + 16) {
        val c = bitmap.getPixel(x, y)
        if (((c shr 16) and 255) + ((c shr 8) and 255) + (c and 255) > 35) valid++
    }
    return valid > 128
}

private fun decodeImageryTile(bytes: ByteArray): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outWidth != 256 || bounds.outHeight != 256 || bounds.outWidth.toLong() * bounds.outHeight > 1_048_576L) return null
    return NativeTileStageTelemetry.measureDecode { BitmapFactory.decodeByteArray(bytes, 0, bytes.size) }
}

private class BoundedImageryHttp : AutoCloseable {
    private val executor: ExecutorService = Executors.newFixedThreadPool(4)
    private val connections = ConcurrentHashMap.newKeySet<HttpURLConnection>()
    @Volatile private var closed = false

    suspend fun fetch(url: String, limit: Int): ByteArray {
        val policy = NativeOfflineDisplayPolicy.snapshot()
        if (policy.enabled) {
            val bytes = NativeOfflineDisplayPolicy.readSelectedCache(url) ?: return ByteArray(0)
            return bytes.takeIf { it.size <= limit } ?: ByteArray(0)
        }
        return suspendCancellableCoroutine { cont ->
        check(!closed)
        val connection = AtomicReference<HttpURLConnection?>(); val future = AtomicReference<Future<*>?>()
        val task = executor.submit {
            try {
                val c = URL(url).openConnection() as HttpURLConnection
                connection.set(c)
                if (!cont.isActive || Thread.currentThread().isInterrupted) { c.disconnect(); throw CancellationException("request cancelled") }
                connections += c
                c.instanceFollowRedirects = false; c.connectTimeout = 12_000; c.readTimeout = 15_000
                check(c.responseCode in 200..299) { "Imagery service unavailable" }
                val declared = c.getHeaderFieldLong("Content-Length", -1L)
                check(declared == -1L || declared in 0..limit.toLong()) { "Imagery response exceeds limit" }
                val body = c.inputStream.use { readBounded(it, limit) }
                if (cont.isActive) cont.resume(body)
            } catch (e: CancellationException) { if (cont.isActive) cont.resumeWithException(e) }
            catch (_: Exception) { if (cont.isActive) cont.resumeWithException(IllegalStateException("卫星影像服务读取失败")) }
            finally { connection.get()?.let { connections.remove(it); it.disconnect() } }
        }
        future.set(task)
        if (!cont.isActive) task.cancel(true)
        cont.invokeOnCancellation { connection.get()?.disconnect(); future.get()?.cancel(true) }
        }
    }

    private fun readBounded(input: java.io.InputStream, limit: Int): ByteArray {
        val out = ByteArrayOutputStream(min(limit, 32 * 1024)); val buffer = ByteArray(8192); var total = 0
        while (true) {
            if (Thread.currentThread().isInterrupted) throw CancellationException("request cancelled")
            val count = input.read(buffer, 0, min(buffer.size, limit - total + 1))
            if (count < 0) break
            total += count; check(total <= limit) { "Imagery response exceeds limit" }; out.write(buffer, 0, count)
        }
        return out.toByteArray()
    }

    override fun close() {
        if (closed) return
        closed = true; connections.toList().forEach(HttpURLConnection::disconnect); executor.shutdownNow()
    }
}
