package com.shantu.nativeapp.hybrid

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeDrawingInputCoalescerTest {
    private class FakeFrameScheduler : NativeDrawingFrameScheduler {
        private val queued = mutableListOf<Runnable>()
        override fun postFrame(task: Runnable) { queued += task }
        override fun cancelFrame(task: Runnable) { queued.remove(task) }
        fun runNext() { queued.removeAt(0).run() }
        fun hasPending() = queued.isNotEmpty()
    }

    @Test fun onlyLatestMoveIsDeliveredOnFrame() {
        val scheduler = FakeFrameScheduler()
        val seen = mutableListOf<Int>()
        val coalescer = NativeDrawingInputCoalescer<Int>(scheduler) { seen += it }

        coalescer.offer(1)
        coalescer.offer(2)
        coalescer.offer(3)

        assertTrue(scheduler.hasPending())
        scheduler.runNext()
        assertEquals(listOf(3), seen)
        assertFalse(scheduler.hasPending())
    }

    @Test fun flushCancelsFrameAndDeliversLatestMoveExactlyOnce() {
        val scheduler = FakeFrameScheduler()
        val seen = mutableListOf<String>()
        val coalescer = NativeDrawingInputCoalescer<String>(scheduler) { seen += "move:$it" }

        seen += "start"
        coalescer.offer("older")
        coalescer.offer("final")
        coalescer.flush()
        seen += "end"

        assertEquals(listOf("start", "move:final", "end"), seen)
        assertFalse(scheduler.hasPending())
        coalescer.flush()
        assertEquals(listOf("start", "move:final", "end"), seen)
    }

    @Test fun discardDropsPendingMoveAndCancelsScheduledFrame() {
        val scheduler = FakeFrameScheduler()
        val seen = mutableListOf<Int>()
        val coalescer = NativeDrawingInputCoalescer<Int>(scheduler) { seen += it }

        coalescer.offer(1)
        coalescer.discard()

        assertFalse(scheduler.hasPending())
        assertTrue(seen.isEmpty())
    }
}
