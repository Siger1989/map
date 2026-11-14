package com.shantu.nativeapp.hybrid

import android.webkit.WebView
import android.widget.FrameLayout
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NativeReactGlassOverlayTest {
    @Test fun glassIsBetweenNativeMapAndWebUiAndCannotOwnInput() {
        val context = RuntimeEnvironment.getApplication()
        val root = FrameLayout(context)
        val map = FrameLayout(context)
        val web = WebView(context)
        root.addView(map); root.addView(web)
        val overlay = NativeReactOverlay.create(web, map) { null }
        try {
            assertEquals(3, root.childCount)
            assertSame(map, root.getChildAt(0)); assertSame(web, root.getChildAt(2))
            val glass = root.getChildAt(1)
            assertTrue(glass is NativeReactGlassBackdrop)
            assertFalse(glass.isClickable); assertFalse(glass.isFocusable)
            assertNull(glass.background)
        } finally { overlay.close(); web.destroy() }
        assertEquals(2, root.childCount)
    }

    @Test fun missingEmptyOrInvalidGlassNeverStartsBackgroundCapture() {
        val context = RuntimeEnvironment.getApplication()
        val root = FrameLayout(context); val map = FrameLayout(context); val web = WebView(context)
        root.addView(map); root.addView(web)
        val overlay = NativeReactOverlay.create(web, map) { null }
        try {
            overlay.setForeground(true)
            overlay.handleUiRegions(JSONObject("""{"clientViewportWidth":390,"clientViewportHeight":857,"regions":[]} """))
            var stats = overlay.inspectRegions()!!.getJSONObject("glassBackdrop")
            assertEquals(0, stats.getInt("regionCount")); assertFalse(stats.getBoolean("pending"))
            overlay.handleUiRegions(JSONObject("""{"glassRegions":[{"left":0,"top":0,"right":10,"bottom":20,"blur":0}]}"""))
            assertEquals(0, overlay.inspectRegions()!!.getJSONObject("glassBackdrop").getInt("regionCount"))
            overlay.handleUiRegions(JSONObject("""{"glassRegions":[{"left":0,"top":0,"right":10,"bottom":20,"blur":10,"opacity":1}]}"""))
            assertEquals(1, overlay.inspectRegions()!!.getJSONObject("glassBackdrop").getInt("regionCount"))
            overlay.setForeground(false)
            stats = overlay.inspectRegions()!!.getJSONObject("glassBackdrop")
            assertFalse(stats.getBoolean("foreground")); assertFalse(stats.getBoolean("pending"))
            overlay.clearPage()
            assertEquals(0, overlay.inspectRegions()!!.getJSONObject("glassBackdrop").getInt("regionCount"))
        } finally { overlay.close(); web.destroy() }
    }
}
