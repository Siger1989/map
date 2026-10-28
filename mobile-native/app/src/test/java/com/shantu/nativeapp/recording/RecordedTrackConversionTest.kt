package com.shantu.nativeapp.recording

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], manifest = Config.NONE)
class RecordedTrackConversionTest {
    @Test
    fun preservesPauseBoundariesSinglePointSegmentsAndSamples() {
        val snapshot = snapshot(
            JSONArray()
                .put(JSONArray())
                .put(JSONArray().put(fix(116.3, 39.9, 1_700_000_001_000L, 42.5, 123.4)))
                .put(JSONArray())
                .put(JSONArray()
                    .put(fix(116.4, 39.8, 1_700_000_005_000L, null))
                    .put(fix(116.5, 39.7, 1_700_000_006_000L, 100.0)))
                .put(JSONArray().put(fix(116.6, 39.6, 1_700_000_009_000L, 120.0)))
        )

        val track = RecordedTrackConversion.toManualTrack(snapshot)
        assertEquals("record-1", track.getString("id"))
        assertEquals("recorded", track.getString("source"))
        assertEquals(1_700_000_000_000L, track.getLong("createdAt"))
        val segments = track.getJSONArray("segments")
        val samples = track.getJSONArray("samples")
        assertEquals(3, segments.length())
        assertEquals(3, samples.length())
        assertEquals(1, segments.getJSONArray(0).length())
        assertEquals(2, segments.getJSONArray(1).length())
        assertEquals(1, segments.getJSONArray(2).length())
        assertEquals(116.3, segments.getJSONArray(0).getJSONArray(0).getDouble(0), 0.0)
        assertEquals(39.9, segments.getJSONArray(0).getJSONArray(0).getDouble(1), 0.0)
        assertEquals(123.4, segments.getJSONArray(0).getJSONArray(0).getDouble(2), 0.0)
        assertEquals(1_700_000_001_000L, samples.getJSONArray(0).getJSONObject(0).getLong("time"))
        assertEquals(42.5, samples.getJSONArray(0).getJSONObject(0).getDouble("altitude"), 0.0)
        assertTrue(samples.getJSONArray(1).getJSONObject(0).isNull("altitude"))
        assertEquals(100.0, samples.getJSONArray(1).getJSONObject(1).getDouble("altitude"), 0.0)
    }

    @Test
    fun carriesAndNormalizesOptionalStyle() {
        val snapshot = snapshot(JSONArray().put(JSONArray().put(fix(1.0, 2.0, 1_700_000_001_000L, null))))
            .put("style", JSONObject()
                .put("color", "#ABCDEF")
                .put("width", 1.25)
                .put("pointSize", 4.5)
                .put("opacity", 0.125)
                .put("travelMode", "bicycle")
                .put("colorMode", "slope"))

        val style = RecordedTrackConversion.toManualTrack(snapshot).getJSONObject("style")
        assertEquals("#abcdef", style.getString("color"))
        assertEquals(1.5, style.getDouble("width"), 0.0)
        assertEquals(5, style.getInt("pointSize"))
        assertEquals(0.13, style.getDouble("opacity"), 0.000001)
        assertEquals("bicycle", style.getString("travelMode"))
        assertEquals("slope", style.getString("colorMode"))
        assertFalse(RecordedTrackConversion.toManualTrack(snapshot(
            JSONArray().put(JSONArray().put(fix(1.0, 2.0, 1_700_000_001_000L, null)))
        )).has("style"))
    }

    @Test
    fun acceptsOnlyFinishedRecordingsAndRejectsNoPointsOrInvalidCoordinates() {
        for (phase in listOf("idle", "recording", "paused")) {
            val error = runCatching { RecordedTrackConversion.toManualTrack(snapshot(JSONArray(), phase)) }.exceptionOrNull()
            assertTrue("phase $phase should be rejected", error is IllegalArgumentException)
        }
        assertTrue(runCatching {
            RecordedTrackConversion.toManualTrack(snapshot(JSONArray().put(JSONArray())))
        }.exceptionOrNull() is IllegalArgumentException)
        assertTrue(runCatching {
            RecordedTrackConversion.toManualTrack(snapshot(JSONArray().put(JSONArray().put(fix(181.0, 0.0, 1L, null)))))
        }.exceptionOrNull() is IllegalArgumentException)
    }

    private fun snapshot(segments: JSONArray = JSONArray(), phase: String = "finished") = JSONObject()
        .put("id", "record-1")
        .put("phase", phase)
        .put("startedAt", 1_700_000_000_000L)
        .put("segments", segments)

    private fun fix(longitude: Double, latitude: Double, time: Long, altitude: Double?, trailingOrdinate: Double? = null) = JSONObject()
        .put("coordinates", JSONArray().put(longitude).put(latitude).apply { trailingOrdinate?.let(::put) })
        .put("time", time)
        .put("accuracy", 5)
        .put("altitude", altitude ?: JSONObject.NULL)
}
