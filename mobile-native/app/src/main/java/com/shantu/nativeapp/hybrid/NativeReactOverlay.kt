package com.shantu.nativeapp.hybrid

import android.graphics.Color
import android.view.MotionEvent
import android.view.ViewGroup
import android.webkit.WebView
import org.json.JSONObject

/**
 * Small host-side adapter for the original React UI over a native map. Root owns
 * the WebView bridge and forwards decoded notification payloads to this object.
 */
class NativeReactOverlay private constructor(
    webView: WebView,
    mapRoot: ViewGroup,
    targetLookup: NativeReactTouchRouter.MapTargetLookup,
) : AutoCloseable {
    @Volatile private var router: NativeReactTouchRouter? = NativeReactTouchRouter(webView, mapRoot, targetLookup)

    init {
        // Transparency is confined to this WebView instance; browser builds are untouched.
        webView.setBackgroundColor(Color.TRANSPARENT)
    }

    /** Called by Root for the payload of a `uiRegions` bridge notification. */
    fun handleUiRegions(payload: JSONObject) {
        router?.handleUiRegions(payload)
    }

    /** Called by Root for the payload of a `viewport` bridge notification. */
    fun updateMapViewports(payload: JSONObject) {
        router?.updateMapViewports(payload)
    }

    /**
     * Call for each event from a content-root FrameLayout's dispatchTouchEvent override:
     * `if (overlay.dispatchGesture(event)) return true; return super.dispatchTouchEvent(event)`.
     * A false result leaves the event with normal ViewGroup hit-testing (and WebView); this
     * method never dispatches UI-owned input itself, so the host must not forward it twice.
     */
    fun dispatchGesture(event: MotionEvent): Boolean = router?.route(event) ?: false

    /** Forward WindowInsets IME visibility without making it part of the WebView bridge. */
    fun setImeVisible(visible: Boolean) {
        router?.setImeVisible(visible)
    }

    fun inspectRegions(): JSONObject? = router?.inspectRegions()

    override fun close() {
        router = null
    }

    companion object {
        /** Java-callable factory. Root remains responsible for adding the WebView above mapRoot. */
        @JvmStatic
        fun create(
            webView: WebView,
            mapRoot: ViewGroup,
            targetLookup: NativeReactTouchRouter.MapTargetLookup,
        ): NativeReactOverlay = NativeReactOverlay(webView, mapRoot, targetLookup)
    }
}
