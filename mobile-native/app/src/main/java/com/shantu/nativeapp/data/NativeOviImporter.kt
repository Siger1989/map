package com.shantu.nativeapp.data

import org.json.JSONArray
import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets
import java.util.UUID
import kotlin.math.abs

/** Strict native readers for the already supported OviO v105 and OVJSN object subset. */
internal object NativeOviImporter {
    private const val MAX_OBJECTS = 2100
    private const val MAX_POINTS = 6000

    fun parseOviJson(text: String, filename: String, selected: NativeRouteFormats.CoordinateSystem): Pair<JSONObject, List<String>> {
        require(text.toByteArray(StandardCharsets.UTF_8).size <= 8 * 1024 * 1024) { "奥维 JSON 超过8MB" }
        val root = try { JSONObject(text) } catch (e: Exception) { throw IllegalArgumentException("奥维 JSON 无效", e) }
        val items = root.optJSONArray("ObjItems") ?: throw IllegalArgumentException("OVJSN缺少ObjItems对象列表")
        require(items.length() in 1..MAX_OBJECTS) { "奥维 JSON 对象数量无效或超过限制" }
        val tracks = JSONArray(); val pins = JSONArray(); val areas = JSONArray()
        for (i in 0 until items.length()) {
            val item = items.optJSONObject(i) ?: fail()
            val obj = item.optJSONObject("Object") ?: fail()
            val detail = obj.optJSONObject("ObjectDetail") ?: fail()
            val rawType = if (obj.has("Type")) obj.opt("Type") else item.opt("Type")
            val type = (rawType as? Number)?.toDouble()?.takeIf { it % 1.0 == 0.0 }?.toInt() ?: -1
            require(type in setOf(7, 8, 13)) { "此OVJSN含尚未识别的对象结构，未部分导入" }
            val datum = when (selected) {
                NativeRouteFormats.CoordinateSystem.GCJ02 -> selected
                NativeRouteFormats.CoordinateSystem.CGCS2000 -> selected
                NativeRouteFormats.CoordinateSystem.AUTO -> when (val flag = detail.opt("Gcj02")) {
                    is Number -> when (flag.toDouble()) { 1.0 -> NativeRouteFormats.CoordinateSystem.GCJ02; 0.0 -> NativeRouteFormats.CoordinateSystem.CGCS2000; else -> throw IllegalArgumentException("OVJSN坐标系标记无效") }
                    else -> throw IllegalArgumentException("OVJSN缺少坐标系标记；请选择 CGCS2000 或 GCJ02")
                }
            }
            val name = (obj.opt("Name") as? String).orEmpty().trim().ifEmpty { fallback(filename) }.take(60)
            val note = (obj.opt("Comment") as? String).orEmpty().take(500)
            when (type) {
                7 -> {
                    require(pins.length() < 2000) { "OVJSN标记超过2000个" }
                    val lat = number(detail.opt("Lat"), "纬度")
                    val lon = number(detail.opt("Lng"), "经度")
                    val altitude = optionalNumber(detail.opt("Altitude"), "海拔")
                    pins.put(NativeRouteFormats.annotation(name, coordinate(lon, lat, datum), note, altitude))
                }
                8, 13 -> {
                    val flat = detail.optJSONArray("Latlng") ?: throw IllegalArgumentException("OVJSN经纬度数组不完整")
                    require(flat.length() >= 4 && flat.length() % 2 == 0 && flat.length() / 2 <= MAX_POINTS) { "OVJSN经纬度数组不完整或超过6000点" }
                    val points = JSONArray()
                    for (p in 0 until flat.length() step 2) points.put(coordinate(number(flat.opt(p), "纬度"), number(flat.opt(p + 1), "经度"), datum))
                    if (type == 8) { require(tracks.length() < 100) { "OVJSN路线超过100条" }; tracks.put(track(name, listOf(points), "OVJSN")) }
                    else { require(areas.length() < 40) { "OVJSN区域超过40个" }; areas.put(area(name, note, points)) }
                }
            }
        }
        return NativeRouteFormats.transfer(tracks, pins, areas) to emptyList()
    }

    fun parseOvobj(bytes: ByteArray, filename: String, selected: NativeRouteFormats.CoordinateSystem): Pair<JSONObject, List<String>> {
        val fail = { IllegalArgumentException("此 OVOBJ 的版本或对象结构尚未支持，或文件已截断；未部分导入") }
        fun check(start: Int, size: Int, end: Int = bytes.size) { if (start < 0 || size < 0 || start.toLong() + size > end) throw fail() }
        fun u32(at: Int, end: Int = bytes.size): Long { check(at, 4, end); return ByteBuffer.wrap(bytes, at, 4).order(ByteOrder.LITTLE_ENDIAN).int.toLong() and 0xffffffffL }
        fun i64(at: Int, end: Int = bytes.size): Long { check(at, 8, end); return ByteBuffer.wrap(bytes, at, 8).order(ByteOrder.LITTLE_ENDIAN).long }
        check(0, 264)
        require(String(bytes, 0, 4, StandardCharsets.US_ASCII) == "OviO" && u32(12) == 105L && i64(24) == bytes.size.toLong()) { "此 OVOBJ 版本或头结构尚未支持" }
        val datum = if (selected == NativeRouteFormats.CoordinateSystem.AUTO) NativeRouteFormats.CoordinateSystem.CGCS2000 else selected
        val tracks = JSONArray(); val pins = JSONArray(); val areas = JSONArray(); var objects = 0; var totalPoints = 0
        fun coord(lon: Double, lat: Double): JSONArray {
            require(lon.isFinite() && lat.isFinite() && abs(lon) <= 180 && abs(lat) <= 85.051129) { "OVOBJ 坐标超出范围" }
            return NativeRouteFormats.convertCoordinate(JSONArray().put(lon).put(lat), datum)
        }
        fun decodeObject(start: Int, end: Int) {
            require(++objects <= MAX_OBJECTS) { "OVOBJ对象过多" }
            check(start, 64, end)
            val payloadRaw = u32(start + 16, end); require(payloadRaw <= Int.MAX_VALUE) { "OVOBJ对象长度无效" }
            val payloadLength = payloadRaw.toInt(); val type = u32(start + 20, end).toInt(); val body = start + 64
            require(body.toLong() + payloadLength == end.toLong()) { "OVOBJ对象帧长度无效" }
            val revision = u32(body, end).toInt()
            if (type == 7) {
                require(revision == 104 && payloadLength == 101) { "此 OVOBJ 点对象版本尚未支持" }
                check(body + 64, 16, end)
                require(bytes.copyOfRange(body + 96, end).all { it == 0.toByte() }) { "此 OVOBJ 点对象含未知扩展字段" }
                val lat = ByteBuffer.wrap(bytes, body + 64, 8).order(ByteOrder.LITTLE_ENDIAN).double
                val lon = ByteBuffer.wrap(bytes, body + 72, 8).order(ByteOrder.LITTLE_ENDIAN).double
                    require(pins.length() < 2000) { "OVOBJ标记超过2000个" }
                    pins.put(NativeRouteFormats.annotation(fallback(filename), coord(lon, lat), ""))
                totalPoints++; require(totalPoints <= MAX_POINTS) { "OVOBJ点数超过6000" }
                return
            }
            require((type == 8 && revision == 103) || (type == 13 && revision == 104)) { "此 OVOBJ 对象类型或修订版本尚未支持" }
            var at = body + if (type == 8) 100 else 200
            fun text(): String {
                check(at, 1, end); val size = bytes[at++].toInt() and 255
                require(size < 255) { "OVOBJ 字段过长" }; check(at, size, end)
                val decoder = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
                val out = try { decoder.decode(ByteBuffer.wrap(bytes, at, size)).toString() } catch (e: Exception) { throw IllegalArgumentException("OVOBJ 文本编码无效", e) }
                at += size; return out
            }
            val name = text().ifBlank { fallback(filename) }.take(60); val note = text().take(500)
            require(u32(at, end) == 0L) { "OVOBJ 对象包含尚未支持的点属性" }; at += 4
            val count = i64(at, end); at += 8
            require(count in 1..MAX_POINTS.toLong() && (type != 13 || count >= 3)) { "OVOBJ点数无效或超过6000点" }
            totalPoints += count.toInt(); require(totalPoints <= MAX_POINTS) { "OVOBJ总点数超过6000" }
            var lat = i64(at, end); var lon = i64(at + 8, end); at += 16
            val coords = JSONArray().put(coord(lon / 1e8, lat / 1e8))
            for (index in 1 until count.toInt()) {
                check(at, 1, end); val header = bytes[at++].toInt() and 255; val n = (header shr 2) and 15
                require(n <= 9) { "OVOBJ 坐标压缩结构无效" }; check(at, n, end)
                var value = java.math.BigInteger.valueOf((header and 3).toLong())
                repeat(n) { value = value.shiftLeft(8).or(java.math.BigInteger.valueOf((bytes[at++].toInt() and 255).toLong())) }
                val bits = n * 4 + 1
                val dx = value.shiftRight(bits).longValueExact(); val dy = value.and(java.math.BigInteger.ONE.shiftLeft(bits).subtract(java.math.BigInteger.ONE)).longValueExact()
                lat = if ((header and 128) != 0) Math.subtractExact(lat, dx) else Math.addExact(lat, dx)
                lon = if ((header and 64) != 0) Math.subtractExact(lon, dy) else Math.addExact(lon, dy)
                coords.put(coord(lon / 1e8, lat / 1e8))
            }
            require(at == end) { "OVOBJ对象帧含未知尾部数据" }
            if (type == 8) { require(tracks.length() < 100) { "OVOBJ路线超过100条" }; tracks.put(track(name, listOf(coords), "OVOBJ")) }
            else { require(areas.length() < 40) { "OVOBJ区域超过40个" }; areas.put(area(name, note, coords)) }
        }
        val kind = u32(244).toInt(); val payloadSize = i64(248); val start = 264
        require(payloadSize >= 0 && start.toLong() + payloadSize == bytes.size.toLong()) { "OVOBJ顶层对象长度无效" }
        when (kind) {
            31 -> decodeObject(start, bytes.size)
            100 -> {
                var at = start
                while (at < bytes.size) {
                    val lenRaw = u32(at); val subtype = u32(at + 4).toInt(); require(lenRaw <= Int.MAX_VALUE) { "OVOBJ对象长度无效" }; val len = lenRaw.toInt(); at += 8
                    require(subtype == 31) { "OVOBJ集合含尚未支持的对象类型" }; check(at, len)
                    decodeObject(at, at + len); at += len
                }
            }
            else -> throw IllegalArgumentException("此 OVOBJ 顶层对象类型尚未支持")
        }
        val warnings = if (selected == NativeRouteFormats.CoordinateSystem.AUTO) listOf("OVOBJ 坐标基准未确认，暂按 WGS84；如有偏移，可在上方坐标设置中更改。") else emptyList()
        return NativeRouteFormats.transfer(tracks, pins, areas) to warnings
    }

    private fun coordinate(lon: Double, lat: Double, system: NativeRouteFormats.CoordinateSystem): JSONArray {
        require(lon.isFinite() && lat.isFinite() && abs(lon) <= 180 && abs(lat) <= 85.051129) { "坐标超出地图范围，请核对坐标系" }
        return NativeRouteFormats.convertCoordinate(JSONArray().put(lon).put(lat), system)
    }
    private fun number(value: Any?, label: String): Double {
        val result = when (value) { is Number -> value.toDouble(); is String -> value.trim().toDoubleOrNull(); else -> null }
        require(result != null && result.isFinite()) { "${label}缺失或无效" }; return result
    }
    private fun optionalNumber(value: Any?, label: String): Double? = if (value == null || value == JSONObject.NULL || value == "") null else number(value, label)
    private fun track(name: String, segments: List<JSONArray>, format: String): JSONObject {
        require(segments.isNotEmpty() && segments.size <= 100 && segments.sumOf { it.length() } <= MAX_POINTS) { "路线点数或分段数超过限制" }
        val segmentJson = JSONArray(); segments.forEach { segmentJson.put(it) }
        return JSONObject().put("id", UUID.randomUUID().toString()).put("name", name.take(200)).put("createdAt", System.currentTimeMillis())
            .put("source", "shared").put("importFormat", format).put("segments", segmentJson)
    }
    private fun area(name: String, note: String, points: JSONArray): JSONObject {
        require(points.length() in 3..MAX_POINTS) { "OVJSN区域点数无效" }
        val boundary = JSONArray(); for (i in 0 until points.length()) boundary.put(points.getJSONArray(i))
        val first = points.getJSONArray(0); val last = points.getJSONArray(points.length() - 1)
        if (!same(first, last)) boundary.put(JSONArray(first.toString()))
        require(boundary.length() <= 6001) { "区域点数超过限制" }
        return JSONObject().put("id", UUID.randomUUID().toString()).put("name", name.take(60)).put("note", note.take(500))
            .put("color", "#3388ff").put("visible", true).put("boundary", boundary).put("createdAt", System.currentTimeMillis())
    }
    private fun fallback(filename: String) = filename.substringBeforeLast('.', filename).ifBlank { "导入线路" }.take(60)
    private fun same(a: JSONArray, b: JSONArray) = a.length() >= 2 && b.length() >= 2 && a.optDouble(0).compareTo(b.optDouble(0)) == 0 && a.optDouble(1).compareTo(b.optDouble(1)) == 0
    private fun fail(): Nothing = throw IllegalArgumentException("此OVJSN含尚未识别的对象结构，未部分导入")
}
