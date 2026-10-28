package com.shantu.nativeapp.hybrid

import android.view.MotionEvent
import android.view.View
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject
/** Routes one complete Android touch stream either to React/WebView or to a native map. */
class NativeReactTouchRouter(
    private val webView: WebView,
    /** Coordinates passed to [route] and native map viewports share this local origin. */
    private val coordinateHost: View,
    private val targetLookup: MapTargetLookup,
) {
    fun interface MapTargetLookup {
        fun lookup(mapId: String): View?
    }

    private data class Rect(val left: Float, val top: Float, val right: Float, val bottom: Float) {
        fun contains(x: Float, y: Float) = x >= left && x < right && y >= top && y < bottom
    }
    private data class Region(val rect: Rect, val kind: String)
    private data class Viewport(val mapId: String, val rect: Rect)
    private enum class Owner { UI, MAP }

    private var regions = emptyList<Region>()
    private var viewports = emptyList<Viewport>()
    private var cssWidth = 0f
    private var cssHeight = 0f
    private var modalActive = false
    private var imeVisible = false
    private var streamOwner: Owner? = null
    private var activeMapId: String? = null

    /** Receives the payload body from the host's `uiRegions` notification. */
    @Synchronized
    fun handleUiRegions(payload: JSONObject) {
        cssWidth = payload.optDouble("clientViewportWidth", 0.0).toFloat()
        cssHeight = payload.optDouble("clientViewportHeight", 0.0).toFloat()
        modalActive = payload.optBoolean("modalActive", false)
        regions = parseRects(payload.optJSONArray("regions"), includeMapId = false).map { (_, rect, kind) -> Region(rect, kind) }
        payload.optJSONArray("viewports")?.let { parseViewports(it) }
    }

    /** Receives the payload body from the host's `viewport` notification. */
    @Synchronized
    fun updateMapViewports(payload: JSONObject) {
        val width = payload.optDouble("clientViewportWidth", 0.0).toFloat()
        val height = payload.optDouble("clientViewportHeight", 0.0).toFloat()
        if (width > 0f) cssWidth = width
        if (height > 0f) cssHeight = height
        parseViewports(payload.optJSONArray("viewports"))
    }

    /** The Activity may set this from WindowInsets; visible IME keeps touches in the WebView. */
    @Synchronized
    fun setImeVisible(visible: Boolean) {
        imeVisible = visible
    }

    /** Read-only geometry evidence for the isolated runtime probe. No page content or credentials. */
    @Synchronized
    fun inspectRegions(): JSONObject = JSONObject().put("cssWidth", cssWidth).put("cssHeight", cssHeight)
        .put("modalActive", modalActive).put("imeVisible", imeVisible)
        .put("regions", JSONArray().also { out -> regions.forEach { region -> out.put(JSONObject()
            .put("left", region.rect.left).put("top", region.rect.top).put("right", region.rect.right).put("bottom", region.rect.bottom).put("kind", region.kind)) } })
        .put("viewports", JSONArray().also { out -> viewports.forEach { viewport -> out.put(JSONObject()
            .put("mapId", viewport.mapId).put("left", viewport.rect.left).put("top", viewport.rect.top).put("right", viewport.rect.right).put("bottom", viewport.rect.bottom)) } })

    /**
     * Called before normal Activity/View dispatch, with coordinates in coordinateHost space.
     * Return true only for a stream captured by the native map. UI-owned streams continue
     * through ordinary Android dispatch to WebView, preserving React's pointer semantics.
     */
    @Synchronized
    fun route(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                streamOwner = null
                activeMapId = null
                val x = event.x
                val y = event.y
                val scaleX = coordinateScaleX()
                val scaleY = coordinateScaleY()
                val uiHit = modalActive || imeVisible || regions.any { it.rect.contains(x / scaleX, y / scaleY) }
                val viewport = if (uiHit) null else viewports.firstOrNull { it.rect.contains(x / scaleX, y / scaleY) }
                val target = viewport?.let { targetLookup.lookup(it.mapId) }
                if (viewport != null && target != null) {
                    streamOwner = Owner.MAP
                    activeMapId = viewport.mapId
                } else {
                    streamOwner = Owner.UI
                }
            }
        }

        val owner = streamOwner ?: return false
        if (owner == Owner.UI) {
            if (event.actionMasked == MotionEvent.ACTION_UP || event.actionMasked == MotionEvent.ACTION_CANCEL) clearStream()
            return false
        }

        val target = activeMapId?.let(targetLookup::lookup)
        if (target != null) dispatchToTarget(event, target)
        val terminal = event.actionMasked == MotionEvent.ACTION_UP || event.actionMasked == MotionEvent.ACTION_CANCEL
        if (terminal) clearStream()
        return true
    }

    private fun coordinateScaleX(): Float = (webView.width.takeIf { it > 0 } ?: coordinateHost.width).toFloat()
        .let { physical -> if (cssWidth > 0f && physical > 0f) physical / cssWidth else 1f }

    private fun coordinateScaleY(): Float = (webView.height.takeIf { it > 0 } ?: coordinateHost.height).toFloat()
        .let { physical -> if (cssHeight > 0f && physical > 0f) physical / cssHeight else 1f }

    private fun dispatchToTarget(event: MotionEvent, target: View) {
        val hostLocation = IntArray(2)
        val targetLocation = IntArray(2)
        coordinateHost.getLocationInWindow(hostLocation)
        target.getLocationInWindow(targetLocation)
        val routed = MotionEvent.obtain(event)
        routed.offsetLocation((hostLocation[0] - targetLocation[0]).toFloat(), (hostLocation[1] - targetLocation[1]).toFloat())
        try { target.dispatchTouchEvent(routed) } finally { routed.recycle() }
    }

    private fun clearStream() {
        streamOwner = null
        activeMapId = null
    }

    private fun parseViewports(array: JSONArray?) {
        viewports = parseRects(array, includeMapId = true).mapNotNull { (id, rect, _) ->
            id.takeIf(String::isNotBlank)?.let { Viewport(it, rect) }
        }
    }

    private fun parseRects(array: JSONArray?, includeMapId: Boolean): List<Triple<String, Rect, String>> {
        if (array == null) return emptyList()
        return buildList {
            for (i in 0 until array.length()) {
                val item = array.optJSONObject(i) ?: continue
                val left = item.optDouble("left", Double.NaN).toFloat()
                val top = item.optDouble("top", Double.NaN).toFloat()
                val right = item.optDouble("right", Double.NaN).toFloat()
                val bottom = item.optDouble("bottom", Double.NaN).toFloat()
                if (!left.isFinite() || !top.isFinite() || !right.isFinite() || !bottom.isFinite() || right <= left || bottom <= top) continue
                add(Triple(if (includeMapId) item.optString("mapId") else "", Rect(left, top, right, bottom), item.optString("kind")))
            }
        }
    }
}
