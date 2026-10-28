package com.shantu.nativeapp.navigation

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.*

enum class NativeRouteColorMode { SOLID, ELEVATION, SPEED, SLOPE }
data class NativeRouteEdgeDisplay(val from: NativeCoordinate, val to: NativeCoordinate, val value: Double?, val color: Int)
data class NativeRouteWarning(val coordinate: NativeCoordinate, val gradePercent:Double, val label:String)
data class NativeRouteDisplayData(
    val mode: NativeRouteColorMode,
    val segments: List<List<NativeRouteEdgeDisplay>>,
    val distanceMeters: Double,
    val maximumSpeedKmh: Double?,
    val maximumAbsoluteSlopePercent: Double?,
    val elevation: List<List<Double?>>,
    val minimumElevation: Double?,
    val maximumElevation: Double?,
    val legend: List<Pair<String, Int>>,
    val steepWarnings: List<NativeRouteWarning>,
)

/** Pure route display projection for map overlay adapters; source geometry and null gaps are retained. */
object NativeRouteDisplay {
    private val elevationRamp = intArrayOf(0xff267bd2.toInt(), 0xff20a879.toInt(), 0xffd6ce39.toInt(), 0xffee8a32.toInt(), 0xffd84240.toInt())
    private val speedRamp = intArrayOf(0xff2878bd.toInt(), 0xff35a66f.toInt(), 0xffd2bd34.toInt(), 0xffe17a32.toInt(), 0xffc83c3c.toInt())
    private val missing = 0xff89918d.toInt()

    fun build(track: JSONObject, mode: NativeRouteColorMode = NativeRouteColorMode.SOLID): NativeRouteDisplayData {
        val geometry = track.optJSONArray("segments") ?: JSONArray()
        val samples = track.optJSONArray("samples")
        val solidColor = track.optJSONObject("style")?.optString("color")?.let(::parseColor) ?: 0xffffb477.toInt()
        val heights = mutableListOf<List<Double?>>()
        val edges = mutableListOf<List<Triple<NativeCoordinate, NativeCoordinate, EdgeMetrics>>>()
        val warnings=mutableListOf<NativeRouteWarning>()
        var distance = 0.0
        var maxSpeed: Double? = null
        var maxSlope: Double? = null
        for (s in 0 until geometry.length()) {
            val item = geometry.opt(s)
            val line = (item as? JSONArray) ?: (item as? JSONObject)?.optJSONArray("coordinates") ?: JSONArray()
            val sampleLine = samples?.optJSONArray(s)
            val coords = (0 until line.length()).mapNotNull { parse(line.optJSONArray(it)) }
            val elevations = coords.indices.map { i ->
                val sampled = sampleLine?.optJSONObject(i)?.optDouble("altitude", Double.NaN)?.takeIf { it.isFinite() }
                sampled ?: line.optJSONArray(i)?.let { raw ->
                    if (raw.length() > 2) raw.optDouble(2, Double.NaN).takeIf { it.isFinite() } else null
                }
            }
            heights += elevations
            val lengths = (0 until (coords.size - 1).coerceAtLeast(0)).map { distance(coords[it], coords[it + 1]) }
            val chainage = DoubleArray(coords.size)
            lengths.forEachIndexed { index, length -> chainage[index + 1] = chainage[index] + length }
            val slopes = MutableList<Double?>(lengths.size) { null }
            var anchor = 0
            for (i in lengths.indices) {
                if (elevations.getOrNull(i) == null || elevations.getOrNull(i + 1) == null) { anchor = i + 1; continue }
                val span = chainage[i + 1] - chainage[anchor]
                if (span >= 10.0) {
                    val grade = ((elevations[i + 1]!! - elevations[anchor]!!) / span * 100.0).takeIf { it.isFinite() && abs(it) <= 100.0 }
                    for (edge in anchor..i) slopes[edge] = grade
                    anchor = i + 1
                }
            }
            val metricEdges = mutableListOf<Triple<NativeCoordinate, NativeCoordinate, EdgeMetrics>>()
            for (i in 0 until coords.lastIndex) {
                val length = lengths[i]; distance += length
                val a = sampleLine?.optJSONObject(i); val b = sampleLine?.optJSONObject(i + 1)
                val seconds = if (a != null && b != null && a.has("time") && b.has("time")) (b.optDouble("time", Double.NaN) - a.optDouble("time", Double.NaN)) / 1000.0 else Double.NaN
                val speed = (length / seconds * 3.6).takeIf { seconds in 0.1..7200.0 && it.isFinite() && it <= 180.0 }
                val h0 = elevations.getOrNull(i); val h1 = elevations.getOrNull(i + 1)
                val slope = slopes[i]
                maxSpeed = speed?.let { max(maxSpeed ?: it, it) } ?: maxSpeed
                maxSlope = slope?.let { max(maxSlope ?: abs(it), abs(it)) } ?: maxSlope
                metricEdges += Triple(coords[i], coords[i + 1], EdgeMetrics(if (h0 != null && h1 != null) (h0 + h1) / 2 else null, speed, slope))
            }
            warnings += steepWarnings(coords,metricEdges)
            edges += metricEdges
        }
        val allHeights = heights.flatten().filterNotNull()
        val hMin = allHeights.minOrNull(); val hMax = allHeights.maxOrNull()
        val allSpeeds = edges.flatten().mapNotNull { it.third.speed }
        val sMax = allSpeeds.maxOrNull()?.coerceAtLeast(1.0) ?: 1.0
        val legend = when (mode) {
            NativeRouteColorMode.ELEVATION -> listOf("低" to elevationRamp.first(), "中" to elevationRamp[2], "高" to elevationRamp.last(), "缺高程" to missing)
            NativeRouteColorMode.SPEED -> listOf("慢" to speedRamp.first(), "中" to speedRamp[2], "快" to speedRamp.last(), "缺速度" to missing)
            NativeRouteColorMode.SLOPE -> listOf("缓坡" to 0xff35a66f.toInt(), "陡坡" to 0xffd84240.toInt(), "缺坡度" to missing)
            else -> listOf("原色" to solidColor)
        }
        val display = edges.map { line -> line.map { (a, b, m) ->
            val value = when (mode) { NativeRouteColorMode.ELEVATION -> m.elevation; NativeRouteColorMode.SPEED -> m.speed; NativeRouteColorMode.SLOPE -> m.slope; NativeRouteColorMode.SOLID -> null }
            NativeRouteEdgeDisplay(a, b, value, color(mode, value, hMin, hMax, sMax, solidColor))
        } }
        return NativeRouteDisplayData(mode, display, distance, maxSpeed, maxSlope, heights, hMin, hMax, legend, warnings)
    }

    private data class EdgeMetrics(val elevation: Double?, val speed: Double?, val slope: Double?)
    private fun steepWarnings(coords:List<NativeCoordinate>,edges:List<Triple<NativeCoordinate,NativeCoordinate,EdgeMetrics>>):List<NativeRouteWarning> {
        val out=mutableListOf<NativeRouteWarning>(); var run=mutableListOf<Triple<NativeCoordinate,NativeCoordinate,EdgeMetrics>>()
        fun emit() {
            if(run.isEmpty()) return
            val runLength=run.sumOf { distance(it.first,it.second) }; val spacing=max(200.0,runLength/512.0)
            var filled=0.0; var peak:Triple<NativeCoordinate,NativeCoordinate,EdgeMetrics>?=null
            fun flush() {
                peak?.let { e -> val grade=e.third.slope!!; out+=NativeRouteWarning(interpolate(e.first,e.second,.5),grade,"${if(grade>0)"陡上" else "陡下"} ${"%.1f%%".format(abs(grade))}") }
                filled=0.0; peak=null
            }
            for(edge in run) {
                val length=distance(edge.first,edge.second); var offset=0.0
                while(offset<length-1e-6) {
                    val span=min(spacing-filled,length-offset)
                    if(peak==null || abs(edge.third.slope!!)>abs(peak!!.third.slope!!)) peak=edge
                    filled+=span;offset+=span
                    if(filled>=spacing-1e-6) flush()
                }
            }
            flush();run=mutableListOf()
        }
        edges.forEach { edge ->
            val grade=edge.third.slope
            if(grade==null || abs(grade)<20.0) { emit(); return@forEach }
            val prior=run.lastOrNull()?.third?.slope
            if(prior!=null && prior*grade<0) emit()
            run+=edge
        }
        emit(); return out
    }
    private fun interpolate(a:NativeCoordinate,b:NativeCoordinate,t:Double):NativeCoordinate {
        val dLon=((b.longitude-a.longitude+540)%360)-180
        return NativeCoordinate(((a.longitude+dLon*t+540)%360)-180,a.latitude+(b.latitude-a.latitude)*t)
    }
    private fun color(mode: NativeRouteColorMode, value: Double?, min: Double?, max: Double?, speedMax: Double, solidColor: Int): Int {
        if (value == null) return if (mode == NativeRouteColorMode.SOLID) solidColor else missing
        return when (mode) {
            NativeRouteColorMode.ELEVATION -> ramp(elevationRamp, if (min == null || max == null || min == max) .5 else (value - min) / (max - min))
            NativeRouteColorMode.SPEED -> ramp(speedRamp, value / speedMax)
            NativeRouteColorMode.SLOPE -> when { abs(value) >= 12 -> 0xffd84240.toInt(); abs(value) >= 6 -> 0xffee8a32.toInt(); else -> 0xff35a66f.toInt() }
            NativeRouteColorMode.SOLID -> solidColor
        }
    }
    private fun ramp(colors: IntArray, value: Double): Int {
        val p = value.coerceIn(0.0, 1.0) * (colors.size - 1); val i = p.toInt().coerceAtMost(colors.lastIndex - 1); val t = p - i
        fun channel(shift: Int) = ((((colors[i] ushr shift) and 255) * (1 - t) + ((colors[i + 1] ushr shift) and 255) * t).roundToInt()).coerceIn(0, 255)
        return (0xff shl 24) or (channel(16) shl 16) or (channel(8) shl 8) or channel(0)
    }
    private fun parse(array: JSONArray?): NativeCoordinate? {
        if (array == null || array.length() < 2) return null
        val lon = array.optDouble(0, Double.NaN); val lat = array.optDouble(1, Double.NaN)
        return NativeCoordinate(lon, lat).takeIf { lon.isFinite() && lat.isFinite() }
    }
    private fun parseColor(value: String): Int? = runCatching {
        require(value.matches(Regex("^#[0-9a-fA-F]{6}$")))
        (0xff000000L or value.substring(1).toLong(16)).toInt()
    }.getOrNull()
    private fun distance(a: NativeCoordinate, b: NativeCoordinate): Double {
        val rad = Math.PI / 180; val dLat = (b.latitude - a.latitude) * rad; val dLon = (b.longitude - a.longitude) * rad
        val h = sin(dLat / 2).pow(2) + cos(a.latitude * rad) * cos(b.latitude * rad) * sin(dLon / 2).pow(2)
        return 6_371_008.8 * 2 * asin(sqrt(h.coerceIn(0.0, 1.0)))
    }
}
