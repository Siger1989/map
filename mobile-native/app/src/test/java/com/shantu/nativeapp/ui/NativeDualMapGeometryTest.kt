package com.shantu.nativeapp.ui

import com.shantu.nativeapp.map.NativeCameraSnapshot
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeDualMapGeometryTest {
    @Test
    fun portraitUsesTwoStackedMapViewportsAndLeavesHeaderToolbarsAndFooterOutside() {
        val bounds = NativeDualMapGeometry.compute(390, 857, 1f)
        assertTrue(!bounds.landscape)
        assertEquals(NativeMapRectPx(0, 80, 390, 344), bounds.primary)
        assertEquals(NativeMapRectPx(0, 456, 390, 345), bounds.secondary)
        assertTrue(bounds.primary.bottom < bounds.secondary.top)
        assertEquals(56, bounds.height - bounds.secondary.bottom)
    }

    @Test
    fun landscapeUsesSideBySideMapViewportsWithoutOverlap() {
        val bounds = NativeDualMapGeometry.compute(857, 390, 1f)
        assertTrue(bounds.landscape)
        assertEquals(NativeMapRectPx(0, 80, 428, 254), bounds.primary)
        assertEquals(NativeMapRectPx(428, 80, 429, 254), bounds.secondary)
        assertEquals(bounds.primary.right, bounds.secondary.left)
        assertEquals(bounds.primary.bottom, bounds.secondary.bottom)
    }

    @Test
    fun geometryScalesChromeMetricsAndClampsTinyRoots() {
        val scaled = NativeDualMapGeometry.compute(780, 1714, 2f)
        assertEquals(160, scaled.primary.top)
        assertEquals(112, scaled.height - scaled.secondary.bottom)
        val tiny = NativeDualMapGeometry.compute(10, 20, 1f)
        assertTrue(tiny.primary.width >= 0 && tiny.primary.height >= 0)
        assertTrue(tiny.secondary.width >= 0 && tiny.secondary.height >= 0)
    }

    @Test
    fun cameraSyncTargetsOtherPaneOnlyWhenEnabledAndPreventsEchoes() {
        val source = NativeCameraSnapshot(30.0, 104.0, 1200.0, 20.0, 35.0)
        val changed = source.copy(longitude = 104.001)
        assertEquals(1, NativeDualMapCameraSync.targetPane(0, true, changed, source))
        assertEquals(0, NativeDualMapCameraSync.targetPane(1, true, changed, source))
        assertEquals(null, NativeDualMapCameraSync.targetPane(0, false, changed, source))
        assertEquals(null, NativeDualMapCameraSync.targetPane(1, true, source, source.copy(rangeMeters = 1200.005)))
    }
}
