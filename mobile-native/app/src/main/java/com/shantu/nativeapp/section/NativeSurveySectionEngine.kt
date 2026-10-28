package com.shantu.nativeapp.section

import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.*
import java.math.BigDecimal

private data class SurveyMercator(val x:Double,val y:Double,val unit:Double)
private fun surveyMercator(lon:Double,lat:Double):SurveyMercator {
    val radians=lat.coerceIn(-85.0,85.0)*PI/180
    return SurveyMercator((lon+180)/360,(1-ln(tan(PI/4+radians/2))/PI)/2,1/(40_075_016.68557849*cos(radians)))
}

data class NativeSurveyStation(val id: String, val label: String, val distanceMeters: Double)
data class NativeSurveyProjection(val longitude: Double, val latitude: Double, val distanceMeters: Double, val offsetMeters: Double)

/** Original SurveyLine v1 contract, with exact Mercator axis/side sign semantics. */
data class NativeSurveyLine(
    val a: Pair<Double, Double>, val b: Pair<Double, Double>, val stations: List<NativeSurveyStation>, val intervalMeters: Int,
    val halfWidthMeters: Double, val sourceJson: JSONObject,
) {
    private val basis by lazy {
        val origin = surveyMercator(a.first, a.second); val end = surveyMercator(b.first, b.second)
        val dx = (end.x - origin.x - round(end.x - origin.x)) / origin.unit
        val dy = (end.y - origin.y) / origin.unit
        val length = hypot(dx, dy)
        require(length.isFinite() && length in 1.0..NativeSurveySectionEngine.MAX_SPAN_METERS) { "A、B 间距须为1米至50公里" }
        Basis(origin, dx / length, dy / length, length)
    }
    fun lengthMeters() = basis.length
    fun range(): Pair<Double, Double> {
        val positions = listOf(0.0, lengthMeters()) + stations.map { it.distanceMeters }
        return positions.minOrNull()!! to positions.maxOrNull()!!
    }
    fun coordinate(distance: Double, offset: Double = 0.0): Pair<Double, Double> {
        val v = basis
        val x = v.origin.x + (v.ux * distance - v.uy * offset) * v.origin.unit
        val y = v.origin.y + (v.uy * distance + v.ux * offset) * v.origin.unit
        val lon = (((x * 360.0 - 180.0 + 180.0) % 360.0 + 360.0) % 360.0) - 180.0
        val lat = atan(sinh(PI * (1.0 - 2.0 * y))) * 180.0 / PI
        return lon to lat
    }
    fun project(longitude: Double, latitude: Double): NativeSurveyProjection {
        val v = basis; val point = surveyMercator(longitude, latitude)
        val dx = (point.x - v.origin.x - round(point.x - v.origin.x)) / v.origin.unit
        val dy = (point.y - v.origin.y) / v.origin.unit
        val distance = dx * v.ux + dy * v.uy
        require(distance.isFinite() && abs(distance) <= NativeSurveySectionEngine.MAX_SPAN_METERS) { "选点距A超过50公里" }
        val coordinate = coordinate(distance)
        return NativeSurveyProjection(coordinate.first, coordinate.second, distance, -dx * v.uy + dy * v.ux)
    }
    fun orderedStations(): List<NativeSurveyStation> = (listOf(NativeSurveyStation("A", "A", 0.0), NativeSurveyStation("B", "B", lengthMeters())) + stations).sortedBy { it.distanceMeters }
    companion object {
        fun parse(json: JSONObject): NativeSurveyLine {
            require(json.optInt("version") == 1) { "勘探线数据版本不受支持" }
            fun coordinate(key: String): Pair<Double, Double> {
                val arr = json.optJSONArray(key) ?: throw IllegalArgumentException("勘探线${key}基准点缺失")
                val lon = arr.optDouble(0, Double.NaN); val lat = arr.optDouble(1, Double.NaN)
                require(lon.isFinite() && lon in -180.0..180.0 && lat.isFinite() && abs(lat) <= 85.0) { "勘探线坐标无效" }
                return lon to lat
            }
            val stationsJson = json.optJSONArray("stations") ?: JSONArray()
            require(stationsJson.length() <= 200) { "勘探线最多200个附加测站" }
            val stations = (0 until stationsJson.length()).map { i ->
                val s = stationsJson.optJSONObject(i) ?: throw IllegalArgumentException("测站数据无效")
                val id = s.optString("id"); val label = s.optString("label"); val distance = s.optDouble("distance", Double.NaN)
                require(id.matches(Regex("^[a-zA-Z0-9-]{1,100}$")) && id !in setOf("A", "B") && label.isNotBlank() && label.length <= 60 && distance.isFinite() && abs(distance) <= NativeSurveySectionEngine.MAX_SPAN_METERS) { "测站数据无效" }
                NativeSurveyStation(id, label, distance)
            }
            require(stations.map { it.id }.distinct().size == stations.size)
            val interval = json.optInt("interval", 50); val width = json.optDouble("halfWidth", Double.NaN)
            require(interval in setOf(1, 2, 5, 10, 20, 25, 50, 100, 200, 500) && width.isFinite() && width in .1..10_000.0) { "勘探线间隔或带宽无效" }
            return NativeSurveyLine(coordinate("a"), coordinate("b"), stations, interval, width, JSONObject(json.toString())).also {
                require(it.range().second - it.range().first <= NativeSurveySectionEngine.MAX_SPAN_METERS) { "测线范围超过50公里" }
            }
        }
    }
    private data class Basis(val origin: SurveyMercator, val ux: Double, val uy: Double, val length: Double)
}

data class NativeSurveyTerrain(
    val line: NativeSurveyLine, val columns: Int, val rows: Int, val startMeters: Double, val endMeters: Double,
    val heightsMeters: List<Double?>, val sampledAtMillis: Long, val zoom: Int, val source: String,
) {
    fun heightAt(distanceMeters: Double): Double? {
        if (!distanceMeters.isFinite() || distanceMeters < startMeters - .001 || distanceMeters > endMeters + .001) return null
        val t = ((distanceMeters - startMeters) / (endMeters - startMeters) * (columns - 1)).coerceIn(0.0, columns - 1.0)
        val x = floor(t).toInt(); val row = (rows / 2) * columns
        val a = heightsMeters[row + x] ?: return null
        val b = heightsMeters[row + min(x + 1, columns - 1)] ?: return null
        return a + (b - a) * (t - x)
    }
    fun toJson(): JSONObject = JSONObject()
        .put("key", NativeSurveySectionEngine.key(line)).put("columns", columns).put("rows", rows)
        .put("start", startMeters).put("end", endMeters).put("halfWidth", line.halfWidthMeters)
        .put("heights", JSONArray().also { out -> heightsMeters.forEach { out.put(it ?: JSONObject.NULL) } })
        .put("sampledAt", sampledAtMillis).put("zoom", zoom).put("source", source)
    companion object {
        fun parse(line: NativeSurveyLine, json: JSONObject): NativeSurveyTerrain {
            val columns = json.optInt("columns", -1); val rows = json.optInt("rows", -1)
            require(columns == NativeSurveySectionEngine.COLUMNS && rows == NativeSurveySectionEngine.ROWS) { "测线高程网格尺寸无效" }
            require(json.optString("key") == NativeSurveySectionEngine.key(line)) { "勘探线已变化，旧高程网格失效" }
            val heights = json.optJSONArray("heights") ?: throw IllegalArgumentException("高程样本缺失")
            require(heights.length() == columns * rows)
            val samples = (0 until heights.length()).map { index ->
                val value = heights.opt(index)
                if (value == JSONObject.NULL) null else (value as? Number)?.toDouble()?.takeIf { it.isFinite() && it in -12_000.0..10_000.0 }
                    ?: throw IllegalArgumentException("高程样本无效")
            }
            val start = json.optDouble("start", Double.NaN); val end = json.optDouble("end", Double.NaN)
            require(start.isFinite() && end.isFinite() && end >= start && json.optDouble("halfWidth") == line.halfWidthMeters)
            val zoom = json.optInt("zoom", -1); require(zoom in 0..12)
            return NativeSurveyTerrain(line, columns, rows, start, end, samples, json.optLong("sampledAt"), zoom, json.optString("source"))
        }
    }
}

object NativeSurveySectionEngine {
    const val COLUMNS = 257
    const val ROWS = 49
    const val MAX_SPAN_METERS = 50_000.0
    /** DEM source API: pass a cache-backed sampler; it is called only for actual lon/lat samples. */
    suspend fun sample(line: NativeSurveyLine, dem: NativeSectionElevationSampler, zoom: Int): NativeSurveyTerrain {
        require(zoom in 0..12)
        val context = currentCoroutineContext(); val range = line.range()
        val count = COLUMNS * ROWS
        val heights = ArrayList<Double?>(count)
        val sources = linkedSetOf<String>()
        for (row in 0 until ROWS) {
            context.ensureActive()
            val offset = -line.halfWidthMeters + row.toDouble() / (ROWS - 1) * line.halfWidthMeters * 2
            for (column in 0 until COLUMNS) {
                if (column % 32 == 0) context.ensureActive()
                val distance = range.first + column.toDouble() / (COLUMNS - 1) * (range.second - range.first)
                val coordinate = line.coordinate(distance, offset)
                val value = if (abs(coordinate.second) <= 85.05112878) dem.sample(coordinate.second, coordinate.first) else null
                val height = value?.elevationMeters?.takeIf { it.isFinite() && it in -12_000.0..10_000.0 }
                heights += height?.let { round(it * 100.0) / 100.0 }
                if (height != null) value?.source?.takeIf(String::isNotBlank)?.let(sources::add)
            }
        }
        require(heights.any { it != null }) { "当前测线范围没有有效DEM高程样本" }
        return NativeSurveyTerrain(line, COLUMNS, ROWS, range.first, range.second, heights,
            System.currentTimeMillis(), zoom, sources.joinToString("；").ifBlank { "DEM采样器未提供来源说明" })
    }

    /** Stable SurveyTerrain key matching JSON.stringify([a,b,start,end,halfWidth]). */
    fun key(line: NativeSurveyLine): String {
        val range = line.range()
        fun n(value: Double) = BigDecimal.valueOf(value).stripTrailingZeros().toPlainString()
        return "[[${n(line.a.first)},${n(line.a.second)}],[${n(line.b.first)},${n(line.b.second)}],${n(range.first)},${n(range.second)},${n(line.halfWidthMeters)}]"
    }

    fun bearingDegrees(line: NativeSurveyLine): Double {
        val a = surveyMercator(line.a.first, line.a.second); val b = surveyMercator(line.b.first, line.b.second)
        val dx = (b.x - a.x - round(b.x - a.x)) / a.unit; val dy = (b.y - a.y) / a.unit
        return ((atan2(dx, -dy) * 180 / PI) + 360) % 360
    }

}
