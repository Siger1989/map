package com.shantu.nativeapp.industry

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.OutputStream
import kotlin.math.*

data class NativeIndustryRenderResult(
    val kind: String,
    val title: String,
    val mainSvg: String,
    val detailSvg: String,
    val mainPng: ByteArray,
    val audit: JSONObject,
    val normalized: JSONObject,
    val detailPng: ByteArray = mainPng,
)

/** Native vector and Canvas renderer. Both outputs consume the same drawing command list. */
object NativeIndustryRenderer {
    const val MAX_PNG_PIXELS = 24_000_000
    const val MAX_PNG_SIDE = 12_000
    private const val MAX_PNG_BYTES = 32_000_000
    private const val MAX_DRAW_OPS = 300_000
    internal data class Op(val kind: Int, val x: FloatArray, val text: String = "", val color: Int = Color.BLACK, val fill: Boolean = false, val size: Float = 1f, val align: Int = 0, val dash: Boolean = false)
    internal class Plan(val width: Int, val height: Int) {
        val ops = mutableListOf<Op>()
        val operationCount: Int get() = ops.size
        private fun add(op: Op) { if (ops.size >= MAX_DRAW_OPS) throw IllegalArgumentException("行业图件绘图元素超过安全上限"); ops += op }
        fun rect(x: Double, y: Double, w: Double, h: Double, color: Int, fill: Boolean = true, stroke: Double = 1.0) { if (w <= 0 || h <= 0) return; add(Op(0, floatArrayOf(x.toFloat(), y.toFloat(), w.toFloat(), h.toFloat()), color = color, fill = fill, size = stroke.toFloat())) }
        fun line(x1: Double, y1: Double, x2: Double, y2: Double, color: Int = Color.BLACK, stroke: Double = 1.0, dash: Boolean = false) { add(Op(1, floatArrayOf(x1.toFloat(), y1.toFloat(), x2.toFloat(), y2.toFloat()), color = color, size = stroke.toFloat(), dash = dash)) }
        fun poly(points: List<Pair<Double, Double>>, color: Int = Color.BLACK, stroke: Double = 1.0, fill: Boolean = false) { if (points.size < 2) return; add(Op(if (fill) 3 else 2, points.flatMap { listOf(it.first.toFloat(), it.second.toFloat()) }.toFloatArray(), color = color, size = stroke.toFloat(), fill = fill)) }
        fun circle(cx: Double, cy: Double, r: Double, color: Int = Color.BLACK, fill: Boolean = false, stroke: Double = 1.0) { add(Op(4, floatArrayOf(cx.toFloat(), cy.toFloat(), r.toFloat()), color = color, fill = fill, size = stroke.toFloat())) }
        fun ellipse(cx: Double, cy: Double, rx: Double, ry: Double, color: Int = Color.BLACK, stroke: Double = 1.0) { if (rx <= 0 || ry <= 0) return; add(Op(6, floatArrayOf(cx.toFloat(), cy.toFloat(), rx.toFloat(), ry.toFloat()), color = color, size = stroke.toFloat())) }
        fun text(x: Double, y: Double, value: String, size: Double = 12.0, color: Int = Color.rgb(32, 36, 33), align: Int = 0) { if (value.isNotEmpty()) add(Op(5, floatArrayOf(x.toFloat(), y.toFloat()), value, color, size = size.toFloat(), align = align)) }
        fun hatchRect(x: Double, y: Double, w: Double, h: Double, name: String, background: Int = Color.WHITE) {
            rect(x, y, w, h, background, true); rect(x, y, w, h, Color.rgb(110, 110, 110), false, .7)
            val step = 12.0; val c = Color.rgb(55, 55, 55)
            when {
                name.contains("砂") || name.contains("岩") -> { var k = -h; while (k < w) { val x1 = x + max(0.0, k); val y1 = y + max(0.0, -k); val x2 = x + min(w, k + h); val y2 = y + min(h, h + k); if (x2 >= x1 && y2 >= y1) line(x1, y1, x2, y2, c, .55); k += step } }
                name.contains("凝灰") || name.contains("火山") -> { var yy = y + 6; while (yy < y + h) { var xx = x + (if ((yy / 6).toInt() % 2 == 0) 5 else 10); while (xx < x + w) { circle(xx, yy, .9, c, true); xx += 12 }; yy += 12 } }
                else -> { var yy = y + 7; while (yy < y + h) { line(x + 2, yy, x + w - 2, yy, c, .5); yy += 12 } }
            }
        }
        fun svg(): String {
            val out = StringBuilder("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"$width\" height=\"$height\" viewBox=\"0 0 $width $height\"><rect width=\"100%\" height=\"100%\" fill=\"#fff\"/><g font-family=\"Arial,Microsoft YaHei,sans-serif\" fill=\"#202421\">\n")
            for (op in ops) {
                val c = String.format("#%06x", op.color and 0xffffff)
                when (op.kind) {
                    0 -> out.append("<rect x=\"${n(op.x[0])}\" y=\"${n(op.x[1])}\" width=\"${n(op.x[2])}\" height=\"${n(op.x[3])}\" fill=\"${if (op.fill) c else "none"}\" stroke=\"${if (op.fill) "none" else c}\" stroke-width=\"${n(op.size)}\"/>\n")
                    1 -> out.append("<line x1=\"${n(op.x[0])}\" y1=\"${n(op.x[1])}\" x2=\"${n(op.x[2])}\" y2=\"${n(op.x[3])}\" stroke=\"$c\" stroke-width=\"${n(op.size)}\"${if (op.dash) " stroke-dasharray=\"6 4\"" else ""}/>\n")
                    2, 3 -> { out.append(if (op.kind == 3) "<polygon points=\"" else "<polyline points=\""); for (i in op.x.indices step 2) out.append("${n(op.x[i])},${n(op.x[i + 1])} "); out.append("\" fill=\"${if (op.kind == 3) c else "none"}\" stroke=\"$c\" stroke-width=\"${n(op.size)}\"/>\n") }
                    4 -> out.append("<circle cx=\"${n(op.x[0])}\" cy=\"${n(op.x[1])}\" r=\"${n(op.x[2])}\" fill=\"${if (op.fill) c else "#fff"}\" stroke=\"$c\" stroke-width=\"${n(op.size)}\"/>\n")
                    5 -> out.append("<text x=\"${n(op.x[0])}\" y=\"${n(op.x[1])}\" font-size=\"${n(op.size)}\" fill=\"$c\" text-anchor=\"${if (op.align == 1) "middle" else if (op.align == 2) "end" else "start"}\">${xml(op.text)}</text>\n")
                    6 -> out.append("<ellipse cx=\"${n(op.x[0])}\" cy=\"${n(op.x[1])}\" rx=\"${n(op.x[2])}\" ry=\"${n(op.x[3])}\" fill=\"none\" stroke=\"$c\" stroke-width=\"${n(op.size)}\"/>\n")
                }
            }
            return out.append("</g></svg>").toString()
        }
    }

    fun render(kind: String, normalized: JSONObject): NativeIndustryRenderResult {
        require(kind == "section" || kind == "drill") { "行业图件类型无效" }
        if (kind == "drill" && normalized.optString("schema_version") == "drill-integrated-native-1.0") {
            return NativeIntegratedDrillRenderer.render(normalized)
        }
        val safe = JSONObject(normalized.toString())
        val pair = if (kind == "section") section(safe) else drill(safe)
        require(pair.first.ops.size <= 300_000 && pair.second.ops.size <= 300_000) { "行业图件绘图元素超出安全上限" }
        val title = if (kind == "section") safe.optJSONObject("project")?.optString("section_id").orEmpty().ifBlank { safe.optJSONObject("project")?.optString("name").orEmpty().ifBlank { "实测剖面" } } else "钻孔 ${safe.optJSONObject("meta")?.optString("hole_id").orEmpty().ifBlank { safe.optJSONObject("project")?.optString("hole_id").orEmpty().ifBlank { "未命名" } }}"
        val png = renderPng(pair.first)
        val audit = JSONObject().put("main", JSONObject().put("width", pair.first.width).put("height", pair.first.height).put("operation_count", pair.first.ops.size))
            .put("detail", JSONObject().put("width", pair.second.width).put("height", pair.second.height).put("operation_count", pair.second.ops.size)).put("source", safe.optJSONObject("source") ?: JSONObject()).put("issues", safe.optJSONArray("issues") ?: JSONArray())
            .put("layout", pair.third)
        return NativeIndustryRenderResult(kind, title, pair.first.svg(), pair.second.svg(), png, audit, safe,renderPng(pair.second))
    }

    private fun section(data: JSONObject): Triple<Plan, Plan, JSONObject> {
        val nodes = array(data, "nodes"); val intervals = array(data, "intervals"); val records = array(data, "records"); val samples = array(data, "samples"); val stations = array(data, "stations"); val attitudes = array(data, "attitudes")
        if (nodes.size < 2) throw IllegalArgumentException("剖面数据至少需要两个测点")
        val ns = nodes.map { it.getDouble("x_m") to it.getDouble("z_m") }
        val minX = ns.minOf { it.first }; val maxX = ns.maxOf { it.first }; val spanX = maxX - minX
        if (!spanX.isFinite() || spanX <= 0 || spanX > 1e7) throw IllegalArgumentException("剖面轴向投影范围无效，不能保持真实比例")
        val minZ = ns.minOf { it.second }; val maxZ = ns.maxOf { it.second }; val requestedDepth = data.optJSONObject("settings")?.optDouble("display_depth_m", 7.0) ?: 7.0
        val effectiveDepth = requestedDepth.takeIf { it.isFinite() && it > 0 } ?: 7.0
        val main = sectionPlan(data, nodes, intervals, records, samples, stations, attitudes, 1960, minX, maxX, minZ, maxZ, effectiveDepth)
        val detail = sectionPlan(data, nodes, intervals, records, samples, stations, attitudes, 2760, minX, maxX, minZ, maxZ, effectiveDepth)
        return Triple(main.first, detail.first, JSONObject().put("geometry_mode", "attitude_extrapolated_contacts").put("contacts", main.second).put("requested_depth_m", effectiveDepth).put("stations", stations.size).put("intervals", intervals.size).put("samples", samples.size).put("located_samples", samples.count { it.optJSONObject("position") != null && it.opt("position") !== JSONObject.NULL }))
    }

    private fun sectionPlan(data: JSONObject, nodes: List<JSONObject>, intervals: List<JSONObject>, records: List<JSONObject>, samples: List<JSONObject>, stations: List<JSONObject>, attitudes: List<JSONObject>, width: Int, minX: Double, maxX: Double, minZ: Double, maxZ: Double, depth: Double): Pair<Plan, JSONArray> {
        val margin = 110.0; val panelW = width - 2 * margin; val planTop = 150.0; val planH = 400.0
        val east = nodes.map { it.optDouble("east_m") }; val north = nodes.map { it.optDouble("north_m") }
        val spanE = max(east.max() - east.min(), 1e-6); val spanN = max(north.max() - north.min(), 1e-6)
        val mapScale = min(panelW / spanE, (planH - 60) / spanN); val cx = margin + panelW / 2; val cy = planTop + planH / 2
        val mapPoint: (JSONObject) -> Pair<Double, Double> = { n -> cx + (n.optDouble("east_m") - (east.min() + east.max()) / 2) * mapScale to cy - (n.optDouble("north_m") - (north.min() + north.max()) / 2) * mapScale }
        val spanDepth = (maxZ - minZ) + depth; val profileScale = min(panelW / (maxX - minX), 520 / max(spanDepth, .25)); val zTop = maxZ + max(.5, depth * .06); val zBottom = minZ - depth
        val profileTop = planTop + planH + 150; val profileBottom = profileTop + (zTop - zBottom) * profileScale
        val requestedHeight = ceil(profileBottom + 220 + max(1, intervals.size) * 62 + max(1, samples.size) * 34 + 90)
        if (!requestedHeight.isFinite() || requestedHeight > 12000) throw IllegalArgumentException("剖面图超出12000像素边长上限")
        val height = requestedHeight.toInt()
        val p = Plan(width, height); val dark = Color.rgb(35, 42, 39); val grid = Color.rgb(220, 226, 221); val red = Color.rgb(166, 67, 48)
        p.text(margin, 42.0, data.optJSONObject("project")?.optString("section_id").orEmpty().ifBlank { data.optJSONObject("project")?.optString("name").orEmpty().ifBlank { "实测剖面" } }, 23.0, dark)
        p.text(margin, 67.0, "平面测线与剖面地形按实测坐标等比例绘制；虚线层界由相邻测段产状推算，不代表实测矿界。", 11.0, Color.DKGRAY)
        p.text(margin, planTop - 18, "测线平面导线（东坐标 E / 北坐标 N，等比例）", 14.0, dark)
        p.rect(margin, planTop, panelW, planH, Color.LTGRAY, false, 1.0)
        for (i in 0..6) { val x = margin + panelW * i / 6; p.line(x, planTop, x, planTop + planH, grid.toInt(), .7); p.text(x, planTop + planH + 17, fmt((east.min() + spanE * i / 6), 2), 9.0, dark, 1) }
        for (i in 0..4) { val y = planTop + planH * i / 4; p.line(margin, y, margin + panelW, y, grid.toInt(), .7) }
        p.poly(nodes.map(mapPoint), dark, 1.7)
        stations.forEach { s -> val node = nodes.getOrNull(s.optInt("node")) ?: return@forEach; val (x, y) = mapPoint(node); p.circle(x, y, 5.0, Color.rgb(32, 100, 70), true); p.text(x + 7, y - 6, s.optString("id"), 10.0, dark) }
        p.text(margin + panelW / 2, planTop + planH + 38, "东坐标 E (m)", 10.0, dark, 1)
        val prof: (Double, Double) -> Pair<Double, Double> = { x, z -> margin + (x - minX) * profileScale to profileTop + (zTop - z) * profileScale }
        p.text(margin, profileTop - 28, "实测剖面地形与产状推算层界", 14.0, dark)
        p.rect(margin, profileTop, panelW, profileBottom - profileTop, Color.LTGRAY, false, 1.0)
        for (i in 0..5) { val z = zTop - (zTop - zBottom) * i / 5; val y = profileTop + (zTop - z) * profileScale; p.line(margin, y, margin + panelW, y, grid.toInt(), .7); p.text(margin - 7, y + 3, fmt(z, 2), 9.0, dark, 2) }
        p.poly(nodes.map { prof(it.getDouble("x_m"), it.getDouble("z_m")) }, dark, 2.0)
        val byId = records.associateBy { it.optString("id") }; val contacts = JSONArray()
        intervals.drop(1).forEachIndexed { idx, interval ->
            val anchor = nodes.getOrNull(interval.optInt("start_node")); val record = interval.optJSONArray("record_ids")?.optString(0)?.let { byId[it] }
            if (anchor == null || record == null || record.isNull("dip_direction_deg") || record.isNull("dip_angle_deg")) {
                contacts.put(JSONObject().put("interval_id", interval.optString("id")).put("status", "pending").put("reason", "missing_attitude")); return@forEachIndexed
            }
            val axis = data.optJSONObject("settings")?.optDouble("axis_azimuth_deg") ?: Double.NaN
            val direction = record.optDouble("dip_direction_deg"); val dip = record.optDouble("dip_angle_deg")
            val slope = -tan(Math.toRadians(dip)) * cos(Math.toRadians(axis - direction))
            if (!slope.isFinite() || abs(slope) > 1e4) { contacts.put(JSONObject().put("interval_id", interval.optString("id")).put("status", "pending").put("reason", "degenerate_projection")); return@forEachIndexed }
            val x0 = anchor.getDouble("x_m"); val z0 = anchor.getDouble("z_m"); val z1 = z0 + slope * (minX - x0); val z2 = z0 + slope * (maxX - x0)
            p.line(prof(minX, z1).first, prof(minX, z1).second, prof(maxX, z2).first, prof(maxX, z2).second, red, 1.2, true)
            p.circle(prof(x0, z0).first, prof(x0, z0).second, 3.5, red, true)
            contacts.put(JSONObject().put("interval_id", interval.optString("id")).put("status", "drawn_as_estimate").put("record_id", record.optString("id")).put("slope_z_per_x", slope).put("anchor_x_m", x0).put("anchor_z_m", z0))
        }
        nodes.forEachIndexed { i, node -> val (x, y) = prof(node.getDouble("x_m"), node.getDouble("z_m")); p.circle(x, y, 3.0, dark, true); if (i == 0 || i == nodes.lastIndex) p.text(x, y - 8, "T$i", 9.0, dark, 1) }
        var y = profileBottom + 52
        p.text(margin, y, "层段目录（原层号、实测测段与岩性描述）", 14.0, dark); y += 28
        for (it in intervals) {
            val name = it.optString("lithology_name").ifBlank { "岩性待定" }; val first = byId[it.optJSONArray("record_ids")?.optString(0).orEmpty()]
            p.hatchRect(margin, y - 14, 34.0, 24.0, name)
            p.text(margin + 45, y, "${it.optString("layer_id")} · ${it.optString("id")} · $name · ${it.optString("description").ifBlank { "描述未提供" }}", 10.0, dark)
            p.text(margin + 45, y + 15, "记录 ${it.optJSONArray("record_ids")?.length() ?: 0} 条；起止节点 ${it.optInt("start_node")}–${it.optInt("end_node")}；首测段 ${first?.optString("id") ?: "未提供"}", 9.0, Color.DKGRAY)
            y += 58
        }
        y += 4; p.text(margin, y, "样品及产状（未提供位置的样品不伪造图上位置）", 13.0, dark); y += 24
        for (s in samples) {
            val pos = s.optJSONObject("position")?.takeIf { it !== JSONObject.NULL }
            if (pos != null) { val (x, py) = prof(pos.optDouble("x_m"), pos.optDouble("z_m")); p.poly(listOf(x to (py - 9), (x - 6) to (py + 3), (x + 6) to (py + 3)), Color.rgb(170, 40, 40), 1.0, true); p.text(x + 8, py - 3, s.optString("id"), 9.0, dark) }
            else p.text(margin + 4, y, "${s.optString("id")}：未定位 · 来源 ${s.optJSONObject("source_cells")?.optString("sample_offset_m") ?: "无"}", 9.0, Color.DKGRAY)
            if (pos == null) y += 14
        }
        y += 22; p.text(margin, y, "说明：红色虚线为按层段首条产状外推的视倾界面，不是实测矿界；产状缺失的层界留白。岩性图案为项目符号，不表示标准认证。", 9.0, Color.DKGRAY)
        return p to contacts
    }

    private fun drill(data: JSONObject): Triple<Plan, Plan, JSONObject> {
        val endpoint = data.optJSONObject("meta")?.optDouble("endpoint_m") ?: Double.NaN
        if (!endpoint.isFinite() || endpoint <= 0 || endpoint > 1e7) throw IllegalArgumentException("钻孔终孔深度缺失或超出安全范围")
        val full = drillPlan(data, endpoint, false); val detail = drillPlan(data, min(endpoint, 45.0), true)
        return Triple(full.first, detail.first, JSONObject().put("endpoint_m", endpoint).put("depth_scale_px_per_m", full.second).put("detail_depth_scale_px_per_m", detail.second).put("detail_limit_m", min(endpoint, 45.0)).put("layers", array(data, "layers").size).put("turns", array(data, "turns").size).put("samples", array(data, "samples").size))
    }

    private fun drillPlan(data: JSONObject, hi: Double, detail: Boolean): Pair<Plan, Double> {
        val layers = array(data, "layers").filter { it.optDouble("bottom_m", -1.0) >= 0 && it.optDouble("top_m", hi + 1) <= hi }.sortedBy { it.optDouble("top_m") }
        val turns = array(data, "turns").filter { it.optDouble("bottom_m", -1.0) >= 0 && it.optDouble("top_m", hi + 1) <= hi }.sortedBy { it.optDouble("top_m") }
        val samples = array(data, "samples").filter { it.optDouble("bottom_m", -1.0) >= 0 && it.optDouble("top_m", hi + 1) <= hi }.sortedWith(compareBy<JSONObject> { it.optDouble("top_m") }.thenBy { it.optDouble("bottom_m") }.thenBy { it.optString("id") })
        val structures = array(data, "structures").filter { it.optDouble("depth_m", -1.0) in 0.0..hi }.sortedBy { it.optDouble("depth_m") }
        val ends = mutableListOf<Double>(); val lanes = linkedMapOf<String, Int>()
        for (s in samples) { val top = s.optDouble("top_m"); val bottom = s.optDouble("bottom_m"); val lane = ends.indexOfFirst { it <= top + 1e-9 }.let { if (it < 0) ends.size else it }; if (lane == ends.size) ends += bottom else ends[lane] = bottom; lanes[s.optString("id")] = lane }
        val minScale = max(if (detail) 25.0 else 9.0, 700.0 / max(hi, 1e-9)); val scale = min(12000.0 / max(hi, 1e-9), minScale).coerceAtLeast(.001)
        val top = 96.0; val axisBottom = top + hi * scale; val labelExtra = max(100.0, (samples.size * 34).toDouble()); val requestedHeight = ceil(axisBottom + labelExtra + 150)
        if (!requestedHeight.isFinite() || requestedHeight > 12000) throw IllegalArgumentException("钻孔图超出12000像素边长上限")
        val height = requestedHeight.toInt()
        val width = 2240; val p = Plan(width, height); val c = Color.rgb(34, 40, 37); val grid = Color.rgb(210, 216, 212); val y = { d: Double -> top + d * scale }
        p.text(28.0, 32.0, "钻孔 ${data.optJSONObject("meta")?.optString("hole_id").orEmpty().ifBlank { data.optJSONObject("project")?.optString("hole_id").orEmpty() }}", 21.0, c)
        p.text(28.0, 54.0, "沿孔深线性显示 · ${if (detail) "详图 0–${f(hi)} m" else "全孔 0–${f(hi)} m"} · 比例 ${f(scale)} px/m · 纵深范围不是孔径比例", 11.0, Color.DKGRAY)
        val cols = intArrayOf(58, 102, 194, 280, 410, 520, 790, 1110, 1510, 1850, 1960, 2180)
        val labels = listOf("孔深 m", "回次", "分层", "岩性", "描述", "样长", "样品与岩心", "化验值", "孔径", "结构记录", "来源")
        labels.forEachIndexed { i, label -> p.text(cols[i].toDouble(), 76.0, label, 11.0, c) }
        p.line(28.0, 82.0, width - 28.0, 82.0, c, 1.2)
        val tick = niceStep(hi / 12.0)
        var d = 0.0
        while (d <= hi + tick * .01) { val yy = y(d); p.line(28.0, yy, width - 28.0, yy, grid.toInt(), .55); p.text(28.0, yy + 3, f(d), 9.0, c, 2); if (d <= hi) { p.line(53.0, yy, 65.0, yy, c, 1.0); } ; d += tick }
        p.line(cols[1].toDouble(), y(0.0), cols[1].toDouble(), y(hi), c, 1.0); p.line(cols[2].toDouble(), y(0.0), cols[2].toDouble(), y(hi), c, 1.0); p.line(cols[3].toDouble(), y(0.0), cols[3].toDouble(), y(hi), c, 1.0)
        val boundaries = sortedSetOf<Double>()
        layers.forEach { layer ->
            val a = max(0.0, layer.optDouble("top_m")); val b = min(hi, layer.optDouble("bottom_m")); if (b <= a) return@forEach
            p.hatchRect(cols[3].toDouble() + 2, y(a), 64.0, y(b) - y(a), layer.optString("lithology_name"))
            p.rect(cols[2].toDouble() + 2, y(a), 22.0, y(b) - y(a), Color.LTGRAY, false, .8)
            p.text(cols[2] + 28.0, y((a + b) / 2), layer.optString("id"), 9.0, c)
            p.text(cols[4] + 4.0, y((a + b) / 2) - 2, layer.optString("lithology_name").ifBlank { "岩性待定" }, 10.0, c)
            p.text(cols[4] + 4.0, y((a + b) / 2) + 13, layer.optString("description").ifBlank { "描述未提供" }.take(24), 9.0, Color.DKGRAY)
            p.text(cols[5] + 6.0, y((a + b) / 2), "${f(layer.optDouble("thickness_m"))} / ${f(layer.optDouble("core_m"))} m", 9.0, c)
            boundaries += a; boundaries += b
        }
        boundaries.forEach { p.line(cols[2].toDouble(), y(it), cols[6] + 10.0, y(it), c, .8) }
        turns.forEach { r -> val a = max(0.0, r.optDouble("top_m")); val b = min(hi, r.optDouble("bottom_m")); if (b > a) { p.rect(cols[1] + 8.0, y(a), 16.0, y(b) - y(a), Color.rgb(170, 181, 174), false, 1.0); p.text(cols[1] + 27.0, y((a + b) / 2), r.optString("id"), 8.0, c) } }
        var prevLabelBottom = y(0.0)
        samples.forEach { s ->
            val a = max(0.0, s.optDouble("top_m")); val b = min(hi, s.optDouble("bottom_m")); if (b < a) return@forEach
            val lane = lanes[s.optString("id")] ?: 0; val sx = cols[6] + lane * 14.0 + 8
            p.line(sx, y(a), sx, y(b), Color.rgb(166, 52, 45), 2.6); p.line(sx - 5, y(a), sx + 5, y(a), Color.rgb(166, 52, 45), 1.0); p.line(sx - 5, y(b), sx + 5, y(b), Color.rgb(166, 52, 45), 1.0)
            val labelY = max(y((a + b) / 2), prevLabelBottom + 22); prevLabelBottom = labelY + 18
            p.line(sx + 4, y((a + b) / 2), cols[7] - 18.0, labelY - 3, Color.GRAY, .6)
            p.text(cols[7] - 6.0, labelY, "${s.optString("id")} · ${f(a)}–${f(b)} m", 9.0, c)
            p.text(cols[7] - 6.0, labelY + 14, "岩心 ${f(s.optDouble("core_m"))} m · 采取率 ${f(s.optDouble("recovery_percent"))}%", 8.5, Color.DKGRAY)
            val assays = s.optJSONObject("assays")
            if (assays != null) p.text(cols[8] - 4.0, labelY, listOf("Au", "Pb", "Zn").joinToString("  ") { k -> "$k ${if (assays.isNull(k)) "未提供" else f(assays.optDouble(k))}" }, 8.5, c)
        }
        structures.forEach { s -> val yy = y(s.optDouble("depth_m")); p.circle(cols[9] + 12.0, yy, 4.0, Color.rgb(23, 107, 138), true); p.text(cols[9] + 24.0, yy + 3, "${f(s.optDouble("depth_m"))} m · ${f(s.optDouble("diameter_mm"))} mm", 9.0, c) }
        p.text(28.0, height - 60.0, "全孔汇总：分层 ${array(data, "layers").size} 条 · 样品 ${array(data, "samples").size} 条 · 回次 ${array(data, "turns").size} 条 · 终孔 ${f(data.optJSONObject("meta")?.optDouble("endpoint_m") ?: hi)} m", 10.0, c)
        p.text(28.0, height - 40.0, if (detail && hi < (data.optJSONObject("meta")?.optDouble("endpoint_m") ?: hi)) "本详图显示 0–45 m；窗口边缘延续不是实际层界。" else "岩性图案按项目符号映射；未知岩性留白待定，不宣称行业标准认证。", 9.0, Color.DKGRAY)
        val report = JSONObject().put("depth_scale_px_per_m", scale).put("depth_top_y", y(0.0)).put("depth_bottom_y", y(hi)).put("sample_lanes", lanes.size).put("layers", JSONArray(layers.map { it.optString("id") })).put("samples", JSONArray(samples.map { it.optString("id") }))
        return p to scale
    }

    internal fun renderPng(plan: Plan, fontFamily: String? = null): ByteArray {
        require(plan.width > 0 && plan.height > 0) { "PNG画布尺寸无效" }
        val pixelBudget = MAX_PNG_PIXELS.toLong()
        val sourcePixels = plan.width.toDouble() * plan.height
        val factor = min(2.0, min(sqrt(pixelBudget / sourcePixels), MAX_PNG_SIDE.toDouble() / max(plan.width, plan.height)))
        val w = max(1, floor(plan.width * factor).toInt()); val h = max(1, floor(plan.height * factor).toInt())
        if (w.toLong() * h > pixelBudget || max(w, h) > MAX_PNG_SIDE) throw IllegalArgumentException("PNG像素数或边长超过设备安全上限")
        val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        try {
            val canvas = Canvas(bitmap); canvas.drawColor(Color.WHITE); canvas.scale(w.toFloat() / plan.width, h.toFloat() / plan.height)
            val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND; if (fontFamily != null) typeface = Typeface.create(fontFamily, Typeface.NORMAL) }
            for (op in plan.ops) {
                paint.color = op.color; paint.strokeWidth = op.size; paint.pathEffect = if (op.dash) android.graphics.DashPathEffect(floatArrayOf(6f, 4f), 0f) else null
                when (op.kind) {
                    0 -> { paint.style = if (op.fill) Paint.Style.FILL else Paint.Style.STROKE; val r = RectF(op.x[0], op.x[1], op.x[0] + op.x[2], op.x[1] + op.x[3]); canvas.drawRect(r, paint) }
                    1 -> { paint.style = Paint.Style.STROKE; canvas.drawLine(op.x[0], op.x[1], op.x[2], op.x[3], paint) }
                    2, 3 -> { val path = Path().apply { moveTo(op.x[0], op.x[1]); for (i in 2 until op.x.size step 2) lineTo(op.x[i], op.x[i + 1]); if (op.kind == 3) close() }; paint.style = if (op.kind == 3) Paint.Style.FILL_AND_STROKE else Paint.Style.STROKE; canvas.drawPath(path, paint) }
                    4 -> { paint.style = if (op.fill) Paint.Style.FILL_AND_STROKE else Paint.Style.STROKE; canvas.drawCircle(op.x[0], op.x[1], op.x[2], paint) }
                    5 -> { paint.style = Paint.Style.FILL; paint.textSize = op.size; paint.textAlign = if (op.align == 1) Paint.Align.CENTER else if (op.align == 2) Paint.Align.RIGHT else Paint.Align.LEFT; canvas.drawText(op.text, op.x[0], op.x[1], paint) }
                    6 -> { paint.style = Paint.Style.STROKE; canvas.drawOval(RectF(op.x[0] - op.x[2], op.x[1] - op.x[3], op.x[0] + op.x[2], op.x[1] + op.x[3]), paint) }
                }
            }
            val out = LimitedPngOutputStream(MAX_PNG_BYTES)
            if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)) throw IllegalStateException("PNG编码失败")
            return out.toByteArray()
        } finally {
            bitmap.recycle()
        }
    }

    private class LimitedPngOutputStream(private val maxBytes: Int) : OutputStream() {
        private val buffer = ByteArrayOutputStream()
        override fun write(value: Int) {
            checkCapacity(1)
            buffer.write(value)
        }
        override fun write(bytes: ByteArray, offset: Int, length: Int) {
            checkCapacity(length)
            buffer.write(bytes, offset, length)
        }
        private fun checkCapacity(length: Int) {
            if (length < 0 || buffer.size() > maxBytes - length) throw IllegalArgumentException("PNG导出超过${maxBytes / 1_000_000} MB安全上限")
        }
        fun toByteArray(): ByteArray = buffer.toByteArray()
    }

    private fun array(data: JSONObject, key: String): List<JSONObject> { val a = data.optJSONArray(key) ?: JSONArray(); return (0 until a.length()).mapNotNull { a.optJSONObject(it) } }
    private fun niceStep(raw: Double): Double { if (!raw.isFinite() || raw <= 0) return 1.0; val power = 10.0.pow(floor(log10(raw))); val value = raw / power; return (if (value <= 1) 1 else if (value <= 2) 2 else if (value <= 5) 5 else 10) * power }
    private fun f(v: Double, d: Int = 2): String = if (!v.isFinite()) "未提供" else "% .${d}f".format(java.util.Locale.US, v).trim()
    private fun fmt(v: Double, d: Int) = f(v, d)
    private fun n(v: Float) = if (v.isFinite()) String.format(java.util.Locale.US, "%.3f", v).trimEnd('0').trimEnd('.') else "0"
    private fun xml(v: String) = v.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&apos;")
}
