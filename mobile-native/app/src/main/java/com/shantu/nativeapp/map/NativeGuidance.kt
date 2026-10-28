package com.shantu.nativeapp.map

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

/** Device position consumed by the pure guidance state machine. Coordinates are WGS84 lon/lat. */
data class NativeFix(
    val longitude: Double,
    val latitude: Double,
    val timestamp: Long,
    val accuracy: Double,
    val speed: Double? = null,
    val heading: Double? = null,
    val source: String? = null,
    val provider: String? = null,
)

private val NativeFix.coordinate: Pair<Double, Double>
    get() = longitude to latitude

data class NativeGuidanceProjection(val point: Pair<Double, Double>, val distance: Double, val offset: Double)

data class NativeGuidanceState internal constructor(
    val route: NativeGuidanceRoute,
    val startedAt: Long,
    val travelled: Double,
    val progress: Double,
    val offset: Double,
    val last: NativeFix?,
    val anchor: NativeFix?,
    val quality: String,
    val qualityFromLocationError: Boolean,
    val gap: Boolean,
    val offRoute: Boolean,
    val offSince: Long?,
    val arriveSince: Long?,
    val arrived: Boolean,
    val nextCheckpoint: Int,
)

data class NativeGuidanceRoute internal constructor(
    val coordinates: List<Pair<Double, Double>>,
    val snapped: List<Pair<Double, Double>>,
    val stops: List<Pair<Double, Double>>,
    val accessDistance: Double?,
    val mode: String,
    val declaredDistance: Double,
    val stepDistances: List<Double>,
) {
    internal val path: NativeGuidancePath = NativeGuidancePath.create(coordinates)
    internal val checkpoints: List<NativeGuidanceProjection> = run {
        val points = if (accessDistance != null && stops.isNotEmpty()) stops else snapped
        var floor = 0.0
        points.drop(1).dropLast(1).map { point ->
            val hit = NativeGuidancePath.project(path, point, floor)
            floor = hit.distance
            hit
        }
    }
}

/** Port of modules/guidance/session.ts and geometry.ts without Android or mutable UI dependencies. */
object NativeGuidance {
    fun create(routeJson: JSONObject, nowMillis: Long): NativeGuidanceState {
        val route = NativeGuidanceRoute(
            coordinates = readCoordinates(routeJson.optJSONArray("coordinates"), "路线坐标"),
            snapped = readCoordinates(routeJson.optJSONArray("snapped") ?: JSONArray(), "吸附点"),
            stops = readStopCoordinates(routeJson.optJSONArray("stops")),
            accessDistance = routeJson.optDouble("accessDistance").takeIf { routeJson.has("accessDistance") && it.isFinite() },
            mode = routeJson.optString("mode", "pedestrian").takeIf { it in setOf("auto", "bicycle", "pedestrian") }
                ?: throw IllegalArgumentException("路线出行方式无效"),
            declaredDistance = routeJson.optDouble("distance", 0.0).takeIf { it.isFinite() } ?: 0.0,
            stepDistances = readStepDistances(routeJson.optJSONArray("steps")),
        )
        require(route.path.length >= 20.0) { "路线太短，请重新规划。" }
        return NativeGuidanceState(
            route = route,
            startedAt = nowMillis,
            travelled = 0.0,
            progress = 0.0,
            offset = 0.0,
            last = null,
            anchor = null,
            quality = "等待当前位置…",
            qualityFromLocationError = false,
            gap = false,
            offRoute = false,
            offSince = null,
            arriveSince = null,
            arrived = false,
            nextCheckpoint = 0,
        )
    }

    fun advance(state: NativeGuidanceState, fix: NativeFix?, nowMillis: Long, error: String = ""): NativeGuidanceState {
        if (state.arrived) return state
        var quality = error
        if (quality.isEmpty() && !freshFix(fix, nowMillis)) {
            quality = when {
                fix == null -> "等待当前位置…"
                fix.accuracy > 50 -> "定位精度约±${fix.accuracy.roundToInt()}米，等待更准确定位"
                else -> "定位已过期，等待更新"
            }
        }
        if (quality.isNotEmpty()) return state.copy(
            quality = quality,
            qualityFromLocationError = error.isNotEmpty(),
            anchor = null,
            offSince = null,
            arriveSince = null,
            gap = state.gap || state.last != null,
        )
        if (fix == null) return state
        val last = state.last
        if (last != null && fix.timestamp <= last.timestamp) {
            if (state.qualityFromLocationError && fix.timestamp == last.timestamp &&
                fix.longitude == last.longitude && fix.latitude == last.latitude && freshFix(fix, nowMillis))
                return state.copy(quality = "", qualityFromLocationError = false)
            return state
        }

        val elapsed = if (last != null) (fix.timestamp - last.timestamp) / 1000.0 else 0.0
        val movement = if (last != null) distance(last.coordinate, fix.coordinate) else 0.0
        val speedLimit = when (state.route.mode) { "pedestrian" -> 12.0; "bicycle" -> 30.0; else -> 80.0 }
        if (last != null && elapsed <= 30.0 && movement > speedLimit * elapsed + last.accuracy + fix.accuracy)
            return state.copy(
                quality = "定位跳动，等待稳定位置",
                qualityFromLocationError = false,
                anchor = null,
                offSince = null,
                arriveSince = null,
            )

        val gap = last != null && elapsed > 30.0
        var travelled = state.travelled
        var anchor = state.anchor
        if (anchor == null || gap) anchor = fix else {
            val movedFromAnchor = distance(anchor.coordinate, fix.coordinate)
            if (movedFromAnchor >= max(5.0, (anchor.accuracy + fix.accuracy) * 0.5)) {
                travelled += movedFromAnchor
                anchor = fix
            }
        }

        val window = max(100.0, movement * 3.0 + 50.0)
        val maxDistance = checkpointLimit(state)
        val minDistance = max(checkpointFloor(state), state.progress - if (state.offRoute) 30.0 else window)
        val maxMatch = if (last != null && !gap && !state.offRoute) min(maxDistance, state.progress + window) else maxDistance
        val hit = NativeGuidancePath.project(state.route.path, fix.coordinate, minDistance, maxMatch, state.progress)
        val far = hit.offset > max(35.0, fix.accuracy * 2.0 + 10.0)
        val close = hit.offset <= max(20.0, fix.accuracy + 5.0)
        val offSince = if (far) state.offSince ?: fix.timestamp else null
        val offRoute = when {
            close -> false
            far && offSince != null && fix.timestamp - offSince >= 3000L -> true
            else -> state.offRoute
        }
        var progress = state.progress
        var nextCheckpoint = state.nextCheckpoint
        if (!far && !offRoute) {
            progress = hit.distance
            val next = state.route.checkpoints.getOrNull(nextCheckpoint)
            if (next != null && abs(progress - next.distance) <= 35.0 &&
                distance(fix.coordinate, next.point) <= max(20.0, min(35.0, fix.accuracy))) nextCheckpoint++
        }
        val atEnd = !offRoute && !far && nextCheckpoint == state.route.checkpoints.size &&
            state.route.path.length - progress <= 30.0 &&
            distance(fix.coordinate, state.route.path.points.last()) <= max(20.0, min(30.0, fix.accuracy))
        val arriveSince = if (atEnd) state.arriveSince ?: fix.timestamp else null
        val arrived = arriveSince != null && fix.timestamp - arriveSince >= 3000L
        return state.copy(
            travelled = travelled,
            progress = if (arrived) state.route.path.length else progress,
            offset = hit.offset,
            last = fix,
            anchor = anchor,
            quality = "",
            qualityFromLocationError = false,
            gap = state.gap || gap,
            offRoute = offRoute,
            offSince = offSince,
            arriveSince = arriveSince,
            arrived = arrived,
            nextCheckpoint = nextCheckpoint,
        )
    }

    fun freshFix(fix: NativeFix?, nowMillis: Long): Boolean = fix != null &&
        validCoordinate(fix.coordinate) &&
        nowMillis - fix.timestamp <= 20_000L && fix.timestamp <= nowMillis + 5_000L &&
        fix.accuracy.isFinite() && fix.accuracy in 0.0..50.0

    private fun checkpointLimit(state: NativeGuidanceState) =
        state.route.checkpoints.getOrNull(state.nextCheckpoint)?.distance ?: state.route.path.length

    private fun checkpointFloor(state: NativeGuidanceState) =
        if (state.nextCheckpoint > 0) state.route.checkpoints[state.nextCheckpoint - 1].distance else 0.0

    private fun readCoordinates(array: JSONArray?, label: String): List<Pair<Double, Double>> {
        require(array != null && array.length() >= 2) { "$label 无效" }
        return (0 until array.length()).map { index ->
            val point = array.optJSONArray(index) ?: throw IllegalArgumentException("$label 无效")
            require(point.length() >= 2)
            val lon = point.optDouble(0, Double.NaN)
            val lat = point.optDouble(1, Double.NaN)
            val coordinate = lon to lat
            require(validCoordinate(coordinate)) { "$label 无效" }
            coordinate
        }.toList()
    }

    private fun readStopCoordinates(array: JSONArray?): List<Pair<Double, Double>> = if (array == null) emptyList() else
        (0 until array.length()).map { index ->
            val point = array.optJSONObject(index)?.optJSONArray("coordinates") ?: throw IllegalArgumentException("途经点坐标无效")
            require(point.length() >= 2)
            (point.optDouble(0, Double.NaN) to point.optDouble(1, Double.NaN)).also {
                require(validCoordinate(it)) { "途经点坐标无效" }
            }
        }

    private fun readStepDistances(array: JSONArray?): List<Double> = if (array == null) emptyList() else
        (0 until array.length()).mapNotNull { array.optJSONObject(it)?.optDouble("distance")?.takeIf { value -> value.isFinite() && value >= 0.0 } }

    private fun validCoordinate(value: Pair<Double, Double>) = value.first.isFinite() && abs(value.first) <= 180.0 &&
        value.second.isFinite() && abs(value.second) <= 85.0

}

internal data class NativeGuidancePath(
    val points: List<Pair<Double, Double>>,
    val cumulative: List<Double>,
    val length: Double,
) {
    companion object {
        fun create(points: List<Pair<Double, Double>>): NativeGuidancePath {
            require(points.size >= 2 && points.all { point -> point.first.isFinite() && abs(point.first) <= 180.0 && point.second.isFinite() && abs(point.second) <= 85.0 })
            val cumulative = mutableListOf(0.0)
            for (index in 1 until points.size) cumulative += cumulative.last() + distance(points[index - 1], points[index])
            return NativeGuidancePath(points.toList(), cumulative.toList(), cumulative.last())
        }

        fun project(path: NativeGuidancePath, point: Pair<Double, Double>, minDistance: Double = 0.0,
                    maxDistance: Double = path.length, preferred: Double = minDistance): NativeGuidanceProjection {
            var best = NativeGuidanceProjection(path.points.first(), 0.0, Double.POSITIVE_INFINITY)
            for (index in 1 until path.points.size) {
                val from = path.cumulative[index - 1]
                val to = path.cumulative[index]
                val length = to - from
                if (to < minDistance || from > maxDistance || length <= 0.0) continue
                val a = path.points[index - 1]
                val b = path.points[index]
                val scale = 111_320.0 * cos(Math.toRadians(point.second))
                val dx = longitudeDelta(a.first, b.first) * scale
                val dy = (b.second - a.second) * 111_320.0
                val px = longitudeDelta(a.first, point.first) * scale
                val py = (point.second - a.second) * 111_320.0
                val denominator = dx * dx + dy * dy
                val projection = (dx * px + dy * py) / if (denominator == 0.0) 1.0 else denominator
                val t = max(max(0.0, (minDistance - from) / length), min(min(1.0, (maxDistance - from) / length), projection))
                val hitPoint = interpolate(a, b, t)
                val offset = distance(point, hitPoint)
                val along = from + length * t
                if (offset < best.offset - 1.0 || (abs(offset - best.offset) <= 1.0 && abs(along - preferred) < abs(best.distance - preferred)))
                    best = NativeGuidanceProjection(hitPoint, along, offset)
            }
            return best
        }

        private fun longitudeDelta(from: Double, to: Double) = ((to - from + 540.0) % 360.0) - 180.0

        private fun interpolate(a: Pair<Double, Double>, b: Pair<Double, Double>, amount: Double) =
            (((a.first + longitudeDelta(a.first, b.first) * amount + 540.0) % 360.0) - 180.0) to
                (a.second + (b.second - a.second) * amount)
    }
}

private fun distance(a: Pair<Double, Double>, b: Pair<Double, Double>): Double {
    val radians = Math.PI / 180.0
    val halfLat = sin((b.second - a.second) * radians / 2.0)
    val halfLon = sin((b.first - a.first) * radians / 2.0)
    val haversine = halfLat * halfLat + cos(a.second * radians) * cos(b.second * radians) * halfLon * halfLon
    return 6_371_000.0 * 2.0 * asin(sqrt(min(1.0, haversine)))
}
