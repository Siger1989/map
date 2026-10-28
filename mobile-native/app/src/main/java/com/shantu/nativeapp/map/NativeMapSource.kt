package com.shantu.nativeapp.map

import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.net.URL
import java.security.MessageDigest
import java.nio.charset.StandardCharsets

enum class NativeTileScheme { XYZ, TMS, WMTS }
enum class NativeRasterDatum { WGS84, GCJ02, BD09 }

internal data class NativeRasterWarpPlan(
    val points: DoubleArray,
    val left: Int,
    val top: Int,
    val width: Int,
    val height: Int,
    val tileSize: Int,
)

data class NativeMapRasterLayer internal constructor(
    internal val tiles: List<String>,
    val minZoom: Int,
    val maxZoom: Int,
    val tileSize: Int,
    val scheme: NativeTileScheme,
    val subdivide: Boolean,
    internal val ovmapTemplate: Boolean,
) {
    val outputTileSize: Int get() = if (subdivide) tileSize / 2 else tileSize
    val outputMinZoom: Int get() = minZoom
    val outputMaxZoom: Int get() = maxZoom
    override fun toString() = "NativeMapRasterLayer(zoom=$minZoom..$maxZoom, tileSize=$outputTileSize, templates=${tiles.size}, credentials=redacted)"
}

/** A supported online raster source. URL templates and credentials are redacted in toString(). */
class NativeMapSource internal constructor(
    val id: String,
    val name: String,
    val layers: List<NativeMapRasterLayer>,
    val datum: NativeRasterDatum,
    val tileSize: Int,
    val attribution: String,
    internal val subdomains: List<String>,
    internal val token: String,
    internal val tileMatrixSet: String?,
    val format: String,
    val limitations: List<String>,
    val kind: String = "online",
    val localFilePath: String? = null,
    val bounds: List<Double>? = null,
) {
    val minZoom: Int get() = layers.firstOrNull()?.outputMinZoom ?: 0
    val maxZoom: Int get() = layers.firstOrNull()?.outputMaxZoom ?: 22
    val scheme: NativeTileScheme get() = layers.firstOrNull()?.scheme ?: NativeTileScheme.TMS

    internal fun withDatum(value: NativeRasterDatum): NativeMapSource = if (value == datum) this else NativeMapSource(
        id, name, layers, value, tileSize, attribution, subdomains, token, tileMatrixSet,
        format, limitations, kind, localFilePath, bounds,
    )

    /** Creates a tile URL without allowing it to flow into diagnostics or status messages. */
    internal fun tileUrl(x: Int, y: Int, z: Int): String = tileUrl(0, x, y, z)

    internal fun tileUrl(layerIndex: Int, x: Int, y: Int, z: Int): String {
        val layer = layers[layerIndex]
        require(z in layer.minZoom..layer.maxZoom)
        val side = 1L shl z
        require(x >= 0 && x.toLong() < side && y >= 0 && y.toLong() < side)
        val sourceY = if (!layer.ovmapTemplate && layer.scheme == NativeTileScheme.TMS) side - y - 1 else y.toLong()
        val template = layer.tiles[((x.toLong() + y) % layer.tiles.size).toInt()]
            .replace(Regex("\\{s\\}")) { subdomains[((x.toLong() + y + z) % subdomains.size).toInt()] }
        var result = if (layer.ovmapTemplate) renderOvmapTemplate(template, z, x, y) else {
            val world = 40_075_016.68557849
            val ratio = side.toDouble()
            val bbox = listOf(
                x / ratio * world - world / 2,
                world / 2 - (y + 1) / ratio * world,
                (x + 1) / ratio * world - world / 2,
                world / 2 - y / ratio * world,
            ).joinToString(",") { it.toString().removeSuffix(".0") }
            template
                .replace(Regex("\\{z\\}", RegexOption.IGNORE_CASE), z.toString())
                .replace(Regex("\\{x\\}", RegexOption.IGNORE_CASE), x.toString())
                .replace(Regex("\\{y\\}", RegexOption.IGNORE_CASE), sourceY.toString())
                .replace(Regex("\\{TileMatrix\\}", RegexOption.IGNORE_CASE), z.toString())
                .replace(Regex("\\{TileRow\\}", RegexOption.IGNORE_CASE), sourceY.toString())
                .replace(Regex("\\{TileCol\\}", RegexOption.IGNORE_CASE), x.toString())
                .replace(Regex("\\{TileMatrixSet\\}", RegexOption.IGNORE_CASE), tileMatrixSet.orEmpty())
                .replace(Regex("\\{token\\}", RegexOption.IGNORE_CASE), URLEncoder.encode(token, StandardCharsets.UTF_8.name()))
                .replace(Regex("\\{ratio\\}", RegexOption.IGNORE_CASE), "")
                .replace(Regex("\\{quadkey\\}", RegexOption.IGNORE_CASE), nativeQuadkey(z, x, y))
                .replace(Regex("\\{prefix\\}", RegexOption.IGNORE_CASE), (x % 16).toString(16) + (y % 16).toString(16))
                .replace(Regex("\\{bbox-epsg-3857\\}", RegexOption.IGNORE_CASE), bbox)
        }
        if (layer.ovmapTemplate) {
            val world = 40_075_016.68557849
            val ratio = side.toDouble()
            val bbox = listOf(
                x / ratio * world - world / 2,
                world / 2 - (y + 1) / ratio * world,
                (x + 1) / ratio * world - world / 2,
                world / 2 - y / ratio * world,
            ).joinToString(",") { it.toString().removeSuffix(".0") }
            result = result
                .replace(Regex("\\{TileMatrixSet\\}", RegexOption.IGNORE_CASE), tileMatrixSet.orEmpty())
                .replace(Regex("\\{TileMatrix\\}", RegexOption.IGNORE_CASE), z.toString())
                .replace(Regex("\\{TileRow\\}", RegexOption.IGNORE_CASE), y.toString())
                .replace(Regex("\\{TileCol\\}", RegexOption.IGNORE_CASE), x.toString())
                .replace(Regex("\\{ratio\\}", RegexOption.IGNORE_CASE), "")
                .replace(Regex("\\{bbox-epsg-3857\\}", RegexOption.IGNORE_CASE), bbox)
        }
        if (token.isNotBlank()) result = result.replace(Regex("\\{token\\}", RegexOption.IGNORE_CASE), URLEncoder.encode(token, StandardCharsets.UTF_8.name()))
        return result.replace("{", "%7B").replace("}", "%7D")
    }

    override fun toString() = "NativeMapSource(id=$id, name=$name, format=$format, zoom=$minZoom..$maxZoom, layers=${layers.size}, credentials=redacted)"
}

data class NativeMapSourceError(val index: Int, val reason: String)

/** Parsing is per entry: valid sources remain available, while unsupported entries carry a reason. */
data class NativeMapSourceCatalog(val sources: List<NativeMapSource>, val errors: List<NativeMapSourceError>) {
    companion object {
        private const val MAX_SOURCES = 200
        private const val MAX_TEMPLATE_LENGTH = 8192
        private val SUPPORTED_TILE_SIZES = setOf(256, 512, 1024, 2048)

        fun fromJson(root: JSONObject): NativeMapSourceCatalog {
            val maps = root.optJSONArray("maps") ?: root.optJSONArray("mapSources")
                ?: return NativeMapSourceCatalog(emptyList(), listOf(NativeMapSourceError(0, "缺少 maps 数组")))
            if (maps.length() > MAX_SOURCES) return NativeMapSourceCatalog(emptyList(), listOf(NativeMapSourceError(0, "图源数量超过支持上限")))
            val sources = mutableListOf<NativeMapSource>()
            val errors = mutableListOf<NativeMapSourceError>()
            for (index in 0 until maps.length()) {
                val item = maps.optJSONObject(index)
                if (item == null) {
                    errors += NativeMapSourceError(index, "图源配置必须是对象")
                    continue
                }
                try {
                    sources += parse(item, index)
                } catch (error: UnsupportedMapSource) {
                    errors += NativeMapSourceError(index, error.message ?: "图源格式不受支持")
                }
            }
            return NativeMapSourceCatalog(sources, errors)
        }

        private fun parse(item: JSONObject, index: Int): NativeMapSource {
            val kind = item.optString("kind", "online").lowercase()
            if (kind == "mbtiles" || kind == "geotiff" || kind == "image") {
                val format = when(kind){"mbtiles"->"MBTiles";"geotiff"->"GeoTIFF";else->item.optString("format","配准影像")}
                val path=item.optString("filePath",item.optString("path")).trim()
                if(path.isBlank()||!java.io.File(path).isFile)throw UnsupportedMapSource("本地离线地图文件不存在")
                if(kind=="mbtiles"&& !path.endsWith(".mbtiles",true))throw UnsupportedMapSource("MBTiles文件扩展名无效")
                if(kind=="geotiff"&& !path.endsWith(".tif",true)&& !path.endsWith(".tiff",true))throw UnsupportedMapSource("GeoTIFF文件扩展名无效")
                if(kind=="image"&& !listOf(".png",".jpg",".jpeg",".webp").any{path.endsWith(it,true)})throw UnsupportedMapSource("配准图片文件扩展名无效")
                val min=item.optInt("minzoom",0);val max=item.optInt("maxzoom",22)
                if(min !in 0..22||max !in min..22)throw UnsupportedMapSource("离线图源缩放级别无效")
                val rawBounds=item.optJSONArray("bounds")
                val bounds=rawBounds?.let{if(it.length()!=4)throw UnsupportedMapSource("离线图源范围无效");(0..3).map(it::getDouble)}
                if(bounds!=null&&(bounds[0]>=bounds[2]||bounds[1]>=bounds[3]||bounds[0]<-180||bounds[2]>180||bounds[1]<-85.051129||bounds[3]>85.051129))throw UnsupportedMapSource("离线图源范围无效")
                return NativeMapSource(item.optString("id").ifBlank{"offline-${index+1}"},item.optString("name").ifBlank{"离线地图 ${index+1}"},emptyList(),NativeRasterDatum.WGS84,256,item.optString("attribution","用户导入的离线地图"),emptyList(),"",null,format,emptyList(),kind,path,bounds)
            }
            if (kind != "online") throw UnsupportedMapSource("仅支持在线栅格图源，离线文件格式未迁移")
            if (item.has("sources") || item.has("vector_tiles") || item.optString("type").equals("vector", true))
                throw UnsupportedMapSource("矢量 TileJSON 与样式图源暂不支持")
            val datum = when (item.optString("datum", "wgs84").lowercase()) {
                "wgs84", "" -> NativeRasterDatum.WGS84
                "gcj02" -> NativeRasterDatum.GCJ02
                "bd09" -> NativeRasterDatum.BD09
                else -> throw UnsupportedMapSource("图源坐标基准不受支持")
            }
            val crs = item.optString("crs", "EPSG:3857").uppercase()
            if (crs !in setOf("EPSG:3857", "3857", "WEBMERCATOR")) throw UnsupportedMapSource("仅支持 Web Mercator（EPSG:3857）瓦片矩阵")
            val ovmap = item.optJSONObject("ovmap")
            val ovmapLayers = ovmap?.optJSONArray("layers")
            val rawTiles = item.optJSONArray("tiles") ?: JSONArray().apply { if (item.has("url")) put(item.optString("url")) }
            if (ovmapLayers == null && rawTiles.length() !in 1..8) throw UnsupportedMapSource("需要 1–8 个栅格瓦片模板")
            val format = item.optString("format", "XYZ").uppercase()
            if (format !in setOf("XYZ", "TMS", "WMTS", "TILEJSON", "OVMAP", "")) throw UnsupportedMapSource("该图源格式暂不支持")
            val rawScheme = item.optString("scheme", if (format == "TMS") "tms" else "xyz").lowercase()
            val hasWmts = format == "WMTS" || rawScheme == "wmts" || rawTiles.let { arr ->
                (0 until arr.length()).any { arr.optString(it).contains("{Tile", true) || Regex("[?&]SERVICE=WMTS", RegexOption.IGNORE_CASE).containsMatchIn(arr.optString(it)) }
            }
            val scheme = when {
                hasWmts -> NativeTileScheme.WMTS
                rawScheme == "xyz" -> NativeTileScheme.XYZ
                rawScheme == "tms" -> NativeTileScheme.TMS
                else -> throw UnsupportedMapSource("瓦片编号仅支持 XYZ、TMS 或 WMTS")
            }
            val matrixSet = item.optString("tileMatrixSet").ifBlank { null }
            val subdomains = readSubdomains(item.opt("subdomains"))
            val token = item.optString("token", "")
            val primary = ovmapLayers?.optJSONObject(0)
            val minZoom = primary?.optInt("minzoom", item.optInt("minzoom", 0)) ?: item.optInt("minzoom", 0)
            val maxZoom = primary?.optInt("maxzoom", item.optInt("maxzoom", 18)) ?: item.optInt("maxzoom", 18)
            if (minZoom !in 0..24 || maxZoom !in minZoom..24) throw UnsupportedMapSource("原生瓦片引擎当前仅支持 0–24 级图源")
            val rootTileSize = primary?.optInt("tileSize", item.optInt("tileSize", item.optInt("tile_size", 256)))
                ?: item.optInt("tileSize", item.optInt("tile_size", 256))
            if (rootTileSize !in SUPPORTED_TILE_SIZES) throw UnsupportedMapSource("瓦片尺寸仅支持 256、512、1024 或 2048")
            val hasOvmap = ovmapLayers != null
            val isOvmapTemplate = hasOvmap || format == "OVMAP"
            val layers = if (hasOvmap) {
                if (ovmapLayers!!.length() !in 1..8) throw UnsupportedMapSource("OVMAP 图层数无效")
                (0 until ovmapLayers.length()).map { layerIndex ->
                    val value = ovmapLayers.optJSONObject(layerIndex) ?: throw UnsupportedMapSource("OVMAP 图层结构无效")
                    val layerTiles = value.optJSONArray("tiles") ?: throw UnsupportedMapSource("OVMAP 图层缺少瓦片模板")
                    val subdivide = value.optBoolean("subdivide", false) || (0 until layerTiles.length()).any { tileIndex ->
                        val template = layerTiles.optString(tileIndex)
                        Regex("\\{\\\$x/2\\}", RegexOption.IGNORE_CASE).containsMatchIn(template) &&
                            Regex("\\{\\\$y/2\\}", RegexOption.IGNORE_CASE).containsMatchIn(template) &&
                            Regex("\\{\\\$z-1\\}", RegexOption.IGNORE_CASE).containsMatchIn(template)
                    }
                    parseLayer(
                        layerTiles, value.optInt("minzoom", minZoom), value.optInt("maxzoom", maxZoom),
                        value.optInt("tileSize", rootTileSize), subdivide,
                        NativeTileScheme.XYZ, true, subdomains, token, matrixSet, layerIndex,
                    )
                }
            } else {
                listOf(parseLayer(rawTiles, minZoom, maxZoom, rootTileSize, false, scheme, isOvmapTemplate, subdomains, token, matrixSet, 0))
            }
            val limitations = buildList {
                if (ovmap?.optJSONArray("missingOverlayIds")?.length()?.let { it > 0 } == true) add("部分OVMAP附加图层不在已导入图源中")
                if (item.has("bounds")) add("图源地理范围元数据已导入；原生栅格层按瓦片服务返回内容显示")
            }
            return NativeMapSource(
                id = item.optString("id").trim().ifBlank { "custom-${stableId(item)}" },
                name = item.optString("name").trim().ifBlank { "自定义地图 ${index + 1}" },
                layers = layers,
                datum = datum,
                tileSize = layers.first().outputTileSize,
                attribution = item.optString("attribution", "用户提供的图源").take(1000),
                subdomains = subdomains,
                token = token,
                tileMatrixSet = matrixSet,
                format = if (scheme == NativeTileScheme.WMTS) "WMTS" else format.ifBlank { scheme.name },
                limitations = limitations,
            )
        }

        private fun parseLayer(
            rawTiles: JSONArray,
            minZoom: Int,
            maxZoom: Int,
            tileSize: Int,
            subdivide: Boolean,
            scheme: NativeTileScheme,
            ovmapTemplate: Boolean,
            subdomains: List<String>,
            token: String,
            matrixSet: String?,
            index: Int,
        ): NativeMapRasterLayer {
            if (minZoom !in 0..24 || maxZoom !in minZoom..24) throw UnsupportedMapSource("第 ${index + 1} 个图层缩放范围无效")
            if (tileSize !in SUPPORTED_TILE_SIZES || (subdivide && tileSize == 256)) throw UnsupportedMapSource("第 ${index + 1} 个图层瓦片尺寸无效")
            if (rawTiles.length() !in 1..8) throw UnsupportedMapSource("第 ${index + 1} 个图层模板数无效")
            val templates = (0 until rawTiles.length()).map { templateIndex ->
                var url = rawTiles.optString(templateIndex).trim()
                if (url.length !in 1..MAX_TEMPLATE_LENGTH) throw UnsupportedMapSource("第 ${index + 1} 个图层模板长度无效")
                if (!ovmapTemplate) {
                    url = url.replace(Regex("\\{\\$([xyz])\\}", RegexOption.IGNORE_CASE)) { "{${it.groupValues[1].lowercase()}}" }
                        .replace(Regex("\\{TileMatrix\\}", RegexOption.IGNORE_CASE), "{z}")
                        .replace(Regex("\\{TileRow\\}", RegexOption.IGNORE_CASE), "{y}")
                        .replace(Regex("\\{TileCol\\}", RegexOption.IGNORE_CASE), "{x}")
                }
                validateTemplate(url, scheme, ovmapTemplate, subdomains, token, matrixSet)
                url
            }
            return NativeMapRasterLayer(templates, minZoom, maxZoom, tileSize, scheme, subdivide, ovmapTemplate)
        }

        private fun validateTemplate(
            url: String,
            scheme: NativeTileScheme,
            ovmap: Boolean,
            subdomains: List<String>,
            token: String,
            matrixSet: String?,
        ) {
            val uriText = Regex("\\{[^}]+\\}").replace(url) { match ->
                when (match.value.lowercase()) {
                    "{tilematrixset}" -> matrixSet ?: "matrix"
                    else -> "0"
                }
            }
            if (urlTextHasControlCharacters(uriText)) throw UnsupportedMapSource("瓦片模板 URL 含无效控制字符")
            val uri = try { URL(uriText) } catch (_: Exception) { throw UnsupportedMapSource("瓦片模板 URL 无效") }
            val authority = uri.authority.orEmpty()
            val host = uri.host.orEmpty()
            if (uri.protocol.lowercase() !in setOf("https", "http") || host.isBlank() || '@' in authority || uri.ref != null || uri.port > 65535)
                throw UnsupportedMapSource("图源地址协议或主机无效，且不能嵌入用户名或密码")
            if (url.contains("{s}") && subdomains == listOf("")) throw UnsupportedMapSource("模板使用 {s}，但未配置有效子域列表")
            if (url.contains("{token}") && token.isBlank()) throw UnsupportedMapSource("模板使用 {token}，但缺少图源令牌")
            if (url.contains("{TileMatrixSet}", true) && matrixSet.isNullOrBlank()) throw UnsupportedMapSource("WMTS 模板缺少 tileMatrixSet")
            if (ovmap) {
                if (!supportedOvmapTemplate(url)) throw UnsupportedMapSource("OVMAP 瓦片模板包含未支持的变量")
            } else {
                val aliases = url.replace(Regex("\\{TileMatrix\\}", RegexOption.IGNORE_CASE), "{z}")
                    .replace(Regex("\\{TileRow\\}", RegexOption.IGNORE_CASE), "{y}")
                    .replace(Regex("\\{TileCol\\}", RegexOption.IGNORE_CASE), "{x}")
                    .replace(Regex("\\{\\$([xyz])\\}", RegexOption.IGNORE_CASE)) { "{${it.groupValues[1].lowercase()}}" }
                val placeholders = Regex("\\{[^}]+\\}").findAll(aliases).map { it.value }.toList()
                val allowed = setOf("{z}", "{x}", "{y}", "{s}", "{token}", "{TileMatrixSet}", "{ratio}", "{bbox-epsg-3857}", "{quadkey}", "{prefix}")
                if (placeholders.any { it !in allowed }) throw UnsupportedMapSource("含有未支持的瓦片模板占位符")
                val xyzCoordinates = listOf("{z}", "{x}", "{y}").all(aliases::contains)
                val derivedAddress = "{quadkey}" in placeholders || "{bbox-epsg-3857}" in placeholders
                if (!xyzCoordinates && !derivedAddress)
                    throw UnsupportedMapSource(if (scheme == NativeTileScheme.WMTS) "WMTS 模板缺少矩阵/行/列或有效派生地址" else "XYZ/TMS 模板缺少坐标或有效派生地址")
            }
        }

        private fun supportedOvmapTemplate(template: String): Boolean {
            val tokens = Regex("\\{(\\$?)([^{}]*)\\}").findAll(template).toList()
            if (tokens.isEmpty()) return false
            return tokens.all { match ->
                val value = match.groupValues[2]
                val isVariable = match.groupValues[1] == "\$"
                if (isVariable) {
                    if (value.equals("Galileo", ignoreCase = true)) true
                    else {
                        val expression = Regex("^(x|y|z)(?:([+*/-])(\\d{1,6}))?$").matchEntire(value) ?: return@all false
                        val operand = expression.groupValues[3].toLongOrNull()
                        operand == null || (operand <= 1_000_000L && !(expression.groupValues[2] == "/" && operand == 0L))
                    }
                } else value in setOf("x", "y", "z", "4", "token", "s", "TileMatrixSet", "TileMatrix", "TileRow", "TileCol", "ratio")
            }
        }

        private fun readSubdomains(value: Any?): List<String> {
            val result = when (value) {
                is JSONArray -> (0 until value.length()).map { value.optString(it) }
                is String -> value.split(',').map(String::trim)
                else -> emptyList()
            }.filter { it.isNotBlank() && it.matches(Regex("[A-Za-z0-9-]{1,63}")) }
            return result.ifEmpty { listOf("") }
        }

        private fun stableId(item: JSONObject): String = MessageDigest.getInstance("SHA-256")
            .digest(item.toString().toByteArray(Charsets.UTF_8))
            .take(8).joinToString("") { "%02x".format(it) }

        private fun urlTextHasControlCharacters(value: String) = value.any { it.code <= 0x20 || it.code == 0x7f }
    }
}

private fun renderOvmapTemplate(template: String, z: Int, x: Int, y: Int): String {
    val maxCoordinate = (1L shl z) - 1
    require(z in 0..24 && x.toLong() in 0..maxCoordinate && y.toLong() in 0..maxCoordinate)
    var result = template.replace("{\$x}{\$y}{\$z}{4}", ovmapQuadkey(z, x, y))
    result = Regex("\\{(\\$?)([^{}]*)\\}").replace(result) { match ->
        val prefix = match.groupValues[1]
        val expression = match.groupValues[2]
        if (prefix.isEmpty() && expression !in setOf("x", "y", "z")) return@replace match.value
        if (expression.equals("Galileo", ignoreCase = true)) return@replace "Galileo".take((3 * x + y) % 8)
        val parsed = Regex("^(x|y|z)(?:([+*/-])(\\d{1,6}))?$").matchEntire(expression)
            ?: return@replace match.value
        val base = when (parsed.groupValues[1]) { "x" -> x; "y" -> y; else -> z }.toLong()
        val operandText = parsed.groupValues[3]
        if (operandText.isEmpty()) base.toString() else {
            val operand = operandText.toLong()
            val computed = when (parsed.groupValues[2]) {
                "+" -> base + operand
                "-" -> base - operand
                "*" -> base * operand
                "/" -> if (operand == 0L) error("OVMAP 不支持除数为零") else Math.floorDiv(base, operand)
                else -> base
            }
            require(kotlin.math.abs(computed) <= 1_000_000_000L)
            computed.toString()
        }
    }
    return result
}

private fun ovmapQuadkey(z: Int, x: Int, y: Int): String = buildString {
    for (level in z downTo 1) {
        val bit = 1 shl (level - 1)
        var digit = 0
        if ((x and bit) != 0) digit += 1
        if ((y and bit) != 0) digit += 2
        append(digit)
    }
}

private fun nativeQuadkey(z: Int, x: Int, y: Int): String = buildString {
    for (level in z downTo 1) {
        val bit = 1 shl (level - 1)
        append((if ((x and bit) != 0) 1 else 0) + (if ((y and bit) != 0) 2 else 0))
    }
}

private class UnsupportedMapSource(message: String) : IllegalArgumentException(message)

data class NativeMapSourceSelection(
    val id: String,
    val name: String,
    val attribution: String,
    val custom: Boolean,
    val limitations: List<String> = emptyList(),
)
enum class NativeMapQuality { STANDARD, HIGH }
