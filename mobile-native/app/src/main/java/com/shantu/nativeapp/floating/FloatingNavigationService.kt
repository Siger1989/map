package com.shantu.nativeapp.floating

import android.Manifest
import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.PixelFormat
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.IBinder
import android.provider.Settings
import android.view.Gravity
import android.view.WindowManager
import android.widget.Toast
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.shantu.nativeapp.geology.NativeMvtDecoder
import com.shantu.nativeapp.map.NativeDirectionMode
import com.shantu.nativeapp.map.NativeHeadingSource
import com.shantu.nativeapp.map.NativeMotionHeading
import com.shantu.nativeapp.map.NativePositionFix
import com.shantu.nativeapp.map.NativePositionPolicy
import com.shantu.nativeapp.map.NativePositionState
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import org.json.JSONObject
import java.io.File
import java.util.LinkedHashMap
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.*

/** Cross-app compact navigation overlay. Activity owns permission checks and initiates foreground start. */
class FloatingNavigationService : Service(), LocationListener {
    companion object {
        private const val ACTION_START = "com.shantu.nativeapp.floating.START"
        private const val ACTION_UPDATE = "com.shantu.nativeapp.floating.UPDATE"
        private const val ACTION_VISIBILITY = "com.shantu.nativeapp.floating.VISIBILITY"
        private const val ACTION_STOP = "com.shantu.nativeapp.floating.STOP"
        private const val EXTRA_ROUTE_FILE = "route_file"
        private const val EXTRA_VISIBLE = "visible"
        private const val CHANNEL = "floating_navigation"
        private const val NOTIFICATION_ID = 7821
        private const val ROUTE_PREFIX = "floating-navigation-route-"
        private const val MAP_ZOOM = 14
        private val stateLock = Any()
        @Volatile private var appContext: Context? = null
        @Volatile private var appVisibleState = true
        @Volatile private var enabledState = false
        @Volatile private var visibleState = false
        @Volatile private var modeState = "north"
        @Volatile private var messageState = ""
        @Volatile private var windowX = 0
        @Volatile private var windowY = 0
        @Volatile private var windowWidth = 0
        @Volatile private var windowHeight = 0
        private fun snapshot() = JSONObject().put("enabled", enabledState).put("visible", visibleState).put("mode", modeState).put("message", messageState.take(80)).also {
            if (visibleState && windowWidth > 0 && windowHeight > 0) it.put("windowBounds", JSONObject().put("x", windowX).put("y", windowY).put("width", windowWidth).put("height", windowHeight))
        }

        /** Call after all overlay/location permission gates have passed in the host Activity. */
        fun start(context: Context, payload: JSONObject) = sendPayload(context, ACTION_START, payload)
        fun update(context: Context, payload: JSONObject) = sendPayload(context, ACTION_UPDATE, payload)
        fun stop(context: Context) {
            val wasEnabled = enabledState
            synchronized(stateLock) { enabledState = false; visibleState = false }
            if (wasEnabled) context.startService(Intent(context, FloatingNavigationService::class.java).setAction(ACTION_STOP))
        }
        fun status(): JSONObject = synchronized(stateLock) { snapshot() }
        fun setAppVisible(visible: Boolean) {
            appVisibleState = visible
            val app = appContext
            if (app != null && enabledState) setAppVisible(app, visible)
        }
        fun setAppVisible(context: Context, visible: Boolean) {
            appVisibleState = visible
            if (enabledState) context.startService(Intent(context, FloatingNavigationService::class.java).setAction(ACTION_VISIBILITY).putExtra(EXTRA_VISIBLE, visible))
        }

        private fun publishWindowBounds(params: WindowManager.LayoutParams?, visible: Boolean) {
            synchronized(stateLock) {
                if (visible && params != null) {
                    windowX = params.x; windowY = params.y; windowWidth = params.width; windowHeight = params.height
                } else { windowX = 0; windowY = 0; windowWidth = 0; windowHeight = 0 }
            }
        }
        private fun sendPayload(context: Context, action: String, payload: JSONObject) {
            val originalBytes = payload.toString().toByteArray(Charsets.UTF_8)
            FloatingNavigationGeometry.validatePayloadBytes(originalBytes)
            val validatedMode = validatePayload(payload)
            val safePayload = JSONObject().put("version", 1).put("mode", validatedMode)
                .put("label", payload.optString("label", "路线"))
                .put("coordinates", payload.getJSONArray("coordinates"))
            val bytes = safePayload.toString().toByteArray(Charsets.UTF_8)
            FloatingNavigationGeometry.validatePayloadBytes(bytes)
            val name = ROUTE_PREFIX + android.os.Process.myPid() + "-" + System.nanoTime() + ".json"
            val destination = File(context.cacheDir, name)
            val temporary = File(context.cacheDir, "$name.tmp")
            try {
                temporary.outputStream().use { it.write(bytes); it.fd.sync() }
                check(temporary.renameTo(destination)) { "路线临时文件写入失败" }
                synchronized(stateLock) { enabledState = true; modeState = validatedMode; messageState = "" }
                val intent = Intent(context, FloatingNavigationService::class.java).setAction(action).putExtra(EXTRA_ROUTE_FILE, destination.absolutePath)
                if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
            } catch (e: Exception) {
                temporary.delete(); destination.delete(); synchronized(stateLock) {
                    if (action == ACTION_START) { enabledState = false; visibleState = false }
                    messageState = e.message ?: "路线启动失败"
                }
                throw e
            }
        }

        /** Validate the complete payload without materializing a duplicate 100k-point route list. */
        private fun validatePayload(payload: JSONObject): String {
            require(payload.optInt("version", -1) == 1) { "路线版本不支持" }
            val mode = payload.optString("mode")
            require(mode == "north" || mode == "motion") { "方向模式无效" }
            require(payload.optString("label", "路线").length <= 160) { "路线名称过长" }
            val coordinates = payload.optJSONArray("coordinates") ?: throw IllegalArgumentException("路线坐标缺失")
            require(coordinates.length() in 2..FloatingNavigationGeometry.MAX_ROUTE_POINTS) { "路线点数必须为2至100000" }
            for (index in 0 until coordinates.length()) {
                val pair = coordinates.optJSONArray(index) ?: throw IllegalArgumentException("第${index + 1}个路线点无效")
                require(pair.length() == 2 && pair.opt(0) is Number && pair.opt(1) is Number) { "第${index + 1}个路线点无效" }
                val longitude = pair.getDouble(0); val latitude = pair.getDouble(1)
                require(longitude.isFinite() && longitude in -180.0..180.0 && latitude.isFinite() && latitude in -90.0..90.0) { "路线坐标无效" }
            }
            return mode
        }

        internal fun parseRoute(payload: JSONObject): Pair<String, Pair<String, List<FloatingCoordinate>>> {
            require(payload.optInt("version", -1) == 1) { "路线版本不支持" }
            val mode = payload.optString("mode")
            val label = payload.optString("label", "路线")
            val coordinates = payload.optJSONArray("coordinates") ?: throw IllegalArgumentException("路线坐标缺失")
            require(coordinates.length() in 2..FloatingNavigationGeometry.MAX_ROUTE_POINTS) { "路线点数必须为2至100000" }
            val points = ArrayList<FloatingCoordinate>(coordinates.length())
            for (i in 0 until coordinates.length()) {
                val pair = coordinates.optJSONArray(i) ?: throw IllegalArgumentException("第${i + 1}个路线点无效")
                require(pair.length() == 2 && pair.opt(0) is Number && pair.opt(1) is Number) { "第${i + 1}个路线点无效" }
                points += FloatingCoordinate(pair.getDouble(0), pair.getDouble(1))
            }
            FloatingNavigationGeometry.validate(mode, label, points)
            return mode to (label to points)
        }
    }

    private val alive = AtomicBoolean(false)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val tileSemaphore = Semaphore(2)
    private val tileCache = object : LinkedHashMap<String, FloatingTileGeometry>(12, .75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, FloatingTileGeometry>?): Boolean = size > 9
    }
    private var windowManager: WindowManager? = null
    private var overlay: FloatingNavigationView? = null
    private var params: WindowManager.LayoutParams? = null
    private var locationManager: LocationManager? = null
    private var routeFile: File? = null
    private var route = emptyList<FloatingCoordinate>()
    private var routeLabel = "路线"
    private var mode = "north"
    private var lastFix: NativePositionFix? = null
    private var heading: Double? = null
    private var headingAt = 0L
    private var cachedRouteProjection: FloatingRouteProjection? = null
    private val headingFilter = NativeMotionHeading()
    private var refreshJob: Job? = null
    private var appVisible = true
    private var source: com.shantu.nativeapp.map.NativeFloatingVectorSource? = null

    override fun onCreate() {
        super.onCreate()
        appContext = applicationContext
        appVisible = appVisibleState
        createChannel()
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
        locationManager = getSystemService(LOCATION_SERVICE) as LocationManager
        cleanupOwnedRouteFiles()
        synchronized(stateLock) { visibleState = false }
        scope.launch { while (isActive) { if (overlay?.parent != null) updateView(); delay(1_000) } }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> { stopSelf(); return START_NOT_STICKY }
            ACTION_VISIBILITY -> {
                if (!alive.get()) { stopSelf(); return START_NOT_STICKY }
                appVisible = intent.getBooleanExtra(EXTRA_VISIBLE, false); setOverlayVisible(!appVisible); return START_NOT_STICKY
            }
            ACTION_START, ACTION_UPDATE -> {
                val routePath = intent.getStringExtra(EXTRA_ROUTE_FILE)
                if (routePath == null) { reportError("路线数据缺失"); stopSelf(); return START_NOT_STICKY }
                try {
                    if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION_ID, buildNotification(), android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
                    else startForeground(NOTIFICATION_ID, buildNotification())
                    loadRoute(File(routePath))
                    ensureLocationUpdates()
                    showOrHideOverlay()
                    refreshTiles()
                    synchronized(stateLock) { enabledState = true; modeState = mode; messageState = "" }
                } catch (e: Exception) { routePath.let { runCatching { File(it).delete() } }; reportError(e.message ?: "悬浮导航启动失败"); stopSelf() }
            }
            else -> { if (!alive.get()) { stopSelf(); return START_NOT_STICKY } }
        }
        return START_NOT_STICKY
    }

    private fun loadRoute(file: File) {
        require(file.canonicalFile.parentFile == cacheDir.canonicalFile) { "路线文件位置无效" }
        val bytes = file.readBytes(); FloatingNavigationGeometry.validatePayloadBytes(bytes)
        val parsed = parseRoute(JSONObject(bytes.toString(Charsets.UTF_8)))
        routeFile?.takeIf { it != file }?.delete()
        routeFile = file
        mode = parsed.first; routeLabel = parsed.second.first; route = parsed.second.second
        tileCache.clear(); cachedRouteProjection = null
        if (overlay == null) createOverlay()
        updateView()
    }

    private fun ensureLocationUpdates() {
        if (alive.getAndSet(true)) return
        if (!hasLocationPermission()) throw SecurityException("需由应用授予精确定位权限")
        val lm = locationManager ?: throw IllegalStateException("定位服务不可用")
        var requested = false
        val fine = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val providers = if (fine) listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER) else listOf(LocationManager.NETWORK_PROVIDER)
        for (provider in providers) {
            if (runCatching { lm.isProviderEnabled(provider) }.getOrDefault(false)) {
                if (runCatching { lm.requestLocationUpdates(provider, 900L, 0f, this, android.os.Looper.getMainLooper()); true }.getOrDefault(false)) requested = true
            }
        }
        if (!requested) throw IllegalStateException("定位源不可用")
        runCatching { lm.getLastKnownLocation(LocationManager.GPS_PROVIDER)?.let(::onLocationChanged) }
    }

    @Suppress("MissingPermission")
    private fun hasLocationPermission() = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED || ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun createOverlay() {
        val view = FloatingNavigationView(this)
        val width = (184 * resources.displayMetrics.density).roundToInt()
        val height = (216 * resources.displayMetrics.density).roundToInt()
        val type = if (Build.VERSION.SDK_INT >= 26) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE
        val lp = WindowManager.LayoutParams(width, height, type, WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN, PixelFormat.TRANSLUCENT).apply { gravity = Gravity.TOP or Gravity.START; x = 12; y = 120 }
        view.onMode = { mode = if (mode == "north") "motion" else "north"; synchronized(stateLock) { modeState = mode }; updateView() }
        view.onReturn = { returnToApp() }
        view.onClose = { stopSelf() }
        view.onDrag = { dx, dy -> lp.x = (lp.x + dx.roundToInt()).coerceIn(0, max(0, screenWidth() - lp.width)); lp.y = (lp.y + dy.roundToInt()).coerceIn(0, max(0, screenHeight() - lp.height)); runCatching { windowManager?.updateViewLayout(view, lp) }; publishWindowBounds(lp, view.parent != null) }
        overlay = view; params = lp
        if (!appVisible && Settings.canDrawOverlays(this)) windowManager?.addView(view, lp)
    }

    private fun showOrHideOverlay() {
        val view = overlay ?: return
        val wm = windowManager ?: return
        val attached = view.parent != null
        if (!appVisible && Settings.canDrawOverlays(this) && !attached) runCatching { wm.addView(view, params) }.onFailure { reportError("悬浮窗权限不可用") }
        if (appVisible && attached) runCatching { wm.removeView(view) }
        synchronized(stateLock) { visibleState = !appVisible && view.parent != null }
        publishWindowBounds(params, !appVisible && view.parent != null)
        if (!appVisible) updateView()
    }

    private fun setOverlayVisible(visible: Boolean) { appVisible = !visible; showOrHideOverlay() }

    private fun returnToApp() {
        setOverlayVisible(false)
        val launch = packageManager.getLaunchIntentForPackage(packageName)?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
        if (launch != null) startActivity(launch)
    }

    private fun updateView() {
        val view = overlay ?: return
        val fix = lastFix
        val state = NativePositionState(fix, System.currentTimeMillis(), heading, if (heading != null) NativeHeadingSource.MOTION else null, headingAt.takeIf { heading != null }, if (heading != null) 20.0 else null, NativeDirectionMode.MOTION)
        val presentation = NativePositionPolicy.present(state)
        view.route = route; view.label = routeLabel; view.mode = mode
        val reliable = presentation.visible && fix != null && fix.accuracyMeters <= 50.0
        val actualPosition = fix?.takeIf { presentation.visible }?.let { FloatingCoordinate(it.longitude, it.latitude) }
        view.hasRealLocation = actualPosition != null
        view.center = fix?.let { FloatingCoordinate(it.longitude, it.latitude) } ?: route.firstOrNull()
        view.heading = heading // last trustworthy motion bearing remains stable while stopped; status explains lack of new direction.
        view.stateText = when { !presentation.visible -> "等待定位"; !reliable -> "定位精度不足"; mode == "motion" && heading == null -> "等待移动方向"; mode == "motion" && System.currentTimeMillis() - headingAt > 10_000 -> "等待移动方向"; else -> "导航中" }
        val routeProjection = cachedRouteProjection.takeIf { reliable }
        view.routeRemainingMeters = routeProjection?.remainingMeters
        view.routeOffRoute = routeProjection?.offRoute == true
        synchronized(tileCache) { view.tiles = tileCache.values.toList() }
        view.invalidate()
    }

    override fun onLocationChanged(location: Location) {
        if (location.provider != LocationManager.GPS_PROVIDER) { updateView(); return }
        val fix = NativePositionFix(location.latitude, location.longitude, location.accuracy.toDouble(), location.time, location.provider ?: "unknown", if (location.hasSpeed()) location.speed.toDouble() else null, if (location.hasBearing()) location.bearing.toDouble() else null, null)
        val now = System.currentTimeMillis()
        val nextHeading = headingFilter.update(fix, now)
        if (nextHeading != null) { heading = nextHeading; headingAt = headingFilter.acceptedAt.takeIf { it > 0 } ?: now }
        lastFix = fix
        val state = NativePositionState(fix, now)
        cachedRouteProjection = if (NativePositionPolicy.present(state).visible) FloatingNavigationGeometry.routeProjection(FloatingCoordinate(fix.longitude, fix.latitude), route) else null
        updateView(); refreshTiles()
    }

    private fun refreshTiles() {
        val fix = lastFix
        val anchor = fix?.let { FloatingCoordinate(it.longitude, it.latitude) } ?: route.firstOrNull() ?: return
        if (refreshJob?.isActive == true) return
        refreshJob = scope.launch {
            val tileCount = 1 shl MAP_ZOOM
            val center = tileFor(anchor.longitude, anchor.latitude, MAP_ZOOM)
            val centerWorldX = (anchor.longitude + 180.0) / 360.0 * tileCount
            val latRad = Math.toRadians(anchor.latitude.coerceIn(-85.05112878, 85.05112878))
            val centerWorldY = (1.0 - ln(tan(latRad) + 1.0 / cos(latRad)) / Math.PI) / 2.0 * tileCount
            val density = resources.displayMetrics.density.toDouble().coerceAtLeast(.1)
            val view = overlay
            val viewportWidthDp = ((view?.width ?: (184 * density).roundToInt()) / density - 10.0).coerceAtLeast(0.0)
            val viewportHeightDp = ((view?.height ?: (216 * density).roundToInt()) / density - 84.0).coerceAtLeast(0.0)
            // Conservative square bound around the rotated visible rectangle; normally one to four z14 tiles.
            val radiusTiles = hypot(viewportWidthDp, viewportHeightDp) / 2.0 / 256.0
            val minX = floor(centerWorldX - radiusTiles).toInt(); val maxX = floor(centerWorldX + radiusTiles).toInt()
            val minY = floor(centerWorldY - radiusTiles).toInt().coerceAtLeast(0); val maxY = floor(centerWorldY + radiusTiles).toInt().coerceAtMost(tileCount - 1)
            val targets = (minY..maxY).flatMap { y -> (minX..maxX).map { x -> TileId(MAP_ZOOM, (x + tileCount) % tileCount, y) } }.distinctBy { it.key }.take(9)
            val missing = synchronized(tileCache) { targets.filter { !tileCache.containsKey(it.key) } }
            missing.chunked(2).forEach { batch ->
                coroutineScope {
                    batch.map { tile -> async(Dispatchers.IO) {
                        tileSemaphore.withPermit {
                            val tileSource = source ?: synchronized(this@FloatingNavigationService) { source ?: com.shantu.nativeapp.map.NativeFloatingVectorSource().also { source = it } }
                            val bytes = tileSource.read(tile.z, tile.x, tile.y) ?: return@withPermit null
                            try { withContext(Dispatchers.Default) { FloatingTileGeometry(tile.z, tile.x, tile.y, boundedFeatures(NativeMvtDecoder.decode(bytes).filter(::relevantFeature))) } }
                            catch (cancelled: CancellationException) { throw cancelled }
                            catch (_: Exception) { null }
                        }
                    } }.awaitAll().filterNotNull().forEach { decoded -> synchronized(tileCache) { tileCache["${decoded.z}/${decoded.x}/${decoded.y}"] = decoded } }
                }
                updateView()
            }
            if (lastFix?.let { tileFor(it.longitude, it.latitude, MAP_ZOOM) } != center) refreshTiles()
        }
    }

    private fun relevantFeature(feature: com.shantu.nativeapp.geology.NativeMvtFeature): Boolean {
        val layer = feature.layer.lowercase()
        return layer.contains("transport") || layer.contains("road") || layer.contains("building") || layer.contains("water") || layer.contains("place") || layer.contains("label") || layer.contains("poi")
    }

    private fun boundedFeatures(features: List<com.shantu.nativeapp.geology.NativeMvtFeature>): List<com.shantu.nativeapp.geology.NativeMvtFeature> {
        val out = ArrayList<com.shantu.nativeapp.geology.NativeMvtFeature>(min(features.size, 1200))
        var vertices = 0; var labels = 0
        fun priority(feature: com.shantu.nativeapp.geology.NativeMvtFeature): Int {
            val layer = feature.layer.lowercase()
            return when { layer.contains("transport") || layer.contains("road") -> 0; layer.contains("water") -> 1; layer.contains("building") -> 2; else -> 3 }
        }
        for (feature in features.sortedBy(::priority)) {
            val layer = feature.layer.lowercase()
            val isLabel = layer.contains("label") || layer.contains("place") || layer.contains("poi")
            if (isLabel && labels >= 48) continue
            val count = feature.paths.sumOf { it.size }
            if (count == 0 || out.size >= 1200 || vertices + count > 24_000) continue
            out += feature; vertices += count; if (isLabel) labels++
        }
        return out
    }

    private data class TileId(val z: Int, val x: Int, val y: Int) { val key get() = "$z/$x/$y" }
    private fun tileFor(lon: Double, lat: Double, z: Int): TileId {
        val n = 1 shl z; val x = floor((lon + 180.0) / 360.0 * n).toInt().coerceIn(0, n - 1)
        val r = Math.toRadians(lat.coerceIn(-85.05112878, 85.05112878)); val y = floor((1.0 - ln(tan(r) + 1 / cos(r)) / Math.PI) / 2 * n).toInt().coerceIn(0, n - 1)
        return TileId(z, x, y)
    }

    override fun onConfigurationChanged(newConfig: android.content.res.Configuration) { super.onConfigurationChanged(newConfig); params?.let { it.x = it.x.coerceIn(0, max(0, screenWidth() - it.width)); it.y = it.y.coerceIn(0, max(0, screenHeight() - it.height)); runCatching { overlay?.let { view -> windowManager?.updateViewLayout(view, it) } }; publishWindowBounds(it, overlay?.parent != null) } }
    private fun screenWidth() = if (Build.VERSION.SDK_INT >= 30) resources.displayMetrics.widthPixels else @Suppress("DEPRECATION") (getSystemService(WINDOW_SERVICE) as WindowManager).defaultDisplay.width
    private fun screenHeight() = if (Build.VERSION.SDK_INT >= 30) resources.displayMetrics.heightPixels else @Suppress("DEPRECATION") (getSystemService(WINDOW_SERVICE) as WindowManager).defaultDisplay.height

    private fun createChannel() { if (Build.VERSION.SDK_INT >= 26) getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(CHANNEL, "悬浮导航", NotificationManager.IMPORTANCE_LOW).apply { description = "后台路线定位状态" }) }
    private fun buildNotification(): Notification {
        val stop = PendingIntent.getService(this, 7822, Intent(this, FloatingNavigationService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        return NotificationCompat.Builder(this, CHANNEL).setSmallIcon(android.R.drawable.ic_menu_mylocation).setContentTitle("山兔悬浮导航").setContentText("路线定位正在运行；可关闭悬浮窗或停止导航服务").setOngoing(true).addAction(0, "停止悬浮导航", stop).build()
    }

    private fun reportError(message: String) { synchronized(stateLock) { enabledState = false; visibleState = false; messageState = message.take(80) }; runCatching { Toast.makeText(this, message.take(60), Toast.LENGTH_SHORT).show() } }
    private fun cleanupOwnedRouteFiles() {
        val staleBefore = System.currentTimeMillis() - 24L * 60 * 60 * 1000
        cacheDir.listFiles()?.filter { it.name.startsWith(ROUTE_PREFIX) && (it.name.endsWith(".json") || it.name.endsWith(".tmp")) && it.lastModified() < staleBefore }?.forEach { runCatching { it.delete() } }
    }

    override fun onDestroy() {
        alive.set(false); refreshJob?.cancel(); scope.cancel()
        runCatching { locationManager?.removeUpdates(this) }
        runCatching { if (overlay?.parent != null) windowManager?.removeView(overlay) }
        overlay = null; synchronized(tileCache) { tileCache.clear() }
        runCatching { synchronized(this) { source?.close(); source = null } }
        routeFile?.delete(); routeFile = null; cleanupOwnedRouteFiles()
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE) else @Suppress("DEPRECATION") stopForeground(true)
        synchronized(stateLock) { enabledState = false; visibleState = false }
        publishWindowBounds(null, false)
        appContext = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
    @Deprecated("Deprecated in Java") override fun onStatusChanged(provider: String?, status: Int, extras: android.os.Bundle?) = Unit
    override fun onProviderEnabled(provider: String) = Unit
    override fun onProviderDisabled(provider: String) = Unit
}
