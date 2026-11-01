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
    private data class Sample(val action: Int, val count: Int, val id: Int, val x: Float, val y: Float)
    private fun event(action: Int, vararg points: Pair<Float, Float>, time: Long = 20L): MotionEvent {
        val properties = Array(points.size) { i -> MotionEvent.PointerProperties().apply { id = i + 7; toolType = MotionEvent.TOOL_TYPE_FINGER } }
        val coordinates = Array(points.size) { i -> MotionEvent.PointerCoords().apply {
            x = points[i].first; y = points[i].second; pressure = 1f; size = 1f
        } }
        return MotionEvent.obtain(10L, time, action, points.size, properties, coordinates,
            0, 0, 1f, 1f, 0, 0, android.view.InputDevice.SOURCE_TOUCHSCREEN, 0)
    }

    private fun record(event: MotionEvent) = Sample(
        event.actionMasked, event.pointerCount, event.getPointerId(0), event.getX(0), event.getY(0),
    )

    @Test fun drawingSingleFingerRemainsAnEditorStreamUntilSecondFingerHandsOff() {
        val router = NativeMapTouchNavigation()
        val sent = mutableListOf<Sample>()
        val down = event(MotionEvent.ACTION_DOWN, 30f to 60f)
        val pointerDown = event(MotionEvent.ACTION_POINTER_DOWN or (1 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT),
            30f to 60f, 80f to 60f)
        try {
            assertTrue(router.capture(down, true) { sent += record(it) })
            assertFalse(router.capture(pointerDown, true) { sent += record(it) })
            assertEquals(listOf(MotionEvent.ACTION_CANCEL, MotionEvent.ACTION_DOWN), sent.map { it.action })
            assertEquals(2, sent[0].count)
            assertEquals(1, sent[1].count)
            assertTrue(router.isNavigating)
        } finally { down.recycle(); pointerDown.recycle() }
    }

    @Test fun sameDirectionTwoFingerDragBecomesSmoothSinglePointerCameraPanAndDoesNotResumeDrawingOnResidualFinger() {
        val router = NativeMapTouchNavigation()
        val sent = mutableListOf<Sample>()
        fun route(action: Int, vararg points: Pair<Float, Float>, time: Long = 20L): Boolean {
            val motion = event(action, *points, time = time)
            return try { router.capture(motion, true) { sent += record(it) } } finally { motion.recycle() }
        }
        assertTrue(route(MotionEvent.ACTION_DOWN, 30f to 60f))
        assertFalse(route(MotionEvent.ACTION_POINTER_DOWN or (1 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT),
            30f to 60f, 80f to 60f, time = 21L))

        // Same-direction vertical translation must be pan in drawing mode, not the SDK tilt gesture.
        assertTrue(route(MotionEvent.ACTION_MOVE, 35f to 70f, 85f to 70f, time = 30L))
        assertEquals(listOf(MotionEvent.ACTION_CANCEL, MotionEvent.ACTION_DOWN,
            MotionEvent.ACTION_CANCEL, MotionEvent.ACTION_DOWN, MotionEvent.ACTION_MOVE), sent.map { it.action })
        assertEquals(1, sent.last().count)
        assertEquals(60f, sent.last().x, 0.01f)
        assertEquals(70f, sent.last().y, 0.01f)

        assertTrue(route(MotionEvent.ACTION_MOVE, 40f to 80f, 90f to 80f, time = 40L))
        assertEquals(MotionEvent.ACTION_MOVE, sent.last().action)
        assertEquals(80f, sent.last().y, 0.01f)

        assertTrue(route(MotionEvent.ACTION_POINTER_UP or (1 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT),
            40f to 80f, 90f to 80f, time = 41L))
        assertEquals(MotionEvent.ACTION_UP, sent.last().action)
        assertEquals(1, sent.last().count)
        assertFalse(route(MotionEvent.ACTION_MOVE, 40f to 87f, time = 50L))
        assertFalse(route(MotionEvent.ACTION_UP, 40f to 87f, time = 51L))
        assertTrue(route(MotionEvent.ACTION_DOWN, 40f to 87f, time = 60L))
    }

    @Test fun pinchRemainsNativeAndCanSwitchToPanAndBackWithoutReusingOldCameraAnchors() {
        val router = NativeMapTouchNavigation()
        val sent = mutableListOf<Sample>()
        fun route(action: Int, vararg points: Pair<Float, Float>, time: Long = 20L): Boolean {
            val motion = event(action, *points, time = time)
            return try { router.capture(motion, true) { sent += record(it) } } finally { motion.recycle() }
        }
        assertTrue(route(MotionEvent.ACTION_DOWN, 30f to 60f))
        assertFalse(route(MotionEvent.ACTION_POINTER_DOWN or (1 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT),
            30f to 60f, 80f to 60f, time = 21L))
        val initialDispatchCount = sent.size

        // Opposing radial movement stays on the SDK two-finger stream for pinch zoom.
        assertFalse(route(MotionEvent.ACTION_MOVE, 25f to 60f, 85f to 60f, time = 30L))
        assertEquals(initialDispatchCount, sent.size)

        // Translation after the pinch cancels that stream and seeds the pan at its current centroid.
        assertTrue(route(MotionEvent.ACTION_MOVE, 25f to 68f, 85f to 68f, time = 40L))
        assertEquals(listOf(MotionEvent.ACTION_CANCEL, MotionEvent.ACTION_DOWN, MotionEvent.ACTION_MOVE),
            sent.takeLast(3).map { it.action })
        assertEquals(55f, sent[sent.size - 2].x, 0.01f)
        assertEquals(60f, sent[sent.size - 2].y, 0.01f)
        assertEquals(68f, sent.last().y, 0.01f)

        // A real distance change starts fresh native recognizers at the current pair coordinates.
        assertFalse(route(MotionEvent.ACTION_MOVE, 20f to 68f, 90f to 68f, time = 50L))
        assertEquals(listOf(MotionEvent.ACTION_CANCEL, MotionEvent.ACTION_DOWN, MotionEvent.ACTION_POINTER_DOWN),
            sent.takeLast(3).map { it.action })
        assertFalse(route(MotionEvent.ACTION_MOVE, 15f to 68f, 95f to 68f, time = 60L))
    }

    @Test fun slowTranslationAndPinchAccumulateFromGestureAnchorsAndRecoverAfterResidualUp() {
        val router = NativeMapTouchNavigation()
        val sent = mutableListOf<Sample>()
        fun route(action: Int, vararg points: Pair<Float, Float>, time: Long = 20L): Boolean {
            val motion = event(action, *points, time = time)
            return try { router.capture(motion, true) { sent += record(it) } } finally { motion.recycle() }
        }

        assertTrue(route(MotionEvent.ACTION_DOWN, 30f to 60f))
        assertFalse(route(MotionEvent.ACTION_POINTER_DOWN or (1 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT),
            30f to 60f, 80f to 60f, time = 21L))

        // Each step is below the 2px parallel-step threshold; cumulative translation still starts pan.
        assertFalse(route(MotionEvent.ACTION_MOVE, 30.75f to 61f, 80.75f to 61f, time = 30L))
        assertTrue(route(MotionEvent.ACTION_MOVE, 31.5f to 62f, 81.5f to 62f, time = 40L))
        assertEquals(listOf(MotionEvent.ACTION_CANCEL, MotionEvent.ACTION_DOWN, MotionEvent.ACTION_MOVE),
            sent.takeLast(3).map { it.action })

        // Two sub-threshold radial steps accumulate against pan start, then hand off to native pinch.
        assertTrue(route(MotionEvent.ACTION_MOVE, 29.5f to 62f, 83.5f to 62f, time = 50L))
        assertFalse(route(MotionEvent.ACTION_MOVE, 27.5f to 62f, 85.5f to 62f, time = 60L))
        assertEquals(listOf(MotionEvent.ACTION_CANCEL, MotionEvent.ACTION_DOWN, MotionEvent.ACTION_POINTER_DOWN),
            sent.takeLast(3).map { it.action })

        // Classification restarts at the new pinch pair so slow same-direction motion can become pan.
        assertFalse(route(MotionEvent.ACTION_MOVE, 27.5f to 63.25f, 85.5f to 63.25f, time = 70L))
        assertTrue(route(MotionEvent.ACTION_MOVE, 27.5f to 64.5f, 85.5f to 64.5f, time = 80L))
        assertEquals(MotionEvent.ACTION_MOVE, sent.last().action)

        assertTrue(route(MotionEvent.ACTION_POINTER_UP or (1 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT),
            27.5f to 64.5f, 85.5f to 64.5f, time = 81L))
        assertEquals(MotionEvent.ACTION_UP, sent.last().action)
        assertFalse(route(MotionEvent.ACTION_MOVE, 27.5f to 70f, time = 90L))

        // A new physical DOWN clears the residual navigation guard and starts a fresh editor stream.
        assertTrue(route(MotionEvent.ACTION_DOWN, 27.5f to 70f, time = 100L))
        assertFalse(route(MotionEvent.ACTION_POINTER_DOWN or (1 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT),
            27.5f to 70f, 77.5f to 70f, time = 101L))
        assertTrue(route(MotionEvent.ACTION_MOVE, 32.5f to 74f, 82.5f to 74f, time = 110L))
        assertEquals(MotionEvent.ACTION_MOVE, sent.last().action)
    }

    @Test fun browseModeLeavesTheWorldWindGestureStreamUntouched() {
        val router = NativeMapTouchNavigation()
        val sent = mutableListOf<Sample>()
        fun route(action: Int, vararg points: Pair<Float, Float>, time: Long = 20L): Boolean {
            val motion = event(action, *points, time = time)
            return try { router.capture(motion, false) { sent += record(it) } } finally { motion.recycle() }
        }
        assertFalse(route(MotionEvent.ACTION_DOWN, 30f to 60f))
        assertFalse(route(MotionEvent.ACTION_POINTER_DOWN or (1 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT),
            30f to 60f, 80f to 60f, time = 21L))
        assertFalse(route(MotionEvent.ACTION_MOVE, 40f to 75f, 90f to 75f, time = 30L))
        assertTrue(sent.isEmpty())
        assertTrue(router.isNavigating)
    }
}
