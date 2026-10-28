package com.shantu.nativeapp.hybrid

import android.view.MotionEvent
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NativeMapTouchNavigationTest {
    private fun event(action: Int, count: Int = 1): MotionEvent = MotionEvent.obtain(10, 20, action,
        count, Array(count) { i -> MotionEvent.PointerProperties().apply { id = i + 7; toolType = MotionEvent.TOOL_TYPE_FINGER } },
        Array(count) { i -> MotionEvent.PointerCoords().apply { x = 30f + i * 50; y = 60f; pressure = 1f; size = 1f } },
        0, 0, 1f, 1f, 0, 0, android.view.InputDevice.SOURCE_TOUCHSCREEN, 0)

    @Test fun editorHandsOffCompleteCameraStreamAndDoesNotRecaptureLastFinger() {
        val router = NativeMapTouchNavigation()
        val primed = mutableListOf<Pair<Int, Int>>()
        fun route(action: Int, count: Int = 1): Boolean {
            val e = event(action, count)
            return try { router.capture(e, true) { primed += it.actionMasked to it.getPointerId(0) } } finally { e.recycle() }
        }
        assertTrue(route(MotionEvent.ACTION_DOWN))
        assertFalse(route(MotionEvent.ACTION_POINTER_DOWN or (1 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT), 2))
        assertEquals(listOf(MotionEvent.ACTION_CANCEL to 7, MotionEvent.ACTION_DOWN to 7), primed)
        assertFalse(route(MotionEvent.ACTION_MOVE, 2))
        assertFalse(route(MotionEvent.ACTION_POINTER_UP or (1 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT), 2))
        assertFalse(route(MotionEvent.ACTION_MOVE))
        assertFalse(route(MotionEvent.ACTION_UP))
        assertTrue(route(MotionEvent.ACTION_DOWN))
    }

    @Test fun browseLeavesNativeDownAndPinchUntouched() {
        val router = NativeMapTouchNavigation()
        val down = event(MotionEvent.ACTION_DOWN)
        val second = event(MotionEvent.ACTION_POINTER_DOWN or (1 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT), 2)
        try {
            assertFalse(router.capture(down, false) { fail("Browse must use its real DOWN") })
            assertFalse(router.capture(second, false) { fail("Browse must not restart recognizers") })
        } finally { down.recycle(); second.recycle() }
    }
}
