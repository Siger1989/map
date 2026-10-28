package com.shantu.nativeapp.recording

import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.floor

/** Converts a finished recording snapshot to the legacy ManualTrack JSON shape. */
object RecordedTrackConversion {
    private const val MAX_SEGMENTS = 100
    private const val MAX_POINTS = 6000
    private const val MAX_DATE_MILLIS = 8_640_000_000_000_000.0

    /**
     * Mirrors modules/outdoor/savedRecording.ts: empty segments are discarded, one-point
     * segments survive, and the parallel samples retain each fix's time and altitude.
     */
    @JvmStatic
    fun toManualTrack(snapshot: JSONObject): JSONObject {
        require(snapshot.optString("phase") == "finished") { "请先结束记录再保存" }
        val id = snapshot.opt("id") as? String
        require(!id.isNullOrBlank() && id.length <= 250) { "记录编号无效" }
        val startedAt = exactFiniteNumber(snapshot.opt("startedAt"), "记录开始时间无效")
        require(kotlin.math.abs(startedAt) <= MAX_DATE_MILLIS) { "记录开始时间无效" }
        val rawSegments = snapshot.optJSONArray("segments") ?: invalid("记录分段无效")
        require(rawSegments.length() <= MAX_SEGMENTS) { "记录分段超过上限" }

        val segments = JSONArray()
        val samples = JSONArray()
        var pointCount = 0
        for (segmentIndex in 0 until rawSegments.length()) {
            val rawLine = rawSegments.optJSONArray(segmentIndex) ?: invalid("记录分段无效")
            if (rawLine.length() == 0) continue
            val coordinates = JSONArray()
            val sampleLine = JSONArray()
            for (pointIndex in 0 until rawLine.length()) {
                val fix = rawLine.optJSONObject(pointIndex) ?: invalid("记录点无效")
                val rawCoordinates = fix.optJSONArray("coordinates") ?: invalid("记录坐标无效")
                require(rawCoordinates.length() >= 2) { "记录坐标无效" }
                val longitude = exactFiniteNumber(rawCoordinates.opt(0), "记录坐标无效")
                val latitude = exactFiniteNumber(rawCoordinates.opt(1), "记录坐标无效")
                require(longitude in -180.0..180.0 && latitude in -85.0..85.0) { "记录坐标超出范围" }
                val time = exactFiniteNumber(fix.opt("time"), "记录点时间无效")
                require(kotlin.math.abs(time) <= MAX_DATE_MILLIS) { "记录点时间无效" }
                val altitude: Any = if (fix.isNull("altitude")) JSONObject.NULL
                else exactFiniteNumber(fix.opt("altitude"), "记录点海拔无效")
                coordinates.put(JSONArray(rawCoordinates.toString()))
                sampleLine.put(JSONObject().put("time", time).put("altitude", altitude))
                pointCount++
                require(pointCount <= MAX_POINTS) { "记录点超过上限" }
            }
            // Preserve pause and gap boundaries, including segments containing a single fix.
            segments.put(coordinates)
            samples.put(sampleLine)
        }
        require(pointCount > 0) { "尚无可保存的记录点" }

        val formatter = SimpleDateFormat("yyyy/M/d HH:mm:ss", Locale.CHINA)
        val result = JSONObject()
            .put("id", id)
            .put("name", "实走 ${formatter.format(Date(startedAt.toLong()))}")
            .put("source", "recorded")
            .put("createdAt", startedAt)
            .put("segments", segments)
            .put("samples", samples)
        snapshot.optJSONObject("style")?.let { result.put("style", normalizeStyle(it)) }
        return result
    }

    private fun normalizeStyle(input: JSONObject): JSONObject {
        val pointSize = finiteNumberOrNull(input.opt("pointSize"))
        val opacity = finiteNumberOrNull(input.opt("opacity"))
        val width = finiteNumberOrNull(input.opt("width"))
        val color = input.opt("color") as? String
        val colorMode = input.opt("colorMode") as? String
        val travelMode = input.opt("travelMode") as? String
        return JSONObject()
            .put("color", color?.takeIf { COLOR.matches(it) }?.lowercase(Locale.ROOT) ?: "#ffb477")
            .put("width", width?.coerceIn(0.5, 5.0)?.let { jsRound(it * 2.0) / 2.0 } ?: 1.5)
            .put("opacity", opacity?.coerceIn(0.1, 1.0)?.let { jsRound(it * 100.0) / 100.0 } ?: 1.0)
            .put("travelMode", travelMode?.takeIf { it in TRAVEL_MODES } ?: "walk")
            .apply {
                if (pointSize != null) put("pointSize", pointSize.coerceIn(4.0, 16.0).let(::jsRound))
                if (colorMode in COLOR_MODES) put("colorMode", colorMode)
            }
    }

    private fun exactFiniteNumber(value: Any?, message: String): Double {
        val number = value as? Number ?: invalid(message)
        val result = number.toDouble()
        require(result.isFinite()) { message }
        return result
    }

    private fun finiteNumberOrNull(value: Any?): Double? =
        (value as? Number)?.toDouble()?.takeIf { it.isFinite() }

    private fun jsRound(value: Double): Double = floor(value + 0.5)

    private fun invalid(message: String): Nothing = throw IllegalArgumentException(message)

    private val COLOR = Regex("^#[a-fA-F0-9]{6}$")
    private val COLOR_MODES = setOf("solid", "speed", "slope", "elevation")
    private val TRAVEL_MODES = setOf("walk", "run", "bicycle", "motorcycle", "car")
}
