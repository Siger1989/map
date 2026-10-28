package com.shantu.nativeapp.ui

import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import com.shantu.nativeapp.data.NativeSourceImportResult
import com.shantu.nativeapp.data.NativeSourceImport
import com.shantu.nativeapp.map.NativeMapSourceCatalog
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * Host-embeddable native source manager. The host owns file picking, camera decoding and storage;
 * this view edits validated source definitions and emits a complete JSON snapshot through onSave.
 */
class NativeSourceEditor(
    context: Context,
    initialConfiguration: JSONObject,
    private val onSave: (JSONObject) -> Unit,
    private val onImportRequested: () -> Unit,
    private val onClose: () -> Unit = {},
) {
    private val appContext = context
    private val document = JSONObject(initialConfiguration.toString())
    private val arrayKey = when {
        document.optJSONArray("mapSources") != null -> "mapSources"
        document.optJSONArray("maps") != null -> "maps"
        else -> "mapSources"
    }
    private val sources = mutableListOf<JSONObject>().apply {
        val array = document.optJSONArray(arrayKey) ?: JSONArray()
        for (index in 0 until array.length()) array.optJSONObject(index)?.let { add(JSONObject(it.toString())) }
    }
    private val root = LinearLayout(appContext).apply {
        orientation = LinearLayout.VERTICAL
        setBackgroundColor(ShantuColors.surface)
        setPadding(dp(12), dp(8), dp(12), dp(10))
    }
    private val sourceRows = LinearLayout(appContext).apply { orientation = LinearLayout.VERTICAL }
    private val errorText = TextView(appContext).apply { setTextColor(Color.rgb(255, 175, 130)); textSize = 12f }
    private val nameInput = textField("图源名称", 240)
    private val templatesInput = textField("瓦片模板，每行一个；可使用 {z}/{x}/{y}、WMTS 等变量", 8192, multiline = true)
    private val formatInput = spinner(listOf("XYZ", "TMS", "WMTS", "TILEJSON", "OVMAP"))
    private val minZoomInput = textField("最小级别", 2)
    private val maxZoomInput = textField("最大级别", 2)
    private val tileSizeInput = textField("瓦片尺寸 256 / 512", 4)
    private val schemeInput = spinner(listOf("xyz", "tms"))
    private val datumInput = spinner(listOf("wgs84", "gcj02", "bd09"))
    private val attributionInput = textField("图源署名", 1000)
    private val matrixSetInput = textField("WMTS 矩阵集", 128)
    private val tokenInput = textField("令牌（留空保留现有值）", 4096, secret = true)
    private val subdomainsInput = textField("子域列表，以逗号分隔", 512)
    private val deleteButton = button("删除当前图源") { deleteSelected() }
    private var selectedIndex = -1
    private var selectedHasOvmaps = false
    private var selectedIsLocalFile = false
    val view: View get() = root

    init {
        buildLayout()
        renderSources()
        selectSource(if (sources.isEmpty()) -1 else 0, saveCurrent = false)
    }

    /** Host calls this after its document picker or decoded scanner supplies a parse result. */
    fun acceptImport(result: NativeSourceImportResult): NativeSourceEditorUpdate {
        if (selectedIndex in sources.indices && !saveDraft()) {
            errorText.text = "当前编辑内容无效，先修正后再导入，以免丢失编辑"
            return NativeSourceEditorUpdate(0, 0, 0, result.entries.size, errorText.text.toString())
        }
        var added = 0
        var replaced = 0
        var localConflicts = 0
        for (entry in result.entries) {
            val raw = entry.toJson()
            val parsed = NativeMapSourceCatalog.fromJson(JSONObject().put("maps", JSONArray().put(raw)))
            val stableId = parsed.sources.singleOrNull()?.id ?: raw.optString("id")
            val index = sources.indexOfFirst { existing ->
                val existingCatalog = NativeMapSourceCatalog.fromJson(JSONObject().put("maps", JSONArray().put(existing)))
                existingCatalog.sources.singleOrNull()?.id == stableId && stableId.isNotBlank()
            }
            if (index >= 0) {
                if (isLocalFileSource(sources[index])) localConflicts++
                else {
                    sources[index] = preserveExtensionFields(sources[index], raw)
                    replaced++
                }
            } else if (sources.size < NativeSourceEditorLimits.MAX_SOURCES) {
                sources += raw
                added++
            }
        }
        renderSources()
        selectSource(sources.lastIndex.takeIf { added + replaced > 0 } ?: selectedIndex, saveCurrent = false)
        val overflow = result.entries.size - added - replaced
        val message = buildString {
            append("已导入 $added 项，替换 $replaced 项")
            if (localConflicts > 0) append("；${localConflicts}项与本地离线图源 ID 冲突，已保留本地图层")
            if (overflow > 0) append("；原生保存上限为 ${NativeSourceEditorLimits.MAX_SOURCES} 项")
            if (result.issues.isNotEmpty()) append("；${result.issues.size} 项未导入，请检查导入结果")
        }
        errorText.text = if (result.issues.isEmpty()) "" else result.issues.joinToString("\n") { "${it.index + 1}. ${it.reason}" }
        return NativeSourceEditorUpdate(added, replaced, overflow, result.issues.size, message)
    }

    fun currentConfiguration(): JSONObject {
        check(saveDraft()) { "当前图源配置无效" }
        return snapshot()
    }

    private fun buildLayout() {
        val header = LinearLayout(appContext).apply { gravity = Gravity.CENTER_VERTICAL; orientation = LinearLayout.HORIZONTAL }
        header.addView(label("管理图源", 15f), LinearLayout.LayoutParams(0, dp(32), 1f))
        header.addView(button("关闭") { onClose() }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(32)))
        root.addView(header)

        val actions = LinearLayout(appContext).apply { orientation = LinearLayout.HORIZONTAL }
        actions.addView(button("添加") { addBlank() }, LinearLayout.LayoutParams(0, dp(32), 1f))
        actions.addView(button("导入 JSON / OVMAP / 扫码") { onImportRequested() }, LinearLayout.LayoutParams(0, dp(32), 2f))
        actions.addView(button("保存") { commit() }, LinearLayout.LayoutParams(0, dp(32), 1f))
        root.addView(actions)

        val sourceScroll = ScrollView(appContext).apply { isFillViewport = false }
        sourceScroll.addView(sourceRows)
        root.addView(sourceScroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(88)))

        val formScroll = ScrollView(appContext).apply { isFillViewport = false }
        val form = LinearLayout(appContext).apply { orientation = LinearLayout.VERTICAL }
        form.addView(nameInput)
        form.addView(formatInput)
        form.addView(templatesInput, fieldParams(84))
        form.addView(row("级别", minZoomInput, maxZoomInput))
        form.addView(row("瓦片", tileSizeInput, schemeInput))
        form.addView(row("坐标", datumInput, matrixSetInput))
        form.addView(attributionInput)
        form.addView(tokenInput)
        form.addView(subdomainsInput)
        form.addView(deleteButton, fieldParams(32))
        formScroll.addView(form)
        root.addView(formScroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        root.addView(errorText, fieldParams(40))
    }

    private fun renderSources() {
        sourceRows.removeAllViews()
        sources.forEachIndexed { index, source ->
            val catalog = NativeMapSourceCatalog.fromJson(JSONObject().put("maps", JSONArray().put(source)))
            val parsed = catalog.sources.singleOrNull()
            val title = source.optString("name").ifBlank { "未命名图源" }
            val detail = if (isLocalFileSource(source)) "本地离线文件 · 在离线地图管理中查看/移除"
                else parsed?.let { "${it.format} · ${it.minZoom}–${it.maxZoom}级" } ?: "配置待修复"
            val row = LinearLayout(appContext).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
            val button = TextView(appContext).apply {
                text = "$title\n$detail"
                textSize = 10f
                setTextColor(ShantuColors.ink)
                gravity = Gravity.START or Gravity.CENTER_VERTICAL
                setPadding(dp(7), 0, dp(7), 0)
                minimumHeight = 0
                background = controlBackground()
                isClickable = true
                isFocusable = true
                setOnClickListener { selectSource(index) }
            }
            row.addView(button, LinearLayout.LayoutParams(0, dp(32), 1f))
            sourceRows.addView(row)
        }
    }

    private fun selectSource(index: Int, saveCurrent: Boolean = true) {
        if (saveCurrent && index != selectedIndex && selectedIndex in sources.indices && !saveDraft()) return
        selectedIndex = index
        val source = sources.getOrNull(index)
        selectedIsLocalFile = source?.let(::isLocalFileSource) == true
        selectedHasOvmaps = source?.optJSONObject("ovmap")?.optJSONArray("layers") != null
        nameInput.setText(source?.optString("name").orEmpty())
        formatInput.setSelection(selectionIndex(formatInput, source?.optString("format", "XYZ")?.uppercase() ?: "XYZ"))
        val templates = source?.optJSONArray("tiles")?.let { array -> (0 until array.length()).joinToString("\n") { array.optString(it) } }.orEmpty()
        templatesInput.setText(templates)
        minZoomInput.setText((source?.optInt("minzoom", 0) ?: 0).toString())
        maxZoomInput.setText((source?.optInt("maxzoom", 18) ?: 18).toString())
        tileSizeInput.setText((source?.optInt("tileSize", 256) ?: 256).toString())
        schemeInput.setSelection(selectionIndex(schemeInput, source?.optString("scheme", "xyz") ?: "xyz"))
        datumInput.setSelection(selectionIndex(datumInput, source?.optString("datum", "wgs84") ?: "wgs84"))
        attributionInput.setText(source?.optString("attribution", "用户提供的图源").orEmpty())
        matrixSetInput.setText(source?.optString("tileMatrixSet").orEmpty())
        tokenInput.setText("")
        subdomainsInput.setText(source?.optJSONArray("subdomains")?.let { array -> (0 until array.length()).joinToString(",") { array.optString(it) } }.orEmpty())
        val controls: List<View> = listOf(nameInput, formatInput, templatesInput, minZoomInput, maxZoomInput, tileSizeInput, schemeInput, datumInput, attributionInput, matrixSetInput, tokenInput, subdomainsInput)
        controls.forEach { control -> control.isEnabled = !selectedIsLocalFile && !(selectedHasOvmaps && control in listOf(templatesInput, tileSizeInput, schemeInput)) }
        deleteButton.isEnabled = !selectedIsLocalFile
        deleteButton.alpha = if (selectedIsLocalFile) .45f else 1f
        errorText.text = when {
            selectedIsLocalFile -> "本地离线文件独立保存在离线地图库；此处只读保留，不会改写文件路径、blob、配准或 ID。"
            selectedHasOvmaps -> "OVMAP 多图层结构将原样保留；可修改名称、级别和署名。"
            else -> ""
        }
    }

    private fun addBlank() {
        if (selectedIndex in sources.indices && !saveDraft()) return
        if (sources.size >= NativeSourceEditorLimits.MAX_SOURCES) {
            errorText.text = "已达到 ${NativeSourceEditorLimits.MAX_SOURCES} 项保存上限"
            return
        }
        val source = JSONObject()
            .put("id", "native-${UUID.randomUUID()}")
            .put("name", "新图源")
            .put("kind", "online")
            .put("format", "XYZ")
            .put("tiles", JSONArray())
            .put("scheme", "xyz")
            .put("minzoom", 0)
            .put("maxzoom", 18)
            .put("tileSize", 256)
            .put("datum", "wgs84")
            .put("attribution", "用户提供的图源")
        sources += source
        renderSources()
        selectSource(sources.lastIndex, saveCurrent = false)
    }

    private fun deleteSelected() {
        if (selectedIndex !in sources.indices) return
        if (isLocalFileSource(sources[selectedIndex])) {
            errorText.text = "本地离线文件请在离线地图管理中移除；图源编辑器不会删除文件。"
            return
        }
        sources.removeAt(selectedIndex)
        renderSources()
        selectSource((selectedIndex - 1).coerceAtMost(sources.lastIndex), saveCurrent = false)
    }

    private fun saveDraft(): Boolean {
        val original = sources.getOrNull(selectedIndex)
        if (original != null && isLocalFileSource(original)) return true
        val candidate = original?.let { JSONObject(it.toString()) } ?: JSONObject()
        val format = formatInput.selectedItem?.toString() ?: "XYZ"
        val isOvmap = selectedHasOvmaps
        candidate.put("name", nameInput.text.toString().trim())
            .put("kind", "online")
            .put("format", if (isOvmap) "OVMAP" else format)
            .put("minzoom", minZoomInput.text.toString().toIntOrNull() ?: -1)
            .put("maxzoom", maxZoomInput.text.toString().toIntOrNull() ?: -1)
            .put("tileSize", tileSizeInput.text.toString().toIntOrNull() ?: -1)
            .put("scheme", if (isOvmap) "xyz" else schemeInput.selectedItem.toString())
            .put("datum", datumInput.selectedItem.toString())
            .put("attribution", attributionInput.text.toString())
        if (!isOvmap) candidate.put("tiles", JSONArray(templatesInput.text.toString().lineSequence().map(String::trim).filter(String::isNotEmpty).toList()))
        if (!isOvmap) {
            val token = tokenInput.text.toString()
            if (token.isNotEmpty()) candidate.put("token", token)
            val subdomains = subdomainsInput.text.toString().split(',').map(String::trim).filter(String::isNotEmpty)
            if (subdomains.isNotEmpty()) candidate.put("subdomains", JSONArray(subdomains))
            else candidate.remove("subdomains")
            if (matrixSetInput.text.isNotBlank()) candidate.put("tileMatrixSet", matrixSetInput.text.toString().trim())
        } else {
            val ovmap = JSONObject(candidate.optJSONObject("ovmap")?.toString() ?: "{}")
            val oldLayers = ovmap.optJSONArray("layers") ?: JSONArray()
            val updatedLayers = JSONArray()
            for (index in 0 until oldLayers.length()) {
                val layer = oldLayers.optJSONObject(index)?.let { JSONObject(it.toString()) } ?: continue
                layer.put("minzoom", candidate.optInt("minzoom", -1))
                    .put("maxzoom", candidate.optInt("maxzoom", -1))
                updatedLayers.put(layer)
            }
            ovmap.put("layers", updatedLayers)
            candidate.put("ovmap", ovmap)
        }
        val catalog = NativeMapSourceCatalog.fromJson(JSONObject().put("maps", JSONArray().put(candidate)))
        val error = catalog.errors.firstOrNull()?.reason
        if (error != null || catalog.sources.size != 1) {
            errorText.text = error ?: "图源配置无效"
            return false
        }
        val candidateId = catalog.sources.single().id
        if (sources.withIndex().any { (index, existing) -> index != selectedIndex &&
                NativeMapSourceCatalog.fromJson(JSONObject().put("maps", JSONArray().put(existing))).sources.singleOrNull()?.id == candidateId }) {
            errorText.text = "图源 ID 重复，请调整后再保存"
            return false
        }
        if (original == null) {
            sources += candidate
            selectedIndex = sources.lastIndex
        } else sources[selectedIndex] = candidate
        renderSources()
        selectSource(selectedIndex, saveCurrent = false)
        errorText.text = "图源配置已验证；点击保存提交给主应用"
        return true
    }

    private fun snapshot(): JSONObject {
        val result = JSONObject(document.toString())
        val array = JSONArray()
        sources.forEach { array.put(JSONObject(it.toString())) }
        result.put(arrayKey, array)
        return result
    }

    /** Host may persist online definitions separately from the local raster file store. */
    fun onlineDefinitions(): JSONArray = NativeSourceImport.onlineDefinitions(JSONArray(sources.map { JSONObject(it.toString()) }))

    fun validateExportMaps(): com.shantu.nativeapp.data.NativeMapSourceExportValidation =
        NativeSourceImport.validateExportMaps(JSONArray(sources.map { JSONObject(it.toString()) }))

    private fun isLocalFileSource(source: JSONObject): Boolean = source.optString("kind").lowercase() in setOf("mbtiles", "geotiff", "image")

    private fun preserveExtensionFields(existing: JSONObject, imported: JSONObject): JSONObject {
        val merged = JSONObject(imported.toString())
        val retainedOptional = setOf("token", "subdomains", "tileMatrixSet")
        val keys = existing.keys()
        while (keys.hasNext()) {
            val key = keys.next()
            if ((!knownSchemaFields.contains(key) || retainedOptional.contains(key)) && !merged.has(key)) {
                merged.put(key, existing.get(key))
            }
        }
        return merged
    }

    private fun commit() {
        if (selectedIndex in sources.indices && !saveDraft()) return
        val invalid = sources.withIndex().firstOrNull { (_, source) ->
            NativeMapSourceCatalog.fromJson(JSONObject().put("maps", JSONArray().put(source))).sources.size != 1
        }
        if (invalid != null) {
            errorText.text = "第 ${invalid.index + 1} 项图源配置无效，修正后再保存"
            return
        }
        onSave(snapshot())
        errorText.text = "已提交图源配置"
    }

    private fun textField(hintText: String, maxLength: Int, multiline: Boolean = false, secret: Boolean = false) = EditText(appContext).apply {
        hint = hintText
        textSize = 16f
        setTextColor(ShantuColors.ink)
        setHintTextColor(ShantuColors.muted)
        inputType = if (secret) InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD else if (multiline)
            InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
        else InputType.TYPE_CLASS_TEXT
        filters = arrayOf(android.text.InputFilter.LengthFilter(maxLength))
        setSingleLine(!multiline)
        setPadding(dp(8), dp(5), dp(8), dp(5))
        background = controlBackground()
        minimumHeight = dp(32)
        minimumWidth = 0
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(if (multiline) 84 else 32)).apply {
            topMargin = dp(3)
            bottomMargin = dp(3)
        }
    }

    private fun spinner(items: List<String>) = Spinner(appContext).apply {
        adapter = android.widget.ArrayAdapter(appContext, android.R.layout.simple_spinner_dropdown_item, items)
        minimumHeight = dp(32)
        background = controlBackground()
    }

    private fun selectionIndex(spinner: Spinner, value: String): Int =
        (0 until (spinner.adapter?.count ?: 0)).firstOrNull { spinner.adapter?.getItem(it)?.toString() == value } ?: 0

    private fun row(title: String, left: View, right: View): View = LinearLayout(appContext).apply {
        orientation = LinearLayout.HORIZONTAL
        addView(label(title, 11f), LinearLayout.LayoutParams(dp(38), dp(32)))
        addView(left, LinearLayout.LayoutParams(0, dp(32), 1f))
        addView(right, LinearLayout.LayoutParams(0, dp(32), 1f))
    }

    private fun label(text: String, size: Float) = TextView(appContext).apply { this.text = text; textSize = size; setTextColor(ShantuColors.ink); gravity = Gravity.CENTER_VERTICAL }
    private fun button(text: String, action: () -> Unit) = TextView(appContext).apply {
        this.text = text
        textSize = 12f
        setTextColor(ShantuColors.ink)
        gravity = Gravity.CENTER
        includeFontPadding = false
        minimumHeight = 0
        isClickable = true
        isFocusable = true
        background = controlBackground()
        setOnClickListener { action() }
    }
    private fun controlBackground() = GradientDrawable().apply {
        setColor(ShantuColors.raised)
        cornerRadius = dp(4).toFloat()
    }
    private fun fieldParams(height: Int) = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(height)).apply { topMargin = dp(3); bottomMargin = dp(3) }
    private fun dp(value: Int) = (value * appContext.resources.displayMetrics.density).toInt()

}

class NativeSourceEditorUpdate(
    val added: Int,
    val replaced: Int,
    val skippedAtLimit: Int,
    val rejected: Int,
    val message: String,
) {
    override fun toString() = "NativeSourceEditorUpdate(added=$added, replaced=$replaced, skippedAtLimit=$skippedAtLimit, rejected=$rejected)"
}

private object NativeSourceEditorLimits { const val MAX_SOURCES = 100 }

private val knownSchemaFields = setOf(
    "id", "name", "kind", "format", "attribution", "bounds", "minzoom", "maxzoom", "tileSize",
    "tiles", "scheme", "bytes", "blob", "detail", "datum", "ovmap", "token", "subdomains", "tileMatrixSet",
)
