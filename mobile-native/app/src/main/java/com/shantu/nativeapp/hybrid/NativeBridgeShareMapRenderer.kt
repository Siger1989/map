package com.shantu.nativeapp.hybrid

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.os.Handler
import android.os.Looper
import android.view.PixelCopy
import android.view.SurfaceView
import android.view.View
import android.widget.FrameLayout
import com.shantu.nativeapp.map.NativeCameraSnapshot
import com.shantu.nativeapp.map.NativeMapController
import com.shantu.nativeapp.map.NativeMapQuality
import com.shantu.nativeapp.map.NativeMapSourceCatalog
import com.shantu.nativeapp.map.NativePositionState
import com.shantu.nativeapp.map.TileNetworkSnapshot
import com.shantu.nativeapp.navigation.NativeCoordinate
import com.shantu.nativeapp.navigation.NativeRouteViewport
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import kotlin.coroutines.resume

/** One-shot native print map. It never borrows or mutates the visible primary/secondary camera. */
internal class NativeBridgeShareMapRenderer(
    context: Context,
    private val root: FrameLayout,
    private val tiandituKey: String,
    private val resolveSource: (JSONObject) -> JSONObject,
    private val geologyCredentials: com.shantu.nativeapp.geology.NativeGeologyCredentials? = null,
) : AutoCloseable {
    private val appContext = context.applicationContext
    private val main = Handler(Looper.getMainLooper())
    private var controller: NativeMapController? = null
    private var container: FrameLayout? = null
    private var overlays: NativeBridgeOverlayRenderer? = null
    private var closed = false

    suspend fun render(payload: JSONObject): JSONObject {
        check(Looper.myLooper() == Looper.getMainLooper()) { "Share map setup must start on main" }
        val width = payload.optInt("width", DEFAULT_WIDTH).coerceIn(320, MAX_WIDTH)
        val height = payload.optInt("height", DEFAULT_HEIGHT).coerceIn(320, MAX_HEIGHT)
        val state = payload.optJSONObject("state") ?: throw IllegalArgumentException("分享地图状态缺失")
        val settings = state.optJSONObject("settings") ?: JSONObject()
        val frame = FrameLayout(appContext).apply {
            clipChildren = true
            clipToPadding = true
            alpha = 0f // The attached SurfaceView still renders and PixelCopy reads its native buffer.
            isClickable = false
            isFocusable = false
        }
        val map = NativeMapController(appContext, tiandituKey) { }
        // Match the bridge host's actual camera/FOV contract before fitting the print viewport.
        map.configureBridgeCameraScale()
        map.enableBridgePrintRasterFrameCoverage()
        val scene = NativeBridgeOverlayRenderer(map.worldWindowForBridge(), suppressShareTrackPaths = true)
        map.addBridgeOverlayLayer(scene.layer)
        controller = map; container = frame; overlays = scene
        frame.addView(map.view, FrameLayout.LayoutParams(width, height))
        root.addView(frame, 0, FrameLayout.LayoutParams(width, height))
        map.onResume()
        probeLog("setup_attached", "width=$width height=$height alpha=${frame.alpha} surface=${map.view.javaClass.simpleName}")

        configureSource(map, state.optJSONObject("mapSource"), settings)
        map.setTerrain(false)
        map.setTerrainOverlay(
            contoursEnabled = settings.optBoolean("contours"),
            elevationColorsEnabled = settings.optBoolean("elevationColors"),
            contourIntervalMeters = settings.optInt("contourInterval", 30),
            elevationColorsOpacity = settings.optDouble("elevationColorsOpacity", 1.0),
        )
        map.configureGeology(
            com.shantu.nativeapp.geology.NativeGeologyCredentialProvider { geologyCredentials },
        ) { }
        map.setGeology(
            settings.optBoolean("geologyEnabled", settings.optBoolean("geology")),
            if (settings.optString("geologySource", "world") == "geocloud20w") com.shantu.nativeapp.geology.NativeGeologySource.GEO_CLOUD_200K
            else com.shantu.nativeapp.geology.NativeGeologySource.WORLD,
            settings.optDouble("geologyOpacity", .85),
        )
        map.setPosition(NativePositionState(null, System.currentTimeMillis()))
        map.setQuality(if (settings.optString("rasterQuality", "high") == "standard") NativeMapQuality.STANDARD else NativeMapQuality.HIGH)
        val vectorTilesRequired = configureCartography(map, settings, state.optJSONObject("mapSource"))
        val sourceId = com.shantu.nativeapp.map.NativeCartographySelection.sourceId(
            hasCustomSource = state.optJSONObject("mapSource")?.has("id") == true,
            offlineBasemap = settings.optBoolean("offlineBasemap"),
            satellite = settings.optBoolean("satellite", false),
            satelliteProvider = settings.optString("satelliteProvider", "sentinel"),
            imageryMode = settings.optString("imageryMode", "detail"),
            tiandituBase = settings.optString("tiandituBase", if (settings.optBoolean("satellite")) "img" else "vec"),
            tiandituConfigured = tiandituKey.isNotBlank(),
        )
        val networkBaseline = map.loadingSnapshot()
        val imageryBaseline = map.cartographyForBridge().imageryRenderedTileCount()
        val rasterBaseline = map.bridgeRasterTileSnapshot()
        val requireRasterFrameCoverage = NativeBridgeShareLayerPolicy.requiresMercatorLeafCoverage(
            sourceId,
            state.optJSONObject("mapSource")?.optString("kind", "online")?.lowercase(),
        )

        // Share rendering is intentionally scoped to the requested track geometry and markers;
        // saved routes, areas, and annotations from the current map are not part of the share.
        val renderables = payload.optJSONArray("markers") ?: JSONArray()
        for (i in 0 until renderables.length()) {
            val annotation = renderables.optJSONObject(i) ?: continue
            if (annotation.optBoolean("visible", true)) map.renderMarker(annotation)
        }
        payload.optJSONObject("geometry")?.let(scene::sync)

        val bounds = parseNativeShareFitBounds(payload.optJSONArray("bounds") ?: throw IllegalArgumentException("分享范围缺失"))
        val corners = listOf(
            NativeCoordinate(bounds[0], bounds[1]), NativeCoordinate(bounds[2], bounds[1]),
            NativeCoordinate(bounds[2], bounds[3]), NativeCoordinate(bounds[0], bounds[3]),
        )
        val fit = NativeShareCameraFitPolicy.applyMaxZoom(
            NativeRouteViewport.fit(corners, map.cameraSnapshot().copy(pitchDegrees = 0.0, headingDegrees = 0.0), width, height),
            height,
        )
        map.restoreCamera(fit.copy(pitchDegrees = 0.0, headingDegrees = 0.0, rollDegrees = 0.0))
        // Keep note visibility aligned with the live overlay's zoom thresholds.
        scene.setZoom(kotlin.math.log2(
            NativeShareCameraFitPolicy.rangeAtZoom(0.0, fit.latitude, height) / fit.rangeMeters,
        ))

        val firstFrame = CompletableDeferred<Unit>()
        map.setBridgeFrameListener { _, _, _ -> if (!firstFrame.isCompleted) firstFrame.complete(Unit) }
        map.view.requestLayout()
        withContext(Dispatchers.Main.immediate) { frame.requestLayout(); frame.invalidate(); map.view.requestLayout() }
        val firstFrameStarted = android.os.SystemClock.elapsedRealtime()
        try {
            firstFrame.awaitBounded(FRAME_TIMEOUT_MS)
            probeLog("first_frame", "elapsedMs=${android.os.SystemClock.elapsedRealtime() - firstFrameStarted}")
        } catch (timeout: kotlinx.coroutines.TimeoutCancellationException) {
            probeLog("first_frame_timeout", "elapsedMs=${android.os.SystemClock.elapsedRealtime() - firstFrameStarted}")
            throw timeout
        } catch (cancelled: CancellationException) {
            probeLog("first_frame_cancelled", "elapsedMs=${android.os.SystemClock.elapsedRealtime() - firstFrameStarted}")
            throw cancelled
        }
        val sourceReadyStarted = android.os.SystemClock.elapsedRealtime()
        val frameCoverageGate = try {
            awaitSourceReady(map, sourceId, bounds.toList(), networkBaseline, imageryBaseline, rasterBaseline,
                vectorTilesRequired, requireRasterFrameCoverage)
        } catch (cancelled: CancellationException) {
            probeLog("source_ready_cancelled", "elapsedMs=${android.os.SystemClock.elapsedRealtime() - sourceReadyStarted}")
            throw cancelled
        }
        // Require real texture convergence again after the final render, immediately before capture.
        val finalFrameStarted = android.os.SystemClock.elapsedRealtime()
        try {
            awaitFinalFrame(map, bounds.toList(), vectorTilesRequired, requireRasterFrameCoverage, frameCoverageGate)
            val rasterFrame = map.bridgePrintRasterFrameSnapshot()
            val mvtTiles = if (vectorTilesRequired) map.cartographyForBridge().cachedSnapTiles(bounds.toList())?.size ?: 0 else 0
            if (requireRasterFrameCoverage && (!rasterFrame.complete || !frameCoverageGate.isReady() ||
                    (vectorTilesRequired && mvtTiles <= 0))) {
                throw IllegalStateException("分享地图最终帧的可见底图纹理未收敛")
            }
            probeLog("final_frame", "elapsedMs=${android.os.SystemClock.elapsedRealtime() - finalFrameStarted} " +
                "drawFrame=${rasterFrame.sequence} visibleLeaves=${rasterFrame.visibleLeafCount} texturedLeaves=${rasterFrame.texturedLeafCount} " +
                "missingLeaves=${rasterFrame.missingLeafCount} maxLevel=${rasterFrame.visibleMaxLevel} visibleLevels=${rasterFrame.visibleLeafLevels} texturedLevels=${rasterFrame.texturedLeafLevels} " +
                "textureCache=${rasterFrame.textureCacheUsedBytes}/${rasterFrame.textureCacheCapacityBytes} entries=${rasterFrame.textureCacheEntries} mvtTiles=$mvtTiles")
        } catch (timeout: kotlinx.coroutines.TimeoutCancellationException) {
            probeLog("final_frame_timeout", "elapsedMs=${android.os.SystemClock.elapsedRealtime() - finalFrameStarted}")
            throw timeout
        } catch (cancelled: CancellationException) {
            probeLog("final_frame_cancelled", "elapsedMs=${android.os.SystemClock.elapsedRealtime() - finalFrameStarted}")
            throw cancelled
        }
        val pixelCopyStarted = android.os.SystemClock.elapsedRealtime()
        probeLog("pixel_copy_start", "width=$width height=$height")
        val bitmap = try {
            pixelCopy(map.view, width, height)
        } catch (cancelled: CancellationException) {
            probeLog("pixel_copy_cancelled", "elapsedMs=${android.os.SystemClock.elapsedRealtime() - pixelCopyStarted}")
            throw cancelled
        } catch (failure: Exception) {
            probeLog("pixel_copy_failed", "elapsedMs=${android.os.SystemClock.elapsedRealtime() - pixelCopyStarted}")
            throw failure
        }
        probeLog("pixel_copy", "elapsedMs=${android.os.SystemClock.elapsedRealtime() - pixelCopyStarted}")
        withContext(Dispatchers.Main.immediate) {
            drawShareTrackStrokes(bitmap, map, payload.optJSONObject("geometry")?.optJSONObject("tracks"))
        }
        require(hasVisibleFrameContent(bitmap)) { bitmap.recycle(); "分享地图帧没有可见渲染内容" }
        val bytes = ByteArrayOutputStream().use { out -> bitmap.compress(Bitmap.CompressFormat.JPEG, 90, out); out.toByteArray() }
        bitmap.recycle()
        require(bytes.size <= MAX_IMAGE_BYTES) { "分享地图图片过大" }

        val terminalJson = JSONArray()
        val terminals = payload.optJSONArray("terminals") ?: JSONArray()
        for (i in 0 until terminals.length()) {
            val terminal = terminals.optJSONObject(i) ?: continue
            val point = terminal.optJSONArray("point") ?: continue
            val lon = point.optDouble(0, Double.NaN); val lat = point.optDouble(1, Double.NaN)
            if (!lon.isFinite() || !lat.isFinite() || lat !in -90.0..90.0 || lon !in -180.0..180.0) continue
            val projected = map.projectCoordinate(lat, lon) ?: continue
            val attribution = map.currentSource()?.attribution.orEmpty()
            terminalJson.put(JSONObject().put("name", terminal.optString("name")).put("label", terminal.optString("label"))
                .put("color", terminal.optString("color")).put("x", projected.first).put("y", projected.second).put("attribution", attribution))
        }
        val attribution = buildList {
            map.currentSource()?.attribution?.takeIf(String::isNotBlank)?.let(::add)
            NativeBridgeShareAttribution.from(settings, state.optJSONObject("mapSource"))?.let(::add)
        }.distinct().joinToString(" · ")
        return JSONObject().put("dataUrl", "data:image/jpeg;base64," + android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP))
            .put("width", width).put("height", height).put("terminals", terminalJson).put("attribution", attribution)
    }

    private fun configureSource(map: NativeMapController, sourceJson: JSONObject?, settings: JSONObject) {
        if (sourceJson != null && sourceJson.has("id")) {
            val source = NativeMapSourceCatalog.fromJson(JSONObject().put("maps", JSONArray().put(resolveSource(sourceJson)))).sources.singleOrNull()
                ?: throw IllegalArgumentException("分享图源无效")
            map.setCustomSource(source)
        }
    }

    private fun configureCartography(map: NativeMapController, settings: JSONObject, source: JSONObject?): Boolean {
        val custom = source != null
        val selectedBase = settings.optString("tiandituBase", if (settings.optBoolean("satellite", false)) "img" else "vec")
        val mapSourceId = com.shantu.nativeapp.map.NativeCartographySelection.sourceId(
            hasCustomSource = custom,
            offlineBasemap = settings.optBoolean("offlineBasemap"),
            satellite = settings.optBoolean("satellite", false),
            satelliteProvider = settings.optString("satelliteProvider", "sentinel"),
            imageryMode = settings.optString("imageryMode", "detail"),
            tiandituBase = selectedBase,
            tiandituConfigured = tiandituKey.isNotBlank(),
        )
        val tdt = mapSourceId.startsWith("tianditu-") && !settings.optBoolean("offlineBasemap")
        if (!custom && tdt) {
            val nativeSource = when (mapSourceId) {
                "tianditu-vector" -> NativeMapController.SOURCE_VECTOR
                "tianditu-terrain" -> NativeMapController.SOURCE_TERRAIN
                else -> NativeMapController.SOURCE_IMAGERY
            }
            map.setSource(nativeSource)
        } else if (!custom) map.setLegacyRasterLayersVisible(false)
        map.setLegacyRasterLayersVisible(custom || tdt)
        val cartography = com.shantu.nativeapp.map.NativeCartographySettings(
            roads = settings.optBoolean("roadsEnabled", settings.optBoolean("roads")),
            labels = settings.optBoolean("labelsEnabled", settings.optBoolean("labels", true)),
            roadsOpacity = settings.optDouble("roadsOpacity", 1.0).toFloat(),
            rasterLabelOpacity = settings.optDouble("roadsOpacity", 1.0).coerceIn(0.0, 1.0).toFloat(),
            satellite = settings.optBoolean("satelliteEnabled", settings.optBoolean("satellite")),
            satelliteProvider = settings.optString("satelliteProvider", "sentinel"),
            imageryMode = settings.optString("imageryMode", "detail"),
            tiandituBase = selectedBase,
            tiandituLabels = settings.optString("tiandituLabels", "vector"),
            tiandituBoundaries = settings.optBoolean("tiandituBoundaries"),
            offlineBasemap = settings.optBoolean("offlineBasemap"),
            sourceId = if (custom) "custom" else mapSourceId,
        )
        val effectivePlan = com.shantu.nativeapp.map.NativeCartographyPlan.resolve(
            if (custom) cartography.copy(sourceId = "custom") else cartography,
        )
        val labelsVisible = settings.optBoolean("labelsEnabled", settings.optBoolean("labels", true))
        val roadsOpacity = settings.optDouble("roadsOpacity", 1.0).coerceIn(0.0, 1.0)
        map.setRasterLabelOpacity(NativeBridgeShareLayerPolicy.legacyRasterLabelOpacity(custom, labelsVisible, roadsOpacity))
        val explicit = custom || mapSourceId != "terrain"
        val level = settings.opt("rasterLevel")?.takeUnless { it == JSONObject.NULL }?.let { (it as? Number)?.toInt() }
        val offlineMax = settings.opt("offlineMaxZoom")?.takeUnless { it == JSONObject.NULL }?.let { (it as? Number)?.toInt() }
        val bounds = when {
            tdt -> 1 to 19
            custom -> map.currentCustomSource()?.let { it.minZoom to it.maxZoom } ?: (0 to 24)
            mapSourceId == "sentinel-latest" -> 0 to 9
            mapSourceId == "sentinel-detail" -> 0 to 14
            else -> null
        }
        val effectiveCap = bounds?.let { (minZoom, maxZoom) ->
            com.shantu.nativeapp.map.NativeRasterZoomPolicy.resolve(level, offlineMax, minZoom, maxZoom)
        }
        map.setFixedRasterZoom(effectiveCap)
        map.configureCartography(cartography, custom, explicit, effectiveCap)
        return NativeShareReadinessPolicy.requiresVisibleMvt(effectivePlan)
    }

    private suspend fun awaitSourceReady(
        map: NativeMapController,
        sourceId: String,
        bounds: List<Double>,
        baseline: TileNetworkSnapshot,
        imageryBaseline: Long,
        rasterBaseline: Long,
        vectorTilesRequired: Boolean,
        requireRasterFrameCoverage: Boolean,
    ): NativeShareFrameCoverageGate {
        var quietSince = 0L
        var lastRasterDelta = Long.MIN_VALUE
        var lastImageryDelta = Long.MIN_VALUE
        var lastMvtTiles = -1
        val frameCoverageGate = NativeShareFrameCoverageGate()
        var redrawRequestedForCoverageFrame = -1L
        val started = android.os.SystemClock.elapsedRealtime()
        var lastProbeAt = started
        probeLog("source_ready_wait", "source=$sourceId")
        while (android.os.SystemClock.elapsedRealtime() - started < NETWORK_IDLE_TIMEOUT_MS) {
            kotlinx.coroutines.currentCoroutineContext().ensureActive()
            val snapshot = map.loadingSnapshot()
            // Shared pool activity includes the visible maps and DEM work. It is telemetry only;
            // the source/generation-local counter below owns this renderer's readiness decision.
            val pendingSourceLoads = map.bridgeRasterPendingLoads()
            val currentImagery = map.cartographyForBridge().imageryRenderedTileCount()
            val rasterTileDelta = map.bridgeRasterTileSnapshot() - rasterBaseline
            val mvtSnapshot = if (vectorTilesRequired) map.cartographyForBridge().cachedSnapTiles(bounds).orEmpty() else emptyList()
            val mvtTiles = mvtSnapshot.size
            val mvtSignature = mvtSnapshot.asSequence().map { "${it.z}/${it.x}/${it.y}" }.sorted().joinToString(";")
            val rasterFrame = map.bridgePrintRasterFrameSnapshot()
            var stableRasterFrames = frameCoverageGate.stableFrameCount()
            map.bridgePrintRasterFrameSnapshotsAfter(frameCoverageGate.lastObservedSequence()).forEach { frame ->
                stableRasterFrames = frameCoverageGate.observe(frame, supplementalSignature = mvtSignature)
            }
            if (requireRasterFrameCoverage && rasterFrame.complete && !frameCoverageGate.isReady() &&
                rasterFrame.sequence > 0 && rasterFrame.sequence != redrawRequestedForCoverageFrame) {
                map.worldWindowForBridge().requestRedraw()
                redrawRequestedForCoverageFrame = rasterFrame.sequence
            }
            val sourceReady = NativeShareReadinessPolicy.isReady(
                sourceId = sourceId,
                satelliteReady = map.satelliteStatus().ready,
                imageryTileDelta = currentImagery - imageryBaseline,
                visibleMvtTiles = mvtTiles,
                roadsRequired = vectorTilesRequired,
                firstFrameRendered = true,
                sourceRasterTileDelta = rasterTileDelta,
                pendingSourceLoads = pendingSourceLoads,
            ) && (!requireRasterFrameCoverage || frameCoverageGate.isReady())
            val imageryDelta = currentImagery - imageryBaseline
            if (rasterTileDelta != lastRasterDelta || imageryDelta != lastImageryDelta || mvtTiles != lastMvtTiles) {
                quietSince = 0L
                lastRasterDelta = rasterTileDelta
                lastImageryDelta = imageryDelta
                lastMvtTiles = mvtTiles
            }
            val now = android.os.SystemClock.elapsedRealtime()
            if (now - lastProbeAt >= PROBE_NETWORK_LOG_INTERVAL_MS) {
                probeLog(
                    "source_ready_poll",
                    "source=$sourceId elapsedMs=${now - started} active=${snapshot.activeNetworkRequests} queued=${snapshot.queuedNetworkRequests} " +
                        "sharedSuccessDelta=${snapshot.successes - baseline.successes} sharedErrorDelta=${snapshot.errors - baseline.errors} " +
                        "imageryDelta=$imageryDelta rasterDelta=$rasterTileDelta pendingSource=$pendingSourceLoads " +
                        "drawFrame=${rasterFrame.sequence} visibleLeaves=${rasterFrame.visibleLeafCount} texturedLeaves=${rasterFrame.texturedLeafCount} " +
                        "missingLeaves=${rasterFrame.missingLeafCount} maxLevel=${rasterFrame.visibleMaxLevel} visibleLevels=${rasterFrame.visibleLeafLevels} texturedLevels=${rasterFrame.texturedLeafLevels} stableFrames=$stableRasterFrames " +
                        "textureCache=${rasterFrame.textureCacheUsedBytes}/${rasterFrame.textureCacheCapacityBytes} entries=${rasterFrame.textureCacheEntries} " +
                        "mvtTiles=$mvtTiles ready=$sourceReady",
                )
                lastProbeAt = now
            }
            if (sourceReady) {
                if (requireRasterFrameCoverage) {
                    probeLog(
                        "source_ready",
                        "source=$sourceId elapsedMs=${android.os.SystemClock.elapsedRealtime() - started} " +
                            "imageryDelta=$imageryDelta rasterDelta=$rasterTileDelta pendingSource=$pendingSourceLoads " +
                            "drawFrame=${rasterFrame.sequence} visibleLeaves=${rasterFrame.visibleLeafCount} texturedLeaves=${rasterFrame.texturedLeafCount} " +
                            "missingLeaves=${rasterFrame.missingLeafCount} visibleLevels=${rasterFrame.visibleLeafLevels} texturedLevels=${rasterFrame.texturedLeafLevels} stableFrames=$stableRasterFrames " +
                            "textureCache=${rasterFrame.textureCacheUsedBytes}/${rasterFrame.textureCacheCapacityBytes} entries=${rasterFrame.textureCacheEntries} mvtTiles=$mvtTiles",
                    )
                    return frameCoverageGate
                }
                if (quietSince == 0L) quietSince = android.os.SystemClock.elapsedRealtime()
                if (android.os.SystemClock.elapsedRealtime() - quietSince >= NETWORK_QUIET_WINDOW_MS) {
                    probeLog(
                        "source_ready",
                        "source=$sourceId elapsedMs=${android.os.SystemClock.elapsedRealtime() - started} " +
                            "imageryDelta=$imageryDelta rasterDelta=$rasterTileDelta pendingSource=$pendingSourceLoads " +
                            "drawFrame=${rasterFrame.sequence} visibleLeaves=${rasterFrame.visibleLeafCount} texturedLeaves=${rasterFrame.texturedLeafCount} " +
                        "missingLeaves=${rasterFrame.missingLeafCount} visibleLevels=${rasterFrame.visibleLeafLevels} texturedLevels=${rasterFrame.texturedLeafLevels} stableFrames=$stableRasterFrames mvtTiles=$mvtTiles",
                    )
                    return frameCoverageGate
                }
            } else quietSince = 0L
            delay(NETWORK_POLL_MS)
        }
        val final = map.loadingSnapshot()
        probeLog(
            "source_ready_timeout",
            "source=$sourceId elapsedMs=${android.os.SystemClock.elapsedRealtime() - started} active=${final.activeNetworkRequests} " +
                "queued=${final.queuedNetworkRequests} sharedSuccessDelta=${final.successes - baseline.successes} " +
                "sharedErrorDelta=${final.errors - baseline.errors} imageryDelta=${map.cartographyForBridge().imageryRenderedTileCount() - imageryBaseline} " +
                "rasterDelta=${map.bridgeRasterTileSnapshot() - rasterBaseline} pendingSource=${map.bridgeRasterPendingLoads()}",
        )
        throw IllegalStateException("分享地图当前图源仍有待加载内容")
    }

    /** Wait for a real frame and revalidate its own visible leaf textures immediately before capture. */
    private suspend fun awaitFinalFrame(
        map: NativeMapController,
        bounds: List<Double>,
        vectorTilesRequired: Boolean,
        requireRasterFrameCoverage: Boolean,
        coverageGate: NativeShareFrameCoverageGate,
    ) = kotlinx.coroutines.withTimeout(FRAME_TIMEOUT_MS) {
        while (true) {
            val rendered = CompletableDeferred<Unit>()
            withContext(Dispatchers.Main.immediate) {
                map.setBridgeFrameListener { _, _, _ -> if (!rendered.isCompleted) rendered.complete(Unit) }
                map.view.requestLayout()
                map.view.invalidate()
                map.worldWindowForBridge().requestRedraw()
            }
            rendered.await()
            if (!requireRasterFrameCoverage) return@withTimeout

            val mvtSnapshot = if (vectorTilesRequired) map.cartographyForBridge().cachedSnapTiles(bounds).orEmpty() else emptyList()
            val mvtTiles = mvtSnapshot.size
            val mvtSignature = mvtSnapshot.asSequence().map { "${it.z}/${it.x}/${it.y}" }.sorted().joinToString(";")
            var stableFrames = coverageGate.stableFrameCount()
            map.bridgePrintRasterFrameSnapshotsAfter(coverageGate.lastObservedSequence()).forEach { frame ->
                stableFrames = coverageGate.observe(frame, supplementalSignature = mvtSignature)
            }
            val latest = map.bridgePrintRasterFrameSnapshot()
            if (latest.sequence == coverageGate.lastObservedSequence() && latest.complete && stableFrames >= 2 &&
                (!vectorTilesRequired || mvtTiles > 0)) return@withTimeout
        }
        @Suppress("UNREACHABLE_CODE") Unit
    }

    /** Probe-only lifecycle telemetry. Never logs URLs, payloads, credentials, or exception messages. */
    private fun probeLog(stage: String, counters: String) {
        if (appContext.packageName == PROBE_PACKAGE) {
            android.util.Log.i(PROBE_LOG_TAG, "stage=$stage $counters")
        }
    }

    private fun hasVisibleFrameContent(bitmap: Bitmap): Boolean {
        val colors = HashSet<Int>()
        val stepX = (bitmap.width / 64).coerceAtLeast(1)
        val stepY = (bitmap.height / 64).coerceAtLeast(1)
        var visible = 0
        for (y in 0 until bitmap.height step stepY) for (x in 0 until bitmap.width step stepX) {
            val color = bitmap.getPixel(x, y)
            if (android.graphics.Color.alpha(color) > 8) visible++
            colors += color
        }
        return visible >= 16 && colors.size >= 8
    }

    /** GLES path line widths can collapse to one device pixel; paint the print-only route in screen space. */
    private fun drawShareTrackStrokes(bitmap: Bitmap, map: NativeMapController, tracks: JSONObject?) {
        val features = tracks?.optJSONArray("features") ?: return
        val canvas = Canvas(bitmap)
        for (index in 0 until features.length()) {
            val feature = features.optJSONObject(index) ?: continue
            val properties = feature.optJSONObject("properties") ?: continue
            if (properties.optString("role") !in setOf("shareTrackHalo", "track")) continue
            val geometry = feature.optJSONObject("geometry") ?: continue
            val lines = when (geometry.optString("type")) {
                "LineString" -> listOf(geometry.optJSONArray("coordinates") ?: continue)
                "MultiLineString" -> (geometry.optJSONArray("coordinates") ?: continue).let { multi ->
                    (0 until multi.length()).mapNotNull(multi::optJSONArray)
                }
                else -> continue
            }
            val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = parseColor(properties.optString("color", "#d0f76b"))
                style = Paint.Style.STROKE
                strokeWidth = properties.optDouble("width", 2.0).coerceIn(0.1, 40.0).toFloat()
                strokeCap = Paint.Cap.ROUND
                strokeJoin = Paint.Join.ROUND
            }
            for (line in lines) {
                if (line.length() < 2) continue
                val path = android.graphics.Path()
                var hasPoint = false
                for (pointIndex in 0 until line.length()) {
                    val coordinate = line.optJSONArray(pointIndex) ?: continue
                    if (coordinate.length() < 2) continue
                    val lon = coordinate.optDouble(0, Double.NaN)
                    val lat = coordinate.optDouble(1, Double.NaN)
                    val screen = map.projectCoordinate(lat, lon) ?: continue
                    if (!screen.first.isFinite() || !screen.second.isFinite()) continue
                    if (!hasPoint) path.moveTo(screen.first.toFloat(), screen.second.toFloat())
                    else path.lineTo(screen.first.toFloat(), screen.second.toFloat())
                    hasPoint = true
                }
                if (hasPoint) canvas.drawPath(path, paint)
            }
        }
    }

    private suspend fun pixelCopy(view: View, width: Int, height: Int): Bitmap = suspendCancellableCoroutine { cont ->
        if (android.os.Build.VERSION.SDK_INT < 24 || view !is SurfaceView) {
            cont.resumeWith(Result.failure(IllegalStateException("Native map surface capture unavailable"))); return@suspendCancellableCoroutine
        }
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        cont.invokeOnCancellation { if (!bitmap.isRecycled) bitmap.recycle() }
        PixelCopy.request(view, bitmap, { result ->
            if (!cont.isActive) { if (!bitmap.isRecycled) bitmap.recycle(); return@request }
            if (result == PixelCopy.SUCCESS) cont.resume(bitmap)
            else { bitmap.recycle(); cont.resumeWith(Result.failure(IllegalStateException("Native map surface capture failed"))) }
        }, main)
    }

    private suspend fun CompletableDeferred<Unit>.awaitBounded(timeoutMillis: Long) = kotlinx.coroutines.withTimeout(timeoutMillis) { await() }

    override fun close() {
        if (closed) return
        closed = true
        controller?.setBridgeFrameListener(null)
        overlays?.close()
        controller?.dispose()
        container?.let(root::removeView)
        container = null; controller = null; overlays = null
    }

    private fun parseColor(text: String): Int = runCatching { android.graphics.Color.parseColor(text) }.getOrDefault(android.graphics.Color.rgb(208, 247, 107))

    companion object {
        const val DEFAULT_WIDTH = 1200
        const val DEFAULT_HEIGHT = 1250
        private const val MAX_WIDTH = 2048
        private const val MAX_HEIGHT = 2048
        private const val MAX_IMAGE_BYTES = 8 * 1024 * 1024
        private const val FRAME_TIMEOUT_MS = 15_000L
        private const val NETWORK_IDLE_TIMEOUT_MS = 65_000L
        private const val NETWORK_QUIET_WINDOW_MS = 350L
        private const val NETWORK_POLL_MS = 100L
        private const val PROBE_PACKAGE = "com.shantu.hybridprobe"
        private const val PROBE_LOG_TAG = "ShantuShareProbe"
        private const val PROBE_NETWORK_LOG_INTERVAL_MS = 1_000L
    }
}

private object NativeBridgeShareAttribution {
    fun from(settings: JSONObject, source: JSONObject?) = buildString {
        settings.optString("attribution").takeIf(String::isNotBlank)?.let(::append)
        if (settings.optBoolean("roadsEnabled", settings.optBoolean("roads"))) {
            if (isNotEmpty()) append(" · ")
            append(com.shantu.nativeapp.map.NativeCartographyLayers.ATTRIBUTION)
        }
        if (settings.optBoolean("satelliteEnabled", settings.optBoolean("satellite"))) {
            if (isNotEmpty()) append(" · ")
            append(if (settings.optString("satelliteProvider") == "tianditu") com.shantu.nativeapp.map.NativeCartographyLayers.TIANDITU_ATTRIBUTION else "NASA GIBS / EOxCloudless")
        }
        source?.optString("attribution")?.takeIf(String::isNotBlank)?.let { if (isNotEmpty()) append(" · "); append(it) }
    }.takeIf(String::isNotBlank)
}
