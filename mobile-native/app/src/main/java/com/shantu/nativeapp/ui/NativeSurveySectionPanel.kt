package com.shantu.nativeapp.ui

import android.content.Context
import android.os.CancellationSignal
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.Toast
import com.shantu.nativeapp.section.NativeSurveyLine
import com.shantu.nativeapp.section.NativeSurveySectionEngine
import com.shantu.nativeapp.section.NativeSurveySheetExporter
import com.shantu.nativeapp.section.NativeSurveyStation
import com.shantu.nativeapp.section.NativeSurveyTerrain
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import kotlin.math.abs

/** A/B survey-line editor, real station projection, shared DEM sampling and atomic host save callbacks. */
class NativeSurveySectionPanel(
    private val context: Context,
    private val chrome: HomeChrome,
    initialSettings: JSONObject,
    private val sampleDem: suspend (surveyLine: JSONObject, cancellation: CancellationSignal) -> NativeSurveyTerrain,
    /** Host must commit the complete settings object transactionally and return false on failure. */
    private val onCommit: (settings: JSONObject) -> Boolean,
    /** Host must persist/share PNG bytes and return true only after that operation succeeds. */
    private val onExportImage: ((fileName: String, pngBytes: ByteArray) -> Boolean)?,
    /** Host picks actual map coordinates; role is `A`, `B`, or `station`. */
    private val onRequestMapPoint: (role: String, enabled: Boolean) -> Unit,
    private val onLocate: (longitude: Double, latitude: Double) -> Unit = { _, _ -> },
    private val onClose: () -> Unit = {},
    /** Host map-bottom chart slot; receives null when the panel is dismissed. */
    private val onShowProjection: ((View?) -> Unit)? = null,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var settings = JSONObject(initialSettings.toString())
    private var line: NativeSurveyLine? = null
    private var terrain: NativeSurveyTerrain? = null
    private var samplingJob: Job? = null
    private var exportJob: Job? = null
    private var generation = 0
    private var picking: String? = null
    private var pendingA: Pair<Double, Double>? = null
    private var status = ""
    private var closed = false
    private var chart: NativeSurveyProfileChartView? = null
    private var activeCancellation: CancellationSignal? = null

    init { restore() }
    fun open() { check(!closed); show() }

    /** Host forwards only actual map-tap WGS84 coordinates while `onRequestMapPoint` is enabled. */
    fun onMapPoint(longitude: Double, latitude: Double) {
        val role = picking ?: return
        if (closed || !longitude.isFinite() || longitude !in -180.0..180.0 || !latitude.isFinite() || abs(latitude) > 85.0) return
        when (role) {
            "A" -> { pendingA = longitude to latitude; picking = "B"; onRequestMapPoint("A", false); onRequestMapPoint("B", true); status = "A已记录，继续选择B。"; show() }
            "B" -> {
                val a = pendingA ?: line?.a ?: run { status = "请先选择A"; show(); return }
                val json = JSONObject().put("version", 1).put("a", JSONArray().put(a.first).put(a.second))
                    .put("b", JSONArray().put(longitude).put(latitude)).put("stations", JSONArray())
                    .put("interval", line?.intervalMeters ?: 50)
                    .put("halfWidth", line?.halfWidthMeters ?: 50.0)
                val next = runCatching { NativeSurveyLine.parse(json) }.getOrElse { status = it.message.orEmpty(); show(); return }
                if (commitLine(next, clearTerrain = true)) {
                    picking = null; pendingA = null; onRequestMapPoint("B", false); status = "A/B已更新；附加测站已按新测线重置。"
                }
                show()
            }
            "station" -> {
                val current = line ?: run { status = "先建立A/B测线"; show(); return }
                val projection = runCatching { current.project(longitude, latitude) }.getOrElse { status = it.message.orEmpty(); show(); return }
                val stations = current.stations.toMutableList()
                var ordinal = 2; var label = "C"
                while (stations.any { it.label == label }) { ordinal++; label = if (ordinal < 26) ('A'.code + ordinal).toChar().toString() else "P${ordinal + 1}" }
                stations += NativeSurveyStation(UUID.randomUUID().toString(), label, projection.distanceMeters)
                val next = NativeSurveyLine.parse(JSONObject(current.sourceJson.toString()).put("stations", JSONArray().also { out -> stations.forEach { out.put(JSONObject().put("id", it.id).put("label", it.label).put("distance", it.distanceMeters)) } }))
                if (commitLine(next, clearTerrain = true)) status = "测站${label}已按A→B基线投影，偏距${String.format(java.util.Locale.ROOT, "%.1f", projection.offsetMeters)}米；地形缓存已失效。"
                picking = null; onRequestMapPoint("station", false); show()
            }
        }
    }

    fun cancelPicking() { picking?.let { onRequestMapPoint(it, false) }; picking = null; pendingA = null; status = "已取消地图选点。"; show() }
    fun dispose() { if (closed) return; closed = true; picking?.let { onRequestMapPoint(it, false) }; activeCancellation?.cancel(); samplingJob?.cancel(); exportJob?.cancel(); onShowProjection?.invoke(null); scope.cancel(); chart = null }

    private fun restore() {
        val raw = settings.optJSONObject("survey") ?: return
        runCatching { NativeSurveyLine.parse(raw) }.onSuccess { parsed ->
            line = parsed
            settings.optJSONObject("surveyTerrain")?.let { cache -> terrain = runCatching { NativeSurveyTerrain.parse(parsed, cache) }.getOrNull() }
        }.onFailure { status = "勘探线数据无效：${it.message}" }
    }

    private fun show() {
        if (closed) return
        chart = null
        chrome.showPanelWithSlots("native-survey-section", "勘探测线 / 投影剖面", width = 300, maxHeightDp = 200,
            fixedHeader = { addView(chrome.text("A→B真北方位、沿线里程、偏距投影和DEM剖面", 11)) },
            fixedFooter = { addView(chrome.row("关闭勘探剖面") { dispose(); onClose(); chrome.closePanel() }) }) {
            val current = line
            if (current == null) {
                addView(chrome.text("先在地图上选A、B，生成与旧SurveyLine v1兼容的勘探线。", 11))
                addView(chrome.row(if (picking == "A") "正在地图选择A…" else "地图选择A") { beginAB() })
            } else {
                val range = current.range()
                addView(chrome.text("方位 ${String.format(java.util.Locale.ROOT, "%.2f°", NativeSurveySectionEngine.bearingDegrees(current))} · AB ${fmt(current.lengthMeters())} m · 里程 ${fmt(range.first)}–${fmt(range.second)} m · 带宽 ±${fmt(current.halfWidthMeters)} m", 10))
                addView(chrome.row("重选A/B（附加测站将重置）") { beginAB() })
                addView(chrome.row("设置等高距 / 平面带宽") { editSamplingSettings(current) })
                addView(chrome.row(if (picking == "station") "正在地图投影测站…" else "地图添加测站") {
                    picking = "station"; onRequestMapPoint("station", true); status = "地图选点将投影到真实A→B轴，偏距显示并不改变里程。"; show()
                })
                if (picking != null) addView(chrome.row("取消选点") { cancelPicking() })
                current.orderedStations().forEach { station ->
                    val coordinate = current.coordinate(station.distanceMeters); val elevation = terrain?.heightAt(station.distanceMeters)
                    val suffix = "${station.label} · 里程 ${fmt(station.distanceMeters)} m · 高程 ${elevation?.let { fmt(it) + " m" } ?: "—"}"
                    val row = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
                    row.addView(chrome.row(suffix) { onLocate(coordinate.first, coordinate.second) }, LinearLayout.LayoutParams(0, chrome.dp(30), 1f))
                    if (station.id != "A" && station.id != "B") row.addView(chrome.row("删") { removeStation(station.id) }, LinearLayout.LayoutParams(chrome.dp(40), chrome.dp(30)))
                    addView(row)
                }
                val loaded = terrain
                if (loaded != null) {
                    val view = NativeSurveyProfileChartView(context).apply { bind(current, loaded) }; chart = view
                    onShowProjection?.invoke(view)
                    if(onShowProjection==null) {
                        addView(view, LinearLayout.LayoutParams(-1, chrome.dp(72)))
                        addView(chrome.text("${loaded.source} · ${loaded.heightsMeters.count { it == null }}格缺测；缺值断开。", 10).apply { setTextColor(ShantuColors.muted) })
                    }
                } else addView(chrome.text("${current.sourceJson.optJSONObject("info")?.optString("title") ?: "勘探线剖面"} · 尚无有效采样网格", 10))
                addView(chrome.row(if (samplingJob == null) "读取真实DEM并更新剖面" else "取消DEM采样") {
                    if (samplingJob != null) cancelSampling() else startSampling(current)
                })
                if (loaded != null) addView(chrome.row(if (exportJob == null) "导出剖面 + 测站投影 PNG" else "取消PNG导出") {
                    if (exportJob == null) exportImage(current, loaded) else cancelImageExport()
                })
            }
            if (status.isNotBlank()) addView(chrome.text(status, 10).apply { setTextColor(ShantuColors.muted) })
            if (samplingJob != null) addView(chrome.text("DEM采样进行中；关闭或取消会终止任务，不保存半张网格。", 10))
        }
    }

    private fun beginAB() {
        if (samplingJob != null) cancelSampling()
        if (exportJob != null) cancelImageExport()
        pendingA = null; picking = "A"; onRequestMapPoint("A", true); status = "先选A；随后选B。"; show()
    }

    private fun commitLine(next: NativeSurveyLine, clearTerrain: Boolean): Boolean {
        if (clearTerrain && samplingJob != null) cancelSampling()
        if (exportJob != null) cancelImageExport()
        val replacement = JSONObject(settings.toString()).put("survey", JSONObject(next.sourceJson.toString()))
        val retainedTerrain = if (clearTerrain) terrain?.takeIf { NativeSurveySectionEngine.key(it.line) == NativeSurveySectionEngine.key(next) }
            ?.let { runCatching { NativeSurveyTerrain.parse(next, it.toJson()) }.getOrNull() } else terrain
        if (clearTerrain && retainedTerrain == null) { replacement.remove("surveyTerrain"); onShowProjection?.invoke(null) }
        else retainedTerrain?.let { replacement.put("surveyTerrain", it.toJson()) }
        val saved = runCatching { onCommit(replacement) }.getOrDefault(false)
        if (saved) { settings = replacement; line = next; if (clearTerrain) terrain = retainedTerrain; chart?.invalidate() }
        else status = "保存未确认，原勘探线与高程数据保持不变。"
        return saved
    }

    private fun removeStation(id: String) {
        val current = line ?: return
        val list = current.stations.filterNot { it.id == id }
        val raw = JSONObject(current.sourceJson.toString()).put("stations", JSONArray().also { out -> list.forEach { out.put(JSONObject().put("id", it.id).put("label", it.label).put("distance", it.distanceMeters)) } })
        runCatching { NativeSurveyLine.parse(raw) }.onSuccess { commitLine(it, clearTerrain = true); show() }.onFailure { status = it.message.orEmpty(); show() }
    }

    private fun startSampling(current: NativeSurveyLine) {
        if (exportJob != null) cancelImageExport()
        if (samplingJob != null) cancelSampling()
        val task = ++generation; val signal = CancellationSignal(); activeCancellation = signal
        status = "正在真实采样257×49 DEM网格…"; show()
        samplingJob = scope.launch {
            val result = runCatching { withContext(Dispatchers.Default) { sampleDem(JSONObject(current.sourceJson.toString()), signal) } }
            if (closed || generation != task || !isActive) return@launch
            samplingJob = null; activeCancellation = null
            result.fold({ sampled ->
                val replacement = JSONObject(settings.toString()).put("surveyTerrain", sampled.toJson())
                if (runCatching { onCommit(replacement) }.getOrDefault(false)) { settings = replacement; terrain = sampled; status = "实际DEM网格已保存，可导出PNG。" }
                else status = "DEM已计算，但原子保存未确认；当前页面保留数据，未冒充已保存。"
            }, { error -> status = if (error is CancellationException || signal.isCanceled) "采样已取消，未保存部分结果。" else "采样失败：${error.message ?: "DEM不可用"}" })
            show()
        }
    }

    private fun cancelSampling() { generation++; activeCancellation?.cancel(); activeCancellation = null; samplingJob?.cancel(); samplingJob = null; status = "采样已取消；部分网格不写入存储。"; show() }

    private fun cancelImageExport() { generation++; activeCancellation?.cancel(); activeCancellation = null; exportJob?.cancel(); exportJob = null; status = "PNG绘制已取消；原勘探与DEM数据保持不变。"; show() }

    private fun editSamplingSettings(current: NativeSurveyLine) {
        val interval = chrome.input("等高距（米）· 1/2/5/10/20/25/50/100/200/500").apply { setText(current.intervalMeters.toString()) }
        val width = chrome.input("平面半宽（米）· 0.1–10000").apply { setText(current.halfWidthMeters.toString()) }
        val form = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; setPadding(chrome.dp(10), 0, chrome.dp(10), 0); addView(interval); addView(width) }
        val dialog = android.app.AlertDialog.Builder(context).setTitle("勘探测线参数").setView(form).setNegativeButton("取消", null).setPositiveButton("应用", null).create()
        dialog.setOnShowListener {
            dialog.getButton(android.app.AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val i = interval.text.toString().toIntOrNull(); val w = width.text.toString().toDoubleOrNull()
                val validIntervals = setOf(1, 2, 5, 10, 20, 25, 50, 100, 200, 500)
                if (i == null || i !in validIntervals || w == null || !w.isFinite() || w !in .1..10_000.0) { width.error = "等高距或带宽无效"; return@setOnClickListener }
                val raw = JSONObject(current.sourceJson.toString()).put("interval", i).put("halfWidth", w)
                runCatching { NativeSurveyLine.parse(raw) }.onSuccess { next ->
                    if (commitLine(next, clearTerrain = true)) { dialog.dismiss(); status = "参数已保存；需重新读取DEM。"; show() }
                }.onFailure { width.error = it.message }
            }
        }
        dialog.show()
    }

    private fun exportImage(current: NativeSurveyLine, sampled: NativeSurveyTerrain) {
        if (samplingJob != null) cancelSampling()
        if (exportJob != null) cancelImageExport()
        val callback = onExportImage ?: run { status = "系统文件/分享导出回调尚未接入，剖面数据未改变。"; show(); return }
        val task = ++generation; val cancel = CancellationSignal(); activeCancellation = cancel; status = "正在绘制真实DEM剖面PNG…"; show()
        exportJob = scope.launch {
            val result = runCatching { withContext(Dispatchers.Default) { NativeSurveySheetExporter.pngBytes(current, sampled, cancel) } }
            if (closed || generation != task || !isActive) return@launch
            activeCancellation = null
            exportJob = null
            result.fold({ bytes ->
                status = runCatching { if (callback("勘探剖面.png", bytes)) "PNG已交给系统保存。" else "系统保存未确认；勘探数据保持不变。" }
                    .getOrElse { "系统保存失败：${it.message ?: "文件写入错误"}" }
            }, { status = it.message ?: "PNG绘制失败" })
            show()
        }
    }

    private fun fmt(value: Double) = String.format(java.util.Locale.ROOT, "%.1f", value)
}

private class NativeSurveyProfileChartView(context: Context) : View(context) {
    private val linePaint = android.graphics.Paint(3).apply { color = 0xffd0f76b.toInt(); strokeWidth = 2.3f; style = android.graphics.Paint.Style.STROKE }
    private val grid = android.graphics.Paint(3).apply { color = 0xff89918d.toInt(); alpha = 110; strokeWidth = 1f }
    private val text = android.graphics.Paint(3).apply { color = 0xfff2f5ed.toInt(); textSize = 10f }
    private val point = android.graphics.Paint(3).apply { color = 0xffffb477.toInt() }
    private var line: NativeSurveyLine? = null; private var terrain: NativeSurveyTerrain? = null
    fun bind(line: NativeSurveyLine, terrain: NativeSurveyTerrain) { this.line = line; this.terrain = terrain; invalidate() }
    override fun onDraw(canvas: android.graphics.Canvas) {
        val l = line ?: return; val d = terrain ?: return
        val left = 42f; val right = width - 8f; val top = 10f; val bottom = height - 24f
        canvas.drawLine(left, top, left, bottom, grid); canvas.drawLine(left, bottom, right, bottom, grid)
        val row = d.rows / 2 * d.columns; val values = (0 until d.columns).map { d.heightsMeters[row + it] }.filterNotNull()
        if (values.isEmpty()) { canvas.drawText("无有效高程", left, height / 2f, text); return }
        val min = values.minOrNull()!!; val max = values.maxOrNull()!!; val span = (max - min).coerceAtLeast(1.0)
        val distance = d.endMeters - d.startMeters
        val path = android.graphics.Path(); var open = false
        for (i in 0 until d.columns) {
            val h = d.heightsMeters[row + i]
            if (h == null) { open = false; continue }
            val x = left + ((right - left) * i / (d.columns - 1)); val y = bottom - ((h - min) / span * (bottom - top)).toFloat()
            if (!open) path.moveTo(x, y) else path.lineTo(x, y)
            open = true
        }
        canvas.drawPath(path, linePaint); canvas.drawText("${min.toInt()}–${max.toInt()}m", 2f, top + 10f, text)
        l.orderedStations().forEach { station ->
            val h = d.heightAt(station.distanceMeters) ?: return@forEach
            val x = left + ((right - left) * ((station.distanceMeters - d.startMeters) / distance)).toFloat()
            val y = bottom - ((h - min) / span * (bottom - top)).toFloat()
            canvas.drawLine(x, y, x, bottom, grid); canvas.drawCircle(x, y, 3f, point); canvas.drawText(station.label, x - 6f, y - 6f, text)
        }
        canvas.drawText("沿线距离 ${String.format(java.util.Locale.ROOT, "%.1f km", distance / 1000)} · 缺测留空", left, height - 4f, text)
    }
}
