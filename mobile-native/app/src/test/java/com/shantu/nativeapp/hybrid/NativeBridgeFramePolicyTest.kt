package com.shantu.nativeapp.hybrid

import org.junit.Assert.*
import org.junit.Test

class NativeBridgeFramePolicyTest {
    @Test fun comparisonKeepsProjectionCadenceWithoutTurningBrowsingIntoGroundWork() {
        assertEquals(33L, NativeBridgeFramePolicy.intervalMillis(realtimeTask = false, comparison = true))
        assertFalse(NativeBridgeFramePolicy.allowGroundWork(false, 1000, 999))
        assertTrue(NativeBridgeFramePolicy.allowGroundWork(false, 1179, 999))
        // Real editing keeps its original immediate ground-work contract in either layout.
        assertEquals(33L, NativeBridgeFramePolicy.intervalMillis(realtimeTask = true, comparison = true))
        assertTrue(NativeBridgeFramePolicy.allowGroundWork(true, 1000, 999))
    }

    @Test fun tasksKeepExistingCadenceAndGroundWorkDuringMotion() {
        assertEquals(33L, NativeBridgeFramePolicy.intervalMillis(true))
        assertTrue(NativeBridgeFramePolicy.allowGroundWork(true, 1000, 999))
    }
    @Test fun browsingDefersSamplingUntilTheLastMotionIsQuiet() {
        assertFalse(NativeBridgeFramePolicy.allowGroundWork(false, 1100, 1000))
        assertFalse(NativeBridgeFramePolicy.allowGroundWork(false, 1179, 1000))
        assertTrue(NativeBridgeFramePolicy.allowGroundWork(false, 1180, 1000))
        // A newer motion restarts the quiet period; an older timer cannot run heavy work.
        assertFalse(NativeBridgeFramePolicy.allowGroundWork(false, 1180, 1170))
        assertTrue(NativeBridgeFramePolicy.allowGroundWork(false, 1350, 1170))
    }
}
