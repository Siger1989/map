package com.shantu.nativeapp.data

import com.shantu.nativeapp.map.NativeMapSourceCatalog
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets
import java.util.zip.DataFormatException
import java.util.zip.Inflater

enum class NativeSourceImportFormat { JSON, OVMAP, OVI_QR }

/** Safe import diagnostic: never stores or prints a source URL, token, or OVMAP host. */
class NativeSourceImportIssue(val index: Int, val reason: String) {
    override fun toString() = "NativeSourceImportIssue(index=$index, reason=$reason)"
}

/** Entries keep the exact source JSON (including unknown fields) but redact it from diagnostics. */
class NativeSourceImportEntry internal constructor(source: JSONObject) {
    private val value = JSONObject(source.toString())
    val id: String get() = value.optString("id")
    val name: String get() = value.optString("name")
    fun toJson(): JSONObject = JSONObject(value.toString())
    override fun toString() = "NativeSourceImportEntry(credentials=redacted)"
}

class NativeSourceImportResult internal constructor(
    val format: NativeSourceImportFormat,
    val entries: List<NativeSourceImportEntry>,
    val issues: List<NativeSourceImportIssue>,
    val totalRecords: Int,
) {
    fun toMapSourcesArray() = JSONArray().also { array -> entries.forEach { array.put(it.toJson()) } }
    override fun toString() = "NativeSourceImportResult(format=$format, accepted=${entries.size}, issues=${issues.size}, total=$totalRecords)"
}

data class NativeMapSourceExportValidation(val count: Int, val totalBytes: Long)

/**
 * Importer for the project's supported native online-raster schema and OviO type-37 OVMAP files.
 * Parsing is bounded, does no network work, and never puts full source URLs into exception text.
 */
object NativeSourceImport {
    const val MAX_CONFIG_BYTES = 1_048_576
    private const val MAX_INFLATED_BYTES = 4 * 1024 * 1024
    private const val MAX_FRAME_BYTES = 64 * 1024
    private const val MAX_RECORDS = 100
    private const val MAX_MAP_FILE_BYTES = 64L * 1024 * 1024
    private const val MAX_MAP_STORAGE_BYTES = 256L * 1024 * 1024
    private const val HEADER_BYTES = 24
    private const val BODY_STRINGS_OFFSET = 120
    private const val FRAME_TYPE = 37
    private const val BODY_REVISION = 102
    private const val TLS_FLAG = 0x10000
    private val qrFields = setOf("t", "id", "na", "gp", "po", "ml", "pn", "mt", "mf", "pt", "hn", "ul")

    fun importFile(fileName: String, bytes: ByteArray): NativeSourceImportResult = when {
        fileName.endsWith(".ovmap", ignoreCase = true) -> parseOvmap(bytes)
        fileName.endsWith(".json", ignoreCase = true) -> parseJson(bytes)
        else -> throw IllegalArgumentException("文件格式不支持；请选择 JSON 或 OVMAP 图源文件")
    }

    fun parseJson(bytes: ByteArray): NativeSourceImportResult {
        require(bytes.size in 1..MAX_CONFIG_BYTES) { "JSON 图源文件为空或超过 1 MB 安全上限" }
        val text = decodeUtf8(bytes, "JSON 图源文件")
        return parseJson(text)
    }

    fun parseJson(text: String): NativeSourceImportResult {
        val bytes = text.toByteArray(StandardCharsets.UTF_8)
        require(bytes.size in 1..MAX_CONFIG_BYTES) { "JSON 图源文本为空或超过 1 MB 安全上限" }
        val tokener = JSONTokener(text)
        val parsed = try { tokener.nextValue() } catch (_: Exception) {
            throw IllegalArgumentException("JSON 图源文件无法解析")
        }
        if (tokener.nextClean() != '\u0000') throw IllegalArgumentException("JSON 图源文件包含尾随内容")
        val root = when (parsed) {
            is JSONObject -> JSONObject(parsed.toString())
            is JSONArray -> JSONObject().put("mapSources", JSONArray(parsed.toString()))
            else -> throw IllegalArgumentException("JSON 图源文件须为对象或图源数组")
        }
        val array = root.optJSONArray("maps") ?: root.optJSONArray("mapSources")
            ?: throw IllegalArgumentException("JSON 图源配置缺少 maps 或 mapSources 数组")
        if (array.length() > MAX_RECORDS) throw IllegalArgumentException("一次最多导入 $MAX_RECORDS 个图源")
        val accepted = mutableListOf<NativeSourceImportEntry>()
        val issues = mutableListOf<NativeSourceImportIssue>()
        for (index in 0 until array.length()) {
            val item = array.optJSONObject(index)
            if (item == null) {
                issues += NativeSourceImportIssue(index, "图源配置必须是 JSON 对象")
                continue
            }
            if (item.optString("kind", "online").lowercase() in setOf("mbtiles", "geotiff", "image")) {
                issues += NativeSourceImportIssue(index, "本地离线文件不能通过图源配置 JSON 复制；请导入本地文件或工作区备份")
                continue
            }
            val catalog = NativeMapSourceCatalog.fromJson(JSONObject().put("maps", JSONArray().put(item)))
            if (catalog.sources.size == 1 && catalog.errors.isEmpty()) accepted += NativeSourceImportEntry(item)
            else issues += NativeSourceImportIssue(index, catalog.errors.firstOrNull()?.reason ?: "图源结构不受支持")
        }
        return NativeSourceImportResult(NativeSourceImportFormat.JSON, accepted, issues, array.length())
    }

    /** Validates one combined online + local raster mapSources list before a workspace export. */
    fun validateExportMaps(sources: JSONArray): NativeMapSourceExportValidation {
        require(sources.length() <= MAX_RECORDS) { "工作区图源最多100项（在线图源与本地文件合计）" }
        val ids = hashSetOf<String>()
        var totalBytes = 0L
        for (index in 0 until sources.length()) {
            val source = sources.optJSONObject(index) ?: throw IllegalArgumentException("第${index + 1}项图源不是对象")
            val id = source.optString("id")
            require(id.isNotBlank() && id.length <= 250 && ids.add(id)) { "工作区图源含空编号或重复 ID" }
            val kind = source.optString("kind", "online").lowercase()
            if (kind in setOf("mbtiles", "geotiff", "image")) validateLocalExportRecord(source, kind, index)
            else {
                require(kind == "online") { "第${index + 1}项图源格式不支持" }
                val catalog = NativeMapSourceCatalog.fromJson(JSONObject().put("maps", JSONArray().put(source)))
                require(catalog.sources.size == 1 && catalog.errors.isEmpty()) { catalog.errors.firstOrNull()?.reason ?: "第${index + 1}项在线图源无效" }
            }
            val bytesValue = source.opt("bytes")
            require(bytesValue is Number && bytesValue.toDouble().isFinite() && bytesValue.toDouble() >= 0.0 && bytesValue.toDouble() % 1.0 == 0.0 && bytesValue.toDouble() <= Long.MAX_VALUE.toDouble()) { "第${index + 1}项图源容量无效" }
            val bytes = bytesValue.toLong()
            totalBytes = try { Math.addExact(totalBytes, bytes) } catch (_: ArithmeticException) { throw IllegalArgumentException("工作区图源容量溢出") }
            require(totalBytes <= MAX_MAP_STORAGE_BYTES) { "工作区图源总量超过256MiB（在线图源与本地文件合计）" }
            if (source.has("blobBase64")) {
                val encoded = source.optString("blobBase64")
                require(encoded.length <= ((MAX_MAP_FILE_BYTES + 2) / 3 * 4 + 4)) { "第${index + 1}项图源文件超过64MiB" }
                val raw = try { java.util.Base64.getDecoder().decode(encoded) } catch (_: Exception) { throw IllegalArgumentException("第${index + 1}项图源Base64无效") }
                require(raw.size.toLong() <= MAX_MAP_FILE_BYTES && bytes >= raw.size) { "第${index + 1}项图源文件容量声明无效" }
                require(source.optString("blobMime").length in 1..100) { "第${index + 1}项图源MIME类型无效" }
            }
        }
        return NativeMapSourceExportValidation(sources.length(), totalBytes)
    }

    /** WorkspaceStore should persist online definitions here; local raster rows remain in the file store. */
    fun onlineDefinitions(sources: JSONArray): JSONArray = JSONArray().also { result ->
        for (i in 0 until sources.length()) {
            val item = sources.optJSONObject(i) ?: continue
            if (item.optString("kind", "online").equals("online", true)) result.put(JSONObject(item.toString()))
        }
    }

    private fun validateLocalExportRecord(source: JSONObject, kind: String, index: Int) {
        require(source.optString("name").trim().isNotEmpty() && source.optString("name").length <= 240 &&
            source.optString("format").isNotBlank() && source.optString("format").length <= 80 &&
            source.optString("attribution").length <= 1000) { "第${index + 1}项本地图源元数据无效" }
        val min = source.optInt("minzoom", 0); val max = source.optInt("maxzoom", 22)
        require(min in 0..24 && max in min..24 && source.optInt("tileSize", 256) in setOf(256, 512, 1024, 2048)) { "第${index + 1}项本地图源缩放参数无效" }
        val bounds = source.optJSONArray("bounds")
        if (bounds != null) require(bounds.length() == 4 && (0..3).all { bounds.opt(it) is Number && bounds.optDouble(it).isFinite() } &&
            bounds.getDouble(0) < bounds.getDouble(2) && bounds.getDouble(1) < bounds.getDouble(3) && bounds.getDouble(0) >= -180 && bounds.getDouble(2) <= 180 && bounds.getDouble(1) >= -85.051129 && bounds.getDouble(3) <= 85.051129) { "第${index + 1}项本地图源范围无效" }
        if (kind == "image") require(bounds != null) { "第${index + 1}项配准影像缺少明确地理范围" }
        val hasBlob = source.opt("blobBase64") is String && source.optString("blobBase64").isNotBlank()
        val path = source.optString("filePath", source.optString("path"))
        require(hasBlob || path.isNotBlank() && java.io.File(path).isFile) { "第${index + 1}项本地离线文件缺少可导出的文件内容" }
        if (!hasBlob) {
            val file = java.io.File(path)
            require(file.length() in 1..MAX_MAP_FILE_BYTES && source.optLong("bytes", -1) >= file.length()) { "第${index + 1}项本地文件大小或容量声明无效" }
        }
        if (kind == "image" && source.has("imageGeoref")) {
            val georef = source.optJSONObject("imageGeoref") ?: throw IllegalArgumentException("第${index + 1}项影像配准数据无效")
            val affine = georef.optJSONArray("affine")
            require(georef.optString("sourceCrs").isNotBlank() && affine?.length() == 6 && (0 until 6).all { affine.opt(it) is Number && affine.optDouble(it).isFinite() } &&
                georef.optInt("width") in 2..16000 && georef.optInt("height") in 2..16000) { "第${index + 1}项影像仿射配准无效" }
        }
    }

    /** Accepts only decoded scan text. Camera and barcode decoding stay in the host app. */
    fun parseScannedText(decodedText: String): NativeSourceImportResult {
        val trimmed = decodedText.trim()
        return when {
            trimmed.startsWith("ovobj?", ignoreCase = true) -> {
                val source = parseOviQrSource(trimmed)
                NativeSourceImportResult(NativeSourceImportFormat.OVI_QR, listOf(NativeSourceImportEntry(source)), emptyList(), 1)
            }
            trimmed.startsWith("{") || trimmed.startsWith("[") -> parseJson(trimmed)
            else -> throw IllegalArgumentException("扫码内容不是已支持的图源 JSON 或 OVI 自定义地图内容")
        }
    }

    fun parseOvmap(bytes: ByteArray): NativeSourceImportResult {
        require(bytes.size in HEADER_BYTES..MAX_CONFIG_BYTES) { "OVMAP 文件头不完整或文件超过 1 MB 安全上限" }
        require(String(bytes, 0, 4, StandardCharsets.US_ASCII) == "OviO") { "文件不是受支持的 OVMAP 容器" }
        require(readU32(bytes, 4) == bytes.size.toLong()) { "OVMAP 文件长度与文件头不一致" }
        require(readU32(bytes, 12) == 104L && readU32(bytes, 16) == 100L && readU32(bytes, 20) == 0L) {
            "此 OVMAP 容器版本或封装方式尚未支持"
        }
        val inflatedLength = readU32(bytes, 8).toInt()
        val payload = inflateBounded(bytes, HEADER_BYTES, bytes.size - HEADER_BYTES, inflatedLength)
        val records = mutableListOf<OvmapRecord>()
        val issues = mutableListOf<NativeSourceImportIssue>()
        var offset = 0
        var total = 0
        while (offset < payload.size) {
            if (total >= MAX_RECORDS) throw IllegalArgumentException("一次最多导入 $MAX_RECORDS 个图源")
            if (offset + 8 > payload.size) throw IllegalArgumentException("OVMAP 帧头不完整")
            val frameLength = readU32(payload, offset).toInt()
            val frameType = readU32(payload, offset + 4).toInt()
            val frameEnd = offset.toLong() + 8L + frameLength
            total++
            if (frameLength < BODY_STRINGS_OFFSET + 12 || frameLength > MAX_FRAME_BYTES || frameEnd > payload.size)
                throw IllegalArgumentException("第 $total 个 OVMAP 记录长度无效")
            val end = frameEnd.toInt()
            try {
                records += readRecord(payload, offset, frameLength, frameType, total)
            } catch (error: UnsupportedOmapRecord) {
                issues += NativeSourceImportIssue(total - 1, error.message ?: "此 OVMAP 记录无法识别")
            }
            offset = end
        }

        val accepted = mutableListOf<NativeSourceImportEntry>()
        records.forEachIndexed { index, record ->
            val reason = recordUnsupportedReason(record)
            if (reason != null) {
                issues += NativeSourceImportIssue(index, reason)
                return@forEachIndexed
            }
            try {
                accepted += NativeSourceImportEntry(toOmapJson(record, records))
            } catch (error: Exception) {
                issues += NativeSourceImportIssue(index, error.message?.take(200) ?: "OVMAP 图源模板不受支持")
            }
        }
        return NativeSourceImportResult(NativeSourceImportFormat.OVMAP, accepted, issues, total)
    }

    private data class OvmapRecord(
        val id: Long, val index: Int, val revision: Long, val minZoom: Long, val maxZoom: Long,
        val coordType: Long, val tileFormat: Long, val hostStart: Int, val hostEnd: Int,
        val port: Int, val tileSize: Long, val overlayBig: Long, val overlaySmall: Long,
        val overlayFlags: List<Long>, val layerFlags: Long, val tls: Boolean,
        val name: String, val host: String, val path: String,
    )

    private fun readRecord(payload: ByteArray, frameStart: Int, frameLength: Int, frameType: Int, index: Int): OvmapRecord {
        if (frameType != FRAME_TYPE) throw UnsupportedOmapRecord("OVMAP 记录类型暂不支持")
        val body = frameStart + 8
        val frameEnd = body + frameLength
        if (readU32(payload, body) != FRAME_TYPE.toLong()) throw UnsupportedOmapRecord("OVMAP 记录类型无效")
        val revision = readU32(payload, body + 4)
        if (revision != BODY_REVISION.toLong()) throw UnsupportedOmapRecord("OVMAP 图源记录版本暂不支持")
        val packedHost = readU32(payload, body + 36).toInt()
        var cursor = body + BODY_STRINGS_OFFSET
        fun nextString(max: Int, error: String): String {
            if (cursor + 4 > frameEnd) throw UnsupportedOmapRecord(error)
            val length = readU32(payload, cursor).toInt()
            if (length > max) throw UnsupportedOmapRecord("OVMAP 文本字段超过安全上限")
            cursor += 4
            if (cursor.toLong() + length > frameEnd) throw UnsupportedOmapRecord("OVMAP 文本字段超出记录范围")
            val result = decodeUtf8(payload.copyOfRange(cursor, cursor + length), "OVMAP 图源文本")
            cursor += length
            return result
        }
        val name = nextString(1024, "OVMAP 图源名称字段缺失").replace(Regex("<[^>]*>"), "").trim().take(240)
        val host = nextString(512, "OVMAP 主机字段缺失")
        val path = nextString(8192, "OVMAP 模板字段缺失")
        return OvmapRecord(
            id = readU32(payload, body + 16), index = index, revision = revision,
            minZoom = readU32(payload, body + 20), maxZoom = readU32(payload, body + 24),
            coordType = readU32(payload, body + 28), tileFormat = readU32(payload, body + 32),
            port = packedHost and 0xffff, hostStart = (packedHost ushr 16) and 0xff, hostEnd = (packedHost ushr 24) and 0xff,
            tileSize = readU32(payload, body + 40), overlayBig = readU32(payload, body + 44),
            overlaySmall = readU32(payload, body + 48), overlayFlags = listOf(readU32(payload, body + 52), readU32(payload, body + 56)),
            layerFlags = readU32(payload, body + 60), tls = (readU32(payload, body + 64).toInt() and TLS_FLAG) != 0,
            name = name.ifBlank { "未命名图源" }, host = host, path = path,
        )
    }

    private fun recordUnsupportedReason(record: OvmapRecord): String? = when {
        record.coordType !in 0L..1L -> "此图源使用未支持的投影坐标类型"
        record.tileSize !in setOf(0L, 256L, 512L) -> "此图源瓦片尺寸暂不支持"
        record.tileFormat !in setOf(3L, 4L) -> "此图源栅格格式暂不支持"
        record.minZoom > 24 || record.maxZoom > 24 || record.maxZoom < record.minZoom -> "此图源缩放级别超出支持范围"
        !record.path.startsWith("/") || record.path.any { it.code < 0x20 || it.code == 0x7f } -> "OVMAP 模板不是安全的相对路径"
        record.host.contains("://") || record.host.any { it.isWhitespace() || it in "/?#@" } -> "OVMAP 图源主机名无效"
        record.port !in 1..65535 -> "OVMAP 图源端口无效"
        else -> null
    }

    private fun toOmapJson(record: OvmapRecord, records: List<OvmapRecord>): JSONObject {
        val base = toLayer(record)
        val layers = JSONArray().put(base)
        val missing = JSONArray()
        if ((record.layerFlags and 0xffL) != 0L) {
            listOf(record.overlayBig, record.overlaySmall).filter { it != 0L }.distinct().forEach { overlayId ->
                if (overlayId == record.id) return@forEach
                val overlay = records.firstOrNull { it.id == overlayId }
                if (overlay == null || recordUnsupportedReason(overlay) != null || overlay.coordType != record.coordType) {
                    missing.put(overlayId)
                } else {
                    try { layers.put(toLayer(overlay)) } catch (_: Exception) { missing.put(overlayId) }
                }
            }
        }
        val source = JSONObject()
            .put("id", "ovmap-${record.id}")
            .put("name", record.name)
            .put("kind", "online")
            .put("format", "OVMAP")
            .put("tiles", base.getJSONArray("tiles"))
            .put("tileSize", 256)
            .put("scheme", "xyz")
            .put("minzoom", record.minZoom)
            .put("maxzoom", record.maxZoom)
            .put("datum", if (record.coordType == 1L) "gcj02" else "wgs84")
            .put("attribution", "用户提供的 OVMAP 图源")
            .put("ovmap", JSONObject()
                .put("layers", layers)
                .put("sourceId", record.id)
                .put("coordType", record.coordType)
                .put("declaredTileSize", record.tileSize)
                .put("overlayIds", JSONArray().put(record.overlayBig).put(record.overlaySmall))
                .put("overlayFlags", JSONArray().put(record.overlayFlags[0]).put(record.overlayFlags[1])))
        if (missing.length() > 0) {
            source.getJSONObject("ovmap").put("missingOverlayIds", missing)
            source.put("detail", "已导入底图；合集内部分附加图层暂未适配")
        }
        val catalog = NativeMapSourceCatalog.fromJson(JSONObject().put("maps", JSONArray().put(source)))
        if (catalog.sources.size != 1) throw IllegalArgumentException(catalog.errors.firstOrNull()?.reason ?: "OVMAP 模板不受支持")
        return source
    }

    private fun toLayer(record: OvmapRecord): JSONObject {
        val hosts = expandHosts(record)
        require(hosts.isNotEmpty() && hosts.size <= 8) { "OVMAP 子域数量超出支持范围" }
        val scheme = if (record.tls) "https" else "http"
        val defaultPort = if (record.tls) 443 else 80
        val port = if (record.port == defaultPort) "" else ":${record.port}"
        val tiles = JSONArray()
        hosts.forEach { host ->
            val url = "$scheme://$host$port${record.path}"
            val parsed = try { java.net.URL(url) } catch (_: Exception) { throw IllegalArgumentException("OVMAP 图源地址无效") }
            if (parsed.host.isBlank() || parsed.userInfo != null || parsed.ref != null) throw IllegalArgumentException("OVMAP 图源地址包含不支持的凭据或片段")
            tiles.put(url)
        }
        val size = if (record.tileSize == 0L) 256L else record.tileSize
        return JSONObject().put("tiles", tiles)
            .put("minzoom", record.minZoom).put("maxzoom", record.maxZoom).put("tileSize", size)
            .put("subdivide", Regex("\\{\\\$x/2\\}", RegexOption.IGNORE_CASE).containsMatchIn(record.path) &&
                Regex("\\{\\\$y/2\\}", RegexOption.IGNORE_CASE).containsMatchIn(record.path) &&
                Regex("\\{\\\$z-1\\}", RegexOption.IGNORE_CASE).containsMatchIn(record.path))
    }

    private fun expandHosts(record: OvmapRecord): List<String> {
        val token = "{\$serverpart}"
        if (!record.host.contains(token)) return listOf(record.host)
        fun validPart(value: Int) = value in 0..9 || value in 48..57 || value in 97..122
        if (!validPart(record.hostStart) || !validPart(record.hostEnd) || record.hostEnd < record.hostStart ||
            (record.hostStart <= 9) != (record.hostEnd <= 9) || record.hostEnd - record.hostStart + 1 > 8
        ) throw IllegalArgumentException("OVMAP 子域编号范围无效或超过8个")
        return (record.hostStart..record.hostEnd).map { value ->
            record.host.replace(token, if (record.hostStart <= 9) value.toString() else value.toChar().toString())
        }
    }

    private fun parseOviQrSource(text: String): JSONObject {
        require(text.toByteArray(StandardCharsets.UTF_8).size <= MAX_CONFIG_BYTES) { "扫码内容超过安全上限" }
        val rawQuery = text.substringAfter('?', "")
        require(rawQuery.isNotEmpty()) { "OVI 二维码字段缺失" }
        val fields = linkedMapOf<String, MutableList<String>>()
        rawQuery.split('&').forEach { pair ->
            val split = pair.indexOf('=')
            val key = if (split < 0) pair else pair.substring(0, split)
            val rawValue = if (split < 0) "" else pair.substring(split + 1)
            val value = try { java.net.URLDecoder.decode(rawValue.replace("+", "%2B"), "UTF-8") }
                catch (_: Exception) { throw IllegalArgumentException("OVI 二维码转义内容无效") }
            fields.getOrPut(key) { mutableListOf() }.add(value)
        }
        fields.keys.firstOrNull { it !in qrFields }?.let { key ->
            if (key in setOf("at", "ad", "al")) throw IllegalArgumentException("此 OVI 二维码含未支持的专有历史地图数据")
            throw IllegalArgumentException("OVI 二维码含未支持字段")
        }
        fields.entries.firstOrNull { it.value.size != 1 }?.let { throw IllegalArgumentException("OVI 二维码字段重复") }
        fun required(key: String) = fields[key]?.singleOrNull()?.takeIf(String::isNotEmpty)
            ?: throw IllegalArgumentException("OVI 二维码缺少 $key 字段")
        fun integer(key: String, min: Long, max: Long): Long {
            val value = required(key)
            val parsed = value.toLongOrNull() ?: throw IllegalArgumentException("OVI 二维码字段不是有效整数")
            require(parsed in min..max) { "OVI 二维码字段超出支持范围" }
            return parsed
        }
        require(integer("t", 0, 65535) == 37L) { "暂不支持此 OVI 二维码类型" }
        val id = integer("id", 1, 0xffffffffL)
        val name = decodeBase64Utf8(required("na"), "地图名称").replace(Regex("<[^>]*>"), "").trim().take(240)
        decodeBase64Utf8(required("gp"), "图源分类") // Validate the field, but never expose it in diagnostics.
        require(name.isNotBlank()) { "OVI 二维码中的地图名称为空" }
        val projection = integer("po", 0, 255)
        if (projection == 3L) throw IllegalArgumentException("此 OVI 二维码属于未支持的历史专有图源格式")
        require(projection == 1L) { "OVI 投影类型暂不支持" }
        val coord = integer("pn", 0, 1)
        require(integer("mt", 0, 255) == 1L) { "此 OVI 二维码地图类型暂不支持" }
        require(integer("mf", 0, 255) == 3L) { "此 OVI 二维码栅格格式暂不支持" }
        val maxZoom = integer("ml", 0, 24)
        val port = integer("pt", 1, 65535).toInt()
        require(port == 80 || port == 443) { "OVI 图源端口仅支持 HTTP 80 或 HTTPS 443" }
        val host = decodeBase64Utf8(required("hn"), "主机名")
        val path = decodeBase64Utf8(required("ul"), "瓦片模板")
        require(host.length <= 253 && host.isNotBlank() && !host.contains("://") && host.none { it.isWhitespace() || it in "/?#@:\\" }) {
            "OVI 图源主机名无效"
        }
        require(path.startsWith('/') && path.length <= 8192 && path.none { it.code < 0x21 || it.code == 0x7f || it in "#\\" }) {
            "OVI 瓦片模板不是安全相对路径"
        }
        require(Regex("\\{\\$?[xyz](?:[+*/-]\\d+)?\\}", RegexOption.IGNORE_CASE).containsMatchIn(path)) {
            "OVI 二维码未提供可识别的瓦片模板"
        }
        val tls = port == 443
        val record = OvmapRecord(id, 1, BODY_REVISION.toLong(), 0, maxZoom, coord, 3, 0, 0, port,
            256, 0, 0, listOf(0, 0), 0, tls, name, host, path)
        val layer = toLayer(record)
        val source = JSONObject()
            .put("id", "ovi-$id").put("name", name).put("kind", "online").put("format", "OVMAP")
            .put("tiles", layer.getJSONArray("tiles")).put("tileSize", 256).put("scheme", "xyz")
            .put("minzoom", 0).put("maxzoom", maxZoom).put("datum", if (coord == 1L) "gcj02" else "wgs84")
            .put("attribution", "用户提供的 OVI 图源二维码")
            .put("ovmap", JSONObject().put("layers", JSONArray().put(layer)).put("sourceId", id).put("coordType", coord))
        val catalog = NativeMapSourceCatalog.fromJson(JSONObject().put("maps", JSONArray().put(source)))
        require(catalog.sources.size == 1) { catalog.errors.firstOrNull()?.reason ?: "OVI 图源模板不受支持" }
        return source
    }

    private fun decodeBase64Utf8(value: String, label: String): String {
        require(value.isNotEmpty() && value.length <= 100_000 && Regex("^[A-Za-z0-9+/_-]*={0,2}$").matches(value)) {
            "OVI 二维码 $label 字段不是有效 Base64"
        }
        val normalized = value.replace('-', '+').replace('_', '/')
        require(normalized.trimEnd('=').length % 4 != 1) { "OVI 二维码 $label 字段长度无效" }
        val padded = normalized.trimEnd('=') + "=".repeat((4 - normalized.trimEnd('=').length % 4) % 4)
        val bytes = try { java.util.Base64.getDecoder().decode(padded) } catch (_: Exception) {
            throw IllegalArgumentException("OVI 二维码 $label 字段无法解码")
        }
        return decodeUtf8(bytes, "OVI 二维码 $label")
    }

    private fun inflateBounded(input: ByteArray, offset: Int, length: Int, expected: Int): ByteArray {
        if (expected !in 1..MAX_INFLATED_BYTES) throw IllegalArgumentException("OVMAP 解压数据超过安全上限")
        val inflater = Inflater()
        try {
            inflater.setInput(input, offset, length)
            val output = ByteArrayOutputStream(expected)
            val buffer = ByteArray(8192)
            while (!inflater.finished()) {
                val count = try { inflater.inflate(buffer) } catch (_: DataFormatException) {
                    throw IllegalArgumentException("OVMAP zlib 数据无效")
                }
                if (count > 0) {
                    if (output.size().toLong() + count > expected || output.size().toLong() + count > MAX_INFLATED_BYTES)
                        throw IllegalArgumentException("OVMAP 解压数据长度超出声明")
                    output.write(buffer, 0, count)
                } else if (inflater.needsDictionary() || inflater.needsInput()) {
                    throw IllegalArgumentException("OVMAP zlib 数据不完整")
                }
            }
            if (output.size() != expected) throw IllegalArgumentException("OVMAP 解压长度与文件头不一致")
            if (inflater.remaining !in setOf(0, 16)) throw IllegalArgumentException("OVMAP 容器尾部结构不受支持")
            return output.toByteArray()
        } finally {
            inflater.end()
        }
    }

    private fun readU32(bytes: ByteArray, offset: Int): Long {
        if (offset < 0 || offset + 4 > bytes.size) throw IllegalArgumentException("图源文件结构不完整")
        return ByteBuffer.wrap(bytes, offset, 4).order(java.nio.ByteOrder.LITTLE_ENDIAN).int.toLong() and 0xffffffffL
    }

    private fun decodeUtf8(bytes: ByteArray, label: String): String = try {
        StandardCharsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
            .decode(ByteBuffer.wrap(bytes)).toString()
    } catch (_: Exception) {
        throw IllegalArgumentException("$label 不是有效 UTF-8")
    }

    private class UnsupportedOmapRecord(message: String) : Exception(message)
}
