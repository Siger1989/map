package com.shantu.nativeapp.hybrid

import com.shantu.nativeapp.map.NativeMarkerPresentation
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeMarkerPresentationTest {
    @Test fun compositeBadgeKeepsItsModeAtEveryZoomAndForOverrides() {
        for (zoom in listOf(-100.0, 3.0, 8.0, 9.0, 20.0, Double.NaN, Double.POSITIVE_INFINITY)) {
            assertEquals("label", NativeMarkerPresentation.mode(zoom, false))
            assertEquals("label", NativeMarkerPresentation.mode(zoom, true))
            assertEquals("label", NativeMarkerPresentation.stableMode(zoom, "dot"))
            assertEquals("label", NativeMarkerPresentation.resolvedMode(zoom, "icon"))
        }
        assertEquals("label", NativeMarkerPresentation.resolvedMode(12.0, null))
    }

    @Test fun fullBadgeVisualAnchorsFollowTheZoomCurve() {
        assertVisualSize(16.0, 40.0)
        assertVisualSize(12.0, 31.3333333333)
        assertVisualSize(8.0, 22.6666666667)
        assertVisualSize(4.0, 14.0)
        assertVisualSize(-20.0, 14.0)
    }

    @Test fun scaleClampsExtremesAndUsesFullSizeForNonFiniteZoom() {
        assertVisualSize(1.0e9, 40.0)
        assertVisualSize(-1.0e9, 14.0)
        for (zoom in listOf(Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY)) {
            assertVisualSize(zoom, 40.0)
        }
    }

    @Test fun cssScaleAndDensityInputsStaySafeAndBounded() {
        assertEquals(3, NativeMarkerPresentation.densityBucket(2.8))
        assertEquals(4, NativeMarkerPresentation.densityBucket(8.0))
        assertEquals(1, NativeMarkerPresentation.densityBucket(0.5))
        assertEquals(1, NativeMarkerPresentation.densityBucket(Double.NaN))
        assertEquals(40.0 / 64.0, NativeMarkerPresentation.imageScale(16.0, Double.NaN, 1, "label"), 0.0001)
        assertEquals(40.0 / 64.0, NativeMarkerPresentation.imageScale(16.0, 0.0, 1, "label"), 0.0001)
        assertEquals(40.0 * 8.0 / (64.0 * 4), NativeMarkerPresentation.imageScale(16.0, 8.0, 9, "label"), 0.0001)
        assertEquals(40.0 / 64.0, NativeMarkerPresentation.imageScale(16.0, 1.0, 0, "label"), 0.0001)
    }

    private fun assertVisualSize(zoom: Double, expectedCssPixels: Double) {
        val density = 2
        val imageScale = NativeMarkerPresentation.imageScale(zoom, 1.0, density, "label")
        assertEquals(expectedCssPixels, imageScale * 64.0 * density, 0.0001)
        assertTrue(imageScale > 0.0)
    }
}
