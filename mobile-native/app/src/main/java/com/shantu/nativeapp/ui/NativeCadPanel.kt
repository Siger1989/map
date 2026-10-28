package com.shantu.nativeapp.ui

import android.app.AlertDialog
import android.content.Context
import android.graphics.Color
import android.text.InputType
import android.view.Gravity
import android.widget.ArrayAdapter
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.Toast
import com.shantu.nativeapp.cad.NativeCadAxis
import com.shantu.nativeapp.cad.NativeCadCrs
import com.shantu.nativeapp.cad.NativeDxfDecoded
import com.shantu.nativeapp.cad.NativeDxfImporter
import com.shantu.nativeapp.data.NativeImportedSettings
import org.json.JSONArray
import org.json.JSONObject
import java.util.Base64
import kotlin.math.abs

/** CAD document manager. The host owns SAF and WorkspaceStore persistence. */
class NativeCadPanel(
    private val context: Context,
    private val chrome: HomeChrome,
    private val onPickFile: () -> Unit,
    private val onSave: (JSONObject) -> Boolean,
    private val onUpdate: (JSONObject) -> Unit,
    private val onDelete: (String) -> Unit,
    private val onView: (JSONObject) -> Unit,
    private val onExport: (JSONObject) -> Unit,
) {
    private var documents: List<JSONObject> = emptyList()
    private var draft: NativeDxfDecoded? = null
    private var crsIndex = 0
    private var customCrsText=""
    private var datumText=""
    private var axisIndex = 0
    private var scaleText = ""
    private var warningsExpanded = false
    private var statusMessage: String? = null
    private var disposed = false

    /** Values are copied so edits in this panel cannot mutate the caller's snapshot. */
    fun setDocuments(value: List<JSONObject>) {
        if (value.size > MAX_DOCUMENTS) {
            statusMessage = "CAD 文档超过 ${MAX_DOCUMENTS} 份上限，未覆盖现有数据。"
            return
        }
        documents = value.map { JSONObject(it.toString()) }
        render()
    }

    fun acceptDraft(value: NativeDxfDecoded) {
        draft = value
        val crsDefaults = prefillProjectCrs(NativeImportedSettings.readRuntime(context))
        crsIndex = crsDefaults.first
        customCrsText = crsDefaults.second
        datumText = crsDefaults.third
        axisIndex = 0
        scaleText = ""
        warningsExpanded = false
        statusMessage = null
        render()
    }

    fun show() { if (!disposed) render(force = true) }

    fun dispose() {
        disposed = true
        draft = null
        close()
    }

    fun close() { if (chrome.currentPanel() == PANEL_ID) chrome.closePanel() }

    private fun render(force: Boolean = false) {
        if (disposed || (!force && chrome.currentPanel() != PANEL_ID)) return
        chrome.showPanel(PANEL_ID, "CAD 工程图", topAligned = true, width = 320) {
            addView(chrome.row("导入 ASCII DXF") { onPickFile() }, LinearLayout.LayoutParams(-1, chrome.dp(30)))
            addView(chrome.text("仅支持 ASCII DXF；DWG、二进制DXF及完整CAD编辑未实现。每份≤20 MiB，最多${MAX_DOCUMENTS}份。", 10), LinearLayout.LayoutParams(-1, chrome.dp(34)))
            statusMessage?.let { addView(chrome.text(it, 10).apply { setTextColor(Color.rgb(255, 155, 120)) }, LinearLayout.LayoutParams(-1, chrome.dp(30))) }
            draft?.let { renderDraft(this, it) }
            addView(chrome.text("已保存工程图 · ${documents.size}/${MAX_DOCUMENTS}", 11).apply { setTextColor(ShantuColors.accent) }, LinearLayout.LayoutParams(-1, chrome.dp(26)))
            if (documents.isEmpty()) {
                addView(chrome.text("尚无 CAD 工程图。导入后可查看、控制显示、管理图层或导出原文件。", 10), LinearLayout.LayoutParams(-1, chrome.dp(34)))
            } else {
                documents.forEach { doc -> addView(documentRow(doc), LinearLayout.LayoutParams(-1, chrome.dp(76))) }
            }
        }
    }

    private fun renderDraft(body: LinearLayout, decoded: NativeDxfDecoded) = with(body) {
        addView(chrome.text("待导入：${decoded.name} · ${decoded.features.size} 个支持图元 · ${decoded.layers.size} 个图层", 11), LinearLayout.LayoutParams(-1, chrome.dp(28)))
        val detected = decoded.crsHint?.takeIf(String::isNotBlank)
        addView(chrome.text(detected?.let { "文件声明坐标系：$it。仍需人工确认；不支持的声明会拒绝覆盖。" } ?: "文件未声明CRS；请明确选择，系统不会按坐标数值猜测。", 10).apply { setTextColor(ShantuColors.muted) }, LinearLayout.LayoutParams(-1, chrome.dp(34)))
        val crs = Spinner(context).apply {
            adapter = ArrayAdapter(context, android.R.layout.simple_spinner_dropdown_item, listOf("选择源坐标系…", "WGS 84 · EPSG:4326", "Web Mercator · EPSG:3857", "工程坐标系 EPSG / PROJ / WKT"))
            setSelection(crsIndex.coerceIn(0, 3))
            onItemSelectedListener = PanelSpinnerListener { crsIndex = it }
        }
        addView(crs, LinearLayout.LayoutParams(-1, chrome.dp(38)))
        NativeImportedSettings.readRuntime(context).projectCrs?.let { saved ->
            addView(chrome.text("已从工作区设置预选工程坐标系：${saved.name}（${saved.id}）及原 datum 参数；文件坐标声明仍需人工确认。", 10), LinearLayout.LayoutParams(-1, chrome.dp(30)))
        }
        addView(chrome.input("工程坐标系：EPSG:4490 / 32648 / 4545，或PROJ/WKT").apply{setText(customCrsText);addTextChangedListener(PanelTextWatcher{customCrsText=it})})
        addView(chrome.input("可选 datum 3/7参数，以逗号分隔；北京54/西安80必须提供").apply{setText(datumText);addTextChangedListener(PanelTextWatcher{datumText=it})})
        val axis = Spinner(context).apply {
            adapter = ArrayAdapter(context, android.R.layout.simple_spinner_dropdown_item, listOf("确认轴序…", "X→经度 / Y→纬度", "Y→经度 / X→纬度"))
            setSelection(axisIndex.coerceIn(0, 2))
            onItemSelectedListener = PanelSpinnerListener { axisIndex = it }
        }
        addView(axis, LinearLayout.LayoutParams(-1, chrome.dp(38)))
        val scale = EditText(context).apply {
            hint = decoded.declaredUnitScale?.let { "单位换算比例（检测建议 $it；需确认）" } ?: "单位换算比例（需明确输入）"
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL or InputType.TYPE_NUMBER_FLAG_SIGNED
            setSingleLine(true)
            textSize = 16f
            setTextColor(ShantuColors.ink)
            setHintTextColor(ShantuColors.muted)
            setPadding(chrome.dp(8), chrome.dp(4), chrome.dp(8), chrome.dp(4))
            background = chrome.surface(4, ShantuColors.raised)
            setText(scaleText)
            addTextChangedListener(PanelTextWatcher { scaleText = it })
        }
        addView(scale, LinearLayout.LayoutParams(-1, chrome.dp(40)))
        if (decoded.units != null) addView(chrome.text("DXF单位声明：${decoded.units}；比例建议仅供核对，不会自动采用。", 10), LinearLayout.LayoutParams(-1, chrome.dp(26)))
        val warningLabel = if (decoded.warnings.isEmpty()) "解析告警：无" else "解析告警：${decoded.warnings.size} 项 · ${if (warningsExpanded) "收起" else "展开"}"
        addView(chrome.row(warningLabel) { warningsExpanded = !warningsExpanded; render() }, LinearLayout.LayoutParams(-1, chrome.dp(28)))
        if (warningsExpanded) decoded.warnings.forEach { warning -> addView(chrome.text("• $warning", 10).apply { setTextColor(ShantuColors.muted) }, LinearLayout.LayoutParams(-1, -2)) }
        val actions = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
        actions.addView(chrome.row("确认并保存") { saveDraft(decoded) }, LinearLayout.LayoutParams(0, chrome.dp(30), 1f))
        actions.addView(chrome.row("取消") { draft = null; statusMessage = null; render() }, LinearLayout.LayoutParams(0, chrome.dp(30), 1f).apply { leftMargin = chrome.dp(4) })
        addView(actions, LinearLayout.LayoutParams(-1, chrome.dp(34)))
    }

    private fun saveDraft(decoded: NativeDxfDecoded) {
        if (documents.size >= MAX_DOCUMENTS) {
            statusMessage = "CAD 工程图已达 ${MAX_DOCUMENTS} 份上限；未保存。"
            render()
            return
        }
        val source = try { when (crsIndex) { 1 -> NativeCadCrs.WGS84; 2 -> NativeCadCrs.WEB_MERCATOR; 3->NativeCadCrs.resolve(customCrsText,datumText.takeIf{it.isNotBlank()}?.split(',')?.map{it.trim().toDouble()});else -> null } }
            catch(e:Exception){statusMessage=e.message?:"坐标系输入无效";render();return}
        val axis = when (axisIndex) { 1 -> NativeCadAxis.XY; 2 -> NativeCadAxis.YX; else -> null }
        val scale = scaleText.trim().toDoubleOrNull()
        val document = try {
            NativeDxfImporter.buildDocument(decoded, source, axis, scale)
        } catch (error: Exception) {
            statusMessage = error.message ?: "CAD 坐标确认无效，未保存。"
            render()
            return
        }
        if (documents.any { it.optString("id") == document.optString("id") }) {
            statusMessage = "相同源文件已存在；未重复导入。"
            render()
            return
        }
        val saved = try { onSave(JSONObject(document.toString())) } catch (error: Exception) {
            statusMessage = error.message ?: "保存失败；原工作区未由此面板更改。"
            false
        }
        if (!saved) {
            if (statusMessage == null) statusMessage = "保存失败；请检查存储空间或工作区校验。"
            render()
            return
        }
        documents = documents + document
        draft = null
        statusMessage = "已导入 ${decoded.name}。"
        render()
    }

    private fun documentRow(doc: JSONObject): LinearLayout = LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(chrome.dp(4), chrome.dp(2), chrome.dp(4), chrome.dp(2))
        background = chrome.surface(4, ShantuColors.raised)
        val title = doc.optString("name", "CAD 工程图").take(100)
        val featureCount = doc.optJSONArray("features")?.length() ?: 0
        val source = doc.optJSONObject("sourceCrs")?.optString("id", "未记录CRS") ?: "未记录CRS"
        addView(chrome.text("$title · $featureCount 图元 · $source", 10).apply { maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END }, LinearLayout.LayoutParams(-1, chrome.dp(22)))
        val row = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        row.addView(chrome.row(if (doc.optBoolean("visible", true)) "显示" else "隐藏") { toggleDocument(doc) }, LinearLayout.LayoutParams(0, chrome.dp(28), 1f))
        row.addView(chrome.row("查看") { onView(JSONObject(doc.toString())) }, LinearLayout.LayoutParams(0, chrome.dp(28), 1f).apply { leftMargin = chrome.dp(3) })
        row.addView(chrome.row("图层") { editLayers(doc) }, LinearLayout.LayoutParams(0, chrome.dp(28), 1f).apply { leftMargin = chrome.dp(3) })
        row.addView(chrome.row("原文件") { exportOriginal(doc) }, LinearLayout.LayoutParams(0, chrome.dp(28), 1f).apply { leftMargin = chrome.dp(3) })
        row.addView(chrome.row("删除") { confirmDelete(doc) }, LinearLayout.LayoutParams(0, chrome.dp(28), 1f).apply { leftMargin = chrome.dp(3) })
        addView(row, LinearLayout.LayoutParams(-1, chrome.dp(30)))
    }

    private fun toggleDocument(doc: JSONObject) {
        val next = JSONObject(doc.toString()).put("visible", !doc.optBoolean("visible", true))
        persistUpdate(next)
    }

    private fun editLayers(doc: JSONObject) {
        val layers = doc.optJSONArray("layers") ?: JSONArray()
        val scroll = ScrollView(context)
        val content = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; setPadding(chrome.dp(8), chrome.dp(4), chrome.dp(8), 0) }
        val global = CheckBox(context).apply {
            text = "整份工程图显示"
            setTextColor(ShantuColors.ink)
            isChecked = doc.optBoolean("visible", true)
        }
        content.addView(global)
        val checks = mutableListOf<CheckBox>()
        val colors = mutableListOf<EditText>()
        for (index in 0 until layers.length()) {
            val layer = layers.optJSONObject(index) ?: continue
            val line = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; setPadding(0, chrome.dp(4), 0, chrome.dp(4)) }
            val check = CheckBox(context).apply {
                text = layer.optString("name", "图层 ${index + 1}").take(100)
                setTextColor(ShantuColors.ink)
                isChecked = layer.optBoolean("visible", true)
                tag = index
            }
            val color = EditText(context).apply {
                hint = "图层颜色 #RRGGBB"
                setText(layer.optString("color", ""))
                inputType = InputType.TYPE_CLASS_TEXT
                setSingleLine(true)
                textSize = 16f
                setTextColor(ShantuColors.ink)
                setHintTextColor(ShantuColors.muted)
                background = chrome.surface(4, ShantuColors.raised)
            }
            checks += check; colors += color
            line.addView(check, LinearLayout.LayoutParams(-1, chrome.dp(34)))
            line.addView(color, LinearLayout.LayoutParams(-1, chrome.dp(38)))
            content.addView(line, LinearLayout.LayoutParams(-1, -2))
        }
        if (layers.length() == 0) content.addView(chrome.text("文件未包含图层表；图元仍可整体显示。", 11))
        scroll.addView(content)
        val dialog = AlertDialog.Builder(context).setTitle("图层与显示").setView(scroll)
            .setNegativeButton("取消", null).setPositiveButton("保存", null).create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val next = JSONObject(doc.toString()).put("visible", global.isChecked)
                val updatedLayers = JSONArray()
                for (index in 0 until layers.length()) {
                    val old = layers.optJSONObject(index) ?: continue
                    val updated = JSONObject(old.toString())
                    val rowIndex = checks.indexOfFirst { (it.tag as? Int) == index }
                    if (rowIndex >= 0) {
                        val color = colors[rowIndex].text.toString().trim()
                        if (color.isNotEmpty() && !HEX_COLOR.matches(color)) {
                            toast("图层颜色须为 #RRGGBB")
                            return@setOnClickListener
                        }
                        updated.put("visible", checks[rowIndex].isChecked)
                        if (color.isEmpty()) updated.remove("color") else updated.put("color", color.lowercase())
                    }
                    updatedLayers.put(updated)
                }
                next.put("layers", updatedLayers)
                applyLayerColors(next, layers, updatedLayers)
                if (persistUpdate(next)) dialog.dismiss()
            }
        }
        dialog.show()
    }

    /** Propagate layer palette edits only to BYLAYER features; explicit entity colors remain intact. */
    private fun applyLayerColors(document: JSONObject, oldLayers: JSONArray, newLayers: JSONArray) {
        val colors = (0 until newLayers.length()).mapNotNull { newLayers.optJSONObject(it) }.associate { it.optString("name") to it.optString("color").takeIf(String::isNotEmpty) }
        val oldByName = (0 until oldLayers.length()).mapNotNull { oldLayers.optJSONObject(it) }.associateBy { it.optString("name") }
        for (key in listOf("features", "mapFeatures")) {
            val source = document.optJSONArray(key) ?: continue
            val output = JSONArray()
            for (i in 0 until source.length()) {
                val feature = JSONObject(source.getJSONObject(i).toString())
                val raw = feature.optJSONObject("properties")?.optJSONArray("dxfRawGroups")
                val explicitEntityColor = raw != null && (0 until raw.length()).any { index ->
                    val pair = raw.optJSONArray(index) ?: return@any false
                    val code = pair.optInt(0, -1)
                    code == 420 || (code == 62 && abs(pair.optString(1).toIntOrNull() ?: 256) in 1..9)
                }
                val layerName = feature.optString("layer")
                if (!explicitEntityColor && oldByName.containsKey(layerName)) {
                    colors[layerName]?.let { feature.put("color", it) } ?: feature.remove("color")
                }
                output.put(feature)
            }
            document.put(key, output)
        }
    }

    private fun persistUpdate(updated: JSONObject): Boolean {
        return try {
            onUpdate(JSONObject(updated.toString()))
            documents = documents.map { if (it.optString("id") == updated.optString("id")) JSONObject(updated.toString()) else it }
            statusMessage = null
            render()
            true
        } catch (error: Exception) {
            statusMessage = error.message ?: "更新失败，原工程图保持不变。"
            render()
            false
        }
    }

    private fun exportOriginal(doc: JSONObject) {
        val raw = doc.optString("sourceBase64").takeIf(String::isNotBlank)
        if (raw == null) { toast("原始CAD文件缺失，无法导出。"); return }
        try {
            val bytes = Base64.getDecoder().decode(raw)
            if (bytes.isEmpty() || bytes.size > NativeDxfImporter.MAX_INPUT_BYTES) { toast("原文件数据无效或超过20MiB。"); return }
            onExport(JSONObject(doc.toString()))
        } catch (_: IllegalArgumentException) { toast("原文件数据损坏，无法导出。"); }
    }

    private fun confirmDelete(doc: JSONObject) {
        AlertDialog.Builder(context).setTitle("删除 CAD 工程图")
            .setMessage("确定删除“${doc.optString("name").take(80)}”吗？原文件和图元都会从工作区移除。")
            .setNegativeButton("取消", null)
            .setPositiveButton("删除") { _, _ ->
                try {
                    onDelete(doc.optString("id"))
                    documents = documents.filterNot { it.optString("id") == doc.optString("id") }
                    statusMessage = "工程图已删除。"
                    render()
                } catch (error: Exception) {
                    statusMessage = error.message ?: "删除失败，工程图保持不变。"
                    render()
                }
            }.show()
    }

    private fun toast(message: String) = Toast.makeText(context, message, Toast.LENGTH_SHORT).show()

    companion object {
        const val PANEL_ID = "native-cad"
        const val MAX_DOCUMENTS = 20
        private val HEX_COLOR = Regex("^#[0-9a-fA-F]{6}$")

        internal fun prefillProjectCrs(runtime: com.shantu.nativeapp.data.NativeRuntimeSettings): Triple<Int, String, String> =
            runtime.projectCrs?.let { Triple(3, it.definition ?: it.id, it.datumParameters.joinToString(",")) }
                ?: Triple(0, "", "")
    }
}

private class PanelTextWatcher(private val changed: (String) -> Unit) : android.text.TextWatcher {
    override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
    override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) { changed(s?.toString().orEmpty()) }
    override fun afterTextChanged(s: android.text.Editable?) = Unit
}

private class PanelSpinnerListener(private val selected: (Int) -> Unit) : android.widget.AdapterView.OnItemSelectedListener {
    override fun onNothingSelected(parent: android.widget.AdapterView<*>?) = Unit
    override fun onItemSelected(parent: android.widget.AdapterView<*>?, view: android.view.View?, position: Int, id: Long) { selected(position) }
}
