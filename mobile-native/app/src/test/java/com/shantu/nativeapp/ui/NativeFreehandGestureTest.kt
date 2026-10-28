package com.shantu.nativeapp.ui

import android.view.MotionEvent
import com.shantu.nativeapp.navigation.NativeCoordinate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NativeFreehandGestureTest {
    private inline fun <T> MotionEvent.use(block: (MotionEvent) -> T): T = try { block(this) } finally { recycle() }

    private fun event(action: Int, time: Long, x: Float, y: Float = 0f) =
        MotionEvent.obtain(0L, time, action, x, y, 0)

    @Test fun oneSinglePointerStrokeCommitsExactlyOnceWithProjectedCoordinates() {
        val committed = mutableListOf<List<NativeCoordinate>>()
        val gesture = gesture(project = { x, y -> NativeCoordinate(x.toDouble(), y.toDouble()) }, commit = committed::add)
        event(MotionEvent.ACTION_DOWN, 1, 0f).use { assertTrue(gesture.onTouch(it)) }
        event(MotionEvent.ACTION_MOVE, 2, 8f, 2f).use { assertTrue(gesture.onTouch(it)) }
        event(MotionEvent.ACTION_UP, 3, 12f, 3f).use { assertTrue(gesture.onTouch(it)) }
        assertEquals(1, committed.size)
        assertEquals(listOf(NativeCoordinate(0.0, 0.0), NativeCoordinate(8.0, 2.0), NativeCoordinate(12.0, 3.0)), committed.single())
    }

    @Test fun disabledGestureDoesNotInterceptMapInput() {
        var enabled = false
        var commits = 0
        val gesture = gesture(enabled = { enabled }, commit = { commits++ })
        event(MotionEvent.ACTION_DOWN, 1, 0f).use { assertFalse(gesture.onTouch(it)) }
        event(MotionEvent.ACTION_MOVE, 2, 10f).use { assertFalse(gesture.onTouch(it)) }
        event(MotionEvent.ACTION_UP, 3, 20f).use { assertFalse(gesture.onTouch(it)) }
        assertEquals(0, commits)
    }

    @Test fun pointerDownAndCancelDiscardWholeStroke() {
        for (cancelAction in listOf(MotionEvent.ACTION_POINTER_DOWN, MotionEvent.ACTION_CANCEL)) {
            val commits = mutableListOf<List<NativeCoordinate>>()
            val gesture = gesture(commit = commits::add)
            event(MotionEvent.ACTION_DOWN, 1, 0f).use { gesture.onTouch(it) }
            event(MotionEvent.ACTION_MOVE, 2, 8f).use { gesture.onTouch(it) }
            val cancel = if (cancelAction == MotionEvent.ACTION_POINTER_DOWN)
                MotionEvent.obtain(
                    0L,
                    3L,
                    MotionEvent.ACTION_POINTER_DOWN or (1 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT),
                    2,
                    arrayOf(
                        MotionEvent.PointerProperties().apply { id = 0; toolType = MotionEvent.TOOL_TYPE_FINGER },
                        MotionEvent.PointerProperties().apply { id = 1; toolType = MotionEvent.TOOL_TYPE_FINGER },
                    ),
                    arrayOf(
                        MotionEvent.PointerCoords().apply { x = 8f; y = 0f; pressure = 1f; size = 1f },
                        MotionEvent.PointerCoords().apply { x = 20f; y = 0f; pressure = 1f; size = 1f },
                    ),
                    0,
                    0,
                    1f,
                    1f,
                    0,
                    0,
                    0,
                    0,
                )
            else event(MotionEvent.ACTION_CANCEL, 3, 8f)
            cancel.use { gesture.onTouch(it) }
            event(MotionEvent.ACTION_UP, 4, 16f).use { gesture.onTouch(it) }
            assertTrue(commits.isEmpty())
        }
    }

    @Test fun invalidProjectionAndPauseMidStrokeDiscardWholeStroke() {
        val commits = mutableListOf<List<NativeCoordinate>>()
        var enabled = true
        var invalidX: Float? = null
        val gesture = gesture(
            enabled = { enabled },
            project = { x, y -> if (x == invalidX) null else NativeCoordinate(x.toDouble(), y.toDouble()) },
            commit = commits::add,
        )
        event(MotionEvent.ACTION_DOWN, 1, 0f).use { gesture.onTouch(it) }
        event(MotionEvent.ACTION_MOVE, 2, 8f).use { gesture.onTouch(it) }
        invalidX = 12f
        event(MotionEvent.ACTION_MOVE, 3, 12f).use { gesture.onTouch(it) }
        event(MotionEvent.ACTION_UP, 4, 20f).use { gesture.onTouch(it) }
        assertTrue(commits.isEmpty())

        invalidX = null
        event(MotionEvent.ACTION_DOWN, 5, 0f).use { gesture.onTouch(it) }
        event(MotionEvent.ACTION_MOVE, 6, 8f).use { gesture.onTouch(it) }
        enabled = false
        event(MotionEvent.ACTION_UP, 7, 16f).use { gesture.onTouch(it) }
        assertTrue(commits.isEmpty())
    }

    @Test fun historicalSamplesAreFilteredBySpacingAndNextGestureStartsClean() {
        val commits = mutableListOf<List<NativeCoordinate>>()
        val gesture = gesture(spacing = 4f, project = { x, _ -> NativeCoordinate(x.toDouble(), 0.0) }, commit = commits::add)
        event(MotionEvent.ACTION_DOWN, 1, 0f).use { gesture.onTouch(it) }
        // Build a batched move chronologically: the initial coordinate becomes the
        // first historical sample when later batches are appended.
        val move = event(MotionEvent.ACTION_MOVE, 2, 1f)
        move.addBatch(3, 5f, 0f, 1f, 1f, 0)
        move.addBatch(4, 9f, 0f, 1f, 1f, 0)
        move.addBatch(5, 12f, 0f, 1f, 1f, 0)
        move.use { gesture.onTouch(it) }
        event(MotionEvent.ACTION_UP, 6, 12f).use { gesture.onTouch(it) }
        assertEquals(1, commits.size)
        assertEquals(listOf(0.0, 5.0, 9.0, 12.0), commits.single().map { it.longitude })

        event(MotionEvent.ACTION_DOWN, 7, 20f).use { gesture.onTouch(it) }
        event(MotionEvent.ACTION_UP, 8, 20f).use { gesture.onTouch(it) }
        assertEquals("A short tap is not committed", 1, commits.size)

        event(MotionEvent.ACTION_DOWN, 9, 30f).use { gesture.onTouch(it) }
        event(MotionEvent.ACTION_UP, 10, 40f).use { gesture.onTouch(it) }
        assertEquals(2, commits.size)
        assertEquals(listOf(30.0, 40.0), commits.last().map { it.longitude })
    }

    private fun gesture(
        spacing: Float = 4f,
        enabled: () -> Boolean = { true },
        project: (Float, Float) -> NativeCoordinate? = { x, y -> NativeCoordinate(x.toDouble(), y.toDouble()) },
        commit: (List<NativeCoordinate>) -> Unit,
    ) = NativeFreehandGesture(spacing, enabled, project, commit)
}
