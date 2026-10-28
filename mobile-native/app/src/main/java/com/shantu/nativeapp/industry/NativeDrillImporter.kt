package com.shantu.nativeapp.industry

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.max

/** Native importer dispatch for canonical drill-1.0 and integrated drill v2/v3 workbooks. */
object NativeDrillImporter {
    val PARAMETERS = listOf("模板类型", "模板版本", "项目名称", "钻孔编号", "长度单位", "孔深基准", "终孔深度_m", "Au单位", "Pb单位", "Zn单位")
    val COLUMNS = linkedMapOf(
        "分层" to listOf("层号", "顶深_m", "底深_m", "岩性名称", "岩性描述", "岩心长_m", "花纹代码"),
        "回次" to listOf("回次号", "顶深_m", "底深_m", "岩心长_m"),
        "样品" to listOf("样品编号", "顶深_m", "底深_m", "岩心长_m", "Au", "Pb", "Zn"),
        "孔径" to listOf("孔深_m", "孔径_mm"),
    )
    private val knownPatterns = mapOf("D001" to "short-dash-double-dot", "D002" to "dot-rows-thin-lines", "D003" to "point-dash-ellipse-bands")
    private val exactMaterials = mapOf("泥岩夹泥质粉砂岩" to "D001", "泥岩、泥质粉砂岩。" to "D002", "泥岩、泥质粉砂岩" to "D002", "砂岩夹粉砂岩" to "D003")

    fun importWorkbook(workbook: NativeXlsxWorkbook): NativeIndustryImportResult {
        val issues = workbook.warnings.toMutableList()
        if (workbook.sheets.containsKey("钻孔基本信息")) return NativeIntegratedDrillImporter.importWorkbook(workbook)
        rejectFormulaCells(workbook)
        val projectSheet = workbook.sheets["项目"] ?: throw NativeIndustryImportException("规范工作簿必须包含“项目”工作表")
        val (params, paramCells) = projectParameters(projectSheet)
        for (key in PARAMETERS) if (!params.containsKey(key)) issues += issue("error", "MISSING_PROJECT_PARAMETER", "项目表缺少参数：$key", listOf("项目!A:A"))
        if (txt(params["模板类型"]) != "钻孔柱状图") issues += issue("error", "INVALID_TEMPLATE_TYPE", "模板类型必须为“钻孔柱状图”", listOf(paramCells["模板类型"] ?: "项目!B:B"))
        val version = params["模板版本"]
        if (!(version is Number && version.toDouble() == 1.0 || txt(version) == "1.0")) issues += issue("error", "INVALID_TEMPLATE_VERSION", "模板版本必须为 1.0", listOf(paramCells["模板版本"] ?: "项目!B:B"))
        if (txt(params["长度单位"]) != "m") issues += issue("error", "INVALID_LENGTH_UNIT", "长度单位必须为 m", listOf(paramCells["长度单位"] ?: "项目!B:B"))
        val basis = txt(params["孔深基准"])
        if (basis !in setOf("原始沿孔深", "校正沿孔深")) issues += issue("error", "INVALID_DEPTH_BASIS", "孔深基准必须明确为原始沿孔深或校正沿孔深", listOf(paramCells["孔深基准"] ?: "项目!B:B"))
        val holeId = txt(params["钻孔编号"])
        if (holeId.isBlank()) issues += issue("error", "MISSING_HOLE_ID", "钻孔编号必填", listOf(paramCells["钻孔编号"] ?: "项目!B:B"))
        val endpoint = num(params["终孔深度_m"], paramCells["终孔深度_m"] ?: "项目!B:B", issues, true)
        if (endpoint != null && endpoint <= 0) issues += issue("error", "INVALID_ENDPOINT", "终孔深度必须大于 0", listOf(paramCells["终孔深度_m"] ?: "项目!B:B"))
        val tables = linkedMapOf<String, NativeHeaderTable>()
        for ((name, required) in COLUMNS) {
            val sheet = workbook.sheets[name]
            if (sheet == null) { if (name == "分层") issues += issue("error", "MISSING_LAYER_SHEET", "必需的“分层”工作表缺失"); continue }
            val table = rowsByHeader(sheet, name)
            val duplicates = required.filter { h -> table.headers.count { it == h } > 1 }.distinct()
            val missing = required.filter { it !in table.headers }
            if (duplicates.isNotEmpty()) issues += issue("error", "DUPLICATE_COLUMN", "${name}表存在重复列名：${duplicates.joinToString(", ")}", listOf("$name!1:1"))
            if (missing.isNotEmpty()) issues += issue("error", "MISSING_COLUMN", "${name}表缺少列：${missing.joinToString(", ")}", listOf("$name!1:1"))
            tables[name] = table
        }
        failIfErrors(issues)
        val seen = COLUMNS.keys.associateWith { mutableSetOf<String>() }
        val layers = JSONArray(); val layerList = mutableListOf<JSONObject>()
        for (row in tables["分层"]?.rows.orEmpty()) {
            val v = row.values; val c = row.cells; val id = txt(v["层号"])
            val top = num(v["顶深_m"], c["顶深_m"] ?: "分层!row${row.row}", issues, true); val bottom = num(v["底深_m"], c["底深_m"] ?: "分层!row${row.row}", issues, true)
            validateId(id, seen.getValue("分层"), c["层号"] ?: "分层!A${row.row}", "层号", issues)
            val core = num(v["岩心长_m"], c["岩心长_m"] ?: "", issues)
            if (core != null && core < 0) issues += issue("error", "NEGATIVE_CORE_LENGTH", "岩心长不能为负数", listOf(c["岩心长_m"].orEmpty()))
            if (core != null && top != null && bottom != null && core > bottom - top + 1e-6) issues += issue("error", "CORE_LENGTH_EXCEEDS_INTERVAL", "岩心长不能大于层段沿孔长度", listOf(c["岩心长_m"].orEmpty(), c["顶深_m"].orEmpty(), c["底深_m"].orEmpty()))
            val name = txt(v["岩性名称"]); val code = txt(v["花纹代码"]); val src = JSONObject().put("sheet", "分层").put("row", row.row).put("cells", sourceCells(c, COLUMNS.getValue("分层")))
            val layer = JSONObject().put("id", id).put("top_m", jsonValue(top)).put("bottom_m", jsonValue(bottom)).put("thickness_m", if (top != null && bottom != null) bottom - top else JSONObject.NULL).put("core_m", jsonValue(core))
                .put("recovery_percent", if (core != null && top != null && bottom != null && bottom > top) core / (bottom - top) * 100 else JSONObject.NULL)
                .put("description", txt(v["岩性描述"])).put("lithology_name", name).put("material_code", code).put("pattern_id", JSONObject.NULL).put("source", src)
            layerList += layer; layers.put(layer)
            if (name.isBlank()) issues += issue("warning", "MISSING_LITHOLOGY", "岩性名称为空，保留空白待补", listOf(c["岩性名称"].orEmpty()))
        }
        if (layerList.isEmpty()) issues += issue("error", "EMPTY_LAYER_SHEET", "分层表至少需要一条有效分层记录", listOf("分层!2:2"))
        checkRanges(layerList, "分层", endpoint, issues)
        val turns = JSONArray(); val turnList = mutableListOf<JSONObject>()
        for (row in tables["回次"]?.rows.orEmpty()) {
            val v = row.values; val c = row.cells; val id = txt(v["回次号"])
            val top = num(v["顶深_m"], c["顶深_m"] ?: "", issues, true); val bottom = num(v["底深_m"], c["底深_m"] ?: "", issues, true); val core = num(v["岩心长_m"], c["岩心长_m"] ?: "", issues, true)
            validateId(id, seen.getValue("回次"), c["回次号"] ?: "", "回次号", issues)
            if (top != null && bottom != null && bottom > top && core != null && core > bottom - top + 1e-6) issues += issue("error", "CORE_LENGTH_EXCEEDS_INTERVAL", "岩心长不能大于回次段长", listOf(c["岩心长_m"].orEmpty()))
            if (core != null && core < 0) issues += issue("error", "NEGATIVE_CORE_LENGTH", "岩心长不能为负数", listOf(c["岩心长_m"].orEmpty()))
            val length = if (top != null && bottom != null) bottom - top else null
            val item = JSONObject().put("id", id).put("top_m", jsonValue(top)).put("bottom_m", jsonValue(bottom)).put("advance_m", jsonValue(length)).put("core_m", jsonValue(core)).put("recovery_percent", if (core != null && length != null && length > 0) core / length * 100 else JSONObject.NULL).put("source", JSONObject().put("sheet", "回次").put("row", row.row).put("cells", sourceCells(c, COLUMNS.getValue("回次"))))
            turnList += item; turns.put(item)
        }
        if (turnList.isNotEmpty()) checkRanges(turnList, "回次", endpoint, issues)
        val units = JSONObject().put("Au", txt(params["Au单位"])).put("Pb", txt(params["Pb单位"])).put("Zn", txt(params["Zn单位"]))
        val samples = JSONArray(); val sampleList = mutableListOf<JSONObject>()
        for (row in tables["样品"]?.rows.orEmpty()) {
            val v = row.values; val c = row.cells; val id = txt(v["样品编号"])
            val top = num(v["顶深_m"], c["顶深_m"] ?: "", issues, true); val bottom = num(v["底深_m"], c["底深_m"] ?: "", issues, true); val core = num(v["岩心长_m"], c["岩心长_m"] ?: "", issues)
            validateId(id, seen.getValue("样品"), c["样品编号"] ?: "", "样品编号", issues)
            if (top != null && bottom != null && (top < 0 || endpoint != null && bottom > endpoint)) issues += issue("error", "SAMPLE_OUT_OF_RANGE", "样品区间超出孔深范围", listOf(c["顶深_m"].orEmpty(), c["底深_m"].orEmpty()))
            if (top != null && bottom != null && bottom <= top) issues += issue("error", "INVALID_INTERVAL", "样品底深必须大于顶深", listOf(c["顶深_m"].orEmpty(), c["底深_m"].orEmpty()))
            if (core != null && top != null && bottom != null && core > bottom - top + 1e-6) issues += issue("error", "CORE_LENGTH_EXCEEDS_INTERVAL", "岩心长不能大于样品段长", listOf(c["岩心长_m"].orEmpty()))
            if (core != null && core < 0) issues += issue("error", "NEGATIVE_CORE_LENGTH", "岩心长不能为负数", listOf(c["岩心长_m"].orEmpty()))
            val assays = JSONObject(); for (element in listOf("Au", "Pb", "Zn")) {
                val raw = v[element]
                if (!blank(raw) && raw is String && Regex("[<]|检出|低于").containsMatchIn(raw)) issues += issue("error", "NON_NUMERIC_ASSAY_TEXT", "${element}分析结果为原始文本“$raw”，保留原值且不转为0；当前图形要求数值", listOf(c[element].orEmpty()))
                val assay = num(raw, c[element] ?: "", issues)
                if (assay != null && assay < 0) issues += issue("error", "NEGATIVE_ASSAY", "${element}分析值不能为负数", listOf(c[element].orEmpty()))
                if (assay != null && txt(params["${element}单位"]).isBlank()) issues += issue("error", "MISSING_ASSAY_UNIT", "填写了${element}分析值但未提供单位", listOf(c[element].orEmpty(), paramCells["${element}单位"] ?: "项目!B:B"))
                assays.put(element, jsonValue(assay))
            }
            val length = if (top != null && bottom != null) bottom - top else null
            val sample = JSONObject().put("id", id).put("top_m", jsonValue(top)).put("bottom_m", jsonValue(bottom)).put("length_m", jsonValue(length)).put("core_m", jsonValue(core))
                .put("recovery_percent", if (core != null && length != null && length > 0) core / length * 100 else JSONObject.NULL).put("assays", assays).put("source", JSONObject().put("sheet", "样品").put("row", row.row).put("cells", sourceCells(c, COLUMNS.getValue("样品"))))
            sampleList += sample; samples.put(sample)
        }
        val structures = JSONArray()
        for (row in tables["孔径"]?.rows.orEmpty()) {
            val depth = num(row.values["孔深_m"], row.cells["孔深_m"] ?: "", issues, true); val diameter = num(row.values["孔径_mm"], row.cells["孔径_mm"] ?: "", issues, true)
            if (diameter != null && diameter <= 0) issues += issue("error", "INVALID_DIAMETER", "孔径必须大于0", listOf(row.cells["孔径_mm"].orEmpty()))
            if (depth != null && endpoint != null && (depth < 0 || depth > endpoint)) issues += issue("error", "STRUCTURE_OUT_OF_RANGE", "孔径记录深度超出孔深范围", listOf(row.cells["孔深_m"].orEmpty()))
            structures.put(JSONObject().put("depth_m", jsonValue(depth)).put("diameter_mm", jsonValue(diameter)).put("source", JSONObject().put("sheet", "孔径").put("row", row.row).put("cells", sourceCells(row.cells, COLUMNS.getValue("孔径")))))
        }
        val orderedSamples = sampleList.filter { !it.isNull("top_m") && !it.isNull("bottom_m") }.sortedBy { it.getDouble("top_m") }
        var farthestSample: JSONObject? = null
        for (sample in orderedSamples) {
            val previous = farthestSample
            if (previous != null && sample.getDouble("top_m") < previous.getDouble("bottom_m") - 1e-9) {
                issues += issue("warning", "OVERLAPPING_SAMPLES", "样品区间存在重叠，将分轨显示：${previous.optString("id")} / ${sample.optString("id")}", listOf(previous.getJSONObject("source").getJSONObject("cells").optString("顶深_m"), sample.getJSONObject("source").getJSONObject("cells").optString("顶深_m")))
                break
            }
            if (previous == null || sample.getDouble("bottom_m") > previous.getDouble("bottom_m")) farthestSample = sample
        }
        for (layer in layerList) {
            val code = layer.optString("material_code"); val name = layer.optString("lithology_name"); val expected = exactMaterials[name]
            if (code.isNotBlank() && code !in knownPatterns) issues += issue("error", "UNKNOWN_PATTERN_CODE", "未配置花纹代码：$code", listOf(layer.getJSONObject("source").getJSONObject("cells").optString("花纹代码")))
            else if (code.isNotBlank() && expected != null && code != expected) issues += issue("error", "PATTERN_MATERIAL_CONFLICT", "花纹代码与精确岩性名称映射冲突", listOf(layer.getJSONObject("source").getJSONObject("cells").optString("花纹代码"), layer.getJSONObject("source").getJSONObject("cells").optString("岩性名称")))
            else if (code.isNotBlank()) layer.put("pattern_id", knownPatterns[code])
            else if (expected != null) { layer.put("material_code", expected); layer.put("pattern_id", knownPatterns[expected]) }
            else issues += issue("warning", "PENDING_PATTERN", "岩性“${name.ifBlank { "未提供" }}”无精确花纹映射，保留留白待配置", listOf(layer.getJSONObject("source").getJSONObject("cells").optString("岩性名称")))
        }
        failIfErrors(issues)
        val sortedSamples = JSONArray(); sampleList.sortedWith(compareBy<JSONObject> { if (it.isNull("top_m")) Double.POSITIVE_INFINITY else it.getDouble("top_m") }.thenBy { if (it.isNull("bottom_m")) Double.POSITIVE_INFINITY else it.getDouble("bottom_m") }.thenBy { it.optString("id") }).forEach(sortedSamples::put)
        val pending = layerList.count { it.optString("material_code").isBlank() }
        val normalized = JSONObject().put("drawing_type", "drill").put("schema_version", "drill-1.0").put("source", JSONObject().put("filename", workbook.filename).put("sha256", workbook.sha256).put("adapter", "drill-1.0"))
            .put("project", JSONObject().put("name", txt(params["项目名称"])).put("hole_id", holeId).put("analysis_units", units).put("source_cells", JSONObject().also { o -> paramCells.forEach { (key, value) -> o.put(key, value) } }))
            .put("meta", JSONObject().put("hole_id", holeId).put("endpoint_m", endpoint).put("depth_basis", basis)).put("turns", turns).put("layers", layers).put("samples", sortedSamples).put("structures", structures).put("issues", issuesJson(issues))
            .put("summary", JSONObject().put("turns", turns.length()).put("layers", layers.length()).put("samples", samples.length()).put("endpoint_m", endpoint).put("pending_patterns", pending))
        return NativeIndustryImportResult(normalized, issuesJson(issues))
    }

    private fun sourceCells(cells: Map<String, String>, fields: List<String>) = JSONObject().also { out -> fields.forEach { field -> cells[field]?.let { out.put(field, it) } } }
    private fun validateId(id: String, seen: MutableSet<String>, at: String, label: String, issues: MutableList<NativeIndustryIssue>) {
        if (id.isBlank()) issues += issue("error", "MISSING_ID", "${label}不能为空", listOf(at)) else if (!seen.add(id)) issues += issue("error", "DUPLICATE_ID", "${label}重复：$id", listOf(at))
    }
    private fun checkRanges(items: List<JSONObject>, label: String, endpoint: Double?, issues: MutableList<NativeIndustryIssue>) {
        val rows = items.filter { !it.isNull("top_m") && !it.isNull("bottom_m") }; if (rows.isEmpty()) return
        var cursor = 0.0
        for (item in rows) {
            val top = item.getDouble("top_m"); val bottom = item.getDouble("bottom_m"); val c = item.getJSONObject("source").getJSONObject("cells")
            if (bottom <= top) issues += issue("error", "INVALID_INTERVAL", "${label}底深必须大于顶深", listOf(c.optString("顶深_m"), c.optString("底深_m")))
            if (top < cursor - 1e-6) issues += issue("error", "INTERVAL_OVERLAP", "${label}区间重叠或倒序", listOf(c.optString("顶深_m"))) else if (top > cursor + 1e-6) issues += issue("error", "INTERVAL_GAP", "${label}区间存在缺段：$cursor–$top m", listOf(c.optString("顶深_m")))
            cursor = max(cursor, bottom)
            if (top < -1e-6 || endpoint != null && bottom > endpoint + 1e-6) issues += issue("error", "INTERVAL_OUT_OF_RANGE", "${label}区间超出0至终孔深度", listOf(c.optString("顶深_m"), c.optString("底深_m")))
        }
        if (rows.first().getDouble("top_m") > 1e-6 || endpoint != null && kotlin.math.abs(cursor - endpoint) > 1e-6) issues += issue("error", "INCOMPLETE_COVERAGE", "${label}必须连续覆盖0至终孔深度", listOf(rows.first().getJSONObject("source").getJSONObject("cells").optString("顶深_m"), rows.last().getJSONObject("source").getJSONObject("cells").optString("底深_m")))
    }
}
