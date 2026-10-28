package com.shantu.nativeapp.hybrid

import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NativeBridgeShareBoundsTest {
    @Test fun horizontalBoundsPadOnlyLatitudeForFit() {
        val result = parseNativeShareFitBounds(bounds(-122.4, 37.0, -122.1, 37.0))
        assertEquals(-122.4, result[0], 0.0)
        assertEquals(-122.1, result[2], 0.0)
        assertEquals(37.0, (result[1] + result[3]) / 2.0, 1e-12)
        assertEquals(.000001, result[3] - result[1], 1e-12)
    }

    @Test fun verticalBoundsPadOnlyLongitudeAndPointGetsFiniteFitWindow() {
        val vertical = parseNativeShareFitBounds(bounds(103.0, 30.0, 103.0, 30.2))
        assertEquals(103.0, (vertical[0] + vertical[2]) / 2.0, 1e-12)
        assertEquals(.000001, vertical[2] - vertical[0], 1e-12)
        assertEquals(30.0, vertical[1], 0.0)
        assertEquals(30.2, vertical[3], 0.0)

        val point = parseNativeShareFitBounds(bounds(180.0, 85.0, 180.0, 85.0))
        assertTrue(point[0] < point[2] && point[1] < point[3])
        assertEquals(180.0, point[2], 0.0)
        assertEquals(85.0, point[3], 0.0)
        assertEquals(179.999999, point[0], 1e-12)
        assertEquals(84.999999, point[1], 1e-12)
    }

    @Test fun reversedNonFiniteAndOutOfRangeBoundsRemainInvalid() {
        assertThrows(IllegalArgumentException::class.java) { parseNativeShareFitBounds(bounds(1.0, 0.0, 0.0, 1.0)) }
        assertThrows(IllegalArgumentException::class.java) { parseNativeShareFitBounds(bounds(0.0, 2.0, 1.0, 1.0)) }
        assertThrows(IllegalArgumentException::class.java) { parseNativeShareFitBounds(bounds(-181.0, 0.0, 0.0, 1.0)) }
        assertThrows(IllegalArgumentException::class.java) { parseNativeShareFitBounds(bounds(0.0, -85.1, 1.0, 1.0)) }
        assertThrows(IllegalArgumentException::class.java) {
            parseNativeShareFitBounds(JSONArray().put(JSONArray().put("bad").put(0)).put(JSONArray().put(1).put(1)))
        }
    }

    private fun bounds(west: Double, south: Double, east: Double, north: Double) =
        JSONArray().put(JSONArray().put(west).put(south)).put(JSONArray().put(east).put(north))
}
