package com.shantu.nativeapp.map

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeTileDemandFrameCoalescerTest {
    private data class Frame(val id: Int, val width: Int, val height: Int)

    @Test
    fun `camera frames keep only latest and run trailing frame at interval`() {
        val coalescer = NativeTileDemandFrameCoalescer<Frame>()
        coalescer.offer(Frame(1, 390, 857))
        assertEquals(1, (coalescer.poll(1) as NativeTileDemandFrameCoalescer.Poll.Ready).value.frame.id)

        coalescer.offer(Frame(2, 390, 857))
        coalescer.offer(Frame(3, 400, 860))
        val waiting = coalescer.poll(80) as NativeTileDemandFrameCoalescer.Poll.Wait
        assertEquals(21L, waiting.delayMs)
        val trailing = coalescer.poll(101) as NativeTileDemandFrameCoalescer.Poll.Ready
        assertEquals(Frame(3, 400, 860), trailing.value.frame)
        assertEquals(NativeTileDemandFrameCoalescer.Poll.Idle, coalescer.poll(102))
    }

    @Test
    fun `urgent footprint or source changes bypass camera cadence and preserve force`() {
        val coalescer = NativeTileDemandFrameCoalescer<Frame>()
        coalescer.offer(Frame(1, 390, 857))
        coalescer.poll(10)
        coalescer.offer(Frame(2, 390, 857))
        coalescer.requestUrgent(forceGeneration = true)
        // A later focus-only priority update must not erase the pending source/visibility force.
        coalescer.requestUrgent()

        val ready = coalescer.poll(11) as NativeTileDemandFrameCoalescer.Poll.Ready
        assertEquals(2, ready.value.frame.id)
        assertTrue(ready.value.forceGeneration)
    }

    @Test
    fun `urgent request waits for first real frame and does not invent a viewport`() {
        val coalescer = NativeTileDemandFrameCoalescer<Frame>()
        coalescer.requestUrgent(forceGeneration = true)
        assertEquals(NativeTileDemandFrameCoalescer.Poll.AwaitFrame, coalescer.poll(0))
        coalescer.offer(Frame(7, 360, 780))
        val ready = coalescer.poll(1) as NativeTileDemandFrameCoalescer.Poll.Ready
        assertEquals(Frame(7, 360, 780), ready.value.frame)
        assertTrue(ready.value.forceGeneration)
    }

    @Test
    fun `hidden view invalidation prevents a delayed old frame from becoming visible again`() {
        val coalescer = NativeTileDemandFrameCoalescer<Frame>()
        coalescer.offer(Frame(1, 390, 857))
        coalescer.requestUrgent()
        coalescer.clearPending()
        assertEquals(NativeTileDemandFrameCoalescer.Poll.Idle, coalescer.poll(200))

        coalescer.requestUrgent(forceGeneration = true)
        assertEquals(NativeTileDemandFrameCoalescer.Poll.AwaitFrame, coalescer.poll(201))
        coalescer.offer(Frame(2, 360, 780))
        val ready = coalescer.poll(202) as NativeTileDemandFrameCoalescer.Poll.Ready
        assertEquals(Frame(2, 360, 780), ready.value.frame)
        assertTrue(ready.value.forceGeneration)
    }

    @Test
    fun `deferred viewport frame retains urgency until a matching frame arrives`() {
        val coalescer = NativeTileDemandFrameCoalescer<Frame>()
        coalescer.offer(Frame(1, 390, 857))
        coalescer.requestUrgent(forceGeneration = true)
        coalescer.deferUntilNextFrame(forceGeneration = true)
        assertEquals(NativeTileDemandFrameCoalescer.Poll.AwaitFrame, coalescer.poll(1))
        coalescer.offer(Frame(2, 360, 780))
        val ready = coalescer.poll(2) as NativeTileDemandFrameCoalescer.Poll.Ready
        assertEquals(2, ready.value.frame.id)
        assertTrue(ready.value.forceGeneration)
    }

    @Test
    fun `dispose rejects late GL frames and pending work`() {
        val coalescer = NativeTileDemandFrameCoalescer<Frame>()
        coalescer.offer(Frame(1, 390, 857))
        coalescer.dispose()
        coalescer.offer(Frame(2, 390, 857))
        coalescer.requestUrgent(forceGeneration = true)
        assertFalse(coalescer.latestFrame() != null)
        assertEquals(NativeTileDemandFrameCoalescer.Poll.Idle, coalescer.poll(1_000))
    }
}
