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
import org.json.JSONArray
import org.json.JSONObject
import java.io.Closeable
import kotlin.math.abs

/** Narrow, foreground-only bridge for the optional floating navigation service. */
class FloatingNavigationBridge(
    private val activity: NativeReactActivity,
    private val webView: WebView,
) : Closeable {
    private var pendingStart: JSONObject? = null
    private var waitingForOverlaySettings = false
    private var message = ""
    @Volatile private var trustedOrigin = false
    @Volatile private var closed = false

    @JavascriptInterface
    fun status(): String {
        if (!trustedPage()) return JSONObject().put("available", false).put("enabled", false)
            .put("visible", false).put("mode", JSONObject.NULL).put("message", "仅山兔前台页面可读取悬浮导航状态")
            .put("locationAllowed", false).put("notificationAllowed", false).put("overlayAllowed", false).toString()
        return try {
            statusJson().toString()
        } catch (_: Exception) {
            JSONObject().put("available", true).put("enabled", false).put("visible", false)
                .put("mode", JSONObject.NULL).put("message", "悬浮导航状态暂不可用")
                .put("locationAllowed", hasLocationPermission()).put("notificationAllowed", hasNotificationPermission())
                .put("overlayAllowed", canDrawOverlays()).toString()
        }
    }

    @JavascriptInterface
    fun start(payload: String) = dispatch(payload, Action.START)

    @JavascriptInterface
    fun update(payload: String) = dispatch(payload, Action.UPDATE)

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

    private enum class Action { START, UPDATE }

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

    private fun continueStart() {
        val payload = pendingStart ?: return
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
        try {
            FloatingNavigationService.start(activity, payload)
            pendingStart = null
            message = "悬浮导航已启动"
        } catch (_: SecurityException) {
            pendingStart = null
            message = "系统未允许启动悬浮导航，请检查定位、通知和悬浮窗权限"
        } catch (_: Exception) {
            pendingStart = null
            message = "启动悬浮导航失败，请稍后重试"
        }
        dispatchChange()
    }

    private fun updateActive(payload: JSONObject) {
        if (!trustedPage()) return
        val current = try { FloatingNavigationService.status() } catch (_: Exception) { JSONObject() }
        if (!current.optBoolean("enabled", false)) {
            message = "悬浮导航尚未启动，请先启动后再更新"
            dispatchChange()
            return
        }
        try {
            FloatingNavigationService.update(activity, payload)
            message = "悬浮导航路线已更新"
        } catch (_: Exception) {
            message = "更新悬浮导航失败，请重试"
        }
        dispatchChange()
    }

    private fun validatePayload(raw: String?): JSONObject {
        require(raw != null && raw.toByteArray(Charsets.UTF_8).size <= MAX_PAYLOAD_BYTES) { "路线数据超过4 MiB或为空" }
        val input = try { JSONObject(raw) } catch (_: Exception) { throw IllegalArgumentException("悬浮导航数据格式无效") }
        require(input.optInt("version", -1) == 1) { "悬浮导航数据版本不受支持" }
        val mode = input.optString("mode", "")
        require(mode == "north" || mode == "motion") { "导航模式无效" }
        val label = input.optString("label", "")
        require(label.length <= MAX_LABEL_LENGTH) { "路线名称过长" }
        val points = input.optJSONArray("coordinates")
            ?: throw IllegalArgumentException("缺少路线坐标")
        require(points.length() in 2..MAX_ROUTE_POINTS) { "路线至少需要两个点，且点数不能超过$MAX_ROUTE_POINTS" }
        for (i in 0 until points.length()) {
            val pair = points.optJSONArray(i)
            require(pair != null && pair.length() == 2) { "路线坐标格式无效" }
            val lon = pair.optDouble(0, Double.NaN)
            val lat = pair.optDouble(1, Double.NaN)
            require(lon.isFinite() && lat.isFinite() && abs(lon) <= 180.0 && abs(lat) <= 90.0) { "路线坐标超出有效范围" }
        }
        // Copy only the documented v1 contract; never forward arbitrary JS fields.
        return JSONObject().put("version", 1).put("mode", mode).put("label", label)
            .put("coordinates", JSONArray(points.toString()))
    }

    private fun statusJson(): JSONObject {
        val service = try { FloatingNavigationService.status() } catch (_: Exception) { JSONObject() }
        val enabled = service.optBoolean("enabled", false)
        val serviceMessage = service.optString("message", "")
        val localMessage = if (!enabled && message == "正在停止悬浮导航") "悬浮导航已停止" else message
        val root = JSONObject()
            .put("available", true)
            .put("enabled", enabled)
            .put("visible", service.optBoolean("visible", false))
            .put("mode", service.optString("mode").takeIf { it == "north" || it == "motion" } ?: JSONObject.NULL)
            .put("message", serviceMessage.ifBlank { localMessage })
            .put("locationAllowed", hasLocationPermission())
            .put("notificationAllowed", hasNotificationPermission())
            .put("overlayAllowed", canDrawOverlays())
        // Whitelist non-sensitive service state only. Route, coordinates, labels,
        // URLs, and keys are intentionally never returned to JavaScript here.
        listOf("permissionRequired", "lastErrorCode").forEach { key ->
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
