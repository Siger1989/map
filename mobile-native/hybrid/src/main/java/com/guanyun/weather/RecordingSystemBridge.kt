package com.guanyun.weather

import android.Manifest
import android.app.ActivityManager
import android.app.NotificationManager
import android.app.StatusBarManager
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.drawable.Icon
import android.location.LocationManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.Toast
import com.shantu.nativeapp.R
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicBoolean

/** Read Android's recording prerequisites and open user-controlled system settings. */
class RecordingSystemBridge(private val activity: NativeReactActivity, private val webView: WebView) {
    companion object {
        const val JS_NAME = "ShantuRecordingSystem"
        const val OPEN_EVENT = "shantu:open-recording"
        const val STATE_EVENT = "shantu:recording-system-state"
    }

    private val openRecording = AtomicBoolean(false)

    @JavascriptInterface
    fun state(): String {
        if (!activity.trustedForeground()) return "{}"
        val power = activity.getSystemService(PowerManager::class.java)
        val location = activity.getSystemService(LocationManager::class.java)
        val notifications = activity.getSystemService(NotificationManager::class.java)
        val locationEnabled = if (Build.VERSION.SDK_INT >= 28) location.isLocationEnabled else
            location.isProviderEnabled(LocationManager.GPS_PROVIDER) || location.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
        return JSONObject()
            .put("preciseLocation", activity.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED)
            .put("systemLocation", locationEnabled)
            .put("notifications", notifications.areNotificationsEnabled() &&
                notifications.getNotificationChannel("trip-recording")?.importance != NotificationManager.IMPORTANCE_NONE)
            .put("batteryUnrestricted", power.isIgnoringBatteryOptimizations(activity.packageName))
            .put("batterySaver", power.isPowerSaveMode)
            .put("backgroundRestricted", Build.VERSION.SDK_INT >= 28 &&
                activity.getSystemService(ActivityManager::class.java).isBackgroundRestricted)
            .toString()
    }

    @JavascriptInterface
    fun takeOpenRecording(): Boolean = activity.trustedForeground() && openRecording.getAndSet(false)

    fun requestOpenRecording() {
        openRecording.set(true)
        notify(OPEN_EVENT)
    }

    fun onResume() {
        if (openRecording.get()) notify(OPEN_EVENT)
        notify(STATE_EVENT)
    }

    private fun notify(event: String) {
        if (activity.trustedForeground()) {
            webView.evaluateJavascript("window.dispatchEvent(new Event('$event'))", null)
        }
    }

    @JavascriptInterface
    fun openSettings(destination: String) = activity.runOnUiThread {
        if (!activity.trustedForeground()) return@runOnUiThread
        val appDetails = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", activity.packageName, null))
        val intent = when (destination) {
            "permissions" -> appDetails
            "location" -> Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)
            "notifications" -> Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, activity.packageName)
            "battery" -> Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
            "powerSaver" -> Intent(Settings.ACTION_BATTERY_SAVER_SETTINGS)
            else -> return@runOnUiThread
        }
        if (runCatching { activity.startActivity(intent) }.isFailure &&
            runCatching { activity.startActivity(appDetails) }.isFailure) {
            show("请从系统设置打开山兔的应用详情。")
        }
    }

    @JavascriptInterface
    fun addTile() = activity.runOnUiThread {
        if (!activity.trustedForeground()) return@runOnUiThread
        if (Build.VERSION.SDK_INT < 33) {
            show("下拉快捷设置，点编辑，添加「轨迹记录」。")
            return@runOnUiThread
        }
        val status = activity.getSystemService(StatusBarManager::class.java)
        runCatching {
            status.requestAddTileService(
                ComponentName(activity, RecordingTileService::class.java),
                "轨迹记录",
                Icon.createWithResource(activity, R.drawable.ic_recording_tile),
                activity.mainExecutor
            ) { result ->
                when (result) {
                    StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ADDED -> show("已添加到快捷设置。")
                    StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ALREADY_ADDED -> show("轨迹记录已在快捷设置中。")
                    StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_NOT_ADDED -> Unit
                    else -> show("请下拉快捷设置，点编辑添加「轨迹记录」。")
                }
            }
        }.onFailure { show("请下拉快捷设置，点编辑添加「轨迹记录」。") }
    }

    private fun show(message: String) = Toast.makeText(activity, message, Toast.LENGTH_SHORT).show()
}
