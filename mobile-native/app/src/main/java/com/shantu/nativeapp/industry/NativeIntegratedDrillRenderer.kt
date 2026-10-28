package com.shantu.nativeapp.industry

import android.graphics.Color
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min

/** Android port of modules/industry/referenceDrillRender.ts fixed reference geometry. */
object NativeIntegratedDrillRenderer {
    private const val LEFT = 28.0
    private const val HEADER_Y = 272.0
    private const val HEADER_H = 158.0
    private const val BODY_Y = HEADER_Y + HEADER_H
    private const val SCALE_100 = 80.0 / 3.0
    private val ink = Color.rgb(17, 17, 17)
    private val white = Color.WHITE
    private val patternByMaterial = mapOf(
        "泥岩夹泥质粉砂岩" to "short-dash-double-dot",
        "泥岩、泥质粉砂岩。" to "dot-rows-thin-lines",
        "泥岩、泥质粉砂岩" to "dot-rows-thin-lines",
        "砂岩夹粉砂岩" to "point-dash-ellipse-bands",
    )
    private val patternByCode = mapOf(
        "D001" to "short-dash-double-dot",
        "D002" to "dot-rows-thin-lines",
        "D003" to "point-dash-ellipse-bands",
    )
    private val supportedPatterns = patternByCode.values.toSet()

    private data class Col(val key: String, val width: Double)
    private data class Layout(val cols: List<Col>, val x: Map<String, Double>, val width: Double)
    private data class Footer(val height: Double, val ops: JSONArray, val audit: JSONObject)

    fun render(data: JSONObject): NativeIndustryRenderResult {
        val issues = data.optJSONArray("issues") ?: JSONArray()
        val errors = (0 until issues.length()).mapNotNull { issues.optJSONObject(it) }.filter { it.optString("severity") == "error" }
        if (errors.isNotEmpty()) throw NativeIndustryImportException(errors.take(6).joinToString("；") { it.optString("message") }, issues)
        val endpoint = data.optJSONObject("meta")?.optDouble("endpoint_m", Double.NaN) ?: Double.NaN
        require(endpoint.isFinite() && endpoint > 0 && endpoint <= 100_000) { "整合钻孔终孔深度缺失或超出安全范围" }
        val fields = basicFields(data)
        val titleFields = titleFields(data)
        val basicScale=parseScaleDenominator(fields.opt("比例尺分母"))
        val titleScale=parseScaleDenominator(titleFields.opt("比例尺分母"))
        val denominator = basicScale ?: titleScale ?: 100.0
        val scale = SCALE_100 * 100.0 / denominator
        val elements = jsonArray(data, "analysis_items").filter { it.optBoolean("show", true) }.sortedWith(compareBy<JSONObject> { it.optDouble("order", 0.0) }.thenBy { it.optString("code") })
        val layout = columns(elements)
        val full = build(data, fields, titleFields, layout, endpoint, endpoint, scale, denominator, elements, false)
        val detail = build(data, fields, titleFields, layout, endpoint, min(endpoint, 45.0), scale, denominator, elements, true)
        val title = titleFields.optString("图名").ifBlank { listOf(fields.optString("矿区"), data.optJSONObject("project")?.optString("name").orEmpty(), data.optJSONObject("meta")?.optString("hole_id").orEmpty()).filter { it.isNotBlank() }.joinToString(" ") + "钻孔柱状图" }
        val fontFamily = "SimSun,'宋体',serif"
        val audit = full.audit.put("detail", detail.audit).put("source", data.optJSONObject("source") ?: JSONObject()).put("issues", issues)
            .put("typography", JSONObject().put("svg_font_family", fontFamily).put("png_typeface", "serif").put("png_font_verification", "使用Android系统serif回退；未验证系统存在SimSun/宋体字体"))
            .put("scale_source",if(basicScale!=null)"basic_info" else if(titleScale!=null)"title_block" else "default_100")
        val mainSvg = full.plan.svg().replace("font-family=\"Arial,Microsoft YaHei,sans-serif\"", "font-family=\"$fontFamily\"")
        val detailSvg = detail.plan.svg().replace("font-family=\"Arial,Microsoft YaHei,sans-serif\"", "font-family=\"$fontFamily\"")
        return NativeIndustryRenderResult("drill", title, mainSvg, detailSvg, NativeIndustryRenderer.renderPng(full.plan, "serif"), audit, JSONObject(data.toString()),NativeIndustryRenderer.renderPng(detail.plan,"serif"))
    }

    private data class Built(val plan: NativeIndustryRenderer.Plan, val audit: JSONObject)
    private fun build(data: JSONObject, basic: JSONObject, title: JSONObject, layout: Layout, endpoint: Double, viewDepth: Double, scale: Double, denominator: Double, elements: List<JSONObject>, detail: Boolean): Built {
        val bodyBottom = BODY_Y + viewDepth * scale
        val layers = jsonArray(data, "layers").filter { it.optDouble("bottom_m", -1.0) >= 0 && it.optDouble("top_m", viewDepth + 1) <= viewDepth }
        val patternAudit = JSONArray()
        val pendingPatterns = JSONArray()
        layers.forEach { layer ->
            val patternId = resolvePatternId(layer)
            patternAudit.put(JSONObject().put("layer_id", layer.optString("id")).put("pattern_id", patternId ?: JSONObject.NULL))
            if (patternId == null) pendingPatterns.put(layer.optString("id"))
        }
        val turns = jsonArray(data, "turns").filter { it.optDouble("bottom_m", -1.0) >= 0 && it.optDouble("top_m", viewDepth + 1) <= viewDepth }
        val fullSamples = jsonArray(data, "samples").withIndex().sortedWith(compareBy<IndexedValue<JSONObject>> { it.value.optDouble("top_m") }.thenBy { it.value.optDouble("bottom_m") }.thenBy { it.index })
        val samples = fullSamples.filter { it.value.optDouble("bottom_m") > 0 && it.value.optDouble("top_m") < viewDepth }
        val orders = fullSamples.mapIndexed { index, entry -> entry.value to index }.toMap()
        val structures = jsonArray(data, "structures").filter { it.optDouble("depth_m", -1.0) in 0.0..viewDepth }
        val measurementRows = jsonArray(data.optJSONObject("depth_measurements") ?: JSONObject(), "records")
        val footerTop = bodyBottom + 90
        val footer = footer(data, title, layout.width, LEFT, footerTop, denominator, measurementRows)
        val canvasWidth = layout.width + LEFT * 2
        val canvasHeight = ceil(footerTop + footer.height + 24)
        require(canvasHeight <= 12_000 && canvasWidth * canvasHeight <= 80_000_000) { "固定参考钻孔图件超出画布上限" }
        val plan = NativeIndustryRenderer.Plan(canvasWidth.toInt(), canvasHeight.toInt())
        val textTitle = title.optString("图名").ifBlank { listOf(basic.optString("矿区"), data.optJSONObject("project")?.optString("name").orEmpty(), data.optJSONObject("meta")?.optString("hole_id").orEmpty()).filter { it.isNotBlank() }.joinToString(" ") + "钻孔柱状图" }
        plan.text(LEFT + layout.width / 2, 55.0, textTitle, 48.0, ink, 1)
        plan.text(LEFT + layout.width / 2, 93.0, "比例尺 1:${fmt(denominator, 0)}", 20.0, ink, 1)
        val leftInfo = listOf("开孔日期：${date(basic.opt("开孔日期"))}", "终孔日期：${date(basic.opt("终孔日期"))}", "孔　深：${fmt(basic.opt("终孔深度_m") ?: endpoint)}m")
        val midInfo = listOf("孔口坐标：X=${fmt(basic.opt("X坐标_m"))}", "Y=${fmt(basic.opt("Y坐标_m"))}", "H=${fmt(basic.opt("孔口标高_m"))}m")
        val rightInfo = listOf("钻孔方位：${fmt(basic.opt("设计方位角_deg"))}°", "钻孔倾角：${fmt(basic.opt("倾角_deg"))}°")
        leftInfo.forEachIndexed { i, value -> plan.text(LEFT + 4, 154.0 + i * 36, value, 20.0, ink) }
        midInfo.forEachIndexed { i, value -> plan.text(LEFT + layout.width / 2, 154.0 + i * 36, value, 20.0, ink, 1) }
        rightInfo.forEachIndexed { i, value -> plan.text(LEFT + layout.width - 4, 154.0 + i * 44, value, 20.0, ink, 2) }
        drawHeader(plan, layout, elements)
        plan.line(LEFT, BODY_Y, LEFT + layout.width, BODY_Y, ink, .9)
        var cx = LEFT
        for (col in layout.cols) { plan.line(cx, BODY_Y, cx, bodyBottom, ink, .55); cx += col.width }
        plan.line(LEFT + layout.width, BODY_Y, LEFT + layout.width, bodyBottom, ink, .55)
        val plotX = layout.x.getValue("plot_margin")
        plan.line(plotX + 27, BODY_Y, plotX + 27, bodyBottom, ink, .55)
        plan.line(plotX + 125, BODY_Y, plotX + 125, bodyBottom, ink, .55)
        plan.line(LEFT, bodyBottom, LEFT + layout.width, bodyBottom, ink, .9)
        val yDepth: (Double) -> Double = { BODY_Y + it * scale }
        fun range(start: String, end: String, depth: Double, weight: Double = .45) {
            val sx = layout.x.getValue(start); val ex = layout.x.getValue(end) + layout.cols.first { it.key == end }.width
            plan.line(sx, yDepth(depth), ex, yDepth(depth), ink, weight)
        }
        for (turn in turns) {
            val top = max(0.0, turn.optDouble("top_m")); val bottom = min(viewDepth, turn.optDouble("bottom_m")); val mid = yDepth((top + bottom) / 2)
            range("turn", "round_rate", top); range("turn", "round_rate", bottom)
            val values = listOf(turn.optString("id"), fmt(turn.opt("top_m")), fmt(turn.opt("bottom_m")), fmt(turn.opt("advance_m")), fmt(turn.opt("core_m")), fmt(turn.opt("recovery_percent")))
            listOf("turn", "round_from", "round_to", "round_advance", "round_core", "round_rate").forEachIndexed { i, key -> centered(plan, layout, key, mid + 5, values[i], 14.0) }
        }
        val patternX = layout.x.getValue("plot_pattern")
        for (layer in layers) {
            val top = max(0.0, layer.optDouble("top_m")); val bottom = min(viewDepth, layer.optDouble("bottom_m")); val topY = yDepth(top); val bottomY = yDepth(bottom)
            range("layer_id", "description", bottom)
            val layerValues = listOf("layer_id" to layer.optString("id"), "layer_bottom" to fmt(layer.opt("bottom_m")), "layer_thickness" to fmt(layer.opt("thickness_m")), "layer_core" to fmt(layer.opt("core_m")), "layer_rate" to fmt(layer.opt("recovery_percent")))
            layerValues.forEach { (key, value) -> centered(plan, layout, key, bottomY - 2, value, 14.0) }
            drawDrillPattern(plan, resolvePatternId(layer), patternX, topY, 98.0, bottomY - topY)
            val desc = listOf(if (layer.optString("lithology_name").isNotBlank()) listOf(layer.optString("id"), layer.optString("lithology_name")).filter { it.isNotBlank() }.joinToString("、") else "", layer.optString("description")).filter { it.isNotBlank() }.joinToString("\n")
            wrap(desc, 34).forEachIndexed { i, line -> plan.text(layout.x.getValue("description") + 5, topY + 16 + i * 18, line, 14.0, ink) }
            val angle = layer.opt("mean_axis_angle_deg")
            if (angle != null && angle !== JSONObject.NULL) centered(plan, layout, "angle", yDepth((top + bottom) / 2) + 5, fmt(angle), 14.0)
        }
        for (entry in samples) {
            val sample = entry.value; val top = max(0.0, sample.optDouble("top_m")); val bottom = min(viewDepth, sample.optDouble("bottom_m")); val midY = yDepth((top + bottom) / 2)
            val assayEnd = elements.lastOrNull()?.let { "assay:${it.optString("code").ifBlank { "0" }}" } ?: "sample_rate"
            range("sample_id", assayEnd, top); range("sample_id", assayEnd, bottom)
            val sx = layout.x.getValue("plot_samples") + 1; val stripeH = yDepth(bottom) - yDepth(top)
            val fill = if ((orders[sample] ?: 0) % 2 == 0) white else Color.BLACK
            plan.rect(sx, yDepth(top), 5.0, stripeH, fill, true, .6)
            val id = sample.optString("id")
            val preferredFont = if (id.length > 1) 11.0 else 14.0
            val font = min(preferredFont, max(1.0, stripeH * .65))
            plan.text(sx + 8, midY + font * .32, id, font, ink)
            val sampleValues = listOf("sample_id" to id, "sample_from" to fmt(sample.opt("top_m")), "sample_to" to fmt(sample.opt("bottom_m")), "sample_length" to fmt(sample.opt("length_m")), "sample_core" to fmt(sample.opt("core_m")), "sample_rate" to fmt(sample.opt("recovery_percent")))
            sampleValues.forEach { (key, value) -> centered(plan, layout, key, midY + 5, value, 14.0) }
            val assays = sample.optJSONObject("assays") ?: JSONObject(); val raw = sample.optJSONObject("assay_raw") ?: JSONObject()
            for (item in elements) {
                val code = item.optString("code"); val rawVal = raw.opt(code); val numeric = assays.opt(code)
                val shown = if (rawVal != null && rawVal !== JSONObject.NULL && rawVal.toString().isNotEmpty()) rawVal.toString() else if (numeric == null || numeric === JSONObject.NULL) "" else fmt(numeric, 4)
                centered(plan, layout, "assay:$code", midY + 5, shown, 14.0)
            }
        }
        for (structure in structures) {
            val x = layout.x.getValue("structure"); val yy = yDepth(structure.optDouble("depth_m")); val label = "${fmt(structure.opt("depth_m"))}m / ${fmt(structure.opt("diameter_mm"))}mm"
            plan.text(x + 4, yy - 2, label, fit(label, 108.0), ink)
        }
        if (detail && viewDepth < endpoint) plan.text(LEFT + layout.width - 5, bodyBottom - 5, "0–${fmt(viewDepth, 0)}m局部详图；按比例连续显示", 8.0, ink, 2)
        drawFooter(plan, data, title, layout.width, LEFT, footerTop, denominator, measurementRows)
        val sampleFills = JSONArray().apply { samples.forEach { entry -> put(if ((orders[entry.value] ?: 0) % 2 == 0) "#fff" else "#111") } }
        val sampleHeights = JSONArray().apply { samples.forEach { entry -> put((entry.value.optDouble("bottom_m") - entry.value.optDouble("top_m")) * scale) } }
        val audit = JSONObject().put("main", JSONObject().put("width", plan.width).put("height", plan.height).put("operation_count", plan.operationCount))
            .put("layout", JSONObject().put("table_x", LEFT).put("header_y", HEADER_Y).put("header_height", HEADER_H).put("body_top", BODY_Y).put("table_width", layout.width).put("canvas_width", canvasWidth(layout)).put("depth_scale_units_per_meter", scale).put("depth_top_y", BODY_Y).put("depth_bottom_y", bodyBottom).put("view_depth_m", viewDepth).put("analysis_count", elements.size).put("layers", layers.size).put("turns", turns.size).put("samples", samples.size).put("sample_fill", sampleFills).put("sample_segment_heights", sampleHeights).put("pattern_mappings", patternAudit).put("pending_patterns", pendingPatterns).put("footer", footer.audit))
        return Built(plan, audit)
    }

    private fun columns(elements: List<JSONObject>): Layout {
        val cols = mutableListOf(
            Col("turn", 54.0), Col("round_from", 54.0), Col("round_to", 54.0), Col("round_advance", 54.0), Col("round_core", 54.0), Col("round_rate", 54.0),
            Col("layer_id", 54.0), Col("layer_bottom", 54.0), Col("layer_thickness", 54.0), Col("layer_core", 54.0), Col("layer_rate", 54.0),
            Col("plot_margin", 27.0), Col("plot_pattern", 98.0), Col("plot_samples", 37.0), Col("description", 486.0), Col("angle", 54.0),
            Col("sample_id", 54.0), Col("sample_from", 54.0), Col("sample_to", 54.0), Col("sample_length", 54.0), Col("sample_core", 54.0), Col("sample_rate", 54.0),
        )
        elements.forEachIndexed { i, item -> cols += Col("assay:${item.optString("code").ifBlank { i.toString() }}", 54.0) }
        cols += Col("structure", 108.0); cols += Col("remarks", 108.0)
        val xs = linkedMapOf<String, Double>(); var cursor = LEFT
        for (col in cols) { xs[col.key] = cursor; cursor += col.width }
        return Layout(cols, xs, cursor - LEFT)
    }
    private fun canvasWidth(layout: Layout) = layout.width + LEFT * 2

    internal fun resolvePatternId(layer: JSONObject): String? {
        val explicitId = layer.optString("pattern_id").takeUnless { it.isBlank() || it == "null" }
        if (explicitId != null && explicitId in supportedPatterns) return explicitId
        val explicitCode = layer.optString("material_code").takeUnless { it.isBlank() || it == "null" }
        if (explicitCode != null) patternByCode[explicitCode]?.let { return it }
        return patternByMaterial[layer.optString("lithology_name").trim()]
    }

    internal fun drawDrillPattern(plan: NativeIndustryRenderer.Plan, patternId: String?, x: Double, y: Double, width: Double, height: Double) {
        if (patternId == null || height <= 0.0) return // Unknown materials remain the template's white pending pattern.
        val tileHeight = when (patternId) {
            "short-dash-double-dot" -> 84.0
            "dot-rows-thin-lines" -> 21.0
            "point-dash-ellipse-bands" -> 48.0
            else -> return
        }
        val right = x + width; val bottom = y + height
        fun line(x1: Double, x2: Double, yy: Double, stroke: Double) {
            val clippedLeft = max(x, x1); val clippedRight = min(right, x2)
            if (yy >= y && yy <= bottom && clippedRight > clippedLeft) plan.line(clippedLeft, yy, clippedRight, yy, ink, stroke)
        }
        fun dot(cx: Double, cy: Double, r: Double = .9) {
            if (cx - r >= x && cx + r <= right && cy - r >= y && cy + r <= bottom) plan.circle(cx, cy, r, ink, true)
        }
        fun ellipse(cx: Double, cy: Double, rx: Double, ry: Double) {
            if (cx - rx < x || cx + rx > right || cy - ry < y || cy + ry > bottom) return
            plan.ellipse(cx, cy, rx, ry, ink, .7)
        }
        var tileY = y
        while (tileY < bottom) {
            var tileX = x
            while (tileX < right) {
                when (patternId) {
                    "short-dash-double-dot" -> {
                        for (row in 0..12) line(tileX, tileX + 74, tileY + row * 7.0, .45)
                        for (row in 0 until 12) {
                            val yy = tileY + 3.5 + row * 7.0
                            val xs = if (row % 2 == 0) listOf(2.0, 20.0, 38.0, 56.0) else listOf(10.0, 29.0, 47.0, 65.0)
                            val widths = listOf(7.0, 10.0, 8.0, 7.0)
                            xs.forEachIndexed { i, dx -> line(tileX + dx, tileX + dx + widths[i], yy, .75) }
                        }
                        listOf(28.0 to 73.5, 31.0 to 73.5, 54.0 to 80.5, 57.0 to 80.5).forEach { (dx, dy) -> dot(tileX + dx, tileY + dy, .95) }
                    }
                    "dot-rows-thin-lines" -> {
                        for (row in 0..3) line(tileX, tileX + 74, tileY + row * 7.0, .65)
                        val points = listOf(7.0 to 3.5, 23.0 to 3.5, 39.0 to 3.5, 55.0 to 3.5, 69.0 to 3.5, 15.0 to 10.5, 31.0 to 10.5, 47.0 to 10.5, 63.0 to 10.5, 7.0 to 17.5, 23.0 to 17.5, 39.0 to 17.5, 55.0 to 17.5, 69.0 to 17.5)
                        points.forEach { (dx, dy) -> dot(tileX + dx, tileY + dy) }
                    }
                    "point-dash-ellipse-bands" -> {
                        for (row in 0..3) line(tileX, tileX + 74, tileY + row * 16.0, .7)
                        listOf(6.0 to 9.0, 27.0 to 13.0, 55.0 to 8.0).forEach { (dx, len) -> line(tileX + dx, tileX + dx + len, tileY + 23, .7) }
                        ellipse(tileX + 11.5, tileY + 40, 4.5, 1.8); ellipse(tileX + 37.2, tileY + 40, 5.2, 2.0); ellipse(tileX + 63.0, tileY + 40, 4.0, 1.7)
                        listOf(8.0 to 5.0, 25.0 to 5.0, 43.0 to 5.0, 62.0 to 5.0, 17.0 to 11.0, 35.0 to 11.0, 54.0 to 11.0, 8.0 to 27.0, 21.0 to 27.0, 47.0 to 27.0, 68.0 to 27.0).forEach { (dx, dy) -> dot(tileX + dx, tileY + dy) }
                    }
                }
                tileX += 74.0
            }
            tileY += tileHeight
        }
    }
    private fun drawHeader(p: NativeIndustryRenderer.Plan, l: Layout, items: List<JSONObject>) {
        fun cell(start: String, end: String, y: Double, h: Double, label: String, vertical: Boolean = false, size: Double = 20.0) {
            val x = l.x.getValue(start); val right = l.x.getValue(end) + l.cols.first { it.key == end }.width
            headerCell(p, x, y, right - x, h, label, vertical, size)
        }
        val top = HEADER_Y; val group = 38.0; val middle = 42.0; val lowY = top + group + middle; val lowH = HEADER_H - group - middle
        cell("turn", "turn", top, HEADER_H, "回次", true)
        cell("round_from", "round_advance", top, group, "回次进尺（米）")
        listOf("自", "至", "进尺（米）").forEachIndexed { i, s -> cell(listOf("round_from", "round_to", "round_advance")[i], listOf("round_from", "round_to", "round_advance")[i], top + group, HEADER_H - group, s, true) }
        cell("round_core", "round_rate", top, group, "岩芯采取")
        cell("round_core", "round_core", top + group, HEADER_H - group, "岩芯长（米）", true)
        cell("round_rate", "round_rate", top + group, HEADER_H - group, "采取率（%）", true)
        listOf("layer_id" to "层位", "layer_bottom" to "换层深度（米）", "layer_thickness" to "分层厚度（米）", "layer_core" to "岩芯长（米）", "layer_rate" to "分层采取率（%）").forEach { cell(it.first, it.first, top, HEADER_H, it.second, true) }
        cell("plot_margin", "plot_samples", top, HEADER_H, "柱状图")
        cell("description", "description", top, HEADER_H, "岩性描述")
        cell("angle", "angle", top, HEADER_H, "标志面与岩芯轴的夹角", true, 18.0)
        cell("sample_id", "sample_length", top, group, "采样情况")
        cell("sample_id", "sample_id", top + group, HEADER_H - group, "样品编号", true)
        cell("sample_from", "sample_length", top + group, middle, "采样位置（米）")
        listOf("sample_from" to "自", "sample_to" to "至", "sample_length" to "样长").forEach { cell(it.first, it.first, lowY, lowH, it.second, true) }
        cell("sample_core", "sample_core", top, HEADER_H, "岩矿芯长", true)
        cell("sample_rate", "sample_rate", top, HEADER_H, "采取率（%）", true)
        if (items.isNotEmpty()) {
            cell(l.cols.first { it.key.startsWith("assay:") }.key, l.cols.filter { it.key.startsWith("assay:") }.last().key, top, group, "分析结果")
            for (item in items) { val code = item.optString("code"); val key = "assay:$code"; cell(key, key, top + group, HEADER_H - group, code.ifBlank { item.optString("name") }, true); if (item.optString("unit").isNotBlank()) p.text(l.x.getValue(key) + 27, top + HEADER_H - 8, item.optString("unit"), 11.0, ink, 1) }
        }
        headerLines(p, l.x.getValue("structure"), top, 108.0, HEADER_H, listOf("钻 孔", "结 构"), 20.0)
        headerLines(p, l.x.getValue("remarks"), top, 108.0, HEADER_H, listOf("备 注"), 20.0)
        p.rect(LEFT, top, l.width, HEADER_H, ink, false, .9)
    }
    private fun headerCell(p: NativeIndustryRenderer.Plan, x: Double, y: Double, w: Double, h: Double, label: String, vertical: Boolean, size: Double) {
        p.rect(x, y, w, h, white, true, .7)
        p.rect(x, y, w, h, ink, false, .7)
        if (label.isBlank()) return
        if (vertical) {
            val tokens = Regex("（[^）]*）|\\([^)]*\\)|.", RegexOption.DOT_MATCHES_ALL).findAll(label).map { it.value }.toList()
            val start = y + 25 + size * .78; val end = y + h - 25
            tokens.forEachIndexed { i, token -> p.text(x + w / 2, if (tokens.size == 1) y + h / 2 + size * .34 else start + (end - start) * i / (tokens.size - 1), token, if (tokens.size <= 1) size else min(size, (end - start) / (tokens.size - 1) * .9), ink, 1) }
        } else p.text(x + w / 2, y + h / 2 + size * .34, label, size, ink, 1)
    }
    private fun headerLines(p: NativeIndustryRenderer.Plan, x: Double, y: Double, w: Double, h: Double, lines: List<String>, size: Double) {
        p.rect(x, y, w, h, white, true, .7); p.rect(x, y, w, h, ink, false, .7); val step = size * 1.3; val start = y + h / 2 - (lines.size - 1) * step / 2 + size * .34
        lines.forEachIndexed { i, line -> p.text(x + w / 2, start + i * step, line, size, ink, 1) }
    }
    private fun centered(p: NativeIndustryRenderer.Plan, l: Layout, key: String, y: Double, value: String, size: Double) {
        val col = l.cols.firstOrNull { it.key == key } ?: return
        p.text(l.x.getValue(key) + col.width / 2, y, value, fit(value, col.width - 4, size), ink, 1)
    }

    private fun footer(data: JSONObject, title: JSONObject, width: Double, x: Double, y: Double, denominator: Double, records: List<JSONObject>): Footer {
        val leftW = width * .365; val midW = width * .31; val rightW = width * .243; val leftGap = width * .014; val rightGap = width - leftW - midW - rightW - leftGap
        val midX = x + leftW + leftGap; val rightX = x + width - rightW; val rowH = 32.0; val headerH = 64.0; val maxRows = max(records.size, 1)
        val bodyH = maxRows * rowH; val titleH = 7 * rowH
        val ops = mutableListOf<String>()
        fun rect(cx: Double, cy: Double, cw: Double, ch: Double) { ops += "R:$cx,$cy,$cw,$ch" }
        fun text(cx: Double, cy: Double, value: String, size: Double = 16.0) { ops += "T:$cx,$cy,$size:$value" }
        fun celltext(cx: Double, cy: Double, cw: Double, ch: Double, value: String, size: Double = 16.0) { rect(cx, cy, cw, ch); text(cx + cw / 2, cy + ch * .66, value, fit(value, cw - 8, size)) }
        text(x + leftW / 2, y - 20, "孔深校正记录表", 20.0); text(midX + midW / 2, y - 20, "弯曲度测量表", 20.0)
        val leftLabels = listOf("序号", "记录孔深（米）", "校正孔深（米）", "误差（米）", "误差率（‰）")
        val leftWidths = listOf(.13, .25, .25, .20, .17).map { it * leftW }
        val midLabels = listOf("序号", "校正孔深（米）", "方位角（°）", "倾角（°）", "天顶角（°）")
        val midWidths = listOf(.12, .28, .22, .20, .18).map { it * midW }
        fun footerTable(tx: Double, tableW: Double, labels: List<String>, widths: List<Double>, values: List<List<String>>, twoHeader: Boolean) {
            if (twoHeader) {
                var cx = tx
                celltext(cx, y, widths[0], headerH, labels[0]); cx += widths[0]
                celltext(cx, y, widths[1] + widths[2], 32.0, "孔深校正")
                celltext(cx, y + 32, widths[1], 32.0, labels[1]); celltext(cx + widths[1], y + 32, widths[2], 32.0, labels[2]); cx += widths[1] + widths[2]
                celltext(cx, y, widths[3], headerH, labels[3]); cx += widths[3]; celltext(cx, y, widths[4], headerH, labels[4])
            } else {
                var cx = tx; labels.forEachIndexed { i, label -> celltext(cx, y, widths[i], 32.0, label); cx += widths[i] }
            }
            for (ri in 0 until maxRows) { var cx = tx; val cy = y + (if(twoHeader)headerH else rowH) + ri * rowH; val row = values.getOrNull(ri) ?: labels.map { "" }; row.forEachIndexed { i, value -> celltext(cx, cy, widths[i], rowH, value); cx += widths[i] } }
        }
        val leftRows = records.mapIndexed { i, r -> listOf("${i + 1}", fmt(get(r, "recorded_depth_m", "记录孔深_m")), fmt(get(r, "checked_depth_m", "校测孔深_m"), 3), fmt(get(r, "error_m", "误差_m"), 3), number(get(r, "error_percent", "误差率_pct"))?.let { fmt(it * 10, 3) }.orEmpty()) }
        footerTable(x, leftW, leftLabels, leftWidths, leftRows, true)
        val midRows = records.mapIndexed { i, r -> val zenith = number(get(r, "zenith_deg", "测量天顶角_deg")); listOf("${i + 1}", fmt(get(r, "checked_depth_m", "校测孔深_m"), 3), fmt(get(r, "azimuth_deg", "实测方位角_deg")), zenith?.let { fmt(90 - it) }.orEmpty(), zenith?.let { fmt(it) }.orEmpty()) }
        footerTable(midX, midW, midLabels, midWidths, midRows, false)
        val labelW = rightW * .18; val valW = rightW * .32; val pairLabels = listOf("拟编", "顺序号", "审核", "图号", "制图", "比例尺", "项目负责", "日期", "单位负责", "资料来源")
        for (r in 0 until 7) {
            val yy = y + r * rowH
            if (r < 2) { celltext(rightX, yy, rightW, rowH, title.optString(if (r == 0) "项目/单位" else "图名")); continue }
            val idx = r - 2; val a = pairLabels[idx * 2]; val b = pairLabels[idx * 2 + 1]
            celltext(rightX, yy, labelW, rowH, a); celltext(rightX + labelW, yy, valW, rowH, title.optString(a))
            celltext(rightX + labelW + valW, yy, labelW, rowH, b)
            val value = if (b == "比例尺") "1:${fmt(denominator, 0)}" else title.optString(b)
            celltext(rightX + labelW * 2 + valW, yy, valW, rowH, value)
        }
        // Materialize footer drawing commands in a temporary actual plan and return it to the caller.
        val result = JSONObject().put("geometry", JSONObject().put("left_x", x).put("left_width", leftW).put("left_gap", leftGap).put("middle_x", midX).put("middle_width", midW).put("right_gap", rightGap).put("right_x", rightX).put("right_width", rightW).put("header_y", y).put("row_height", rowH))
            .put("measurement_rows", records.size).put("depth_scale_denominator", denominator)
        return Footer(max(headerH + bodyH, titleH) + 8, JSONArray(ops), result)
    }

    private fun drawFooter(plan: NativeIndustryRenderer.Plan, data: JSONObject, title: JSONObject, width: Double, x: Double, y: Double, denominator: Double, records: List<JSONObject>) {
        val result = footer(data, title, width, x, y, denominator, records)
        val ops = result.ops
        for (i in 0 until ops.length()) {
            val item = ops.getString(i)
            if (item.startsWith("R:")) { val v = item.removePrefix("R:").split(',').map(String::toDouble); plan.rect(v[0], v[1], v[2], v[3], white, true); plan.rect(v[0], v[1], v[2], v[3], ink, false, .7) }
            else if (item.startsWith("T:")) {
                val parts = item.removePrefix("T:").split(':', limit = 2); val nums = parts[0].split(','); val px = nums[0].toDouble(); val py = nums[1].toDouble(); val size = nums[2].toDouble()
                plan.text(px, py, parts.getOrElse(1) { "" }, size, ink, 1)
            }
        }
    }

    private fun basicFields(data: JSONObject): JSONObject {
        val direct = data.optJSONObject("basic_info")?.optJSONObject("fields")
        if (direct != null && direct.length() > 0) return direct
        return JSONObject()
    }
    private fun titleFields(data: JSONObject): JSONObject {
        val direct = data.optJSONObject("title_block")?.optJSONObject("fields")
        if (direct != null && direct.length() > 0) return direct
        val out = JSONObject(); val rows = data.optJSONObject("source_tables")?.optJSONObject("图签")?.optJSONArray("rows") ?: return out
        val mapping = linkedMapOf("项目/单位" to "B4", "图名" to "B5", "拟编" to "B6", "审核" to "D6", "制图" to "B7", "项目负责" to "D7", "单位负责" to "B8", "图号" to "D8", "顺序号" to "B9", "比例尺分母" to "D9", "日期" to "B10", "资料来源" to "D10")
        for ((label, address) in mapping) {
            val row = (0 until rows.length()).mapNotNull { rows.optJSONObject(it) }.firstOrNull { it.optInt("row") == address.dropWhile(Char::isLetter).toIntOrNull() }
            row?.optJSONObject("values")?.opt(address)?.let { out.put(label, it) }
        }
        return out
    }
    private fun jsonArray(data: JSONObject, key: String): List<JSONObject> = data.optJSONArray(key)?.let { a -> (0 until a.length()).mapNotNull { a.optJSONObject(it) } } ?: emptyList()
    internal fun parseScaleDenominator(value:Any?):Double? {
        val parsed=number(value) ?: (value as? String)?.let {
            Regex("(?:1\\s*[:：]\\s*)?([\\d,]+(?:\\.\\d+)?)").find(it.trim())?.groupValues?.get(1)?.replace(",","")?.toDoubleOrNull()
        }
        return parsed?.takeIf { it.isFinite() && it>0 }
    }
    private fun number(v: Any?): Double? = when (v) { is Number -> v.toDouble().takeIf { it.isFinite() }; is String -> v.trim().toDoubleOrNull()?.takeIf { it.isFinite() }; else -> null }
    private fun get(o: JSONObject, normalized: String, source: String): Any? = o.opt(normalized).takeUnless { it == null || it === JSONObject.NULL } ?: o.opt(source).takeUnless { it == null || it === JSONObject.NULL }
    private fun fmt(v: Any?, digits: Int = 2): String { val n = number(v); if (n != null) { val raw = String.format(java.util.Locale.US, "%.$digits f".replace(" ", ""), n); return if (raw.contains('.')) raw.trimEnd('0').trimEnd('.') else raw }; return v?.toString()?.takeUnless { it == "null" || it.isBlank() }.orEmpty() }
    private fun date(v: Any?) = v?.toString().orEmpty().replace(Regex("^(\\d{4})-(\\d{1,2})-(\\d{1,2}).*$"), "$1年$2月$3日")
    private fun fit(value: String, width: Double, base: Double = 14.0): Double { val units = value.sumOf { if (it.code < 256) .58 else 1.0 }; return max(1.0, min(base, (width - 6) / max(units, 1.0))) }
    private fun wrap(value: String, width: Int): List<String> = value.split('\n').flatMap { para -> para.chunked(width.coerceAtLeast(1)).ifEmpty { listOf("") } }
}
