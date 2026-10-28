package com.shantu.nativeapp.map

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NativeGuidanceTest {
    @Test
    fun `stale and inaccurate fixes wait without advancing progress`() {
        val session = NativeGuidance.create(route(), 100_000L)
        val stale = NativeGuidance.advance(session, fix(0.001, 0.0, 70_000L), 100_000L)
        assertEquals("定位已过期，等待更新", stale.quality)
        assertEquals(0.0, stale.progress, 0.0)
        val poor = NativeGuidance.advance(session, fix(0.001, 0.0, 100_000L, accuracy = 51.0), 100_000L)
        assertEquals("定位精度约±51米，等待更准确定位", poor.quality)
    }

    @Test
    fun `implausible gps jump does not replace the last accepted fix`() {
        val session = NativeGuidance.create(route(), 1_000L)
        val first = NativeGuidance.advance(session, fix(0.0, 0.0, 1_000L), 1_000L)
        val jump = NativeGuidance.advance(first, fix(0.01, 0.0, 2_000L), 2_000L)
        assertEquals("定位跳动，等待稳定位置", jump.quality)
        assertEquals(first.last, jump.last)
        assertEquals(first.progress, jump.progress, 0.0)
    }

    @Test
    fun `off route state needs three seconds of fresh fixes`() {
        val session = NativeGuidance.create(route(), 10_000L)
        val first = NativeGuidance.advance(session, fix(0.002, 0.001, 10_000L), 10_000L)
        assertFalse(first.offRoute)
        assertEquals(10_000L, first.offSince)
        val confirmed = NativeGuidance.advance(first, fix(0.002, 0.001, 13_000L), 13_000L)
        assertTrue(confirmed.offRoute)
    }

    @Test
    fun `via checkpoint is matched before route completion`() {
        val session = NativeGuidance.create(route(withVia = true), 20_000L)
        val atVia = NativeGuidance.advance(session, fix(0.005, 0.0, 20_000L), 20_000L)
        assertEquals(1, atVia.nextCheckpoint)
        assertFalse(atVia.arrived)
    }

    @Test
    fun `arrival confirmation needs three seconds and state transitions are immutable`() {
        val session = NativeGuidance.create(route(), 30_000L)
        val atEnd = NativeGuidance.advance(session, fix(0.01, 0.0, 30_000L), 30_000L)
        assertFalse(atEnd.arrived)
        val beforeDeadline = NativeGuidance.advance(atEnd, fix(0.01, 0.0, 32_999L), 32_999L)
        assertFalse(beforeDeadline.arrived)
        val arrived = NativeGuidance.advance(beforeDeadline, fix(0.01, 0.0, 33_000L), 33_000L)
        assertTrue(arrived.arrived)
        assertEquals(arrived.route.path.length, arrived.progress, 0.0)
        assertNotSame(session, atEnd)
        assertEquals(0.0, session.progress, 0.0)
    }

    private fun fix(lon: Double, lat: Double, time: Long, accuracy: Double = 5.0) =
        NativeFix(longitude = lon, latitude = lat, timestamp = time, accuracy = accuracy, source = "gps", provider = "gps")

    private fun route(withVia: Boolean = false) = JSONObject().apply {
        val coordinates = org.json.JSONArray().put(org.json.JSONArray().put(0.0).put(0.0))
        if (withVia) coordinates.put(org.json.JSONArray().put(0.005).put(0.0))
        coordinates.put(org.json.JSONArray().put(0.01).put(0.0))
        put("coordinates", coordinates)
        val snapped = org.json.JSONArray().put(org.json.JSONArray().put(0.0).put(0.0))
        if (withVia) snapped.put(org.json.JSONArray().put(0.005).put(0.0))
        snapped.put(org.json.JSONArray().put(0.01).put(0.0))
        put("snapped", snapped)
        put("mode", "pedestrian")
        put("distance", 1_100.0)
        put("steps", org.json.JSONArray().put(JSONObject().put("distance", 1_100.0)))
        if (withVia) put("stops", org.json.JSONArray()
            .put(JSONObject().put("coordinates", org.json.JSONArray().put(0.0).put(0.0)))
            .put(JSONObject().put("coordinates", org.json.JSONArray().put(0.005).put(0.0)))
            .put(JSONObject().put("coordinates", org.json.JSONArray().put(0.01).put(0.0))))
    }
}
