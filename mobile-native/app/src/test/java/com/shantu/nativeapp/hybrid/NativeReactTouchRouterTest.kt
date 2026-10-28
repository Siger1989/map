package com.shantu.nativeapp.hybrid

import android.content.Context
import android.view.MotionEvent
import android.view.View
import android.webkit.WebView
import android.widget.FrameLayout
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NativeReactTouchRouterTest {
    private class RecordingTarget(context: Context) : View(context) {
        val actions = mutableListOf<Int>()
        val pointerCounts = mutableListOf<Int>()
        override fun dispatchTouchEvent(event: MotionEvent): Boolean {
            actions += event.actionMasked
            pointerCounts += event.pointerCount
            return true
        }
    }

    private fun routerFixture(): Triple<NativeReactTouchRouter, RecordingTarget, RecordingTarget> {
        val context = RuntimeEnvironment.getApplication()
        val host = FrameLayout(context).apply { layout(0, 0, 200, 100) }
        val web = WebView(context).apply { layout(0, 0, 200, 100) }
        val primary = RecordingTarget(context).apply { layout(0, 0, 100, 100) }
        val secondary = RecordingTarget(context).apply { layout(100, 0, 200, 100) }
        val router = NativeReactTouchRouter(web, host) { id -> if (id == "primary") primary else if (id == "secondary") secondary else null }
        router.handleUiRegions(JSONObject("""
            {"clientViewportWidth":100,"clientViewportHeight":50,"modalActive":false,
             "regions":[{"left":60,"top":0,"right":70,"bottom":30,"kind":"control"}],
             "viewports":[{"mapId":"primary","left":0,"top":0,"right":50,"bottom":50},
                          {"mapId":"secondary","left":50,"top":0,"right":100,"bottom":50}]}
        """))
        return Triple(router, primary, secondary)
    }

    private inline fun event(action: Int, x: Float, y: Float = 20f, block: (MotionEvent) -> Unit) {
        MotionEvent.obtain(0L, 1L, action, x, y, 0).let { try { block(it) } finally { it.recycle() } }
    }

    @Test fun mapStreamStaysOnItsOriginalMapAfterMovingAcrossUiAndIntoOtherViewport() {
        val (router, primary, secondary) = routerFixture()
        event(MotionEvent.ACTION_DOWN, 20f) { assertTrue(router.route(it)) } // CSS x=10, primary.
        event(MotionEvent.ACTION_MOVE, 130f) { assertTrue(router.route(it)) } // CSS x=65, UI control and secondary viewport.
        event(MotionEvent.ACTION_UP, 130f) { assertTrue(router.route(it)) }
        assertEquals(listOf(MotionEvent.ACTION_DOWN, MotionEvent.ACTION_MOVE, MotionEvent.ACTION_UP), primary.actions)
        assertTrue(secondary.actions.isEmpty())
        event(MotionEvent.ACTION_DOWN, 160f) { assertTrue(router.route(it)) }
        event(MotionEvent.ACTION_UP, 160f) { assertTrue(router.route(it)) }
        assertEquals(2, secondary.actions.size)
    }

    @Test fun uiStreamRemainsInWebViewWhenPointerMovesIntoMap() {
        val (router, primary, secondary) = routerFixture()
        event(MotionEvent.ACTION_DOWN, 130f) { assertFalse(router.route(it)) } // CSS x=65, control.
        event(MotionEvent.ACTION_MOVE, 20f) { assertFalse(router.route(it)) }
        event(MotionEvent.ACTION_UP, 20f) { assertFalse(router.route(it)) }
        assertTrue(primary.actions.isEmpty())
        assertTrue(secondary.actions.isEmpty())
    }

    @Test fun modalAndImeLockDownToUiAndCancelReleasesTheStream() {
        val (router, primary, secondary) = routerFixture()
        router.handleUiRegions(JSONObject("""
            {"clientViewportWidth":100,"clientViewportHeight":50,"modalActive":true,
             "regions":[],"viewports":[{"mapId":"primary","left":0,"top":0,"right":50,"bottom":50}]}
        """))
        event(MotionEvent.ACTION_DOWN, 20f) { assertFalse(router.route(it)) }
        event(MotionEvent.ACTION_CANCEL, 20f) { assertFalse(router.route(it)) }
        router.handleUiRegions(JSONObject("""
            {"clientViewportWidth":100,"clientViewportHeight":50,"modalActive":false,
             "regions":[],"viewports":[{"mapId":"primary","left":0,"top":0,"right":50,"bottom":50}]}
        """))
        router.setImeVisible(true)
        event(MotionEvent.ACTION_DOWN, 20f) { assertFalse(router.route(it)) }
        event(MotionEvent.ACTION_UP, 20f) { assertFalse(router.route(it)) }
        assertTrue(primary.actions.isEmpty())
        assertTrue(secondary.actions.isEmpty())
    }

    @Test fun nativeStreamPreservesPointerDownAndCancelEvents() {
        val (router, primary, _) = routerFixture()
        event(MotionEvent.ACTION_DOWN, 20f) { assertTrue(router.route(it)) }
        MotionEvent.obtain(
            0L, 2L, MotionEvent.ACTION_POINTER_DOWN or (1 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT), 2,
            arrayOf(
                MotionEvent.PointerProperties().apply { id = 0; toolType = MotionEvent.TOOL_TYPE_FINGER },
                MotionEvent.PointerProperties().apply { id = 1; toolType = MotionEvent.TOOL_TYPE_FINGER },
            ),
            arrayOf(
                MotionEvent.PointerCoords().apply { x = 20f; y = 20f; pressure = 1f; size = 1f },
                MotionEvent.PointerCoords().apply { x = 130f; y = 20f; pressure = 1f; size = 1f },
            ),
            0, 0, 1f, 1f, 0, 0, 0, 0,
        ).let { try { assertTrue(router.route(it)) } finally { it.recycle() } }
        event(MotionEvent.ACTION_CANCEL, 20f) { assertTrue(router.route(it)) }
        assertEquals(listOf(MotionEvent.ACTION_DOWN, MotionEvent.ACTION_POINTER_DOWN, MotionEvent.ACTION_CANCEL), primary.actions)
        assertEquals(2, primary.pointerCounts[1])
    }
}
