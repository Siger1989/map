package com.shantu.nativeapp.industry

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.*

object NativeSectionImporter {
    val PARAMETERS = listOf("项目名称", "剖面编号", "剖面方位角_deg", "长度单位", "角度单位")
    val COLUMNS = listOf("记录号", "导线段号", "层号", "起读数_m", "止读数_m", "斜距_m", "坡角_deg", "方位角_deg", "倾向_deg", "倾角_deg", "岩性名称", "岩性描述", "样品编号", "样品距测段起点_m", "原表平距_m", "原表高差_m", "原表累计高差_m", "原表累计北_m", "原表累计东_m", "实测真厚度_m")
    private val materialCodes = mapOf("凝灰岩" to "TUF", "泥岩" to "MUD", "粉砂质泥岩" to "SMD", "砂岩" to "SST")

    fun importWorkbook(workbook: NativeXlsxWorkbook): NativeIndustryImportResult {
        val issues = workbook.warnings.toMutableList()
        rejectFormulaCells(workbook)
        val project = workbook.sheets["项目"] ?: fail("工作簿必须包含“项目”和“测段”工作表")
        val segment = workbook.sheets["测段"] ?: fail("工作簿必须包含“项目”和“测段”工作表")
        val (params, paramCells) = projectParameters(project)
        for (key in PARAMETERS) if (!params.containsKey(key)) issues += issue("error", "MISSING_PROJECT_PARAMETER", "项目表缺少参数：$key", listOf("项目!A:A"))
        if (txt(params["长度单位"]) != "m") issues += issue("error", "INVALID_LENGTH_UNIT", "长度单位必须为 m", listOf(paramCells["长度单位"] ?: "项目!B:B"))
        if (txt(params["角度单位"]) != "deg") issues += issue("error", "INVALID_ANGLE_UNIT", "角度单位必须为 deg", listOf(paramCells["角度单位"] ?: "项目!B:B"))
        val table = rowsByHeader(segment, "测段")
        val duplicates = table.headers.filter { it.isNotBlank() && table.headers.count { h -> h == it } > 1 }.distinct()
        val missing = COLUMNS.filter { it !in table.headers }
        if (duplicates.isNotEmpty()) issues += issue("error", "DUPLICATE_COLUMN", "测段表存在重复列名：${duplicates.joinToString(", ")}", listOf("测段!1:1"))
        if (missing.isNotEmpty()) issues += issue("error", "MISSING_COLUMN", "测段表缺少列：${missing.joinToString(", ")}", listOf("测段!1:1"))
        failIfErrors(issues)
        val rows = table.rows
        if (rows.isEmpty()) issues += issue("error", "NO_RECORDS", "工作簿没有测段记录")
        var prevLeg = ""; var prevLayer = ""; var prevDesc = ""; var prevLith = ""
        var prevLegCell = ""; var prevLayerCell = ""; var prevDescCell = ""; var prevLithCell = ""
        var east = 0.0; var north = 0.0; var z = 0.0; var horizontalChainage = 0.0; var slantChainage = 0.0
        val records = JSONArray(); val recordIds = mutableSetOf<String>(); val recList = mutableListOf<JSONObject>()
        rows.forEachIndexed { index, row ->
            val v = row.values; val c = row.cells
            val explicitLeg = txt(v["导线段号"]); val explicitLayer = txt(v["层号"])
            val legCell = c["导线段号"] ?: "测段!A${row.row}"; val layerCell = c["层号"] ?: "测段!A${row.row}"
            val leg = explicitLeg.ifBlank { prevLeg }; val layer = explicitLayer.ifBlank { prevLayer }
            val legSource = if (explicitLeg.isNotBlank()) legCell else prevLegCell
            val layerSource = if (explicitLayer.isNotBlank()) layerCell else prevLayerCell
            if (explicitLeg.isNotBlank()) { prevLeg = explicitLeg; prevLegCell = legCell }
            if (explicitLayer.isNotBlank()) { prevLayer = explicitLayer; prevLayerCell = layerCell }
            if (leg.isBlank()) issues += issue("error", "MISSING_LEG_ID", "测量行缺少导线段号且无法继承", listOf(legCell))
            if (layer.isBlank()) issues += issue("error", "MISSING_LAYER_ID", "测量行缺少层号且无法继承", listOf(layerCell))
            fun ref(field: String) = c[field] ?: "测段!A${row.row}"
            val length = num(v["斜距_m"], ref("斜距_m"), issues, true)
            val slope = num(v["坡角_deg"], ref("坡角_deg"), issues, true)
            val az = num(v["方位角_deg"], ref("方位角_deg"), issues, true)
            val dipDir = if (blank(v["倾向_deg"])) null else num(v["倾向_deg"], ref("倾向_deg"), issues)
            val dip = if (blank(v["倾角_deg"])) null else num(v["倾角_deg"], ref("倾角_deg"), issues)
            if (length != null && length <= 0) issues += issue("error", "INVALID_LENGTH", "斜距必须大于 0", listOf(ref("斜距_m")))
            if (slope != null && slope !in -90.0..90.0) issues += issue("error", "INVALID_SLOPE", "坡角必须在 [-90, 90]", listOf(ref("坡角_deg")))
            if (az != null && (az < 0 || az >= 360)) issues += issue("error", "INVALID_AZIMUTH", "方位角必须在 [0, 360)", listOf(ref("方位角_deg")))
            if ((dipDir == null) != (dip == null)) issues += issue("error", "INCOMPLETE_ATTITUDE", "倾向和倾角必须同时提供或同时留空", listOf(ref("倾向_deg"), ref("倾角_deg")))
            if (dipDir != null && (dipDir < 0.0 || dipDir >= 360.0)) issues += issue("error", "INVALID_DIP_DIRECTION", "倾向必须在 [0, 360)", listOf(ref("倾向_deg")))
            if (dip != null && dip !in 0.0..90.0) issues += issue("error", "INVALID_DIP_ANGLE", "倾角必须在 [0, 90]", listOf(ref("倾角_deg")))
            val thickness = if (blank(v["实测真厚度_m"])) null else num(v["实测真厚度_m"], ref("实测真厚度_m"), issues)
            if (thickness != null && thickness < 0) issues += issue("error", "INVALID_TRUE_THICKNESS", "实测真厚度不得小于 0", listOf(ref("实测真厚度_m")))
            if (length == null || slope == null || az == null || length <= 0 || slope !in -90.0..90.0 || az < 0 || az >= 360) return@forEachIndexed
            val start = v["起读数_m"]; val end = v["止读数_m"]
            if (blank(start) != blank(end)) issues += issue("warning", "INCOMPLETE_READING_PAIR", "起读数和止读数只提供了一项，已保留原值且不推断另一项", listOf(if (blank(start)) ref("止读数_m") else ref("起读数_m")))
            else if (!blank(start)) {
                val a = num(start, ref("起读数_m"), mutableListOf()); val b = num(end, ref("止读数_m"), mutableListOf())
                if (a == null || b == null) issues += issue("warning", "INVALID_READING_CACHE", "起止读数必须是有限数字，已保留原值", listOf(ref("起读数_m"), ref("止读数_m")))
                else if (abs((b - a) - length) > 1e-6) issues += issue("warning", "READING_LENGTH_MISMATCH", "止读数减起读数与斜距不一致，保留原值并采用斜距计算", listOf(ref("起读数_m"), ref("止读数_m"), ref("斜距_m")))
            }
            val sr = Math.toRadians(slope); val ar = Math.toRadians(az)
            val horizontal = length * cos(sr); val vertical = length * sin(sr)
            val de = horizontal * sin(ar); val dn = horizontal * cos(ar)
            east += de; north += dn; z += vertical; horizontalChainage += horizontal; slantChainage += length
            val sameLayer = layer == recList.lastOrNull()?.optString("layer_id").orEmpty()
            var description = txt(v["岩性描述"]); var lithology = txt(v["岩性名称"])
            var descCell = ref("岩性描述"); var lithCell = ref("岩性名称")
            if (description.isBlank() && sameLayer && prevDesc.isNotBlank()) { description = prevDesc; descCell = prevDescCell }
            if (lithology.isBlank() && sameLayer && prevLith.isNotBlank()) { lithology = prevLith; lithCell = prevLithCell }
            if (!sameLayer) { prevDesc = ""; prevLith = ""; prevDescCell = ""; prevLithCell = "" }
            if (description.isNotBlank()) { prevDesc = description; prevDescCell = descCell }
            if (lithology.isNotBlank()) { prevLith = lithology; prevLithCell = lithCell }
            val id = txt(v["记录号"]).ifBlank { "R${(index + 1).toString().padStart(4, '0')}" }
            if (!recordIds.add(id)) issues += issue("error", "DUPLICATE_RECORD_ID", "记录号“$id”重复", listOf(ref("记录号")))
            val raw = JSONObject(); v.forEach { (key, value) -> if (!blank(value)) raw.put(ref(key), value) }
            val sourceCells = JSONObject().put("record_id", ref("记录号")).put("leg_id", legSource.ifBlank { legCell }).put("layer_id", layerSource.ifBlank { layerCell })
                .put("start_reading_m", ref("起读数_m")).put("end_reading_m", ref("止读数_m")).put("length_m", ref("斜距_m"))
                .put("slope_deg", ref("坡角_deg")).put("azimuth_deg", ref("方位角_deg")).put("dip_direction_deg", ref("倾向_deg"))
                .put("dip_angle_deg", ref("倾角_deg")).put("lithology_name", lithCell).put("description", descCell).put("sample_id", ref("样品编号"))
                .put("sample_offset_m", ref("样品距测段起点_m")).put("true_thickness_m", ref("实测真厚度_m"))
                .put("cache_horizontal_m", ref("原表平距_m")).put("cache_vertical_m", ref("原表高差_m"))
                .put("cache_cumulative_z_m", ref("原表累计高差_m")).put("cache_cumulative_north_m", ref("原表累计北_m")).put("cache_cumulative_east_m", ref("原表累计东_m"))
            val record = JSONObject().put("id", id).put("leg_id", leg).put("layer_id", layer).put("length_m", length).put("slope_deg", slope).put("azimuth_deg", az)
                .put("dip_direction_deg", jsonValue(dipDir)).put("dip_angle_deg", jsonValue(dip)).put("lithology_name", lithology).put("description", description)
                .put("start_node", recList.size).put("end_node", recList.size + 1).put("raw", raw).put("source_cells", sourceCells)
                .put("computed", JSONObject().put("horizontal_m", horizontal).put("vertical_m", vertical).put("east_delta_m", de).put("north_delta_m", dn)).put("true_thickness_m", jsonValue(thickness))
            recList += record; records.put(record)
            val cacheFields = listOf(
                Triple("原表平距_m", "平距", horizontal), Triple("原表高差_m", "高差", vertical),
                Triple("原表累计高差_m", "累计高差", z), Triple("原表累计北_m", "累计北坐标", north), Triple("原表累计东_m", "累计东坐标", east),
            )
            for ((field, label, calculated) in cacheFields) if (!blank(v[field])) {
                val cached = num(v[field], ref(field), mutableListOf())
                if (cached == null) issues += issue("warning", "INVALID_CACHE_VALUE", "${ref(field)} 的${label}缓存不是数字，已保留原值", listOf(ref(field)))
                else if (abs(cached - calculated) > 1e-6) {
                    fun repr(n: Double) = if (n % 1.0 == 0.0) "$n" else n.toString()
                    val residual = cached - calculated
                    issues += issue("warning", "CACHE_MISMATCH", "${label}缓存 ${repr(cached)} 与独立计算 ${repr(calculated)} 的残差为 ${repr(residual)}", listOf(ref(field)))
                }
            }
        }
        failIfErrors(issues)
        val axisRaw = params["剖面方位角_deg"]
        val axis: Double; val axisMethod: String
        if (blank(axisRaw)) { if (hypot(east, north) <= 1e-12) throw NativeIndustryImportException("首末点重合，必须显式设置剖面方位角", issuesJson(issues)); axis = (Math.toDegrees(atan2(east, north)) % 360 + 360) % 360; axisMethod = "endpoint" }
        else { val parsed = num(axisRaw, paramCells["剖面方位角_deg"] ?: "项目!B:B", issues); if (parsed == null || parsed < 0 || parsed >= 360) { issues += issue("error", "INVALID_AXIS_AZIMUTH", "剖面方位角必须在 [0, 360)", listOf(paramCells["剖面方位角_deg"] ?: "项目!B:B")); failIfErrors(issues) }; axis = parsed!!; axisMethod = "explicit" }
        val axisRad = Math.toRadians(axis); val nodes = JSONArray().put(JSONObject().put("index", 0).put("east_m", 0).put("north_m", 0).put("z_m", 0).put("x_m", 0).put("offset_m", 0).put("chainage_m", 0).put("slant_chainage_m", 0))
        var ce = 0.0; var cn = 0.0; var cz = 0.0; var ch = 0.0; var cs = 0.0
        recList.forEach { r -> val c = r.getJSONObject("computed"); ce += c.getDouble("east_delta_m"); cn += c.getDouble("north_delta_m"); cz += c.getDouble("vertical_m"); ch += c.getDouble("horizontal_m"); cs += r.getDouble("length_m"); nodes.put(JSONObject().put("index", nodes.length()).put("east_m", ce).put("north_m", cn).put("z_m", cz).put("x_m", ce * sin(axisRad) + cn * cos(axisRad)).put("offset_m", cn * sin(axisRad) - ce * cos(axisRad)).put("chainage_m", ch).put("slant_chainage_m", cs)) }
        val intervals = JSONArray(); val intervalList = mutableListOf<JSONObject>()
        recList.forEach { r ->
            val layer = r.getString("layer_id")
            if (intervalList.lastOrNull()?.optString("layer_id") != layer) {
                val s = r.getJSONObject("source_cells")
                val lithology = r.optString("lithology_name"); val description = r.optString("description")
                val interval = JSONObject().put("id", "I${(intervalList.size + 1).toString().padStart(4, '0')}").put("layer_id", layer).put("start_node", r.getInt("start_node")).put("end_node", r.getInt("end_node")).put("record_ids", JSONArray().put(r.getString("id"))).put("lithology_name", if (lithology.isBlank()) JSONObject.NULL else lithology).put("description", if (description.isBlank()) JSONObject.NULL else description).put("source_cells", JSONObject().put("layer_id", JSONArray().put(s.getString("layer_id"))).put("lithology_name", JSONArray().put(s.getString("lithology_name"))).put("description", JSONArray().put(s.getString("description"))))
                intervalList += interval; intervals.put(interval)
            } else {
                val it = intervalList.last(); val lith = it.optString("lithology_name"); val now = r.optString("lithology_name")
                if (lith.isNotBlank() && now.isNotBlank() && lith != now) issues += issue("error", "LITHOLOGY_CONFLICT", "连续层段 $layer 内存在不同明确岩性名称，请分层或修正层号", listOf(it.getJSONObject("source_cells").getJSONArray("lithology_name").getString(0), r.getJSONObject("source_cells").getString("lithology_name")))
                else if (lith.isBlank() && now.isNotBlank()) it.put("lithology_name", now)
                it.put("end_node", r.getInt("end_node")); it.getJSONArray("record_ids").put(r.getString("id"))
                for ((key, sourceKey) in listOf("layer_id" to "layer_id", "description" to "description")) { val arr = it.getJSONObject("source_cells").getJSONArray(key); val cell = r.getJSONObject("source_cells").getString(sourceKey); if ((0 until arr.length()).none { arr.getString(it) == cell }) arr.put(cell) }
            }
        }
        failIfErrors(issues)
        val attitudes = JSONArray(); var lastAttitude = ""
        recList.forEach { r -> if (r.isNull("dip_direction_deg")) { lastAttitude = ""; return@forEach }; val key = "${r.getString("layer_id")}\u0000${r.getDouble("dip_direction_deg")}\u0000${r.getDouble("dip_angle_deg")}"; if (key != lastAttitude) attitudes.put(JSONObject().put("id", "A${(attitudes.length() + 1).toString().padStart(4, '0')}").put("record_id", r.getString("id")).put("layer_id", r.getString("layer_id")).put("node", r.getInt("start_node")).put("dip_direction_deg", r.getDouble("dip_direction_deg")).put("dip_angle_deg", r.getDouble("dip_angle_deg")).put("location_basis", "record_start_association")); lastAttitude = key }
        val samples = JSONArray()
        rows.forEachIndexed { index, row ->
            val r = recList.getOrNull(index) ?: return@forEachIndexed; val id = txt(row.values["样品编号"]); val offset = row.values["样品距测段起点_m"]
            if (id.isBlank()) { if (!blank(offset)) issues += issue("warning", "ORPHAN_SAMPLE_OFFSET", "提供了样品距离但没有样品编号，未创建样品", listOf(row.cells["样品距测段起点_m"] ?: "")); return@forEachIndexed }
            val source = JSONObject().put("sample_id", row.cells["样品编号"]).put("sample_offset_m", row.cells["样品距测段起点_m"])
            if (blank(offset)) { samples.put(JSONObject().put("id", id).put("record_id", r.getString("id")).put("layer_id", r.getString("layer_id")).put("position", JSONObject.NULL).put("location_status", "missing").put("source_cells", source)); return@forEachIndexed }
            val along = num(offset, row.cells["样品距测段起点_m"] ?: "", issues)
            if (along == null || along < 0 || along > r.getDouble("length_m")) { issues += issue("error", "INVALID_SAMPLE_OFFSET", "样品距测段起点必须在 [0, 斜距]", listOf(row.cells["样品距测段起点_m"] ?: "")); return@forEachIndexed }
            val ratio = along / r.getDouble("length_m"); val start = nodes.getJSONObject(r.getInt("start_node")); val end = nodes.getJSONObject(r.getInt("end_node")); val pos = JSONObject()
            for (k in listOf("east_m", "north_m", "z_m", "x_m", "offset_m")) pos.put(k, start.getDouble(k) + (end.getDouble(k) - start.getDouble(k)) * ratio)
            samples.put(JSONObject().put("id", id).put("record_id", r.getString("id")).put("layer_id", r.getString("layer_id")).put("position", pos).put("location_status", "explicit_offset").put("source_cells", source))
        }
        failIfErrors(issues)
        val stations = JSONArray(); var currentEnd: String? = null; var prevStationLeg: String? = null
        recList.forEach { r ->
            val leg = r.getString("leg_id"); if (leg == prevStationLeg) return@forEach
            val parsed = Regex("^\\s*([^\\s\\-—–]+)\\s*[\\-—–]\\s*([^\\s\\-—–]+)\\s*$").matchEntire(leg)
            val source = r.getJSONObject("source_cells").getString("leg_id")
            val start: String; val end: String
            if (parsed == null) { issues += issue("warning", "UNPARSEABLE_LEG_ID", "导线段号“$leg”无法拆为起点-终点，使用自动站号", listOf(source)); start = "AUTO-${r.getInt("start_node")}"; end = "AUTO-${r.getInt("end_node")}"; currentEnd = null }
            else { start = parsed.groupValues[1]; end = parsed.groupValues[2]; if (currentEnd != null && start != currentEnd) issues += issue("error", "DISCONNECTED_STATIONS", "导线段 $leg 与前一可拆导线段不相接", listOf(source)); currentEnd = end }
            if (stations.length() == 0 || stations.getJSONObject(stations.length() - 1).getInt("node") != r.getInt("start_node")) stations.put(JSONObject().put("id", start).put("node", r.getInt("start_node")).put("source_cell", source))
            prevStationLeg = leg
        }
        if (recList.isNotEmpty()) stations.put(JSONObject().put("id", currentEnd ?: "AUTO-${recList.size}").put("node", recList.size).put("source_cell", recList.last().getJSONObject("source_cells").getString("leg_id")))
        failIfErrors(issues)
        val end = nodes.getJSONObject(nodes.length() - 1)
        val normalized = JSONObject().put("schema_version", "1.0").put("source", JSONObject().put("filename", workbook.filename).put("sha256", workbook.sha256).put("adapter", "canonical_xlsx_v1").put("sheet", "测段"))
            .put("project", JSONObject().put("name", txt(params["项目名称"])).put("section_id", txt(params["剖面编号"])))
            .put("settings", JSONObject().put("axis_azimuth_deg", axis).put("axis_method", axisMethod).put("coordinate_system", "local_relative").put("vertical_exaggeration", 1))
            .put("records", records).put("nodes", nodes).put("intervals", intervals).put("stations", stations).put("attitudes", attitudes).put("samples", samples).put("issues", issuesJson(issues))
            .put("summary", JSONObject().put("records", recList.size).put("intervals", intervals.length()).put("stations", stations.length()).put("samples", samples.length()).put("located_samples", (0 until samples.length()).count { !samples.getJSONObject(it).isNull("position") }).put("total_slant_m", recList.sumOf { it.getDouble("length_m") }).put("total_horizontal_m", recList.sumOf { it.getJSONObject("computed").getDouble("horizontal_m") }).put("total_vertical_m", end.getDouble("z_m")).put("endpoint_east_m", end.getDouble("east_m")).put("endpoint_north_m", end.getDouble("north_m")).put("axis_azimuth_deg", axis).put("projected_endpoint_m", end.getDouble("x_m")))
        return NativeIndustryImportResult(normalized, issuesJson(issues))
    }
}

private fun fail(message: String): Nothing = throw NativeIndustryImportException(message)

internal data class NativeHeaderRow(val row: Int, val values: Map<String, Any?>, val cells: Map<String, String>, val formulas: Map<String, String>)
internal data class NativeHeaderTable(val headers: List<String>, val rows: List<NativeHeaderRow>)
internal fun rowsByHeader(sheet: NativeXlsxSheet, label: String, headerRow: Int = 1): NativeHeaderTable {
    val header = sheet.rows.firstOrNull { it.row == headerRow } ?: throw NativeIndustryImportException("XLSX：$label!$headerRow 缺少表头行")
    val max = header.cells.keys.maxOfOrNull { addressColumn(it) } ?: -1
    val headers = (0..max).map { col -> (header.cells[cellAddress(col, headerRow)] as? String ?: header.cells[cellAddress(col, headerRow)]?.toString().orEmpty()).trim() }
    val data = sheet.rows.filter { it.row > headerRow }.map { row ->
        val values = linkedMapOf<String, Any?>(); val cells = linkedMapOf<String, String>(); val formulas = linkedMapOf<String, String>()
        headers.forEachIndexed { i, name -> if (name.isNotEmpty()) { val address = cellAddress(i, row.row); values[name] = row.cells[address]; cells[name] = "$label!$address"; row.formulas[address]?.let { formulas[name] = it } } }
        NativeHeaderRow(row.row, values, cells, formulas)
    }.filter { r -> r.values.values.any { !blank(it) } || r.formulas.isNotEmpty() }
    return NativeHeaderTable(headers, data)
}
internal fun projectParameters(sheet: NativeXlsxSheet): Pair<Map<String, Any?>, Map<String, String>> {
    val table = rowsByHeader(sheet, "项目")
    if (table.headers.getOrNull(0) != "参数" || table.headers.getOrNull(1) != "值") throw NativeIndustryImportException("XLSX：项目!A1/B1 必须为“参数”/“值”")
    val params = linkedMapOf<String, Any?>(); val cells = linkedMapOf<String, String>()
    table.rows.forEach { row -> val key = txt(row.values["参数"]); if (key.isNotBlank()) { if (params.containsKey(key)) throw NativeIndustryImportException("XLSX：项目!A${row.row} 参数“$key”重复"); params[key] = row.values["值"]; cells[key] = row.cells["值"].orEmpty() } }
    return params to cells
}
internal fun blank(value: Any?) = value == null || value is String && value.trim().isEmpty()
internal fun txt(value: Any?) = when (value) { null -> ""; is Double -> if (value % 1.0 == 0.0) value.toLong().toString() else value.toString(); else -> value.toString().trim() }
internal fun issue(severity: String, code: String, message: String, cells: List<String> = emptyList()) = NativeIndustryIssue(severity, code, message, cells)
internal fun issuesJson(issues: List<NativeIndustryIssue>) = JSONArray().also { a -> issues.forEach { i -> a.put(JSONObject().put("severity", i.severity).put("code", i.code).put("message", i.message).also { o -> if (i.cells.isNotEmpty()) o.put("cells", JSONArray(i.cells)) }) } }
internal fun failIfErrors(issues: List<NativeIndustryIssue>) { if (issues.any { it.severity == "error" }) throw NativeIndustryImportException(issues.filter { it.severity == "error" }.take(5).joinToString("；") { "${it.cells.joinToString(",")} ${it.message}" }, issuesJson(issues)) }
internal fun num(value: Any?, at: String, issues: MutableList<NativeIndustryIssue>, required: Boolean = false): Double? {
    if (blank(value)) { if (required) issues += issue("error", "MISSING_GEOMETRY", "$at 缺少必需几何值", listOf(at)); return null }
    if (value is Boolean) { issues += issue("error", "INVALID_NUMBER", "$at 的 TRUE/FALSE 不是有效数字", listOf(at)); return null }
    val n = when (value) { is Number -> value.toDouble(); else -> value.toString().trim().toDoubleOrNull() }
    if (n == null || !n.isFinite()) { issues += issue("error", "INVALID_NUMBER", "$at 不是有效数字", listOf(at)); return null }; return n
}
internal fun cellAddress(column: Int, row: Int): String { var n = column + 1; var letters = ""; while (n > 0) { val rem = (n - 1) % 26; letters = ('A'.code + rem).toChar() + letters; n = (n - 1) / 26 }; return "$letters$row" }
internal fun addressColumn(address: String): Int { var n = 0; for (c in address.takeWhile(Char::isLetter)) n = n * 26 + c.uppercaseChar().code - 64; return n - 1 }
internal fun jsonValue(value: Any?): Any = value ?: JSONObject.NULL
internal fun rejectFormulaCells(workbook: NativeXlsxWorkbook) {
    val formula = workbook.sheets.values.firstNotNullOfOrNull { sheet ->
        sheet.rows.firstNotNullOfOrNull { row -> row.formulas.keys.firstOrNull()?.let { "${sheet.name}!$it" } }
    }
    if (formula != null) throw NativeIndustryImportException("$formula 是公式；请粘贴计算后的值")
}
