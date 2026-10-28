package com.shantu.nativeapp.industry

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.abs

/** Lossless first-stage adapter for the versioned integrated-drill workbook. */
object NativeIntegratedDrillImporter {
    private val requiredSheets = listOf("钻孔基本信息", "回次表", "分层-原始记录", "分层-地质综合", "采样", "自定义测试项目", "样品测试结果", "孔深校正及弯曲度", "图签", "图面示意", "填写说明")
    private val headerRows = mapOf("回次表" to 5, "分层-原始记录" to 5, "分层-地质综合" to 5, "采样" to 5, "自定义测试项目" to 5, "样品测试结果" to 5, "孔深校正及弯曲度" to 7)
    private val versionHeaders = mapOf(
        "回次表" to Pair(listOf("序号","回次号","下界记录孔深_m","回次进尺_m","采取块数/原记","岩心长度_m","残留_m","处理后岩心长_m（手填）","回次采取率_pct（原填）","回次采取率_pct（计算）","孔深校正量_m","下界校正孔深_m","≤10cm岩心长度_m","≥10cm岩心长度_m","RQD_pct（原填）","备注","长度核对提示"), listOf("序号","回次号","下界记录孔深_m","回次进尺_m","采取块数/原记","岩心长度_m","残留_m","处理后岩心长_m（手填）","回次采取率_pct（计算）","孔深校正量_m","下界校正孔深_m","≤10cm岩心长度_m","≥10cm岩心长度_m","RQD_pct（原填）","备注","长度核对提示")),
        "分层-原始记录" to Pair(listOf("序号","层号","起回次号","起位置_m","止回次号","止位置_m","换层累计孔深_m","分层进尺_m","分层岩心长_m","分层采取率_pct（原填）","分层采取率_pct（计算）","岩性名称","平均轴夹角_deg","真厚度_m（原填）","调整/说明","止回次岩心长_m","原表O列未命名值"), listOf("序号","层号","起回次号","起位置_m","止回次号","止位置_m","换层累计孔深_m","分层进尺_m","分层岩心长_m","分层采取率_pct（计算）","岩性名称","平均轴夹角_deg","真厚度_m（原填）","调整/说明","止回次岩心长_m","原表O列未命名值")),
        "分层-地质综合" to Pair(listOf("序号","起回次号","起位置_m","止回次号","止位置_m","换层孔深_m","分层进尺_m","分层岩心长_m","分层采取率_pct（原填）","平均轴夹角_deg","真厚度_m（原填）"), listOf("序号","起回次号","起位置_m","止回次号","止位置_m","换层孔深_m","分层进尺_m","分层岩心长_m","分层采取率_pct（计算）","平均轴夹角_deg","真厚度_m（原填）")),
        "采样" to Pair(listOf("序号","样品编号","起回次号","起位置_m","止回次号","止位置_m","孔深自_m","孔深至_m","进尺_m","岩心长度_m","采取率_pct（原填）","采取率_pct（计算）","重量数值（原单位未明）","重量单位（手填）","原表L列值（含义待确认）","原表M列未命名值/附加备注","原表N列未命名值/附加备注"), listOf("序号","样品编号","起回次号","起位置_m","止回次号","止位置_m","孔深自_m","孔深至_m","进尺_m","岩心长度_m","采取率_pct（计算）","重量数值（原单位未明）","重量单位（手填）","原表L列值（含义待确认）","原表M列未命名值/附加备注","原表N列未命名值/附加备注")),
        "样品测试结果" to Pair(listOf("样品编号","项目代码","结果原文","数值结果（可空）","结果标记","单位","检出限","分析方法","检测日期","报告编号","备注"), listOf("样品编号","项目代码","结果原文","数值结果（可空）","单位","检出限","分析方法","检测日期","报告编号","备注")),
    )

    fun importWorkbook(book: NativeXlsxWorkbook): NativeIndustryImportResult {
        val missing = requiredSheets.filterNot(book.sheets::containsKey)
        if (missing.isNotEmpty()) throw NativeIndustryImportException("整合钻孔工作簿缺少工作表：${missing.joinToString("、")}")
        val issues = book.warnings.toMutableList()
        val version = detectVersion(book)
        val tables = JSONObject()
        for ((name, sheet) in book.sheets) {
            if (name !in requiredSheets) continue
            val headerRow = headerRows[name]
            val headers = if (headerRow == null) emptyMap() else headersAt(sheet, headerRow)
            val records = JSONArray()
            for (row in sheet.rows) {
                if (headerRow != null && row.row <= headerRow) continue
                if (row.cells.isEmpty() && row.formulas.isEmpty()) continue
                val values = JSONObject(); val cells = JSONObject(); val formulas = JSONObject()
                for ((address, raw) in row.cells) {
                    val label = headers[address.substringWhileDigitsStart()].orEmpty().ifBlank { address }
                    values.put(label, json(raw)); cells.put(label, "$name!$address")
                    row.formulas[address]?.let { formulas.put(label, JSONObject().put("cell", "$name!$address").put("formula", it)) }
                }
                // Formula-only cells must also survive even when they have no cached value.
                for ((address, formula) in row.formulas) if (!row.cells.containsKey(address)) {
                    val label = headers[address.substringWhileDigitsStart()].orEmpty().ifBlank { address }
                    values.put(label, JSONObject.NULL); cells.put(label, "$name!$address")
                    formulas.put(label, JSONObject().put("cell", "$name!$address").put("formula", formula))
                }
                records.put(JSONObject().put("row", row.row).put("values", values).put("cells", cells).put("formulas", formulas))
            }
            tables.put(name, JSONObject().put("header_row", headerRow ?: JSONObject.NULL).put("headers", JSONObject(headers)).put("rows", records))
        }
        val basic = book.sheets.getValue("钻孔基本信息")
        val labels = linkedMapOf("矿区" to "B4", "线号" to "D4", "钻孔编号" to "F4", "项目名称" to "H4", "开孔日期" to "B5", "终孔日期" to "D5", "终孔深度_m" to "F5", "孔深基准" to "H5", "设计方位角_deg" to "B6", "倾角_deg" to "D6", "X坐标_m" to "F6", "Y坐标_m" to "H6", "孔口标高_m" to "B7", "坐标系" to "D7", "角度定义" to "F7", "比例尺分母" to "H7", "备注" to "B8")
        val fields = JSONObject(); val sourceCells = JSONObject()
        for ((label, address) in labels) { fields.put(label, json(cell(basic, address))); sourceCells.put(label, "钻孔基本信息!$address"); if (basic.rows.any { address in it.formulas }) issues += NativeIndustryIssue("error", "FORMULA_VALUE", "$label 必须填写原始值；原生适配器不执行公式", listOf("钻孔基本信息!$address")) }
        val endpoint = (cell(basic, "F5") as? Number)?.toDouble()
        val holeId = cell(basic, "F4")?.toString().orEmpty().trim()
        if (holeId.isBlank()) issues += NativeIndustryIssue("error", "MISSING_HOLE_ID", "钻孔编号必填", listOf("钻孔基本信息!F4"))
        if (endpoint == null || !endpoint.isFinite() || endpoint <= 0) issues += NativeIndustryIssue("error", "INVALID_ENDPOINT", "终孔深度必须为大于0的数值", listOf("钻孔基本信息!F5"))
        if (cell(basic, "H5")?.toString() !in setOf("原始沿孔深", "校正沿孔深")) issues += NativeIndustryIssue("error", "INVALID_DEPTH_BASIS", "孔深基准需明确填写原始沿孔深或校正沿孔深", listOf("钻孔基本信息!H5"))
        val layerRows = records(book.sheets.getValue("分层-原始记录"), 5)
        val turnRows = records(book.sheets.getValue("回次表"), 5)
        val sampleRows = records(book.sheets.getValue("采样"), 5)
        val resultRows = records(book.sheets.getValue("样品测试结果"), 5)
        val analysisRows = records(book.sheets.getValue("自定义测试项目"), 5)
        val layers = JSONArray(); var layerTop = 0.0; val layerIds = mutableSetOf<String>()
        for (row in layerRows.filter { meaningful(it, setOf("层号", "换层累计孔深_m", "岩性名称", "分层岩心长_m")) }) {
            val v = values(row)
            listOf("层号", "换层累计孔深_m", "分层进尺_m", "分层岩心长_m", "分层采取率_pct（原填）", "岩性名称", "调整/说明").forEach { rejectFormula(row, it, issues) }
            val id = text(v["层号"]); if (id.isBlank()) issues += NativeIndustryIssue("error", "MISSING_ID", "层号不能为空", listOf(cellRef(row, "层号")))
            if (id.isNotBlank() && !layerIds.add(id)) issues += NativeIndustryIssue("error", "DUPLICATE_ID", "层号重复：$id", listOf(cellRef(row, "层号")))
            val bottom = number(v["换层累计孔深_m"]); val core = number(v["分层岩心长_m"])
            val length = bottom?.minus(layerTop)
            if (bottom == null || length == null || length <= 0) { issues += NativeIndustryIssue("error", "INVALID_LAYER_BOUNDARY", "分层累计孔深必须递增且为数值", listOf(cellRef(row, "换层累计孔深_m"))); continue }
            if (endpoint != null && bottom > endpoint + 1e-6) issues += NativeIndustryIssue("error", "INTERVAL_OUT_OF_RANGE", "分层底深超出终孔深度", listOf(cellRef(row, "换层累计孔深_m")))
            val manualAdvance = number(v["分层进尺_m"])
            if (version == "v3" && core != null && (manualAdvance == null || manualAdvance <= 0)) issues += NativeIndustryIssue("error", "MISSING_MANUAL_ADVANCE", "v3有岩心长度时必须填写大于0的手填分层进尺；不会用推导层厚代替", listOf(cellRef(row, "分层进尺_m")))
            if (core != null && core < 0) issues += NativeIndustryIssue("error", "NEGATIVE_CORE_LENGTH", "分层岩心长不能为负数", listOf(cellRef(row, "分层岩心长_m")))
            val recoveryDenominator = if (version == "v3") manualAdvance else length
            val raw = JSONObject(v.mapValues { json(it.value) })
            layers.put(JSONObject().put("id", text(v["层号"])).put("top_m", layerTop).put("bottom_m", bottom).put("thickness_m", length).put("core_m", json(core))
                .put("recovery_percent", if (core != null && recoveryDenominator != null && recoveryDenominator > 0) core / recoveryDenominator * 100 else JSONObject.NULL)
                .put("recovery_original_percent", json(v["分层采取率_pct（原填）"])).put("recovery_raw_percent", json(v["分层采取率_pct（原填）" ]))
                .put("lithology_name", text(v["岩性名称"])).put("description", text(v["调整/说明"])).put("material_code", "").put("pattern_id", JSONObject.NULL)
                .put("mean_axis_angle_deg",json(v["平均轴夹角_deg"])).put("true_thickness_m_raw",json(v["真厚度_m（原填）"]))
                .put("raw", raw).put("source", sourceFor(row, "分层-原始记录", mapOf("顶深_m" to if (layers.length() == 0) "derived:first-row-zero" else "derived:previous-bottom", "底深_m" to cellRef(row, "换层累计孔深_m")))))
            layerTop = bottom
        }
        if (layers.length() > 0 && endpoint != null && abs(layerTop - endpoint) > 1e-6) issues += NativeIndustryIssue("error", "INCOMPLETE_COVERAGE", "分层必须连续覆盖0至终孔深度", listOf("分层-原始记录!G${layerRows.lastOrNull()?.row ?: 6}"))
        val turns = JSONArray(); var turnTop = 0.0; val turnIds = mutableSetOf<String>()
        for (row in turnRows.filter { meaningful(it, setOf("回次号", "下界记录孔深_m", "回次进尺_m", "处理后岩心长_m（手填）")) }) {
            val v = values(row)
            listOf("回次号", "下界记录孔深_m", "回次进尺_m", "处理后岩心长_m（手填）", "回次采取率_pct（原填）").forEach { rejectFormula(row, it, issues) }
            val id = text(v["回次号"]); if (id.isBlank()) issues += NativeIndustryIssue("error", "MISSING_ID", "回次号不能为空", listOf(cellRef(row, "回次号")))
            if (id.isNotBlank() && !turnIds.add(id)) issues += NativeIndustryIssue("error", "DUPLICATE_ID", "回次号重复：$id", listOf(cellRef(row, "回次号")))
            val bottom = number(v["下界记录孔深_m"]); if (bottom == null || bottom <= turnTop) { issues += NativeIndustryIssue("error", "INVALID_TURN_BOUNDARY", "回次下界记录孔深必须递增且为数值", listOf(cellRef(row, "下界记录孔深_m"))); continue }
            if (endpoint != null && bottom > endpoint + 1e-6) issues += NativeIndustryIssue("error", "INTERVAL_OUT_OF_RANGE", "回次底深超出终孔深度", listOf(cellRef(row, "下界记录孔深_m")))
            val advance = bottom - turnTop; val recordedAdvance = number(v["回次进尺_m"]); val core = number(v["处理后岩心长_m（手填）"])
            if (version == "v3" && core != null && (recordedAdvance == null || recordedAdvance <= 0)) issues += NativeIndustryIssue("error", "MISSING_MANUAL_ADVANCE", "v3有岩心长度时必须填写大于0的手填回次进尺；不会用推导回次长度代替", listOf(cellRef(row, "回次进尺_m")))
            if (core != null && core < 0) issues += NativeIndustryIssue("error", "NEGATIVE_CORE_LENGTH", "处理后岩心长不能为负数", listOf(cellRef(row, "处理后岩心长_m（手填）")))
            val recoveryDenominator = if (version == "v3") recordedAdvance else advance
            turns.put(JSONObject().put("id", text(v["回次号"])).put("top_m", turnTop).put("bottom_m", bottom).put("advance_m", advance).put("core_m", json(core))
                .put("recovery_percent", if (core != null && recoveryDenominator != null && recoveryDenominator > 0) core / recoveryDenominator * 100 else JSONObject.NULL)
                .put("recovery_original_percent", json(v["回次采取率_pct（原填）"])).put("recovery_raw_percent", json(v["回次采取率_pct（原填）"]))
                .put("raw", JSONObject(v.mapValues { json(it.value) })).put("source_metrics", JSONObject().put("raw_core_length_m", json(v["岩心长度_m"])).put("depth_correction_m", json(v["孔深校正量_m"])).put("corrected_bottom_depth_m", json(v["下界校正孔深_m"])).put("rqd_raw", json(v["RQD_pct（原填）"])))
                .put("source", sourceFor(row, "回次表", mapOf("顶深_m" to if (turns.length() == 0) "derived:first-row-zero" else "derived:previous-bottom", "底深_m" to cellRef(row, "下界记录孔深_m")))))
            turnTop = bottom
        }
        if (turns.length() > 0 && endpoint != null && abs(turnTop - endpoint) > 1e-6) issues += NativeIndustryIssue("error", "INCOMPLETE_COVERAGE", "回次必须连续覆盖0至终孔深度", listOf("回次表!C${turnRows.lastOrNull()?.row ?: 6}"))
        val analysisCodes = linkedSetOf<String>()
        val analysis = analysisRows.filter { meaningful(it, setOf("项目代码", "项目名称/元素")) }.map { r ->
            val v = values(r)
            listOf("项目代码", "项目名称/元素", "单位", "显示顺序", "检出限", "分析方法", "图中显示", "备注").forEach { rejectFormula(r, it, issues) }
            val code = text(v["项目代码"]); val name = text(v["项目名称/元素"]); val show = text(v["图中显示"])
            if (code.isBlank()) issues += NativeIndustryIssue("error", "MISSING_ANALYSIS_CODE", "分析项目代码不能为空", listOf(cellRef(r, "项目代码")))
            if (code.isNotBlank() && !analysisCodes.add(code)) issues += NativeIndustryIssue("error", "DUPLICATE_ANALYSIS_CODE", "分析项目代码重复：$code", listOf(cellRef(r, "项目代码")))
            if (name.isBlank()) issues += NativeIndustryIssue("error", "MISSING_ANALYSIS_NAME", "分析项目名称不能为空", listOf(cellRef(r, "项目名称/元素")))
            if (show.isNotBlank() && show !in setOf("是", "否")) issues += NativeIndustryIssue("error", "INVALID_ANALYSIS_SHOW", "图中显示只能填写是或否", listOf(cellRef(r, "图中显示")))
            JSONObject().put("code", code).put("name", name).put("unit", text(v["单位"])).put("order", number(v["显示顺序"]) ?: 0).put("detection_limit", json(v["检出限"])).put("method", text(v["分析方法"])).put("show", show != "否").put("notes", text(v["备注"])).put("source", sourceFor(r, "自定义测试项目"))
        }
        val analysisByCode = analysis.associateBy { it.getString("code") }
        val seenAssays = mutableSetOf<String>()
        val samples = JSONArray(); val samplesById = linkedMapOf<String, JSONObject>(); val sampleRowsById = linkedMapOf<String, NativeIntegratedRow>(); val sampleRanges = mutableListOf<Triple<Double, Double, NativeIntegratedRow>>()
        for (row in sampleRows.filter { meaningful(it, setOf("样品编号", "孔深自_m", "孔深至_m")) }) {
            val v = values(row); val top = number(v["孔深自_m"]); val bottom = number(v["孔深至_m"]); val id = text(v["样品编号"])
            listOf("样品编号", "孔深自_m", "孔深至_m", "进尺_m", "岩心长度_m", "采取率_pct（原填）").forEach { rejectFormula(row, it, issues) }
            if (id.isBlank()) issues += NativeIndustryIssue("error", "MISSING_ID", "样品编号不能为空", listOf(cellRef(row, "样品编号")))
            if (id.isNotBlank() && sampleRowsById.containsKey(id)) issues += NativeIndustryIssue("error", "DUPLICATE_SAMPLE", "样品编号重复：$id", listOf(sampleRowsById.getValue(id).cells["样品编号"].orEmpty(), cellRef(row, "样品编号")))
            if (id.isNotBlank()) sampleRowsById[id] = row
            if (top == null || bottom == null || bottom <= top) { issues += NativeIndustryIssue("error", "INVALID_SAMPLE_INTERVAL", "样品孔深区间无效", listOf(cellRef(row, "孔深自_m"), cellRef(row, "孔深至_m"))); continue }
            if (top < 0 || endpoint != null && bottom > endpoint + 1e-6) issues += NativeIndustryIssue("error", "INVALID_SAMPLE_INTERVAL", "样品孔深区间超出0至终孔深度", listOf(cellRef(row, "孔深自_m"), cellRef(row, "孔深至_m")))
            sampleRanges.forEach { (oldTop, oldBottom, oldRow) -> if (top < oldBottom - 1e-6 && bottom > oldTop + 1e-6) issues += NativeIndustryIssue("error", "OVERLAPPING_SAMPLES", "样品区间与 ${cellRef(oldRow, "样品编号")} 重叠", listOf(cellRef(oldRow, "孔深自_m"), cellRef(oldRow, "孔深至_m"), cellRef(row, "孔深自_m"), cellRef(row, "孔深至_m"))) }
            sampleRanges += Triple(top, bottom, row)
            val core = number(v["岩心长度_m"]); val recordedAdvance = number(v["进尺_m"])
            if (version == "v3" && core != null && (recordedAdvance == null || recordedAdvance <= 0)) issues += NativeIndustryIssue("error", "MISSING_MANUAL_ADVANCE", "v3有岩心长度时必须填写大于0的手填样品进尺；不会用深度区间代替", listOf(cellRef(row, "进尺_m")))
            if (core != null && core < 0) issues += NativeIndustryIssue("error", "NEGATIVE_CORE_LENGTH", "样品岩心长度不能为负数", listOf(cellRef(row, "岩心长度_m")))
            val sampleDenominator = if (version == "v3") recordedAdvance else bottom - top
            val sample = JSONObject().put("id", id).put("top_m", top).put("bottom_m", bottom).put("length_m", bottom - top).put("core_m", json(core))
                .put("recovery_percent", if (core != null && sampleDenominator != null && sampleDenominator > 0) core / sampleDenominator * 100 else JSONObject.NULL)
                .put("recovery_original_percent", json(v["采取率_pct（原填）"])).put("recovery_raw_percent", json(v["采取率_pct（原填）"]))
                .put("assays", JSONObject()).put("assay_raw", JSONObject()).put("assay_records", JSONArray()).put("sample_details", JSONObject(v.mapValues { json(it.value) })).put("raw", JSONObject(v.mapValues { json(it.value) })).put("source", sourceFor(row, "采样"))
            for (item in analysis) { sample.getJSONObject("assays").put(item.getString("code"), JSONObject.NULL); sample.getJSONObject("assay_raw").put(item.getString("code"), "") }
            samples.put(sample); if (id.isNotBlank() && !samplesById.containsKey(id)) samplesById[id] = sample
        }
        for (row in resultRows.filter { meaningful(it, setOf("样品编号", "项目代码", "结果原文", "数值结果（可空）")) }) {
            val v = values(row); val id = text(v["样品编号"]); val code = text(v["项目代码"]); val sample = samplesById[id]
            listOf("样品编号", "项目代码", "结果原文", "数值结果（可空）", "结果标记", "单位", "检出限", "分析方法", "检测日期", "报告编号", "备注").forEach { rejectFormula(row, it, issues) }
            if (sample == null) { issues += NativeIndustryIssue("error", "UNKNOWN_SAMPLE", "测试结果引用了未导入样品 $id", listOf(cellRef(row, "样品编号"))); continue }
            val item = analysisByCode[code]
            if (item == null) { issues += NativeIndustryIssue("error", "UNKNOWN_ANALYSIS_CODE", "测试结果引用了未知分析项目 $code", listOf(cellRef(row, "项目代码"))); continue }
            val key = "$id\u0000$code"
            if (!seenAssays.add(key)) { issues += NativeIndustryIssue("error", "DUPLICATE_SAMPLE_ANALYSIS", "样品$id 的项目${code}重复", listOf(cellRef(row, "样品编号"), cellRef(row, "项目代码"))) ; continue }
            val declaredUnit = item.optString("unit"); val resultUnit = text(v["单位"])
            if (declaredUnit.isNotBlank() && resultUnit.isNotBlank() && declaredUnit != resultUnit) issues += NativeIndustryIssue("error", "ANALYSIS_UNIT_CONFLICT", "项目$code 的结果单位与项目表单位冲突", listOf(cellRef(row, "单位")))
            if (declaredUnit.isBlank() && resultUnit.isNotBlank()) item.put("unit", resultUnit)
            val value = number(v["数值结果（可空）"]); val raw = text(v["结果原文"])
            if (v["数值结果（可空）"] != null && value == null) issues += NativeIndustryIssue("error", "INVALID_NUMBER", "测试结果不是有效数字", listOf(cellRef(row, "数值结果（可空）")))
            sample.getJSONObject("assays").put(code, json(value)); sample.getJSONObject("assay_raw").put(code, raw)
            sample.getJSONArray("assay_records").put(JSONObject(v.mapValues { json(it.value) }).put("value", json(value)).put("source", sourceFor(row, "样品测试结果")))
        }
        val depthRows = records(book.sheets.getValue("孔深校正及弯曲度"), 7)
        val measurements = JSONArray(); for (row in depthRows.filter { meaningful(it, setOf("记录孔深_m", "校测孔深_m", "测量孔深_m", "测量天顶角_deg", "实测方位角_deg")) }) measurements.put(JSONObject(values(row).mapValues { json(it.value) }).put("source", sourceFor(row, "孔深校正及弯曲度")))
        // The native renderer has no audited integrated title block or measured-survey lane yet. Preserve the
        // mapped geology in the ordinary chart and block only the unsupported measured-survey/title features.
        if (measurements.length() > 0) issues += NativeIndustryIssue("warning", "MEASURED_SURVEY_NO_SPATIAL_TRACE", "测斜与校正记录已在图下表格及深度标记中表达；因坐标系/角度定义不足，不推算三维孔轨迹。", listOf("孔深校正及弯曲度!A8:I"))
        if (layers.length() == 0 || turns.length() == 0 || samples.length() == 0) issues += NativeIndustryIssue("error", "INTEGRATED_REQUIRED_DATA_EMPTY", "整合钻孔至少需有有效分层、回次和采样记录才能生成图件", listOf("分层-原始记录!A6:Q", "回次表!A6:Q", "采样!A6:Q"))
        val issueJson = JSONArray().also { out -> issues.forEach { out.put(JSONObject().put("severity", it.severity).put("code", it.code).put("message", it.message).put("cells", JSONArray(it.cells))) } }
        val errors = issues.filter { it.severity == "error" }
        if (errors.isNotEmpty()) throw NativeIndustryImportException(errors.take(6).joinToString("；") { "${it.cells.joinToString(",")} ${it.message}" }, issueJson)
        val normalized = JSONObject().put("drawing_type", "drill").put("schema_version", "drill-integrated-native-1.0").put("template_version", version)
            .put("source", JSONObject().put("filename", book.filename).put("sha256", book.sha256).put("adapter", "drill-integrated-native-1.0").put("template_version", version))
            .put("project", JSONObject().put("name", cell(basic, "H4")?.toString().orEmpty()).put("hole_id", holeId).put("analysis_units", JSONObject()).put("source_cells", sourceCells))
            .put("meta", JSONObject().put("hole_id", holeId).put("endpoint_m", endpoint ?: JSONObject.NULL).put("depth_basis", cell(basic, "H5")?.toString().orEmpty()))
            .put("basic_info", JSONObject().put("fields", fields).put("source_cells", sourceCells)).put("source_tables", tables)
            .put("analysis_items", JSONArray(analysis)).put("depth_measurements", JSONObject().put("records", measurements))
            .put("turns", turns).put("layers", layers).put("samples", samples).put("structures", JSONArray()).put("issues", issueJson)
            .put("summary", JSONObject().put("turns", turns.length()).put("layers", layers.length()).put("samples", samples.length()).put("endpoint_m", endpoint ?: JSONObject.NULL).put("pending_patterns", layers.length()).put("source_table_count", tables.length()))
        return NativeIndustryImportResult(normalized, issueJson)
    }

    private fun detectVersion(book: NativeXlsxWorkbook): String {
        val v2 = versionHeaders.all { (name, headers) -> headerList(book.sheets.getValue(name), headerRows.getValue(name)) == headers.first }
        val v3 = versionHeaders.all { (name, headers) -> headerList(book.sheets.getValue(name), headerRows.getValue(name)) == headers.second }
        if (!v2 && !v3) throw NativeIndustryImportException("整合钻孔表头无法唯一匹配 v2 或 v3")
        return if (v3) "v3" else "v2"
    }
    private fun headerList(sheet: NativeXlsxSheet, row: Int): List<String> = headersAt(sheet, row).entries.sortedBy { columnIndex(it.key) }.map { it.value }
    private fun columnIndex(column: String): Int = column.fold(0) { n, c -> n * 26 + c.code - 64 }
    private fun headersAt(sheet: NativeXlsxSheet, row: Int): Map<String, String> {
        val cells = sheet.rows.firstOrNull { it.row == row }?.cells.orEmpty()
        return cells.mapNotNull { (address, value) -> address.substringWhileDigitsStart().takeIf { value != null }?.let { it to value.toString().trim() } }.toMap()
    }
    private fun records(sheet: NativeXlsxSheet, headerRow: Int): List<NativeIntegratedRow> {
        val headers = headersAt(sheet, headerRow)
        return sheet.rows.filter { it.row > headerRow && (it.cells.isNotEmpty() || it.formulas.isNotEmpty()) }.map { row ->
            val vals = linkedMapOf<String, Any?>(); val cells = linkedMapOf<String, String>(); val formulas = linkedMapOf<String, String>()
            for ((address, value) in row.cells) { val label = headers[address.substringWhileDigitsStart()].orEmpty().ifBlank { address }; vals[label] = value; cells[label] = "${sheet.name}!$address"; row.formulas[address]?.let { formulas[label] = it } }
            for ((address, formula) in row.formulas) if (address !in row.cells) { val label = headers[address.substringWhileDigitsStart()].orEmpty().ifBlank { address }; vals[label] = null; cells[label] = "${sheet.name}!$address"; formulas[label] = formula }
            NativeIntegratedRow(row.row, vals, cells, formulas)
        }
    }
    private fun values(row: NativeIntegratedRow) = row.values
    private fun meaningful(row: NativeIntegratedRow, keys: Set<String>) = keys.any { row.formulas.containsKey(it) || row.values[it] != null && row.values[it].toString().isNotBlank() }
    private fun rejectFormula(row: NativeIntegratedRow, field: String, issues: MutableList<NativeIndustryIssue>) {
        row.formulas[field]?.let { formula -> issues += NativeIndustryIssue("error", "FORMULA_VALUE", "${cellRef(row, field)}（$field）为公式；请填写原始值，适配器不会执行公式：$formula", listOf(cellRef(row, field))) }
    }
    private fun sourceFor(row: NativeIntegratedRow, sheet: String, derived: Map<String, String> = emptyMap()): JSONObject {
        val cells = JSONObject(row.cells).also { out -> derived.forEach { (k, v) -> out.put(k, v) } }
        val raw = JSONObject(row.values.mapValues { json(it.value) })
        val formulas = JSONObject().also { out -> row.formulas.forEach { (k, v) -> out.put(k, JSONObject().put("cell", row.cells[k]).put("formula", v)) } }
        return JSONObject().put("sheet", sheet).put("row", row.row).put("cells", cells).put("raw", raw).put("formulas", formulas)
    }
    private fun cellRef(row: NativeIntegratedRow, field: String) = row.cells[field].orEmpty()
    private fun number(value: Any?): Double? = when (value) { is Number -> value.toDouble().takeIf { it.isFinite() }; is String -> value.trim().toDoubleOrNull()?.takeIf { it.isFinite() }; else -> null }
    private fun text(value: Any?) = value?.toString()?.trim().orEmpty()
    private fun cell(sheet: NativeXlsxSheet, address: String): Any? = sheet.rows.firstOrNull { it.row == address.substringWhileDigitsEnd() }?.cells?.get(address)
    private fun json(value: Any?): Any = when (value) { null -> JSONObject.NULL; is Boolean, is Number, is String -> value; else -> value.toString() }
    private fun String.substringWhileDigitsStart() = takeWhile { it.isLetter() }
    private fun String.substringWhileDigitsEnd() = dropWhile { it.isLetter() }.toIntOrNull() ?: -1
}

private data class NativeIntegratedRow(val row: Int, val values: Map<String, Any?>, val cells: Map<String, String>, val formulas: Map<String, String>)
