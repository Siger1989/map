package com.shantu.nativeapp.hybrid

import org.junit.Assert.*
import org.junit.Test

class NativeMagnifierRoiTest {
    @Test fun roiKeepsCssMappingAfterPixelRounding() {
        val roi = NativeMagnifierRoiPolicy.clamp(1000, 1800, 2.5, 10.2, 20.2, 96.0, 96.0)!!
        assertEquals(25, roi.leftPx)
        assertEquals(50, roi.topPx)
        assertEquals(266, roi.rightPx)
        assertEquals(291, roi.bottomPx)
        assertEquals(96.4, roi.widthCss, 1e-9)
        assertEquals(96.4, roi.heightCss, 1e-9)
    }

    @Test fun roiClampsAtEverySurfaceEdgeAndReturnsTheActualCrop() {
        val roi = NativeMagnifierRoiPolicy.clamp(100, 160, 2.0, -20.0, 60.0, 96.0, 96.0)!!
        assertEquals(0, roi.leftPx)
        assertEquals(120, roi.topPx)
        assertEquals(100, roi.rightPx)
        assertEquals(160, roi.bottomPx)
        assertEquals(50.0, roi.widthCss, 0.0)
        assertEquals(20.0, roi.heightCss, 0.0)
        assertNull(NativeMagnifierRoiPolicy.clamp(100, 160, 2.0, 60.0, 0.0, 96.0, 20.0))
    }

    @Test fun invalidSurfaceScaleOrRectIsRejected() {
        assertNull(NativeMagnifierRoiPolicy.clamp(0, 100, 2.0, 0.0, 0.0, 96.0, 96.0))
        assertNull(NativeMagnifierRoiPolicy.clamp(100, 100, 0.0, 0.0, 0.0, 96.0, 96.0))
        assertNull(NativeMagnifierRoiPolicy.clamp(100, 100, 2.0, 10.0, 10.0, -1.0, 96.0))
    }
}
