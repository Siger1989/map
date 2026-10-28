package com.shantu.nativeapp.ui

import com.shantu.nativeapp.navigation.NativeCoordinate
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import android.widget.TextView
import android.view.View
import android.view.ViewGroup
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NativeDrawingPanelTest {
    private fun findText(root: View, text: String): TextView? {
        if (root is TextView && root.text.toString() == text) return root
        if (root is ViewGroup) for (index in 0 until root.childCount) {
            findText(root.getChildAt(index), text)?.let { return it }
        }
        return null
    }

    @Test fun damagedDraftBlocksReplacementAndHostDraftClearing() {
        val app = RuntimeEnvironment.getApplication()
        var draftCallbackCount = 0
        var latestDraft: JSONObject? = null
        var discardCallbackCount = 0
        val originalRaw = JSONObject().put("format", "unsupported-drawing-format").put("payload", "keep-me")
        val chrome = HomeChrome(app) {}
        val panel = NativeDrawingPanel(
            app,
            chrome,
            initialDraft = originalRaw,
            callbacks = NativeDrawingCallbacks(
                onDraftChanged = { draftCallbackCount++; latestDraft = it },
                onDiscardDamagedDraft = { discardCallbackCount++ },
            ),
        )
        panel.startNew("replacement")
        panel.continueFrom(JSONObject().put("id", "other"))
        assertNull(findText(chrome, "地图点选"))
        assertNull(findText(chrome, "保存"))
        panel.dispose()
        assertEquals(0, draftCallbackCount)
        assertEquals(0, discardCallbackCount)
        assertNull(latestDraft)
        assertEquals("keep-me", originalRaw.getString("payload"))
    }

    @Test fun insertionMidpointUsesShortestDateLineArcLikeOriginalPathGeometry() {
        val midpoint = drawingPathMidpoint(NativeCoordinate(179.0, 10.0), NativeCoordinate(-179.0, 14.0))
        assertEquals(-180.0, midpoint.longitude, 1e-8)
        assertEquals(12.0, midpoint.latitude, 1e-8)
    }

    @Test fun freehandAcceptanceRequiresExplicitModeAndActiveDrawing() {
        val app = RuntimeEnvironment.getApplication()
        val chrome = HomeChrome(app) {}
        val panel = NativeDrawingPanel(app, chrome)
        panel.startNew()
        assertFalse(panel.acceptsFreehand)
        findText(chrome, "自由手绘")!!.performClick()
        assertTrue(panel.acceptsFreehand)
        findText(chrome, "道路")!!.performClick()
        assertFalse(panel.acceptsFreehand)
        findText(chrome, "自由")!!.performClick()
        assertTrue(panel.acceptsFreehand)
        panel.pause()
        assertFalse(panel.acceptsFreehand)
        assertFalse(panel.onFreehandStroke(listOf(NativeCoordinate(100.0, 30.0), NativeCoordinate(101.0, 31.0))))
        panel.dispose()
    }

    @Test fun fixedHeaderMeasuresBackTitleAndCloseOnOneRow() {
        val app = RuntimeEnvironment.getApplication()
        val chrome = HomeChrome(app) {}
        val panel = NativeDrawingPanel(app, chrome)
        panel.startNew()
        val density = app.resources.displayMetrics.density
        val width = (400 * density).toInt()
        val height = (800 * density).toInt()
        chrome.measure(
            View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY),
        )
        chrome.layout(0, 0, width, height)
        val back = findText(chrome, "‹ 返回")!!
        val title = findText(chrome, "画线")!!
        val close = findText(chrome, "×")!!
        val backPosition = IntArray(2).also(back::getLocationInWindow)
        val titlePosition = IntArray(2).also(title::getLocationInWindow)
        val closePosition = IntArray(2).also(close::getLocationInWindow)
        assertEquals(backPosition[1], titlePosition[1])
        assertEquals(backPosition[1], closePosition[1])
        assertTrue(title.width > 0)
        panel.dispose()
    }

    @Test fun unreadableJsonPlaceholderRequiresButtonClickBeforeClearingAndThenCreatesDraft() {
        val app = RuntimeEnvironment.getApplication()
        val chrome = HomeChrome(app) {}
        val raw = "{broken-json"
        val placeholder = JSONObject().put("format", "unreadable-json").put("rawDraft", raw)
        var discardCount = 0
        var discarded: JSONObject? = null
        val changed = mutableListOf<JSONObject?>()
        val panel = NativeDrawingPanel(
            app,
            chrome,
            initialDraft = placeholder,
            callbacks = NativeDrawingCallbacks(
                onDraftChanged = { changed += it },
                onDiscardDamagedDraft = { discardCount++; discarded = it },
            ),
        )

        panel.startNew()
        panel.continueFrom(JSONObject().put("id", "replacement"))
        assertEquals(0, discardCount)
        assertTrue(changed.isEmpty())

        val discardButton = findText(chrome, "丢弃损坏草稿并新建")!!
        assertNotNull(discardButton)
        discardButton.performClick()
        discardButton.performClick() // A stale button reference must not discard twice.
        assertEquals(1, discardCount)
        assertEquals(raw, discarded?.getString("rawDraft"))
        assertTrue(changed.any { it == null })
        assertTrue(changed.last()?.optString("format") == "shantu-native-drawing-draft")
        panel.dispose()
    }
}
