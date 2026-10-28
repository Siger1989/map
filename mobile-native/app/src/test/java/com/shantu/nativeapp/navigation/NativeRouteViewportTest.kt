package com.shantu.nativeapp.navigation

import com.shantu.nativeapp.map.NativeCameraSnapshot
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeRouteViewportTest {
    private val current = NativeCameraSnapshot(0.0, 0.0, 10_000.0, 30.0, 45.0)

    @Test fun fitsActualCoordinatesAndReturnsTopDownCamera() {
        val camera = NativeRouteViewport.fit(
            listOf(NativeCoordinate(104.0, 30.0), NativeCoordinate(104.02, 30.01)),
            current, 400, 800,
        )
        assertEquals(30.005, camera.latitude, 1e-9)
        assertEquals(104.01, camera.longitude, 1e-9)
        assertTrue(camera.rangeMeters > 500.0)
        assertEquals(0.0, camera.headingDegrees, 0.0)
        assertEquals(0.0, camera.pitchDegrees, 0.0)
    }

    @Test fun usesShortestLongitudeArcAcrossDateLine() {
        val wrapped = NativeRouteViewport.fit(
            listOf(NativeCoordinate(179.0, 10.0), NativeCoordinate(-179.0, 10.0)),
            current, 800, 400,
        )
        val broad = NativeRouteViewport.fit(
            listOf(NativeCoordinate(-170.0, 10.0), NativeCoordinate(170.0, 10.0)),
            current, 800, 400,
        )
        assertEquals(180.0, wrapped.longitude, 1e-9)
        assertTrue(wrapped.rangeMeters < broad.rangeMeters)
    }
}
