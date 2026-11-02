package com.shantu.nativeapp.map

import org.junit.Assert.*
import org.junit.Test

class NativeMarkerPresentationStateTest {
    @Test fun zoomSweepUpAndDownResizesContinuouslyWithoutRebuildingTexture() {
        val state = NativeMarkerPresentationState()
        var rebuilds = 0
        var previousSize = Double.NEGATIVE_INFINITY
        for (step in 0..280) {
            val update = state.update(3.0 + step * 0.05, 3.0)
            if (update.rebuild) rebuilds++
            val size = NativeMarkerPresentation.imageScale(3.0 + step * 0.05, 3.0, 3, update.mode)
            assertTrue("badge should grow as zoom increases", size + 1e-10 >= previousSize)
            previousSize = size
        }
        assertEquals(1, rebuilds) // initial texture only

        previousSize = Double.POSITIVE_INFINITY
        for (step in 0..280) {
            val update = state.update(17.0 - step * 0.05, 3.0)
            assertFalse(update.rebuild)
            val size = NativeMarkerPresentation.imageScale(17.0 - step * 0.05, 3.0, 3, update.mode)
            assertTrue("badge should shrink as zoom decreases", size <= previousSize + 1e-10)
            previousSize = size
        }
        assertFalse(state.update(3.0, 3.0).resize)
        assertFalse(state.update(3.0, 3.0).resize)
    }

    @Test fun sizeChangesContinuouslyAcrossFormerThresholdsAndStopsAtClamp() {
        val state = NativeMarkerPresentationState()
        for (threshold in listOf(8.0, 9.0)) {
            state.update(threshold, 1.0)
            val before = state.update(threshold - 0.001, 1.0)
            val after = state.update(threshold + 0.001, 1.0)
            assertTrue(before.resize)
            assertTrue(after.resize)
            val delta = kotlin.math.abs(
                NativeMarkerPresentation.imageScale(threshold + 0.001, 1.0, 1, after.mode) -
                    NativeMarkerPresentation.imageScale(threshold - 0.001, 1.0, 1, before.mode)
            )
            assertTrue(delta < 0.0001)
        }
        val clampedState = NativeMarkerPresentationState()
        assertTrue(clampedState.update(2.0, 1.0).resize)
        assertFalse(clampedState.update(1.0, 1.0).resize) // both zooms are at the minimum clamp
    }

    @Test fun cssScaleOnlyResizesButDensityBucketChangesRebuild() {
        val state = NativeMarkerPresentationState()
        assertTrue(state.update(12.0, 2.0).rebuild)
        val scaleOnly = state.update(12.0, 2.1)
        assertFalse(scaleOnly.rebuild)
        assertTrue(scaleOnly.resize)
        assertFalse(state.update(12.0, 2.1).resize)
        assertTrue(state.update(12.0, 3.0).rebuild)
    }

    @Test fun subThresholdZoomStepsAccumulateUntilAppliedResize() {
        val state = NativeMarkerPresentationState()
        assertTrue(state.update(10.0, 1.0).rebuild)
        var resizeCount = 0
        for (step in 1..20) {
            val update = state.update(10.0 + step * 0.0001, 1.0)
            assertFalse(update.rebuild)
            if (update.resize) resizeCount++
        }
        assertTrue("cumulative zoom movement should eventually resize", resizeCount > 0)
        assertTrue("sub-threshold changes should not resize every frame", resizeCount < 20)
        assertFalse(state.update(10.002, 1.0).resize)
    }

    @Test fun eachMapKeepsItsOwnPresentationState() {
        val firstMap = NativeMarkerPresentationState()
        val secondMap = NativeMarkerPresentationState()
        assertTrue(firstMap.update(12.0, 2.0).rebuild)
        assertTrue(secondMap.update(12.0, 2.0).rebuild)
        val firstZoomChange = firstMap.update(7.0, 2.0)
        val secondZoomChange = secondMap.update(9.0, 2.0)
        assertFalse(firstZoomChange.rebuild)
        assertFalse(secondZoomChange.rebuild)
        assertTrue(firstZoomChange.resize)
        assertTrue(secondZoomChange.resize)
        assertFalse(firstMap.update(7.0, 2.0).resize)
        assertFalse(secondMap.update(9.0, 2.0).resize)
    }
}
