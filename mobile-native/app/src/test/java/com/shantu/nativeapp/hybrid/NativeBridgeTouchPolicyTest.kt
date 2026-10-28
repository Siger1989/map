package com.shantu.nativeapp.hybrid

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeBridgeTouchPolicyTest {
    @Test fun editorSinglePointerDownRetainsGroundAnchor() {
        // capture() returns true for drawing-owned DOWN before the Host evaluates the policy.
        assertFalse(NativeBridgeTouchPolicy.shouldClearGroundAnchor(
            actionDown = true, pointerDown = false, pointerCaptured = true, navigationStarted = false,
        ))
    }

    @Test fun ordinaryDownAndDrawingSecondPointerHandoffClearGroundAnchor() {
        assertTrue(NativeBridgeTouchPolicy.shouldClearGroundAnchor(
            actionDown = true, pointerDown = false, pointerCaptured = false, navigationStarted = false,
        ))
        // capture() has already set isNavigating and returned false for the second finger.
        assertTrue(NativeBridgeTouchPolicy.shouldClearGroundAnchor(
            actionDown = false, pointerDown = true, pointerCaptured = false, navigationStarted = true,
        ))
    }

    @Test fun aCancelledDrawingStreamDoesNotClearAnchorByItself() {
        assertFalse(NativeBridgeTouchPolicy.shouldClearGroundAnchor(
            actionDown = false, pointerDown = false, pointerCaptured = false, navigationStarted = false,
        ))
    }
}
