package com.shantu.nativeapp.photos

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.*

data class NativePhotoCoordinate(val lon: Double, val lat: Double) {
    fun valid() = lon.isFinite() && lat.isFinite() && lon in -180.0..180.0 && lat in -90.0..90.0
}
data class NativePhotoSample(val time: Long?, val altitude: Double? = null)
data class NativePhotoTrack(val id: String, val name: String, val segments: List<List<NativePhotoCoordinate>>, val samples: List<List<NativePhotoSample?>>)
data class NativePhotoMatch(val coordinate: NativePhotoCoordinate, val kind: String, val altitude: Double?, val altitudeSource: String?)

object NativePhotoMatching {
    fun match(track: NativePhotoTrack, time: Long?): NativePhotoMatch? {
        if (time == null || time <= 0) return null
        val matches = mutableListOf<NativePhotoMatch>()
        for (segmentIndex in track.segments.indices) {
            val line = track.segments[segmentIndex]
            val samples = track.samples.getOrNull(segmentIndex) ?: continue
            for (i in line.indices) {
                val point = line[i]
                if (!point.valid()) continue
                val current = samples.getOrNull(i) ?: continue
                val t = current.time ?: continue
                if (t == time) {
                    matches += NativePhotoMatch(point, "point", current.altitude?.takeIf(::validAltitude), current.altitude?.takeIf(::validAltitude)?.let { "track" })
                }
                val nextTime = samples.getOrNull(i + 1)?.time ?: continue
                val end = line.getOrNull(i + 1) ?: continue
                if (!end.valid() || nextTime <= t || nextTime - t > 120_000L || time <= t || time >= nextTime) continue
                val seconds = (nextTime - t) / 1000.0
                if (distanceMeters(point, end) / seconds > 80.0) continue
                val f = (time - t).toDouble() / (nextTime - t)
                val delta = ((end.lon - point.lon + 540.0) % 360.0) - 180.0
                val lon = ((point.lon + delta * f + 540.0) % 360.0) - 180.0
                val alt1 = current.altitude?.takeIf(::validAltitude)
                val alt2 = samples.getOrNull(i + 1)?.altitude?.takeIf(::validAltitude)
                matches += NativePhotoMatch(
                    NativePhotoCoordinate(lon, point.lat + (end.lat - point.lat) * f), "interpolated",
                    if (alt1 != null && alt2 != null) alt1 + (alt2 - alt1) * f else null,
                    if (alt1 != null && alt2 != null) "interpolated" else null,
                )
            }
        }
        if (matches.isEmpty()) return null
        val first = matches.first()
        if (matches.any { distanceMeters(it.coordinate, first.coordinate) > 1.0 }) return null
        return first
    }

    /** Timestamp/coordinate arrays are aligned by segment and vertex; missing values stay null. */
    fun fromTrackJson(track: JSONObject): NativePhotoTrack {
        val segmentsJson = track.optJSONArray("segments") ?: JSONArray()
        val sampleJson = track.optJSONArray("samples") ?: JSONArray()
        val segments = mutableListOf<List<NativePhotoCoordinate>>()
        val samples = mutableListOf<List<NativePhotoSample?>>()
        for (s in 0 until segmentsJson.length()) {
            val line = segmentsJson.optJSONArray(s) ?: JSONArray()
            val coords = mutableListOf<NativePhotoCoordinate>()
            for (i in 0 until line.length()) {
                val c = line.optJSONArray(i) ?: JSONArray()
                coords += NativePhotoCoordinate(c.optDouble(0, Double.NaN), c.optDouble(1, Double.NaN))
            }
            segments += coords
            val row = sampleJson.optJSONArray(s) ?: JSONArray()
            samples += (0 until row.length()).map { i ->
                val sample = row.optJSONObject(i) ?: return@map null
                NativePhotoSample(sample.optLong("time", Long.MIN_VALUE).takeIf { sample.has("time") && !sample.isNull("time") && it != Long.MIN_VALUE }, sample.optDouble("altitude", Double.NaN).takeIf { sample.has("altitude") && !sample.isNull("altitude") })
            }
        }
        return NativePhotoTrack(track.optString("id"), track.optString("name"), segments, samples)
    }

    fun distanceMeters(a: NativePhotoCoordinate, b: NativePhotoCoordinate): Double {
        val lat1 = Math.toRadians(a.lat); val lat2 = Math.toRadians(b.lat)
        val dLat = lat2 - lat1
        val dLon = Math.toRadians(((b.lon - a.lon + 540.0) % 360.0) - 180.0)
        val h = sin(dLat / 2).pow(2) + cos(lat1) * cos(lat2) * sin(dLon / 2).pow(2)
        return 6_371_000.0 * 2 * asin(sqrt(h.coerceIn(0.0, 1.0)))
    }
    private fun validAltitude(value: Double) = value.isFinite() && value in -12_000.0..100_000.0
}

/** Attachment IDs stay tied to one annotation; capture time is supplied explicitly if EXIF lacks it. */
fun NativePhotoDraft.forAnnotation(annotationId: String, annotationName: String, coordinates: DoubleArray, captureTime: Long? = time): JSONObject {
    require(annotationId.isNotBlank() && annotationId.length <= 100) { "标记编号无效" }
    require(captureTime != null && captureTime > 0) { "照片没有EXIF拍摄时间，请确认并填写拍摄时间" }
    val entity = NativePhotoImporter.toWorkspacePhoto(this, captureTime, coordinates, annotationId, annotationName.ifBlank { "标记点" }, "annotation")
        .put("title", annotationName.ifBlank { "标记照片" })
    if (time == null) entity.put("timeSourceDetail", "manual")
    return entity
}
