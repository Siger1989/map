package com.shantu.nativeapp.floating

import org.junit.Assert.*
import org.junit.Test

class FloatingNavigationGeometryTest {
    private val origin = FloatingCoordinate(0.0, 0.0)
    private fun around(east: Double, north: Double) = FloatingCoordinate(Math.toDegrees(east / 6_378_137.0), Math.toDegrees(north / 6_378_137.0))

    @Test fun northUpKeepsEastRightAndNorthUp() {
        val east = FloatingNavigationGeometry.project(origin, around(100.0, 0.0), null, "north", 184f, 216f, 1.0)
        val north = FloatingNavigationGeometry.project(origin, around(0.0, 100.0), null, "north", 184f, 216f, 1.0)
        assertTrue(east.x > 92f); assertEquals(108f, east.y, .1f)
        assertEquals(92f, north.x, .1f); assertTrue(north.y < 108f)
    }

    @Test fun motionBearingRotatesTrueTravelDirectionToTop() {
        val east = FloatingNavigationGeometry.project(origin, around(100.0, 0.0), 90.0, "motion", 184f, 216f, 1.0)
        val west = FloatingNavigationGeometry.project(origin, around(-100.0, 0.0), 90.0, "motion", 184f, 216f, 1.0)
        assertEquals(92f, east.x, .2f); assertTrue(east.y < 108f)
        assertEquals(92f, west.x, .2f); assertTrue(west.y > 108f)
    }

    @Test fun routePointAndMvtWorldPixelUseIdenticalZ14Projection() {
        val center = FloatingCoordinate(12.0, 45.0)
        val point = FloatingCoordinate(12.003, 45.002)
        val n = 1 shl 14
        val centerX = (center.longitude + 180.0) / 360.0 * n
        val pointX = (point.longitude + 180.0) / 360.0 * n
        val centerLat = Math.toRadians(center.latitude)
        val pointLat = Math.toRadians(point.latitude)
        val centerY = (1.0 - kotlin.math.ln(kotlin.math.tan(centerLat) + 1.0 / kotlin.math.cos(centerLat)) / Math.PI) / 2.0 * n
        val pointY = (1.0 - kotlin.math.ln(kotlin.math.tan(pointLat) + 1.0 / kotlin.math.cos(pointLat)) / Math.PI) / 2.0 * n
        val projected = FloatingNavigationGeometry.projectTileAligned(center, point, 14, 92f, 70f)
        assertEquals(92.0 + (pointX - centerX) * 256.0, projected.x.toDouble(), .02)
        assertEquals(70.0 + (pointY - centerY) * 256.0, projected.y.toDouble(), .02)
    }

    @Test fun routeRemainingAndOffRouteUseNearestSegment() {
        val route = listOf(around(0.0, 0.0), around(100.0, 0.0), around(200.0, 0.0))
        val on = FloatingNavigationGeometry.routeProjection(around(75.0, 0.0), route)!!
        assertEquals(125.0, on.remainingMeters, 1.0)
        assertFalse(on.offRoute)
        val away = FloatingNavigationGeometry.routeProjection(around(75.0, 60.0), route)!!
        assertTrue(away.offRoute)
    }

    @Test fun rejectsInvalidRouteOrOversizePayload() {
        assertThrows(IllegalArgumentException::class.java) { FloatingNavigationGeometry.validate("north", "x", listOf(origin)) }
        assertThrows(IllegalArgumentException::class.java) { FloatingNavigationGeometry.validate("south", "x", listOf(origin, origin)) }
        assertThrows(IllegalArgumentException::class.java) { FloatingNavigationGeometry.validate("north", "x", listOf(origin, FloatingCoordinate(181.0, 0.0))) }
        assertThrows(IllegalArgumentException::class.java) { FloatingNavigationGeometry.validatePayloadBytes(ByteArray(FloatingNavigationGeometry.MAX_PAYLOAD_BYTES + 1)) }
    }
}
