package com.guanyun.weather

import android.graphics.Color
import android.view.MotionEvent
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.FrameLayout
import com.shantu.nativeapp.hybrid.NativeReactMapHost
import com.shantu.nativeapp.hybrid.NativeReactOverlay
import com.shantu.nativeapp.hybrid.NativeReactTouchRouter
import com.shantu.nativeapp.map.NativeTileNetworkPool

/** Keeps the existing Java system bridge and React UI; replaces only the map surface. */
class NativeReactActivity : MainActivity() {
    private var maps: NativeReactMapHost? = null
    private var overlay: NativeReactOverlay? = null
    private var content: WebView? = null
    private var mapSurfaceRoot: FrameLayout? = null

    override fun createContentRoot(): FrameLayout = object : FrameLayout(this) {
        override fun dispatchTouchEvent(event: MotionEvent): Boolean {
            val surface = mapSurfaceRoot
            if (surface != null) {
                val local = MotionEvent.obtain(event)
                local.offsetLocation(-surface.left.toFloat(), -surface.top.toFloat())
                val consumed = try { this@NativeReactActivity.overlay?.dispatchGesture(local) == true } finally { local.recycle() }
                if (consumed) return true
            }
            return super.dispatchTouchEvent(event)
        }
    }

    override fun onContentReady(root: FrameLayout, content: WebView) {
        this.content = content
        // Isolated probe only; production package and existing Android host are unaffected.
        if (packageName == "com.shantu.hybridprobe" && applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0) {
            WebView.setWebContentsDebuggingEnabled(true)
        }
        val app = applicationContext
        NativeTileNetworkPool.installOfflineReader { url -> HybridOfflineTiles.lookup(app, url) }
        NativeTileNetworkPool.installOfflinePackageMembership { id, url -> HybridOfflineTiles.containsPackageUrl(app, id, url) }
        val mapRoot = FrameLayout(this).apply { setBackgroundColor(Color.TRANSPARENT) }
        mapSurfaceRoot = mapRoot
        root.addView(mapRoot, 0, FrameLayout.LayoutParams(-1, -1))
        overlay = NativeReactOverlay.create(content, mapRoot,
            NativeReactTouchRouter.MapTargetLookup { id -> maps?.mapTarget(id) })
        maps = NativeReactMapHost(this, mapRoot, { json ->
            runOnUiThread {
                if (trustedForeground()) content.evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('shantu:native-map',{detail:$json}))", null)
            }
        }, { trustedForeground() }, { command, payload ->
            when (command) {
                "uiRegions" -> { overlay?.handleUiRegions(payload); true }
                "viewport" -> { overlay?.updateMapViewports(payload); true }
                else -> false
            }
        })
        content.addJavascriptInterface(object {
            @JavascriptInterface fun inspectUiRegions(): String =
                if (packageName == "com.shantu.hybridprobe") {
                    val regions = overlay?.inspectRegions() ?: org.json.JSONObject()
                    regions.put("mapDiagnostics", maps?.inspectMapDiagnostics() ?: org.json.JSONObject())
                    regions.toString()
                } else "{}"
            @JavascriptInterface fun postMessage(json: String) {
                // NativeReactMapHost validates origin/foreground, session and version
                // again on the UI thread before processing or forwarding a command.
                maps?.handleMessage(json)
            }
        }, "ShantuNativeMap")
    }

    override fun onContentPageStarted(url: String?) { maps?.invalidateSession() }
    override fun onContentInsets(keyboardVisible: Boolean) { overlay?.setImeVisible(keyboardVisible) }
    override fun onResume() {
        super.onResume()
        maps?.onHostResume()
        // A permission/system sheet can reject region updates while backgrounded.
        // Re-publish current DOM geometry even when the layout did not change.
        if (trustedForeground()) content?.evaluateJavascript(
            "window.dispatchEvent(new Event('shantu:native-map-resume'))", null)
    }
    override fun onPause() { maps?.onHostPause(); super.onPause() }
    override fun onDestroy() {
        maps?.close(); maps = null
        overlay?.close(); overlay = null
        mapSurfaceRoot = null
        content?.removeJavascriptInterface("ShantuNativeMap"); content = null
        super.onDestroy()
    }
}
