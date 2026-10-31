package com.shantu.nativeapp.hybrid

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Rect
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.MotionEvent
import android.view.PixelCopy
import android.view.SurfaceView
import android.view.View
import android.view.ViewConfiguration
import android.widget.FrameLayout
import android.animation.ValueAnimator
import android.view.animation.LinearInterpolator
import com.shantu.nativeapp.map.NativeCameraSnapshot
import com.shantu.nativeapp.map.NativeDirectionMode
import com.shantu.nativeapp.map.NativeMapController
import com.shantu.nativeapp.map.NativeMapQuality
import com.shantu.nativeapp.map.NativeMapSource
import com.shantu.nativeapp.map.NativeMapSourceCatalog
import com.shantu.nativeapp.map.NativeBridgeFrameWitness
import com.shantu.nativeapp.map.NativeBridgeEyeState
import com.shantu.nativeapp.map.NativePositionFix
import com.shantu.nativeapp.map.NativePositionState
import com.shantu.nativeapp.map.NativeHeadingSource
import com.shantu.nativeapp.navigation.NativeCoordinate
import com.shantu.nativeapp.navigation.NativeRouteViewport
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import com.shantu.nativeapp.map.NativeCartographySettings
import com.shantu.nativeapp.map.NativeBrowserCacheFallback
import com.shantu.nativeapp.map.NativeTileNetworkPool
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.ln
import kotlin.math.pow
import kotlin.math.tan

internal class NativeTapCompletionGate {
    private var activeGestureId: Long? = null
    private var releasedTapGestureId: Long? = null

    fun begin(gestureId: Long) {
        activeGestureId = gestureId
        releasedTapGestureId = null
    }

    fun releaseTap(gestureId: Long) {
        if (activeGestureId == gestureId) releasedTapGestureId = gestureId
    }

    fun cancel(gestureId: Long) {
        if (activeGestureId == gestureId) {
            activeGestureId = null
            releasedTapGestureId = null
        }
    }

    fun accepts(gestureId: Long) = activeGestureId == gestureId && releasedTapGestureId == gestureId
}

/**
 * WebView-hosted React bridge for the native WorldWind surface. The React tree remains the sole UI
 * owner; this host only mounts map surfaces and transports JSON events/commands.
 *
 * All commands are serialized on Android's main thread. Async requests are tied to the current
 * hello session and map lifetime; a reload or dispose invalidates every pending callback.
 */
class NativeReactMapHost(
    context: Context,
    private val root: FrameLayout,
    private val emit: (String) -> Unit,
    private val trustedForeground: () -> Boolean,
    private val globalCommand: (String, JSONObject) -> Boolean = { _, _ -> false },
) : AutoCloseable {
    private val appContext = context.applicationContext
    private val main = Handler(Looper.getMainLooper())
    private val maps = linkedMapOf<String, MapEntry>()
    private val shareJobs = linkedMapOf<String, Pair<String, Job>>()
    private val shareScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val assets = NativeReactAssetStore(appContext)
    private var browserCacheFallback: NativeBrowserCacheFallback? = null
    private val privateConfig: JSONObject by lazy { readPrivateConfig() }
    @Volatile private var sessionId: String? = null
    @Volatile private var activeBrowserCacheMapId: String? = null
    @Volatile private var hostResumed = false
    private var closed = false
    private var matrixSequence = 0L

    private data class CachedInteractionState(
        val drawingActive: Boolean = false,
        val readOnly: Boolean = false,
    ) {
        companion object {
            fun from(value: JSONObject?): CachedInteractionState = CachedInteractionState(
                drawingActive = value?.optBoolean("drawingActive") == true,
                readOnly = value?.optBoolean("readOnly") == true,
            )
        }
    }

    private data class FrameMetadata(
        val camera: NativeCameraSnapshot,
        val cameraSyncToken: Long?,
        val eye: NativeBridgeEyeState,
        val cssX: Double,
        val cssY: Double,
        val cssWidth: Double,
        val cssHeight: Double,
        val cssScale: Double,
        val nativeWidth: Int,
        val nativeHeight: Int,
        val terrainEnabled: Boolean,
        val exaggeration: Double,
        val demRevision: Long,
        val snapRevision: Long,
        val capturedAt: Long,
    )
    private data class RenderedFrame(val metadata: FrameMetadata, val matrix: DoubleArray, val width: Int, val height: Int)

    private data class MapEntry(
        val id: String,
        val controller: NativeMapController,
        val container: FrameLayout,
        @Volatile var disposed: Boolean = false,
        val ownerToken: String? = null,
        val ownerGeneration: Long = 0L,
        var viewport: JSONObject? = null,
        var pendingCamera: JSONObject? = null,
        var renderRevision: Long = Long.MIN_VALUE,
        var renderState: JSONObject = JSONObject(),
        @Volatile var renderExaggeration: Double = 1.0,
        var renderInteraction: CachedInteractionState = CachedInteractionState(),
        var cameraRevision: Long = 0L,
        val cameraOrigin: NativeBridgeCameraOrigin = NativeBridgeCameraOrigin(),
        val actualFrameCount: AtomicLong = AtomicLong(),
        val lastActualFrameAt: AtomicLong = AtomicLong(),
        @Volatile var lastMatrixAt: Long = 0L,
        val framePublishPending: java.util.concurrent.atomic.AtomicBoolean = java.util.concurrent.atomic.AtomicBoolean(),
        val latestFrame: NativeBridgeLatestFrame<RenderedFrame> = NativeBridgeLatestFrame(),
        val frameCaptureGate: NativeBridgeFrameCaptureGate = NativeBridgeFrameCaptureGate(),
        @Volatile var frameCaptureTask: Runnable? = null,
        @Volatile var frameWitnessPending: Boolean = false,
        @Volatile var lastRenderedMatrix: DoubleArray? = null,
        @Volatile var lastCameraMotionAt: Long = 0L,
        @Volatile var capturedDemRevision: Long = Long.MIN_VALUE,
        @Volatile var capturedSnapRevision: Long = Long.MIN_VALUE,
        val frameMetadataNoticePending: java.util.concurrent.atomic.AtomicBoolean = java.util.concurrent.atomic.AtomicBoolean(),
        @Volatile var viewportMismatchPendingCheck: Boolean = false,
        @Volatile var nativeSizePendingCheck: Boolean = false,
        @Volatile var lastViewportMismatchSignature: String? = null,
        @Volatile var expectedNativeWidth: Int = 0,
        @Volatile var expectedNativeHeight: Int = 0,
        val viewportMismatchNoticePending: java.util.concurrent.atomic.AtomicBoolean = java.util.concurrent.atomic.AtomicBoolean(),
        var framePublishTask: Runnable? = null,
        var settledFrameTask: Runnable? = null,
        var touchDown: Pair<Float, Float>? = null,
        var gestureSequence: Long = 0L,
        val tapCompletionGate: NativeTapCompletionGate = NativeTapCompletionGate(),
        var capturedGestureId: Long? = null,
        var adapterCapturedGesture: Boolean = false,
        val touchNavigation: NativeMapTouchNavigation = NativeMapTouchNavigation(),
        var lastTouchAt: Long = 0L,
        val annotationIds: MutableSet<String> = linkedSetOf(),
        val routeIds: MutableSet<String> = linkedSetOf(),
        val areaIds: MutableSet<String> = linkedSetOf(),
        val trackIds: MutableSet<String> = linkedSetOf(),
        val sectionLayer: com.shantu.nativeapp.section.NativeSectionSurfaceLayer? = null,
        var sectionCollection: NativeBridgeSectionCollection? = null,
        var sectionDemRevision: Long = Long.MIN_VALUE,
        var lastSectionDemAt: Long = 0L,
        var sectionWasEnabled: Boolean = false,
        var sectionOriginalPitch: Double? = null,
        val overlayRenderer: NativeBridgeOverlayRenderer? = null,
        val snapGeometry: NativeBridgeSnapGeometry? = null,
        var snapObserver: AutoCloseable? = null,
        var snapReadyObserver: AutoCloseable? = null,
        var snapPublishedPayload: JSONObject? = null,
        var eventEncoder: NativeBridgeEventEncoder? = null,
        var eventEncodeSequence: Long = 0L,
        val eventEncodeTokens: MutableMap<String, Long> = mutableMapOf(),
        var snapInputSignature: String? = null,
        @Volatile var snapRevision: Long = 0L,
        var snapTilesDirty: Boolean = false,
        var snapPublishScheduled: Boolean = false,
        var lastSnapPublishAt: Long = 0L,
        var modelTerrainStatus: String? = null,
        val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate),
        var demRevision: Long = Long.MIN_VALUE,
        var sectionJob: Job? = null,
        var sectionInput: String? = null,
        var demJob: Job? = null,
        val demTileCache: NativeBridgeDemTileCache<JSONObject> = NativeBridgeDemTileCache(),
        val demSamplingGate: NativeBridgeDemSamplingGate = NativeBridgeDemSamplingGate(),
        var demKey: String? = null,
        var demRetryAfterAt: Long = 0L,
        var contourAuto: Boolean = false,
        var contourIntervalMeters: Int = 30,
        var cameraAnimator: ValueAnimator? = null,
    )

    /** Called by the trusted WebView bridge. The method is safe from non-main callers. */
    fun handleMessage(rawJson: String) {
        if (rawJson.length > MAX_MESSAGE_CHARS) {
            postError(null, null, "message_too_large", "地图请求超出大小限制")
            return
        }
        val request = runCatching { JSONObject(rawJson) }.getOrElse {
            postError(null, null, "invalid_json", "地图请求格式无效")
            return
        }
        if (Looper.myLooper() == Looper.getMainLooper()) dispatch(request) else main.post { dispatch(request) }
    }

    fun onHostResume() = onMain {
        if (!closed) {
            hostResumed = true
            maps.values.forEach { it.controller.onResume() }
        }
    }

    fun onHostPause() = onMain {
        hostResumed = false
        maps.values.forEach { it.controller.onPause() }
    }

    /** Invalidates a WebView document session before a same-Activity page reload. */
    fun invalidateSession() = onMain {
        clearSession()
        sessionId = null
    }

    /** View used by the Activity touch router for an independent map surface. */
    fun mapTarget(mapId: String): View? = if (Looper.myLooper() == Looper.getMainLooper()) maps[mapId]?.controller?.view else null

    /** URL-free probe-only render/network snapshot, read on main because maps are main-thread owned. */
    fun inspectMapDiagnostics(): JSONObject {
        if (appContext.packageName != "com.shantu.hybridprobe" ||
            appContext.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE == 0) return JSONObject()
        if (Looper.myLooper() == Looper.getMainLooper()) return inspectMapDiagnosticsOnMain()
        val latch = CountDownLatch(1)
        val result = java.util.concurrent.atomic.AtomicReference<JSONObject>()
        main.post { try { result.set(inspectMapDiagnosticsOnMain()) } finally { latch.countDown() } }
        if (!latch.await(750, TimeUnit.MILLISECONDS)) return JSONObject().put("available", false).put("reason", "main_snapshot_timeout")
        return result.get() ?: JSONObject().put("available", false)
    }

    private fun inspectMapDiagnosticsOnMain(): JSONObject {
        val runtime = Runtime.getRuntime()
        val mapsJson = JSONArray()
        val poolSnapshot = maps.values.firstOrNull()?.controller?.loadingSnapshot()
        maps.values.forEach { entry ->
            val cache = entry.controller.worldWindowForBridge().engine.renderResourceCache
            val window = entry.controller.worldWindowForBridge()
            val lastFrame = entry.lastActualFrameAt.get()
            val network = entry.controller.loadingSnapshot()
            mapsJson.put(JSONObject()
                .put("mapId", entry.id)
                .put("sourceId", entry.controller.currentSource()?.id ?: "")
                .put("viewWidthPx", entry.controller.view.width)
                .put("viewHeightPx", entry.controller.view.height)
                .put("actualFrames", entry.actualFrameCount.get())
                .put("lastFrameAgeMs", if (lastFrame > 0L) (android.os.SystemClock.elapsedRealtime() - lastFrame).coerceAtLeast(0L) else JSONObject.NULL)
                .put("rasterBitmapDecodes", entry.controller.bridgeRasterTileSnapshot())
                .put("renderCacheCapacityBytes", cache.capacity)
                .put("renderCacheUsedBytes", cache.usedCapacity)
                .put("renderCacheEntries", cache.entryCount)
                .put("demRevision", entry.controller.demRevision())
                .put("demJobActive", entry.demJob?.isActive == true)
                .put("terrainEnabled", entry.controller.isTerrainEnabled())
                .put("attached", window.isAttachedToWindow))
        }
        val network = poolSnapshot
        val stages = maps.values.firstOrNull()?.controller?.tileStageTelemetrySnapshot()
        val decodeBuckets = JSONArray().apply { stages?.decodeDurationBuckets?.forEach { put(it) } }
        return JSONObject()
            .put("available", true)
            .put("heapMaxBytes", runtime.maxMemory())
            .put("heapUsedBytes", runtime.totalMemory() - runtime.freeMemory())
            .put("mapCount", maps.size)
            .put("maps", mapsJson)
            .put("tileStages", stages?.let {
                JSONObject().put("scope", "process")
                    .put("decodedImages", it.decodedImages).put("decodeNanos", it.decodedNanos)
                    .put("decodeFailures", it.decodeFailures).put("decodeDurationBucketCounts", decodeBuckets)
                    .put("completedFrames", it.renderedFrames).put("perTileDrawCount", it.perTileDrawCount ?: JSONObject.NULL)
                    .put("latencyCoverage", "BitmapFactory decode duration and frame completion only; no per-tile receive-to-draw timing")
            } ?: JSONObject())
            .put("network", network?.let {
                JSONObject().put("requests", it.networkRequests).put("successes", it.successes)
                    .put("errors", it.errors).put("rateLimits", it.rateLimits)
                    .put("memoryHits", it.memoryHits).put("diskHits", it.diskHits).put("retries", it.retries)
                    .put("cancellations", it.cancellations).put("decodeValidationMs", it.decodeMs)
                    .put("receivedBytes", it.receivedBytes).put("queued", it.queuedNetworkRequests)
                    .put("active", it.activeNetworkRequests).put("queueWaitMs", it.queueWaitMs)
                    .put("networkMs", it.networkMs)
                    .put("pendingCacheWriteBytes", it.pendingCacheWriteBytes)
                    .put("droppedCacheWrites", it.droppedCacheWrites)
                    .put("completedCacheWrites", it.completedCacheWrites)
                    .put("failedCacheWrites", it.failedCacheWrites)
                    .put("activeBackground", it.activeBackgroundRequests)
            } ?: JSONObject())
    }

    override fun close() = onMain {
        if (closed) return@onMain
        closed = true
        clearSession()
        assets.close()
        shareScope.cancel()
    }

    private fun dispatch(request: JSONObject) {
        if (closed) return
        val requestId = request.optString("requestId").takeIf(String::isNotBlank)
        val mapId = request.optString("mapId").takeIf(String::isNotBlank)
        if (!trusted()) {
            postError(requestId, mapId, "untrusted_or_background", "地图桥接当前不可用")
            return
        }
        if (request.optInt("version", -1) != VERSION) {
            postError(requestId, mapId, "unsupported_version", "不支持的地图桥接版本")
            return
        }
        val command = request.optString("command")
        if (command == "hello") {
            startSession(requestId, mapId)
            return
        }
        if (requestId == null) {
            postError(null, mapId, "request_id_required", "地图请求缺少 requestId")
            return
        }
        val currentSession = sessionId
        if (currentSession == null || request.optString("sessionId") != currentSession) {
            postError(requestId, mapId, "stale_session", "地图会话已失效，请重新初始化")
            return
        }
        val payload = request.optJSONObject("payload") ?: JSONObject()
        try {
            assets.command(command, payload)?.let {
                send("result", mapId, requestId, it)
                return
            }
        } catch (_: Throwable) {
            postError(requestId, mapId, "asset_transfer_failed", "离线地图同步未完成")
            return
        }
        if (runCatching { globalCommand(command, payload) }.getOrDefault(false)) {
            send("result", mapId, requestId, JSONObject().put("applied", true))
            return
        }
        try {
            when (command) {
                "cachedTileResponse" -> {
                    val accepted = mapId != null && maps.containsKey(mapId) &&
                        browserCacheFallback?.acceptResponse(currentSession, mapId, payload) == true
                    send("result", mapId, requestId, JSONObject().put("accepted", accepted))
                }
                "create" -> createMap(requireMapId(mapId), payload, requestId)
                "dispose" -> disposeMap(requireMapId(mapId), payload, requestId)
                "mapViewport" -> setViewport(requireMapId(mapId), payload, requestId)
                "renderState", "setRenderState" -> applyRenderState(requireMapId(mapId), payload, requestId)
                "batch" -> applyBatch(requireMapId(mapId), payload, requestId)
                "camera", "applyCamera", "restoreCamera", "zoom", "north", "reset", "view", "fitRoute", "fitCollection", "focusPoint", "stop",
                "followPosition", "followNavigation", "previewNavigation", "focusPosition", "focusCenter", "setTerrainMode",
                "viewGesture", "panZoomGesture", "finishPanZoomGesture", "previewTrackNode", "previewRoute", "focusRouteGap", "clearRouteGap",
                "focusRouteIssue", "clearRouteIssue", "highlightOffline" ->
                    cameraCommand(requireMapId(mapId), command, payload, requestId)
                "refreshSatellite" -> { requireEntry(requireMapId(mapId)).controller.retrySatellite(); send("result", mapId, requestId, JSONObject().put("requested", true)) }
                "refreshGeology" -> { requireEntry(requireMapId(mapId)).controller.retryGeology(); send("result", mapId, requestId, JSONObject().put("requested", true)) }
                "refreshSection" -> { val e = requireEntry(requireMapId(mapId)); e.sectionInput = null; applySection(e, e.renderState); send("result", mapId, requestId, JSONObject().put("requested", true)) }
                "gestureCapture" -> gestureCapture(requireMapId(mapId), payload, requestId)
                "renderShareMap" -> renderShareMap(requireMapId(mapId), payload, requestId)
                "project" -> project(requireMapId(mapId), payload, requestId)
                "unproject" -> unproject(requireMapId(mapId), payload, requestId)
                "pick" -> pick(requireMapId(mapId), payload, requestId)
                "getElevation" -> getElevation(requireMapId(mapId), payload, requestId)
                "capture" -> capture(requireMapId(mapId), payload, requestId)
                "cancel" -> cancelRequest(payload, requestId, mapId)
                else -> postError(requestId, mapId, "unknown_command", "未知的地图命令")
            }
        } catch (e: IllegalArgumentException) {
            postError(requestId, mapId, "invalid_payload", e.message?.takeIf(::safeMessage) ?: "地图参数无效")
        } catch (_: Throwable) {
            // Never send exception text: it may contain URLs, provider credentials or source data.
            postError(requestId, mapId, "operation_failed", "地图操作未完成")
        }
    }

    private fun startSession(requestId: String?, mapId: String?) {
        clearSession()
        sessionId = UUID.randomUUID().toString()
        browserCacheFallback = NativeBrowserCacheFallback(
            sessionId = { sessionId },
            mapId = { activeBrowserCacheMapId },
            sendEvent = { targetMapId, name, value -> emitEvent(targetMapId, name, value) },
        )
        NativeTileNetworkPool.installBrowserCacheReader { packageId, url -> browserCacheFallback?.read(packageId, url) }
        val payload = JSONObject()
            .put("protocolVersion", VERSION)
            .put("capabilities", capabilities())
            .put("mapIds", JSONArray())
        send("result", mapId, requestId, payload)
    }

    private fun createMap(mapId: String, payload: JSONObject, requestId: String) {
        require(mapId.length <= 96 && ID_PATTERN.matches(mapId)) { "地图编号无效" }
        val requestedOwner = payload.optString("ownerToken").takeIf { it.isNotBlank() && it.length <= 160 }
        val requestedGeneration = payload.optLong("ownerGeneration", 0L)
        require((requestedOwner == null && requestedGeneration == 0L) ||
            (requestedOwner != null && requestedGeneration > 0L)) { "地图创建者标识无效" }
        val existing = maps[mapId]
        if (existing != null) {
            if (requestedOwner != null && existing.ownerToken == requestedOwner && existing.ownerGeneration == requestedGeneration) {
                payload.optJSONObject("offlineDisplayPolicy")?.let(::applyOfflineDisplayPolicy)
                send("result", mapId, requestId, JSONObject().put("created", true).put("existing", true)
                    .put("ownerToken", requestedOwner).put("ownerGeneration", requestedGeneration))
                return
            }
            if (requestedOwner != null && requestedGeneration > existing.ownerGeneration) {
                removeMapEntry(mapId, existing)
            } else {
                postError(requestId, mapId, if (requestedOwner != null && requestedGeneration < existing.ownerGeneration) "stale_map_owner" else "map_exists",
                    if (requestedOwner != null && requestedGeneration < existing.ownerGeneration) "旧地图实例不能接管当前地图" else "地图已由其他实例创建")
                return
            }
        }
        payload.optJSONObject("offlineDisplayPolicy")?.let(::applyOfflineDisplayPolicy)
        val container = FrameLayout(appContext).apply {
            clipChildren = true
            clipToPadding = true
            visibility = View.INVISIBLE
            elevation = appContext.resources.displayMetrics.density * 0.1f
        }
        val controller = NativeMapController(appContext, privateConfig.optString("tiandituKey").orEmpty()) { message ->
            emitEvent(mapId, "status", JSONObject().put("message", message))
        }
        controller.configureBridgeCameraScale()
        controller.setImageryStatusListener { state -> emitEvent(mapId, "satellite", NativeBridgeStateEvents.satellite(state)) }
        val cloudConfig = privateConfig.optJSONObject("geocloud")
        val cloudCredentials = cloudConfig?.optString("token")?.takeIf(String::isNotBlank)?.let {
            com.shantu.nativeapp.geology.NativeGeologyCredentials(it, cloudConfig.optString("service", "qg20_20210401_FCnDDRJd"), cloudConfig.optString("layer"))
        }
        controller.configureGeology(com.shantu.nativeapp.geology.NativeGeologyCredentialProvider { cloudCredentials }) { state ->
            emitEvent(mapId, "geology", NativeBridgeStateEvents.geology(state))
        }
        val section = runCatching { controller.createSectionSurfaceLayer() }.getOrNull()
        val overlays = NativeBridgeOverlayRenderer(controller.worldWindowForBridge())
        controller.addBridgeOverlayLayer(overlays.layer)
        val snap = NativeBridgeSnapGeometry(controller.worldWindowForBridge(), controller.cartographyForBridge())
        val entry = MapEntry(mapId, controller, container, ownerToken = requestedOwner, ownerGeneration = requestedGeneration,
            sectionLayer = section, overlayRenderer = overlays, snapGeometry = snap)
        val mapSession = sessionId
        entry.eventEncoder = NativeBridgeEventEncoder({ channel, token, encoded ->
            main.post {
                if (mapSession != null && sessionId == mapSession && isCurrent(entry) && entry.eventEncodeTokens[channel] == token)
                    postEmit(encoded, mapSession)
            }
        })
        entry.sectionCollection = NativeBridgeSectionCollection(controller.worldWindowForBridge(), controller::createSectionDemSampler) { message ->
            emitEvent(mapId, "status", JSONObject().put("message", message))
        }
        val scheduleSnapUpdate: () -> Unit = { main.post {
            if (isCurrent(entry)) {
                entry.snapTilesDirty = true
                scheduleSnapPublish(entry)
                markFrameDirty(entry)
            }
        }; Unit }
        entry.snapObserver = snap.observeTileLoads { _, _, _ -> scheduleSnapUpdate() }
        entry.snapReadyObserver = snap.observeSnapshotsReady(scheduleSnapUpdate)
        maps[mapId] = entry
        activeBrowserCacheMapId = mapId
        container.addView(controller.view, FrameLayout.LayoutParams(-1, -1))
        root.addView(container, FrameLayout.LayoutParams(1, 1))
        controller.setBridgeCameraMotionListener { mvp -> onCameraMatrixChanged(entry, mvp) }
        controller.setBridgeFrameActivityListener { onNativeFrameActivity(entry) }
        installTouchBridge(entry)
        if (hostResumed) controller.onResume()
        markFrameDirty(entry)
        payload.optJSONObject("initialCamera")?.let { restoreCamera(entry, it) }
        send("result", mapId, requestId, JSONObject().put("created", true).put("ownerToken", requestedOwner).put("ownerGeneration", requestedGeneration))
        emitEvent(mapId, "viewCreated", JSONObject().put("width", controller.view.width).put("height", controller.view.height))
    }

    private fun disposeMap(mapId: String, payload: JSONObject, requestId: String) {
        val entry = maps[mapId]
        if (entry == null) {
            send("result", mapId, requestId, JSONObject().put("disposed", false).put("missing", true))
            return
        }
        val requestedOwner = payload.optString("ownerToken").takeIf { it.isNotBlank() }
        val requestedGeneration = payload.optLong("ownerGeneration", 0L)
        if (requestedOwner != null && (entry.ownerToken != requestedOwner || entry.ownerGeneration != requestedGeneration)) {
            send("result", mapId, requestId, JSONObject().put("disposed", false).put("ownerMismatch", true))
            return
        }
        removeMapEntry(mapId, entry)
        send("result", mapId, requestId, JSONObject().put("disposed", true))
    }

    private fun removeMapEntry(mapId: String, entry: MapEntry) {
        if (maps[mapId] !== entry) return
        entry.disposed = true
        shareJobs.entries.filter { it.value.first == mapId }.toList().forEach { (id, item) -> shareJobs.remove(id); item.second.cancel() }
        maps.remove(mapId)
        entry.eventEncoder?.close()
        entry.eventEncodeTokens.clear()
        entry.framePublishTask?.let(main::removeCallbacks)
        entry.frameCaptureTask?.let(main::removeCallbacks)
        entry.settledFrameTask?.let(main::removeCallbacks)
        entry.framePublishPending.set(false)
        entry.latestFrame.takeLatest()
        entry.controller.setBridgeFrameListener(null)
        entry.controller.setBridgeCameraMotionListener(null)
        entry.controller.setBridgeFrameActivityListener(null)
        entry.scope.cancel()
        entry.sectionJob?.cancel()
        entry.demJob?.cancel()
        entry.sectionLayer?.close()
        entry.sectionCollection?.close()
        entry.overlayRenderer?.close()
        entry.snapObserver?.close(); entry.snapReadyObserver?.close(); entry.snapGeometry?.close()
        entry.cameraAnimator?.cancel(); entry.cameraAnimator = null
        entry.controller.dispose()
        root.removeView(entry.container)
        if (activeBrowserCacheMapId == mapId) activeBrowserCacheMapId = maps.keys.lastOrNull()
        if (maps.isEmpty()) com.shantu.nativeapp.map.NativeOfflineDisplayPolicy.reset()
    }

    private fun setViewport(mapId: String, payload: JSONObject, requestId: String) {
        val entry = requireEntry(mapId)
        val viewport = payload.optJSONObject("mapViewport") ?: payload.optJSONObject("viewport") ?: payload
        val rect = viewport.optJSONObject("cssRect") ?: viewport.optJSONObject("rect") ?: viewport
        val clientWidth = viewport.optDouble("clientViewportWidth", Double.NaN)
        val cssScale = if (clientWidth.isFinite() && clientWidth > 0 && root.width > 0) root.width / clientWidth
            else viewport.optDouble("devicePixelRatio", appContext.resources.displayMetrics.density.toDouble()).coerceIn(0.5, 8.0)
        entry.controller.setBridgeMarkerCssScale(cssScale)
        val x = finite(rect, "x"); val y = finite(rect, "y")
        val width = finite(rect, "width"); val height = finite(rect, "height")
        require(width >= 0 && height >= 0 && width <= 20_000 && height <= 20_000) { "地图视口尺寸无效" }
        val oldRect = entry.viewport?.optJSONObject("cssRect")
        val sizeChanged = oldRect != null &&
            (oldRect.optDouble("width") != width || oldRect.optDouble("height") != height)
        val preservedCamera = if (sizeChanged && entry.pendingCamera == null &&
            oldRect!!.optDouble("width") > 0 && oldRect.optDouble("height") > 0) cameraJson(entry) else null
        entry.viewport = JSONObject(viewport.toString()).put("cssScale", cssScale)
        entry.overlayRenderer?.let { overlays ->
            overlays.setCssScale(cssScale)
            entry.renderState.optJSONObject("renderGeometry")?.let(overlays::sync)
        }
        val visible = width > 0 && height > 0
        val params = (entry.container.layoutParams as? FrameLayout.LayoutParams)
            ?: FrameLayout.LayoutParams(1, 1)
        params.width = (width * cssScale).toInt().coerceAtLeast(if (visible) 1 else 0)
        params.height = (height * cssScale).toInt().coerceAtLeast(if (visible) 1 else 0)
        params.leftMargin = (x * cssScale).toInt()
        params.topMargin = (y * cssScale).toInt()
        entry.container.layoutParams = params
        entry.container.visibility = if (visible && entry.renderRevision >= 0L) View.VISIBLE else View.INVISIBLE
        entry.controller.view.requestLayout()
        if (visible) activeBrowserCacheMapId = mapId
        if (visible) {
            val camera = entry.pendingCamera ?: preservedCamera
            entry.pendingCamera = null
            camera?.let { restoreCamera(entry, it) }
        } else if (preservedCamera != null) entry.pendingCamera = preservedCamera
        send("result", mapId, requestId, JSONObject().put("applied", true).put("cssScale", cssScale))
        emitEvent(mapId, "mapViewport", JSONObject().put("cssRect", JSONObject().put("x", x).put("y", y).put("width", width).put("height", height)).put("cssScale", cssScale))
        markFrameDirty(entry)
    }

    /** Applies only changed JSON subtrees; item overlays are upserted and stale IDs are removed. */
    private fun applyRenderState(mapId: String, state: JSONObject, requestId: String) {
        val entry = requireEntry(mapId)
        val revision = state.optLong("revision", -1L)
        require(revision >= 0) { "renderState revision无效" }
        if (revision <= entry.renderRevision) {
            send("result", mapId, requestId, JSONObject().put("applied", false).put("reason", "stale_revision").put("revision", entry.renderRevision))
            return
        }
        // The bridge message parser already created this JSONObject on the main thread. Keep it
        // as the read-only snapshot for frame/touch/DEM callbacks instead of serializing and
        // reparsing the full (potentially multi-megabyte) render state on hot paths.
        val input = state
        if (input.has("offlineDisplayPolicy")) applyOfflineDisplayPolicy(input.optJSONObject("offlineDisplayPolicy"))
        val viewport = input.optJSONObject("mapViewport")
        if (viewport != null && viewport.toString() != entry.viewport?.toString()) setViewport(mapId, viewport, "${requestId}:viewport")
        val previous = entry.renderState
        val settings = input.optJSONObject("settings")
        val effectiveSettings = NativeBridgeSectionTerrain.effective(settings ?: JSONObject(), input.optJSONObject("section"))
        val previousEffectiveSettings = NativeBridgeSectionTerrain.effective(previous.optJSONObject("settings") ?: JSONObject(), previous.optJSONObject("section"))
        val nextRenderExaggeration = effectiveSettings.optDouble("exaggeration", 1.0).takeIf { it.isFinite() } ?: 1.0
        val nextRenderInteraction = CachedInteractionState.from(input.optJSONObject("interaction"))
        if (entry.renderInteraction.drawingActive && !nextRenderInteraction.drawingActive) {
            entry.controller.setTileDemandDrawingFocus(null, null)
        }
        val selectedMarker = input.optString("annotationSelected").takeIf { it.isNotBlank() && it != "null" }
        entry.controller.setBridgeMarkerPresentation(cameraJson(entry).optDouble("zoom", Double.NaN), selectedMarker)
        val source = input.optJSONObject("mapSource")
        val sourceChanged = source?.toString() != previous.optJSONObject("mapSource")?.toString()
        if (effectiveSettings.toString() != previousEffectiveSettings.toString() || sourceChanged) {
            if (sourceChanged && source == null) entry.controller.clearCustomSource()
            applySettings(entry, effectiveSettings, source.takeIf { sourceChanged })
        }
        val camera = input.optJSONObject("camera") ?: input.optJSONObject("initialCamera")
        if (camera != null && camera.toString() != previous.optJSONObject("camera")?.toString()) restoreCamera(entry, camera)
        if (input.optJSONArray("annotations")?.toString() != previous.optJSONArray("annotations")?.toString()) applyAnnotations(entry, input.optJSONArray("annotations") ?: JSONArray())
        if (input.optJSONObject("renderGeometry")?.has("routes") == true) {
            if (entry.routeIds.isNotEmpty()) { entry.routeIds.forEach(entry.controller::removeRoute); entry.routeIds.clear() }
        } else if (input.optJSONObject("routeOverlay")?.toString() != previous.optJSONObject("routeOverlay")?.toString()) applyRouteOverlay(entry, input.optJSONObject("routeOverlay") ?: JSONObject())
        entry.controller.cartographyForBridge().setRiverSnapping(input.optJSONObject("interaction")?.optBoolean("riverSnapping") == true)
        if (input.optJSONObject("renderGeometry") == null && input.optJSONObject("trackOverlay")?.toString() != previous.optJSONObject("trackOverlay")?.toString()) applyTrackOverlay(entry, input.optJSONObject("trackOverlay") ?: JSONObject())
        if (input.optJSONObject("renderGeometry")?.toString() != previous.optJSONObject("renderGeometry")?.toString()) {
            input.optJSONObject("renderGeometry")?.let { entry.overlayRenderer?.sync(it) }
        }
        if (input.optJSONObject("areaOverlay")?.toString() != previous.optJSONObject("areaOverlay")?.toString()) applyAreaOverlay(entry, input.optJSONObject("areaOverlay") ?: JSONObject())
        if (input.optJSONArray("photos")?.toString() != previous.optJSONArray("photos")?.toString()) applyPhotos(entry, input.optJSONArray("photos") ?: JSONArray())
        if (input.optJSONObject("position")?.toString() != previous.optJSONObject("position")?.toString() ||
            input.opt("positionHeading") != previous.opt("positionHeading") || input.opt("positionNavigating") != previous.opt("positionNavigating")) applyPosition(entry, input)
        applySection(entry, input)
        entry.renderExaggeration = nextRenderExaggeration
        entry.renderInteraction = nextRenderInteraction
        entry.renderRevision = revision
        entry.renderState = input
        entry.viewport?.optJSONObject("cssRect")?.let { rect ->
            entry.container.visibility = if (rect.optDouble("width") > 0 && rect.optDouble("height") > 0) View.VISIBLE else View.INVISIBLE
        }
        entry.controller.refreshTileViewDemand()
        send("result", mapId, requestId, JSONObject().put("applied", true).put("revision", revision))
        markFrameDirty(entry)
    }

    private fun applyBatch(mapId: String, payload: JSONObject, requestId: String) {
        val commands = payload.optJSONArray("commands") ?: throw IllegalArgumentException("batch commands无效")
        require(commands.length() <= MAX_BATCH) { "batch数量超过限制" }
        val results = JSONArray()
        for (index in 0 until commands.length()) {
            val item = commands.optJSONObject(index) ?: throw IllegalArgumentException("batch命令无效")
            val name = item.optString("command")
            val body = item.optJSONObject("payload") ?: JSONObject()
            val result = when (name) {
                "camera", "applyCamera", "restoreCamera", "zoom", "north", "reset", "view", "fitRoute", "fitCollection", "focusPoint", "stop",
                "followPosition", "followNavigation", "previewNavigation", "focusPosition", "focusCenter", "setTerrainMode",
                "viewGesture", "panZoomGesture", "finishPanZoomGesture", "previewTrackNode", "previewRoute", "focusRouteGap", "clearRouteGap",
                "focusRouteIssue", "clearRouteIssue", "highlightOffline" -> runCamera(entry = requireEntry(mapId), command = name, payload = body)
                "refreshSatellite" -> { requireEntry(mapId).controller.retrySatellite(); JSONObject().put("requested", true) }
                "refreshGeology" -> { requireEntry(mapId).controller.retryGeology(); JSONObject().put("requested", true) }
                "renderState" -> {
                    val entry = requireEntry(mapId)
                    val revision = body.optLong("revision", -1)
                    val accepted = revision > entry.renderRevision
                    if (accepted) applyRenderState(mapId, body, "$requestId:$index")
                    JSONObject().put("applied", accepted)
                }
                else -> throw IllegalArgumentException("batch含不支持的命令")
            }
            results.put(result)
        }
        send("result", mapId, requestId, JSONObject().put("results", results))
    }

    private fun applySettings(entry: MapEntry, settings: JSONObject, sourceJson: JSONObject?) {
        val map = entry.controller
        val incomingCustom = sourceJson?.takeIf { !it.isNull("id") }?.let { parseMapSource(assets.resolve(it)) }
        val currentCustom = incomingCustom ?: map.currentCustomSource()
        if (currentCustom != null) {
            val key = com.shantu.nativeapp.map.NativeCartographySelection.rasterDatumKey(
                customSourceId = currentCustom.id,
                satellite = settings.optBoolean("satellite", false),
                offlineBasemap = settings.optBoolean("offlineBasemap"),
                satelliteProvider = settings.optString("satelliteProvider", "sentinel"),
                imageryMode = settings.optString("imageryMode", "detail"),
                tiandituBase = settings.optString("tiandituBase", if (settings.optBoolean("satellite", false)) "img" else "vec"),
            )
            val datumOverride = settings.optJSONObject("rasterDatums")?.optString(key)?.let {
                when (it.lowercase()) {
                    "wgs84" -> com.shantu.nativeapp.map.NativeRasterDatum.WGS84
                    "gcj02" -> com.shantu.nativeapp.map.NativeRasterDatum.GCJ02
                    "bd09" -> com.shantu.nativeapp.map.NativeRasterDatum.BD09
                    else -> null
                }
            }
            val mapped = currentCustom.withDatum(datumOverride ?: currentCustom.datum)
            if (incomingCustom != null || map.currentCustomSource()?.datum != mapped.datum) map.setCustomSource(mapped)
        }
        val selectedBase = settings.optString("tiandituBase", if (settings.optBoolean("satellite", false)) "img" else "vec")
        val activeCustom = map.currentCustomSource() != null
        val sourceId = com.shantu.nativeapp.map.NativeCartographySelection.sourceId(
            hasCustomSource = activeCustom,
            offlineBasemap = settings.optBoolean("offlineBasemap"),
            satellite = settings.optBoolean("satellite", false),
            satelliteProvider = settings.optString("satelliteProvider", "sentinel"),
            imageryMode = settings.optString("imageryMode", "detail"),
            tiandituBase = selectedBase,
            tiandituConfigured = privateConfig.optString("tiandituKey").isNotBlank(),
        )
        val tdt = sourceId.startsWith("tianditu-") && !settings.optBoolean("offlineBasemap")
        if (!activeCustom && tdt) {
            val desired = when (sourceId) {
                "tianditu-vector" -> NativeMapController.SOURCE_VECTOR
                "tianditu-terrain" -> NativeMapController.SOURCE_TERRAIN
                else -> NativeMapController.SOURCE_IMAGERY
            }
            if (map.currentSource()?.id != desired) map.setSource(desired)
        } else if (!activeCustom) {
            map.setLegacyRasterLayersVisible(false)
        }
        map.setLegacyRasterLayersVisible(activeCustom || tdt)
        settings.optBoolean("terrain").let(map::setTerrain)
        settings.optDouble("exaggeration", 1.0).takeIf(Double::isFinite)?.let(map::setTerrainExaggeration)
        syncTerrainOverlay(entry, settings, cameraJson(entry).optDouble("zoom", Double.NaN))
        val labelsVisible = settings.optBoolean("labelsEnabled", settings.optBoolean("labels", true))
        val roadsOpacity = settings.optDouble("roadsOpacity", 1.0).coerceIn(0.0, 1.0)
        // Built-in TDT annotation is managed by NativeCartographyLayers separately; enabling
        // the controller's legacy label surface as well would double-draw it (and ignore vector mode).
        map.setRasterLabelOpacity(if (activeCustom && labelsVisible) roadsOpacity else 0.0)
        val level = settings.opt("rasterLevel")?.takeUnless { it == JSONObject.NULL }?.let { (it as? Number)?.toInt() }
        val offlineMax = settings.opt("offlineMaxZoom")?.takeUnless { it == JSONObject.NULL }?.let { (it as? Number)?.toInt() }
        val zoomBounds = when {
            tdt -> 1 to 19
            activeCustom -> (currentCustom?.minZoom ?: 0) to (currentCustom?.maxZoom ?: 24)
            sourceId == "sentinel-latest" -> 0 to 9
            sourceId == "sentinel-detail" -> 0 to 14
            else -> null
        }
        val boundedRasterCap = zoomBounds?.let { (minZoom, maxZoom) ->
            com.shantu.nativeapp.map.NativeRasterZoomPolicy.resolve(level, offlineMax, minZoom, maxZoom)
        }
        map.setFixedRasterZoom(boundedRasterCap)
        map.setQuality(if (settings.optString("rasterQuality", "high") == "standard") NativeMapQuality.STANDARD else NativeMapQuality.HIGH)
        val cartographySettings = NativeCartographySettings(
            roads = settings.optBoolean("roadsEnabled", settings.optBoolean("roads")),
            labels = settings.optBoolean("labelsEnabled", settings.optBoolean("labels", true)),
            roadsOpacity = roadsOpacity.toFloat(),
            rasterLabelOpacity = roadsOpacity.toFloat(),
            satellite = settings.optBoolean("satelliteEnabled", settings.optBoolean("satellite")),
            satelliteProvider = settings.optString("satelliteProvider", "sentinel"),
            imageryMode = settings.optString("imageryMode", "detail"),
            tiandituBase = selectedBase,
            tiandituLabels = settings.optString("tiandituLabels", "vector"),
            tiandituBoundaries = settings.optBoolean("tiandituBoundaries"),
            offlineBasemap = settings.optBoolean("offlineBasemap") || sourceId == "offline",
            sourceId = sourceId,
        )
        val explicitBase = activeCustom || sourceId != "terrain"
        map.configureCartography(cartographySettings, activeCustom, explicitBase, boundedRasterCap)
        if (settings.has("geologyEnabled") || settings.has("geologySource")) {
            val source = if (settings.optString("geologySource", "world") == "geocloud20w") com.shantu.nativeapp.geology.NativeGeologySource.GEO_CLOUD_200K else com.shantu.nativeapp.geology.NativeGeologySource.WORLD
            map.setGeology(settings.optBoolean("geologyEnabled"), source, settings.optDouble("geologyOpacity", .85))
        }
    }

    private fun parseMapSource(source: JSONObject): NativeMapSource {
        val catalog = NativeMapSourceCatalog.fromJson(JSONObject().put("maps", JSONArray().put(source)))
        return catalog.sources.singleOrNull() ?: throw IllegalArgumentException("图源配置无效")
    }

    private fun applyAnnotations(entry: MapEntry, annotations: JSONArray) {
        require(annotations.length() <= 2_200) { "标记数量超过限制" }
        val next = linkedSetOf<String>()
        val rendered = mutableListOf<com.shantu.nativeapp.map.NativeMarkerRenderResult>()
        for (index in 0 until annotations.length()) {
            val item = annotations.optJSONObject(index) ?: continue
            val id = item.optString("id")
            if (id.isBlank()) continue
            next += id
            if (item.optBoolean("visible", true)) rendered += entry.controller.renderMarker(item)
            else entry.controller.removeMarker(id)
        }
        (entry.annotationIds - next).forEach(entry.controller::removeMarker)
        entry.annotationIds.clear(); entry.annotationIds.addAll(next)
        publishModelTerrainStatus(entry, rendered)
    }

    private fun publishModelTerrainStatus(entry: MapEntry, results: List<com.shantu.nativeapp.map.NativeMarkerRenderResult>) {
        val message = if (!entry.controller.isTerrainEnabled()) "" else results.mapNotNull { it.reason }
            .filter(String::isNotBlank).distinct().take(3).joinToString("；")
        if (message == entry.modelTerrainStatus) return
        entry.modelTerrainStatus = message
        emitEvent(entry.id, "modelTerrainStatus", JSONObject().put("message", message))
    }

    private fun applyRouteOverlay(entry: MapEntry, overlay: JSONObject) {
        val next = linkedSetOf<String>()
        val route = overlay.optJSONObject("route")
        val mainCoordinates = route?.optJSONArray("coordinates")
        if (mainCoordinates != null) {
            val coords = readCoordinates(mainCoordinates)
            if (coords.size >= 2) {
                val id = "__planned-route"
                next += id
                entry.controller.replaceRoute(id, coords, parseColor(overlay.optString("color", "#7bdc72")), overlay.optDouble("width", 4.0).toFloat().coerceIn(0.5f, 12f))
            }
        }
        val parts = overlay.optJSONArray("displayParts")
        if (parts != null) for (i in 0 until parts.length()) {
            val part = parts.optJSONObject(i) ?: continue
            val coords = readCoordinates(part.optJSONArray("coordinates") ?: continue)
            if (coords.size < 2) continue
            val id = "__route-display-$i"
            next += id
            entry.controller.replaceRoute(id, coords, parseColor(part.optString("color", "#7bdc72")), 4f)
        }
        (entry.routeIds - next).forEach(entry.controller::removeRoute)
        entry.routeIds.clear(); entry.routeIds.addAll(next)
    }

    private fun applyTrackOverlay(entry: MapEntry, overlay: JSONObject) {
        val next = linkedSetOf<String>()
        if (overlay.optBoolean("visible", true)) {
            val saved = overlay.optJSONArray("saved") ?: JSONArray()
            for (i in 0 until saved.length()) {
                val track = saved.optJSONObject(i) ?: continue
                if (track.optBoolean("hidden")) continue
                val id = track.optString("id").takeIf(String::isNotBlank) ?: continue
                val style = track.optJSONObject("style")
                val color = parseColor(style?.optString("color", "#ffb477") ?: "#ffb477")
                val width = style?.optDouble("width", 1.5) ?: 1.5
                val segments = track.optJSONArray("segments") ?: continue
                for (si in 0 until segments.length()) {
                    val coords = readCoordinates(segments.optJSONArray(si) ?: continue)
                    if (coords.size < 2) continue
                    val pathId = "track:$id:$si"
                    next += pathId
                    entry.controller.replaceRoute(pathId, coords, color, width.toFloat().coerceIn(0.5f, 5f))
                }
            }
            val draft = overlay.optJSONArray("draft")
            if (draft != null) for (i in 0 until draft.length()) {
                val coords = readCoordinates(draft.optJSONArray(i) ?: continue)
                if (coords.size < 2) continue
                val id = "track:__draft:$i"
                next += id
                val style = overlay.optJSONObject("style")
                entry.controller.replaceRoute(id, coords, parseColor(style?.optString("color", "#d0f76b") ?: "#d0f76b"), (style?.optDouble("width", 2.0) ?: 2.0).toFloat())
            }
        }
        (entry.trackIds - next).forEach(entry.controller::removeRoute)
        entry.trackIds.clear(); entry.trackIds.addAll(next)
    }

    private fun applyAreaOverlay(entry: MapEntry, overlay: JSONObject) {
        val next = linkedSetOf<String>()
        val items = overlay.optJSONArray("items") ?: JSONArray()
        val selected = overlay.optString("selected").takeIf { it.isNotBlank() && it != "null" }
        val preview = overlay.optJSONObject("preview")
        for (i in 0 until items.length()) {
            val area = items.optJSONObject(i) ?: continue
            val id = area.optString("id").takeIf(String::isNotBlank) ?: continue
            if (!area.optBoolean("visible", true)) continue
            val coords = readCoordinates(area.optJSONArray("boundary") ?: continue).toMutableList()
            if (preview?.optString("id") == id) {
                val index = preview.optInt("index", -1)
                val point = preview.optJSONArray("coordinate")
                val lon = point?.optDouble(0, Double.NaN) ?: Double.NaN
                val lat = point?.optDouble(1, Double.NaN) ?: Double.NaN
                if (index in coords.indices && lat.isFinite() && lat in -90.0..90.0 && lon.isFinite() && lon in -180.0..180.0) {
                    coords[index] = lat to lon
                }
            }
            if (coords.size < 3) continue
            next += id
            val color = parseColor(area.optString("color", "#d0f76b"))
            entry.controller.replaceArea(id, coords, color, 2f)
            val handles = if (selected == id) coords.let { values ->
                if (values.size > 1 && values.first() == values.last()) values.dropLast(1) else values
            } else emptyList()
            entry.controller.replaceAreaEditVertices(id, handles, color)
        }
        (entry.areaIds - next).forEach(entry.controller::removeArea)
        entry.areaIds.clear(); entry.areaIds.addAll(next)
        val draft = readCoordinates(overlay.optJSONArray("draft") ?: JSONArray())
        entry.controller.replaceAreaDraft(draft)
    }

    private fun applyPhotos(entry: MapEntry, photos: JSONArray) {
        // The bridge already bounds the complete message and each thumbnail. Annotation
        // photos are separate groups in the original UI; 201 groups must not reject the scene.
        val safe = JSONArray()
        for (i in 0 until photos.length()) {
            val photo = photos.optJSONObject(i) ?: continue
            // Blob URLs are not serializable across the WebView bridge. The adapter sends an
            // explicit, bounded thumbnail field; never log or echo the encoded image.
            val encoded = photo.optString("previewBase64")
            if (encoded.length !in 1..1_400_000) continue
            val copy = JSONObject()
                .put("id", photo.optString("id"))
                .put("name", photo.optString("name"))
                .put("coordinates", photo.optJSONArray("coordinates") ?: continue)
                .put("previewBase64", encoded)
                .put("visible", photo.optBoolean("visible", true))
                .put("hidden", photo.optBoolean("hidden", false))
                .put("kind", photo.optString("kind", "photo"))
                .put("annotationId", photo.optString("annotationId"))
                .put("mapIcon", photo.optString("mapIcon"))
                .put("mapColor", photo.optString("mapColor"))
                .put("groupIds", photo.optJSONArray("groupIds") ?: JSONArray())
            safe.put(copy)
        }
        entry.controller.replacePhotos(safe)
    }

    private fun applyPosition(entry: MapEntry, state: JSONObject) {
        val position = state.optJSONObject("position")
        if (position == null || position == JSONObject.NULL) {
            entry.controller.setPosition(NativePositionState(null, System.currentTimeMillis()))
            return
        }
        val coordinate = position.optJSONArray("coordinates") ?: JSONArray()
        val lon = coordinate.optDouble(0, Double.NaN); val lat = coordinate.optDouble(1, Double.NaN)
        val provider = when {
            position.optString("provider") == "ip" -> "ip"
            position.optString("source") == "network" -> "network"
            else -> "gps"
        }
        val speed = position.optDouble("speed", Double.NaN).takeIf(Double::isFinite)
        val course = position.optDouble("heading", Double.NaN).takeIf { it.isFinite() && it in 0.0..<360.0 }
        val fix = NativePositionFix(
            latitude = lat, longitude = lon,
            accuracyMeters = position.optDouble("accuracy", Double.NaN),
            timestampMillis = position.optLong("timestamp", 0), provider = provider,
            speedMetersPerSecond = speed, courseDegrees = course,
            courseAccuracyDegrees = position.optDouble("headingAccuracy", Double.NaN).takeIf(Double::isFinite),
        )
        val heading = state.optDouble("positionHeading", Double.NaN).takeIf { it.isFinite() && it in 0.0..<360.0 }
        entry.controller.setPosition(NativePositionState(
            fix = fix, nowMillis = System.currentTimeMillis(), headingDegrees = heading,
            headingSource = if (heading != null) NativeHeadingSource.MOTION else null,
            headingTimestampMillis = if (heading != null) System.currentTimeMillis() else null,
            mode = NativeDirectionMode.FREE,
        ))
    }

    private fun applySection(entry: MapEntry, state: JSONObject) {
        entry.sectionCollection?.sync(state)
        entry.sectionCollection?.setCursor(state.optJSONObject("section"), state.optJSONObject("sectionCursor"))
        val settings = state.optJSONObject("section") ?: return
        val sectionLayer = entry.sectionLayer ?: return
        val enabled = settings.optBoolean("enabled")
        if (enabled != entry.sectionWasEnabled) {
            val camera = cameraJson(entry)
            if (enabled) {
                val pitch = camera.optDouble("pitch", 0.0)
                entry.sectionOriginalPitch = pitch.takeIf { it < 5.0 }
                if (entry.sectionOriginalPitch != null) restoreCamera(entry, JSONObject(camera.toString()).put("pitch", 55.0))
            } else {
                entry.sectionOriginalPitch?.let { restoreCamera(entry, JSONObject(camera.toString()).put("pitch", it)) }
                entry.sectionOriginalPitch = null
            }
            entry.sectionWasEnabled = enabled
        }
        val signature = settings.toString() + "|" + (state.optJSONArray("annotations")?.toString() ?: "[]") + "|" + entry.controller.modelPlacementRevision()
        if (signature == entry.sectionInput) return
        entry.sectionInput = signature
        if (!settings.optBoolean("enabled")) {
            entry.sectionJob?.cancel(); entry.sectionJob = null; entry.sectionInput = signature
            sectionLayer.clear(); emitEvent(entry.id, "sectionStatus", NativeBridgeStateEvents.sectionPhase("disabled")); return
        }
        entry.sectionJob?.cancel()
        val generation = sectionLayer.beginRequest()
        emitEvent(entry.id, "sectionStatus", NativeBridgeStateEvents.sectionPhase("sampling"))
        val sampler = entry.controller.createSectionDemSampler()
        val annotations = state.optJSONArray("annotations") ?: JSONArray()
        val models = JSONArray()
        for (i in 0 until annotations.length()) {
            val model = annotations.optJSONObject(i) ?: continue
            if (model.optBoolean("visible", true) && model.optString("kind") != "pin") models.put(entry.controller.modelRenderInput(model))
        }
        if (settings.has("survey")) {
            val survey = settings.optJSONObject("survey") ?: settings
            val line = runCatching { com.shantu.nativeapp.section.NativeSurveyLine.parse(survey) }.getOrElse {
                sampler.close(); emitEvent(entry.id, "sectionStatus", NativeBridgeStateEvents.sectionPhase("error")); return
            }
            entry.sectionJob = entry.scope.launch {
                try {
                    val terrain = withContext(Dispatchers.IO) { sampler.sampleSurvey(line) }
                    if (isCurrent(entry) && entry.sectionInput == signature) {
                        // SurveyTerrain is persisted on the selected SectionSettings object; it is
                        // not a plane SectionProfileData and must never reach that chart callback.
                        emitEvent(entry.id, "sectionChange", JSONObject(settings.toString()).put("surveyTerrain", terrain.toJson()))
                        val valid = terrain.heightsMeters.count { it != null }
                        emitEvent(entry.id, "sectionStatus", NativeBridgeStateEvents.sectionPhase(
                            "ready", terrain.heightsMeters.size, valid, line.intervalMeters.toDouble(),
                            terrain.heightsMeters.filterNotNull().minOrNull(), terrain.heightsMeters.filterNotNull().maxOrNull(), 0, 0,
                        ))
                    }
                } catch (_: kotlinx.coroutines.CancellationException) { } catch (_: Throwable) {
                    if (isCurrent(entry) && entry.sectionInput == signature) emitEvent(entry.id, "sectionStatus", NativeBridgeStateEvents.sectionPhase("error"))
                } finally { sampler.close() }
            }
            return
        }
        val parsed = runCatching { com.shantu.nativeapp.section.NativeSectionSettings.parse(settings) }.getOrElse {
            sampler.close(); emitEvent(entry.id, "sectionStatus", NativeBridgeStateEvents.sectionPhase("error")); return
        }
        entry.sectionJob = entry.scope.launch {
            try {
                val snapshot = withContext(Dispatchers.IO) { sampler.sample(parsed, (0 until models.length()).map { models.getJSONObject(it) }) }
                if (isCurrent(entry) && entry.sectionInput == signature) {
                    val notes = settings.optJSONArray("notes") ?: JSONArray()
                    sectionLayer.show(snapshot, notes, generation)
                    NativeBridgeSectionCollection.tagLayer(sectionLayer.layer)
                    emitEvent(entry.id, "sectionProfile", snapshot.toProfileJson())
                    emitEvent(entry.id, "sectionStatus", NativeBridgeStateEvents.section(snapshot))
                }
            } catch (_: kotlinx.coroutines.CancellationException) { } catch (_: Throwable) {
                if (isCurrent(entry) && entry.sectionInput == signature) emitEvent(entry.id, "sectionStatus", NativeBridgeStateEvents.sectionPhase("error"))
            } finally { sampler.close() }
        }
    }

    private fun cameraCommand(mapId: String, command: String, payload: JSONObject, requestId: String) {
        val result = runCamera(requireEntry(mapId), command, payload)
        send("result", mapId, requestId, result)
    }

    private fun gestureCapture(mapId: String, payload: JSONObject, requestId: String) {
        val entry = requireEntry(mapId)
        val gestureId = payload.optLong("gestureId", -1L)
        val enabled = payload.optBoolean("enabled")
        if (enabled) {
            require(gestureId > 0L && gestureId == entry.gestureSequence) { "触摸手势已失效" }
            entry.capturedGestureId = gestureId
            entry.adapterCapturedGesture = true
        } else if (entry.capturedGestureId == gestureId || gestureId <= 0L) { entry.capturedGestureId = null; entry.adapterCapturedGesture = false }
        send("result", mapId, requestId, JSONObject().put("applied", true).put("gestureId", gestureId).put("enabled", entry.capturedGestureId == gestureId))
    }

    private fun runCamera(entry: MapEntry, command: String, payload: JSONObject): JSONObject {
        val controller = entry.controller
        entry.cameraOrigin.command(command, payload)
        if (command in setOf("zoom", "north", "reset", "viewGesture", "fitRoute", "fitCollection", "previewRoute", "previewNavigation",
                "focusPoint", "focusCenter", "focusPosition", "followNavigation", "previewTrackNode", "focusRouteGap", "focusRouteIssue")) {
            cancelCameraAnimation(entry)
        }
        when (command) {
            "camera", "applyCamera", "restoreCamera" -> restoreCamera(entry, payload.optJSONObject("camera") ?: payload)
            "zoom" -> controller.zoomBy(payload.optDouble("amount", 0.0))
            "north" -> controller.resetNorth()
            "reset" -> controller.restoreCamera(NativeCameraSnapshot(28.0, 10.0, 19_000_000.0, 0.0, 0.0))
            "view" -> {
                val current = controller.cameraSnapshot()
                restoreCamera(entry, JSONObject(payload.toString()).apply {
                    if (!has("center")) put("center", JSONArray().put(current.longitude).put(current.latitude))
                    if (!has("zoom")) put("zoom", rangeToZoom(current.rangeMeters, current.latitude, entry.viewport?.optJSONObject("cssRect")?.optDouble("height", 0.0) ?: 0.0))
                    if (!has("bearing")) put("bearing", current.headingDegrees)
                    if (!has("pitch")) put("pitch", current.pitchDegrees)
                })
            }
            "viewGesture" -> {
                val current = controller.cameraSnapshot()
                controller.restoreCamera(current.copy(headingDegrees = payload.optDouble("bearing", payload.optDouble("heading", current.headingDegrees)), pitchDegrees = payload.optDouble("pitch", current.pitchDegrees)))
            }
            "panZoomGesture" -> {
                val camera = payload.optJSONObject("camera") ?: throw IllegalArgumentException("panZoomGesture camera缺失")
                restoreCamera(entry, camera)
                val anchor = payload.optJSONObject("anchor")
                if (anchor != null) lockAnchor(entry, anchor)
            }
            "finishPanZoomGesture" -> Unit // Empty finish packets close gesture bookkeeping only.
            "setTerrainMode" -> {
                val section = entry.renderState.optJSONObject("section")
                val requested = JSONObject().put("terrain", payload.optBoolean("enabled", payload.optBoolean("terrain", payload.optString("mode") in setOf("3d", "terrain"))))
                payload.optDouble("exaggeration", Double.NaN).takeIf(Double::isFinite)?.let { requested.put("exaggeration", it) }
                val effective = NativeBridgeSectionTerrain.effective(requested, section)
                controller.setTerrain(effective.optBoolean("terrain"))
                effective.optDouble("exaggeration", Double.NaN).takeIf(Double::isFinite)?.let(controller::setTerrainExaggeration)
            }
            "fitRoute", "fitCollection", "previewRoute", "previewNavigation" -> {
                val coords = readCoordinates(payload.optJSONArray("coordinates") ?: payload.optJSONObject("route")?.optJSONArray("coordinates") ?: JSONArray())
                if (coords.isNotEmpty()) controller.restoreCamera(NativeRouteViewport.fit(coords.map { NativeCoordinate(it.second, it.first) }, controller.cameraSnapshot(), controller.view.width, controller.view.height))
            }
            "followPosition" -> restoreCamera(entry, NativeBridgeFollowCamera.target(cameraJson(entry), payload))
            "focusPoint", "focusCenter", "focusPosition", "followNavigation", "previewTrackNode", "focusRouteGap", "focusRouteIssue" -> {
                val coordinate = payload.optJSONArray("coordinate") ?: payload.optJSONArray("coordinates") ?: payload.optJSONObject("position")?.optJSONArray("coordinates") ?: JSONArray()
                val lon = coordinate.optDouble(0, Double.NaN); val lat = coordinate.optDouble(1, Double.NaN)
                if (lat.isFinite() && lat in -90.0..90.0 && lon.isFinite() && lon in -180.0..180.0) {
                    val current = controller.cameraSnapshot()
                    controller.restoreCamera(current.copy(latitude = lat, longitude = lon, rangeMeters = payload.optDouble("rangeMeters", current.rangeMeters)))
                } else if (command in setOf("focusRouteGap", "focusRouteIssue", "followNavigation")) {
                    val coords = readCoordinates(payload.optJSONArray("coordinates") ?: payload.optJSONObject("route")?.optJSONArray("coordinates") ?: JSONArray())
                    if (coords.isNotEmpty()) controller.restoreCamera(NativeRouteViewport.fit(coords.map { NativeCoordinate(it.second, it.first) }, controller.cameraSnapshot(), controller.view.width, controller.view.height))
                } else require(false) { "中心坐标无效" }
            }
            "stop" -> cancelCameraAnimation(entry)
            "clearRouteGap", "clearRouteIssue", "highlightOffline" -> Unit
        }
        emitCamera(entry)
        return JSONObject().put("applied", true).put("camera", cameraJson(entry))
    }

    private fun restoreCamera(entry: MapEntry, camera: JSONObject) {
        val requestedZoom = camera.optDouble("zoom", Double.NaN)
        if (!camera.has("rangeMeters") && requestedZoom.isFinite() &&
            (entry.viewport?.optJSONObject("cssRect")?.optDouble("height", 0.0) ?: 0.0) <= 0.0) {
            entry.pendingCamera = JSONObject(camera.toString())
            return
        }
        val center = camera.optJSONArray("center")
        val lat = if (center != null) center.optDouble(1, Double.NaN) else camera.optDouble("latitude", Double.NaN)
        val lon = if (center != null) center.optDouble(0, Double.NaN) else camera.optDouble("longitude", Double.NaN)
        val pitch = camera.optDouble("pitch", 0.0)
        val bearing = camera.optDouble("bearing", camera.optDouble("headingDegrees", 0.0))
        val roll = camera.optDouble("roll", 0.0)
        val heightCss = entry.viewport?.optJSONObject("cssRect")?.optDouble("height", 0.0) ?: 0.0
        val zoom = camera.optDouble("zoom", Double.NaN)
        val range = if (camera.has("rangeMeters")) camera.optDouble("rangeMeters") else zoomToRange(zoom, lat, heightCss)
        val target = NativeCameraSnapshot(lat, lon, range, bearing, pitch, roll)
        val offset = camera.optJSONArray("offset")?.takeIf { it.length() >= 2 }?.let {
            val x = it.optDouble(0, Double.NaN); val y = it.optDouble(1, Double.NaN)
            if (x.isFinite() && y.isFinite()) x to y else null
        }
        val duration = camera.optLong("duration", 0L).coerceIn(0L, 10_000L)
        cancelCameraAnimation(entry)
        if (duration > 0L && entry.controller.view.width > 0 && entry.controller.view.height > 0) {
            val start = entry.controller.cameraSnapshot()
            lateinit var animator: ValueAnimator
            animator = ValueAnimator.ofFloat(0f, 1f).apply {
                this.duration = duration
                interpolator = LinearInterpolator()
                addUpdateListener { animation ->
                    if (maps[entry.id] !== entry || closed || entry.cameraAnimator !== animator) return@addUpdateListener
                    val t = animation.animatedValue as Float
                    val pose = NativeCameraSnapshot(
                        start.latitude + (target.latitude - start.latitude) * t,
                        start.longitude + wrappedLongitudeDelta(start.longitude, target.longitude) * t,
                        start.rangeMeters + (target.rangeMeters - start.rangeMeters) * t,
                        start.headingDegrees + wrappedAngleDelta(start.headingDegrees, target.headingDegrees) * t,
                        start.pitchDegrees + (target.pitchDegrees - start.pitchDegrees) * t,
                        start.rollDegrees + (target.rollDegrees - start.rollDegrees) * t,
                    )
                    entry.controller.restoreCamera(pose)
                    offset?.let { lockCoordinateAtScreen(entry, pose.latitude, pose.longitude, entry.controller.view.width / 2.0 + it.first * cssScale(entry), entry.controller.view.height / 2.0 + it.second * cssScale(entry)) }
                }
                addListener(object : android.animation.AnimatorListenerAdapter() {
                    override fun onAnimationEnd(animation: android.animation.Animator) {
                        if (entry.cameraAnimator === animator) {
                            entry.cameraAnimator = null
                            if (isCurrent(entry)) emitCamera(entry)
                        }
                    }
                })
            }
            entry.cameraAnimator = animator; animator.start()
        } else {
            entry.controller.restoreCamera(target)
            offset?.let { lockCoordinateAtScreen(entry, target.latitude, target.longitude, entry.controller.view.width / 2.0 + it.first * cssScale(entry), entry.controller.view.height / 2.0 + it.second * cssScale(entry)) }
        }
        emitCamera(entry)
    }

    private fun lockAnchor(entry: MapEntry, anchor: JSONObject) {
        val coordinate = anchor.optJSONArray("coordinate") ?: return
        val lon = coordinate.optDouble(0, Double.NaN); val lat = coordinate.optDouble(1, Double.NaN)
        val to = anchor.optJSONObject("to") ?: return
        val scale = cssScale(entry)
        val x = to.optDouble("x", Double.NaN) * scale; val y = to.optDouble("y", Double.NaN) * scale
        if (!lon.isFinite() || !lat.isFinite() || lon !in -180.0..180.0 || lat !in -90.0..90.0 || !x.isFinite() || !y.isFinite()) return
        lockCoordinateAtScreen(entry, lat, lon, x, y)
    }

    /** Translate the camera using actual WorldWind ground projection so the requested WGS84 point stays under a screen point. */
    private fun lockCoordinateAtScreen(entry: MapEntry, latitude: Double, longitude: Double, targetX: Double, targetY: Double) {
        val controller = entry.controller
        repeat(3) {
            val ground = controller.unprojectCoordinate(targetX.toFloat(), targetY.toFloat()) ?: return
            val pose = controller.cameraSnapshot()
            val dLat = latitude - ground.first
            val dLon = wrappedLongitudeDelta(ground.second, longitude)
            if (kotlin.math.abs(dLat) < 1e-8 && kotlin.math.abs(dLon) < 1e-8) return
            controller.restoreCamera(pose.copy(latitude = (pose.latitude + dLat).coerceIn(-89.999999, 89.999999), longitude = pose.longitude + dLon))
        }
    }

    private fun wrappedLongitudeDelta(from: Double, to: Double): Double = ((to - from + 540.0) % 360.0) - 180.0
    private fun wrappedAngleDelta(from: Double, to: Double): Double = ((to - from + 540.0) % 360.0) - 180.0

    private fun cameraJson(entry: MapEntry): JSONObject {
        val camera = entry.controller.cameraSnapshot()
        val height = entry.viewport?.optJSONObject("cssRect")?.optDouble("height", 0.0) ?: 0.0
        return NativeBridgeCameraOrigin.annotate(cameraJson(camera, height), entry.cameraOrigin.token)
    }

    private fun cameraJson(camera: NativeCameraSnapshot, height: Double): JSONObject {
        val zoom = rangeToZoom(camera.rangeMeters, camera.latitude, height)
        return JSONObject()
            .put("center", JSONArray().put(camera.longitude).put(camera.latitude))
            .put("zoom", zoom).put("pitch", camera.pitchDegrees).put("bearing", camera.headingDegrees)
            .put("detailZoom", zoom)
    }

    private fun emitCamera(entry: MapEntry) {
        if (entry.controller.worldWindowForBridge().engine.viewport.isEmpty) return
        entry.cameraRevision++
        emitEvent(entry.id, "camera", cameraJson(entry), extra = JSONObject().put("revision", entry.cameraRevision))
        markFrameDirty(entry)
    }

    private fun project(mapId: String, payload: JSONObject, requestId: String) {
        val entry = requireEntry(mapId)
        val points = payload.optJSONArray("coordinates") ?: JSONArray().put(payload.optJSONArray("coordinate") ?: JSONArray())
        val out = JSONArray()
        for (i in 0 until points.length()) {
            val pair = points.optJSONArray(i) ?: continue
            val lon = pair.optDouble(0, Double.NaN); val lat = pair.optDouble(1, Double.NaN)
            val point = entry.controller.projectCoordinate(lat, lon) ?: run { out.put(JSONObject.NULL); continue }
            val scale = cssScale(entry)
            out.put(JSONObject().put("x", point.first / scale).put("y", point.second / scale))
        }
        send("result", mapId, requestId, JSONObject().put("points", out))
    }

    private fun unproject(mapId: String, payload: JSONObject, requestId: String) {
        val entry = requireEntry(mapId)
        val points = payload.optJSONArray("points") ?: JSONArray().put(payload.optJSONObject("point") ?: payload)
        val out = JSONArray()
        val scale = cssScale(entry)
        for (i in 0 until points.length()) {
            val point = points.optJSONObject(i) ?: continue
            val coordinate = entry.controller.unprojectCoordinate((finite(point, "x") * scale).toFloat(), (finite(point, "y") * scale).toFloat())
            out.put(coordinate?.let { JSONArray().put(it.second).put(it.first) } ?: JSONObject.NULL)
        }
        send("result", mapId, requestId, JSONObject().put("coordinates", out))
    }

    private fun pick(mapId: String, payload: JSONObject, requestId: String) {
        val entry = requireEntry(mapId)
        val rect = payload.optJSONObject("rect")
        val scale = cssScale(entry)
        val x = (rect?.optDouble("x") ?: payload.optDouble("x", Double.NaN)) * scale
        val y = (rect?.optDouble("y") ?: payload.optDouble("y", Double.NaN)) * scale
        val w = (rect?.optDouble("width") ?: 0.0) * scale
        val h = (rect?.optDouble("height") ?: 0.0) * scale
        require(listOf(x, y, w, h).all(Double::isFinite) && w >= 0 && h >= 0) { "拾取范围无效" }
        val coordinate = entry.controller.unprojectCoordinate(x.toFloat(), y.toFloat())
        entry.controller.pickObjectIds(android.graphics.RectF(x.toFloat(), y.toFloat(), (x + w).toFloat(), (y + h).toFloat())) { ids ->
            if (!isCurrent(entry)) return@pickObjectIds
            val value = JSONObject().put("ids", JSONArray(ids)).put("coordinate", coordinate?.let { JSONArray().put(it.second).put(it.first) } ?: JSONObject.NULL)
            emitEvent(mapId, "pick", value, requestId)
            ids.forEach { id ->
                val bridgeObject = id.removePrefix("shantu-bridge:").takeIf { it != id }?.let { runCatching { JSONObject(it) }.getOrNull() }
                val kind = bridgeObject?.optString("kind")?.takeIf(String::isNotBlank) ?: when {
                    id.startsWith("geology:") -> "geology"
                    id.startsWith("shantu-photo:") -> "photo"
                    id in entry.routeIds -> "route"
                    id in entry.trackIds -> "track"
                    id in entry.areaIds -> "area"
                    else -> "annotation"
                }
                val photoId = id.removePrefix("shantu-photo:").takeIf { it != id }
                val selected = JSONObject().put("kind", kind).put("id", bridgeObject?.optString("trackId", photoId ?: id) ?: photoId ?: id)
                    .put("coordinate", coordinate?.let { JSONArray().put(it.second).put(it.first) } ?: JSONObject.NULL)
                bridgeObject?.let { b -> listOf("trackId", "coordinate", "slot", "node", "linePoint", "move", "phase").forEach { key -> if (b.has(key)) selected.put(key, b.opt(key)) } }
                if (photoId != null) {
                    val photos = entry.renderState.optJSONArray("photos") ?: JSONArray()
                    for (index in 0 until photos.length()) {
                        val photo = photos.optJSONObject(index) ?: continue
                        if (photo.optString("id") == photoId) {
                            selected.put("annotationId", photo.optString("annotationId"))
                            selected.put("groupIds", photo.optJSONArray("groupIds") ?: JSONArray().put(photoId))
                            break
                        }
                    }
                }
                emitEvent(mapId, "objectSelect", selected, requestId)
            if (kind == "geology") entry.controller.selectGeology(id.removePrefix("geology:"))
            }
        }
        send("result", mapId, requestId, JSONObject().put("pending", true).put("coordinate", coordinate?.let { JSONArray().put(it.second).put(it.first) } ?: JSONObject.NULL))
    }

    private fun getElevation(mapId: String, payload: JSONObject, requestId: String) {
        val entry = requireEntry(mapId)
        val lat = finite(payload, "latitude"); val lon = finite(payload, "longitude")
        require(lat in -90.0..90.0 && lon in -180.0..180.0) { "高程坐标无效" }
        val value = entry.controller.getElevation(lat, lon, retrieve = true)
        send("result", mapId, requestId, JSONObject().put("elevation", value ?: JSONObject.NULL).put("cached", value != null))
    }

    private fun capture(mapId: String, payload: JSONObject, requestId: String) {
        val entry = requireEntry(mapId)
        val view = entry.controller.view
        require(Build.VERSION.SDK_INT >= 24 && view is SurfaceView) { "当前设备不支持地图帧捕获" }
        val bitmap = Bitmap.createBitmap(view.width.coerceAtLeast(1), view.height.coerceAtLeast(1), Bitmap.Config.ARGB_8888)
        PixelCopy.request(view, bitmap, { result ->
            if (!isCurrent(entry)) { bitmap.recycle(); return@request }
            if (result != PixelCopy.SUCCESS) {
                bitmap.recycle()
                postError(requestId, mapId, "capture_failed", "地图帧捕获失败")
                return@request
            }
            val maxDimension = payload.optInt("maxDimension", 2048).coerceIn(64, 2048)
            val output = if (maxOf(bitmap.width, bitmap.height) > maxDimension) {
                val factor = maxDimension.toDouble() / maxOf(bitmap.width, bitmap.height)
                Bitmap.createScaledBitmap(bitmap, (bitmap.width * factor).toInt().coerceAtLeast(1), (bitmap.height * factor).toInt().coerceAtLeast(1), true).also { bitmap.recycle() }
            } else bitmap
            val outputWidth = output.width; val outputHeight = output.height
            val bytes = ByteArrayOutputStream().use { stream -> output.compress(Bitmap.CompressFormat.JPEG, 82, stream); stream.toByteArray() }
            output.recycle()
            if (bytes.size > MAX_CAPTURE_BYTES) {
                postError(requestId, mapId, "capture_too_large", "地图帧超过捕获限制")
            } else {
                send("result", mapId, requestId, JSONObject().put("dataUrl", "data:image/jpeg;base64," + android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)).put("width", outputWidth).put("height", outputHeight))
            }
        }, main)
    }

    private fun cancelRequest(payload: JSONObject, requestId: String, mapId: String?) {
        val target = payload.optString("targetRequestId")
        val share = shareJobs[target]
        val shareCancelled = target.isNotBlank() && share != null && (mapId == null || share.first == mapId)
        if (shareCancelled) { shareJobs.remove(target); share!!.second.cancel() }
        // Section and DEM jobs follow render-state ownership; native touch picks follow gesture
        // ownership. A generic bridge abort has neither owner token and cannot cancel them.
        send("result", mapId, requestId, JSONObject().put("cancelled", shareCancelled).put("targetRequestId", target))
    }

    private fun renderShareMap(mapId: String, payload: JSONObject, requestId: String) {
        requireEntry(mapId)
        require(!shareJobs.containsKey(requestId)) { "分享地图请求编号重复" }
        val cloud = privateConfig.optJSONObject("geocloud")?.optString("token")?.takeIf(String::isNotBlank)?.let {
            com.shantu.nativeapp.geology.NativeGeologyCredentials(it,
                privateConfig.optJSONObject("geocloud")?.optString("service", "qg20_20210401_FCnDDRJd").orEmpty(),
                privateConfig.optJSONObject("geocloud")?.optString("layer").orEmpty())
        }
        val renderer = NativeBridgeShareMapRenderer(appContext, root, privateConfig.optString("tiandituKey").orEmpty(), assets::resolve, cloud)
        val job = shareScope.launch {
            try {
                val result = withTimeout(SHARE_RENDER_TIMEOUT_MS) { renderer.render(payload) }
                send("result", mapId, requestId, result)
            } catch (_: kotlinx.coroutines.TimeoutCancellationException) {
                if (!closed && sessionId != null) postError(requestId, mapId, "share_render_timeout", "分享地图加载超时，请检查图源或网络后重试")
            } catch (_: kotlinx.coroutines.CancellationException) {
                if (!closed && sessionId != null) postError(requestId, mapId, "share_cancelled", "分享地图已取消")
            } catch (error: Throwable) {
                if (appContext.packageName == "com.shantu.hybridprobe") {
                    // Probe diagnostics contain types and source locations only, never URL/message/payload data.
                    android.util.Log.e("ShantuHybridShare", error.javaClass.simpleName + " " + error.stackTrace.take(8).joinToString(" <- "))
                }
                postError(requestId, mapId, "share_render_failed", "分享地图未能完成渲染")
            } finally {
                renderer.close()
                shareJobs.remove(requestId)
            }
        }
        shareJobs[requestId] = mapId to job
    }

    /** GL activity is cheap; metadata and MVP are paired only through a prepared draw witness. */
    private fun onNativeFrameActivity(entry: MapEntry) {
        entry.actualFrameCount.incrementAndGet()
        entry.lastActualFrameAt.set(android.os.SystemClock.elapsedRealtime())
        val demRevision = entry.controller.demRevision()
        if (demRevision != entry.capturedDemRevision || entry.snapRevision != entry.capturedSnapRevision) {
            if (entry.frameMetadataNoticePending.compareAndSet(false, true)) main.post {
                entry.frameMetadataNoticePending.set(false)
                if (isCurrent(entry) && (entry.controller.demRevision() != entry.capturedDemRevision ||
                        entry.snapRevision != entry.capturedSnapRevision)) markFrameDirty(entry)
            }
        }
        if (!entry.disposed && (entry.viewportMismatchPendingCheck || entry.nativeSizePendingCheck) &&
            entry.viewportMismatchNoticePending.compareAndSet(false, true)) main.post {
            if (!isCurrent(entry) || !entry.frameCaptureGate.hasPending() ||
                entry.frameCaptureTask != null || entry.frameWitnessPending) {
                entry.viewportMismatchNoticePending.set(false)
                return@post
            }
            val rect = entry.viewport?.optJSONObject("cssRect") ?: run {
                entry.viewportMismatchNoticePending.set(false)
                return@post
            }
            val (expectedWidth, expectedHeight) = expectedNativeViewport(entry, rect)
            val viewport = entry.controller.worldWindowForBridge().engine.viewport
            val view = entry.controller.view
            val matches = view.width == expectedWidth && view.height == expectedHeight &&
                viewport.width == expectedWidth && viewport.height == expectedHeight
            val signature = "${expectedWidth}x${expectedHeight}/${view.width}x${view.height}/${viewport.width}x${viewport.height}"
            if (matches) {
                entry.viewportMismatchPendingCheck = false
                entry.nativeSizePendingCheck = false
                entry.lastViewportMismatchSignature = null
                markFrameDirty(entry)
            } else if (signature != entry.lastViewportMismatchSignature) {
                entry.viewportMismatchPendingCheck = true
                entry.nativeSizePendingCheck = view.width <= 0 || view.height <= 0
                entry.lastViewportMismatchSignature = signature
                entry.expectedNativeWidth = expectedWidth
                entry.expectedNativeHeight = expectedHeight
                markFrameDirty(entry)
            }
            entry.viewportMismatchNoticePending.set(false)
        }
    }

    private fun expectedNativeViewport(entry: MapEntry, cssRect: JSONObject): Pair<Int, Int> {
        val scale = cssScale(entry)
        return (cssRect.optDouble("width", 0.0) * scale).toInt().coerceAtLeast(1) to
            (cssRect.optDouble("height", 0.0) * scale).toInt().coerceAtLeast(1)
    }

    private fun onCameraMatrixChanged(entry: MapEntry, mvp: DoubleArray) {
        entry.lastRenderedMatrix = mvp
        entry.lastCameraMotionAt = android.os.SystemClock.elapsedRealtime()
        main.post { if (isCurrent(entry)) markFrameDirty(entry) }
    }

    private fun onRenderedFrame(entry: MapEntry, metadata: FrameMetadata, mvp: DoubleArray, width: Int, height: Int) {
        entry.latestFrame.offer(RenderedFrame(metadata, mvp, width, height))
        queueLatestFrame(entry)
    }

    private fun markFrameDirty(entry: MapEntry) {
        if (!isCurrent(entry)) return
        entry.frameCaptureGate.markDirty()
        queueFrameCapture(entry)
    }

    private fun queueFrameCapture(entry: MapEntry) {
        if (!isCurrent(entry) || !entry.frameCaptureGate.hasPending() || entry.frameCaptureTask != null || entry.frameWitnessPending) return
        val interval = NativeBridgeFramePolicy.intervalMillis(realtimeFrameRequired(entry))
        val now = android.os.SystemClock.elapsedRealtime()
        val task = Runnable {
            entry.frameCaptureTask = null
            if (!isCurrent(entry)) return@Runnable
            val viewport = entry.viewport ?: return@Runnable
            val rect = viewport.optJSONObject("cssRect") ?: return@Runnable
            if (rect.optDouble("width") <= 0.0 || rect.optDouble("height") <= 0.0) return@Runnable
            if (entry.controller.view.width <= 0 || entry.controller.view.height <= 0) {
                entry.nativeSizePendingCheck = true
                return@Runnable
            }
            val captureAt = android.os.SystemClock.elapsedRealtime()
            if (!entry.frameCaptureGate.isDue(captureAt, NativeBridgeFramePolicy.intervalMillis(realtimeFrameRequired(entry)))) {
                queueFrameCapture(entry)
                return@Runnable
            }
            entry.frameCaptureGate.markAttempt(captureAt)
            entry.frameWitnessPending = true
            entry.controller.prepareBridgeFrameWitness {
                try {
                    if (entry.disposed) return@prepareBridgeFrameWitness null
                    val currentViewport = entry.viewport ?: return@prepareBridgeFrameWitness null
                    val currentRect = currentViewport.optJSONObject("cssRect") ?: return@prepareBridgeFrameWitness null
                    if (currentRect.optDouble("width") <= 0.0 || currentRect.optDouble("height") <= 0.0 ||
                        entry.controller.view.width <= 0 || entry.controller.view.height <= 0) {
                        entry.nativeSizePendingCheck = currentRect.optDouble("width") > 0.0 && currentRect.optDouble("height") > 0.0
                        return@prepareBridgeFrameWitness null
                    }
                    val (expectedWidth, expectedHeight) = expectedNativeViewport(entry, currentRect)
                    val engineViewport = entry.controller.worldWindowForBridge().engine.viewport
                    if (engineViewport.width != expectedWidth || engineViewport.height != expectedHeight) {
                        entry.viewportMismatchPendingCheck = true
                        return@prepareBridgeFrameWitness null
                    }
                    entry.viewportMismatchPendingCheck = false
                    entry.nativeSizePendingCheck = false
                    entry.lastViewportMismatchSignature = null
                    val metadata = FrameMetadata(
                        camera = entry.controller.cameraSnapshot(),
                        cameraSyncToken = entry.cameraOrigin.token,
                        eye = NativeBridgeEyeState.from(entry.controller.worldWindowForBridge().engine.camera),
                        cssX = currentRect.optDouble("x", 0.0), cssY = currentRect.optDouble("y", 0.0),
                        cssWidth = currentRect.optDouble("width", 0.0), cssHeight = currentRect.optDouble("height", 0.0),
                        cssScale = cssScale(entry), nativeWidth = engineViewport.width, nativeHeight = engineViewport.height,
                        terrainEnabled = entry.controller.isTerrainEnabled(),
                        exaggeration = entry.renderExaggeration, demRevision = entry.controller.demRevision(),
                        snapRevision = entry.snapRevision, capturedAt = System.currentTimeMillis(),
                    )
                    entry.frameCaptureGate.markCaptured(android.os.SystemClock.elapsedRealtime())
                    entry.frameCaptureTask?.let(main::removeCallbacks)
                    entry.frameCaptureTask = null
                    entry.capturedDemRevision = metadata.demRevision
                    entry.capturedSnapRevision = metadata.snapRevision
                    NativeBridgeFrameWitness(metadata) { captured, mvp, width, height ->
                        if (!entry.disposed) onRenderedFrame(entry, captured, mvp, width, height)
                    }
                } finally {
                    entry.frameWitnessPending = false
                }
            }
            entry.controller.worldWindowForBridge().requestRedraw()
        }
        entry.frameCaptureTask = task
        main.postDelayed(task, entry.frameCaptureGate.delayUntilDue(now, interval))
    }

    private fun realtimeFrameRequired(entry: MapEntry): Boolean {
        val state = entry.renderState
        val interaction = state.optJSONObject("interaction")
        fun activeId(key: String) = state.optString(key).let { it.isNotBlank() && it != "null" }
        return maps.size > 1 || entry.id != "main" || entry.cameraAnimator != null ||
            state.optBoolean("positionNavigating") || entry.renderInteraction.drawingActive ||
            interaction?.optBoolean("pickingActive") == true || interaction?.optBoolean("annotationPicking") == true ||
            interaction?.optBoolean("measurementPicking") == true || activeId("annotationEditingId") ||
            state.optJSONObject("trackOverlay")?.optBoolean("editing") == true ||
            state.optBoolean("sectionEditing") || state.optJSONObject("section")?.optBoolean("enabled") == true
    }

    private fun queueLatestFrame(entry: MapEntry) {
        if (!entry.framePublishPending.compareAndSet(false, true)) return
        main.post {
            if (!isCurrent(entry)) { entry.framePublishPending.set(false); return@post }
            val now = android.os.SystemClock.elapsedRealtime()
            val interval = NativeBridgeFramePolicy.intervalMillis(realtimeFrameRequired(entry))
            val delay = if (entry.lastMatrixAt == 0L) 0L else (interval - (now - entry.lastMatrixAt)).coerceAtLeast(0L)
            val task = Runnable { publishLatestFrame(entry) }
            entry.framePublishTask = task
            main.postDelayed(task, delay)
        }
    }

    private fun scheduleSettledFrame(entry: MapEntry) {
        entry.settledFrameTask?.let(main::removeCallbacks)
        val task = Runnable {
            entry.settledFrameTask = null
            if (!isCurrent(entry)) return@Runnable
            val quietFor = android.os.SystemClock.elapsedRealtime() - entry.lastCameraMotionAt
            if (quietFor < NativeBridgeFramePolicy.QUIET_MILLIS) scheduleSettledFrame(entry)
            else markFrameDirty(entry)
        }
        entry.settledFrameTask = task
        val delay = (NativeBridgeFramePolicy.QUIET_MILLIS -
            (android.os.SystemClock.elapsedRealtime() - entry.lastCameraMotionAt)).coerceAtLeast(1L)
        main.postDelayed(task, delay)
    }

    private fun publishLatestFrame(entry: MapEntry) {
        try {
            val frame = entry.latestFrame.takeLatest() ?: return
            if (!isCurrent(entry)) return
            val now = android.os.SystemClock.elapsedRealtime()
            entry.lastMatrixAt = now
            val metadata = frame.metadata
            val width = frame.width; val height = frame.height; val matrixCopy = frame.matrix
            val realtimeTask = realtimeFrameRequired(entry)
            val groundWorkCadenceAllows = NativeBridgeFramePolicy.allowGroundWork(realtimeTask, now, entry.lastCameraMotionAt)
            val currentMatchesFrame = groundWorkCadenceAllows && frameMetadataMatchesCurrent(entry, metadata)
            val allowGroundWork = groundWorkCadenceAllows && currentMatchesFrame
            if (!isCurrent(entry)) return
            if (allowGroundWork && entry.cameraAnimator == null && entry.controller.refreshBridgeGroundAnchor()) {
                // The captured matrix predates the adjusted eye. Publish only a new real frame.
                markFrameDirty(entry)
                return
            }
            if (groundWorkCadenceAllows && !currentMatchesFrame) markFrameDirty(entry)
            if (allowGroundWork) entry.controller.refreshModelTerrain()?.let { publishModelTerrainStatus(entry, it) }
            val demRevision = metadata.demRevision
            val sectionNow = android.os.SystemClock.elapsedRealtime()
            if (allowGroundWork && demRevision != entry.sectionDemRevision && sectionNow - entry.lastSectionDemAt >= 1000L) {
                entry.sectionDemRevision = demRevision
                entry.lastSectionDemAt = sectionNow
                entry.sectionCollection?.afterDemUpdate()
                run {
                    val state = entry.renderState
                    if (state.optJSONObject("section")?.optBoolean("enabled") == true) {
                        entry.sectionInput = null
                        applySection(entry, state)
                    }
                }
            }
            val camera = NativeBridgeCameraOrigin.annotate(
                cameraJson(metadata.camera, metadata.nativeHeight / metadata.cssScale), metadata.cameraSyncToken)
            entry.controller.setBridgeMarkerPresentation(camera.optDouble("zoom", Double.NaN),
                entry.renderState.optString("annotationSelected").takeIf { id -> id.isNotBlank() && id != "null" })
            val matrices = NativeBridgeProjection.standardEcefMatrices(matrixCopy) ?: return
            val x = metadata.cssX * metadata.cssScale
            val y = metadata.cssY * metadata.cssScale
            entry.overlayRenderer?.setZoom(camera.optDouble("zoom", 0.0))
            val value = JSONObject()
                .put("sequence", ++matrixSequence)
                .put("camera", camera)
                .put("viewProjection", doubleArrayJson(matrices.first))
                .put("inverseViewProjection", doubleArrayJson(matrices.second))
                .put("viewport", JSONObject().put("x", x).put("y", y).put("width", width).put("height", height))
                .put("cssScale", metadata.cssScale)
                .put("clipDepth", "minusOneToOne")
                .put("verticalExaggeration", metadata.exaggeration)
                .put("terrainEnabled", metadata.terrainEnabled)
                .put("demRevision", metadata.demRevision)
                .put("snapRevision", metadata.snapRevision)
                .put("capturedAt", metadata.capturedAt)
            emitEvent(entry.id, "renderFrame", value)
            if (allowGroundWork) {
                syncAutoContourInterval(entry, camera)
                publishDemCache(entry, camera, width, height)
                publishSnapGeometry(entry)
            } else scheduleSettledFrame(entry)
        } finally {
            entry.framePublishTask = null
            entry.framePublishPending.set(false)
            if (isCurrent(entry) && entry.latestFrame.hasPending()) queueLatestFrame(entry)
        }
    }

    private fun frameMetadataMatchesCurrent(entry: MapEntry, metadata: FrameMetadata): Boolean {
        val viewport = entry.viewport?.optJSONObject("cssRect") ?: return false
        val currentEye = NativeBridgeEyeState.from(entry.controller.worldWindowForBridge().engine.camera)
        return currentEye == metadata.eye &&
            viewport.optDouble("x") == metadata.cssX && viewport.optDouble("y") == metadata.cssY &&
            viewport.optDouble("width") == metadata.cssWidth && viewport.optDouble("height") == metadata.cssHeight &&
            cssScale(entry) == metadata.cssScale && entry.controller.isTerrainEnabled() == metadata.terrainEnabled &&
            entry.controller.worldWindowForBridge().engine.viewport.width == metadata.nativeWidth &&
            entry.controller.worldWindowForBridge().engine.viewport.height == metadata.nativeHeight &&
            entry.renderExaggeration == metadata.exaggeration && entry.controller.demRevision() == metadata.demRevision &&
            entry.snapRevision == metadata.snapRevision
    }

    private fun privateExaggeration(entry: MapEntry): Double = entry.renderExaggeration

    private fun scheduleSnapPublish(entry: MapEntry) {
        if (entry.snapPublishScheduled) return
        entry.snapPublishScheduled = true
        main.postDelayed({
            entry.snapPublishScheduled = false
            if (!isCurrent(entry)) return@postDelayed
            if (!NativeBridgeFramePolicy.allowGroundWork(realtimeFrameRequired(entry),
                    android.os.SystemClock.elapsedRealtime(), entry.lastCameraMotionAt)) scheduleSnapPublish(entry)
            else publishSnapGeometry(entry)
        }, 500L)
    }

    private fun syncTerrainOverlay(entry: MapEntry, settings: JSONObject, zoom: Double) {
        val rawInterval = settings.opt("contourInterval")
        val interval = com.shantu.nativeapp.map.NativeContourIntervalPolicy.resolve(rawInterval, zoom)
        entry.contourAuto = rawInterval?.toString()?.equals("auto", ignoreCase = true) == true
        entry.contourIntervalMeters = interval
        entry.controller.setTerrainOverlay(
            contoursEnabled = settings.optBoolean("contours"),
            elevationColorsEnabled = settings.optBoolean("elevationColors"),
            contourIntervalMeters = interval,
            elevationColorsOpacity = settings.optDouble("elevationColorsOpacity", 1.0),
        )
    }

    private fun syncAutoContourInterval(entry: MapEntry, camera: JSONObject) {
        if (!entry.contourAuto) return
        val settings = entry.renderState.optJSONObject("settings") ?: return
        val interval = com.shantu.nativeapp.map.NativeContourIntervalPolicy.resolve(
            settings.opt("contourInterval"), camera.optDouble("zoom", Double.NaN),
        )
        if (interval != entry.contourIntervalMeters) syncTerrainOverlay(entry, settings, cameraJson(entry).optDouble("zoom", Double.NaN))
    }

    private fun applyOfflineDisplayPolicy(value: JSONObject?) {
        if (value == null) {
            com.shantu.nativeapp.map.NativeOfflineDisplayPolicy.reset()
            return
        }
        fun nullableString(key: String) = value.optString(key).takeIf { it.isNotBlank() && it != "null" }
        val templates = value.optJSONArray("vectorTileTemplates")?.let { array ->
            (0 until array.length()).mapNotNull { index -> array.optString(index).takeIf(String::isNotBlank) }.take(4)
        }.orEmpty()
        com.shantu.nativeapp.map.NativeOfflineDisplayPolicy.update(
            com.shantu.nativeapp.map.NativeOfflineDisplayPolicyState(
                version = value.optInt("version", 1),
                enabled = value.optBoolean("enabled"),
                packageId = nullableString("packageId"),
                sourceId = nullableString("sourceId"),
                provider = nullableString("provider"),
                vectorTileTemplates = templates,
            ),
        )
    }

    private fun publishSnapGeometry(entry: MapEntry, force: Boolean = false) {
        val snap = entry.snapGeometry ?: return
        val now = android.os.SystemClock.elapsedRealtime()
        if (!force && now - entry.lastSnapPublishAt < 500L) return
        entry.lastSnapPublishAt = now
        val settings = entry.renderState.optJSONObject("settings") ?: JSONObject()
        val interaction = entry.renderState.optJSONObject("interaction") ?: JSONObject()
        val roads = settings.optBoolean("roadsEnabled", settings.optBoolean("roads"))
        val rivers = interaction.optBoolean("riverSnapping")
        // Disabled snapping still publishes its hidden state, but needs no terrain rays.
        val bounds = if (!roads && !rivers) null else runCatching {
            val width = entry.controller.view.width.toFloat(); val height = entry.controller.view.height.toFloat()
            if (width <= 0 || height <= 0) return@runCatching null
            val corners = listOf(
                entry.controller.unprojectCoordinate(0f, 0f), entry.controller.unprojectCoordinate(width, 0f),
                entry.controller.unprojectCoordinate(width, height), entry.controller.unprojectCoordinate(0f, height),
            ).mapNotNull { it }
            if (corners.size != 4) null else {
                val lons = corners.map { it.second }; val lats = corners.map { it.first }
                if (lons.maxOrNull()!! - lons.minOrNull()!! > 180.0) null
                else listOf(lons.minOrNull()!!, lats.minOrNull()!!, lons.maxOrNull()!!, lats.maxOrNull()!!)
            }
        }.getOrNull()
        // Floating-point reconstruction jitter is not a camera move. Bounds at sub-metre
        // precision still track the visible geometry without rebuilding it on idle frames.
        val stableBounds = bounds?.map { kotlin.math.round(it * 1_000_000.0) / 1_000_000.0 }
        val boundsSignature = stableBounds?.joinToString(",")
        val inputSignature = listOf(boundsSignature, roads.toString(), rivers.toString()).joinToString("|")
        if (!force && !entry.snapTilesDirty && inputSignature == entry.snapInputSignature) return
        entry.snapTilesDirty = false
        if (inputSignature != entry.snapInputSignature) { entry.snapInputSignature = inputSignature; entry.snapRevision++; markFrameDirty(entry) }
        val update = runCatching {
            snap.snapshot(entry.snapRevision, stableBounds, roads, rivers)
        }.getOrNull() ?: return
        // Completed snapshots are immutable and reused by identity. Never walk the
        // complete road coordinate JSON on the input/render thread just to deduplicate it.
        if (update === entry.snapPublishedPayload) return
        entry.snapPublishedPayload = update
        emitBulkEvent(entry, "snapGeometry", update)
        // A changed snap revision needs a real matching frame even if the map is now idle.
        entry.controller.worldWindowForBridge().requestRedraw()
    }

    /** Ships a small viewport-local DEM cache sampled from the real native terrain coverage. */
    private fun publishDemCache(entry: MapEntry, camera: JSONObject, width: Int, height: Int) {
        val center = camera.optJSONArray("center") ?: return
        val lon = center.optDouble(0, Double.NaN); val lat = center.optDouble(1, Double.NaN)
        val zoom = camera.optDouble("zoom", Double.NaN)
        if (!lon.isFinite() || !lat.isFinite() || !zoom.isFinite() || width <= 0 || height <= 0) return
        val now = android.os.SystemClock.elapsedRealtime()
        val engine = entry.controller.worldWindowForBridge().engine
        if (engine.viewport.width != width || engine.viewport.height != height) return
        val terrainEnabled = entry.controller.isTerrainEnabled()
        val exaggeration = privateExaggeration(entry)
        val revision = entry.controller.demRevision().coerceAtLeast(0)
        val inputs = NativeBridgeDemSamplingGate.Inputs(
            camera = NativeBridgeDemSamplingGate.cameraFingerprint(
                longitude = lon,
                latitude = lat,
                zoom = zoom,
                pitch = camera.optDouble("pitch", Double.NaN),
                bearing = camera.optDouble("bearing", Double.NaN),
            ), viewportWidth = width, viewportHeight = height,
            cssScale = cssScale(entry), terrainEnabled = terrainEnabled,
            exaggeration = exaggeration, demRevision = revision,
        )
        val inputKey = inputs.fingerprint()
        val geometryKey = inputs.geometryFingerprint()
        if (entry.demSamplingGate.evaluate(inputKey, geometryKey, now, entry.demJob?.isActive == true) !=
            NativeBridgeDemSamplingGate.Decision.PLAN) return
        // New viewport inputs supersede the old job. Same-view DEM revision changes are held
        // pending by the gate above, avoiding repeated terrain rays while that job is active.
        entry.demSamplingGate.begin(inputKey, geometryKey, now)
        val footprint = try {
            buildList<NativeBridgeDemPlan.GroundPoint> {
                for (row in 0..4) for (column in 0..4) {
                    val ground = earth.worldwind.geom.Position()
                    val px = width * column / 4.0; val py = height * row / 4.0
                    if (engine.screenPointToGroundPosition(px, py, ground))
                        add(NativeBridgeDemPlan.GroundPoint(ground.longitude.inDegrees, ground.latitude.inDegrees))
                    val terrainCornerOrCenter = ((row == 0 || row == 4) && (column == 0 || column == 4)) || (row == 2 && column == 2)
                    if (terrainEnabled && terrainCornerOrCenter && engine.pickTerrainPosition(px, py, ground))
                        add(NativeBridgeDemPlan.GroundPoint(ground.longitude.inDegrees, ground.latitude.inDegrees))
                }
            }
        } catch (_: Throwable) {
            entry.demRetryAfterAt = now + NativeBridgeDemSamplingGate.PARTIAL_RETRY_MILLIS
            entry.demSamplingGate.finish(inputKey, now, NativeBridgeDemSamplingGate.PARTIAL_RETRY_MILLIS)
            return
        }
        val plan = NativeBridgeDemPlan.plan(zoom, NativeBridgeDemPlan.GroundPoint(lon, lat), footprint) ?: run {
            entry.demRetryAfterAt = now + NativeBridgeDemSamplingGate.PARTIAL_RETRY_MILLIS
            entry.demSamplingGate.finish(inputKey, now, NativeBridgeDemSamplingGate.PARTIAL_RETRY_MILLIS)
            return
        }
        val key = plan.tiles.joinToString(";") { "${it.z}/${it.x}/${it.y}" }
        val sameKey = key == entry.demKey
        if (sameKey && revision == entry.demRevision && now < entry.demRetryAfterAt) {
            entry.demSamplingGate.settleOnExistingCache(inputKey, now, entry.demRetryAfterAt)
            return
        }
        entry.demKey = key
        entry.demJob?.cancel()
        entry.controller.prepareBridgeDemCoverage()
        entry.demJob = entry.scope.launch {
            var gateSettled = false
            try {
                val tiles = mutableListOf<JSONObject>()
                val batches = listOf(plan.tiles.take(1)) + plan.tiles.drop(1).chunked(4)
                for (batch in batches) {
                    val loaded = withContext(Dispatchers.IO) { coroutineScope {
                        batch.map { tile -> async {
                            val tileId = "${tile.z}/${tile.x}/${tile.y}"
                            val cacheKey = "$tileId/$DEM_TILE_SIZE"
                            entry.demTileCache.get(cacheKey, android.os.SystemClock.elapsedRealtime())?.let { return@async it }
                            val source = try { entry.controller.sampleBridgeDemTile(tile.z, tile.x, tile.y, DEM_TILE_SIZE) }
                            catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
                            catch (_: Throwable) { null } ?: return@async null
                            val grid = NativeBridgeDemGrid.fromMercatorPixels(tile.z, tile.x, tile.y, source, DEM_TILE_SIZE) ?: return@async null
                            val heights = JSONArray().also { out -> grid.heights.forEach { out.put(it ?: JSONObject.NULL) } }
                            // Published grid objects are immutable; only the containing tile list grows.
                            JSONObject().put("id", tileId).put("west", grid.west).put("south", grid.south).put("east", grid.east).put("north", grid.north)
                                .put("width", grid.width).put("height", grid.height).put("heights", heights)
                                .also { entry.demTileCache.put(cacheKey, it, android.os.SystemClock.elapsedRealtime()) }
                        } }.awaitAll().filterNotNull()
                    } }
                    if (!isCurrent(entry) || entry.demKey != key) return@launch
                    tiles.addAll(loaded)
                    val latestRevision = entry.controller.demRevision().coerceAtLeast(0)
                    emitBulkEvent(entry, "demCache", JSONObject().put("revision", latestRevision).put("tiles", JSONArray(tiles)))
                    entry.demRevision = latestRevision
                    entry.controller.worldWindowForBridge().requestRedraw()
                }
                if (!isCurrent(entry) || entry.demKey != key) return@launch
                val sampledIds = tiles.mapNotNullTo(HashSet()) { tile -> tile.optString("id").takeIf { it.isNotBlank() } }
                val complete = plan.tiles.all { "${it.z}/${it.x}/${it.y}" in sampledIds }
                val retryDelay = if (complete) NativeBridgeDemSamplingGate.COMPLETE_REFRESH_MILLIS
                    else NativeBridgeDemSamplingGate.PARTIAL_RETRY_MILLIS
                val finishedAt = android.os.SystemClock.elapsedRealtime()
                // A model revision can advance while sampling even if no camera frame observed it.
                val latestInputs = NativeBridgeDemSamplingGate.Inputs(
                    camera = cameraJson(entry).let { latestCamera ->
                        NativeBridgeDemSamplingGate.cameraFingerprint(
                            latestCamera.optJSONArray("center")?.optDouble(0, Double.NaN) ?: Double.NaN,
                            latestCamera.optJSONArray("center")?.optDouble(1, Double.NaN) ?: Double.NaN,
                            latestCamera.optDouble("zoom", Double.NaN),
                            latestCamera.optDouble("pitch", Double.NaN),
                            latestCamera.optDouble("bearing", Double.NaN),
                        )
                    },
                    viewportWidth = entry.controller.worldWindowForBridge().engine.viewport.width,
                    viewportHeight = entry.controller.worldWindowForBridge().engine.viewport.height,
                    cssScale = cssScale(entry),
                    terrainEnabled = entry.controller.isTerrainEnabled(),
                    exaggeration = privateExaggeration(entry),
                    demRevision = entry.controller.demRevision().coerceAtLeast(0),
                )
                if (latestInputs.geometryFingerprint() == geometryKey && latestInputs.fingerprint() != inputKey) {
                    entry.demSamplingGate.notePending(latestInputs.fingerprint())
                }
                entry.demRetryAfterAt = finishedAt + retryDelay
                entry.demSamplingGate.finish(inputKey, finishedAt, retryDelay)
                gateSettled = true
                entry.controller.worldWindowForBridge().requestRedraw()
            } finally {
                if (!gateSettled) {
                    val finishedAt = android.os.SystemClock.elapsedRealtime()
                    val pending = entry.demSamplingGate.finish(inputKey, finishedAt, NativeBridgeDemSamplingGate.PARTIAL_RETRY_MILLIS)
                    if (isCurrent(entry) && pending != null) entry.controller.worldWindowForBridge().requestRedraw()
                }
            }
        }
    }

    /** Try the exact visible point first; only an empty GPU hit gets the 44 CSS px fallback. */
    private fun pickTouchObjectIds(entry: MapEntry, x: Float, y: Float, finished: (List<String>, List<String>) -> Unit) {
        entry.controller.pickObjectIds(android.graphics.RectF(x, y, x, y)) { exactIds ->
            if (!isCurrent(entry)) return@pickObjectIds
            val exact = NativePickTouchTarget.normalizeMarkerIds(exactIds, entry.annotationIds)
            if (exactIds.any { !it.startsWith("geology:") }) {
                finished(exact, exact)
                return@pickObjectIds
            }
            val bounds = NativePickTouchTarget.centered(x, y, cssScale(entry))
            entry.controller.pickObjectIds(android.graphics.RectF(bounds.left, bounds.top, bounds.right, bounds.bottom)) { nearbyIds ->
                if (isCurrent(entry)) finished(NativePickTouchTarget.normalizeMarkerIds(nearbyIds + exactIds, entry.annotationIds), exact)
            }
        }
    }

    private fun installTouchBridge(entry: MapEntry) {
        entry.controller.view.setOnTouchListener { _, event ->
            if (!isCurrent(entry)) return@setOnTouchListener false
            markFrameDirty(entry)
            // Stop the old camera target before forwarding the real DOWN to WorldWind.
            // Follow intent and the current heading/pitch are owned by React and stay intact.
            if (event.actionMasked == MotionEvent.ACTION_DOWN) {
                entry.cameraOrigin.beginUserGesture()
                cancelCameraAnimation(entry)
            }
            val scale = cssScale(entry)
            val x = event.x / scale; val y = event.y / scale
            val now = android.os.SystemClock.elapsedRealtime()
            val shouldEmitTouch = event.actionMasked != MotionEvent.ACTION_MOVE || now - entry.lastTouchAt >= TOUCH_EVENT_INTERVAL_MS
            var cachedPointers: JSONArray? = null
            fun pointersPayload(): JSONArray = cachedPointers ?: JSONArray().also { pointers ->
                for (pointer in 0 until event.pointerCount) pointers.put(JSONObject().put("id", event.getPointerId(pointer)).put("x", event.getX(pointer) / scale).put("y", event.getY(pointer) / scale))
                cachedPointers = pointers
            }
            if (shouldEmitTouch) {
                entry.lastTouchAt = now
                emitEvent(entry.id, "touch", JSONObject()
                    .put("action", event.actionMasked)
                    .put("x", x).put("y", y)
                    .put("pointerCount", event.pointerCount)
                    .put("pointers", pointersPayload())
                    .put("gestureId", if (event.actionMasked == MotionEvent.ACTION_DOWN) entry.gestureSequence + 1 else entry.gestureSequence)
                    .put("eventTime", event.eventTime)
                    .put("touchSlop", ViewConfiguration.get(appContext).scaledTouchSlop / scale))
            }
            val interaction = entry.renderInteraction
            // Picking flags select what a tap means; they must not disable ordinary pan/zoom.
            val captureByMode = interaction.drawingActive
            val capturePointer = entry.touchNavigation.capture(event,
                captureByMode || entry.capturedGestureId == entry.gestureSequence) { cameraEvent ->
                entry.controller.view.onTouchEvent(cameraEvent)
            }
            if (NativeBridgeTouchPolicy.shouldClearGroundAnchor(
                    actionDown = event.actionMasked == MotionEvent.ACTION_DOWN,
                    pointerDown = event.actionMasked == MotionEvent.ACTION_POINTER_DOWN,
                    pointerCaptured = capturePointer,
                    navigationStarted = entry.touchNavigation.isNavigating,
                )) entry.controller.clearBridgeGroundAnchor()
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    entry.touchDown = event.x to event.y
                    val gestureId = ++entry.gestureSequence
                    entry.tapCompletionGate.begin(gestureId)
                    val pointerId = event.getPointerId(0); val downTime = event.downTime; val actionTime = event.eventTime
                    entry.capturedGestureId = if (captureByMode) gestureId else null
                    if (!captureByMode) {
                        val hitCoordinate = entry.controller.unprojectCoordinate(event.x, event.y)?.let { JSONArray().put(it.second).put(it.first) } ?: JSONObject.NULL
                        pickTouchObjectIds(entry, event.x, event.y) { ids, exactIds ->
                            if (isCurrent(entry) && entry.gestureSequence == gestureId) emitEvent(entry.id, "hitTest", JSONObject().put("gestureId", gestureId).put("pointerId", pointerId).put("downTime", downTime).put("eventTime", actionTime).put("point", JSONObject().put("x", x).put("y", y)).put("coordinate", hitCoordinate).put("ids", JSONArray(ids)).put("exactIds", JSONArray(exactIds)))
                        }
                    }
                }
                MotionEvent.ACTION_UP -> {
                    val down = entry.touchDown
                    val suppressClick = captureByMode || interaction.readOnly ||
                        entry.adapterCapturedGesture && entry.capturedGestureId == entry.gestureSequence
                    entry.touchDown = null
                    if (!suppressClick && down != null && kotlin.math.hypot((event.x - down.first).toDouble(), (event.y - down.second).toDouble()) < appContext.resources.displayMetrics.density * 12) {
                        val coordinate = entry.controller.unprojectCoordinate(event.x, event.y)
                        if (event.eventTime - event.downTime >= LONG_PRESS_MS) {
                            if (coordinate != null) emitEvent(entry.id, "longPress", JSONObject().put("gestureId", entry.gestureSequence).put("pointerId", event.getPointerId(0)).put("downTime", event.downTime).put("eventTime", event.eventTime).put("x", x).put("y", y).put("coordinates", JSONArray().put(coordinate.second).put(coordinate.first)))
                        } else {
                                val tapGesture = entry.gestureSequence
                                val tapTime = event.eventTime
                                entry.tapCompletionGate.releaseTap(tapGesture)
                                pickTouchObjectIds(entry, event.x, event.y) { ids, exactIds ->
                                    if (isCurrent(entry) && entry.tapCompletionGate.accepts(tapGesture)) {
                                        emitEvent(entry.id, "tap", JSONObject()
                                            .put("point", JSONObject().put("x", x).put("y", y))
                                            .put("coordinates", coordinate?.let { JSONArray().put(it.second).put(it.first) } ?: JSONObject.NULL)
                                            .put("ids", JSONArray(ids)).put("exactIds", JSONArray(exactIds)).put("gestureId", tapGesture).put("eventTime", tapTime))
                                    }
                                }
                        }
                    }
                    entry.gestureSequence++
                    entry.capturedGestureId = null
                    entry.adapterCapturedGesture = false
                }
                MotionEvent.ACTION_POINTER_DOWN, MotionEvent.ACTION_CANCEL -> {
                    val cancelledGesture = entry.gestureSequence
                    entry.gestureSequence++
                    entry.tapCompletionGate.cancel(cancelledGesture)
                    entry.touchDown = null
                    entry.capturedGestureId = null
                    entry.adapterCapturedGesture = false
                    emitEvent(entry.id, "gestureCancel", JSONObject().put("gestureId", cancelledGesture).put("eventTime", event.eventTime).put("pointerCount", event.pointerCount))
                }
            }
            // A multi-touch gesture cancels drawing and is passed to WorldWind as map navigation.
            val drawing = interaction.drawingActive
            if (drawing && (!entry.touchNavigation.isNavigating || event.actionMasked == MotionEvent.ACTION_POINTER_DOWN)) {
                val type = when {
                    event.pointerCount > 1 -> "cancel"
                    event.actionMasked == MotionEvent.ACTION_DOWN -> "start"
                    event.actionMasked == MotionEvent.ACTION_MOVE -> "move"
                    event.actionMasked == MotionEvent.ACTION_UP -> "end"
                    event.actionMasked == MotionEvent.ACTION_CANCEL || event.actionMasked == MotionEvent.ACTION_POINTER_DOWN -> "cancel"
                    else -> null
                }
                if (type != null) {
                    val groundPoint: JSONObject?
                    val coordinate: JSONArray?
                    if (type == "start" || type == "move") {
                        val scale = cssScale(entry)
                        val cssWidth = entry.controller.view.width / scale
                        val cssHeight = entry.controller.view.height / scale
                        val aimX = x.coerceIn(8.0, (cssWidth - 8.0).coerceAtLeast(8.0))
                        val aimY = (y - 44.0).coerceIn(8.0, (cssHeight - 8.0).coerceAtLeast(8.0))
                        entry.controller.setTileDemandDrawingFocus(aimX * scale, aimY * scale)
                        groundPoint = JSONObject().put("x", aimX).put("y", aimY)
                        coordinate = entry.controller.unprojectCoordinate((aimX * scale).toFloat(), (aimY * scale).toFloat())
                            ?.let { JSONArray().put(it.second).put(it.first) }
                    } else {
                        entry.controller.setTileDemandDrawingFocus(null, null)
                        groundPoint = null
                        coordinate = null
                    }
                    val reason: Any = when (type) { "end" -> "release"; "cancel" -> "pointer-cancel"; else -> JSONObject.NULL }
                    emitEvent(entry.id, "drawingInput", JSONObject().put("type", type).put("point", JSONObject().put("x", x).put("y", y)).put("groundPoint", groundPoint ?: JSONObject.NULL).put("pointers", pointersPayload()).put("coordinate", coordinate ?: JSONObject.NULL).put("pointerCount", event.pointerCount).put("eventTime", event.eventTime).put("reason", reason))
                }
            }
            capturePointer
        }
    }

    private fun cameraJsonOrNull(entry: MapEntry): JSONObject? = runCatching { cameraJson(entry) }.getOrNull()

    private fun cancelCameraAnimation(entry: MapEntry) {
        NativeBridgeFollowCamera.cancel(entry.cameraAnimator) { entry.cameraAnimator = null }
    }

    private fun capabilities() = JSONObject().apply {
        put("worldWindSurface", ready("WorldWind native renderer"))
        put("renderState", ready("camera, raster/cartography settings, pins/models, route/track lines, areas, photos and sampled section surface"))
        put("camera", ready("native camera snapshot/apply, zoom, north, view and fit"))
        put("projection", ready("exact rendered WGS84 ECEF matrices, project and ground unproject"))
        put("pick", ready("WorldWind pick buffer and terrain position"))
        put("elevation", ready("cached DEM sample only; missing stays null"))
        put("capture", if (Build.VERSION.SDK_INT >= 24) ready("PixelCopy map surface") else blocked("requires PixelCopy"))
        put("routes", ready("ground-clamped WorldWind paths"))
        put("tracks", ready("saved and draft ground-clamped segments"))
        put("areas", ready("ground-clamped polygon fill and outline"))
        put("pinsAndModels", ready("NativeModelRenderer pickable renderables"))
        put("photos", ready("provided previewBase64 thumbnails"))
        put("freeSectionSurface", ready("NativeSectionEngine sampling against real cached DEM and NativeSectionSurfaceLayer"))
        put("surveySection", ready("NativeSurveySectionEngine sampling against real cached DEM"))
        put("satelliteImagery", ready("NativeCartographyLayers with truthful imagery status"))
        put("roadSnapping", ready("real visible OpenFreeMap road geometry events; status remains loading until tiles exist"))
        put("riverSnapping", ready("real visible OpenFreeMap waterway geometry events; status remains loading until tiles exist"))
        put("mapStyleShare", ready("native WorldWind print surface via renderShareMap"))
        put("offlineRegionBounds", ready("native WGS84 projection frame bounds"))
        put("magnify", ready("PixelCopy bounded native surface capture"))
    }

    private fun send(type: String, mapId: String?, requestId: String?, payload: JSONObject) {
        val session = sessionId ?: return
        val message = JSONObject().put("version", VERSION).put("sessionId", session).put("type", type)
        if (mapId != null) message.put("mapId", mapId)
        if (requestId != null) message.put("requestId", requestId)
        message.put("payload", payload)
        postEmit(message.toString(), session)
    }

    private fun emitEvent(mapId: String, name: String, value: JSONObject, requestId: String? = null, extra: JSONObject? = null) {
        val body = JSONObject().put("name", name).put("value", value)
        if (extra != null) for (key in extra.keys()) body.put(key, extra.opt(key))
        send("event", mapId, requestId, body)
    }

    /** Only immutable DEM/snap snapshots enter this bounded latest-per-channel encoder. */
    private fun emitBulkEvent(entry: MapEntry, name: String, value: JSONObject) {
        val session = sessionId ?: return
        val token = ++entry.eventEncodeSequence
        entry.eventEncodeTokens[name] = token
        val message = JSONObject().put("version", VERSION).put("sessionId", session).put("type", "event")
            .put("mapId", entry.id).put("payload", JSONObject().put("name", name).put("value", value))
        entry.eventEncoder?.submit(name, token, message)
    }

    private fun postError(requestId: String?, mapId: String?, code: String, message: String) {
        val session = sessionId ?: return
        val payload = JSONObject().put("code", code).put("message", message)
        val event = JSONObject().put("version", VERSION).put("sessionId", session).put("type", "error").put("payload", payload)
        if (mapId != null) event.put("mapId", mapId)
        if (requestId != null) event.put("requestId", requestId)
        postEmit(event.toString(), session)
    }

    private fun postEmit(message: String, session: String) {
        val action = Runnable { if (!closed && sessionId == session && trusted()) runCatching { emit(message) } }
        if (Looper.myLooper() == Looper.getMainLooper()) action.run() else main.post(action)
    }

    private fun clearSession() {
        assets.clearPending()
        com.shantu.nativeapp.map.NativeOfflineDisplayPolicy.reset()
        browserCacheFallback?.close(); browserCacheFallback = null
        NativeTileNetworkPool.installBrowserCacheReader(null)
        shareJobs.values.toList().forEach { it.second.cancel() }
        shareJobs.clear()
        maps.values.toList().forEach { entry ->
            entry.disposed = true
            entry.eventEncoder?.close()
            entry.eventEncodeTokens.clear()
            entry.framePublishTask?.let(main::removeCallbacks)
            entry.frameCaptureTask?.let(main::removeCallbacks)
            entry.settledFrameTask?.let(main::removeCallbacks)
            entry.framePublishPending.set(false)
            entry.latestFrame.takeLatest()
            runCatching { entry.cameraAnimator?.cancel() }; entry.cameraAnimator = null
            entry.controller.setBridgeFrameListener(null)
            entry.controller.setBridgeCameraMotionListener(null)
            entry.controller.setBridgeFrameActivityListener(null)
            entry.scope.cancel()
            entry.sectionJob?.cancel()
            entry.demJob?.cancel()
            runCatching { entry.sectionLayer?.close() }
            runCatching { entry.sectionCollection?.close() }
            runCatching { entry.overlayRenderer?.close() }
            runCatching { entry.snapObserver?.close() }
            runCatching { entry.snapReadyObserver?.close() }
            runCatching { entry.snapGeometry?.close() }
            runCatching { entry.controller.dispose() }
            root.removeView(entry.container)
        }
        maps.clear()
        activeBrowserCacheMapId = null
    }

    private fun requireEntry(mapId: String) = maps[mapId] ?: throw IllegalArgumentException("地图尚未创建")
    private fun requireMapId(mapId: String?) = mapId?.takeIf(String::isNotBlank) ?: throw IllegalArgumentException("地图编号无效")
    private fun isCurrent(entry: MapEntry) = !closed && maps[entry.id] === entry
    private fun trusted() = runCatching(trustedForeground).getOrDefault(false)
    private fun cssScale(entry: MapEntry) = entry.viewport?.optDouble("cssScale", appContext.resources.displayMetrics.density.toDouble())
        ?.takeIf { it.isFinite() && it in 0.5..8.0 } ?: appContext.resources.displayMetrics.density.toDouble()

    private fun readPrivateConfig() = runCatching {
        appContext.assets.open("native-private-config.json").bufferedReader().use { JSONObject(it.readText()) }
    }.getOrDefault(JSONObject())

    private fun finite(source: JSONObject, key: String): Double = source.optDouble(key, Double.NaN).also {
        require(it.isFinite()) { "地图参数 $key 无效" }
    }

    private fun readCoordinates(array: JSONArray): List<Pair<Double, Double>> = buildList {
        require(array.length() <= MAX_COORDINATES) { "地图坐标数量超过限制" }
        for (i in 0 until array.length()) {
            val point = array.optJSONArray(i) ?: continue
            val lon = point.optDouble(0, Double.NaN); val lat = point.optDouble(1, Double.NaN)
            if (lon.isFinite() && lon in -180.0..180.0 && lat.isFinite() && lat in -90.0..90.0) add(lat to lon)
        }
    }

    private fun parseColor(text: String): Int = runCatching { android.graphics.Color.parseColor(text) }.getOrDefault(android.graphics.Color.rgb(208, 247, 107))
    private fun ready(detail: String) = JSONObject().put("status", "ready").put("detail", detail)
    private fun blocked(reason: String) = JSONObject().put("status", "blocked").put("reason", reason)
    private fun safeMessage(value: String) = !Regex("(?i)(https?://|token|apikey|api_key|key=|Authorization:)").containsMatchIn(value)
    private fun doubleArrayJson(values: DoubleArray) = JSONArray().also { out -> values.forEach { out.put(it) } }

    private fun zoomToRange(zoom: Double, latitude: Double, heightCss: Double): Double {
        require(zoom.isFinite() && latitude.isFinite() && latitude in -90.0..90.0) { "相机参数无效" }
        val h = heightCss.coerceAtLeast(1.0)
        val span = WORLD_CIRCUMFERENCE * cos(latitude * PI / 180.0) * h / (512.0 * 2.0.pow(zoom.coerceIn(0.0, 24.0)))
        return span / (2.0 * tan(Math.toRadians(45.0) / 2.0))
    }

    private fun rangeToZoom(range: Double, latitude: Double, heightCss: Double): Double {
        if (!range.isFinite() || range <= 0) return 1.0
        val numerator = WORLD_CIRCUMFERENCE * cos(latitude * PI / 180.0) * heightCss.coerceAtLeast(1.0)
        return (ln(numerator / (512.0 * range * 2.0 * tan(Math.toRadians(45.0) / 2.0))) / ln(2.0)).coerceIn(0.0, 24.0)
    }

    private fun onMain(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) block() else main.post(block)
    }

    companion object {
        private const val VERSION = 1
        private const val MAX_MESSAGE_CHARS = 8 * 1024 * 1024
        private const val MAX_COORDINATES = 20_000
        private const val MAX_BATCH = 64
        private const val MAX_CAPTURE_BYTES = 2 * 1024 * 1024
        private const val FRAME_EVENT_INTERVAL_MS = 33L
        private const val TOUCH_EVENT_INTERVAL_MS = 24L
        private const val LONG_PRESS_MS = 500L
        // First/final frame waits and the bounded source wait are sequential.
        // Keep the host deadline below the 80s bridge and 90s image deadlines.
        private const val SHARE_RENDER_TIMEOUT_MS = 75_000L
        private const val DEM_TILE_SIZE = 64
        private const val WORLD_CIRCUMFERENCE = 40_075_016.68557849
        private val ID_PATTERN = Regex("^[A-Za-z0-9._:-]{1,96}$")
    }
}

/** The same ordinary-location camera contract as map/cameraSync.ts, with explicit cancellation order. */
internal object NativeBridgeFollowCamera {
    fun target(current: JSONObject, payload: JSONObject): JSONObject {
        val coordinate = payload.optJSONArray("coordinate") ?: payload.optJSONArray("coordinates")
            ?: payload.optJSONObject("position")?.optJSONArray("coordinates") ?: JSONArray()
        val lon = coordinate.optDouble(0, Double.NaN)
        val lat = coordinate.optDouble(1, Double.NaN)
        require(lon.isFinite() && lon in -180.0..180.0 && lat.isFinite() && lat in -90.0..90.0) { "中心坐标无效" }
        return JSONObject(current.toString()).apply {
            put("center", JSONArray().put(lon).put(lat))
            put("duration", if (payload.optBoolean("animate", true)) 650L else 0L)
            // Preserve camera zoom and user angles, rather than a stale range or navigation offset.
            remove("rangeMeters"); remove("offset")
        }
    }

    fun cancel(animation: ValueAnimator?, clear: () -> Unit) {
        // Android cancel() synchronously invokes onAnimationEnd. Detach first so its old
        // completion/update callbacks cannot be mistaken for the new animation's lifecycle.
        clear()
        animation?.cancel()
    }
}
