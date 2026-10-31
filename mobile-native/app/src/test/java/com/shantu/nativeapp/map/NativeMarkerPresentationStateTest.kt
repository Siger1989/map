package com.shantu.nativeapp.map

import org.junit.Assert.*
import org.junit.Test

class NativeMarkerPresentationStateTest {
    @Test fun noisyBoundariesKeepOneModeUntilLeavingTheHysteresisBand() {
        val state = NativeMarkerPresentationState()
        assertEquals("label", state.update(10.0, 3.0).mode)
        for (zoom in listOf(9.01, 8.99, 9.0, 8.90, 9.02)) {
            val update = state.update(zoom, 3.0)
            assertEquals("label", update.mode)
            assertFalse(update.rebuild)
        }
        assertEquals("icon", state.update(8.80, 3.0).mode)
        for (zoom in listOf(8.99, 9.01, 9.14)) assertFalse(state.update(zoom, 3.0).rebuild)
        assertEquals("dot", state.update(7.80, 3.0).mode)
        for (zoom in listOf(7.99, 8.01, 8.14)) assertFalse(state.update(zoom, 3.0).rebuild)
        assertEquals("icon", state.update(8.20, 3.0).mode)
        assertEquals("label", state.update(9.20, 3.0).mode)
    }

    @Test fun continuousZoomKeepsFixedCssSizeAndRebuildsOnlyAtModeBoundaries() {
        val state = NativeMarkerPresentationState()
        var rebuilds = 0
        for (step in 0..280) if (state.update(3.0 + step * 0.05, 3.0).rebuild) rebuilds++
        for (step in 279 downTo 0) if (state.update(3.0 + step * 0.05, 3.0).rebuild) rebuilds++
        assertEquals(5, rebuilds) // initial + two thresholds in each direction
        assertFalse(state.update(3.0, 3.0).resize)
        assertFalse(state.update(3.0, 3.0).resize)
    }

    @Test fun viewportDensityOnlyRebuildsWhenTheRasterBucketChanges() {
        val state = NativeMarkerPresentationState()
        assertTrue(state.update(12.0, 2.0).rebuild)
        val scaleOnly = state.update(12.0, 2.1)
        assertFalse(scaleOnly.rebuild)
        assertTrue(scaleOnly.resize)
        assertFalse(state.update(12.0, 2.1).resize)
        assertTrue(state.update(12.0, 3.0).rebuild)
    }
}
