package com.shantu.nativeapp.geometry

import org.junit.Assert.*
import org.junit.Test

class NativeMeasurementsTest {
    @Test fun eastwardEquatorialDistanceAndUnknownHeight() {
        val m = NativeMeasurements.segment(GeoPoint(0.0, 0.0), GeoPoint(1.0, 0.0))
        assertEquals(111195.080, m.horizontal, .001)
        assertEquals(90.0, m.bearing!!, .00001)
        assertNull(m.rise); assertNull(m.spatial); assertNull(m.inclination)
    }
    @Test fun knownVerticalDistanceAndUndefinedBearing() {
        val m = NativeMeasurements.segment(GeoPoint(104.0, 30.0, 10.0), GeoPoint(104.0, 30.0, 30.0))
        assertEquals(20.0, m.spatial!!, .00001)
        assertEquals(90.0, m.inclination!!, .00001)
        assertNull(m.bearing)
    }
    @Test fun dateLineAreaMatchesEquivalentLocalArea() {
        val local = listOf(GeoPoint(-1.0, 0.0), GeoPoint(1.0, 0.0), GeoPoint(1.0, 1.0), GeoPoint(-1.0, 1.0))
        val dateline = local.map { GeoPoint(if (it.longitude < 0) 179.0 else -179.0, it.latitude) }
        val a = NativeMeasurements.area(NativeMeasurements.closeBoundary(local))
        val b = NativeMeasurements.area(NativeMeasurements.closeBoundary(dateline))
        assertEquals(a.area, b.area, 1.0)
        assertEquals(a.perimeter, b.perimeter, .001)
    }
    @Test fun invalidBoundaryIsRejectedInsteadOfSaved() {
        for (input in listOf(
            listOf(GeoPoint(0.0, 0.0), GeoPoint(1.0, 0.0)),
            listOf(GeoPoint(0.0, 0.0), GeoPoint(1.0, 0.0), GeoPoint(2.0, 0.0)),
            listOf(GeoPoint(0.0, 0.0), GeoPoint(2.0, 2.0), GeoPoint(0.0, 2.0), GeoPoint(2.0, 0.0))
        )) assertThrows(IllegalArgumentException::class.java) { NativeMeasurements.closeBoundary(input) }
    }
    @Test fun closedRingDoesNotGainDuplicateEndpoint() {
        val ring = listOf(GeoPoint(0.0, 0.0), GeoPoint(1.0, 0.0), GeoPoint(0.0, 1.0), GeoPoint(0.0, 0.0))
        assertEquals(ring, NativeMeasurements.closeBoundary(ring))
    }
}
