package com.shantu.nativeapp.hybrid

import com.shantu.nativeapp.map.NativeCameraSnapshot
import com.shantu.nativeapp.navigation.NativeCoordinate
import com.shantu.nativeapp.navigation.NativeRouteViewport
import org.junit.Assert.*
import org.junit.Test

class NativeCollectionViewportTest {
    private val current = NativeCameraSnapshot(30.0, 104.0, 2000.0, 35.0, 42.0)
    private val vertical = listOf(NativeCoordinate(longitude = 104.0, latitude = 30.0), NativeCoordinate(longitude = 104.0, latitude = 30.2))

    @Test fun topCollectionPanelCentersInTheRemainingMapAtEveryDensity() {
        val css = NativeCollectionViewport.visibleRect(390, 857, 1.0, 456.0, 0.0, 0.0, 0.0)
        val phone = NativeCollectionViewport.visibleRect(1170, 2571, 3.0, 456.0, 0.0, 0.0, 0.0)
        assertEquals(195.0, css.centerX, 0.0); assertEquals(656.5, css.centerY, 0.0)
        assertEquals(css.centerX * 3, phone.centerX, 0.0); assertEquals(css.centerY * 3, phone.centerY, 0.0)
        assertEquals(401.0, css.height, 0.0)
    }

    @Test fun paddedFitUsesActualVerticalFovNotOnlyAChangedAspectRatio() {
        val visible = NativeCollectionViewport.visibleRect(390, 857, 1.0, 456.0, 0.0, 0.0, 0.0)
        val padded = NativeCollectionViewport.fit(vertical, current, 390, 857, visible)
        val original = NativeRouteViewport.fit(vertical, current, 390, 857)
        assertEquals(original.rangeMeters * 857 / 401, padded.rangeMeters, 0.00001)
        assertEquals(original.latitude, padded.latitude, 0.0); assertEquals(original.longitude, padded.longitude, 0.0)
    }

    @Test fun zeroPaddingKeepsTheExistingFitAndEachDualPaneUsesItsOwnHeight() {
        val full = NativeCollectionViewport.visibleRect(390, 857, 1.0, 0.0, 0.0, 0.0, 0.0)
        assertEquals(NativeRouteViewport.fit(vertical, current, 390, 857), NativeCollectionViewport.fit(vertical, current, 390, 857, full))
        val topPane = NativeCollectionViewport.visibleRect(390, 350, 1.0, 100.0, 24.0, 8.0, 8.0)
        assertEquals(221.0, topPane.centerY, 0.0); assertEquals(187.0, topPane.centerX, 0.0)
    }

    @Test fun invalidOrOversizedInsetsCannotProduceNegativeViewport() {
        val rect = NativeCollectionViewport.visibleRect(360, 200, 2.0, 10000.0, 10000.0, 10000.0, 10000.0)
        assertEquals(1.0, rect.width, 0.00001); assertEquals(1.0, rect.height, 0.00001)
        val invalid = NativeCollectionViewport.visibleRect(360, 780, Double.NaN, Double.NaN, -10.0, Double.POSITIVE_INFINITY, -4.0)
        assertEquals(360.0, invalid.width, 0.0); assertEquals(780.0, invalid.height, 0.0)
    }
}
