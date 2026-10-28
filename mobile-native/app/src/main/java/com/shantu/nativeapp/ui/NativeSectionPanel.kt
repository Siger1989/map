package com.shantu.nativeapp.ui

import android.app.AlertDialog
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.os.Handler
import android.os.Looper
import android.os.CancellationSignal
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.SeekBar
import android.widget.TextView
import android.widget.Toast
import com.shantu.nativeapp.section.NativeSectionCurve
import com.shantu.nativeapp.section.NativeSectionSettings
import com.shantu.nativeapp.section.NativeSectionSnapshot
import com.shantu.nativeapp.section.NativeSectionProfilePngExporter
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

/** Callback-driven ordinary 3D section editor/profile. Persistence remains host-owned and atomic. */
internal class NativeSectionPanel(
    private val context: Context,
    private val chrome: HomeChrome,
    initialSections: JSONArray,
    initialNotes: JSONArray,
    initialSettings: JSONObject,
    private val sample: suspend (JSONObject) -> NativeSectionSnapshot,
    private val onCommit: (sections: JSONArray, sectionNotes: JSONArray) -> Unit,
    private val onShowSurface: (NativeSectionSnapshot, notes: JSONArray) -> Unit,
    private val onExport: (profile: JSONObject, notes: JSONArray) -> Unit,
    private val onClose: () -> Unit,
    /** Host atomically saves/shares PNG bytes and returns true only after success. */
    private val onExportImage: ((fileName: String, pngBytes: ByteArray) -> Boolean)? = null,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val sections = JSONArray(initialSections.toString())
    private var savedNotes = JSONArray(initialNotes.toString())
    private var settings = JSONObject(initialSettings.toString())
    private var selectedId: String? = null
    private var snapshot: NativeSectionSnapshot? = null
    private var selectedCurve = 0
    private var selectedPoint = 0
    private var samplingJob: Job? = null
    private var chart: SectionChart? = null
    private var status: TextView? = null
    private var closed = false
    private var exportJob: Job? = null
    private var exportCancellation: CancellationSignal? = null

    fun open() = showList()

    fun dispose() {
        finishClose(closeChrome = false, notifyHost = false)
    }

    private fun showList() {
        cancelSampling()
        chrome.showPanelWithSlots(
            id = "native-section", title = "三维剖面", width = 320, maxHeightDp = 480,
            fixedHeader = {
                val heading = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
                heading.addView(chrome.text("三维剖面", 14), LinearLayout.LayoutParams(0, chrome.dp(36), 1f))
                heading.addView(chrome.textButton("×", 18) { close() }.apply { setTextColor(ShantuColors.close) }, LinearLayout.LayoutParams(chrome.dp(36), chrome.dp(36)))
                addView(heading)
                addView(chrome.row("新建当前视域剖面") {
                    settings = JSONObject(this@NativeSectionPanel.settings.toString())
                    selectedId = null; snapshot = null; selectedCurve = 0; selectedPoint = 0
                    editSettings()
                })
            },
            fixedFooter = {
                addView(chrome.row("关闭剖面") { close() })
            },
        ) {
            watchPanelLifecycle(this)
            if (sections.length() == 0) addView(chrome.text("保存的剖面会保留完整平面参数，可随时重开重采样。", 11))
            for (i in 0 until sections.length()) {
                val item = sections.optJSONObject(i) ?: continue
                val id = item.optString("id")
                addView(chrome.row("${item.optString("name", "未命名剖面")} · 重开") {
                    selectedId = id
                    settings = JSONObject(item.optJSONObject("settings")?.toString() ?: "{}")
                    snapshot = null; selectedCurve = 0; selectedPoint = 0
                    editSettings()
                })
                addView(chrome.text("${planeSummary(item.optJSONObject("settings"))}", 10))
            }
            val current = snapshot
            if (current != null) {
                addView(chrome.row("返回当前剖面") { showProfile() })
                addView(chrome.row("重采样当前地形和模型") { resample() })
            }
            if (sections.length() > 0) addView(chrome.row("导出当前快照…") { export() })
        }
    }

    private fun editSettings() {
        cancelSampling()
        val plane = settings.optJSONObject("plane") ?: JSONObject()
        val center = plane.optJSONArray("center") ?: JSONArray().put(0.0).put(0.0)
        val fields = listOf(
            "经度" to center.optDouble(0, Double.NaN), "纬度" to center.optDouble(1, Double.NaN),
            "宽度（米）" to plane.optDouble("width", Double.NaN), "高度（米）" to plane.optDouble("height", Double.NaN),
            "方位角（度）" to plane.optDouble("heading", Double.NaN), "倾角（度）" to plane.optDouble("tilt", Double.NaN),
            "滚转（度）" to plane.optDouble("roll", 0.0), "剖面高度（米）" to settings.optDouble("altitude", Double.NaN),
        )
        val colorInput = chrome.input("剖面颜色 #RRGGBB").apply { setText(settings.optString("color", "#9de8c4")) }
        val scaleInput = chrome.input("等高距（米）或 auto").apply {
            val scale = settings.optJSONObject("scale")
            setText(if (scale == null || scale.optString("interval") == "auto") "auto" else scale.optDouble("interval").toString())
        }
        chrome.showPanel("native-section-edit", "剖面参数 · WGS84", topAligned = true, width = 320) {
            watchPanelLifecycle(this)
            addView(chrome.text("普通三维剖面；宽高范围 0.1–200000 米。缺少高程的位置保留为空隙。", 11))
            val inputs = fields.map { (label, value) ->
                addView(chrome.text(label, 11))
                chrome.input(label).apply {
                    inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL or InputType.TYPE_NUMBER_FLAG_SIGNED
                    setText(if (value.isFinite()) value.toString() else "")
                    addView(this)
                }
            }
            addView(chrome.text("颜色与等高距", 11)); addView(colorInput); addView(scaleInput)
            addView(chrome.row("应用参数并显示三维剖面") {
                val values = inputs.map { it.text.toString().trim().toDoubleOrNull() }
                if (values.any { it == null || !it.isFinite() }) { toast("请填写有效数字"); return@row }
                val v = values.map { it!! }
                val next = JSONObject(settings.toString())
                val nextPlane = JSONObject(plane.toString())
                    .put("center", JSONArray().put(v[0]).put(v[1]))
                    .put("width", v[2]).put("height", v[3])
                    .put("heading", v[4]).put("tilt", v[5]).put("roll", v[6])
                val scaleText = scaleInput.text.toString().trim()
                val scale = if (scaleText.equals("auto", true)) JSONObject().put("unit", "m").put("interval", "auto") else {
                    val interval = scaleText.toDoubleOrNull()
                    if (interval == null || !interval.isFinite() || interval !in .0001..200000.0) { toast("等高距必须为 auto 或 0.0001–200000 米"); return@row }
                    JSONObject().put("unit", "m").put("interval", interval)
                }
                next.put("plane", nextPlane).put("altitude", v[7]).put("enabled", true)
                    .put("color", colorInput.text.toString().trim()).put("scale", scale)
                runCatching { NativeSectionSettings.parse(next) }.onFailure { toast(it.message ?: "剖面参数无效") }
                    .onSuccess {
                        settings = next
                        snapshot = null; selectedCurve = 0; selectedPoint = 0
                        chrome.closePanel()
                        onShowSurface(emptySnapshotForPlane(next), notesFor(settings))
                        showProfile()
                        resample()
                    }
            })
            addView(chrome.row("返回剖面列表") { showList() })
        }
    }

    private fun emptySnapshotForPlane(value: JSONObject) = NativeSectionSnapshot(
        JSONObject(value.toString()), emptyList(), System.currentTimeMillis(), 0, 0, 0.0,
        0, 0, "idle", emptySet(),
    )

    private fun resample() {
        samplingJob?.cancel()
        val input = JSONObject(settings.toString())
        status?.text = "正在读取真实高程…"
        samplingJob = scope.launch {
            try {
                val result = withContext(Dispatchers.Default) { sample(input) }
                if (!isPanelActive()) return@launch
                snapshot = result
                selectedCurve = selectedCurve.coerceIn(0, (result.curves.size - 1).coerceAtLeast(0))
                selectedPoint = 0
                onShowSurface(result, notesFor(input))
                showProfile()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                if (!isPanelActive()) return@launch
                status?.text = "采样失败：${error.message ?: "请检查高程覆盖"}"
                toast(status?.text.toString())
            }
        }
        showProfile("正在读取真实高程…")
    }

    private fun showProfile(message: String? = null) {
        val result = snapshot
        chrome.showPanelWithSlots(
            id = "native-section-profile", title = "三维剖面曲线", width = 320, maxHeightDp = 480,
            fixedHeader = {
                val heading = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
                heading.addView(chrome.text("三维剖面曲线", 14), LinearLayout.LayoutParams(0, chrome.dp(36), 1f))
                heading.addView(chrome.textButton("×", 18) { close() }.apply { setTextColor(ShantuColors.close) }, LinearLayout.LayoutParams(chrome.dp(36), chrome.dp(36)))
                addView(heading)
                addView(chrome.row("编辑参数") { editSettings() })
            },
            fixedFooter = {
                addView(chrome.row("重采样") { resample() })
                addView(chrome.row("返回剖面列表") { showList() })
            },
        ) {
            watchPanelLifecycle(this)
            val state = chrome.text(message ?: if (result == null) "尚未采样；按重采样读取覆盖内真实DEM。" else
                "${if (result.phase == "ready") "覆盖完整" else "部分覆盖"} · 有效 ${result.validTerrainSamples}/${result.samples} · 模型 ${result.intersectingModels}", 11)
            status = state; addView(state)
            if (result == null) return@showPanelWithSlots
            if (result.curves.isEmpty()) addView(chrome.text("当前地形没有有效交线，或采样范围内高程缺失。", 11))
            result.curves.forEachIndexed { index, curve ->
                addView(chrome.row("${if (index == selectedCurve) "● " else ""}${curve.name} · ${curve.source} · ${curve.points.size}点") {
                    selectedCurve = index; selectedPoint = 0; showProfile()
                })
            }
            val curve = result.curves.getOrNull(selectedCurve)
            if (curve != null) {
                addView(SectionChart(context).also { chart = it; it.bind(curve, selectedPoint) }, LinearLayout.LayoutParams(-1, chrome.dp(164)))
                addView(chrome.text("${curve.lengthMeters.formatMeters()} · 高程 ${curve.minAltitudeMeters.formatMeters()}–${curve.maxAltitudeMeters.formatMeters()}", 11))
                addView(chrome.row(if (exportJob == null) "导出当前曲线 PNG" else "取消剖面PNG导出") {
                    if (exportJob == null) exportCurve(curve) else cancelImageExport()
                })
                val pointSummary = chrome.text(pointDescription(curve, selectedPoint), 10)
                pointSummary.minHeight = chrome.dp(28)
                val seeker = SeekBar(context).apply {
                    max = (curve.points.size - 1).coerceAtLeast(0)
                    progress = selectedPoint.coerceIn(0, max)
                    setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                        override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
                            if (fromUser) {
                                selectedPoint = progress
                                chart?.setSelectedPoint(progress)
                                pointSummary.text = pointDescription(curve, progress)
                            }
                        }
                        override fun onStartTrackingTouch(seekBar: SeekBar?) = Unit
                        override fun onStopTrackingTouch(seekBar: SeekBar?) = Unit
                    })
                }
                addView(chrome.text("测点 ${selectedPoint + 1}/${curve.points.size}", 11)); addView(seeker)
                addView(pointSummary)
                val point = curve.points.getOrNull(selectedPoint)
                if (point != null) {
                    addView(chrome.row("添加 / 编辑此测点字段") { editPointNote(curve, selectedPoint) })
                }
                val notes = notesFor(settings)
                for (i in 0 until notes.length()) {
                    val note = notes.optJSONObject(i) ?: continue
                    addView(chrome.row("测点：${note.optString("name", "未命名")} · ${note.optString("curveName")}") { editExistingNote(i) })
                }
            }
            addView(chrome.row("保存剖面设置") { saveSection() })
            addView(chrome.row("导出剖面数据") { export() })
        }
    }

    private fun editPointNote(curve: NativeSectionCurve, pointIndex: Int) {
        val point = curve.points.getOrNull(pointIndex) ?: return
        val priorIndex = notesFor(settings).let { list -> (0 until list.length()).firstOrNull { i ->
            val n = list.optJSONObject(i) ?: return@firstOrNull false
            n.optString("curveName") == curve.name && n.optString("source") == curve.source &&
                kotlin.math.abs(n.optJSONObject("point")?.optDouble("distance", Double.NaN)?.minus(point.distanceMeters) ?: Double.POSITIVE_INFINITY) < .5
        } }
        editNote(priorIndex?.let { notesFor(settings).optJSONObject(it) }, curve, pointIndex)
    }

    private fun editExistingNote(index: Int) {
        val note = notesFor(settings).optJSONObject(index) ?: return
        val resultCurve = snapshot?.curves?.firstOrNull { it.name == note.optString("curveName") && it.source == note.optString("source") }
        val point = note.optJSONObject("point")
        val target = resultCurve?.let { curve -> curve.points.indices.minByOrNull { i ->
            kotlin.math.abs(curve.points[i].distanceMeters - (point?.optDouble("distance") ?: 0.0))
        } }
        if (resultCurve == null || target == null) { editNote(note, null, null); return }
        editNote(note, resultCurve, target)
    }

    private fun editNote(existing: JSONObject?, curve: NativeSectionCurve?, pointIndex: Int?) {
        val titleInput = chrome.input("测点名称").apply { setText(existing?.optString("name")?.takeIf(String::isNotBlank) ?: "测点") }
        val noteInput = EditText(context).apply {
            hint = "说明"; textSize = 14f; setTextColor(ShantuColors.ink); setHintTextColor(ShantuColors.muted)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE
            setText(existing?.optString("note", "") ?: ""); minLines = 2; gravity = Gravity.TOP
            background = chrome.surface(HomeChromeMetrics.CONTROL_RADIUS_DP, ShantuColors.raised)
            setPadding(chrome.dp(8), chrome.dp(6), chrome.dp(8), chrome.dp(6))
        }
        val fieldInputs = mutableListOf<Triple<EditText, EditText, EditText>>()
        val fieldBox = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
        val savedFields = existing?.optJSONArray("fields") ?: JSONArray()
        fun addField(name: String = "", value: String = "", unit: String = "") {
            val row = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
            val nameEdit = chrome.input("字段").apply { setText(name); textSize = 13f }
            val valueEdit = chrome.input("值").apply { setText(value); textSize = 13f }
            val unitEdit = chrome.input("单位").apply { setText(unit); textSize = 13f }
            row.addView(nameEdit, LinearLayout.LayoutParams(0, chrome.dp(32), 1f)); row.addView(valueEdit, LinearLayout.LayoutParams(0, chrome.dp(32), 1f)); row.addView(unitEdit, LinearLayout.LayoutParams(0, chrome.dp(32), .7f))
            fieldInputs += Triple(nameEdit, valueEdit, unitEdit); fieldBox.addView(row)
        }
        for (i in 0 until savedFields.length()) savedFields.optJSONObject(i)?.let { addField(it.optString("name"), it.optString("value"), it.optString("unit")) }
        val content = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; setPadding(chrome.dp(8), 0, chrome.dp(8), 0) }
        content.addView(titleInput); content.addView(noteInput); content.addView(fieldBox)
        content.addView(chrome.row("增加测点字段") { addField(); (fieldBox.getChildAt(fieldBox.childCount - 1) as? LinearLayout)?.let { fieldBox.removeView(it); fieldBox.addView(it) } })
        AlertDialog.Builder(context).setTitle("测点字段").setView(content).setNegativeButton("取消", null).setPositiveButton("保存", null).create().also { dialog ->
            dialog.setOnShowListener {
                dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                    val name = titleInput.text.toString().trim(); val noteText = noteInput.text.toString()
                    if (name.isEmpty() || name.length > 80 || noteText.length > 1000) { toast("测点名称或说明长度无效"); return@setOnClickListener }
                    val fields = JSONArray()
                    fieldInputs.forEach { (fieldName, fieldValue, unit) ->
                        val n = fieldName.text.toString().trim(); val v = fieldValue.text.toString().trim(); val u = unit.text.toString().trim()
                        if (n.isNotEmpty() || v.isNotEmpty() || u.isNotEmpty()) {
                            if (n.length > 80 || v.length > 500 || u.length > 40) { toast("字段超出允许长度"); return@setOnClickListener }
                            fields.put(JSONObject().put("name", n).put("value", v).put("unit", u))
                        }
                    }
                    val base = existing?.let { JSONObject(it.toString()) } ?: JSONObject()
                    val targetCurve = curve
                    val targetPoint = pointIndex?.let { targetCurve?.points?.getOrNull(it) }
                    if (targetCurve != null && targetPoint != null) {
                        val id = base.optString("id").ifBlank { UUID.randomUUID().toString() }
                        val point = targetPoint.toJson(includeDistance = true)
                        base.put("point", point).put("curveName", targetCurve.name).put("source", targetCurve.source).put("sampledAt", System.currentTimeMillis())
                            .put("id", id).put("fraction", if (targetCurve.lengthMeters > 0.0) targetPoint.distanceMeters / targetCurve.lengthMeters else 0.0)
                    } else if (!base.has("point") || !base.has("curveName") || !base.has("source")) {
                        toast("需先采样并选择曲线测点"); return@setOnClickListener
                    }
                    base.put("name", name).put("note", noteText).put("fields", fields)
                    val notes = notesFor(settings)
                    val replace = existing?.optString("id")?.let { wanted -> (0 until notes.length()).firstOrNull { notes.optJSONObject(it)?.optString("id") == wanted } }
                    if (replace == null) notes.put(base) else notes.put(replace, base)
                    saveNotes(settings, notes)
                    dialog.dismiss(); showProfile()
                }
            }
        }.show()
    }

    private fun saveSection() {
        val parsed = runCatching { NativeSectionSettings.parse(settings) }.getOrElse { toast(it.message ?: "剖面设置无效"); return }
        val nameInput = chrome.input("剖面名称").apply {
            val existing = (0 until sections.length()).mapNotNull { sections.optJSONObject(it) }.firstOrNull { it.optString("id") == selectedId }
            setText(existing?.optString("name")?.takeIf(String::isNotBlank) ?: "三维剖面")
        }
        AlertDialog.Builder(context).setTitle("保存剖面").setView(nameInput).setNegativeButton("取消", null).setPositiveButton("保存", null).create().also { dialog ->
            dialog.setOnShowListener {
                dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                    val name = nameInput.text.toString().trim()
                    if (name.isEmpty() || name.length > 80) { nameInput.error = "请输入不超过80字的名称"; return@setOnClickListener }
                    val existingIndex = (0 until sections.length()).firstOrNull { sections.optJSONObject(it)?.optString("id") == selectedId }
                    if (existingIndex == null && sections.length() >= 20) { toast("最多保存20个剖面，请先整理已有项目"); return@setOnClickListener }
                    val item = existingIndex?.let { sections.optJSONObject(it)?.let { JSONObject(it.toString()) } } ?: JSONObject().put("id", selectedId ?: UUID.randomUUID().toString())
                    item.put("name", name).put("settings", JSONObject(parsed.json.toString())).put("updatedAt", System.currentTimeMillis())
                    if (existingIndex == null) sections.put(item) else sections.put(existingIndex, item)
                    selectedId = item.optString("id")
                    if (commit()) { dialog.dismiss(); toast("剖面已保存"); showProfile() }
                }
            }
        }.show()
    }

    private fun saveNotes(forSettings: JSONObject, notes: JSONArray) {
        val key = sectionKey(forSettings)
        val replacement = JSONArray()
        var replaced = false
        for (i in 0 until savedNotes.length()) {
            val row = savedNotes.optJSONObject(i) ?: continue
            if (sectionKey(row.optJSONObject("settings") ?: JSONObject()) == key) {
                if (!replaced && notes.length() > 0) replacement.put(JSONObject().put("settings", JSONObject(forSettings.toString())).put("notes", JSONArray(notes.toString())).put("savedAt", System.currentTimeMillis()))
                replaced = true
            } else replacement.put(JSONObject(row.toString()))
        }
        if (!replaced && notes.length() > 0) replacement.put(JSONObject().put("settings", JSONObject(forSettings.toString())).put("notes", JSONArray(notes.toString())).put("savedAt", System.currentTimeMillis()))
        savedNotes = replacement
        if (commit()) toast("测点已保存")
    }

    private fun notesFor(forSettings: JSONObject): JSONArray {
        val key = sectionKey(forSettings)
        for (i in 0 until savedNotes.length()) {
            val row = savedNotes.optJSONObject(i) ?: continue
            if (sectionKey(row.optJSONObject("settings") ?: JSONObject()) == key) return JSONArray(row.optJSONArray("notes")?.toString() ?: "[]")
        }
        return JSONArray()
    }

    private fun commit(): Boolean = try {
        onCommit(JSONArray(sections.toString()), JSONArray(savedNotes.toString())); true
    } catch (error: Exception) {
        toast("保存未完成，草稿仍保留：${error.message ?: "存储失败"}"); false
    }

    private fun export() {
        val value = snapshot?.toProfileJson() ?: run { toast("请先完成真实高程采样"); return }
        try { onExport(value, notesFor(settings)) } catch (error: Exception) { toast("导出失败：${error.message ?: "无法写入"}") }
    }

    private fun exportCurve(curve: NativeSectionCurve) {
        val callback = onExportImage ?: run { toast("尚未接入系统文件/分享PNG回调；原剖面数据保持不变"); return }
        val signal = CancellationSignal(); exportCancellation = signal
        status?.text = "正在绘制当前实际剖面PNG…"
        exportJob = scope.launch {
            val result = runCatching { withContext(Dispatchers.Default) { NativeSectionProfilePngExporter.pngBytes(curve, settings.optJSONObject("plane")?.optString("name") ?: "三维剖面", signal) } }
            if (closed || !isActive) return@launch
            exportJob = null; exportCancellation = null
            result.fold({ bytes ->
                val saved = runCatching { callback("三维剖面.png", bytes) }.getOrDefault(false)
                toast(if (saved) "PNG已交给系统保存" else "系统保存未确认；剖面数据保持不变")
            }, { error -> toast("图片生成失败：${error.message ?: "请重试"}") })
            showProfile()
        }
        showProfile()
    }

    private fun cancelImageExport() {
        exportCancellation?.cancel(); exportCancellation = null
        exportJob?.cancel(); exportJob = null
        toast("图片导出已取消；剖面数据保持不变")
        showProfile()
    }

    private fun close() {
        finishClose(closeChrome = true, notifyHost = true)
    }

    /** Android Back and host-driven chrome.closePanel() also detach this content without using our close button. */
    private fun watchPanelLifecycle(root: View) {
        root.addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
            override fun onViewAttachedToWindow(view: View) = Unit
            override fun onViewDetachedFromWindow(view: View) {
                Handler(Looper.getMainLooper()).post {
                    if (!closed && chrome.currentPanel()?.startsWith("native-section") != true) {
                        finishClose(closeChrome = false, notifyHost = true)
                    }
                }
            }
        })
    }

    private fun isPanelActive() = !closed && chrome.currentPanel() == "native-section-profile"

    private fun cancelSampling() {
        samplingJob?.cancel()
        samplingJob = null
    }

    private fun finishClose(closeChrome: Boolean, notifyHost: Boolean) {
        if (closed) return
        closed = true
        samplingJob?.cancel()
        exportCancellation?.cancel(); exportJob?.cancel(); exportJob = null
        scope.cancel()
        if (closeChrome) chrome.closePanel()
        if (notifyHost) onClose()
    }

    private fun sectionKey(value: JSONObject): String {
        val plane = value.optJSONObject("plane") ?: return ""
        val center = plane.optJSONArray("center") ?: return ""
        val key = JSONArray().put(center.optDouble(0)).put(center.optDouble(1)).put(value.optDouble("altitude"))
            .put(plane.optDouble("width")).put(plane.optDouble("height")).put(plane.optDouble("heading"))
            .put(plane.optDouble("tilt")).put(plane.optDouble("roll", 0.0))
        if (value.has("objectId")) key.put(value.optString("objectId"))
        return key.toString()
    }

    private fun planeSummary(raw: JSONObject?): String {
        val p = raw?.optJSONObject("plane") ?: return "参数无效"
        val c = p.optJSONArray("center") ?: return "参数无效"
        return "中心 ${c.optDouble(0).formatCoord()}, ${c.optDouble(1).formatCoord()} · ${p.optDouble("width").formatMeters()} × ${p.optDouble("height").formatMeters()} 米"
    }

    private fun pointDescription(curve: NativeSectionCurve, index: Int): String {
        val point = curve.points.getOrNull(index) ?: return "无有效测点"
        return "WGS84 ${point.longitude.formatCoord()}, ${point.latitude.formatCoord()} · ${point.altitudeMeters.formatMeters()} · 沿线 ${point.distanceMeters.formatMeters()}"
    }

    private fun toast(message: String) = Toast.makeText(context, message, Toast.LENGTH_SHORT).show()

    private inner class SectionChart(context: Context) : View(context) {
        private val line = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = ShantuColors.accent; style = Paint.Style.STROKE; strokeWidth = 2.2f }
        private val grid = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = ShantuColors.muted; alpha = 90; style = Paint.Style.STROKE; strokeWidth = 1f }
        private val labels = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = ShantuColors.ink; textSize = 11f }
        private val marker = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = ShantuColors.close; style = Paint.Style.FILL }
        private var curve: NativeSectionCurve? = null
        private var selectedPoint = 0
        fun bind(value: NativeSectionCurve, point: Int) { curve = value; selectedPoint = point; invalidate() }
        fun setSelectedPoint(point: Int) { selectedPoint = point; invalidate() }
        override fun onDraw(canvas: Canvas) {
            super.onDraw(canvas)
            val data = curve ?: return
            val left = 40f; val top = 8f; val right = width - 8f; val bottom = height - 24f
            if (right <= left || bottom <= top || data.points.isEmpty()) return
            canvas.drawLine(left, top, left, bottom, grid); canvas.drawLine(left, bottom, right, bottom, grid)
            canvas.drawText("${data.maxAltitudeMeters.toInt()}m", 2f, top + 10f, labels)
            canvas.drawText("${data.minAltitudeMeters.toInt()}m", 2f, bottom, labels)
            canvas.drawText("距离 ${(data.lengthMeters / 1000.0).formatMeters()} km", left, height - 4f, labels)
            val min = data.minAltitudeMeters; val span = (data.maxAltitudeMeters - min).coerceAtLeast(.01)
            val length = data.lengthMeters.coerceAtLeast(.01)
            val path = Path()
            data.points.forEachIndexed { index, p ->
                val x = left + ((right - left) * (p.distanceMeters / length)).toFloat()
                val y = bottom - ((bottom - top) * ((p.altitudeMeters - min) / span)).toFloat()
                if (index == 0) path.moveTo(x, y) else path.lineTo(x, y)
            }
            canvas.drawPath(path, line)
            data.points.getOrNull(selectedPoint)?.let { p ->
                val x = left + ((right - left) * (p.distanceMeters / length)).toFloat()
                val y = bottom - ((bottom - top) * ((p.altitudeMeters - min) / span)).toFloat()
                canvas.drawCircle(x, y, 4f, marker)
            }
        }
    }

    private fun Double.formatMeters() = if (isFinite()) String.format(java.util.Locale.ROOT, "%.1f", this) else "—"
    private fun Double.formatCoord() = if (isFinite()) String.format(java.util.Locale.ROOT, "%.6f°", this) else "—"
}
