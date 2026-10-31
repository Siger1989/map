package com.shantu.nativeapp.hybrid

import com.shantu.nativeapp.map.NativeMarkerPresentation
import org.junit.Assert.assertEquals
import org.junit.Test

class NativeMarkerPresentationTest {
    @Test fun oneGlyphRemainsVisibleAtEveryZoomAndNamesStartAtRawZoomNine() {
        assertEquals("dot", NativeMarkerPresentation.mode(3.0, false))
        assertEquals("dot", NativeMarkerPresentation.mode(7.999, false))
        assertEquals("icon", NativeMarkerPresentation.mode(8.0, false))
        assertEquals("icon", NativeMarkerPresentation.mode(8.999, false))
        assertEquals("label", NativeMarkerPresentation.mode(9.0, false))
        assertEquals("dot", NativeMarkerPresentation.mode(3.0, true))
        assertEquals("label", NativeMarkerPresentation.mode(Double.NaN, false))
    }

    @Test fun cameraBoundaryHysteresisPreventsFrameToFrameModeFlips() {
        assertEquals("label", NativeMarkerPresentation.stableMode(8.9, "label"))
        assertEquals("icon", NativeMarkerPresentation.stableMode(8.84, "label"))
        assertEquals("icon", NativeMarkerPresentation.stableMode(9.1, "icon"))
        assertEquals("label", NativeMarkerPresentation.stableMode(9.15, "icon"))
        assertEquals("dot", NativeMarkerPresentation.stableMode(7.9, "dot"))
        assertEquals("icon", NativeMarkerPresentation.stableMode(8.15, "dot"))
        assertEquals("label", NativeMarkerPresentation.stableMode(Double.NaN, "label"))
    }

    @Test fun nativeGlyphScaleMatchesCssScaleAndDensityBucketsStayBounded() {
        assertEquals(3, NativeMarkerPresentation.densityBucket(2.8))
        assertEquals(4, NativeMarkerPresentation.densityBucket(8.0))
        assertEquals(1, NativeMarkerPresentation.densityBucket(0.5))
        assertEquals(40.0 * 2.8 / (64.0 * 3), NativeMarkerPresentation.imageScale(16.0, 2.8, 3, "label"), 0.0001)
        assertEquals(9.0 * 2.8 / (9.0 * 3), NativeMarkerPresentation.imageScale(16.0, 2.8, 3, "dot"), 0.0001)
        assertEquals(NativeMarkerPresentation.imageScale(16.0, 2.8, 3, "label"),
            NativeMarkerPresentation.imageScale(3.0, 2.8, 3, "label"), 0.0001)
    }
}
