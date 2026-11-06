package com.guanyun.weather

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.webkit.JavascriptInterface
import android.webkit.WebView
import com.shantu.nativeapp.floating.FloatingNavigationService
import org.json.JSONObject
import java.io.Closeable

/** Narrow, foreground-only bridge for the optional floating navigation service. */
class FloatingNavigationBridge(
    private val activity: NativeReactActivity,
    private val webView: WebView,
) : Closeable {
    private var pendingStart: JSONObject? = null
    private var waitingForOverlaySettings = false
    private var guideShowing = false
    private var message = ""
    @Volatile private var trustedOrigin = false
    @Volatile private var closed = false

    @JavascriptInterface
    fun status(): String {
        if (!trustedPage()) return JSONObject().put("available", false).put("enabled", false)
            .put("visible", false).put("mode", JSONObject.NULL).put("kind", JSONObject.NULL).put("message", "仅山兔前台页面可读取悬浮导航状态")
            .put("windowEnabled", false).put("lockscreenEnabled", false).put("energySaving", false).put("lockscreenKeepOn", false)
            .put("locationAllowed", false).put("notificationAllowed", false).put("overlayAllowed", false).toString()
        return try {
            statusJson().toString()
        } catch (_: Exception) {
            JSONObject().put("available", true).put("enabled", false).put("visible", false)
                .put("mode", JSONObject.NULL).put("kind", JSONObject.NULL).put("message", "悬浮导航状态暂不可用")
                .put("windowEnabled", false).put("lockscreenEnabled", false).put("energySaving", false).put("lockscreenKeepOn", false)
                .put("locationAllowed", hasLocationPermission()).put("notificationAllowed", hasNotificationPermission())
                .put("overlayAllowed", canDrawOverlays()).toString()
        }
    }

    @JavascriptInterface
    fun start(payload: String) = dispatch(payload, Action.START)

    @JavascriptInterface
    fun update(payload: String) = dispatch(payload, Action.UPDATE)

    @JavascriptInterface
    fun restore(payload: String) = dispatch(payload, Action.RESTORE)

    /** Persist switches/mode without starting the service or invoking permission UI. */
    @JavascriptInterface
    fun setOptions(payload: String) {
        activity.runOnUiThread {
            if (!trustedPage()) return@runOnUiThread
            try {
                require(payload.toByteArray(Charsets.UTF_8).size <= 4096) { "悬浮地图设置过大" }
                val input = JSONObject(payload)
                val allowed = setOf("windowEnabled", "lockscreenEnabled", "mode", "energySaving", "lockscreenKeepOn")
                val keys = input.keys()
                while (keys.hasNext()) require(keys.next() in allowed) { "悬浮地图设置字段无效" }
                val windowEnabled = if (input.has("windowEnabled")) {
                    require(input.opt("windowEnabled") is Boolean) { "windowEnabled 必须是布尔值" }
                    input.getBoolean("windowEnabled")
                } else null
                val lockscreenEnabled = if (input.has("lockscreenEnabled")) {
                    require(input.opt("lockscreenEnabled") is Boolean) { "lockscreenEnabled 必须是布尔值" }
                    input.getBoolean("lockscreenEnabled")
                } else null
                val mode = if (input.has("mode")) input.optString("mode") else null
                require(mode == null || mode in setOf("north", "motion", "compass")) { "方向模式无效" }
                val energySaving = if (input.has("energySaving")) {
                    require(input.opt("energySaving") is Boolean) { "energySaving 必须是布尔值" }
                    input.getBoolean("energySaving")
                } else null
                val lockscreenKeepOn = if (input.has("lockscreenKeepOn")) {
                    require(input.opt("lockscreenKeepOn") is Boolean) { "lockscreenKeepOn 必须是布尔值" }
                    input.getBoolean("lockscreenKeepOn")
                } else null
                FloatingNavigationService.setOptions(activity, windowEnabled, lockscreenEnabled, mode, energySaving, lockscreenKeepOn)
                val state = FloatingNavigationService.status(activity)
                pendingStart?.let { pendingStart = mergeNativeOptions(it, state) }
                if (!state.optBoolean("windowEnabled", true) && !state.optBoolean("lockscreenEnabled", true)) {
                    pendingStart = null
                    waitingForOverlaySettings = false
                }
                message = if (!state.optBoolean("windowEnabled", true) && !state.optBoolean("lockscreenEnabled", true))
                    "普通小窗与锁屏地图均已关闭" else "悬浮地图设置已保存"
            } catch (e: Exception) {
                message = e.message ?: "悬浮地图设置无效"
            }
            dispatchChange()
        }
    }

    @JavascriptInterface
    fun stop() {
        activity.runOnUiThread {
            if (!trustedPage()) return@runOnUiThread
            pendingStart = null
            waitingForOverlaySettings = false
            try {
                FloatingNavigationService.stop(activity)
                message = "正在停止悬浮导航"
            } catch (_: Exception) {
                message = "停止悬浮导航失败，请重试"
            }
            dispatchChange()
        }
    }

    private enum class Action { START, UPDATE, RESTORE }

    private fun dispatch(raw: String?, action: Action) {
        activity.runOnUiThread {
            if (!trustedPage()) return@runOnUiThread
            val payload = try {
                validatePayload(raw)
            } catch (e: IllegalArgumentException) {
                message = e.message ?: "悬浮导航参数无效"
                dispatchChange()
                return@runOnUiThread
            }
            when (action) {
                Action.START -> beginStart(payload)
                Action.UPDATE -> updateActive(payload)
                Action.RESTORE -> restoreIfReady(payload)
            }
        }
    }

    private fun beginStart(payload: JSONObject) {
        // Every start comes from an explicit foreground bridge call. Keeping only
        // this payload across a system permission/settings sheet prevents retries
        // from older route requests or from background callbacks.
        pendingStart = payload
        waitingForOverlaySettings = false
        continueStart()
    }

    /** Restore a previous session without starting a permission prompt or guide. */
    private fun restoreIfReady(payload: JSONObject) {
        if (!trustedPage()) return
        val missing = buildList {
            if (!hasLocationPermission()) add("定位")
            if (!hasNotificationPermission()) add("通知")
            if (!canDrawOverlays()) add("悬浮窗")
        }
        if (missing.isNotEmpty()) {
            message = "恢复待授权：请先在山兔中允许${missing.joinToString("、")}权限，再点开启"
            dispatchChange(); return
        }
        val guide = activity.getSharedPreferences("floating_navigation_guide", android.content.Context.MODE_PRIVATE)
        if (!guide.getBoolean("lock_map_v1", false)) {
            message = "恢复待开启：请先主动开启悬浮地图并阅读使用说明"
            dispatchChange(); return
        }
        val stored = try { FloatingNavigationService.status(activity) } catch (_: Exception) { JSONObject() }
        val restoredPayload = mergeNativeOptions(JSONObject(payload.toString()), stored, preferPersisted = true)
        val windowEnabled = stored.optBoolean("windowEnabled", true)
        val lockscreenEnabled = stored.optBoolean("lockscreenEnabled", true)
        if (!windowEnabled && !lockscreenEnabled) {
            message = "普通小窗与锁屏地图均已关闭"
            dispatchChange(); return
        }
        try {
            FloatingNavigationService.setAppVisible(false)
            if (FloatingNavigationService.status(activity).optBoolean("enabled", false)) FloatingNavigationService.update(activity, restoredPayload)
            else FloatingNavigationService.start(activity, restoredPayload)
            message = "悬浮地图已按上次设置恢复"
        } catch (_: SecurityException) {
            message = "恢复待授权：系统未允许定位前台服务，请回到山兔检查权限"
        } catch (_: Exception) {
            message = "悬浮地图恢复失败，请在前台重新开启"
        }
        dispatchChange()
    }

    private fun continueStart() {
        val pending = pendingStart ?: return
        val optionState = try { FloatingNavigationService.status(activity) } catch (_: Exception) { JSONObject() }
        val payload = mergeNativeOptions(pending, optionState)
        pendingStart = payload
        if (!optionState.optBoolean("windowEnabled", true) && !optionState.optBoolean("lockscreenEnabled", true)) {
            pendingStart = null
            waitingForOverlaySettings = false
            message = "普通小窗与锁屏地图均已关闭"
            dispatchChange(); return
        }
        if (!trustedPage()) {
            clearPending("请回到山兔前台后重新点击悬浮导航")
            return
        }
        if (!hasLocationPermission()) {
            val permissions = arrayOf(Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION)
            activity.requestPermissions(permissions, REQUEST_LOCATION)
            message = "请允许定位权限以启动悬浮导航"
            dispatchChange()
            return
        }
        if (!hasNotificationPermission()) {
            activity.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_NOTIFICATION)
            message = "请允许通知权限以显示导航服务状态"
            dispatchChange()
            return
        }
        if (!canDrawOverlays()) {
            waitingForOverlaySettings = true
            message = "请允许悬浮窗权限后返回山兔"
            dispatchChange()
            try {
                val intent = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${activity.packageName}"))
                activity.startActivityForResult(intent, REQUEST_OVERLAY)
            } catch (_: Exception) {
                clearPending("无法打开悬浮窗权限设置，请到系统设置中手动允许")
            }
            return
        }
        val preferences = activity.getSharedPreferences("floating_navigation_guide", android.content.Context.MODE_PRIVATE)
        if (!preferences.getBoolean("lock_map_v1", false)) {
            if (guideShowing) return
            guideShowing = true
            android.app.AlertDialog.Builder(activity)
                .setTitle("悬浮地图与锁屏地图")
                .setMessage("切换到其他应用后可显示普通小窗；锁屏亮屏时可单独启用黑底渐隐地图，解锁后按普通小窗开关恢复。两个开关分别保存，并记住上次选择；关闭小窗不会结束定位或记录。锁屏地图会显示当前位置和路线，请注意隐私。锁屏地图不会主动唤醒屏幕，也不会保持屏幕常亮。\n\n部分系统可能限制锁屏地图自动打开，可点常驻通知返回地图。定位记录仍须精确定位权限。\n\n地图数据：OpenFreeMap · © OpenMapTiles · © OpenStreetMap contributors（ODbL），图源说明保留在工具页。")
                .setPositiveButton("知道了，开启") { _, _ ->
                    guideShowing = false
                    preferences.edit().putBoolean("lock_map_v1", true).apply()
                    continueStart()
                }
                .setNegativeButton("取消") { _, _ -> guideShowing = false; clearPending("已取消开启悬浮地图") }
                .setOnCancelListener { guideShowing = false; clearPending("已取消开启悬浮地图") }
                .show()
            return
        }
        try {
            // A direct user start should reveal the requested overlay even while
            // the host Activity remains on screen. Returning to the app uses the
            // overlay button and restores this flag through onHostResume().
            FloatingNavigationService.setAppVisible(false)
            FloatingNavigationService.start(activity, payload)
            pendingStart = null
            message = "悬浮导航已启动"
        } catch (_: SecurityException) {
            FloatingNavigationService.setAppVisible(true)
            pendingStart = null
            message = "系统未允许启动悬浮导航，请检查定位、通知和悬浮窗权限"
        } catch (_: Exception) {
            FloatingNavigationService.setAppVisible(true)
            pendingStart = null
            message = "启动悬浮导航失败，请稍后重试"
        }
        dispatchChange()
    }

    private fun updateActive(payload: JSONObject) {
        if (!trustedPage()) return
        val current = try { FloatingNavigationService.status(activity) } catch (_: Exception) { JSONObject() }
        if (!current.optBoolean("enabled", false)) {
            message = "悬浮导航尚未启动，请先启动后再更新"
            dispatchChange()
            return
        }
        try {
            FloatingNavigationService.update(activity, payload)
            message = "悬浮小地图会话已更新"
        } catch (_: Exception) {
            message = "更新悬浮导航失败，请重试"
        }
        dispatchChange()
    }

    /** Native SharedPreferences is authoritative over stale React/pending snapshots. */
    private fun mergeNativeOptions(payload: JSONObject, state: JSONObject, preferPersisted: Boolean = state.optBoolean("optionsConfigured", false)): JSONObject = payload.apply {
        val storedMode = state.optString("mode").takeIf { it in setOf("north", "motion", "compass") } ?: "north"
        put("mode", if (preferPersisted) storedMode else optString("mode").takeIf { it in setOf("north", "motion", "compass") } ?: storedMode)
        put("windowEnabled", if (preferPersisted) state.optBoolean("windowEnabled", true) else optBoolean("windowEnabled", state.optBoolean("windowEnabled", true)))
        put("lockscreenEnabled", if (preferPersisted) state.optBoolean("lockscreenEnabled", true) else optBoolean("lockscreenEnabled", state.optBoolean("lockscreenEnabled", true)))
        put("energySaving", if (preferPersisted) state.optBoolean("energySaving", false) else optBoolean("energySaving", state.optBoolean("energySaving", false)))
        put("lockscreenKeepOn", if (preferPersisted) state.optBoolean("lockscreenKeepOn", false) else optBoolean("lockscreenKeepOn", state.optBoolean("lockscreenKeepOn", false)))
    }

    private fun validatePayload(raw: String?): JSONObject {
        require(raw != null && raw.toByteArray(Charsets.UTF_8).size <= MAX_PAYLOAD_BYTES) { "路线数据超过4 MiB或为空" }
        val input = try { JSONObject(raw) } catch (_: Exception) { throw IllegalArgumentException("悬浮导航数据格式无效") }
        return try { FloatingNavigationService.validatePayload(input) }
        catch (e: IllegalArgumentException) { throw e }
        catch (_: Exception) { throw IllegalArgumentException("悬浮导航数据格式无效") }
    }

    private fun statusJson(): JSONObject {
        val service = try { FloatingNavigationService.status(activity) } catch (_: Exception) { JSONObject() }
        val enabled = service.optBoolean("enabled", false)
        val serviceMessage = service.optString("message", "")
        val localMessage = if (!enabled && message == "正在停止悬浮导航") "悬浮导航已停止" else message
        val root = JSONObject()
            .put("available", true)
            .put("enabled", enabled)
            .put("visible", service.optBoolean("visible", false))
            .put("windowEnabled", service.optBoolean("windowEnabled", true))
            .put("lockscreenEnabled", service.optBoolean("lockscreenEnabled", true))
            .put("energySaving", service.optBoolean("energySaving", false))
            .put("lockscreenKeepOn", service.optBoolean("lockscreenKeepOn", false))
            .put("mode", service.optString("mode").takeIf { it in setOf("north", "motion", "compass") } ?: JSONObject.NULL)
            .put("kind", service.optString("kind").takeIf { it == "position" || it == "route" } ?: JSONObject.NULL)
            .put("message", serviceMessage.ifBlank { localMessage })
            .put("locationAllowed", hasLocationPermission())
            .put("notificationAllowed", hasNotificationPermission())
            .put("overlayAllowed", canDrawOverlays())
        // Whitelist non-sensitive service state only. Route, coordinates, labels,
        // URLs, and keys are intentionally never returned to JavaScript here.
        listOf("zoom", "widthDp", "heightDp", "windowBounds", "permissionRequired", "lastErrorCode", "lockscreen", "diagnostics").forEach { key ->
            if (service.has(key)) root.put(key, service.opt(key))
        }
        return root
    }

    fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        if (requestCode != REQUEST_LOCATION && requestCode != REQUEST_NOTIFICATION) return
        if (pendingStart == null) return
        if (!trustedPage()) {
            clearPending("请回到山兔前台后重新点击悬浮导航")
            return
        }
        val allowed = when (requestCode) {
            REQUEST_LOCATION -> hasLocationPermission()
            else -> hasNotificationPermission()
        }
        if (!allowed) {
            clearPending(if (requestCode == REQUEST_LOCATION) "未获得定位权限，悬浮导航未启动" else "未获得通知权限，悬浮导航未启动")
            return
        }
        continueStart()
    }

    fun onActivityResult(requestCode: Int) {
        if (requestCode != REQUEST_OVERLAY || !waitingForOverlaySettings) return
        // The actual permission is checked on resume, where the system settings
        // page has returned control to this foreground activity.
    }

    fun onHostResume() {
        if (closed) return
        // Activity lifecycle callbacks run on the UI thread, so this is the only
        // place besides onPageStarted that reads WebView.url.
        trustedOrigin = isTrustedAppUrl(webView.url)
        try { FloatingNavigationService.setAppVisible(true) } catch (_: Exception) { }
        if (!trustedPage()) return
        if (waitingForOverlaySettings) {
            waitingForOverlaySettings = false
            if (canDrawOverlays()) continueStart()
            else clearPending("未允许悬浮窗权限，悬浮导航未启动；再次点击可重试")
        }
    }

    fun onHostPause() {
        try { FloatingNavigationService.setAppVisible(false) } catch (_: Exception) { }
    }

    fun onPageStarted(url: String?) {
        trustedOrigin = isTrustedAppUrl(url)
    }

    private fun trustedPage(): Boolean {
        // status() runs on Android's JavaBridge thread. Read only volatile state
        // here: never query WebView or any other UI object from that thread.
        return !closed && trustedOrigin && activity.trustedForeground()
    }

    private fun isTrustedAppUrl(url: String?): Boolean {
        val uri = try { Uri.parse(url ?: return false) } catch (_: Exception) { return false }
        return uri.scheme == "https" && uri.host == "appassets.androidplatform.net" &&
            (uri.port == -1 || uri.port == 443) && uri.path == "/index.html"
    }

    private fun hasLocationPermission(): Boolean =
        activity.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            activity.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun hasNotificationPermission(): Boolean = Build.VERSION.SDK_INT < 33 ||
        activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    private fun canDrawOverlays(): Boolean = Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(activity)

    private fun clearPending(reason: String) {
        pendingStart = null
        waitingForOverlaySettings = false
        message = reason
        dispatchChange()
    }

    private fun dispatchChange() {
        if (trustedPage()) webView.evaluateJavascript("window.dispatchEvent(new Event('shantu:floating-navigation'))", null)
    }

    override fun close() {
        closed = true
        trustedOrigin = false
        pendingStart = null
        waitingForOverlaySettings = false
    }

    companion object {
        const val JS_NAME = "ShantuFloatingNavigation"
        private const val REQUEST_LOCATION = 0x5F11
        private const val REQUEST_NOTIFICATION = 0x5F12
        private const val REQUEST_OVERLAY = 0x5F13
        private const val MAX_PAYLOAD_BYTES = 4 * 1024 * 1024
        private const val MAX_LABEL_LENGTH = 160
        private const val MAX_ROUTE_POINTS = 100_000
    }
}
