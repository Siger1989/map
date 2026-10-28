package com.shantu.nativeapp.ui

import android.app.Activity
import android.view.View
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(org.robolectric.RobolectricTestRunner::class)
@Config(sdk = [35])
class HomeChromeLayoutTest {
    @Test fun `section and drawing fixed slots remain visible and body scrolls across phone viewports`() {
        val viewports = listOf(390 to 857, 360 to 780, 390 to 480)
        val panels = listOf(
            "native-section" to 480,
            "native-section-profile" to 480,
            "draw" to 200,
            "source-editor" to 480,
            "industry" to 820,
            "native-photos" to 330,
            "native-cad" to 200,
            "native-section-edit" to 200,
        )
        for ((widthDp, heightDp) in viewports) for ((panelId, override) in panels) {
            val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
            val chrome = HomeChrome(RuntimeEnvironment.getApplication()) { }
            activity.setContentView(chrome)
            chrome.showPanelWithSlots(
                id = panelId,
                title = panelId,
                topAligned = true,
                width = 320,
                maxHeightDp = override,
                fixedHeader = {
                    addView(TextView(context).apply {
                        text = "固定标题"
                        includeFontPadding = false
                    }, LinearLayout.LayoutParams(-1, chrome.dp(36)))
                },
                fixedFooter = {
                    addView(chrome.textButton("固定操作", 12) { }, LinearLayout.LayoutParams(-1, chrome.dp(32)))
                },
                content = {
                    repeat(36) { index ->
                        addView(TextView(context).apply {
                            text = "可滚动内容 $index"
                            includeFontPadding = false
                        }, LinearLayout.LayoutParams(-1, chrome.dp(28)))
                    }
                },
            )

            layoutAt(activity, chrome, widthDp, heightDp)
            val initial = assertPanelLayout(chrome, widthDp, heightDp, panelId, override)
            val compressedHeight = (heightDp - 120).coerceAtLeast(360)
            layoutAt(activity, chrome, widthDp, compressedHeight)
            assertPanelLayout(chrome, widthDp, compressedHeight, panelId, override)
            layoutAt(activity, chrome, widthDp, heightDp)
            val restored = assertPanelLayout(chrome, widthDp, heightDp, panelId, override)
            assertEquals("same viewport should produce stable capped layout: $panelId $widthDp×$heightDp", initial, restored)
            // Repeated same-size layout used to flip a cap-height card back to WRAP_CONTENT.
            repeat(3) {
                layoutAt(activity, chrome, widthDp + 1, heightDp)
                layoutAt(activity, chrome, widthDp, heightDp)
                assertEquals(initial, assertPanelLayout(chrome, widthDp, heightDp, panelId, override))
            }
            activity.finish()
        }
    }

    @Test fun `zero available panel height remains capped instead of expanding to wrap content`() {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        val chrome = HomeChrome(RuntimeEnvironment.getApplication()) { }
        activity.setContentView(chrome)
        chrome.showPanel("route", "受限面板", topAligned = true) {
            repeat(12) { addView(chrome.row("内容 $it") { }) }
        }
        layoutAt(activity, chrome, 390, 120) // 56dp top inset + 64dp footer inset leaves exactly zero.
        val card = chrome.getChildAt(chrome.childCount - 1) as LinearLayout
        assertEquals(0, HomeChromeMetrics.panelFrame("route", 300, 390, 120, true).maxHeightDp)
        assertEquals(0, card.layoutParams.height)
        assertEquals(0, card.height)
        repeat(3) {
            layoutAt(activity, chrome, 390, 120)
            assertEquals(0, card.layoutParams.height)
            assertEquals(0, card.height)
        }
        layoutAt(activity, chrome, 390, 857)
        assertEquals(chrome.dp(200), card.layoutParams.height)
        assertEquals(chrome.dp(200), card.height)
        layoutAt(activity, chrome, 390, 120)
        assertEquals(0, card.layoutParams.height)
        assertEquals(0, card.height)
        activity.finish()
    }

    private data class LayoutSnapshot(val cardHeight: Int, val scrollHeight: Int, val footerTop: Int, val scrollRange: Int)

    private fun assertPanelLayout(
        chrome: HomeChrome,
        widthDp: Int,
        heightDp: Int,
        panelId: String,
        overrideDp: Int,
    ): LayoutSnapshot {
        val card = chrome.getChildAt(chrome.childCount - 1) as LinearLayout
        val header = card.getChildAt(0)
        val scroll = card.getChildAt(1) as ScrollView
        val footer = card.getChildAt(2)
        val frame = HomeChromeMetrics.panelFrame(panelId, 320, widthDp, heightDp, topAligned = true)
        val capPx = chrome.dp(minOf(overrideDp, frame.maxHeightDp))
        assertEquals("overflowing $panelId should use its resolved content cap", capPx, card.height)
        assertTrue("card must stay within its top inset", card.top >= chrome.dp(frame.topMarginDp))
        assertTrue("card must stay above the footer safety margin", card.bottom <= chrome.dp(heightDp - frame.bottomMarginDp))
        assertTrue("header must remain inside the card", header.top >= card.paddingTop && header.bottom <= scroll.top)
        assertTrue("footer must remain inside the card", footer.top >= scroll.bottom && footer.bottom <= card.height - card.paddingBottom)
        assertTrue("scroll viewport must remain usable", scroll.height > 0)
        val bodyHeight = scroll.getChildAt(0).height
        assertTrue("body should overflow and be scrollable", bodyHeight > scroll.height)
        val headerTop = header.top
        val footerTop = footer.top
        scroll.scrollTo(0, bodyHeight)
        assertTrue("scroll content should advance", scroll.scrollY > 0)
        assertEquals("fixed header should not move while body scrolls", headerTop, header.top)
        assertEquals("fixed footer should not move while body scrolls", footerTop, footer.top)
        assertTrue("footer should not be clipped at viewport ${widthDp}x${heightDp}", footer.bottom <= card.height - card.paddingBottom)
        return LayoutSnapshot(card.height, scroll.height, footer.top, bodyHeight - scroll.height)
    }

    private fun layoutAt(activity: Activity, chrome: HomeChrome, widthDp: Int, heightDp: Int) {
        val density = chrome.resources.displayMetrics.density
        val width = (widthDp * density + .5f).toInt()
        val height = (heightDp * density + .5f).toInt()
        // Drive the attached window to the same viewport as the explicit view measure. Otherwise
        // Robolectric's default Activity window (typically 480dp tall) posts a later size callback
        // and silently replaces the requested test geometry with its own frame.
        activity.window.setLayout(width, height)
        shadowOf(android.os.Looper.getMainLooper()).idle()
        chrome.measure(
            View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY),
        )
        chrome.layout(0, 0, width, height)
        shadowOf(android.os.Looper.getMainLooper()).idle()
        // Re-measure after window callbacks have run so assertions inspect the final attached
        // layout, not just the transient manual measurement.
        chrome.measure(
            View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY),
        )
        chrome.layout(0, 0, width, height)
        shadowOf(android.os.Looper.getMainLooper()).idle()
    }
}
