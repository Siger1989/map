package com.shantu.nativeapp.hybrid

import org.junit.Assert.*
import org.junit.Test

class NativeBridgeFrameCaptureGateTest {
    @Test fun captureIsCadencedAndOneFinalDirtySampleIsNotLost() {
        val gate = NativeBridgeFrameCaptureGate()
        gate.markDirty()
        assertTrue(gate.isDue(100L, 100L))
        assertEquals(1L, gate.markCaptured(100L))
        assertFalse(gate.hasPending())
        assertNull(gate.captureIfDue(200L, 100L)) // The redraw requested by capture does not self-schedule.

        gate.markDirty()
        assertEquals(50L, gate.delayUntilDue(150L, 100L))
        assertNull(gate.captureIfDue(199L, 100L))
        assertEquals(2L, gate.captureIfDue(200L, 100L))
        assertFalse(gate.hasPending())
        assertNull(gate.captureIfDue(300L, 100L))
    }

    @Test fun changeDuringCaptureRemainsPendingForTheBoundedTailSample() {
        val gate = NativeBridgeFrameCaptureGate()
        gate.markDirty()
        assertTrue(gate.isDue(0L, 33L))
        assertEquals(1L, gate.markCaptured(0L))
        gate.markDirty()
        assertTrue(gate.hasPending())
        assertEquals(33L, gate.delayUntilDue(0L, 33L))
        assertEquals(2L, gate.captureIfDue(33L, 33L))
        assertFalse(gate.hasPending())
    }

    @Test fun failedViewportAttemptStaysDirtyWithoutImmediateRetrySpin() {
        val gate = NativeBridgeFrameCaptureGate()
        gate.markDirty()
        assertTrue(gate.isDue(10L, 33L))
        gate.markAttempt(10L)
        assertTrue(gate.hasPending())
        assertFalse(gate.isDue(11L, 33L))
        assertEquals(32L, gate.delayUntilDue(11L, 33L))
        assertTrue(gate.isDue(43L, 33L))
    }
}
