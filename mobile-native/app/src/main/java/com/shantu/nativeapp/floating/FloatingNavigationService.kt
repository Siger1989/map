package com.shantu.nativeapp.floating

import android.Manifest
import android.app.*
import android.content.Context
import android.content.Intent
import android.content.BroadcastReceiver
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.app.KeyguardManager
import android.graphics.PixelFormat
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
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
import org.json.JSONArray
import java.io.File
import java.util.LinkedHashMap
import java.util.UUID
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.*

/** Cross-app compact navigation overlay. Activity owns permission checks and initiates foreground start. */
class FloatingNavigationService : Service(), LocationListener {
    companion object {
        private const val ACTION_START = "com.shantu.nativeapp.floating.START"
        private const val ACTION_UPDATE = "com.shantu.nativeapp.floating.UPDATE"
        private const val ACTION_VISIBILITY = "com.shantu.nativeapp.floating.VISIBILITY"
        private const val ACTION_OPTIONS = "com.shantu.nativeapp.floating.OPTIONS"
        private const val ACTION_STOP = "com.shantu.nativeapp.floating.STOP"
        private const val EXTRA_ROUTE_FILE = "route_file"
        private const val EXTRA_VISIBLE = "visible"
        private const val EXTRA_WINDOW_ENABLED = "window_enabled"
        private const val EXTRA_LOCKSCREEN_ENABLED = "lockscreen_enabled"
        private const val EXTRA_ENERGY_SAVING = "energy_saving"
        private const val EXTRA_LOCKSCREEN_KEEP_ON = "lockscreen_keep_on"
        private const val EXTRA_MODE = "mode"
        private const val STATE_PREFS = "floating_navigation_state"
        private const val PREF_WINDOW_ENABLED = "windowEnabled"
        private const val PREF_LOCKSCREEN_ENABLED = "lockscreenEnabled"
        private const val PREF_MODE = "mode"
        private const val PREF_ENERGY_SAVING = "energySaving"
        private const val PREF_LOCKSCREEN_KEEP_ON = "lockscreenKeepOn"
        private const val PREF_OPTIONS_CONFIGURED = "optionsConfigured"
        private const val PREF_LAST_PROCESS_EXIT_REASON = "diagnosticProcessExitReason"
        private const val PREF_LAST_PROCESS_EXIT_CODE = "diagnosticProcessExitCode"
        private const val PREF_LAST_PROCESS_EXIT_AT = "diagnosticProcessExitAtMillis"
        private const val PREF_LAST_SERVICE_END_REASON = "diagnosticServiceEndReason"
        private const val PREF_LAST_SERVICE_END_AT = "diagnosticServiceEndAtMillis"
        private const val PREF_LAST_TASK_REMOVED_AT = "diagnosticTaskRemovedAtMillis"
        private const val PREF_LAST_START_ERROR = "diagnosticLastStartError"
        private const val PREF_LAST_START_ERROR_AT = "diagnosticLastStartErrorAtMillis"
        private const val PREF_LAST_UPDATE_ERROR = "diagnosticLastUpdateError"
        private const val PREF_LAST_UPDATE_ERROR_AT = "diagnosticLastUpdateErrorAtMillis"
        private const val PREF_LAST_DISPLAY_ACTION = "diagnosticLastDisplayAction"
        private const val PREF_LAST_DISPLAY_ACTION_AT = "diagnosticLastDisplayActionAtMillis"
        internal const val LOCKSCREEN_TOKEN_EXTRA = "floating_lock_session"
        private const val CHANNEL = "floating_navigation"
        private const val NOTIFICATION_ID = 7821
        private const val ROUTE_PREFIX = "floating-navigation-route-"
        private const val MAP_ZOOM = 14
        private const val MAX_TILE_REQUESTS = 16
        private const val TILE_CACHE_CAPACITY = 32
        private val stateLock = Any()
        @Volatile private var activeService: FloatingNavigationService? = null
        @Volatile private var recordingActionListener: ((String) -> Unit)? = null
        private val recordingSnapshotSequence = AtomicLong()
        @Volatile private var appContext: Context? = null
        @Volatile private var appVisibleState = true
        @Volatile private var enabledState = false
        @Volatile private var visibleState = false
        @Volatile private var modeState = "north"
        @Volatile private var kindState = "position"
        @Volatile private var zoomState = FloatingNavigationGeometry.MIN_ZOOM
        @Volatile private var widthDpState = 184.0
        @Volatile private var heightDpState = 216.0
        @Volatile private var messageState = ""
        @Volatile private var lockscreenScreenOnState = false
        @Volatile private var lockscreenLockedState = false
        @Volatile private var lockscreenLaunchPendingState = false
        @Volatile private var lockscreenAttachedState = false
        @Volatile private var lockscreenLaunchAttemptedState = false
        @Volatile private var lockscreenMessageState = ""
        @Volatile private var windowX = 0
        @Volatile private var windowY = 0
        @Volatile private var windowWidth = 0
        @Volatile private var windowHeight = 0
        @Volatile private var lastProcessExitQueryAtMillis = 0L
        @Volatile private var mvtDecodeDiagnostics = JSONObject()

        private fun refreshProcessExitDiagnostic(context: Context) {
            if (Build.VERSION.SDK_INT < 30) return
            val now = System.currentTimeMillis()
            if (now - lastProcessExitQueryAtMillis < 10_000L) return
            lastProcessExitQueryAtMillis = now
            val prefs = context.getSharedPreferences(STATE_PREFS, Context.MODE_PRIVATE)
            val lastRecordedExit = prefs.getLong(PREF_LAST_PROCESS_EXIT_AT, 0L)
            try {
                val manager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
                manager.getHistoricalProcessExitReasons(context.packageName, 0, 32)
                    .filter { it.processName == context.applicationInfo.processName && it.timestamp > lastRecordedExit }
                    .maxByOrNull { it.timestamp }
                    ?.let { exit ->
                        prefs.edit()
                            .putInt(PREF_LAST_PROCESS_EXIT_CODE, exit.reason)
                            .putString(PREF_LAST_PROCESS_EXIT_REASON, processExitReasonName(exit.reason))
                            .putLong(PREF_LAST_PROCESS_EXIT_AT, exit.timestamp)
                            .apply()
                    }
            } catch (_: Exception) { /* Diagnostics must never expose framework details. */ }
        }

        private fun processExitReasonName(reason: Int): String = when (reason) {
            ApplicationExitInfo.REASON_EXIT_SELF -> "EXIT_SELF"
            ApplicationExitInfo.REASON_SIGNALED -> "SIGNALED"
            ApplicationExitInfo.REASON_LOW_MEMORY -> "LOW_MEMORY"
            ApplicationExitInfo.REASON_CRASH -> "CRASH"
            ApplicationExitInfo.REASON_CRASH_NATIVE -> "CRASH_NATIVE"
            ApplicationExitInfo.REASON_ANR -> "ANR"
            ApplicationExitInfo.REASON_INITIALIZATION_FAILURE -> "INITIALIZATION_FAILURE"
            ApplicationExitInfo.REASON_PERMISSION_CHANGE -> "PERMISSION_CHANGE"
            ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE -> "EXCESSIVE_RESOURCE_USAGE"
            ApplicationExitInfo.REASON_USER_REQUESTED -> "USER_REQUESTED_SYSTEM_REASON"
            ApplicationExitInfo.REASON_USER_STOPPED -> "USER_STOPPED_SYSTEM_REASON"
            ApplicationExitInfo.REASON_DEPENDENCY_DIED -> "DEPENDENCY_DIED"
            ApplicationExitInfo.REASON_OTHER -> "OTHER"
            else -> "UNKNOWN_${reason}"
        }

        private fun lifecycleDiagnostics(context: Context?): JSONObject {
            if (context != null) refreshProcessExitDiagnostic(context.applicationContext)
            val prefs = context?.getSharedPreferences(STATE_PREFS, Context.MODE_PRIVATE)
            return JSONObject()
                .put("lastServiceEndReason", prefs?.getString(PREF_LAST_SERVICE_END_REASON, "") ?: "")
                .put("lastServiceEndAtMillis", prefs?.getLong(PREF_LAST_SERVICE_END_AT, 0L) ?: 0L)
                .put("lastProcessExitReason", prefs?.getString(PREF_LAST_PROCESS_EXIT_REASON, "") ?: "")
                .put("lastProcessExitReasonCode", prefs?.getInt(PREF_LAST_PROCESS_EXIT_CODE, 0) ?: 0)
                .put("lastProcessExitAtMillis", prefs?.getLong(PREF_LAST_PROCESS_EXIT_AT, 0L) ?: 0L)
                .put("lastTaskRemovedAtMillis", prefs?.getLong(PREF_LAST_TASK_REMOVED_AT, 0L) ?: 0L)
                .put("lastStartError", prefs?.getString(PREF_LAST_START_ERROR, "") ?: "")
                .put("lastStartErrorAtMillis", prefs?.getLong(PREF_LAST_START_ERROR_AT, 0L) ?: 0L)
                .put("lastUpdateError", prefs?.getString(PREF_LAST_UPDATE_ERROR, "") ?: "")
                .put("lastUpdateErrorAtMillis", prefs?.getLong(PREF_LAST_UPDATE_ERROR_AT, 0L) ?: 0L)
                .put("lastDisplayAction", prefs?.getString(PREF_LAST_DISPLAY_ACTION, "") ?: "")
                .put("lastDisplayActionAtMillis", prefs?.getLong(PREF_LAST_DISPLAY_ACTION_AT, 0L) ?: 0L)
        }

        private fun snapshot(context: Context? = appContext) = JSONObject().put("enabled", enabledState).put("visible", visibleState).put("mode", context?.let(::storedMode) ?: modeState)
            .put("windowEnabled", context?.let(::storedWindowEnabled) ?: true)
            .put("lockscreenEnabled", context?.let(::storedLockscreenEnabled) ?: true)
            .put("energySaving", context?.let(::storedEnergySaving) ?: false)
            .put("lockscreenKeepOn", context?.let(::storedLockscreenKeepOn) ?: false)
            .put("optionsConfigured", context?.getSharedPreferences(STATE_PREFS, Context.MODE_PRIVATE)?.getBoolean(PREF_OPTIONS_CONFIGURED, false) ?: false)
            .put("kind", kindState).put("zoom", zoomState).put("widthDp", widthDpState).put("heightDp", heightDpState)
            .put("message", messageState.take(80))
            .put("lockscreen", JSONObject().put("screenOn", lockscreenScreenOnState).put("locked", lockscreenLockedState)
                .put("launchPending", lockscreenLaunchPendingState).put("attached", lockscreenAttachedState)
                .put("launchAttempted", lockscreenLaunchAttemptedState).put("message", lockscreenMessageState.take(100)))
            .put("diagnostics", lifecycleDiagnostics(context).put("mvtDecode", JSONObject(mvtDecodeDiagnostics.toString()))).also {
            if (visibleState && windowWidth > 0 && windowHeight > 0) it.put("windowBounds", JSONObject().put("x", windowX).put("y", windowY).put("width", windowWidth).put("height", windowHeight))
        }

        private fun recordMvtDecode(stats: com.shantu.nativeapp.geology.NativeMvtDecodeStats) {
            synchronized(stateLock) {
                val previous = mvtDecodeDiagnostics
                val values = JSONObject()
                val names = listOf("inputBytes", "scannedLayers", "skippedLayers", "scannedFeatures", "irrelevantFeatures", "candidateCapSkipped", "commandLimitSkipped", "tagLimitSkipped", "geometryLimitSkipped", "dictionaryCapSkipped", "skippedByBudget", "acceptedFeatures", "acceptedPaths", "acceptedVertices", "skippedByLabelReserve", "propertyCapSkipped")
                names.forEach { key -> values.put(key, (previous.optInt(key, 0).toLong() + when (key) {
                    "inputBytes" -> stats.inputBytes; "scannedLayers" -> stats.scannedLayers; "skippedLayers" -> stats.skippedLayers
                    "scannedFeatures" -> stats.scannedFeatures; "irrelevantFeatures" -> stats.irrelevantFeatures
                    "candidateCapSkipped" -> stats.candidateCapSkipped; "commandLimitSkipped" -> stats.commandLimitSkipped; "tagLimitSkipped" -> stats.tagLimitSkipped
                    "geometryLimitSkipped" -> stats.geometryLimitSkipped; "dictionaryCapSkipped" -> stats.dictionaryCapSkipped
                    "skippedByBudget" -> stats.skippedByBudget; "acceptedFeatures" -> stats.acceptedFeatures
                    "acceptedPaths" -> stats.acceptedPaths; "acceptedVertices" -> stats.acceptedVertices
                    "skippedByLabelReserve" -> stats.skippedByLabelReserve; else -> stats.propertyCapSkipped
                }).coerceAtMost(Int.MAX_VALUE.toLong()).toInt()) }
                values.put("decodedTiles", (previous.optInt("decodedTiles", 0).toLong() + 1L).coerceAtMost(Int.MAX_VALUE.toLong()).toInt())
                mvtDecodeDiagnostics = values
            }
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
        fun status(context: Context): JSONObject = synchronized(stateLock) { snapshot(context.applicationContext) }

        /** Persist an independent display preference and notify only an existing session. */
        fun setWindowEnabled(context: Context, enabled: Boolean) = setOptions(context, enabled, null, null)
        fun setLockscreenEnabled(context: Context, enabled: Boolean) = setOptions(context, null, enabled, null)
        @JvmStatic fun energySaving(context: Context) = storedEnergySaving(context.applicationContext)
        @JvmStatic fun lockscreenKeepOn(context: Context) = storedLockscreenKeepOn(context.applicationContext)

        /** Persist user options without launching a service or requesting platform permission. */
        fun setOptions(context: Context, windowEnabled: Boolean?, lockscreenEnabled: Boolean?, mode: String?, energySaving: Boolean? = null, lockscreenKeepOn: Boolean? = null) {
            require(windowEnabled != null || lockscreenEnabled != null || mode != null || energySaving != null || lockscreenKeepOn != null) { "没有可保存的悬浮地图设置" }
            require(mode == null || mode in setOf("north", "motion", "compass")) { "方向模式无效" }
            val app = context.applicationContext
            val prefs = app.getSharedPreferences(STATE_PREFS, Context.MODE_PRIVATE)
            val editor = prefs.edit()
            windowEnabled?.let { editor.putBoolean(PREF_WINDOW_ENABLED, it) }
            lockscreenEnabled?.let { editor.putBoolean(PREF_LOCKSCREEN_ENABLED, it) }
            mode?.let { editor.putString(PREF_MODE, it) }
            energySaving?.let { editor.putBoolean(PREF_ENERGY_SAVING, it) }
            lockscreenKeepOn?.let { editor.putBoolean(PREF_LOCKSCREEN_KEEP_ON, it) }
            editor.putBoolean(PREF_OPTIONS_CONFIGURED, true)
            editor.apply()
            val service = activeService
            if (service != null && service.alive.get()) {
                val intent = Intent(app, FloatingNavigationService::class.java).setAction(ACTION_OPTIONS)
                windowEnabled?.let { intent.putExtra(EXTRA_WINDOW_ENABLED, it) }
                lockscreenEnabled?.let { intent.putExtra(EXTRA_LOCKSCREEN_ENABLED, it) }
                mode?.let { intent.putExtra(EXTRA_MODE, it) }
                energySaving?.let { intent.putExtra(EXTRA_ENERGY_SAVING, it) }
                lockscreenKeepOn?.let { intent.putExtra(EXTRA_LOCKSCREEN_KEEP_ON, it) }
                app.startService(intent)
            }
        }

        private fun storedWindowEnabled(context: Context) = context.getSharedPreferences(STATE_PREFS, Context.MODE_PRIVATE).getBoolean(PREF_WINDOW_ENABLED, true)
        private fun storedLockscreenEnabled(context: Context) = context.getSharedPreferences(STATE_PREFS, Context.MODE_PRIVATE).getBoolean(PREF_LOCKSCREEN_ENABLED, true)
        private fun storedEnergySaving(context: Context) = context.getSharedPreferences(STATE_PREFS, Context.MODE_PRIVATE).getBoolean(PREF_ENERGY_SAVING, false)
        private fun storedLockscreenKeepOn(context: Context) = context.getSharedPreferences(STATE_PREFS, Context.MODE_PRIVATE).getBoolean(PREF_LOCKSCREEN_KEEP_ON, false)
        private fun storedMode(context: Context) = context.getSharedPreferences(STATE_PREFS, Context.MODE_PRIVATE).getString(PREF_MODE, "north")?.takeIf { it in setOf("north", "motion", "compass") } ?: "north"

        private fun mergePersistedOptions(context: Context, payload: JSONObject): JSONObject {
            val app = context.applicationContext
            val prefs = app.getSharedPreferences(STATE_PREFS, Context.MODE_PRIVATE)
            val configured = prefs.getBoolean(PREF_OPTIONS_CONFIGURED, false)
            val merged = JSONObject(payload.toString())
            val payloadMode = payload.optString("mode").takeIf { it in setOf("north", "motion", "compass") }
            merged.put("mode", if (configured) storedMode(app) else payloadMode ?: storedMode(app))
            merged.put(PREF_WINDOW_ENABLED, if (configured) storedWindowEnabled(app) else payload.optBoolean(PREF_WINDOW_ENABLED, storedWindowEnabled(app)))
            merged.put(PREF_LOCKSCREEN_ENABLED, if (configured) storedLockscreenEnabled(app) else payload.optBoolean(PREF_LOCKSCREEN_ENABLED, storedLockscreenEnabled(app)))
            merged.put(PREF_ENERGY_SAVING, if (configured) storedEnergySaving(app) else payload.optBoolean(PREF_ENERGY_SAVING, storedEnergySaving(app)))
            merged.put(PREF_LOCKSCREEN_KEEP_ON, if (configured) storedLockscreenKeepOn(app) else payload.optBoolean(PREF_LOCKSCREEN_KEEP_ON, storedLockscreenKeepOn(app)))
            return merged
        }
        /** Token is process-local and intentionally omitted from status/JS-facing data. */
        internal fun lockscreenSessionToken(): String? = activeService?.takeIf { it.alive.get() }?.lockscreenToken

        /** Called by the unexported lockscreen Activity on its main thread after creating its own View. */
        internal fun attachLockscreenView(view: FloatingNavigationView, token: String): Boolean {
            val service = activeService ?: return false
            if (Looper.myLooper() != Looper.getMainLooper()) return false
            return service.attachLockscreenViewInternal(view, token)
        }

        /** Activity onStop may detach temporarily; this never relaunches it in the current lock cycle. */
        internal fun detachLockscreenView(view: FloatingNavigationView) {
            val service = activeService ?: return
            if (Looper.myLooper() != Looper.getMainLooper()) {
                service.scope.launch(Dispatchers.Main.immediate) { service.detachLockscreenViewInternal(view) }
            } else service.detachLockscreenViewInternal(view)
        }
        /** Host-owned coordinator handles these actions through the existing recorder bridge/service. */
        fun setRecordingActionListener(listener: ((String) -> Unit)?) { recordingActionListener = listener }

        /** In-memory UI input only; the native recording service remains the sole storage owner. */
        fun updateRecordingSnapshot(snapshot: JSONObject) {
            val target = activeService ?: return
            val sequence = recordingSnapshotSequence.incrementAndGet()
            target.scope.launch(Dispatchers.Default) {
                val parsed = try { target.parseRecordingSnapshot(snapshot) } catch (_: Exception) { return@launch }
                withContext(Dispatchers.Main.immediate) {
                    if (activeService === target && recordingSnapshotSequence.get() == sequence) target.applyRecordingSnapshot(parsed)
                }
            }
        }
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
            val safePayload = validatePayload(mergePersistedOptions(context, payload))
            val bytes = safePayload.toString().toByteArray(Charsets.UTF_8)
            FloatingNavigationGeometry.validatePayloadBytes(bytes)
            val name = ROUTE_PREFIX + android.os.Process.myPid() + "-" + System.nanoTime() + ".json"
            val destination = File(context.cacheDir, name)
            val temporary = File(context.cacheDir, "$name.tmp")
            try {
                temporary.outputStream().use { it.write(bytes); it.fd.sync() }
                check(temporary.renameTo(destination)) { "路线临时文件写入失败" }
                synchronized(stateLock) {
                    enabledState = true; modeState = safePayload.getString("mode"); kindState = safePayload.getString("kind")
                    safePayload.optInt("zoom", zoomState).also { zoomState = it }
                    safePayload.optDouble("widthDp", widthDpState).also { widthDpState = it }
                    safePayload.optDouble("heightDp", heightDpState).also { heightDpState = it }
                    messageState = ""
                }
                val prefs = context.applicationContext.getSharedPreferences(STATE_PREFS, Context.MODE_PRIVATE)
                prefs.edit().putString(PREF_MODE, safePayload.getString("mode"))
                    .putBoolean(PREF_WINDOW_ENABLED, safePayload.getBoolean(PREF_WINDOW_ENABLED))
                    .putBoolean(PREF_LOCKSCREEN_ENABLED, safePayload.getBoolean(PREF_LOCKSCREEN_ENABLED))
                    .putBoolean(PREF_ENERGY_SAVING, safePayload.optBoolean(PREF_ENERGY_SAVING, storedEnergySaving(context.applicationContext)))
                    .putBoolean(PREF_LOCKSCREEN_KEEP_ON, safePayload.optBoolean(PREF_LOCKSCREEN_KEEP_ON, storedLockscreenKeepOn(context.applicationContext)))
                    .putBoolean(PREF_OPTIONS_CONFIGURED, true)
                    .apply()
                if (!storedWindowEnabled(context.applicationContext) && !storedLockscreenEnabled(context.applicationContext)) {
                    destination.delete()
                    synchronized(stateLock) { enabledState = false; visibleState = false; messageState = "普通小窗与锁屏地图均已关闭" }
                    activeService?.takeIf { it.alive.get() }?.let {
                        context.startService(Intent(context, FloatingNavigationService::class.java).setAction(ACTION_OPTIONS))
                    }
                    return
                }
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
        /** Shared by the service and JS bridge; returns only the documented, validated v1 fields. */
        fun validatePayload(payload: JSONObject): JSONObject {
            FloatingNavigationGeometry.validatePayloadBytes(payload.toString().toByteArray(Charsets.UTF_8))
            require(payload.optInt("version", -1) == 1) { "路线版本不支持" }
            val mode = payload.optString("mode")
            val kind = if (payload.has("kind")) payload.optString("kind") else "route" // v1 legacy payloads are routes.
            val label = payload.optString("label").ifBlank { if (kind == "position") "定位小地图" else "路线" }
            val coordinates = if (payload.has("coordinates")) payload.optJSONArray("coordinates")
                ?: throw IllegalArgumentException("坐标格式无效") else if (kind == "position") JSONArray() else throw IllegalArgumentException("路线坐标缺失")
            val zoom = payload.optInt("zoom", FloatingNavigationGeometry.MIN_ZOOM)
            FloatingNavigationGeometry.validateSession(kind, mode, label, coordinates.length(), zoom)
            val routeColor = FloatingNavigationGeometry.parseRouteColor(kind, payload.has("color"), payload.opt("color") as? String)
            for (index in 0 until coordinates.length()) {
                val pair = coordinates.optJSONArray(index) ?: throw IllegalArgumentException("第${index + 1}个路线点无效")
                require(pair.length() == 2 && pair.opt(0) is Number && pair.opt(1) is Number) { "第${index + 1}个路线点无效" }
                val longitude = pair.getDouble(0); val latitude = pair.getDouble(1)
                FloatingNavigationGeometry.validateCoordinate(longitude, latitude)
            }
            val width = optionalDimension(payload, "widthDp", 100.0..320.0)
            val height = optionalDimension(payload, "heightDp", 100.0..400.0)
            val out = JSONObject().put("version", 1).put("kind", kind).put("mode", mode).put("label", label)
                .put("coordinates", coordinates)
            for (key in listOf(PREF_WINDOW_ENABLED, PREF_LOCKSCREEN_ENABLED, PREF_ENERGY_SAVING, PREF_LOCKSCREEN_KEEP_ON)) if (payload.has(key)) {
                require(payload.opt(key) is Boolean) { "$key 必须是布尔值" }
                out.put(key, payload.getBoolean(key))
            }
            if (payload.has("zoom")) out.put("zoom", zoom)
            if (payload.has("color")) out.put("color", FloatingNavigationGeometry.formatRouteColor(routeColor))
            if (width != null) out.put("widthDp", width)
            if (height != null) out.put("heightDp", height)
            FloatingNavigationGeometry.validatePayloadBytes(out.toString().toByteArray(Charsets.UTF_8))
            return out
        }

        private fun optionalDimension(payload: JSONObject, key: String, range: ClosedFloatingPointRange<Double>): Double? {
            if (!payload.has(key)) return null
            val raw = payload.opt(key)
            require(raw is Number) { "$key 必须是数字" }
            return raw.toDouble().also { require(it.isFinite() && it in range) { "$key 超出允许范围" } }
        }

        private fun parseSession(payload: JSONObject): ParsedSession {
            val safe = validatePayload(payload)
            val coordinates = safe.getJSONArray("coordinates")
            val points = ArrayList<FloatingCoordinate>(coordinates.length())
            for (i in 0 until coordinates.length()) {
                val pair = coordinates.getJSONArray(i)
                points += FloatingCoordinate(pair.getDouble(0), pair.getDouble(1))
            }
            return ParsedSession(safe.getString("kind"), safe.getString("mode"), safe.getString("label"), points,
                if (safe.has("zoom")) safe.getInt("zoom") else null,
                optionalDimension(safe, "widthDp", 100.0..320.0)?.toFloat(), optionalDimension(safe, "heightDp", 100.0..400.0)?.toFloat(),
                FloatingNavigationGeometry.parseRouteColor(safe.getString("kind"), safe.has("color"), safe.opt("color") as? String))
        }

        private data class ParsedSession(val kind: String, val mode: String, val label: String, val points: List<FloatingCoordinate>, val zoom: Int?, val widthDp: Float?, val heightDp: Float?, val routeColor: Int)
    }

    private val alive = AtomicBoolean(false)
    private val lockscreenToken = UUID.randomUUID().toString()
    private var expectedStopReason: String? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val tileSemaphore = Semaphore(2)
    private val tileCache = object : LinkedHashMap<String, FloatingTileGeometry>(12, .75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, FloatingTileGeometry>?): Boolean = size > TILE_CACHE_CAPACITY
    }
    private var windowManager: WindowManager? = null
    private var overlay: FloatingNavigationView? = null
    private var lockscreenView: FloatingNavigationView? = null
    private var params: WindowManager.LayoutParams? = null
    private var locationManager: LocationManager? = null
    private var routeFile: File? = null
    private var route = emptyList<FloatingCoordinate>()
    private var kind = "route"
    private var routeColor = FloatingNavigationGeometry.DEFAULT_ROUTE_COLOR
    private var currentRecordingSnapshot = RecordingSnapshot("idle", emptyList())
    private var zoom = FloatingNavigationGeometry.MIN_ZOOM
    private var windowWidthDp = 184f
    private var windowHeightDp = 216f
    private var windowEnabled = true
    private var lockscreenEnabled = true
    private var energySaving = false
    private var lockscreenKeepOn = false
    private var routeLabel = "路线"
    private var mode = "north"
    private var lastFix: NativePositionFix? = null
    private var heading: Double? = null
    private var headingAt = 0L
    private var mapBearing: Double? = null
    private var compassHeading: Double? = null
    private var compassHeadingAtNanos = 0L
    private var compassMessage = "等待罗盘方向"
    private var compassSource: FloatingCompassSource? = null
    private var lowPowerLocationRequests = false
    private var locationRequestsStarted = false
    private var cachedRouteProjection: FloatingRouteProjection? = null
    private val headingFilter = NativeMotionHeading()
    private var refreshJob: Job? = null
    private var refreshAgain = false
    private var resizeRefreshJob: Job? = null
    private var appVisible = true
    private var overlayFailureMessage = ""
    private var source: com.shantu.nativeapp.map.NativeFloatingVectorSource? = null
    private var screenOn = false
    private var keyguardLocked = false
    private var lockscreenLaunchAttempted = false
    private var lockscreenLaunchPending = false
    private var lockscreenMessage = ""
    private var lockscreenLaunchAckJob: Job? = null
    private var screenCheckJob: Job? = null
    private var screenReceiver: BroadcastReceiver? = null

    override fun onCreate() {
        super.onCreate()
        refreshProcessExitDiagnostic(applicationContext)
        activeService = this
        appContext = applicationContext
        appVisible = appVisibleState
        createChannel()
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
        locationManager = getSystemService(LOCATION_SERVICE) as LocationManager
        compassSource = FloatingCompassSource(this) { value, message, sampleTimestampNanos ->
            val previous = compassHeading
            compassHeading = value
            compassHeadingAtNanos = if (value != null) sampleTimestampNanos ?: 0L else 0L
            compassMessage = message
            if (value == null || previous == null || abs(value - previous) >= .5) updateView()
        }
        screenOn = getSystemService(POWER_SERVICE)?.let { (it as PowerManager).isInteractive } ?: false
        keyguardLocked = (getSystemService(KEYGUARD_SERVICE) as? KeyguardManager)?.isKeyguardLocked ?: false
        registerScreenReceiver()
        publishLockscreenStatus()
        val prefs = getSharedPreferences("floating_navigation_layout", MODE_PRIVATE)
        zoom = prefs.getInt("zoom", FloatingNavigationGeometry.MIN_ZOOM).coerceIn(FloatingNavigationGeometry.MIN_ZOOM, FloatingNavigationGeometry.MAX_ZOOM)
        windowWidthDp = prefs.getFloat("widthDp", 184f)
        windowHeightDp = prefs.getFloat("heightDp", 216f)
        mode = storedMode(applicationContext)
        windowEnabled = storedWindowEnabled(applicationContext)
        lockscreenEnabled = storedLockscreenEnabled(applicationContext)
        energySaving = storedEnergySaving(applicationContext)
        lockscreenKeepOn = storedLockscreenKeepOn(applicationContext)
        synchronized(stateLock) { modeState = mode }
        cleanupOwnedRouteFiles()
        synchronized(stateLock) { visibleState = false }
        scope.launch {
            while (isActive) {
                refreshActualPowerAndKeyguardState()
                if (overlay?.parent != null || lockscreenView != null) updateView()
                delay(1_000)
            }
        }
    }

    /** Reconcile broadcasts against live system state so stale lock state cannot retain a lock view. */
    private fun refreshActualPowerAndKeyguardState() {
        val interactive = runCatching { (getSystemService(POWER_SERVICE) as PowerManager).isInteractive }.getOrDefault(false)
        val locked = runCatching { (getSystemService(KEYGUARD_SERVICE) as? KeyguardManager)?.isKeyguardLocked == true }.getOrDefault(false)
        when {
            !interactive -> if (screenOn) onScreenOff()
            !locked -> if (keyguardLocked || lockscreenView != null || lockscreenLaunchPending) onUserUnlocked() else screenOn = true
            else -> {
                val transitioned = !screenOn || !keyguardLocked
                screenOn = true; keyguardLocked = true
                if (transitioned && lockscreenEnabled) {
                    lockscreenLaunchAttempted = false
                    maybeLaunchLockscreenActivity()
                }
                publishLockscreenStatus()
            }
        }
    }

    @Suppress("DEPRECATION")
    private fun registerScreenReceiver() {
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                when (intent?.action) {
                    Intent.ACTION_SCREEN_OFF -> onScreenOff()
                    Intent.ACTION_SCREEN_ON -> onScreenOn()
                    Intent.ACTION_USER_PRESENT -> onUserUnlocked()
                }
            }
        }
        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_OFF)
            addAction(Intent.ACTION_SCREEN_ON)
            addAction(Intent.ACTION_USER_PRESENT)
        }
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        else registerReceiver(receiver, filter)
        screenReceiver = receiver
    }

    private fun onScreenOff() {
        screenOn = false
        updateLocationRequestPolicy()
        reconcileCompassSource()
        lockscreenLaunchPending = false
        lockscreenLaunchAttempted = false
        lockscreenMessage = ""
        lockscreenLaunchAckJob?.cancel(); lockscreenLaunchAckJob = null
        screenCheckJob?.cancel(); screenCheckJob = null
        lockscreenView?.let(::detachLockscreenViewInternal)
        hideOverlayForLockscreen()
        publishLockscreenStatus()
    }

    private fun onScreenOn() {
        screenOn = true
        updateLocationRequestPolicy(requestFreshFix = true)
        reconcileCompassSource()
        lockscreenLaunchAttempted = false
        lockscreenMessage = ""
        publishLockscreenStatus()
        screenCheckJob?.cancel()
        screenCheckJob = scope.launch {
            // Keyguard state may settle just after SCREEN_ON on some Android builds.
            repeat(2) { attempt ->
                keyguardLocked = (getSystemService(KEYGUARD_SERVICE) as? KeyguardManager)?.isKeyguardLocked ?: false
                if (keyguardLocked) { maybeLaunchLockscreenActivity(); return@launch }
                if (attempt == 0) delay(300)
            }
            onUserUnlocked()
        }
    }

    private fun onUserUnlocked() {
        sendBroadcast(Intent(FloatingLockMapActivity.ACTION_SESSION_ENDED).setPackage(packageName)
            .putExtra(LOCKSCREEN_TOKEN_EXTRA, lockscreenToken))
        screenOn = true
        updateLocationRequestPolicy(requestFreshFix = true)
        reconcileCompassSource()
        keyguardLocked = false
        lockscreenLaunchPending = false
        lockscreenLaunchAttempted = false
        lockscreenMessage = ""
        lockscreenLaunchAckJob?.cancel(); lockscreenLaunchAckJob = null
        screenCheckJob?.cancel(); screenCheckJob = null
        lockscreenView?.let(::detachLockscreenViewInternal)
        showOrHideOverlay()
        publishLockscreenStatus()
    }

    private fun maybeLaunchLockscreenActivity() {
        keyguardLocked = (getSystemService(KEYGUARD_SERVICE) as? KeyguardManager)?.isKeyguardLocked ?: false
        if (!alive.get() || !lockscreenEnabled || !screenOn || !keyguardLocked || lockscreenLaunchAttempted) {
            publishLockscreenStatus(); return
        }
        lockscreenLaunchAttempted = true
        lockscreenLaunchPending = true
        lockscreenMessage = "等待锁屏地图连接"
        publishLockscreenStatus()
        val intent = Intent().setClassName(packageName, "com.shantu.nativeapp.floating.FloatingLockMapActivity")
            .putExtra(LOCKSCREEN_TOKEN_EXTRA, lockscreenToken)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            startActivity(intent)
            // Keep an existing SAW overlay visible through the BAL decision on Android 15;
            // remove it only after startActivity has returned successfully.
            hideOverlayForLockscreen()
            lockscreenLaunchAckJob?.cancel()
            lockscreenLaunchAckJob = scope.launch {
                delay(3_000)
                if (lockscreenLaunchPending && lockscreenView == null && keyguardLocked && screenOn) {
                    lockscreenLaunchPending = false
                    lockscreenMessage = "锁屏地图启动约3秒内未连接"
                    publishLockscreenStatus()
                }
            }
        } catch (e: Exception) {
            lockscreenLaunchPending = false
            lockscreenMessage = when (e) {
                is SecurityException -> "系统阻止启动锁屏地图"
                else -> "锁屏地图启动失败：${e.javaClass.simpleName}"
            }
            publishLockscreenStatus()
        }
    }

    private fun hideOverlayForLockscreen() {
        overlay?.let { view ->
            if (view.parent != null) runCatching { windowManager?.removeView(view) }
        }
        synchronized(stateLock) { visibleState = false }
        publishWindowBounds(null, false)
    }

    private fun publishLockscreenStatus() {
        synchronized(stateLock) {
            lockscreenScreenOnState = screenOn
            lockscreenLockedState = keyguardLocked
            lockscreenLaunchPendingState = lockscreenLaunchPending
            lockscreenAttachedState = lockscreenView != null
            lockscreenLaunchAttemptedState = lockscreenLaunchAttempted
            lockscreenMessageState = lockscreenMessage.take(100)
        }
    }

    private fun attachLockscreenViewInternal(view: FloatingNavigationView, token: String): Boolean {
        keyguardLocked = (getSystemService(KEYGUARD_SERVICE) as? KeyguardManager)?.isKeyguardLocked ?: false
        if (!alive.get() || !screenOn || !keyguardLocked || token != lockscreenToken) return false
        lockscreenView?.takeIf { it !== view }?.let(::detachLockscreenViewInternal)
        lockscreenView = view
        installLockscreenViewCallbacks(view)
        view.onContentSizeChanged = { scheduleTileRefresh() }
        updateView(view)
        reconcileCompassSource()
        // Activity.onStart may run before its content has final measured bounds.
        view.post { if (lockscreenView === view) scheduleTileRefresh() }
        lockscreenLaunchPending = false
        lockscreenMessage = ""
        lockscreenLaunchAckJob?.cancel(); lockscreenLaunchAckJob = null
        publishLockscreenStatus()
        return true
    }

    private fun detachLockscreenViewInternal(view: FloatingNavigationView) {
        if (lockscreenView !== view) return
        lockscreenView = null
        view.onMode = null; view.onReturn = null; view.onClose = null; view.onZoom = null; view.onRecordAction = null
        view.onDrag = null; view.onResize = null; view.onContentSizeChanged = null
        view.tiles = emptyList(); view.route = emptyList(); view.recordedSegments = emptyList(); view.center = null
        view.heading = null; view.mapBearing = null; view.hasRealLocation = false
        reconcileCompassSource()
        publishLockscreenStatus()
        // A lifecycle detach is not a user close and never causes a launch retry in this lock cycle.
    }

    private fun installLockscreenViewCallbacks(view: FloatingNavigationView) {
        view.onMode = { mode = nextMode(mode); persistMode(); updateView(); reconcileCompassSource() }
        view.onZoom = { delta ->
            zoom = (zoom + delta).coerceIn(FloatingNavigationGeometry.MIN_ZOOM, FloatingNavigationGeometry.MAX_ZOOM)
            getSharedPreferences("floating_navigation_layout", MODE_PRIVATE).edit().putInt("zoom", zoom).apply()
            updateView(); refreshTiles(); publishLayoutStatus()
        }
        view.onRecordAction = { action -> recordingActionListener?.invoke(action) }
    }

    private fun scheduleTileRefresh() {
        resizeRefreshJob?.cancel()
        resizeRefreshJob = scope.launch {
            delay(100)
            refreshTiles()
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> { expectedStopReason = "explicit_stop_action"; stopSelf(); return START_NOT_STICKY }
            ACTION_OPTIONS -> {
                val wasWindowEnabled = windowEnabled
                val wasLockscreenEnabled = lockscreenEnabled
                val oldEnergySaving = energySaving
                windowEnabled = storedWindowEnabled(this)
                lockscreenEnabled = storedLockscreenEnabled(this)
                energySaving = storedEnergySaving(this)
                lockscreenKeepOn = storedLockscreenKeepOn(this)
                if (wasWindowEnabled != windowEnabled || wasLockscreenEnabled != lockscreenEnabled) {
                    val action = when {
                        wasWindowEnabled && !windowEnabled -> "window_disabled"
                        wasLockscreenEnabled && !lockscreenEnabled -> "lockscreen_disabled"
                        !wasWindowEnabled && windowEnabled -> "window_enabled"
                        else -> "lockscreen_enabled"
                    }
                    getSharedPreferences(STATE_PREFS, MODE_PRIVATE).edit()
                        .putString(PREF_LAST_DISPLAY_ACTION, action)
                        .putLong(PREF_LAST_DISPLAY_ACTION_AT, System.currentTimeMillis())
                        .apply()
                }
                if (!wasLockscreenEnabled && lockscreenEnabled) lockscreenLaunchAttempted = false
                if (oldEnergySaving != energySaving) updateLocationRequestPolicy(requestFreshFix = screenOn)
                reconcileWindowOptions()
                if (!windowEnabled && !lockscreenEnabled) { expectedStopReason = "both_displays_disabled"; stopSelf(); return START_NOT_STICKY }
                intent.getStringExtra(EXTRA_MODE)?.takeIf { it in setOf("north", "motion", "compass") }?.let {
                    mode = it; persistMode(); updateView(); reconcileCompassSource()
                }
                showOrHideOverlay()
                publishLockscreenStatus(); publishLayoutStatus()
                return START_NOT_STICKY
            }
            ACTION_VISIBILITY -> {
                if (!alive.get()) { expectedStopReason = "visibility_without_active_session"; stopSelf(); return START_NOT_STICKY }
                appVisible = intent.getBooleanExtra(EXTRA_VISIBLE, false); setOverlayVisible(!appVisible); return START_NOT_STICKY
            }
            ACTION_START, ACTION_UPDATE -> {
                expectedStopReason = null
                overlayFailureMessage = ""
                val updating = intent.action == ACTION_UPDATE && alive.get()
                val previousRouteFile = if (updating) routeFile else null
                if (!updating) synchronized(stateLock) { mvtDecodeDiagnostics = JSONObject() }
                val routePath = intent.getStringExtra(EXTRA_ROUTE_FILE)
                if (routePath == null) {
                    if (updating && previousRouteFile?.exists() == true) {
                        val now = System.currentTimeMillis()
                        getSharedPreferences(STATE_PREFS, MODE_PRIVATE).edit().putString(PREF_LAST_UPDATE_ERROR, "MISSING_PAYLOAD").putLong(PREF_LAST_UPDATE_ERROR_AT, now).apply()
                        synchronized(stateLock) { messageState = "更新失败，继续使用上次会话（缺少数据）" }
                    } else {
                        expectedStopReason = "start_missing_payload"; reportError("悬浮地图数据缺失"); stopSelf()
                        val now = System.currentTimeMillis()
                        getSharedPreferences(STATE_PREFS, MODE_PRIVATE).edit().putString(PREF_LAST_START_ERROR, "MISSING_PAYLOAD").putLong(PREF_LAST_START_ERROR_AT, now).apply()
                    }
                    return START_NOT_STICKY
                }
                try {
                    if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION_ID, buildNotification(), android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
                    else startForeground(NOTIFICATION_ID, buildNotification())
                    loadSession(File(routePath), deletePreviousFile = !updating)
                    val wasLockscreenEnabled = lockscreenEnabled
                    windowEnabled = storedWindowEnabled(this)
                    lockscreenEnabled = storedLockscreenEnabled(this)
                    energySaving = storedEnergySaving(this)
                    lockscreenKeepOn = storedLockscreenKeepOn(this)
                    if (!wasLockscreenEnabled && lockscreenEnabled) lockscreenLaunchAttempted = false
                    reconcileWindowOptions()
                    if (!windowEnabled && !lockscreenEnabled) { expectedStopReason = "both_displays_disabled"; stopSelf(); return START_NOT_STICKY }
                    ensureLocationUpdates()
                    showOrHideOverlay()
                    refreshTiles()
                    if (updating) previousRouteFile?.takeIf { it != routeFile }?.delete()
                    synchronized(stateLock) { enabledState = true; modeState = mode; kindState = kind; zoomState = zoom; messageState = overlayFailureMessage }
                    publishLayoutStatus()
                    if (screenOn && keyguardLocked) maybeLaunchLockscreenActivity()
                } catch (e: Exception) {
                    try { File(routePath).delete() } catch (_: SecurityException) { }
                    if (updating && previousRouteFile?.exists() == true) {
                        val now = System.currentTimeMillis()
                        getSharedPreferences(STATE_PREFS, MODE_PRIVATE).edit().putString(PREF_LAST_UPDATE_ERROR, e.javaClass.simpleName.take(40)).putLong(PREF_LAST_UPDATE_ERROR_AT, now).apply()
                        val restored = try { loadSession(previousRouteFile, deletePreviousFile = false); true } catch (_: Exception) { false }
                        synchronized(stateLock) {
                            enabledState = true
                            visibleState = overlay?.parent != null
                            messageState = if (restored) "更新失败，继续使用上次会话（${e.javaClass.simpleName.take(24)}）" else "更新失败，地图保留现有显示（${e.javaClass.simpleName.take(24)}）"
                        }
                        updateView()
                    } else {
                        expectedStopReason = "start_exception:${e.javaClass.simpleName.take(40)}"
                        val now = System.currentTimeMillis()
                        getSharedPreferences(STATE_PREFS, MODE_PRIVATE).edit().putString(PREF_LAST_START_ERROR, e.javaClass.simpleName.take(40)).putLong(PREF_LAST_START_ERROR_AT, now).apply()
                        reportError("悬浮地图启动失败（${e.javaClass.simpleName.take(24)}）")
                        stopSelf()
                    }
                }
            }
            else -> { if (!alive.get()) { expectedStopReason = "unknown_action_without_session"; stopSelf(); return START_NOT_STICKY } }
        }
        return START_NOT_STICKY
    }

    private fun loadSession(file: File, deletePreviousFile: Boolean = true) {
        require(file.canonicalFile.parentFile == cacheDir.canonicalFile) { "路线文件位置无效" }
        require(file.length() in 1..(4L * 1024 * 1024)) { "悬浮地图数据大小无效" }
        val bytes = file.readBytes(); FloatingNavigationGeometry.validatePayloadBytes(bytes)
        val parsed = parseSession(JSONObject(bytes.toString(Charsets.UTF_8)))
        val routeChanged = kind != parsed.kind || route != parsed.points
        val previous = routeFile?.takeIf { it != file }
        routeFile = file
        kind = parsed.kind; mode = parsed.mode; routeLabel = parsed.label
        persistMode()
        routeColor = parsed.routeColor
        if (route != parsed.points) route = parsed.points
        parsed.zoom?.let { zoom = it }
        parsed.widthDp?.let { windowWidthDp = it }
        parsed.heightDp?.let { windowHeightDp = it }
        getSharedPreferences("floating_navigation_layout", MODE_PRIVATE).edit().putInt("zoom", zoom)
            .putFloat("widthDp", windowWidthDp).putFloat("heightDp", windowHeightDp).apply()
        if (routeChanged) cachedRouteProjection = lastFix?.let { fix ->
            val state = NativePositionState(fix, System.currentTimeMillis())
            if (NativePositionPolicy.present(state).visible && kind == "route") FloatingNavigationGeometry.routeProjection(FloatingCoordinate(fix.longitude, fix.latitude), route) else null
        }
        if (overlay == null) createOverlay()
        params?.let { lp -> applyWindowSize(lp) }
        updateView()
        if (deletePreviousFile) previous?.delete()
    }

    private fun ensureLocationUpdates() {
        if (alive.getAndSet(true)) return
        if (!hasLocationPermission()) throw SecurityException("需由应用授予精确定位权限")
        val lm = locationManager ?: throw IllegalStateException("定位服务不可用")
        val fine = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        applyLocationUpdates(fine, lowPower = energySaving && !screenOn, requestFreshFix = true)
    }

    private fun updateLocationRequestPolicy(requestFreshFix: Boolean = false) {
        if (!alive.get()) return
        val fine = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        applyLocationUpdates(fine, lowPower = energySaving && !screenOn, requestFreshFix = requestFreshFix)
    }

    @Suppress("MissingPermission")
    private fun applyLocationUpdates(fine: Boolean, lowPower: Boolean, requestFreshFix: Boolean) {
        val lm = locationManager ?: return
        val providers = if (lowPower) listOf(LocationManager.NETWORK_PROVIDER)
            else if (fine) listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
            else listOf(LocationManager.NETWORK_PROVIDER)
        val changed = lowPowerLocationRequests != lowPower || !locationRequestsStarted
        if (changed) runCatching { lm.removeUpdates(this) }
        lowPowerLocationRequests = lowPower
        for (provider in providers) {
            if (runCatching { lm.isProviderEnabled(provider) }.getOrDefault(false)) {
                if (changed) {
                    val minTime = if (lowPower) 180_000L else 900L
                    val minDistance = if (lowPower) 25f else 0f
                    runCatching { lm.requestLocationUpdates(provider, minTime, minDistance, this, android.os.Looper.getMainLooper()) }
                }
            }
        }
        locationRequestsStarted = true
        // Seed from the providers actually requested. Coarse-only users can use
        // network fixes for a map center, but those fixes never feed headingFilter.
        if (changed || requestFreshFix) providers.forEach { provider ->
            runCatching { lm.getLastKnownLocation(provider)?.let(::onLocationChanged) }
            if (requestFreshFix && !lowPower && runCatching { lm.isProviderEnabled(provider) }.getOrDefault(false)) {
                runCatching { lm.requestSingleUpdate(provider, this, android.os.Looper.getMainLooper()) }
            }
        }
    }

    @Suppress("MissingPermission")
    private fun hasLocationPermission() = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED || ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun createOverlay() {
        val view = FloatingNavigationView(this)
        val safeSize = safeWindowSize(windowWidthDp, windowHeightDp)
        windowWidthDp = safeSize.widthDp; windowHeightDp = safeSize.heightDp
        val width = (windowWidthDp * resources.displayMetrics.density).roundToInt()
        val height = (windowHeightDp * resources.displayMetrics.density).roundToInt()
        val type = if (Build.VERSION.SDK_INT >= 26) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE
        val lp = WindowManager.LayoutParams(width, height, type, WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN, PixelFormat.TRANSLUCENT).apply { gravity = Gravity.TOP or Gravity.START; x = 12; y = 120 }
        view.onMode = { mode = nextMode(mode); persistMode(); updateView(); reconcileCompassSource() }
        view.onReturn = { returnToApp() }
        view.onClose = { setWindowEnabled(this, false) }
        view.onContentSizeChanged = { scheduleTileRefresh() }
        view.zoom = zoom
        view.kind = kind
        view.recordingPhase = currentRecordingSnapshot.phase
        view.recordedSegments = currentRecordingSnapshot.segments
        view.onZoom = { delta ->
            zoom = (zoom + delta).coerceIn(FloatingNavigationGeometry.MIN_ZOOM, FloatingNavigationGeometry.MAX_ZOOM)
            getSharedPreferences("floating_navigation_layout", MODE_PRIVATE).edit().putInt("zoom", zoom).apply()
            view.zoom = zoom; refreshTiles(); updateView(); publishLayoutStatus()
        }
        view.onRecordAction = { action -> recordingActionListener?.invoke(action) }
        view.onDrag = { dx, dy -> lp.x = (lp.x + dx.roundToInt()).coerceIn(0, max(0, screenWidth() - lp.width)); lp.y = (lp.y + dy.roundToInt()).coerceIn(0, max(0, screenHeight() - lp.height)); runCatching { windowManager?.updateViewLayout(view, lp) }; publishWindowBounds(lp, view.parent != null) }
        view.onResize = { dx, dy ->
            val density = resources.displayMetrics.density.coerceAtLeast(.1f)
            windowWidthDp += dx / density; windowHeightDp += dy / density
            val safe = safeWindowSize(windowWidthDp, windowHeightDp)
            windowWidthDp = safe.widthDp; windowHeightDp = safe.heightDp
            applyWindowSize(lp)
            lp.x = lp.x.coerceIn(0, max(0, screenWidth() - lp.width)); lp.y = lp.y.coerceIn(0, max(0, screenHeight() - lp.height))
            runCatching { windowManager?.updateViewLayout(view, lp) }
            getSharedPreferences("floating_navigation_layout", MODE_PRIVATE).edit().putFloat("widthDp", windowWidthDp).putFloat("heightDp", windowHeightDp).apply()
            view.invalidate(); publishWindowBounds(lp, view.parent != null); publishLayoutStatus()
        }
        overlay = view; params = lp
        if (windowEnabled && !appVisible && Settings.canDrawOverlays(this)) windowManager?.addView(view, lp)
        reconcileCompassSource()
    }

    private fun showOrHideOverlay() {
        val view = overlay ?: return
        val wm = windowManager ?: return
        val shouldShow = windowEnabled && !appVisible && !(screenOn && keyguardLocked)
        val attached = view.parent != null
        if (shouldShow && !Settings.canDrawOverlays(this)) {
            overlayFailureMessage = "悬浮窗权限不可用"
        } else if (shouldShow && !attached) {
            val attachedNow = runCatching { wm.addView(view, params); view.parent != null }.getOrDefault(false)
            overlayFailureMessage = if (attachedNow) "" else "悬浮窗窗口未能显示"
        } else if (!shouldShow || attached) {
            overlayFailureMessage = ""
        }
        if (!shouldShow && attached) runCatching { wm.removeView(view) }
        synchronized(stateLock) {
            visibleState = shouldShow && view.parent != null
            if (overlayFailureMessage.isNotEmpty() || messageState == "悬浮窗权限不可用" || messageState == "悬浮窗窗口未能显示") {
                messageState = overlayFailureMessage
            }
        }
        publishWindowBounds(params, shouldShow && view.parent != null)
        if (shouldShow) updateView()
        reconcileCompassSource()
    }

    private fun reconcileWindowOptions() {
        if (!lockscreenEnabled) {
            sendBroadcast(Intent(FloatingLockMapActivity.ACTION_SESSION_ENDED).setPackage(packageName)
                .putExtra(LOCKSCREEN_TOKEN_EXTRA, lockscreenToken))
            lockscreenView?.let(::detachLockscreenViewInternal)
            lockscreenLaunchPending = false
            lockscreenLaunchAttempted = true
        } else if (screenOn && keyguardLocked && !lockscreenLaunchAttempted) {
            maybeLaunchLockscreenActivity()
        }
    }

    private fun setOverlayVisible(visible: Boolean) { appVisible = !visible; showOrHideOverlay() }

    private fun returnToApp() {
        setOverlayVisible(false)
        val launch = packageManager.getLaunchIntentForPackage(packageName)?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
        if (launch != null) startActivity(launch)
    }

    private fun updateView() {
        val targets = listOfNotNull(overlay, lockscreenView).distinct()
        if (targets.isEmpty()) return
        targets.forEach(::updateView)
    }

    private fun reconcileCompassSource() {
        val hasDisplayedMap = overlay?.parent != null || lockscreenView != null
        if (alive.get() && screenOn && mode == "compass" && hasDisplayedMap) compassSource?.start()
        else compassSource?.stop()
    }

    private fun nextMode(current: String): String = when (current) {
        "north" -> "motion"
        "motion" -> "compass"
        else -> "north"
    }

    private fun updateView(view: FloatingNavigationView) {
        val fix = lastFix
        val state = NativePositionState(fix, System.currentTimeMillis(), heading, if (heading != null) NativeHeadingSource.MOTION else null, headingAt.takeIf { heading != null }, if (heading != null) 20.0 else null, NativeDirectionMode.MOTION)
        val presentation = NativePositionPolicy.present(state)
        view.route = route; view.kind = kind; view.routeColor = routeColor; view.zoom = zoom; view.label = routeLabel; view.mode = mode
        view.recordingPhase = currentRecordingSnapshot.phase
        view.recordedSegments = currentRecordingSnapshot.segments
        val reliable = presentation.visible && fix != null && fix.accuracyMeters <= 50.0
        val actualPosition = fix?.takeIf { presentation.visible }?.let { FloatingCoordinate(it.longitude, it.latitude) }
        view.hasRealLocation = actualPosition != null
        view.center = fix?.takeIf { presentation.visible }?.let { FloatingCoordinate(it.longitude, it.latitude) }
            ?: if (kind == "route") route.firstOrNull() else null
        val fixAge = fix?.let { System.currentTimeMillis() - it.timestampMillis }
        // NativePositionPolicy allows a course from a still-visible 30s fix.
        // A direction glyph is stricter: require a current fix no older than 3s.
        val freshHeading = presentation.headingDegrees?.takeIf { fixAge != null && fixAge in -3_000..3_000 }
        val compassAgeNanos = android.os.SystemClock.elapsedRealtimeNanos() - compassHeadingAtNanos
        val freshCompass = compassHeading?.takeIf { compassHeadingAtNanos > 0L && compassAgeNanos in 0..3_000_000_000L }
        view.mapBearing = when (mode) {
            "compass" -> freshCompass
            "motion" -> mapBearing
            else -> null
        }
        view.heading = if (mode == "compass") freshCompass else freshHeading
        view.stateText = when {
            !presentation.visible -> "等待定位"
            !reliable -> "定位精度不足"
            mode == "motion" && freshHeading == null -> "等待移动方向"
            mode == "compass" && freshCompass == null -> compassMessage.ifBlank { "等待罗盘方向" }
            kind == "position" -> "定位中"
            else -> "导航中"
        }
        val routeProjection = cachedRouteProjection.takeIf { reliable && kind == "route" }
        view.routeRemainingMeters = routeProjection?.remainingMeters
        view.routeOffRoute = routeProjection?.offRoute == true
        synchronized(tileCache) { view.tiles = tileCache.values.toList() }
        view.invalidate()
    }

    private data class RecordingSnapshot(val phase: String, val segments: List<List<FloatingCoordinate>>)

    private fun parseRecordingSnapshot(snapshot: JSONObject): RecordingSnapshot {
        FloatingNavigationGeometry.validatePayloadBytes(snapshot.toString().toByteArray(Charsets.UTF_8))
        val phase = snapshot.optString("phase")
        require(phase in setOf("idle", "recording", "paused", "finished")) { "记录状态无效" }
        val rawSegments = snapshot.optJSONArray("segments") ?: JSONArray()
        require(rawSegments.length() <= 100) { "记录分段超限" }
        var pointCount = 0
        val segments = ArrayList<List<FloatingCoordinate>>(rawSegments.length())
        for (segmentIndex in 0 until rawSegments.length()) {
            val rawSegment = rawSegments.optJSONArray(segmentIndex) ?: throw IllegalArgumentException("记录分段无效")
            val points = ArrayList<FloatingCoordinate>(rawSegment.length())
            for (pointIndex in 0 until rawSegment.length()) {
                require(++pointCount <= FloatingNavigationGeometry.MAX_RECORDING_POINTS) { "记录点数超限" }
                val point = rawSegment.optJSONObject(pointIndex) ?: throw IllegalArgumentException("记录点无效")
                val coordinates = point.optJSONArray("coordinates") ?: throw IllegalArgumentException("记录坐标缺失")
                require(coordinates.length() == 2 && coordinates.opt(0) is Number && coordinates.opt(1) is Number) { "记录坐标格式无效" }
                val coordinate = FloatingCoordinate(coordinates.getDouble(0), coordinates.getDouble(1))
                FloatingNavigationGeometry.validateCoordinate(coordinate.longitude, coordinate.latitude)
                points += coordinate
            }
            segments += points
        }
        return RecordingSnapshot(phase, segments)
    }

    private fun applyRecordingSnapshot(snapshot: RecordingSnapshot) {
        currentRecordingSnapshot = snapshot
        listOfNotNull(overlay, lockscreenView).distinct().forEach { view ->
            view.recordingPhase = snapshot.phase
            view.recordedSegments = snapshot.segments
        }
    }

    override fun onLocationChanged(location: Location) {
        val provider = location.provider ?: "unknown"
        if (provider != LocationManager.GPS_PROVIDER && provider != LocationManager.NETWORK_PROVIDER) { updateView(); return }
        val fix = NativePositionFix(location.latitude, location.longitude, location.accuracy.toDouble(), location.time, provider, if (location.hasSpeed()) location.speed.toDouble() else null, if (location.hasBearing()) location.bearing.toDouble() else null, null)
        val now = System.currentTimeMillis()
        if (!NativePositionPolicy.present(NativePositionState(fix, now)).visible || !shouldAcceptFix(fix, now)) { updateView(); return }
        if (provider == LocationManager.GPS_PROVIDER) {
            val nextHeading = headingFilter.update(fix, now)
            if (nextHeading != null) {
                heading = nextHeading
                headingAt = headingFilter.acceptedAt.takeIf { it > 0 } ?: now
                mapBearing = nextHeading
            }
        }
        lastFix = fix
        compassSource?.updateLocation(fix.latitude, fix.longitude, location.altitude.takeIf { location.hasAltitude() } ?: 0.0)
        val state = NativePositionState(fix, now)
        cachedRouteProjection = if (NativePositionPolicy.present(state).visible) FloatingNavigationGeometry.routeProjection(FloatingCoordinate(fix.longitude, fix.latitude), route) else null
        updateView(); refreshTiles()
    }

    private fun shouldAcceptFix(candidate: NativePositionFix, nowMillis: Long): Boolean {
        val current = lastFix ?: return true
        val currentPresentation = NativePositionPolicy.present(NativePositionState(current, nowMillis))
        if (!currentPresentation.visible) return true
        val currentAge = nowMillis - current.timestampMillis
        val candidateAge = nowMillis - candidate.timestampMillis
        val currentFreshGps = current.provider == LocationManager.GPS_PROVIDER &&
            currentAge in -3_000..3_000 && current.accuracyMeters <= 50.0

        // Keep a good, current GPS center over an equal-time/worse coarse fix.
        // Once GPS ages past 3s, newer network fixes are allowed to restore the map.
        if (currentFreshGps && candidate.provider == LocationManager.NETWORK_PROVIDER &&
            candidate.accuracyMeters >= current.accuracyMeters) return false

        if (candidate.timestampMillis < current.timestampMillis) return false
        if (candidate.timestampMillis == current.timestampMillis) {
            if (candidate.provider == LocationManager.GPS_PROVIDER && current.provider != LocationManager.GPS_PROVIDER) return true
            return candidate.accuracyMeters < current.accuracyMeters
        }
        return candidateAge in -3_000..30_000
    }

    private fun refreshTiles() {
        val fix = lastFix
        val anchor = (fix?.takeIf { NativePositionPolicy.present(NativePositionState(it, System.currentTimeMillis())).visible }
            ?.let { FloatingCoordinate(it.longitude, it.latitude) } ?: if (kind == "route") route.firstOrNull() else null) ?: return
        if (refreshJob?.isActive == true) { refreshAgain = true; return }
        refreshJob = scope.launch {
            val tileCount = 1 shl MAP_ZOOM
            val center = tileFor(anchor.longitude, anchor.latitude, MAP_ZOOM)
            val centerWorldX = (anchor.longitude + 180.0) / 360.0 * tileCount
            val latRad = Math.toRadians(anchor.latitude.coerceIn(-85.05112878, 85.05112878))
            val centerWorldY = (1.0 - ln(tan(latRad) + 1.0 / cos(latRad)) / Math.PI) / 2.0 * tileCount
            val density = resources.displayMetrics.density.toDouble().coerceAtLeast(.1)
            val lockView = lockscreenView?.takeIf { it.isAttachedToWindow && it.width > 0 && it.height > 0 }
            val targetView = lockView ?: overlay
            val widthPx = targetView?.width?.takeIf { it > 0 } ?: (184.0 * density).roundToInt()
            val heightPx = targetView?.height?.takeIf { it > 0 } ?: (216.0 * density).roundToInt()
            // Lock map has no header/footer. The ordinary map's compact header occupies
            // the top 32dp; there is no footer after the latest view layout.
            val viewportWidthDp = widthPx / density
            val viewportHeightDp = (heightPx / density - if (lockView == null) 32.0 else 0.0).coerceAtLeast(0.0)
            // A circle with the viewport's half-diagonal contains all four corners after
            // any camera rotation, so this remains conservative for motion-up rendering.
            val tileSizeDp = 256.0 * FloatingNavigationGeometry.overzoomScale(zoom)
            val radiusTiles = hypot(viewportWidthDp, viewportHeightDp) / 2.0 / tileSizeDp
            val minX = floor(centerWorldX - radiusTiles).toInt(); val maxX = floor(centerWorldX + radiusTiles).toInt()
            val minY = floor(centerWorldY - radiusTiles).toInt().coerceAtLeast(0); val maxY = floor(centerWorldY + radiusTiles).toInt().coerceAtMost(tileCount - 1)
            val centerTileX = center.x
            val centerTileY = center.y
            fun tileDistanceSquared(tile: TileId): Double {
                var dx = tile.x + .5 - centerWorldX
                if (dx > tileCount / 2.0) dx -= tileCount
                if (dx < -tileCount / 2.0) dx += tileCount
                val dy = tile.y + .5 - centerWorldY
                return dx * dx + dy * dy
            }
            val candidates = (minY..maxY).flatMap { y ->
                (minX..maxX).map { x -> TileId(MAP_ZOOM, (x % tileCount + tileCount) % tileCount, y) }
            }.distinctBy { it.key }
            val targets = candidates.sortedWith(
                compareBy<TileId> { if (it.x == centerTileX && it.y == centerTileY) 0 else 1 }
                    .thenBy(::tileDistanceSquared).thenBy { it.y }.thenBy { it.x },
            ).take(MAX_TILE_REQUESTS)
            val missing = synchronized(tileCache) { targets.filter { !tileCache.containsKey(it.key) } }
            missing.chunked(2).forEach { batch ->
                coroutineScope {
                    batch.map { tile -> async(Dispatchers.IO) {
                        tileSemaphore.withPermit {
                            val tileSource = source ?: synchronized(this@FloatingNavigationService) { source ?: com.shantu.nativeapp.map.NativeFloatingVectorSource().also { source = it } }
                            val bytes = tileSource.read(tile.z, tile.x, tile.y) ?: return@withPermit null
                            try { withContext(Dispatchers.Default) {
                                val decoded = NativeMvtDecoder.decodeForFloatingMap(bytes)
                                recordMvtDecode(decoded.stats)
                                FloatingTileGeometry(tile.z, tile.x, tile.y, decoded.features)
                            } }
                            catch (cancelled: CancellationException) { throw cancelled }
                            catch (_: Exception) { null }
                        }
                    } }.awaitAll().filterNotNull().forEach { decoded -> synchronized(tileCache) { tileCache["${decoded.z}/${decoded.x}/${decoded.y}"] = decoded } }
                }
                updateView()
            }
            val currentAnchor = lastFix?.takeIf { NativePositionPolicy.present(NativePositionState(it, System.currentTimeMillis())).visible }
                ?.let { FloatingCoordinate(it.longitude, it.latitude) } ?: if (kind == "route") route.firstOrNull() else null
            val moved = currentAnchor != null && tileFor(currentAnchor.longitude, currentAnchor.latitude, MAP_ZOOM) != center
            if (moved || refreshAgain) {
                refreshAgain = false
                refreshJob = null
                refreshTiles()
            } else refreshJob = null
        }
    }

    private data class TileId(val z: Int, val x: Int, val y: Int) { val key get() = "$z/$x/$y" }
    private fun tileFor(lon: Double, lat: Double, z: Int): TileId {
        val n = 1 shl z; val x = floor((lon + 180.0) / 360.0 * n).toInt().coerceIn(0, n - 1)
        val r = Math.toRadians(lat.coerceIn(-85.05112878, 85.05112878)); val y = floor((1.0 - ln(tan(r) + 1 / cos(r)) / Math.PI) / 2 * n).toInt().coerceIn(0, n - 1)
        return TileId(z, x, y)
    }

    private fun safeWindowSize(width: Float, height: Float): FloatingWindowSize {
        val density = resources.displayMetrics.density.coerceAtLeast(.1f)
        return FloatingNavigationGeometry.windowSize(width, height, screenWidth() / density, screenHeight() / density)
    }

    private fun applyWindowSize(lp: WindowManager.LayoutParams) {
        val safe = safeWindowSize(windowWidthDp, windowHeightDp)
        windowWidthDp = safe.widthDp; windowHeightDp = safe.heightDp
        val density = resources.displayMetrics.density.coerceAtLeast(.1f)
        lp.width = (windowWidthDp * density).roundToInt().coerceAtLeast(1)
        lp.height = (windowHeightDp * density).roundToInt().coerceAtLeast(1)
    }

    private fun publishLayoutStatus() { synchronized(stateLock) { zoomState = zoom; widthDpState = windowWidthDp.toDouble(); heightDpState = windowHeightDp.toDouble() } }

    private fun persistMode() {
        getSharedPreferences(STATE_PREFS, MODE_PRIVATE).edit().putString(PREF_MODE, mode).apply()
        synchronized(stateLock) { modeState = mode }
    }

    override fun onConfigurationChanged(newConfig: android.content.res.Configuration) {
        super.onConfigurationChanged(newConfig)
        params?.let { lp ->
            applyWindowSize(lp)
            lp.x = lp.x.coerceIn(0, max(0, screenWidth() - lp.width)); lp.y = lp.y.coerceIn(0, max(0, screenHeight() - lp.height))
            runCatching { overlay?.let { view -> windowManager?.updateViewLayout(view, lp) } }
            publishWindowBounds(lp, overlay?.parent != null); publishLayoutStatus(); overlay?.invalidate()
        }
    }
    private fun screenWidth() = if (Build.VERSION.SDK_INT >= 30) resources.displayMetrics.widthPixels else @Suppress("DEPRECATION") (getSystemService(WINDOW_SERVICE) as WindowManager).defaultDisplay.width
    private fun screenHeight() = if (Build.VERSION.SDK_INT >= 30) resources.displayMetrics.heightPixels else @Suppress("DEPRECATION") (getSystemService(WINDOW_SERVICE) as WindowManager).defaultDisplay.height

    private fun createChannel() { if (Build.VERSION.SDK_INT >= 26) getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(CHANNEL, "悬浮导航", NotificationManager.IMPORTANCE_LOW).apply { description = "后台路线定位状态" }) }
    private fun buildNotification(): Notification {
        val stop = PendingIntent.getService(this, 7822, Intent(this, FloatingNavigationService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        return NotificationCompat.Builder(this, CHANNEL).setSmallIcon(android.R.drawable.ic_menu_mylocation).setContentTitle("山兔悬浮地图").setContentText("定位小地图正在运行；可关闭悬浮窗或停止服务").setOngoing(true).addAction(0, "停止悬浮导航", stop).build()
    }

    private fun reportError(message: String) { synchronized(stateLock) { enabledState = false; visibleState = false; messageState = message.take(80) }; runCatching { Toast.makeText(this, message.take(60), Toast.LENGTH_SHORT).show() } }
    private fun cleanupOwnedRouteFiles() {
        val staleBefore = System.currentTimeMillis() - 24L * 60 * 60 * 1000
        cacheDir.listFiles()?.filter { it.name.startsWith(ROUTE_PREFIX) && (it.name.endsWith(".json") || it.name.endsWith(".tmp")) && it.lastModified() < staleBefore }?.forEach { runCatching { it.delete() } }
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        getSharedPreferences(STATE_PREFS, MODE_PRIVATE).edit()
            .putLong(PREF_LAST_TASK_REMOVED_AT, System.currentTimeMillis())
            .apply()
        // Task removal is only a diagnostic event. The location session and FGS remain active.
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        val endReason = expectedStopReason ?: "destroyed_without_explicit_stop_action"
        getSharedPreferences(STATE_PREFS, MODE_PRIVATE).edit()
            .putString(PREF_LAST_SERVICE_END_REASON, endReason.take(80))
            .putLong(PREF_LAST_SERVICE_END_AT, System.currentTimeMillis())
            .apply()
        sendBroadcast(Intent(FloatingLockMapActivity.ACTION_SESSION_ENDED).setPackage(packageName)
            .putExtra(LOCKSCREEN_TOKEN_EXTRA, lockscreenToken))
        alive.set(false); refreshJob?.cancel(); resizeRefreshJob?.cancel()
        lockscreenLaunchAckJob?.cancel(); screenCheckJob?.cancel()
        screenReceiver?.let { runCatching { unregisterReceiver(it) } }; screenReceiver = null
        compassSource?.stop(); compassSource = null
        lockscreenView?.let(::detachLockscreenViewInternal)
        scope.cancel()
        runCatching { locationManager?.removeUpdates(this) }
        locationRequestsStarted = false
        runCatching { if (overlay?.parent != null) windowManager?.removeView(overlay) }
        overlay = null; synchronized(tileCache) { tileCache.clear() }
        runCatching { synchronized(this) { source?.close(); source = null } }
        routeFile?.delete(); routeFile = null; cleanupOwnedRouteFiles()
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE) else @Suppress("DEPRECATION") stopForeground(true)
        synchronized(stateLock) { enabledState = false; visibleState = false }
        publishWindowBounds(null, false)
        screenOn = false; keyguardLocked = false; lockscreenLaunchPending = false; lockscreenLaunchAttempted = false; lockscreenMessage = ""
        publishLockscreenStatus()
        appContext = null
        if (activeService === this) activeService = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
    @Deprecated("Deprecated in Java") override fun onStatusChanged(provider: String?, status: Int, extras: android.os.Bundle?) = Unit
    override fun onProviderEnabled(provider: String) = Unit
    override fun onProviderDisabled(provider: String) = Unit
}
