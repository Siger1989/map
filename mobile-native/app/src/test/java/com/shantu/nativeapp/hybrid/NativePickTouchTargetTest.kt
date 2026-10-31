package com.shantu.nativeapp.hybrid

import org.junit.Assert.assertEquals
import org.junit.Test

class NativePickTouchTargetTest {
    @Test fun asyncPickRepliesBelongOnlyToTheReleasedUncancelledTapGesture() {
        val gate = NativeTapCompletionGate()
        gate.begin(41L) // ACTION_DOWN
        assertEquals(false, gate.accepts(41L))
        gate.releaseTap(41L) // short ACTION_UP starts the asynchronous GPU pick
        assertEquals(true, gate.accepts(41L))

        gate.begin(43L) // next ACTION_DOWN invalidates the old reply
        assertEquals(false, gate.accepts(41L))
        assertEquals(false, gate.accepts(43L))
        gate.releaseTap(43L)
        assertEquals(true, gate.accepts(43L))

        gate.cancel(43L) // pointer down / ACTION_CANCEL invalidates an in-flight result
        assertEquals(false, gate.accepts(43L))
    }

    @Test fun normalizesOnlyKnownMarkersForReactDragAndTapWithoutChangingPhotoOrLineDelegates() {
        val ids=listOf("pin-a","shantu-object:pin-a","model-b","shantu-photo:p","geology:rock","shantu-bridge:route")
        assertEquals(listOf("shantu-object:pin-a","shantu-object:model-b","shantu-photo:p","geology:rock","shantu-bridge:route"),
            NativePickTouchTarget.normalizeMarkerIds(ids,setOf("pin-a","model-b")))
    }
    @Test fun createsCenteredFortyFourCssPixelTargetInPhysicalPixels() {
        val bounds = NativePickTouchTarget.centered(120f, 240f, 2.0)

        assertEquals(76f, bounds.left, 0.001f)
        assertEquals(196f, bounds.top, 0.001f)
        assertEquals(164f, bounds.right, 0.001f)
        assertEquals(284f, bounds.bottom, 0.001f)
        assertEquals(88f, bounds.right - bounds.left, 0.001f)
        assertEquals(88f, bounds.bottom - bounds.top, 0.001f)
    }

    @Test fun cssScaleOneKeepsTheSameCssTargetSize() {
        val bounds = NativePickTouchTarget.centered(50f, 70f, 1.0)
        assertEquals(44f, bounds.right - bounds.left, 0.001f)
        assertEquals(44f, bounds.bottom - bounds.top, 0.001f)
    }

}
