package com.shantu.nativeapp.navigation

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NativeRouteDisplayTest {
    @Test fun averageSpeedRequiresMeasuredGpsDistanceAndActiveFixTime() {
        assertNull(nativeAverageSpeedKmh(0.0, 10_000))
        assertNull(nativeAverageSpeedKmh(100.0, 999))
        assertEquals(36.0, nativeAverageSpeedKmh(100.0, 10_000)!!, 1e-8)
    }
    @Test fun displayModesUseOnlyMeasuredValuesAndKeepSegmentBreaks() {
        val track = JSONObject()
            .put("segments", JSONArray()
                .put(JSONArray().put(JSONArray().put(104.0).put(30.0)).put(JSONArray().put(104.0002).put(30.0)).put(JSONArray().put(104.0004).put(30.0)))
                .put(JSONArray().put(JSONArray().put(104.01).put(30.0)).put(JSONArray().put(104.011).put(30.0))))
            .put("samples", JSONArray()
                .put(JSONArray().put(JSONObject().put("time", 1000).put("altitude", 20)).put(JSONObject().put("time", 2000).put("altitude", 30)).put(JSONObject().put("time", 3000)))
                .put(JSONArray().put(JSONObject().put("altitude", 100)).put(JSONObject().put("altitude", 120))))
        val elevation = NativeRouteDisplay.build(track, NativeRouteColorMode.ELEVATION)
        assertEquals(2, elevation.segments.size)
        assertEquals(20.0, elevation.minimumElevation!!, 0.0)
        assertEquals(120.0, elevation.maximumElevation!!, 0.0)
        assertNull("Missing altitude never becomes zero", elevation.elevation[0][2])
        assertNull(elevation.segments[0][1].value)
        val speed = NativeRouteDisplay.build(track, NativeRouteColorMode.SPEED)
        assertTrue(speed.maximumSpeedKmh!! > 0)
        assertNull("Missing timestamps do not yield synthetic speed", speed.segments[1][0].value)
        val slope = NativeRouteDisplay.build(track, NativeRouteColorMode.SLOPE)
        assertNotNull(slope.segments[0][0].value)
        assertNull(slope.segments[1][0].value)
    }

    @Test fun altitudeFallsBackToThirdCoordinateWhenSamplesAreAbsentOrMissing() {
        val track=JSONObject().put("segments",JSONArray().put(JSONArray()
            .put(JSONArray().put(104.0).put(30.0).put(18.5))
            .put(JSONArray().put(104.0001).put(30.0).put(25.0))))
        val data=NativeRouteDisplay.build(track,NativeRouteColorMode.ELEVATION)
        assertEquals(18.5,data.elevation[0][0]!!,0.0)
        assertEquals(25.0,data.elevation[0][1]!!,0.0)
    }

    @Test fun coordinateAltitudeIsUsedWhenSampleDoesNotContainAValidAltitude() {
        val track=JSONObject().put("segments",JSONArray().put(JSONArray()
            .put(JSONArray().put(104.0).put(30.0).put(40.0)).put(JSONArray().put(104.0001).put(30.0))))
            .put("samples",JSONArray().put(JSONArray().put(JSONObject().put("time",1000)).put(JSONObject().put("time",2000).put("altitude",JSONObject.NULL))))
        val data=NativeRouteDisplay.build(track)
        assertEquals(40.0,data.elevation[0][0]!!,0.0)
        assertNull(data.elevation[0][1])
    }

    @Test fun steepMarkersUseMeasuredSlopeAndKeepSegmentBoundaries() {
        val track=JSONObject().put("segments",JSONArray()
            .put(JSONArray().put(JSONArray().put(104.0).put(30.0).put(0)).put(JSONArray().put(104.001).put(30.0).put(30)))
            .put(JSONArray().put(JSONArray().put(104.01).put(30.0).put(0)).put(JSONArray().put(104.011).put(30.0).put(2))))
        val result=NativeRouteDisplay.build(track)
        assertEquals(1,result.steepWarnings.size)
        assertTrue(result.steepWarnings.single().gradePercent>20)
    }
}
