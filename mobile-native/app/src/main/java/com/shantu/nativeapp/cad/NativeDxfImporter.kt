package com.shantu.nativeapp.cad

import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.InputStreamReader
import java.nio.charset.Charset
import java.nio.charset.CodingErrorAction
import java.security.MessageDigest
import java.util.Base64
import kotlin.math.*

data class NativeCadPoint(val x: Double, val y: Double, val z: Double = 0.0) {
    fun json() = JSONArray().put(x).put(y).put(z)
}

data class NativeDxfFeature(
    val id: String,
    val layer: String,
    val entityType: String,
    val geometry: JSONObject,
    val color: String? = null,
    val text: String? = null,
    val properties: JSONObject,
) {
    fun json(): JSONObject = JSONObject().put("id", id).put("layer", layer).put("entityType", entityType)
        .put("geometry", geometry).put("properties", properties).also { out ->
            color?.let { out.put("color", it) }; text?.let { out.put("text", it) }
        }
}

data class NativeDxfDecoded(
    val name: String,
    val features: List<NativeDxfFeature>,
    val layers: List<JSONObject>,
    val units: String?,
    val declaredUnitScale: Double?,
    val crsHint: String?,
    val warnings: List<String>,
    internal val sourceBytes: ByteArray,
)

data class NativeCadCrs(val id: String, val label: String, val definition: String, val datumParameters:List<Double>?=null) {

    fun json() = JSONObject().put("id", id).put("name", label).put("definition", definition).also{datumParameters?.let{p->it.put("datumParameters",JSONArray(p))}}

    companion object {
        val WGS84=NativeCadCrs("EPSG:4326","WGS 84","+proj=longlat +datum=WGS84 +no_defs")
        val WEB_MERCATOR=NativeCadCrs("EPSG:3857","Web Mercator","+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +no_defs")
        fun values()=arrayOf(WGS84,WEB_MERCATOR)
        fun resolve(text:String,datum:List<Double>?=null):NativeCadCrs {
            val p=com.shantu.nativeapp.coordinates.NativeCoordinateTransform.resolve(text)
            return NativeCadCrs(p.id,p.name,p.definition?:text,datum)
        }
        fun fromExplicitHint(hint: String?): NativeCadCrs? {
            if (hint.isNullOrBlank()) return null
            val epsg = Regex("EPSG\\s*[:=]\\s*(\\d{4,6})", RegexOption.IGNORE_CASE).find(hint)?.groupValues?.get(1)
                ?: Regex("AUTHORITY\\s*\\[\\s*\\\"EPSG\\\"\\s*,\\s*\\\"(\\d+)\\\"", RegexOption.IGNORE_CASE).find(hint)?.groupValues?.get(1)
                ?: return null
            return runCatching{resolve("EPSG:$epsg")}.getOrNull()
        }
    }
}

enum class NativeCadAxis { XY, YX }

/** Bounded ASCII DXF reader. DWG and binary DXF are deliberately outside this importer. */
object NativeDxfImporter {
    const val MAX_INPUT_BYTES = 20 * 1024 * 1024
    const val MAX_ENTITIES = 20_000
    const val MAX_VERTICES = 100_000
    const val MAX_BLOCK_DEPTH = 8
    private const val MAX_GROUP_PAIRS = 600_000
    private const val MAX_TEXT_CHARS = 20_000
    private const val MAX_COORDINATE_MAGNITUDE = 50_000_000.0
    private const val MAX_CURVE_EDGES = 128
    private const val MAX_POLYLINE_ARC_EDGES = 64
    private const val EARTH_RADIUS = 6_378_137.0
    private const val MAX_MERCATOR_LAT = 85.0511287798066

    private data class PairValue(val code: Int, val value: String)
    private data class Record(val type: String, val pairs: MutableList<PairValue> = mutableListOf(), val vertices: MutableList<Record> = mutableListOf())
    private data class Block(val name: String, val base: NativeCadPoint, val records: MutableList<Record>)
    private data class Parsed(val records: List<Record>, val blocks: Map<String, Block>, val layers: List<JSONObject>, val unitsCode: Int?, val crsHint: String?, val warnings: MutableList<String>)
    private data class Transform(val a: Double = 1.0, val b: Double = 0.0, val c: Double = 0.0, val d: Double = 1.0, val tx: Double = 0.0, val ty: Double = 0.0, val zScale: Double = 1.0, val tz: Double = 0.0) {
        fun apply(p: NativeCadPoint) = NativeCadPoint(a * p.x + b * p.y + tx, c * p.x + d * p.y + ty, zScale * p.z + tz)
        fun after(inner: Transform) = Transform(
            a * inner.a + b * inner.c, a * inner.b + b * inner.d,
            c * inner.a + d * inner.c, c * inner.b + d * inner.d,
            a * inner.tx + b * inner.ty + tx, c * inner.tx + d * inner.ty + ty,
            zScale * inner.zScale, zScale * inner.tz + tz,
        )
    }

    /** Use from SAF with the stream already opened; it never reads beyond 20 MiB. */
    fun readBounded(input: InputStream): ByteArray {
        val out = ByteArrayOutputStream(64 * 1024)
        val chunk = ByteArray(32 * 1024)
        var total = 0
        while (true) {
            val n = input.read(chunk, 0, minOf(chunk.size, MAX_INPUT_BYTES - total + 1))
            if (n < 0) break
            if (n == 0) continue
            require(total <= MAX_INPUT_BYTES - n) { "CAD 文件超过 20 MiB；请在 CAD 软件中裁剪或拆分。" }
            out.write(chunk, 0, n); total += n
        }
        require(total > 0) { "CAD 文件为空。" }
        return out.toByteArray()
    }

    fun decode(name: String, bytes: ByteArray): NativeDxfDecoded {
        require(!name.endsWith(".dwg", ignoreCase = true)) { "DWG 原生解码尚未支持；请另存为 ASCII DXF。" }
        require(name.endsWith(".dxf", ignoreCase = true)) { "请选择 .dxf 文件。" }
        require(bytes.isNotEmpty() && bytes.size <= MAX_INPUT_BYTES) { "CAD 文件超过 20 MiB 或为空。" }
        require(bytes.none { it == 0.toByte() }) { "二进制 DXF 暂不支持；请另存为 ASCII DXF。" }
        val parsed = parse(bytes)
        val warnings = parsed.warnings
        val output = mutableListOf<NativeDxfFeature>()
        val featureIds = hashSetOf<String>()
        var entityCount = 0
        var vertexCount = 0
        val layerColors = parsed.layers.associate { it.optString("name", "0") to it.optString("color").takeIf(String::isNotEmpty) }

        fun warn(message: String) { if (warnings.size < MAX_ENTITIES + 16) warnings += message }
        fun emit(records: List<Record>, outer: Transform, depth: Int, ancestry: List<String>) {
            if (depth > MAX_BLOCK_DEPTH) { warn("块引用超过递归上限 $MAX_BLOCK_DEPTH，已停止展开。"); return }
            for ((index, record) in records.withIndex()) {
                entityCount++
                require(entityCount <= MAX_ENTITIES) { "CAD 展开图元超过 $MAX_ENTITIES 个上限。" }
                val handle = value(record, 5)?.trim()?.takeIf { it.isNotEmpty() } ?: "${ancestry.joinToString("/")}${index + 1}"
                val id = if (ancestry.isEmpty()) handle else "${ancestry.joinToString("/")}/$handle"
                require(id.length <= 250) { "CAD 图元编号超过 250 字符。" }
                if (record.type == "INSERT") {
                    if (unsupportedOcs(record)) { warn("INSERT $id 使用非默认 OCS，已跳过以避免坐标偏移。"); continue }
                    val blockName = value(record, 2)?.trim().orEmpty()
                    val block = parsed.blocks[blockName.uppercase()]
                    if (block == null) { warn("块 ${blockName.ifEmpty { "(unknown)" }} 未找到定义，已跳过。"); continue }
                    val rows = int(record, 71, 1); val columns = int(record, 70, 1)
                    if (rows !in 1..1 || columns !in 1..1) { warn("INSERT $id 为阵列块引用；原生解析不展开阵列，已跳过。"); continue }
                    if (ancestry.any { it.substringBefore('@').equals(blockName, ignoreCase = true) }) { warn("检测到循环块引用 $blockName，已停止展开。"); continue }
                    val sx = number(record, 41, 1.0); val sy = number(record, 42, 1.0); val sz = number(record, 43, 1.0)
                    val angle = Math.toRadians(number(record, 50, 0.0))
                    require(listOf(sx, sy, sz, angle).all { it.isFinite() && abs(it) <= 1_000_000.0 }) { "INSERT $id 的缩放或旋转参数无效。" }
                    val origin = point(record, 10, 20, 30)
                    val cos = cos(angle); val sin = sin(angle); val base = block.base
                    val local = Transform(cos * sx, -sin * sy, sin * sx, cos * sy,
                        origin.x - cos * sx * base.x + sin * sy * base.y,
                        origin.y - sin * sx * base.x - cos * sy * base.y,
                        sz, origin.z - sz * base.z)
                    emit(block.records, outer.after(local), depth + 1, ancestry + "${blockName.uppercase()}@$id")
                    continue
                }
                if (record.type !in SUPPORTED) { warn("不支持图元 ${record.type} ($id)，已忽略；原文件保留。"); continue }
                if (unsupportedOcs(record)) { warn("${record.type} $id 使用非默认 OCS，已跳过以避免坐标偏移。"); continue }
                val feature = feature(record, id, outer, layerColors, warnings)
                if (feature != null) {
                    require(featureIds.add(feature.id)) { "CAD 图元编号重复，无法安全导入。" }
                    vertexCount += geometryVertexCount(feature.geometry)
                    require(vertexCount <= MAX_VERTICES) { "CAD 展开坐标超过 $MAX_VERTICES 个顶点。" }
                    output += feature
                    require(output.size <= MAX_ENTITIES) { "CAD 输出图元超过 $MAX_ENTITIES 个上限。" }
                }
            }
        }
        emit(parsed.records, Transform(), 0, emptyList())
        val units = unitInfo(parsed.unitsCode)
        return NativeDxfDecoded(name.take(250), output, parsed.layers, units.first, units.second, parsed.crsHint, warnings.toList(), bytes.copyOf())
    }

    /** CRS, axis, and units are explicit inputs; this function never selects from coordinate magnitude. */
    fun projectFeatures(decoded: NativeDxfDecoded, source: NativeCadCrs?, axis: NativeCadAxis?, unitScale: Double?): List<NativeDxfFeature> {
        require(source != null) { "请明确选择源坐标系；不会从坐标数值猜测。" }
        require(axis != null) { "请确认 CAD 的 X/Y 轴序。" }
        require(unitScale != null && unitScale.isFinite() && unitScale > 0.0 && unitScale <= 1_000_000.0) { "单位比例必须大于0且不超过1000000。" }
        if (!decoded.crsHint.isNullOrBlank()) {
            val declared = NativeCadCrs.fromExplicitHint(decoded.crsHint)
                ?: throw IllegalArgumentException("文件声明的坐标系“${decoded.crsHint.take(160)}”尚未支持；不能覆盖为其他坐标系。")
            require(declared == source) { "所选坐标系与文件显式声明不一致，请核对原图坐标系。" }
        }
        return decoded.features.map { feature ->
            val geometry = feature.geometry
            val projected = when (geometry.getString("type")) {
                "Point" -> JSONObject().put("type", "Point").put("coordinates", projectPoint(geometry.getJSONArray("coordinates"), source, axis, unitScale))
                "LineString" -> JSONObject().put("type", "LineString").put("coordinates", projectLine(geometry.getJSONArray("coordinates"), source, axis, unitScale))
                "Polygon" -> JSONObject().put("type", "Polygon").put("coordinates", JSONArray().also { rings ->
                    val original = geometry.getJSONArray("coordinates")
                    for (i in 0 until original.length()) rings.put(projectLine(original.getJSONArray(i), source, axis, unitScale))
                })
                else -> throw IllegalArgumentException("CAD 几何类型不支持。")
            }
            feature.copy(geometry = projected)
        }
    }

    /** Builds the native WorkspaceStore cadDocuments schema after the user confirms CRS/axis/scale. */
    fun buildDocument(decoded: NativeDxfDecoded, source: NativeCadCrs?, axis: NativeCadAxis?, unitScale: Double?, createdAt: Long = System.currentTimeMillis()): JSONObject {
        val mapFeatures = projectFeatures(decoded, source, axis, unitScale)
        val sourceValue = requireNotNull(source)
        val axisValue = requireNotNull(axis)
        val scaleValue = requireNotNull(unitScale)
        val id = "cad-" + MessageDigest.getInstance("SHA-256").digest(decoded.sourceBytes).joinToString("") { "%02x".format(it) }
        return JSONObject().put("id", id).put("name", decoded.name).put("format", if(decoded.name.endsWith(".dwg",true))"dwg" else "dxf")
            .put("sourceBase64", Base64.getEncoder().encodeToString(decoded.sourceBytes))
            .put("sourceCrs", sourceValue.json()).put("axisOrder", if (axisValue == NativeCadAxis.XY) "xy" else "yx")
            .put("unitScale", scaleValue).put("createdAt", createdAt).put("visible", true)
            .put("features", JSONArray().also { a -> decoded.features.forEach { a.put(it.json()) } })
            .put("mapFeatures", JSONArray().also { a -> mapFeatures.forEach { a.put(it.json()) } })
            .put("layers", JSONArray().also { a -> decoded.layers.forEach { a.put(JSONObject(it.toString())) } })
            .put("warnings", JSONArray().also { a -> decoded.warnings.forEach { a.put(it) } })
            .put("units", decoded.units ?: JSONObject.NULL)
            .put("declaredUnitScale", decoded.declaredUnitScale ?: JSONObject.NULL)
            .also { decoded.crsHint?.let { hint -> it.put("crsHint", hint) } }
    }

    private fun projectLine(line: JSONArray, source: NativeCadCrs, axis: NativeCadAxis, scale: Double) = JSONArray().also { out ->
        for (i in 0 until line.length()) out.put(projectPoint(line.getJSONArray(i), source, axis, scale))
    }

    private fun projectPoint(point: JSONArray, source: NativeCadCrs, axis: NativeCadAxis, scale: Double): JSONArray {
        val x0 = point.getDouble(0); val y0 = point.getDouble(1)
        val z0 = if (point.length() > 2) point.getDouble(2) else 0.0
        require(abs(x0) <= MAX_COORDINATE_MAGNITUDE && abs(y0) <= MAX_COORDINATE_MAGNITUDE && z0.isFinite() && abs(z0) <= MAX_COORDINATE_MAGNITUDE) { "CAD 坐标超过安全范围。" }
        val x = (if (axis == NativeCadAxis.XY) x0 else y0) * scale
        val y = (if (axis == NativeCadAxis.XY) y0 else x0) * scale
        require(x.isFinite() && y.isFinite() && abs(x) <= MAX_COORDINATE_MAGNITUDE && abs(y) <= MAX_COORDINATE_MAGNITUDE) { "CAD 单位换算后坐标超过安全范围。" }
        val converted=com.shantu.nativeapp.coordinates.NativeCoordinateTransform.transform(listOf(x,y),com.shantu.nativeapp.coordinates.NativeProjectCrs(source.id,source.label,source.definition.takeIf{it.startsWith("+")},source.datumParameters))
        val lon=converted[0];val lat=converted[1]
        require(lon.isFinite() && lat.isFinite() && abs(lon) <= 180.0 && abs(lat) <= if (source == NativeCadCrs.WGS84) 90.0 else MAX_MERCATOR_LAT + 1e-8) { "CAD 坐标转换超出 WGS84 范围。" }
        val out = JSONArray().put(lon).put(lat)
        if (point.length() > 2) out.put(z0)
        return out
    }

    private fun parse(bytes: ByteArray): Parsed {
        val prefix = String(bytes, 0, minOf(bytes.size, 64 * 1024), Charset.forName("windows-1252"))
        val page = Regex("""\${'$'}DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n\s*([A-Z0-9_-]+)""", RegexOption.IGNORE_CASE).find(prefix)?.groupValues?.get(1)?.uppercase()
        val charsetName = when (page) {
            "ANSI_932" -> "Shift_JIS"; "ANSI_936" -> "GBK"; "ANSI_949" -> "EUC-KR"; "ANSI_950" -> "Big5"
            "ANSI_1250" -> "windows-1250"; "ANSI_1251" -> "windows-1251"; "ANSI_1252" -> "windows-1252"
            "ANSI_1253" -> "windows-1253"; "ANSI_1254" -> "windows-1254"; "ANSI_1255" -> "windows-1255"
            "ANSI_1256" -> "windows-1256"; "ANSI_1257" -> "windows-1257"; "ANSI_1258" -> "windows-1258"
            "UTF8", "UTF-8" -> "UTF-8"; else -> "UTF-8"
        }
        val charset = runCatching { Charset.forName(charsetName) }.getOrElse { throw IllegalArgumentException("不支持 DXF 代码页 $charsetName。", it) }
        val decoder = charset.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
        val reader = try { BufferedReader(InputStreamReader(ByteArrayInputStream(bytes), decoder)) }
        catch (e: Exception) { throw IllegalArgumentException("DXF 文本编码无效。", e) }
        val records = mutableListOf<Record>()
        val blocks = linkedMapOf<String, Block>()
        val layers = linkedMapOf<String, JSONObject>()
        val warnings = mutableListOf<String>()
        var section = ""
        var activeBlockName: String? = null
        var activeBlockBase = NativeCadPoint(0.0, 0.0, 0.0)
        var activeBlockRecords: MutableList<Record>? = null
        var activePolyline: Record? = null
        var current: Record? = null
        var pairs = 0
        var rawEntities = 0
        var unitsCode: Int? = null
        var crsHint: String? = null

        fun destination(): MutableList<Record>? = when {
            section == "ENTITIES" -> records
            section == "BLOCKS" -> activeBlockRecords
            else -> null
        }
        fun flush(record: Record?) {
            if (record == null) return
            when (record.type) {
                "SECTION" -> {
                    section = value(record, 2)?.trim()?.uppercase().orEmpty()
                    if (section == "HEADER") {
                        for (i in record.pairs.indices) if (record.pairs[i].code == 9) {
                            val variable = record.pairs[i].value.trim().uppercase()
                            val value = record.pairs.getOrNull(i + 1)?.value?.trim().orEmpty()
                            if (variable == "\$INSUNITS") unitsCode = record.pairs.getOrNull(i + 1)?.takeIf { it.code == 70 }?.value?.trim()?.toIntOrNull()
                            if (variable.contains("CRS") || variable.contains("SRS") || variable.contains("COORD") || variable.contains("PROJECTION")) {
                                crsHint = explicitCrs(value) ?: crsHint
                            }
                        }
                    }
                }
                "ENDSEC" -> { section = ""; activePolyline = null }
                "BLOCK" -> if (section == "BLOCKS") {
                    activeBlockName = value(record, 2)?.trim()?.takeIf { it.isNotEmpty() } ?: value(record, 3)?.trim()
                    activeBlockBase = point(record, 10, 20, 30)
                    activeBlockRecords = mutableListOf()
                }
                "ENDBLK" -> {
                    val name = activeBlockName
                    val nested = activeBlockRecords
                    if (!name.isNullOrBlank() && nested != null) blocks[name.uppercase()] = Block(name, activeBlockBase, nested)
                    activeBlockName = null; activeBlockRecords = null; activePolyline = null
                }
                "LAYER" -> if (section == "TABLES") {
                    val name = value(record, 2)?.takeIf { it.isNotEmpty() } ?: "0"
                    if (!layers.containsKey(name)) layers[name] = JSONObject().put("name", name).also { out -> entityColor(record)?.let { out.put("color", it) } }
                }
                "POLYLINE" -> {
                    val target = destination()
                    if (target != null) { target += record; activePolyline = record; rawEntities++ }
                }
                "VERTEX" -> {
                    if (activePolyline != null) activePolyline!!.vertices += record
                    else warnings += "发现没有 POLYLINE 头的 VERTEX，已忽略。"
                }
                "SEQEND" -> activePolyline = null
                "TABLE", "ENDTAB", "EOF" -> activePolyline = null
                else -> {
                    if (activePolyline != null) activePolyline = null
                    if (section == "ENTITIES" || section == "BLOCKS") {
                        val target = destination()
                        if (target != null) { target += record; rawEntities++ }
                    }
                }
            }
            require(rawEntities <= MAX_ENTITIES) { "DXF 原始图元超过 $MAX_ENTITIES 个上限。" }
        }

        try {
            while (true) {
                var codeLine = reader.readLine() ?: break
                if (pairs == 0) codeLine = codeLine.removePrefix("\uFEFF")
                val valueLine = reader.readLine() ?: throw IllegalArgumentException("DXF 组码缺少对应值。")
                val code = codeLine.trim().toIntOrNull() ?: throw IllegalArgumentException("DXF 组码无效：${codeLine.take(40)}")
                require(code in 0..1071) { "DXF 组码超出范围。" }
                pairs++
                require(pairs <= MAX_GROUP_PAIRS) { "DXF 组码数量超过安全上限 $MAX_GROUP_PAIRS。" }
                if (crsHint == null) {
                    crsHint = explicitCrs(valueLine)
                    if (crsHint == null && valueLine.length > 8192 && Regex("(PROJCS|GEOGCS|PROJCRS|GEOGCRS)\\s*\\[", RegexOption.IGNORE_CASE).containsMatchIn(valueLine)) {
                        warnings += "CAD 文件中的 WKT 坐标系定义超过 8192 字符，已忽略；请在导入时手动选择坐标系。"
                    }
                }
                if (code == 0) {
                    flush(current)
                    current = Record(valueLine.trim().uppercase())
                } else current?.pairs?.add(PairValue(code, valueLine))
            }
            flush(current)
        } catch (e: java.nio.charset.CharacterCodingException) {
            throw IllegalArgumentException("DXF 文本编码与声明的代码页不一致。", e)
        } finally { reader.close() }
        if (pairs < 2 || (section.isNotEmpty())) throw IllegalArgumentException("DXF section 结构不完整。")
        if (records.isEmpty()) warnings += "DXF ENTITIES 中没有可读模型空间图元。"
        return Parsed(records, blocks, layers.values.toList(), unitsCode, crsHint, warnings)
    }

    private fun feature(record: Record, id: String, transform: Transform, layerColors: Map<String, String?>, warnings: MutableList<String>): NativeDxfFeature? {
        val layer = value(record, 8)?.ifEmpty { "0" } ?: "0"
        val geometry: JSONObject
        var text: String? = null
        when (record.type) {
            "LINE" -> geometry = JSONObject().put("type", "LineString").put("coordinates", JSONArray().put(transform.apply(requiredPoint(record, 10, 20, 30)).json()).put(transform.apply(requiredPoint(record, 11, 21, 31)).json()))
            "POINT" -> geometry = JSONObject().put("type", "Point").put("coordinates", transform.apply(requiredPoint(record, 10, 20, 30)).json())
            "LWPOLYLINE", "POLYLINE" -> {
                val (points, bulges) = vertices(record)
                val closed = int(record, 70, 0) and 1 != 0
                if (points.size < if (closed) 3 else 2) { warnings += "$id 顶点不足，已跳过。"; return null }
                val expanded = mutableListOf(points.first())
                val segs = if (closed) points.size else points.size - 1
                for (i in 0 until segs) appendBulge(expanded, points[i], points[(i + 1) % points.size], bulges.getOrElse(i) { 0.0 })
                val coords = JSONArray()
                expanded.forEach { p -> coords.put(transform.apply(p).json()) }
                geometry = if (closed) JSONObject().put("type", "Polygon").put("coordinates", JSONArray().put(coords)) else JSONObject().put("type", "LineString").put("coordinates", coords)
                if (bulges.any { abs(it) > 1e-10 }) warnings += "$id 的 bulge 曲线已离散近似。"
            }
            "ARC", "CIRCLE" -> {
                val center = requiredPoint(record, 10, 20, 30)
                val radius = number(record, 40, Double.NaN)
                require(radius.isFinite() && radius > 0.0 && radius <= MAX_COORDINATE_MAGNITUDE) { "$id 半径无效。" }
                val startDegrees = number(record, 50, 0.0); val endDegrees = number(record, 51, 0.0)
                require(abs(startDegrees) <= 360_000.0 && abs(endDegrees) <= 360_000.0) { "$id 圆弧角度超过安全范围。" }
                val start = Math.toRadians(startDegrees); val end = Math.toRadians(endDegrees)
                val sweep = if (record.type == "CIRCLE") 2 * Math.PI else {
                    var v = end - start; while (v <= 0) v += 2 * Math.PI; v
                }
                val count = ceil(abs(sweep) / (Math.PI / 24)).toInt().coerceIn(2, MAX_CURVE_EDGES)
                val coordinates = JSONArray()
                val firstPoint = transform.apply(NativeCadPoint(center.x + cos(start) * radius, center.y + sin(start) * radius, center.z))
                for (i in 0..count) {
                    val angle = start + sweep * i / count
                    coordinates.put(if (record.type == "CIRCLE" && i == count) firstPoint.json() else transform.apply(NativeCadPoint(center.x + cos(angle) * radius, center.y + sin(angle) * radius, center.z)).json())
                }
                geometry = if (record.type == "CIRCLE") JSONObject().put("type", "Polygon").put("coordinates", JSONArray().put(coordinates)) else JSONObject().put("type", "LineString").put("coordinates", coordinates)
                warnings += "$id ${record.type} 已离散近似。"
            }
            "TEXT", "MTEXT" -> {
                val p = transform.apply(requiredPoint(record, 10, 20, 30))
                text = if (record.type == "TEXT") value(record, 1).orEmpty() else values(record, 3).joinToString("") + value(record, 1).orEmpty()
                text = text!!.replace("\\P", "\n").replace(Regex("\\\\[A-Za-z][^;]*;"), "").trim()
                if (text!!.length > MAX_TEXT_CHARS) throw IllegalArgumentException("$id 的文字超过 $MAX_TEXT_CHARS 字符，不能安全保存。")
                if (text!!.isEmpty()) return null
                geometry = JSONObject().put("type", "Point").put("coordinates", p.json())
            }
            else -> return null
        }
        val color = entityColor(record) ?: layerColors[layer]
        val raw = JSONArray().also { arr -> record.pairs.forEach { arr.put(JSONArray().put(it.code).put(it.value)) } }
        return NativeDxfFeature(id, layer, record.type, geometry, color, text, JSONObject().put("dxfRawGroups", raw))
    }

    private fun vertices(record: Record): Pair<List<NativeCadPoint>, List<Double>> {
        val points = mutableListOf<NativeCadPoint>()
        val bulges = mutableListOf<Double>()
        if (record.type == "POLYLINE") {
            for (v in record.vertices) {
                points += requiredPoint(v, 10, 20, 30)
                bulges += number(v, 42, 0.0)
            }
            return points to bulges
        }
        var x: Double? = null; var y: Double? = null; var bulge = 0.0
        val z = number(record, 38, 0.0)
        fun finish() { if (x != null && y != null) { points += NativeCadPoint(x!!, y!!, z); bulges += bulge }; x = null; y = null; bulge = 0.0 }
        for (pair in record.pairs) when (pair.code) {
            10 -> { finish(); x = parseNumber(pair.value, "LWPOLYLINE X") }
            20 -> y = parseNumber(pair.value, "LWPOLYLINE Y")
            42 -> bulge = parseNumber(pair.value, "LWPOLYLINE bulge")
        }
        finish()
        return points to bulges
    }

    private fun appendBulge(out: MutableList<NativeCadPoint>, start: NativeCadPoint, end: NativeCadPoint, bulge: Double) {
        if (!bulge.isFinite() || abs(bulge) < 1e-10) { out += end; return }
        val dx = end.x - start.x; val dy = end.y - start.y; val chord = hypot(dx, dy)
        if (chord == 0.0) return
        val sweep = 4.0 * atan(bulge); val radius = chord * (1 + bulge * bulge) / (4 * abs(bulge)); val offset = chord * (1 - bulge * bulge) / (4 * bulge)
        val cx = (start.x + end.x) / 2 - dy / chord * offset; val cy = (start.y + end.y) / 2 + dx / chord * offset
        val first = atan2(start.y - cy, start.x - cx)
        val count = ceil(abs(sweep) / (Math.PI / 16)).toInt().coerceIn(2, MAX_POLYLINE_ARC_EDGES)
        for (i in 1..count) {
            if (i == count) out += end else {
                val angle = first + sweep * i / count
                out += NativeCadPoint(cx + cos(angle) * radius, cy + sin(angle) * radius, start.z + (end.z - start.z) * i / count)
            }
            require(out.size <= MAX_VERTICES) { "CAD 单个曲线图元超过 $MAX_VERTICES 个顶点。" }
        }
    }

    private fun unsupportedOcs(record: Record): Boolean {
        if (record.type !in OCS_TYPES) return false
        val x = number(record, 210, 0.0); val y = number(record, 220, 0.0); val z = number(record, 230, 1.0)
        return abs(x) > 1e-9 || abs(y) > 1e-9 || abs(z - 1) > 1e-9
    }

    private fun point(record: Record, x: Int, y: Int, z: Int) = NativeCadPoint(number(record, x, 0.0), number(record, y, 0.0), number(record, z, 0.0))
    private fun requiredPoint(record: Record, x: Int, y: Int, z: Int): NativeCadPoint {
        require(value(record, x) != null && value(record, y) != null) { "${record.type} 缺少坐标组码 $x/$y。" }
        return point(record, x, y, z)
    }
    private fun value(record: Record, code: Int) = record.pairs.firstOrNull { it.code == code }?.value
    private fun values(record: Record, code: Int) = record.pairs.filter { it.code == code }.map { it.value }
    private fun number(record: Record, code: Int, fallback: Double): Double {
        val raw = value(record, code) ?: return fallback
        return parseNumber(raw, "DXF 组码 $code")
    }
    private fun int(record: Record, code: Int, fallback: Int): Int = value(record, code)?.trim()?.toIntOrNull() ?: fallback
    private fun parseNumber(raw: String, label: String): Double {
        val result = raw.trim().toDoubleOrNull() ?: throw IllegalArgumentException("$label 数值无效。")
        require(result.isFinite()) { "$label 数值无效。" }
        return result
    }
    private fun entityColor(record: Record): String? {
        val trueColor = value(record, 420)?.trim()?.toLongOrNull()?.takeIf { it in 0..0xffffffL }
        if (trueColor != null) return "#" + trueColor.toString(16).padStart(6, '0')
        val aci = int(record, 62, 256)
        val standard = mapOf(1 to "#ff0000", 2 to "#ffff00", 3 to "#00ff00", 4 to "#00ffff", 5 to "#0000ff", 6 to "#ff00ff", 7 to "#ffffff", 8 to "#808080", 9 to "#c0c0c0")
        return standard[abs(aci)]
    }
    private fun geometryVertexCount(g: JSONObject): Int = when (g.getString("type")) {
        "Point" -> 1
        "LineString" -> g.getJSONArray("coordinates").length()
        else -> { val rings = g.getJSONArray("coordinates"); (0 until rings.length()).sumOf { rings.getJSONArray(it).length() } }
    }

    private fun explicitCrs(raw: String): String? {
        val text = raw.trim()
        val epsg = Regex("EPSG\\s*[:=]\\s*(\\d{4,6})", RegexOption.IGNORE_CASE).find(text)?.groupValues?.get(1)
            ?: Regex("AUTHORITY\\s*\\[\\s*\\\"EPSG\\\"\\s*,\\s*\\\"(\\d+)\\\"", RegexOption.IGNORE_CASE).find(text)?.groupValues?.get(1)
        if (epsg != null) return "EPSG:$epsg"
        return text.takeIf { it.length <= 8192 && Regex("(PROJCS|GEOGCS|PROJCRS|GEOGCRS)\\s*\\[", RegexOption.IGNORE_CASE).containsMatchIn(it) }
    }

    private fun unitInfo(code: Int?): Pair<String?, Double?> {
        val units = mapOf(1 to ("inches" to .0254), 2 to ("feet" to .3048), 3 to ("miles" to 1609.344), 4 to ("millimeters" to .001), 5 to ("centimeters" to .01), 6 to ("meters" to 1.0), 7 to ("kilometers" to 1000.0), 8 to ("microinches" to 2.54e-8), 9 to ("mils" to 2.54e-5), 10 to ("yards" to .9144), 11 to ("angstroms" to 1e-10), 12 to ("nanometers" to 1e-9), 13 to ("microns" to 1e-6), 14 to ("decimeters" to .1), 15 to ("decameters" to 10.0), 16 to ("hectometers" to 100.0), 17 to ("gigameters" to 1e9), 18 to ("astronomical units" to 149597870700.0), 19 to ("light years" to 9.460730472e15), 20 to ("parsecs" to 3.085677581491367e16), 21 to ("US survey feet" to 1200.0 / 3937), 22 to ("US survey inches" to 100.0 / 3937), 23 to ("US survey yards" to 3600.0 / 3937), 24 to ("US survey miles" to 6336000.0 / 3937))
        return units[code] ?: (null to null)
    }

    private val SUPPORTED = setOf("LINE", "POINT", "LWPOLYLINE", "POLYLINE", "ARC", "CIRCLE", "TEXT", "MTEXT", "INSERT")
    private val OCS_TYPES = setOf("POINT", "CIRCLE", "ARC", "LWPOLYLINE", "POLYLINE", "TEXT", "MTEXT", "INSERT")
}
