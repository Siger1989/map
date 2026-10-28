package com.shantu.nativeapp.photos

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.ByteArrayInputStream
import java.time.ZoneId

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NativePhotoTest {
    @Test fun boundedInputAcceptsLimitAndRejectsOverflow() {
        val bytes = ByteArray(32) { it.toByte() }
        assertArrayEquals(bytes, NativePhotoImporter.readBounded(ByteArrayInputStream(bytes), 32))
        assertTrue(runCatching { NativePhotoImporter.readBounded(ByteArrayInputStream(bytes), 31) }.exceptionOrNull() is IllegalArgumentException)
    }

    @Test fun exifAndManualTimeRespectTimezoneAndRejectInvalidValues() {
        val utc = NativePhotoImporter.parseExifTime("2025:03:04 12:30:00", "+08:00")
        val naive = NativePhotoImporter.parseExifTime("2025:03:04 12:30:00", null, ZoneId.of("UTC"))
        assertEquals("2025-03-04T04:30:00Z", java.time.Instant.ofEpochMilli(utc!!).toString())
        assertEquals("2025-03-04T12:30:00Z", java.time.Instant.ofEpochMilli(naive!!).toString())
        assertNull(NativePhotoImporter.parseExifTime("2025:02:30 12:30:00", "+08:00"))
        assertNull(NativePhotoImporter.parseExifTime("2025:03:04 12:30:00", "+15:00"))
        assertNotNull(manualPhotoTime("2025-03-04 12:30:00", ZoneId.of("UTC")))
        assertNull(manualPhotoTime("2025-03-04 12:30", ZoneId.of("UTC")))
    }

    @Test fun matchingNeverCrossesSegmentsOrLongGapsAndRejectsConflicts() {
        val track = NativePhotoTrack("track", "轨迹", listOf(
            listOf(NativePhotoCoordinate(104.0, 30.0), NativePhotoCoordinate(104.001, 30.0)),
            listOf(NativePhotoCoordinate(104.01, 30.0), NativePhotoCoordinate(104.011, 30.0)),
        ), listOf(
            listOf(NativePhotoSample(1_000_000L, 10.0), NativePhotoSample(1_060_000L, 20.0)),
            listOf(NativePhotoSample(1_060_000L), NativePhotoSample(1_120_000L)),
        ))
        // Only the first segment covers this time; the later conflicting boundary does not invalidate it.
        assertEquals("interpolated", NativePhotoMatching.match(track, 1_030_000L)?.kind)
        assertNull(NativePhotoMatching.match(track, 1_060_000L))
        val paused=track.copy(samples=listOf(
            listOf(NativePhotoSample(1_000_000L),NativePhotoSample(1_010_000L)),
            listOf(NativePhotoSample(1_100_000L),NativePhotoSample(1_110_000L))))
        assertNull(NativePhotoMatching.match(paused,1_060_000L))
        val single = track.copy(segments = track.segments.take(1), samples = track.samples.take(1))
        assertEquals("interpolated", NativePhotoMatching.match(single, 1_030_000L)?.kind)
        val gap = single.copy(samples = listOf(listOf(NativePhotoSample(1_000_000L), NativePhotoSample(1_200_001L))))
        assertNull(NativePhotoMatching.match(gap, 1_030_000L))
        val fast = single.copy(segments = listOf(listOf(NativePhotoCoordinate(104.0, 30.0), NativePhotoCoordinate(105.0, 30.0))))
        assertNull(NativePhotoMatching.match(fast, 1_030_000L))
    }

    @Test fun importedImageCreatesBoundedJpegCopiesAndWorkspacePhotoPreservesUnknownFields() {
        val bitmap = Bitmap.createBitmap(1280, 800, Bitmap.Config.ARGB_8888)
        val output = java.io.ByteArrayOutputStream()
        assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)); bitmap.recycle()
        val draft = NativePhotoImporter.decode("sample.png", output.toByteArray())
        assertTrue(draft.previewJpeg.size <= NativePhotoImporter.MAX_PREVIEW_BYTES)
        assertTrue(draft.detailJpeg.size <= NativePhotoImporter.MAX_DETAIL_BYTES)
        assertEquals(0xff, draft.previewJpeg[0].toInt() and 0xff)
        assertEquals(0xd8, draft.previewJpeg[1].toInt() and 0xff)
        val previewBounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(draft.previewJpeg, 0, draft.previewJpeg.size, previewBounds)
        assertTrue(maxOf(previewBounds.outWidth, previewBounds.outHeight) <= 960)
        val detailBounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(draft.detailJpeg, 0, draft.detailJpeg.size, detailBounds)
        assertTrue(maxOf(detailBounds.outWidth, detailBounds.outHeight) <= 2560)
        val previous = JSONObject().put("vendorPhotoExtension", "保留字段").put("title", "旧标题")
        val result = NativePhotoImporter.toWorkspacePhoto(draft, 1_700_000_000_000L, doubleArrayOf(104.0, 30.0), "t", "轨迹", "point", previous = previous)
        assertEquals("保留字段", result.getString("vendorPhotoExtension"))
        assertEquals("旧标题", result.getString("title"))
        assertEquals("image/jpeg", result.getString("mime"))
        assertTrue(result.getString("previewBase64").isNotEmpty())
        assertTrue(result.getString("detailBase64").isNotEmpty())
    }

    @Test fun trackJsonKeepsMissingTimesAndSegmentBoundaries() {
        val json = JSONObject().put("id", "t").put("name", "路线")
            .put("segments", JSONArray().put(JSONArray().put(JSONArray().put(104.0).put(30.0)).put(JSONArray().put(104.001).put(30.0))))
            .put("samples", JSONArray().put(JSONArray().put(JSONObject().put("time", 1000L)).put(JSONObject().put("time", JSONObject.NULL))))
        val track = NativePhotoMatching.fromTrackJson(json)
        assertEquals(1000L, track.samples[0][0]?.time)
        assertNull(track.samples[0][1]?.time)
        assertNull(NativePhotoMatching.match(track, 500L))
    }

    @Test fun annotationAttachmentRequiresExplicitTimeAndUsesAnnotationId() {
        val draft = NativePhotoDraft("abc", "image.jpg", null, null, "no time", null, byteArrayOf(1), byteArrayOf(2))
        assertTrue(runCatching { draft.forAnnotation("marker", "点", doubleArrayOf(104.0, 30.0)) }.isFailure)
        val json = draft.forAnnotation("marker", "点", doubleArrayOf(104.0, 30.0), 1_700_000_000_000L)
        assertEquals("annotation", json.getString("kind"))
        assertEquals("marker", json.getString("annotationId"))
        assertEquals("", json.getString("trackId"))
        assertEquals("manual", json.getString("timeSourceDetail"))
        assertEquals(104.0, json.getJSONArray("coordinates").getDouble(0), 0.0)
    }
}
