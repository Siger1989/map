package com.shantu.nativeapp.data

import org.json.JSONArray
import org.json.JSONObject
import org.xmlpull.v1.XmlPullParser
import org.xmlpull.v1.XmlPullParserFactory
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.StringReader
import java.nio.charset.StandardCharsets
import java.util.zip.ZipInputStream
import java.util.UUID
import kotlin.math.abs
import kotlin.math.pow

/** Native, bounded interchange for the explicitly supported route formats. */
object NativeRouteFormats {
    enum class Format { GPX, GEOJSON, KML }
    enum class CoordinateSystem { AUTO, CGCS2000, GCJ02 }
    data class ImportOptions(val coordinateSystem: CoordinateSystem = CoordinateSystem.AUTO)
    data class ImportResult(val data: JSONObject, val warnings: List<String> = emptyList())

    private const val MAX_BYTES = 8 * 1024 * 1024
    private const val MAX_ARCHIVE_ENTRIES = 256
    private const val MAX_ARCHIVE_EXPANDED_BYTES = 16 * 1024 * 1024
    private const val MAX_POINTS = 6000
    private const val MAX_RECORDS = 100
    private const val GPX_NS = "http://www.topografix.com/GPX/1/1"
    private val xmlDanger = Regex("<!\\s*(DOCTYPE|ENTITY)", RegexOption.IGNORE_CASE)

    fun importFile(input: InputStream, filename: String, options: ImportOptions = ImportOptions()): ImportResult {
        val bytes = readBounded(input)
        val name = filename.substringAfterLast('/').substringAfterLast('\\')
        val ext = name.substringAfterLast('.', "").lowercase()
        var warnings = mutableListOf<String>()
        val parsed = when {
            ext == "fit" || (bytes.size >= 12 && String(bytes, 8, 4, StandardCharsets.US_ASCII) == ".FIT") ->
                NativeFitImporter.parse(bytes, name)
            ext == "ovobj" || (bytes.size >= 4 && String(bytes, 0, 4, StandardCharsets.US_ASCII) == "OviO") -> {
                val result = NativeOviImporter.parseOvobj(bytes, name, options.coordinateSystem)
                warnings += result.second; result.first
            }
            ext == "json" && runCatching { JSONObject(String(bytes, StandardCharsets.UTF_8)).has("ObjItems") }.getOrDefault(false) -> {
                val result = NativeOviImporter.parseOviJson(String(bytes, StandardCharsets.UTF_8), name, options.coordinateSystem)
                warnings += result.second; result.first
            }
            ext in setOf("gpx", "kml", "ovkml", "kmz", "ovkmz", "tcx", "csv", "tsv", "geojson", "json") -> when (ext) {
            "gpx" -> importXml(String(bytes, StandardCharsets.UTF_8), name, isGpx = true, warnings = warnings)
            "kml", "ovkml" -> importXml(String(bytes, StandardCharsets.UTF_8), name, isGpx = false,
                isOvi = ext == "ovkml", options = options, warnings = warnings)
            "kmz", "ovkmz" -> {
                val files = unzipBounded(bytes)
                val wpml = files.filterKeys { it.substringAfterLast('/').equals("waylines.wpml", true) }
                require(wpml.size <= 1) { "KMZ 内含多个 waylines.wpml，无法确定航线" }
                if (wpml.isNotEmpty()) {
                    require(wpml.values.single().size <= MAX_BYTES) { "解压后的 WPML 过大" }
                    importWpml(String(wpml.values.single(), StandardCharsets.UTF_8), name, warnings)
                } else {
                    val candidates = files.filterKeys { it.substringAfterLast('/').endsWith(".kml", true) || it.substringAfterLast('/').endsWith(".ovkml", true) }
                    require(candidates.size == 1) { "KMZ 必须只含一个 KML 航线文件；当前不导入附件/多文档包" }
                    require(candidates.values.single().size <= MAX_BYTES) { "解压后的 KML 过大" }
                    importXml(String(candidates.values.single(), StandardCharsets.UTF_8), name, false,
                        isOvi = ext == "ovkmz" || candidates.keys.single().endsWith(".ovkml", true), options = options, warnings = warnings)
                }
            }
            "tcx" -> importTcx(String(bytes, StandardCharsets.UTF_8), name, warnings)
            "csv", "tsv" -> importCsv(String(bytes, StandardCharsets.UTF_8), name, warnings)
            "geojson", "json" -> importGeoJson(String(bytes, StandardCharsets.UTF_8), name)
            else -> error("unreachable")
            }
            else -> throw IllegalArgumentException("尚未完成该格式的原生导入；当前包含 GPX、KML/KMZ、OVKML/OVKMZ、TCX、CSV/TSV、FIT、OVOBJ v105 几何子集、奥维 JSON 对象子集、GeoJSON 与 DJI WPML 子集")
        }
        return ImportResult(parsed, warnings)
    }

    fun exportFile(format: Format, workspace: JSONObject, areaUnit: String = "m2"): ByteArray {
        val core = workspace.optJSONObject("core") ?: throw IllegalArgumentException("工作区业务数据无效")
        val tracks = mutableListOf<JSONObject>()
        val storedTracks = core.optJSONArray("tracks") ?: JSONArray()
        for (i in 0 until storedTracks.length()) tracks += storedTracks.getJSONObject(i)
        val favorites = core.optJSONArray("favorites") ?: JSONArray()
        for (i in 0 until favorites.length()) {
            val favorite = favorites.getJSONObject(i)
            val route = favorite.getJSONObject("route")
            tracks += JSONObject().put("id", favorite.optString("id")).put("name", favorite.optString("name"))
                .put("segments", JSONArray().put(route.getJSONArray("coordinates")))
        }
        val annotations = core.optJSONArray("annotations") ?: JSONArray()
        val areas = core.optJSONArray("areas") ?: JSONArray()
        require(format == Format.GEOJSON || areas.length() == 0) { "当前 GPX/KML 点线交换不包含区域面；请导出 GeoJSON 以保留区域数据" }
        val text = when (format) {
            Format.GPX -> exportGpx(tracks, annotations)
            Format.GEOJSON -> exportGeoJson(tracks, annotations, areas, areaUnit)
            Format.KML -> NativeKmlExporter.export(tracks,annotations)
        }
        return text.toByteArray(StandardCharsets.UTF_8)
    }

    private fun importXml(
        text: String,
        filename: String,
        isGpx: Boolean,
        isOvi: Boolean = false,
        options: ImportOptions = ImportOptions(),
        warnings: MutableList<String> = mutableListOf(),
    ): JSONObject {
        require(text.isNotEmpty() && !xmlDanger.containsMatchIn(text)) { "不支持带 DTD 或实体声明的 XML" }
        if (isOvi && options.coordinateSystem == CoordinateSystem.AUTO)
            throw IllegalArgumentException("OVKML 无法仅凭扩展名判断坐标系；请选择 CGCS2000 或 GCJ02")
        val coordinateSystem = if (isOvi) options.coordinateSystem else CoordinateSystem.CGCS2000
        val kmlStyles = if (!isGpx) readKmlStyles(text) else emptyMap()
        val factory = XmlPullParserFactory.newInstance().apply { isNamespaceAware = true }
        val parser = factory.newPullParser()
        runCatching { parser.setFeature(XmlPullParser.FEATURE_PROCESS_DOCDECL, false) }
        runCatching { parser.setFeature("http://xml.org/sax/features/external-general-entities", false) }
        runCatching { parser.setFeature("http://xml.org/sax/features/external-parameter-entities", false) }
        parser.setInput(StringReader(text))

        val tracks = JSONArray()
        val pins = JSONArray()
        val stack = ArrayList<String>()
        var track: TrackBuilder? = null
        var placemark: KmlPlacemark? = null
        var lineActive = false
        var pointActive = false
        var currentPoint: SamplePoint? = null
        var currentPinName = ""
        var currentPinNote = ""
        var currentPinKmlTime: JSONObject? = null
        var capture: String? = null
        val captured = StringBuilder()
        var pointCount = 0
        var sawRoot = false

        fun appendPoint(line: MutableList<SamplePoint>, p: SamplePoint) {
            require(++pointCount <= MAX_POINTS) { "路线点数超过6000" }
            line += p
        }

        while (true) {
            when (parser.eventType) {
                XmlPullParser.START_TAG -> {
                    val tag = parser.name
                    stack += tag
                    if (stack.size == 1) {
                        sawRoot = if (isGpx) tag.equals("gpx", true) else tag.equals("kml", true)
                        require(sawRoot) { if (isGpx) "GPX 根元素无效" else "KML 根元素无效" }
                    }
                    when {
                        !isGpx && tag in setOf("Polygon", "NetworkLink", "Track") -> throw IllegalArgumentException("当前原生 KML 仅支持普通点和线；面、动态轨迹、网络链接会导致整份文件拒绝")
                        isGpx && tag == "trk" -> track = TrackBuilder(labelFromFilename(filename), "gpx")
                        isGpx && tag == "rte" -> track = TrackBuilder(labelFromFilename(filename), "gpx")
                        isGpx && tag == "trkseg" -> track?.segments?.add(mutableListOf())
                        isGpx && tag == "trkpt" -> {
                            val p = parseLonLat(parser.getAttributeValue(null, "lon"), parser.getAttributeValue(null, "lat"))
                            currentPoint = SamplePoint(p, null, null)
                            if (track?.segments?.isEmpty() == true) track?.segments?.add(mutableListOf())
                        }
                        isGpx && tag == "rtept" -> {
                            currentPoint = SamplePoint(parseLonLat(parser.getAttributeValue(null, "lon"), parser.getAttributeValue(null, "lat")), null, null)
                            if (track?.segments?.isEmpty() == true) track?.segments?.add(mutableListOf())
                        }
                        isGpx && tag == "wpt" -> { currentPoint = SamplePoint(parseLonLat(parser.getAttributeValue(null, "lon"), parser.getAttributeValue(null, "lat")), null, null); currentPinName = ""; currentPinNote = ""; currentPinKmlTime = null }
                        !isGpx && tag == "Placemark" -> placemark = KmlPlacemark(labelFromFilename(filename), id = parser.getAttributeValue(null, "id")?.take(250).orEmpty())
                        !isGpx && tag == "LineString" -> { lineActive = true; placemark?.segments?.add(mutableListOf()) }
                        !isGpx && tag == "Point" -> pointActive = true
                        tag in setOf("name", "ele", "time", "coordinates", "desc", "route-style", "kml-time", "styleUrl", "when", "begin", "end", "value") -> { capture = tag; captured.setLength(0) }
                    }
                }
                XmlPullParser.TEXT, XmlPullParser.CDSECT -> if (capture != null) captured.append(parser.text)
                XmlPullParser.END_TAG -> {
                    val tag = parser.name
                    val value = captured.toString().trim()
                    if (capture == tag) {
                        if (isGpx) when (tag) {
                            "name" -> if ("wpt" in stack) currentPinName = value.take(60) else track?.let { it.name = value.take(200) }
                            "ele" -> currentPoint = currentPoint?.copy(altitude = value.toDoubleOrNull()?.also { require(it.isFinite()) { "GPX 高程无效" } })
                            "time" -> currentPoint = currentPoint?.copy(time = value.takeIf { it.isNotEmpty() }?.let { runCatching { java.time.Instant.parse(it).toEpochMilli() }.getOrElse { throw IllegalArgumentException("GPX 时间无效") } })
                            "desc" -> if ("wpt" in stack) currentPinNote = value.take(500)
                            "route-style" -> track?.readStyle(value)
                            "kml-time" -> {
                                val parsedTime = JSONObject(value)
                                if ("wpt" in stack) currentPinKmlTime = parsedTime else track?.kmlTime = parsedTime
                            }
                        } else when (tag) {
                            "name" -> placemark?.name = value.take(200)
                            "styleUrl" -> placemark?.styleUrl = value.removePrefix("#").take(120)
                            "route-style", "value" -> if (value.startsWith("{")) placemark?.inlineStyle = value
                            "kml-time" -> if (value.startsWith("{")) placemark?.kmlTime = JSONObject(value)
                            "when" -> placemark?.timestamp = parseIsoTime(value)
                            "begin" -> placemark?.timeBegin = parseIsoTime(value)
                            "end" -> placemark?.timeEnd = parseIsoTime(value)
                        }

                        if (!isGpx && tag == "coordinates") {
                            val coords = value.split(Regex("\\s+")).filter(String::isNotBlank).map(::parseKmlCoordinate)
                            when {
                                lineActive -> {
                                    require(coords.size >= 2) { "KML 线段至少需要两个点" }
                                    val line = placemark?.segments?.lastOrNull() ?: throw IllegalArgumentException("KML 线段结构无效")
                                    coords.forEach { appendPoint(line, it.copy(coordinate = convertCoordinate(it.coordinate, coordinateSystem))) }
                                }
                                pointActive -> {
                                    require(coords.size == 1) { "KML 点坐标无效" }
                                    val pm = placemark ?: throw IllegalArgumentException("KML 点结构无效")
                                    pm.points += coords.single().copy(coordinate = convertCoordinate(coords.single().coordinate, coordinateSystem))
                                }
                            }
                        }
                        capture = null
                    }
                    if (isGpx) when (tag) {
                        "trkpt", "rtept" -> {
                            val p = currentPoint ?: throw IllegalArgumentException("GPX 点结构无效")
                            val line = track?.segments?.lastOrNull() ?: throw IllegalArgumentException("GPX 线段结构无效")
                            appendPoint(line, p); currentPoint = null
                        }
                        "wpt" -> {
                            val p = currentPoint ?: throw IllegalArgumentException("GPX 标记结构无效")
                            // GPX waypoint name/description are captured independently below.
                            val pin = annotation(currentPinName.ifEmpty { labelFromFilename(filename) }, p.coordinate, currentPinNote, p.altitude)
                            currentPinKmlTime?.let { pin.put("kmlTime", it) }; pins.put(pin)
                            currentPoint = null
                        }
                        "trk", "rte" -> {
                            val item = track ?: throw IllegalArgumentException("GPX 路线结构无效")
                            addTrack(tracks, item.toJson()); track = null
                        }
                    }
                    if (!isGpx) when (tag) {
                        "LineString" -> lineActive = false
                        "Point" -> pointActive = false
                        "Placemark" -> {
                            val pm = placemark ?: throw IllegalArgumentException("KML Placemark 无效")
                            pm.points.forEach { p ->
                                val pin = annotation(pm.name, p.coordinate, "", p.altitude)
                                val time = pm.kmlTime ?: if (pm.timestamp != null || pm.timeBegin != null || pm.timeEnd != null) JSONObject().also { t ->
                                    pm.timestamp?.let { t.put("when", it) }; pm.timeBegin?.let { t.put("begin", it) }; pm.timeEnd?.let { t.put("end", it) }
                                } else null
                                time?.let { pin.put("kmlTime", it) }
                                if (pm.points.size == 1 && pm.segments.isEmpty() && pm.id.isNotBlank()) pin.put("id", pm.id)
                                pins.put(pin)
                            }
                            if (pm.segments.isNotEmpty()) {
                                val builder = TrackBuilder(pm.name, if (isOvi) "kml" else "kml", pm.segments)
                                val resolvedStyle = kmlStyles[pm.styleUrl]
                                resolvedStyle?.let(builder::readStyle)
                                pm.inlineStyle?.let(builder::readStyle)
                                val track = builder.toJson()
                                if (pm.segments.size == 1 && pm.points.isEmpty() && pm.id.isNotBlank()) track.put("id", pm.id)
                                if (pm.styleUrl.isNotEmpty() && resolvedStyle == null) warnings += "KML styleUrl #${pm.styleUrl} 未解析（StyleMap/外部样式不支持），已保留默认路线样式。"
                                if (pm.timestamp != null || pm.timeBegin != null || pm.timeEnd != null) {
                                    val kmlTime = pm.kmlTime ?: JSONObject().also { t ->
                                        pm.timestamp?.let { t.put("when", it) }; pm.timeBegin?.let { t.put("begin", it) }; pm.timeEnd?.let { t.put("end", it) }
                                    }
                                    track.put("kmlTime", kmlTime)
                                    warnings += "KML 时间戳/时间范围已保存在kmlTime元数据中；地图线路不按它模拟逐点时间。"
                                }
                                addTrack(tracks, track)
                            }
                            placemark = null
                        }
                    }
                    if (stack.isNotEmpty()) stack.removeAt(stack.lastIndex)
                }
                XmlPullParser.DOCDECL -> throw IllegalArgumentException("不支持带 DTD 的 XML")
                XmlPullParser.END_DOCUMENT -> break
            }
            parser.next()
        }
        require(sawRoot) { "XML 文档无效" }
        require(tracks.length() <= MAX_RECORDS && pins.length() <= 2000) { "导入对象数量超过限制" }
        require(tracks.length() > 0 || pins.length() > 0) { "文件中没有可导入的点或轨迹" }
        if (!isGpx) warnings += "KML 原生子集导入普通点线、LineStyle颜色/宽度和Placemark时间；图标、区域、地面覆盖、gx:Track及其他样式不完整支持。"
        if (!isGpx && (text.contains("IconStyle") || text.contains("PolyStyle") || text.contains("GroundOverlay")))
            warnings += "KML 的图标、区域填充或地面覆盖样式不在本原生子集内；相应非线路属性不会导入。"
        if (!isGpx && isOvi) warnings += "OVKML 已按$coordinateSystem 坐标选项读取；奥维私有扩展和非标准对象不在本子集内。"
        return transfer(tracks, pins)
    }

    private fun readKmlStyles(text: String): Map<String, String> {
        val parser = XmlPullParserFactory.newInstance().apply { isNamespaceAware = true }.newPullParser()
        parser.setInput(StringReader(text))
        val styles = linkedMapOf<String, String>()
        var id: String? = null; var inLine = false; var color: String? = null; var width: Double? = null; var capture: String? = null
        while (parser.next() != XmlPullParser.END_DOCUMENT) when (parser.eventType) {
            XmlPullParser.START_TAG -> when (parser.name) {
                "Style" -> { id = parser.getAttributeValue(null, "id")?.take(120); color = null; width = null }
                "LineStyle" -> inLine = true
                "color", "width" -> if (inLine) capture = parser.name
            }
            XmlPullParser.TEXT, XmlPullParser.CDSECT -> when (capture) {
                "color" -> { color = parser.text.trim(); capture = "color-read" }
                "color-read" -> color += parser.text.trim()
                "width" -> { width = parser.text.trim().toDoubleOrNull(); capture = "width-read" }
                "width-read" -> width = (width?.toString().orEmpty() + parser.text.trim()).toDoubleOrNull()
            }
            XmlPullParser.END_TAG -> when (parser.name) {
                "LineStyle" -> inLine = false
                "color", "width" -> capture = null
                "Style" -> if (!id.isNullOrBlank() && (color != null || width != null)) {
                    val normalized = color?.let(::kmlColor) ?: "#38a8d8"
                    val w = (width ?: 2.0).coerceIn(.5, 5.0)
                    styles[id!!] = JSONObject().put("style", JSONObject().put("color", normalized).put("width", w)).toString()
                    id = null
                }
            }
        }
        return styles
    }

    private fun importTcx(text: String, filename: String, warnings: MutableList<String>): JSONObject {
        require(text.isNotEmpty() && !xmlDanger.containsMatchIn(text)) { "不支持带 DTD 或实体声明的 TCX" }
        val parser = XmlPullParserFactory.newInstance().apply { isNamespaceAware = true }.newPullParser()
        parser.setInput(StringReader(text))
        val tracks = JSONArray(); val pins = JSONArray(); var sawRoot = false; var objectName = labelFromFilename(filename)
        var inObject = false; var inTrack = false; var inFix = false; var inCoursePoint = false; var positioned = false
        var capture: String? = null; var value = StringBuilder(); var fixName = ""; var fixNotes = ""
        var fixLon: String? = null; var fixLat: String? = null; var fixAlt: String? = null; var fixTime: String? = null
        var points = 0; var part = mutableListOf<SamplePoint>(); var segments = mutableListOf<MutableList<SamplePoint>>()
        var hasUnsupportedSensors = false
        fun flushPart() { if (part.isNotEmpty()) { segments += part; part = mutableListOf() } }
        fun finishObject() {
            flushPart()
            val lines = segments.filter { it.size >= 2 }
            segments.filter { it.size == 1 }.forEach { pins.put(annotation(objectName, it.single().coordinate, "")) }
            if (lines.isNotEmpty()) {
                val builder = TrackBuilder(objectName, "shared", lines.toMutableList())
                val track = builder.toJson().put("importFormat", "TCX")
                addTrack(tracks, track)
            }
            segments = mutableListOf(); objectName = labelFromFilename(filename)
        }
        while (true) {
            when (parser.eventType) {
                XmlPullParser.START_TAG -> {
                    when (parser.name) {
                        "TrainingCenterDatabase" -> { sawRoot = true }
                        "Course", "Activity" -> { if (inObject) throw IllegalArgumentException("TCX 嵌套活动结构无效"); inObject = true; objectName = labelFromFilename(filename) }
                        "Track" -> if (inObject) inTrack = true
                        "Trackpoint" -> if (inTrack) { inFix = true; positioned = false; fixLon = null; fixLat = null; fixAlt = null; fixTime = null }
                        "CoursePoint" -> if (inObject) { inCoursePoint = true; fixLon = null; fixLat = null; fixAlt = null; fixTime = null; fixName = ""; fixNotes = "" }
                        "Position" -> if (inFix) positioned = true
                        "HeartRateBpm", "Cadence", "Extensions", "SensorState" -> hasUnsupportedSensors = true
                    }
                    if (parser.name in setOf("Name", "Id", "LongitudeDegrees", "LatitudeDegrees", "AltitudeMeters", "Time", "Notes")) { capture = parser.name; value = StringBuilder() }
                }
                XmlPullParser.TEXT, XmlPullParser.CDSECT -> if (capture != null) value.append(parser.text)
                XmlPullParser.END_TAG -> {
                    val v = value.toString().trim()
                    when (capture) {
                        "Name" -> if (inCoursePoint) fixName = v.take(60) else if (inObject && !inFix) objectName = v.take(200)
                        "Id" -> if (inObject && objectName == labelFromFilename(filename)) objectName = v.take(200)
                        "LongitudeDegrees" -> if (inFix || inCoursePoint) fixLon = v
                        "LatitudeDegrees" -> if (inFix || inCoursePoint) fixLat = v
                        "AltitudeMeters" -> if (inFix || inCoursePoint) fixAlt = v
                        "Time" -> if (inFix || inCoursePoint) fixTime = v
                        "Notes" -> if (inCoursePoint) fixNotes = v.take(500)
                    }
                    if (capture == parser.name) capture = null
                    when (parser.name) {
                        "Trackpoint" -> if (inFix) {
                            if (!positioned || fixLon.isNullOrBlank() || fixLat.isNullOrBlank()) flushPart()
                            else { require(++points <= MAX_POINTS) { "TCX 路线点数超过6000" }; part += sample(fixLon!!, fixLat!!, fixAlt, fixTime) }
                            inFix = false
                        }
                        "Track" -> if (inTrack) { flushPart(); inTrack = false }
                        "CoursePoint" -> if (inCoursePoint) {
                            if (!fixLon.isNullOrBlank() && !fixLat.isNullOrBlank()) {
                                val point = sample(fixLon!!, fixLat!!, fixAlt, fixTime)
                                pins.put(annotation(fixName.ifBlank { objectName }, point.coordinate, fixNotes, point.altitude))
                            }
                            inCoursePoint = false
                        }
                        "Course", "Activity" -> if (inObject) { finishObject(); inObject = false }
                    }
                }
                XmlPullParser.DOCDECL -> throw IllegalArgumentException("不支持带 DTD 的 TCX")
                XmlPullParser.END_DOCUMENT -> break
            }
            parser.next()
        }
        require(sawRoot) { "TCX 根元素无效" }
        require(tracks.length() <= MAX_RECORDS && pins.length() <= 2000) { "TCX 对象数量超过限制" }
        require(tracks.length() + pins.length() > 0) { "TCX 中没有可导入路线或课程点" }
        if (hasUnsupportedSensors) warnings += "TCX 的心率、步频及设备扩展未迁移；轨迹位置、时间、海拔和课程点已读取。"
        return transfer(tracks, pins)
    }

    private fun importCsv(text: String, filename: String, warnings: MutableList<String>): JSONObject {
        require(text.length <= MAX_BYTES && text.isNotBlank()) { "CSV 文件为空或过大" }
        val normalizedText = text.removePrefix("\uFEFF")
        val first = normalizedText.lineSequence().firstOrNull().orEmpty()
        val delimiter = when { first.contains('\t') -> '\t'; first.contains(';') -> ';'; else -> ',' }
        val rows = parseDelimited(normalizedText, delimiter)
        require(rows.isNotEmpty()) { "CSV 需要包含表头" }
        fun normalize(v: String) = v.lowercase().replace(Regex("[\\s_（）()]"), "")
        val headers = rows.first().map(::normalize)
        fun column(names: Set<String>): Int {
            val found = headers.indices.filter { headers[it] in names }
            require(found.size <= 1) { "CSV坐标或属性字段重复" }
            return found.firstOrNull() ?: -1
        }
        val lon = column(setOf("longitude", "lon", "lng", "经度", "经度°"))
        val lat = column(setOf("latitude", "lat", "纬度", "纬度°"))
        require(lon >= 0 && lat >= 0) { "CSV需有明确经度/纬度表头；不猜测X/Y或无表头坐标" }
        val alt = column(setOf("altitude", "elevation", "ele", "海拔", "高程", "海拔m", "高程m"))
        val time = column(setOf("time", "timestamp", "时间")); val name = column(setOf("name", "名称", "路线名称"))
        val segment = column(setOf("segment", "segmentid", "分段")); val crs = column(setOf("crs", "坐标系")); val kind = column(setOf("type", "类型"))
        val understood = setOf(lon, lat, alt, time, name, segment, crs, kind).filter { it >= 0 }.toSet()
        val unknown = headers.indices.filter { it !in understood }.map { rows.first()[it] }.filter(String::isNotBlank).distinct()
        val tracks = JSONArray(); val pins = JSONArray(); val grouped = linkedMapOf<String, MutableList<MutableList<SamplePoint>>>()
        var previousName = ""; var previousSegment = ""; var total = 0
        for (row in rows.drop(1)) {
            if (row.all(String::isBlank)) continue
            require(row.size == headers.size) { "CSV列数与表头不一致" }
            if (crs >= 0) require(row[crs].lowercase().replace(" ", "") in setOf("", "wgs84", "epsg:4326")) { "CSV当前只支持WGS84坐标" }
            val p = sample(row[lon], row[lat], alt.takeIf { it >= 0 }?.let(row::get), time.takeIf { it >= 0 }?.let(row::get))
            require(++total <= MAX_POINTS) { "CSV路线点数超过6000" }
            val label = name.takeIf { it >= 0 }?.let(row::get)?.ifBlank { labelFromFilename(filename) } ?: labelFromFilename(filename)
            val type = kind.takeIf { it >= 0 }?.let { row[it].lowercase() } ?: "track"
            if (type in setOf("point", "waypoint", "标记", "点")) { pins.put(annotation(label, p.coordinate, "", p.altitude)); previousName = ""; continue }
            require(type in setOf("track", "route", "轨迹", "路线", "")) { "CSV类型需为track/point或路线/标记" }
            val segmentValue = segment.takeIf { it >= 0 }?.let(row::get).orEmpty()
            val parts = grouped.getOrPut(label) { mutableListOf() }
            if (parts.isEmpty() || previousName != label || previousSegment != segmentValue) parts.add(mutableListOf())
            parts.last() += p; previousName = label; previousSegment = segmentValue
        }
        for ((label, parts) in grouped) {
            val lines = parts.filter { it.size >= 2 }
            parts.filter { it.size == 1 }.forEach { pins.put(annotation(label, it.single().coordinate, "", it.single().altitude)) }
            if (lines.isNotEmpty()) addTrack(tracks, TrackBuilder(label, "shared", lines.toMutableList()).toJson().put("importFormat", if (delimiter == '\t') "TSV" else "CSV"))
        }
        require(tracks.length() + pins.length() > 0) { "CSV中没有有效路线或标记" }
        if (unknown.isNotEmpty()) warnings += "CSV 中未识别列已忽略：${unknown.joinToString("、").take(200)}。"
        return transfer(tracks, pins)
    }

    private fun importWpml(text: String, filename: String, warnings: MutableList<String>): JSONObject {
        require(text.isNotEmpty() && !xmlDanger.containsMatchIn(text)) { "不支持带外部实体的 WPML" }
        require(Regex("xmlns:wpml\\s*=\\s*[\"']https?://www\\.(?:dji|uav)\\.com/wpmz/").containsMatchIn(text)) { "KMZ 内航线不是已识别的 DJI WPML 子集" }
        val parser = XmlPullParserFactory.newInstance().apply { isNamespaceAware = true }.newPullParser(); parser.setInput(StringReader(text))
        val tracks = JSONArray(); var folderDepth = 0; var folderName = ""; var inPlacemark = false
        var index: Int? = null; var lonLat: RouteCoordinate? = null; var capture: String? = null; val content = StringBuilder()
        val points = mutableListOf<Pair<Int, RouteCoordinate>>(); var total = 0; var root = false
        fun finishFolder() {
            if (points.isEmpty()) return
            points.sortBy { it.first }
            require(points.size >= 2 && points.indices.all { points[it].first == it }) { "WPML 航点必须至少两个且编号从0连续" }
            total += points.size; require(total <= MAX_POINTS && tracks.length() < MAX_RECORDS) { "WPML 路线数量或航点超过限制" }
            val builder = TrackBuilder(folderName.ifBlank { labelFromFilename(filename) }, "kml", mutableListOf(points.map { SamplePoint(JSONArray().put(it.second.longitude).put(it.second.latitude), null, null) }.toMutableList()))
            addTrack(tracks, builder.toJson().put("importFormat", "DJI WPML")); points.clear()
        }
        while (true) {
            when (parser.eventType) {
                XmlPullParser.START_TAG -> {
                    if (parser.depth == 1) root = parser.name == "kml"
                    when (parser.name) {
                        "Folder" -> { folderDepth++; if (folderDepth == 1) folderName = "" }
                        "Placemark" -> if (folderDepth > 0) { inPlacemark = true; index = null; lonLat = null }
                        "index", "coordinates", "name" -> if (inPlacemark || parser.name == "name" && folderDepth > 0) { capture = parser.name; content.setLength(0) }
                    }
                }
                XmlPullParser.TEXT, XmlPullParser.CDSECT -> if (capture != null) content.append(parser.text)
                XmlPullParser.END_TAG -> {
                    val value = content.toString().trim()
                    when (capture) {
                        "index" -> index = value.toIntOrNull()
                        "coordinates" -> { val c = value.split(','); if (c.size >= 2) lonLat = RouteCoordinate(c[0].trim().toDoubleOrNull() ?: Double.NaN, c[1].trim().toDoubleOrNull() ?: Double.NaN) }
                        "name" -> if (!inPlacemark && folderDepth > 0) folderName = value.take(200)
                    }
                    if (capture == parser.name) capture = null
                    if (parser.name == "Placemark" && inPlacemark) {
                        val idx = index; val p = lonLat
                        require(idx != null && idx >= 0 && p != null && p.longitude.isFinite() && p.latitude.isFinite() && abs(p.longitude) <= 180 && abs(p.latitude) <= 85.051129) { "WPML 航点编号或坐标无效" }
                        points += idx!! to p!!; inPlacemark = false
                    }
                    if (parser.name == "Folder" && folderDepth > 0) { folderDepth--; if (folderDepth == 0) finishFolder() }
                }
                XmlPullParser.DOCDECL -> throw IllegalArgumentException("不支持带 DTD 的 WPML")
                XmlPullParser.END_DOCUMENT -> break
            }
            parser.next()
        }
        require(root && tracks.length() > 0) { "WPML 中没有符合子集要求的航线" }
        warnings += "DJI WPML 子集只导入航点连线；飞行高度、动作指令与飞行安全参数不会导入，路线不代表地面可通行。"
        return transfer(tracks, JSONArray())
    }

    private fun parseDelimited(text: String, delimiter: Char): List<List<String>> {
        val rows = mutableListOf<List<String>>(); var row = mutableListOf<String>(); val value = StringBuilder()
        var quoted = false; var closed = false; var i = 0
        while (i <= text.length) {
            val c = if (i == text.length) '\n' else text[i]
            if (quoted) {
                if (c == '"') {
                    if (i + 1 < text.length && text[i + 1] == '"') { value.append('"'); i++ }
                    else { quoted = false; closed = true }
                } else value.append(c)
            } else when {
                c == '"' -> { require(value.isEmpty() && !closed) { "CSV引号格式无效" }; quoted = true }
                c == delimiter -> { row += value.toString().trim(); value.setLength(0); closed = false }
                c == '\n' || c == '\r' -> {
                    row += value.toString().trim(); value.setLength(0); closed = false
                    if (row.any(String::isNotBlank)) rows += row
                    row = mutableListOf()
                    if (c == '\r' && i + 1 < text.length && text[i + 1] == '\n') i++
                }
                else -> { require(!closed || c.isWhitespace()) { "CSV引号后有无效字符" }; value.append(c) }
            }
            i++
        }
        require(!quoted) { "CSV引号未闭合" }
        return rows
    }

    private fun unzipBounded(bytes: ByteArray): Map<String, ByteArray> {
        val retained = linkedMapOf<String, ByteArray>(); var entries = 0; var total = 0L
        ZipInputStream(bytes.inputStream()).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                require(++entries <= MAX_ARCHIVE_ENTRIES) { "KMZ 文件条目过多" }
                val retain = entry.name.endsWith(".kml", true) || entry.name.endsWith(".ovkml", true) || entry.name.substringAfterLast('/').equals("waylines.wpml", true)
                val out = if (retain) ByteArrayOutputStream() else null; val buffer = ByteArray(8192)
                while (true) {
                    val n = zip.read(buffer); if (n < 0) break
                    total += n; require(total <= MAX_ARCHIVE_EXPANDED_BYTES) { "KMZ解压内容超过16MB" }
                    out?.write(buffer, 0, n)
                }
                if (out != null) {
                    require(!retained.containsKey(entry.name)) { "KMZ 内有重复的航线文件名" }
                    retained[entry.name] = out.toByteArray()
                }
                zip.closeEntry()
            }
        }
        require(retained.isNotEmpty()) { "KMZ 中没有可支持的 KML 或 WPML 航线文件" }
        return retained
    }

    private fun sample(lon: String, lat: String, altitude: String? = null, time: String? = null): SamplePoint {
        val xy = parseLonLat(lon, lat)
        val alt = altitude?.takeIf(String::isNotBlank)?.toDoubleOrNull()?.also { require(it.isFinite()) { "海拔无效" } }
        val timestamp = time?.takeIf(String::isNotBlank)?.let(::parseIsoTime)
        return SamplePoint(xy, alt, timestamp)
    }

    private fun parseIsoTime(value: String): Long {
        return try { java.time.Instant.parse(value).toEpochMilli() }
        catch (_: Exception) { throw IllegalArgumentException("时间无效（需要ISO-8601时间）") }
    }

    private fun kmlColor(value: String): String {
        require(value.matches(Regex("^(?:[0-9a-fA-F]{8})$"))) { "KML线路颜色无效" }
        // KML stores AABBGGRR; the workspace uses #RRGGBB.
        return "#${value.substring(6, 8)}${value.substring(4, 6)}${value.substring(2, 4)}".lowercase()
    }

    internal fun convertCoordinate(coordinate: JSONArray, system: CoordinateSystem): JSONArray {
        if (system != CoordinateSystem.GCJ02) return coordinate
        val lon = coordinate.getDouble(0); val lat = coordinate.getDouble(1)
        if (!(lon > 73.66 && lon < 135.05 && lat > 3.86 && lat < 53.55)) return coordinate
        val pi = Math.PI; val earth = 6378245.0; val eccentricity = .00669342162296594323
        val x = lon - 105; val y = lat - 35
        var dlat = -100 + 2*x + 3*y + .2*y*y + .1*x*y + .2*kotlin.math.sqrt(abs(x))
        dlat += (20*kotlin.math.sin(6*x*pi)+20*kotlin.math.sin(2*x*pi))*2/3
        dlat += (20*kotlin.math.sin(y*pi)+40*kotlin.math.sin(y/3*pi))*2/3
        dlat += (160*kotlin.math.sin(y/12*pi)+320*kotlin.math.sin(y*pi/30))*2/3
        var dlon = 300+x+2*y+.1*x*x+.1*x*y+.1*kotlin.math.sqrt(abs(x))
        dlon += (20*kotlin.math.sin(6*x*pi)+20*kotlin.math.sin(2*x*pi))*2/3
        dlon += (20*kotlin.math.sin(x*pi)+40*kotlin.math.sin(x/3*pi))*2/3
        dlon += (150*kotlin.math.sin(x/12*pi)+300*kotlin.math.sin(x/30*pi))*2/3
        val rad = lat / 180 * pi; val magic = 1-eccentricity*kotlin.math.sin(rad).pow(2); val root = kotlin.math.sqrt(magic)
        dlat = dlat*180/(earth*(1-eccentricity)/(magic*root)*pi)
        dlon = dlon*180/(earth/root*kotlin.math.cos(rad)*pi)
        return JSONArray().put(lon*2-(lon+dlon)).put(lat*2-(lat+dlat)).also { if(coordinate.length()>2) it.put(coordinate.get(2)) }
    }

    private fun importGeoJson(text: String, filename: String): JSONObject {
        val root = try { JSONObject(text) } catch (e: Exception) { throw IllegalArgumentException("GeoJSON 无效", e) }
        if (root.has("crs")) {
            val crs = root.optJSONObject("crs")?.optJSONObject("properties")?.optString("name", "").orEmpty()
            require(crs in setOf("urn:ogc:def:crs:OGC:1.3:CRS84", "urn:ogc:def:crs:EPSG::4326", "EPSG:4326")) { "GeoJSON 坐标系尚未转换为 WGS84" }
        }
        val tracks = JSONArray(); val pins = JSONArray(); val areas = JSONArray(); var count = 0; var points = 0
        fun coord(value: Any?): SamplePoint {
            val a = value as? JSONArray ?: throw IllegalArgumentException("GeoJSON 坐标无效")
            require(a.length() in 2..3 && a.get(0) is Number && a.get(1) is Number) { "GeoJSON 坐标必须为经度、纬度及可选高程" }
            val lon = a.getDouble(0); val lat = a.getDouble(1); val alt = if (a.length() == 3) a.getDouble(2) else null
            require(lon.isFinite() && lat.isFinite() && kotlin.math.abs(lon) <= 180 && kotlin.math.abs(lat) <= 85.051129 && (alt == null || alt.isFinite())) { "GeoJSON 坐标超出范围" }
            return SamplePoint(JSONArray().put(lon).put(lat), alt, null)
        }
        fun line(value: Any?): MutableList<SamplePoint> {
            val a = value as? JSONArray ?: throw IllegalArgumentException("GeoJSON 线段无效")
            require(a.length() in 2..MAX_POINTS)
            points += a.length(); require(points <= MAX_POINTS) { "路线点数超过6000" }
            return (0 until a.length()).map { coord(a.get(it)) }.toMutableList()
        }
        fun visit(value: JSONObject, inheritedName: String, depth: Int) {
            require(depth <= 32 && ++count <= 10000) { "GeoJSON 层级或对象过多" }
            val type = value.optString("type")
            when (type) {
                "FeatureCollection" -> {
                    val features = value.optJSONArray("features") ?: throw IllegalArgumentException("GeoJSON features 无效")
                    for (i in 0 until features.length()) visit(features.getJSONObject(i), inheritedName, depth + 1)
                }
                "Feature" -> {
                    val properties = value.optJSONObject("properties")
                    val label = properties?.optString("name")?.takeIf { it.isNotBlank() }
                        ?: properties?.optString("title")?.takeIf { it.isNotBlank() } ?: inheritedName
                    val geometry = value.optJSONObject("geometry") ?: throw IllegalArgumentException("GeoJSON Feature 没有几何")
                    if (geometry.optString("type") == "Polygon") {
                        val rings = geometry.optJSONArray("coordinates") ?: throw IllegalArgumentException("GeoJSON 面坐标无效")
                        require(rings.length() == 1) { "原生 GeoJSON 仅支持单外环 Polygon；不会忽略孔洞或多环" }
                        val ring = rings.getJSONArray(0)
                        require(ring.length() in 4..(MAX_POINTS + 1)) { "GeoJSON 面点数无效" }
                        val firstCoord = ring.optJSONArray(0); val lastCoord = ring.optJSONArray(ring.length() - 1)
                        val closed = firstCoord != null && lastCoord != null && firstCoord.length() >= 2 && lastCoord.length() >= 2 &&
                            firstCoord.optDouble(0).compareTo(lastCoord.optDouble(0)) == 0 && firstCoord.optDouble(1).compareTo(lastCoord.optDouble(1)) == 0
                        points += if (closed) ring.length() - 1 else ring.length()
                        require(points <= MAX_POINTS) { "路线点数超过6000" }
                        val boundary = JSONArray(); for (i in 0 until ring.length()) boundary.put(coord(ring.get(i)).coordinate)
                        val first = boundary.getJSONArray(0); val last = boundary.getJSONArray(boundary.length() - 1)
                        require(first.getDouble(0).compareTo(last.getDouble(0)) == 0 && first.getDouble(1).compareTo(last.getDouble(1)) == 0) { "GeoJSON 面环未闭合" }
                        val props = value.optJSONObject("properties")
                        val color = props?.optString("color")?.takeIf { it.matches(Regex("^#[0-9a-fA-F]{6}$")) } ?: "#3388ff"
                        val area = JSONObject().put("id", props?.optString("id")?.takeIf { it.isNotBlank() && it.length <= 100 } ?: UUID.randomUUID().toString())
                            .put("name", label.take(60)).put("note", props?.optString("note", "")?.take(500) ?: "")
                            .put("color", color).put("visible", true).put("boundary", boundary).put("createdAt", System.currentTimeMillis())
                        areas.put(area)
                        return
                    }
                    val firstTrack = tracks.length()
                    val firstPin = pins.length()
                    visit(geometry, label, depth + 1)
                    val style = properties?.optJSONObject("style")
                    if (style != null) {
                        require(style.optString("color").matches(Regex("^#[0-9a-fA-F]{6}$"))) { "GeoJSON 路线颜色无效" }
                        for (i in firstTrack until tracks.length()) tracks.getJSONObject(i).put("style", style)
                    }
                    val kmlTime = properties?.optJSONObject("kmlTime")
                    if (kmlTime != null) {
                        for (i in firstTrack until tracks.length()) tracks.getJSONObject(i).put("kmlTime", kmlTime)
                        for (i in firstPin until pins.length()) pins.getJSONObject(i).put("kmlTime", kmlTime)
                    }
                    val featureId = properties?.optString("id")?.takeIf { it.isNotBlank() && it.length <= 250 }
                        ?: value.optString("id").takeIf { it.isNotBlank() && it.length <= 250 }
                    if (featureId != null && tracks.length() - firstTrack + pins.length() - firstPin == 1) {
                        if (tracks.length() > firstTrack) tracks.getJSONObject(firstTrack).put("id", featureId)
                        else pins.getJSONObject(firstPin).put("id", featureId)
                    }
                }
                "GeometryCollection" -> {
                    val items = value.optJSONArray("geometries") ?: throw IllegalArgumentException("GeoJSON geometries 无效")
                    for (i in 0 until items.length()) visit(items.getJSONObject(i), inheritedName, depth + 1)
                }
                "Point" -> { val p = coord(value.optJSONArray("coordinates")); pins.put(annotation(inheritedName, p.coordinate, "", p.altitude)) }
                "MultiPoint" -> {
                    val items = value.optJSONArray("coordinates") ?: throw IllegalArgumentException("GeoJSON 点集无效")
                    for (i in 0 until items.length()) { val p = coord(items.get(i)); pins.put(annotation(inheritedName, p.coordinate, "", p.altitude)) }
                }
                "LineString" -> addTrack(tracks, TrackBuilder(inheritedName, "shared", mutableListOf(line(value.optJSONArray("coordinates")))).toJson())
                "MultiLineString" -> {
                    val items = value.optJSONArray("coordinates") ?: throw IllegalArgumentException("GeoJSON 多线无效")
                    val segments = (0 until items.length()).map { line(items.get(it)) }.toMutableList()
                    addTrack(tracks, TrackBuilder(inheritedName, "shared", segments).toJson())
                }
                else -> throw IllegalArgumentException("原生线路导入暂不支持 GeoJSON $type；不会忽略或丢弃几何")
            }
        }
        visit(root, labelFromFilename(filename), 0)
        require(tracks.length() <= MAX_RECORDS && pins.length() <= 2000) { "导入对象数量超过限制" }
        require(tracks.length() + pins.length() + areas.length() > 0) { "文件中没有可导入的点、轨迹或区域" }
        return transfer(tracks, pins, areas)
    }

    private fun exportGpx(tracks: List<JSONObject>, pins: JSONArray): String = buildString {
        append("<?xml version=\"1.0\" encoding=\"UTF-8\"?><gpx version=\"1.1\" creator=\"Shantu\" xmlns=\"$GPX_NS\">")
        for (i in 0 until pins.length()) {
            val pin = pins.getJSONObject(i); val xy = pin.getJSONArray("coordinates")
            append("<wpt lat=\"${xy.getDouble(1)}\" lon=\"${xy.getDouble(0)}\"><name>${xml(pin.optString("name"))}</name><desc>${xml(pin.optString("note"))}</desc>")
            pinAltitude(pin)?.let { append("<ele>$it</ele>") }
            pin.optJSONObject("kmlTime")?.let { append("<extensions><shantu:kml-time xmlns:shantu=\"urn:shantu:route-style:1\">${xml(it.toString())}</shantu:kml-time></extensions>") }
            append("</wpt>")
        }
        tracks.forEach { track ->
            append("<trk><name>${xml(track.optString("name"))}</name>")
            val segments = track.optJSONArray("segments") ?: JSONArray()
            val samples = track.optJSONArray("samples")
            for (s in 0 until segments.length()) {
                append("<trkseg>"); val line = segments.getJSONArray(s); val sampleLine = samples?.optJSONArray(s)
                for (p in 0 until line.length()) {
                    val xy = line.getJSONArray(p); val sample = sampleLine?.optJSONObject(p)
                    append("<trkpt lat=\"${xy.getDouble(1)}\" lon=\"${xy.getDouble(0)}\">")
                    if (sample != null && sample.opt("altitude") is Number) append("<ele>${sample.getDouble("altitude")}</ele>")
                    if (sample != null && sample.opt("time") is Number) append("<time>${java.time.Instant.ofEpochMilli(sample.getLong("time"))}</time>")
                    append("</trkpt>")
                }
                append("</trkseg>")
            }
            val styleData = JSONObject().put("style", track.optJSONObject("style") ?: JSONObject().put("color", "#38a8d8").put("width", 2))
            for (key in listOf("edgeColors", "colorConditions")) if (track.has(key)) styleData.put(key, track.get(key))
            track.optJSONObject("kmlTime")?.let { styleData.put("kmlTime", it) }
            append("<extensions><shantu:route-style xmlns:shantu=\"urn:shantu:route-style:1\">${xml(styleData.toString())}</shantu:route-style></extensions></trk>")
        }
        append("</gpx>")
    }

    private fun exportGeoJson(tracks: List<JSONObject>, pins: JSONArray, areas: JSONArray = JSONArray(), areaUnit: String = "m2"): String {
        val features = JSONArray()
        for (i in 0 until pins.length()) {
            val pin = pins.getJSONObject(i)
            val properties = JSONObject().put("id", pin.optString("id")).put("name", pin.optString("name")).put("note", pin.optString("note"))
            pin.optJSONObject("kmlTime")?.let { properties.put("kmlTime", it) }
            val coordinates = JSONArray().put(pin.getJSONArray("coordinates").getDouble(0)).put(pin.getJSONArray("coordinates").getDouble(1))
            pinAltitude(pin)?.let(coordinates::put)
            features.put(JSONObject().put("type", "Feature").put("properties", properties)
                .put("geometry", JSONObject().put("type", "Point").put("coordinates", coordinates)))
        }
        tracks.forEach { track ->
            val segments = track.optJSONArray("segments") ?: JSONArray()
            val coordinates = JSONArray()
            for (s in 0 until segments.length()) {
                val line = segments.getJSONArray(s); val outLine = JSONArray()
                val samples = track.optJSONArray("samples")?.optJSONArray(s)
                for (p in 0 until line.length()) {
                    val xy = line.getJSONArray(p); val sample = samples?.optJSONObject(p)
                    val point = JSONArray().put(xy.getDouble(0)).put(xy.getDouble(1))
                    if (sample?.opt("altitude") is Number) point.put(sample.getDouble("altitude"))
                    outLine.put(point)
                }
                coordinates.put(outLine)
            }
            val geometry = if (coordinates.length() == 1) JSONObject().put("type", "LineString").put("coordinates", coordinates.getJSONArray(0))
            else JSONObject().put("type", "MultiLineString").put("coordinates", coordinates)
            val properties = JSONObject().put("id", track.optString("id")).put("name", track.optString("name"))
            track.optJSONObject("style")?.let { properties.put("style", it) }
            track.optJSONObject("kmlTime")?.let { properties.put("kmlTime", it) }
            features.put(JSONObject().put("type", "Feature").put("properties", properties).put("geometry", geometry))
        }
        for (i in 0 until areas.length()) {
            val area = areas.getJSONObject(i)
            val boundary = area.getJSONArray("boundary")
            val points = (0 until boundary.length()).mapNotNull { index ->
                val point = boundary.optJSONArray(index) ?: return@mapNotNull null
                if (point.length() < 2) null else runCatching { com.shantu.nativeapp.geometry.GeoPoint(point.getDouble(0), point.getDouble(1)) }.getOrNull()
            }
            val measuredSquareMetres = runCatching { com.shantu.nativeapp.geometry.NativeMeasurements.area(com.shantu.nativeapp.geometry.NativeMeasurements.closeBoundary(points)).area }.getOrNull()
                ?: area.optDouble("areaSquareMetres", Double.NaN).takeIf { it.isFinite() && it >= 0.0 }
            val properties = JSONObject().put("id", area.optString("id")).put("name", area.optString("name"))
                .put("note", area.optString("note")).put("color", area.optString("color"))
            measuredSquareMetres?.let { squareMetres ->
                properties.put("areaSquareMetres", squareMetres)
                    .put("areaValue", com.shantu.nativeapp.geometry.NativeAreaDisplay.valueText(squareMetres, areaUnit))
                    .put("areaUnit", com.shantu.nativeapp.geometry.NativeAreaDisplay.unit(areaUnit).id)
            }
            features.put(JSONObject().put("type", "Feature")
                .put("properties", properties)
                .put("geometry", JSONObject().put("type", "Polygon").put("coordinates", JSONArray().put(boundary))))
        }
        return JSONObject().put("type", "FeatureCollection").put("features", features).toString()
    }

    private fun readBounded(input: InputStream): ByteArray {
        val out = ByteArrayOutputStream(); val buffer = ByteArray(16 * 1024)
        while (true) {
            val n = input.read(buffer); if (n < 0) break
            require(out.size().toLong() + n <= MAX_BYTES) { "线路文件超过8MB" }
            out.write(buffer, 0, n)
        }
        return out.toByteArray()
    }

    private fun pinAltitude(pin: JSONObject): Double? {
        val ground = pin.opt("groundElevation")
        val value = if (ground is Number) ground.toDouble() else pin.optDouble("centerAltitude", Double.NaN)
        return value.takeIf { it.isFinite() }
    }

    internal fun transfer(tracks: JSONArray, annotations: JSONArray, areas: JSONArray = JSONArray()) = JSONObject()
        .put("format", "guanyun-backup").put("version", 1).put("tracks", tracks)
        .put("annotations", annotations).put("favorites", JSONArray()).also { if (areas.length() > 0) it.put("areas", areas) }

    private fun addTrack(array: JSONArray, value: JSONObject) {
        require(array.length() < MAX_RECORDS) { "路线超过100条" }; array.put(value)
    }

    private fun parseLonLat(lonText: String?, latText: String?): JSONArray {
        val lon = lonText?.toDoubleOrNull() ?: throw IllegalArgumentException("坐标缺失或无效")
        val lat = latText?.toDoubleOrNull() ?: throw IllegalArgumentException("坐标缺失或无效")
        require(lon.isFinite() && lat.isFinite() && kotlin.math.abs(lon) <= 180 && kotlin.math.abs(lat) <= 85.051129) { "坐标超出地图范围" }
        return JSONArray().put(lon).put(lat)
    }

    private fun parseKmlCoordinate(text: String): SamplePoint {
        val parts = text.split(',')
        require(parts.size in 2..3)
        val xy = parseLonLat(parts[0], parts[1]); val alt = parts.getOrNull(2)?.takeIf(String::isNotBlank)?.toDoubleOrNull()
        require(alt == null || alt.isFinite()) { "KML 高程无效" }
        return SamplePoint(xy, alt, null)
    }

    internal fun annotation(name: String, coordinates: JSONArray, note: String, altitude: Double? = null) = JSONObject()
        .put("id", UUID.randomUUID().toString()).put("kind", "pin").put("name", name.take(60)).put("note", note.take(500))
        .put("color", "#ffcc00").put("coordinates", coordinates).put("groundElevation", JSONObject.NULL)
        .put("placement", "surface").put("offset", 0).put("width", 1).put("length", 1).put("height", 1)
        .put("heading", 0).put("pitch", 0).put("roll", 0).put("opacity", .85).put("visible", true).put("icon", "pin")
        .also { if (altitude != null) it.put("groundElevation", altitude) }

    private fun labelFromFilename(filename: String) = filename.substringBeforeLast('.', filename).ifBlank { "导入线路" }.take(200)
    private fun xml(value: String) = value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&apos;")

    private data class SamplePoint(val coordinate: JSONArray, val altitude: Double?, val time: Long?)
    private data class RouteCoordinate(val longitude: Double, val latitude: Double)
    private data class TrackBuilder(var name: String, val source: String, val segments: MutableList<MutableList<SamplePoint>> = mutableListOf()) {
        var style: JSONObject = JSONObject().put("color", "#38a8d8").put("width", 2)
        var styleExtras: JSONObject = JSONObject()
        var kmlTime: JSONObject? = null
        fun readStyle(text: String) {
            val decoded = JSONObject(text)
            val candidate = decoded.optJSONObject("style") ?: throw IllegalArgumentException("GPX 路线样式无效")
            require(candidate.optString("color").matches(Regex("^#[0-9a-fA-F]{6}$"))) { "GPX 路线颜色无效" }
            style = candidate
            styleExtras = decoded
            kmlTime = decoded.optJSONObject("kmlTime")
        }
        fun toJson(): JSONObject {
            require(segments.isNotEmpty() && segments.all { it.isNotEmpty() }) { "轨迹线段不能为空" }
            val coords = JSONArray(); val rows = JSONArray()
            segments.forEach { segment ->
                val line = JSONArray(); val samples = JSONArray()
                segment.forEach { p -> line.put(p.coordinate); samples.put(JSONObject().put("time", p.time ?: JSONObject.NULL).put("altitude", p.altitude ?: JSONObject.NULL)) }
                coords.put(line); rows.put(samples)
            }
            val out = JSONObject().put("id", UUID.randomUUID().toString()).put("name", name.ifBlank { "导入线路" }.take(200))
                .put("createdAt", System.currentTimeMillis()).put("source", source).put("segments", coords).put("samples", rows).put("style", style)
            for (key in listOf("edgeColors", "colorConditions")) if (styleExtras.has(key)) out.put(key, styleExtras.get(key))
            kmlTime?.let { out.put("kmlTime", it) }
            return out
        }
    }
    private data class KmlPlacemark(
        var name: String,
        var id: String = "",
        val segments: MutableList<MutableList<SamplePoint>> = mutableListOf(),
        val points: MutableList<SamplePoint> = mutableListOf(),
        var styleUrl: String = "",
        var inlineStyle: String? = null,
        var timestamp: Long? = null,
        var timeBegin: Long? = null,
        var timeEnd: Long? = null,
        var kmlTime: JSONObject? = null,
    )
}
