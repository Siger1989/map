package com.shantu.nativeapp.hybrid

import com.shantu.nativeapp.map.NativeCameraSnapshot
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeShareCameraFitPolicyTest {
    @Test fun shortRoutesDoNotExceedWebShareMaximumZoom() {
        val fit = NativeCameraSnapshot(31.0, 102.9, 500.0, 0.0, 0.0, 0.0)
        val limited = NativeShareCameraFitPolicy.applyMaxZoom(fit, 1250)
        assertEquals(NativeShareCameraFitPolicy.rangeAtZoom(16.0, 31.0, 1250), limited.rangeMeters, 1e-8)
    }

    @Test fun longRouteRangeIsPreservedAndViewportHeightScalesTheZoomLimit() {
        val broadFit = NativeCameraSnapshot(31.0, 102.9, 8_000.0, 0.0, 0.0, 0.0)
        assertEquals(broadFit.rangeMeters, NativeShareCameraFitPolicy.applyMaxZoom(broadFit, 1250).rangeMeters, 0.0)
        assertTrue(NativeShareCameraFitPolicy.rangeAtZoom(16.0, 31.0, 1250) > NativeShareCameraFitPolicy.rangeAtZoom(16.0, 31.0, 1000))
    }
}
