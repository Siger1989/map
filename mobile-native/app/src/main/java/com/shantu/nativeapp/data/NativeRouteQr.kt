package com.shantu.nativeapp.data

import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.util.Base64
import java.util.UUID
import java.util.zip.Deflater
import java.util.zip.Inflater
import kotlin.math.*

data class NativeRouteQrEncoding(val text: String, val tolerance: Int, val lossy: Boolean) {
    val explanation: String get() = if (tolerance == 0) "二维码保留全部线形点，坐标精度约0.2米；不包含原轨迹时间和实测海拔。" else if (tolerance > 50) "概括路线：弯道可能变为直线；二维码线形不代表精确通行路径。简化阈值${tolerance}米。" else "二维码线形已简化，简化阈值${tolerance}米；不代表精确通行路径。"
}

/** Binary compatible with modules/routeShare/qrCodec.ts and qrImport.ts. */
object NativeRouteQr {
    const val PREFIX = "shantu-route:1:"
    const val QR_BUDGET = 2100
    const val MAX_RAW = 64_000
    private const val PRECISION = 1_000_000.0
    private const val MAX_POINTS = 6_000
    private val tolerances = listOf(0, 2, 5, 10, 20, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 50000, 500000)
    private val colorPattern = Regex("^#[0-9a-fA-F]{6}$")

    /** Decodes a QR payload to a saved-track-shaped JSONObject; scanning never starts guidance. */
    fun decode(text: String, now: Long = System.currentTimeMillis()): JSONObject {
        require(text.startsWith(PREFIX) && text.length <= QR_BUDGET) { "不是受支持的山兔路线二维码" }
        try {
            val parts = text.removePrefix(PREFIX).split(':')
            require(parts.size == 2)
            val length = parts[0].toIntOrNull(36) ?: error("invalid length")
            require(length in 2..MAX_RAW && parts[1].matches(Regex("[A-Za-z0-9_-]+")))
            val compressed = Base64.getUrlDecoder().decode(parts[1])
            val raw = inflateBounded(compressed, length)
            val decoder = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
            val value = JSONObject(decoder.decode(ByteBuffer.wrap(raw)).toString())
            require(value.opt("n") is String && value.getString("n").length <= 80)
            require(value.opt("m") is String && value.getString("m") in setOf("auto", "bicycle", "pedestrian"))
            val tolerance = number(value, "t")
            require(tolerance.isFinite() && tolerance.toInt().toDouble() == tolerance && tolerance.toInt() in tolerances)
            require(value.has("d") && (value.isNull("d") || (value.opt("d") is Number && value.getDouble("d").isFinite() && value.getDouble("d") >= 0)))
            val encoded = value.optJSONArray("s") ?: error("missing segments")
            require(encoded.length() in 1..100)
            var pointCount = 0
            val segments = JSONArray()
            for (i in 0 until encoded.length()) {
                val line = encoded.optJSONArray(i) ?: error("invalid segment")
                pointCount += line.length()
                require(line.length() >= 2 && pointCount <= MAX_POINTS)
                var x = 0L; var y = 0L
                val points = JSONArray()
                for (j in 0 until line.length()) {
                    val delta = line.optJSONArray(j) ?: error("invalid coordinate delta")
                    require(delta.length() == 2)
                    val dx = integerDelta(delta.opt(0)); val dy = integerDelta(delta.opt(1))
                    x = Math.addExact(x, dx); y = Math.addExact(y, dy)
                    val lon = x / PRECISION; val lat = y / PRECISION
                    require(lon in -180.0..180.0 && lat in -85.0..85.0)
                    points.put(JSONArray().put(lon).put(lat))
                }
                segments.put(points)
            }
            val stops = value.optJSONArray("p") ?: error("missing stops")
            require(stops.length() in 1..12)
            val decodedStops = JSONArray()
            for (i in 0 until stops.length()) {
                val stop = stops.optJSONArray(i) ?: error("invalid stop")
                require(stop.length() == 3 && stop.opt(0) is String && stop.getString(0).length <= 40)
                val lon = numberAt(stop, 1); val lat = numberAt(stop, 2)
                require(lon.isFinite() && lat.isFinite() && lon in -180.0..180.0 && lat in -85.0..85.0)
                decodedStops.put(JSONObject().put("name", stop.getString(0)).put("coordinates", JSONArray().put(lon).put(lat)))
            }

            val track = JSONObject().put("id", UUID.randomUUID().toString()).put("name", value.getString("n") + scanSuffix(tolerance.toInt()))
                .put("createdAt", now).put("segments", segments).put("source", "shared").put("navigationMode", value.getString("m"))
            if (value.has("st")) track.put("style", decodeStyle(value.opt("st")))
            if (value.has("ec")) track.put("edgeColors", decodeEdgeColors(value.opt("ec"), segments))
            if (value.has("cc")) track.put("colorConditions", decodeColorConditions(value.opt("cc")))
            if (decodedStops.length() > 1) track.put("sharedRoute", JSONObject().put("stops", decodedStops).put("duration", value.get("d")).put("tolerance", tolerance.toInt()))
            else {
                val stop = decodedStops.getJSONObject(0).getJSONArray("coordinates")
                var nearest: JSONArray? = null; var best = Double.MAX_VALUE
                for (i in 0 until segments.length()) for (j in 0 until segments.getJSONArray(i).length()) {
                    val point = segments.getJSONArray(i).getJSONArray(j); val d = distance(stop, point)
                    if (d < best) { best = d; nearest = point }
                }
                require(best <= .25) { "二维码起点不在线路节点上" }
                track.put("routeTerminals", JSONObject().put("start", nearest))
            }
            return track
        } catch (_: Exception) {
            throw IllegalArgumentException("路线二维码已损坏、超限或格式不受支持")
        }
    }

    /** Encodes a stored route track with the original app's protected-point and tolerance strategy. */
    fun encode(track: JSONObject): NativeRouteQrEncoding {
        val name = track.optString("name").take(80)
        require(name.isNotBlank()) { "路线名称无效，无法生成二维码" }
        val mode = track.optString("navigationMode").takeIf { it in setOf("auto", "bicycle", "pedestrian") } ?: "pedestrian"
        val source = track.optJSONArray("segments") ?: throw IllegalArgumentException("路线分段数据无效，无法生成二维码")
        require(source.length() in 1..100) { "路线分段数量超出二维码上限" }
        val segments = mutableListOf<List<Pair<Double, Double>>>()
        var originalPoints = 0
        for (i in 0 until source.length()) {
            val rawLine = source.optJSONArray(i) ?: throw IllegalArgumentException("路线分段数据无效，未生成二维码")
            require(rawLine.length() >= 2)
            originalPoints += rawLine.length()
            require(originalPoints <= 250_000) { "路线点数超出二维码计算上限，请分享完整路线包" }
            val line = (0 until rawLine.length()).map { j -> coordinate(rawLine.optJSONArray(j)) }
            segments += line
        }
        val style = normalizeStyle(track.opt("style"))
        val sourceEdgeColors = normalizeEdgeColors(track.opt("edgeColors"), segments, style.getString("color"))
        val conditions = track.opt("colorConditions")?.takeUnless { it === JSONObject.NULL }?.let(::decodeColorConditions)
        val stops = encodeStops(track, segments)
        val duration = track.opt("sharedRoute")?.takeUnless { it === JSONObject.NULL }?.let {
            val route = it as? JSONObject ?: throw IllegalArgumentException("共享路线元数据无效")
            if (!route.has("duration") || route.isNull("duration")) JSONObject.NULL else number(route, "duration").also { v -> require(v.isFinite() && v >= 0) }
        } ?: JSONObject.NULL

        val protected = segments.mapIndexed { part, line ->
            val pins = sortedSetOf(0, line.lastIndex)
            val colors = sourceEdgeColors[part]
            for (i in 1 until colors.size) if (colors[i] != colors[i - 1]) pins += i
            for (axis in 0..1) {
                var low = 0; var high = 0
                line.forEachIndexed { index, p -> if (p.component(axis) < line[low].component(axis)) low = index; if (p.component(axis) > line[high].component(axis)) high = index }
                pins += low; pins += high
            }
            for (stop in stops) {
                var bestAt = 0; var best = Double.POSITIVE_INFINITY
                line.forEachIndexed { i, p -> val d = hypot(p.first - stop.lon, p.second - stop.lat); if (d < best) { best = d; bestAt = i } }
                pins += bestAt
            }
            ProtectedLine(line, pins.toList())
        }

        for (tolerance in tolerances) {
            val simplified = protected.map { item ->
                val line = mutableListOf<Pair<Double, Double>>()
                item.pins.zipWithNext().forEachIndexed { index, (a, b) ->
                    val piece = simplify(item.points.subList(a, b + 1), tolerance.toDouble())
                    if (index == 0) line.addAll(piece) else line.addAll(piece.drop(1))
                }
                line
            }
            if (simplified.sumOf { it.size } > MAX_POINTS) continue
            val colors = simplified.mapIndexed { part, line ->
                val original = segments[part]; val sourceColors = sourceEdgeColors[part]; var cursor = 0
                line.drop(1).map { point ->
                    var found = -1
                    for (i in cursor + 1 until original.size) if (original[i] == point) { found = i; break }
                    require(found > 0) { "简化路线颜色无法保持" }
                    cursor = found; sourceColors[cursor - 1]
                }
            }
            val payload = JSONObject().put("n", name).put("m", mode)
                .put("s", JSONArray().also { out -> simplified.forEach { line -> out.put(deltaLine(line)) } })
                .put("p", JSONArray().also { out -> stops.forEach { out.put(JSONArray().put(it.name).put(it.lon).put(it.lat)) } })
                .put("t", tolerance).put("d", duration).put("st", style)
                .put("ec", JSONArray().also { out -> colors.forEach { row -> out.put(JSONArray().also { a -> row.forEach { c -> a.put(c ?: JSONObject.NULL) } }) } })
            if (conditions != null) payload.put("cc", conditions)
            val text = pack(payload)
            if (text != null && text.length <= QR_BUDGET) return NativeRouteQrEncoding(text, tolerance, tolerance != 0)
        }
        throw IllegalArgumentException("路线分段、颜色或备注超出单码容量；请分享完整路线包，颜色与备注不会被丢弃。")
    }

    private data class Stop(val name: String, val lon: Double, val lat: Double)
    private data class ProtectedLine(val points: List<Pair<Double, Double>>, val pins: List<Int>)
    private fun Pair<Double, Double>.component(axis: Int) = if (axis == 0) first else second

    private fun encodeStops(track: JSONObject, segments: List<List<Pair<Double, Double>>>): List<Stop> {
        val route = track.optJSONObject("sharedRoute")
        val raw = route?.optJSONArray("stops")
        if (raw != null && raw.length() > 0) {
            require(raw.length() <= 12)
            return (0 until raw.length()).map { i ->
                val item = raw.optJSONObject(i) ?: throw IllegalArgumentException("途经点数据无效")
                val name = item.optString("name").take(40)
                val c = item.optJSONArray("coordinates") ?: throw IllegalArgumentException("途经点坐标无效")
                val point = coordinate(c)
                Stop(name, point.first, point.second)
            }
        }
        val terminals = track.optJSONObject("routeTerminals")
        fun terminal(key: String): Pair<Double, Double>? = terminals?.optJSONArray(key)?.let(::coordinate)
        val start = terminal("start") ?: segments.first().first()
        val end = terminal("end")
        return if (end != null && end != start) listOf(Stop("起点", start.first, start.second), Stop("终点", end.first, end.second))
        else listOf(Stop("起点", start.first, start.second))
    }

    private fun normalizeStyle(raw: Any?): JSONObject {
        val obj = when (raw) { null, JSONObject.NULL -> JSONObject(); is JSONObject -> raw; else -> throw IllegalArgumentException("路线样式无效，未生成二维码") }
        val color = obj.optString("color").takeIf { colorPattern.matches(it) }?.lowercase() ?: "#ffb477"
        val width = finiteNumber(obj.opt("width"))?.coerceIn(.5, 5.0)?.let { round(it * 2) / 2 } ?: 1.5
        val out = JSONObject().put("color", color).put("width", width)
        finiteNumber(obj.opt("pointSize"))?.let { out.put("pointSize", round(it.coerceIn(4.0, 16.0))) }
        val opacity = finiteNumber(obj.opt("opacity"))?.coerceIn(.1, 1.0)?.let { round(it * 100) / 100 } ?: 1.0
        out.put("opacity", opacity)
        val travelMode = obj.optString("travelMode")
        out.put("travelMode", travelMode.takeIf { it in setOf("walk", "run", "bicycle", "motorcycle", "car") } ?: "walk")
        obj.optString("colorMode").takeIf { it in setOf("solid", "speed", "slope", "elevation") }?.let { out.put("colorMode", it) }
        return out
    }

    private fun decodeStyle(raw: Any?): JSONObject {
        val value = raw as? JSONObject ?: error("invalid style")
        require(colorPattern.matches(value.optString("color")))
        val width = number(value, "width"); require(width.isFinite() && width in .5..5.0)
        for (key in listOf("pointSize", "opacity")) if (value.has(key)) require(finiteNumber(value.opt(key)) != null)
        if (value.has("travelMode")) require(value.opt("travelMode") is String && value.getString("travelMode") in setOf("walk", "run", "bicycle", "motorcycle", "car"))
        if (value.has("colorMode")) require(value.opt("colorMode") is String && value.getString("colorMode") in setOf("solid", "speed", "slope", "elevation"))
        return normalizeStyle(value)
    }

    private fun normalizeEdgeColors(raw: Any?, segments: List<List<Pair<Double, Double>>>, fallback: String): List<List<String?>> {
        if (raw == null || raw === JSONObject.NULL) return segments.map { line -> List(line.size - 1) { fallback } }
        val array = raw as? JSONArray ?: throw IllegalArgumentException("路线分段颜色无效，未生成二维码")
        require(array.length() == segments.size) { "路线分段颜色与几何不匹配，未生成二维码" }
        return segments.mapIndexed { i, line ->
            val row = array.optJSONArray(i) ?: throw IllegalArgumentException("路线分段颜色无效")
            require(row.length() == line.size - 1)
            (0 until row.length()).map { j ->
                val c = row.opt(j)
                if (c == null || c === JSONObject.NULL) fallback else (c as? String)?.takeIf(colorPattern::matches)?.lowercase() ?: throw IllegalArgumentException("路线颜色格式无效，未生成二维码")
            }
        }
    }

    private fun decodeEdgeColors(raw: Any?, segments: JSONArray): JSONArray {
        val rows = raw as? JSONArray ?: error("invalid edge colors")
        require(rows.length() == segments.length())
        val out = JSONArray()
        for (i in 0 until rows.length()) {
            val row = rows.optJSONArray(i) ?: error("invalid edge colors")
            require(row.length() == segments.getJSONArray(i).length() - 1)
            val clean = JSONArray()
            for (j in 0 until row.length()) {
                val c = row.opt(j)
                require(c === JSONObject.NULL || (c is String && colorPattern.matches(c)))
                clean.put(if (c === JSONObject.NULL) JSONObject.NULL else (c as String).lowercase())
            }
            out.put(clean)
        }
        return out
    }

    private fun decodeColorConditions(raw: Any?): JSONObject {
        val value = raw as? JSONObject ?: error("invalid color conditions")
        require(value.length() <= 128)
        val out = JSONObject()
        val keys = value.keys()
        while (keys.hasNext()) {
            val key = keys.next(); val note = value.opt(key)
            require(colorPattern.matches(key) && note is String && note.length <= 1600)
            out.put(key.lowercase(), note)
        }
        return out
    }

    private fun coordinate(raw: JSONArray?): Pair<Double, Double> {
        require(raw != null && raw.length() >= 2)
        val lon = numberAt(raw, 0); val lat = numberAt(raw, 1)
        require(lon.isFinite() && lat.isFinite() && lon in -180.0..180.0 && lat in -85.0..85.0)
        return lon to lat
    }

    private fun deltaLine(line: List<Pair<Double, Double>>): JSONArray {
        var x = 0L; var y = 0L
        return JSONArray().also { out -> line.forEach { p ->
            val nx = round(p.first * PRECISION).toLong(); val ny = round(p.second * PRECISION).toLong()
            out.put(JSONArray().put(nx - x).put(ny - y)); x = nx; y = ny
        } }
    }

    private fun pack(value: JSONObject): String? {
        val raw = value.toString().toByteArray(Charsets.UTF_8)
        if (raw.size > MAX_RAW) return null
        val deflater = Deflater(9)
        val packed = try {
            deflater.setInput(raw); deflater.finish()
            ByteArrayOutputStream().use { out -> val buffer = ByteArray(8192); while (!deflater.finished()) { val n = deflater.deflate(buffer); if (n <= 0) break; out.write(buffer, 0, n) }; out.toByteArray() }
        } finally { deflater.end() }
        if (packed.isEmpty()) return null
        val payload = Base64.getUrlEncoder().withoutPadding().encodeToString(packed)
        return "$PREFIX${raw.size.toString(36)}:$payload"
    }

    private fun inflateBounded(compressed: ByteArray, length: Int): ByteArray {
        val inflater = Inflater(); val raw = ByteArray(length + 1)
        try {
            inflater.setInput(compressed)
            var count = 0
            while (!inflater.finished()) {
                val n = inflater.inflate(raw, count, raw.size - count)
                require(n > 0 && count + n <= length)
                count += n
            }
            require(count == length && inflater.remaining == 0)
            return raw.copyOf(length)
        } finally { inflater.end() }
    }

    private fun simplify(line: List<Pair<Double, Double>>, tolerance: Double): List<Pair<Double, Double>> {
        if (tolerance <= 0 || line.size < 3) return line
        val keep = sortedSetOf(0, line.lastIndex); val stack = ArrayDeque<Pair<Int, Int>>(); stack.addLast(0 to line.lastIndex)
        var work = 0
        while (stack.isNotEmpty()) {
            val (a, b) = stack.removeLast(); var greatest = tolerance; var at = -1
            for (i in a + 1 until b) {
                work++
                val distance = pointSegmentDistance(line[i], line[a], line[b])
                if (distance > greatest) { greatest = distance; at = i }
            }
            if (at != -1) {
                if (work > 2_000_000) at = (a + b) / 2
                keep += at; stack.addLast(a to at); stack.addLast(at to b)
            }
        }
        return keep.map { line[it] }
    }

    private fun pointSegmentDistance(p: Pair<Double, Double>, a: Pair<Double, Double>, b: Pair<Double, Double>): Double {
        fun wrap(v: Double) = ((v + 540) % 360) - 180
        val scale = cos(Math.toRadians(p.second)); val dx = wrap(b.first - a.first) * scale; val dy = b.second - a.second
        val px = wrap(p.first - a.first) * scale; val py = p.second - a.second
        val t = ((px * dx + py * dy) / (dx * dx + dy * dy).let { if (it == 0.0) 1.0 else it }).coerceIn(0.0, 1.0)
        return hypot(px - dx * t, py - dy * t) * 111_320
    }

    private fun number(obj: JSONObject, key: String): Double = numberAt(obj, key)
    private fun numberAt(obj: JSONObject, key: String): Double { val v = obj.opt(key); require(v is Number); return v.toDouble() }
    private fun numberAt(a: JSONArray, index: Int): Double { val v = a.opt(index); require(v is Number); return v.toDouble() }
    private fun integerDelta(raw: Any?): Long { require(raw is Number && raw.toDouble().isFinite() && raw.toDouble() == raw.toLong().toDouble() && abs(raw.toDouble()) <= 360_000_000); return raw.toLong() }
    private fun finiteNumber(raw: Any?): Double? = (raw as? Number)?.toDouble()?.takeIf(Double::isFinite)
    private fun distance(a: JSONArray, b: JSONArray): Double {
        val p = Math.toRadians(a.getDouble(1)); val q = Math.toRadians(b.getDouble(1)); val d = q - p; val e = Math.toRadians(b.getDouble(0) - a.getDouble(0))
        val h = sin(d / 2).let { it * it } + cos(p) * cos(q) * sin(e / 2).let { it * it }
        return 6_371_008.8 * 2 * asin(sqrt(h.coerceIn(0.0, 1.0)))
    }
    private fun scanSuffix(tolerance: Int) = if (tolerance == 0) "（扫码）" else "（扫码${if (tolerance > 50) "概括" else "简化"}·${tolerance}米）"
}
