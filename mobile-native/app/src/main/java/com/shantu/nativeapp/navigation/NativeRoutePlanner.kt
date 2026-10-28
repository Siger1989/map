package com.shantu.nativeapp.navigation

import android.os.CancellationSignal
import android.os.OperationCanceledException
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import org.json.JSONTokener
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import kotlin.math.*

data class NativeCoordinate(val longitude: Double, val latitude: Double) {
    fun toJson() = JSONArray().put(longitude).put(latitude)
}

data class NativeRouteStep(
    val kind: String,
    val legIndex: Int,
    val instruction: String,
    val distance: Double,
    val duration: Double,
    val elapsedSeconds: Double,
    val coordinates: List<NativeCoordinate>,
) {
    fun toJson() = JSONObject().put("kind", kind).put("legIndex", legIndex).put("instruction", instruction)
        .put("distance", distance).put("duration", duration).put("elapsedSeconds", elapsedSeconds)
        .put("coordinates", JSONArray().also { out -> coordinates.forEach { out.put(it.toJson()) } })
}

data class NativeRouteSegment(val kind: String, val coordinates: List<NativeCoordinate>) {
    fun toJson() = JSONObject().put("kind", kind).put("coordinates", JSONArray().also { out -> coordinates.forEach { out.put(it.toJson()) } })
}

/** Normalized response compatible with the saved-route shape used by WorkspaceStore. */
data class NativePlannedRoute(
    val mode: String,
    val coordinates: List<NativeCoordinate>,
    val distance: Double,
    val duration: Double,
    val steps: List<NativeRouteStep>,
    val roadLegs: List<List<NativeCoordinate>>,
    val segments: List<NativeRouteSegment>,
    val accessDistance: Double,
    val accessDuration: Double,
    val snapped: List<NativeCoordinate>,
    val stops: List<NativePlace>,
    val createdAt: Long,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("mode", mode)
        .put("coordinates", JSONArray().also { out -> coordinates.forEach { out.put(it.toJson()) } })
        .put("distance", distance).put("duration", duration)
        .put("steps", JSONArray().also { out -> steps.forEach { out.put(it.toJson()) } })
        .put("roadLegs", JSONArray().also { legs -> roadLegs.forEach { leg -> legs.put(JSONArray().also { out -> leg.forEach { out.put(it.toJson()) } }) } })
        .put("segments", JSONArray().also { out -> segments.forEach { out.put(it.toJson()) } })
        .put("accessDistance", accessDistance).put("accessDuration", accessDuration)
        .put("snapped", JSONArray().also { out -> snapped.forEach { out.put(it.toJson()) } })
        .put("stops", JSONArray().also { out -> stops.forEach { out.put(JSONObject().put("name", it.name).put("coordinates", JSONArray().put(it.longitude).put(it.latitude))) } })
        .put("createdAt", createdAt)
}

fun interface NativeRouteTransport {
    fun get(url: String, cancellationSignal: CancellationSignal?): Any
}

/** HTTP transport with explicit disconnect-on-cancel and bounded response reads. */
class HttpNativeRouteTransport : NativeRouteTransport {
    override fun get(url: String, cancellationSignal: CancellationSignal?): Any {
        cancellationSignal?.throwIfCanceled()
        val connection = try { URL(url).openConnection() as HttpURLConnection }
        catch (_: Exception) { throw IllegalStateException("路线服务连接失败，请检查网络后重试") }
        val cancelListener = CancellationSignal.OnCancelListener { connection.disconnect() }
        try {
            cancellationSignal?.setOnCancelListener(cancelListener)
            cancellationSignal?.throwIfCanceled()
            connection.connectTimeout = CONNECT_TIMEOUT_MS
            connection.readTimeout = READ_TIMEOUT_MS
            connection.requestMethod = "GET"
            connection.useCaches = false
            connection.instanceFollowRedirects = false
            connection.setRequestProperty("Accept", "application/json")
            val status = try { connection.responseCode }
            catch (e: IOException) {
                if (cancellationSignal?.isCanceled == true) throw OperationCanceledException()
                throw IllegalStateException("路线服务连接失败或超时，请检查网络后重试")
            }
            if (status == 429) throw IllegalStateException("路线请求较多，请稍后重试")
            if (status == 400) throw IllegalStateException("附近道路无法连通，请调整地点或出行方式")
            if (status !in 200..299) throw IllegalStateException("路线服务暂不可用，请稍后重试")
            val declared = connection.getHeaderField("Content-Length")?.toLongOrNull()
            require(declared == null || declared <= MAX_RESPONSE_BYTES) { "路线返回内容过大，请分段规划" }
            val bytes = try { connection.inputStream.use { readBounded(it, cancellationSignal) } }
            catch (e: IOException) {
                if (cancellationSignal?.isCanceled == true) throw OperationCanceledException()
                throw IllegalStateException("路线服务连接失败或超时，请检查网络后重试")
            }
            cancellationSignal?.throwIfCanceled()
            return try {
                val tokener = JSONTokener(bytes.toString(Charsets.UTF_8))
                val value = tokener.nextValue()
                require(tokener.nextClean() == 0.toChar())
                value
            }
            catch (_: JSONException) { throw IllegalStateException("路线服务返回的数据无法识别，请稍后重试") }
            catch (_: IllegalArgumentException) { throw IllegalStateException("路线服务返回的数据无法识别，请稍后重试") }
        } catch (e: OperationCanceledException) {
            throw e
        } finally {
            cancellationSignal?.setOnCancelListener(null)
            connection.disconnect()
        }
    }

    private fun readBounded(input: java.io.InputStream, cancellationSignal: CancellationSignal?): ByteArray {
        val out = ByteArrayOutputStream(); val buffer = ByteArray(16 * 1024)
        while (true) {
            cancellationSignal?.throwIfCanceled()
            val n = input.read(buffer)
            if (n < 0) break
            require(out.size().toLong() + n <= MAX_RESPONSE_BYTES) { "路线返回内容过大，请分段规划" }
            out.write(buffer, 0, n)
        }
        return out.toByteArray()
    }

    companion object {
        const val MAX_RESPONSE_BYTES = 4 * 1024 * 1024
        const val CONNECT_TIMEOUT_MS = 10_000
        const val READ_TIMEOUT_MS = 15_000
    }
}

/** Native equivalent of modules/navigation/provider.ts (Valhalla OSRM-compatible JSON). */
class NativeRoutePlanner(
    private val transport: NativeRouteTransport = HttpNativeRouteTransport(),
    private val offlineProvider: ((List<NativePlace>, CancellationSignal?) -> NativePlannedRoute?)? = null,
    private val defaultRoutingPreference: () -> String = { "online" },
) {
    fun plan(
        start: NativePlace,
        end: NativePlace,
        mode: String,
        via: List<NativePlace> = emptyList(),
        cancellationSignal: CancellationSignal? = null,
        routingPreference: String = defaultRoutingPreference(),
    ): NativePlannedRoute {
        cancellationSignal?.throwIfCanceled()
        val stops = listOf(start) + via + end
        validateRequest(stops, mode)
        require(routingPreference in setOf("online", "offlineFirst", "offlineOnly")) { "路线策略无效" }
        if (routingPreference != "online") {
            if (mode != "pedestrian" && routingPreference == "offlineOnly") throw IllegalStateException("离线路网当前只支持步行，请切换步行或选择在线规划")
            cancellationSignal?.throwIfCanceled()
            try {
                val offline = if (mode == "pedestrian") offlineProvider?.invoke(stops, cancellationSignal) else null
                if (offline != null) return offline
                if (routingPreference == "offlineOnly") throw IllegalStateException("没有覆盖起终点和途经点的离线路网，请先下载路网包")
            } catch (e: android.os.OperationCanceledException) { throw e }
            catch (e: Exception) { if (routingPreference == "offlineOnly") throw e }
        }

        val locateQuery = JSONObject()
            .put("locations", JSONArray().also { out -> stops.forEach { stop -> out.put(location(stop)) } })
            .put("costing", mode).put("verbose", false)
        val nearest = parseNearest(transport.get(url(LOCATE_ENDPOINT, locateQuery), cancellationSignal), stops)
        cancellationSignal?.throwIfCanceled()

        if (nearest.all { metresBetween(it, nearest.first()) < .1 }) {
            throw IllegalStateException("所有地点接入到了同一道路位置，无法生成有效线路，请调整地点")
        }
        val routeQuery = JSONObject()
            .put("locations", JSONArray().also { out -> nearest.forEach { coordinate ->
                out.put(JSONObject().put("lon", coordinate.longitude).put("lat", coordinate.latitude)
                    .put("type", "break").put("radius", 0).put("node_snap_tolerance", 0))
            } })
            .put("costing", mode).put("units", "kilometers").put("format", "osrm").put("shape_format", "geojson")
        val response = transport.get(url(ROUTE_ENDPOINT, routeQuery), cancellationSignal) as? JSONObject
            ?: throw IllegalStateException("路线服务返回的数据无法识别，请稍后重试")
        cancellationSignal?.throwIfCanceled()
        return normalizeResponse(response, mode, stops)
    }

    companion object {
        const val ROUTE_ENDPOINT = "https://valhalla1.openstreetmap.de/route"
        const val LOCATE_ENDPOINT = "https://valhalla1.openstreetmap.de/locate"
        const val MAX_STOPS = 10
        const val MAX_WAYPOINTS = MAX_STOPS - 2
        const val MAX_RESPONSE_COORDINATES = 100_000
        const val MAX_RESPONSE_STEPS = 10_000

        private val allowedModes = setOf("auto", "bicycle", "pedestrian")
        private const val MIN_STOP_DISTANCE_METERS = 20.0
        private const val MAX_SNAP_DISTANCE_METERS = 35_000.0

        fun routeUrl(stops: List<NativePlace>, mode: String): String {
            validateRequest(stops, mode)
            val query = JSONObject()
                .put("locations", JSONArray().also { out -> stops.forEach { stop -> out.put(location(stop).put("type", "break")) } })
                .put("costing", mode).put("units", "kilometers").put("format", "osrm").put("shape_format", "geojson")
            return url(ROUTE_ENDPOINT, query)
        }

        fun normalizeResponse(
            response: JSONObject,
            mode: String,
            requestedStops: List<NativePlace>,
        ): NativePlannedRoute {
            validateRequest(requestedStops, mode)
            val route = response.optJSONArray("routes")?.optJSONObject(0)
            if (response.optString("code") != "Ok" || route == null)
                throw IllegalStateException("没有找到可通行路线，请调整地点或出行方式")
            val distance = metric(route.opt("distance")) ?: throw IllegalStateException("路线数据不完整，请稍后重试")
            val duration = metric(route.opt("duration")) ?: throw IllegalStateException("路线数据不完整，请稍后重试")
            val geometry = route.optJSONObject("geometry") ?: throw IllegalStateException("路线数据不完整，请稍后重试")
            require(geometry.optString("type") == "LineString") { "路线数据不完整，请稍后重试" }
            parseLine(geometry.optJSONArray("coordinates"), minPoints = 2)
            val rawLegs = route.optJSONArray("legs") ?: throw IllegalStateException("路线分段数据不完整，请重试")
            require(rawLegs.length() == requestedStops.size - 1) { "路线服务返回的分段数不一致，请重试" }

            val rawStepsByLeg = mutableListOf<List<NativeRouteStep>>()
            val roadLegs = mutableListOf<List<NativeCoordinate>>()
            var totalStepPoints = 0
            var totalSteps = 0
            for (legIndex in 0 until rawLegs.length()) {
                val leg = rawLegs.optJSONObject(legIndex) ?: throw IllegalStateException("路线分段数据无效")
                val rawSteps = leg.optJSONArray("steps") ?: throw IllegalStateException("路线指引数据不完整")
                totalSteps += rawSteps.length()
                require(totalSteps <= MAX_RESPONSE_STEPS) { "路线指引数量过多，请缩短线路后重试" }
                val roadLeg = mutableListOf<NativeCoordinate>()
                val normalizedSteps = mutableListOf<NativeRouteStep>()
                for (i in 0 until rawSteps.length()) {
                    val step = rawSteps.optJSONObject(i) ?: throw IllegalStateException("路线指引数据无效")
                    val stepDistance = metric(step.opt("distance")) ?: throw IllegalStateException("路线分段数据无效")
                    val stepDuration = metric(step.opt("duration")) ?: throw IllegalStateException("路线分段数据无效")
                    val stepGeometry = step.optJSONObject("geometry")?.optJSONArray("coordinates")
                        ?: throw IllegalStateException("路线指引坐标不完整")
                    val points = parseLine(stepGeometry, minPoints = 1)
                    totalStepPoints += points.size
                    require(totalStepPoints <= MAX_RESPONSE_COORDINATES) { "路线坐标过多，请分段规划" }
                    if (roadLeg.isEmpty()) roadLeg += points
                    else roadLeg += points.drop(if (metresBetween(roadLeg.last(), points.first()) < .1) 1 else 0)
                    val maneuver = step.optJSONObject("maneuver")
                    val type = maneuver?.optString("type").orEmpty()
                    val instruction = if (type == "arrive" && legIndex < rawLegs.length() - 1) {
                        "到达途经点 ${legIndex + 1}"
                    } else instruction(type, maneuver?.optString("modifier").orEmpty(), maneuver?.optInt("exit", -1) ?: -1, step.optString("name"))
                    normalizedSteps += NativeRouteStep("road", legIndex, instruction, stepDistance, stepDuration, 0.0, points)
                }
                require(roadLeg.size >= 2) { "路线道路分段不完整，请稍后重试" }
                roadLegs += roadLeg
                rawStepsByLeg += normalizedSteps
            }
            val returnedWaypoints = response.optJSONArray("waypoints")
                ?: throw IllegalStateException("路线服务返回的途经点不完整，请重试")
            require(returnedWaypoints.length() == requestedStops.size) { "路线服务返回的途经点数量不一致，请重试" }
            val routeSnapped = mutableListOf<NativeCoordinate>()
            for (i in 0 until returnedWaypoints.length()) {
                val location = returnedWaypoints.optJSONObject(i)?.optJSONArray("location")
                    ?: throw IllegalStateException("路线服务返回的吸附点无效")
                val wp = parseCoordinate(location) ?: throw IllegalStateException("路线服务返回的吸附点无效")
                routeSnapped += wp
            }
            val segments = mutableListOf<NativeRouteSegment>()
            val steps = mutableListOf<NativeRouteStep>()
            val coordinates = mutableListOf<NativeCoordinate>()
            var accessDistance = 0.0
            var accessDuration = 0.0
            var elapsed = 0.0
            fun appendAccess(a: NativeCoordinate, b: NativeCoordinate, instruction: String, legIndex: Int) {
                val d = metresBetween(a, b)
                if (d < .01) return
                val duration = d / 1.2 // Explicit walking estimate for the straight access connector.
                val points = listOf(a, b)
                segments += NativeRouteSegment("access", points)
                for (point in points) if (coordinates.isEmpty() || metresBetween(coordinates.last(), point) >= .001) coordinates += point
                steps += NativeRouteStep("access", legIndex, instruction, d, duration, elapsed, points)
                elapsed += duration
                accessDistance += d
                accessDuration += duration
            }
            for (legIndex in roadLegs.indices) {
                val road = roadLegs[legIndex]
                appendAccess(NativeCoordinate(requestedStops[legIndex].longitude, requestedStops[legIndex].latitude), road.first(),
                    "沿虚线前往道路接入点 · 直线示意", legIndex)
                segments += NativeRouteSegment("road", road)
                for (point in road) if (coordinates.isEmpty() || metresBetween(coordinates.last(), point) >= .001) coordinates += point
                for (step in rawStepsByLeg[legIndex]) {
                    steps += step.copy(elapsedSeconds = elapsed)
                    elapsed += step.duration
                }
                appendAccess(road.last(), NativeCoordinate(requestedStops[legIndex + 1].longitude, requestedStops[legIndex + 1].latitude),
                    if (legIndex == roadLegs.lastIndex) "离开道路前往终点 · 虚线直连示意" else "离开道路前往途经点 ${legIndex + 1} · 虚线直连示意", legIndex)
            }
            require(coordinates.size >= 2) { "路线数据不完整，请稍后重试" }
            require(coordinates.size <= MAX_RESPONSE_COORDINATES) { "路线坐标过多，请分段规划" }
            return NativePlannedRoute(mode, coordinates, distance + accessDistance, duration + accessDuration,
                steps, roadLegs, segments, accessDistance, accessDuration, routeSnapped, requestedStops, System.currentTimeMillis())
        }

        private fun validateRequest(stops: List<NativePlace>, mode: String) {
            require(mode in allowedModes) { "出行方式无效" }
            require(stops.size in 2..MAX_STOPS) { "至少需要起点和终点，且最多支持 $MAX_WAYPOINTS 个途经点" }
            stops.forEach { stop ->
                require(stop.name.length <= 160 && stop.longitude.isFinite() && stop.latitude.isFinite() &&
                    abs(stop.longitude) <= 180 && abs(stop.latitude) <= 85.0) { "地点坐标无效" }
            }
            for (i in 1 until stops.size) require(metresBetween(stops[i - 1], stops[i]) >= MIN_STOP_DISTANCE_METERS) {
                "相邻地点距离至少需要20米"
            }
        }

        private fun location(stop: NativePlace) = JSONObject()
            .put("lon", stop.longitude).put("lat", stop.latitude).put("radius", 0)
            .put("node_snap_tolerance", 0).put("search_cutoff", MAX_SNAP_DISTANCE_METERS.toInt())

        private fun url(endpoint: String, query: JSONObject): String = endpoint + "?json=" +
            URLEncoder.encode(query.toString(), Charsets.UTF_8.name())

        private fun parseNearest(response: Any, stops: List<NativePlace>): List<NativeCoordinate> {
            val edgesByStop = response as? JSONArray
                ?: throw IllegalStateException("附近道路无法连接，请调整地点")
            require(edgesByStop.length() == stops.size) { "道路接入点返回不完整，请重试" }
            return stops.indices.map { index ->
                val edges = edgesByStop.optJSONObject(index)?.optJSONArray("edges")
                    ?: throw IllegalStateException("“${safeName(stops[index].name)}”附近没有可接入的道路")
                val candidates = mutableListOf<NativeCoordinate>()
                for (j in 0 until edges.length()) {
                    val edge = edges.optJSONObject(j) ?: continue
                    val lon = edge.optDouble("correlated_lon", Double.NaN)
                    val lat = edge.optDouble("correlated_lat", Double.NaN)
                    if (lon.isFinite() && lat.isFinite() && abs(lon) <= 180 && abs(lat) <= 85.051129)
                        candidates += NativeCoordinate(lon, lat)
                }
                val nearest = candidates.minByOrNull { metresBetween(stops[index], it) }
                    ?: throw IllegalStateException("“${safeName(stops[index].name)}”附近没有可接入的道路")
                require(metresBetween(stops[index], nearest) <= MAX_SNAP_DISTANCE_METERS) {
                    "“${safeName(stops[index].name)}”附近没有可接入的道路"
                }
                nearest
            }
        }

        private fun parseLine(array: JSONArray?, minPoints: Int): List<NativeCoordinate> {
            require(array != null && array.length() in minPoints..MAX_RESPONSE_COORDINATES) { "路线坐标无效，请重试" }
            return (0 until array.length()).map { i ->
                parseCoordinate(array.optJSONArray(i)) ?: throw IllegalStateException("路线坐标无效，请重试")
            }
        }

        private fun parseCoordinate(array: JSONArray?): NativeCoordinate? {
            if (array == null || array.length() < 2) return null
            val lon = array.optDouble(0, Double.NaN); val lat = array.optDouble(1, Double.NaN)
            return if (lon.isFinite() && lat.isFinite() && abs(lon) <= 180 && abs(lat) <= 85.051129) NativeCoordinate(lon, lat) else null
        }

        private fun metric(value: Any?): Double? {
            val number = value as? Number ?: return null
            val result = number.toDouble()
            return result.takeIf { it.isFinite() && it >= 0 }
        }

        private fun instruction(type: String, modifier: String, exit: Int, rawName: String): String {
            val direction = when (modifier) {
                "left" -> "左转"; "right" -> "右转"; "slight left" -> "向左前方行进"; "slight right" -> "向右前方行进"
                "sharp left" -> "向左急转"; "sharp right" -> "向右急转"; "straight" -> "直行"; "uturn" -> "掉头"
                else -> "继续行进"
            }
            val action = when (type) {
                "depart" -> "出发"; "arrive" -> "到达终点"
                "roundabout", "rotary" -> "进入环岛${if (exit >= 1) "，从第 $exit 个出口驶出" else ""}"
                "merge" -> "并入道路"; "on ramp" -> "进入匝道"; "off ramp" -> "驶出匝道"
                else -> direction
            }
            val road = safeName(rawName)
            return if (road.isNotEmpty() && type != "arrive") "$action · $road" else action
        }

        private fun safeName(value: String) = value.trim().take(120).filterNot { it.isISOControl() }

        private fun metresBetween(a: NativePlace, b: NativePlace) = metresBetween(a.longitude, a.latitude, b.longitude, b.latitude)
        private fun metresBetween(a: NativePlace, b: NativeCoordinate) = metresBetween(a.longitude, a.latitude, b.longitude, b.latitude)
        private fun metresBetween(a: NativeCoordinate, b: NativeCoordinate) = metresBetween(a.longitude, a.latitude, b.longitude, b.latitude)
        private fun metresBetween(lon1: Double, lat1: Double, lon2: Double, lat2: Double): Double {
            val rad = Math.PI / 180.0
            val h = sin((lat2 - lat1) * rad / 2).pow(2) + cos(lat1 * rad) * cos(lat2 * rad) * sin((lon2 - lon1) * rad / 2).pow(2)
            return 6_371_000.0 * 2 * asin(sqrt(min(1.0, h)))
        }
    }
}
