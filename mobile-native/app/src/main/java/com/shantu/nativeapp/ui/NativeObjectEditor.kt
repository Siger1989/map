package com.shantu.nativeapp.ui

import android.app.AlertDialog
import android.content.Context
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.GridLayout
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import com.shantu.nativeapp.data.NativeImportedSettings
import org.json.JSONArray
import org.json.JSONObject

/** Compact native editors for saved map annotations and manual tracks.
 *
 * The incoming object is never mutated. Every successful save returns a JSON deep copy
 * with the supported edits applied, so fields from newer web versions survive round trips.
 */
class NativeObjectEditor(context: Context, private val chrome: HomeChrome, private val onOpenMapGizmo: ((JSONObject, (JSONObject) -> Unit) -> Unit)? = null) {
    private val appContext = context
    private val attributeTemplate = NativeImportedSettings.readRuntime(context).annotationAttributeNames

    fun showMarker(
        item: JSONObject,
        onSave: (JSONObject) -> Unit,
        onDelete: (JSONObject) -> Unit,
    ) {
        val copy = deepCopy(item)
        val fields = linkedMapOf<String, EditText>()
        val body = LinearLayout(appContext).apply { orientation = LinearLayout.VERTICAL }
        addText(body, when (copy.optString("kind", "pin")) {
            "box" -> "长方体参数"
            "cylinder" -> "圆柱参数"
            "sphere" -> "球体参数"
            "prism" -> "轮廓模型参数"
            else -> "地点标记"
        })
        addInput(body, fields, "名称", "name", copy.optString("name"), 60)
        addInput(body, fields, "备注", "note", copy.optString("note"), 500, multiline = true)
        val coordinates = copy.optJSONArray("coordinates") ?: JSONArray().put(0).put(0)
        addInput(body, fields, "经度 WGS84", "longitude", coordinates.optDouble(0).toString(), numeric = true)
        addInput(body, fields, "纬度 WGS84", "latitude", coordinates.optDouble(1).toString(), numeric = true)
        addInput(body, fields, "地面海拔（米；未知填 null）", "groundElevation", if (copy.isNull("groundElevation")) "null" else copy.optDouble("groundElevation").toString())
        if (copy.has("centerAltitude")) addInput(body, fields, "中心绝对海拔（米）", "centerAltitude", copy.optDouble("centerAltitude").toString(), numeric = true)
        addColorPicker(body, fields, copy.optString("color", "#f2b45f"))
        addIconPicker(body, copy)
        addChoice(body, "地表 / 地下", listOf("surface", "underground"), copy.optString("placement", "surface")) { copy.put("placement", it) }
        addChoice(body, "地图显示", listOf("显示", "隐藏"), if (copy.optBoolean("visible", true)) "显示" else "隐藏") {
            copy.put("visible", it == "显示")
        }
        addInput(body, fields, "离地 / 埋深（米，0–10000）", "offset", copy.optDouble("offset", 0.0).toString(), numeric = true)
        listOf("width" to "宽 / 直径（米）", "length" to "长（米）", "height" to "高（米）").forEach { (key, title) ->
            addInput(body, fields, title, key, copy.optDouble(key, 10.0).toString(), numeric = true)
        }
        listOf("heading" to "朝向（°）", "pitch" to "俯仰（°）", "roll" to "翻滚（°）").forEach { (key, title) ->
            addInput(body, fields, title, key, copy.optDouble(key, 0.0).toString(), numeric = true)
        }
        addInput(body, fields, "透明度（0.1–0.85）", "opacity", copy.optDouble("opacity", 0.55).toString(), numeric = true)
        addChoice(body, "地形裁切", listOf("关闭", "开启"), if (copy.optBoolean("terrainCut", false)) "开启" else "关闭") { copy.put("terrainCut", it == "开启") }
        addChoice(body, "地形相交", listOf("关闭", "开启"), if (copy.optBoolean("terrainIntersection", true)) "开启" else "关闭") { copy.put("terrainIntersection", it == "开启") }
        onOpenMapGizmo?.let { open ->
            body.addView(chrome.row("地图中调整位置 / 姿态 / 尺寸") { open(deepCopy(copy), onSave) }, LinearLayout.LayoutParams(-1, chrome.dp(28)).apply { topMargin = chrome.dp(2) })
        }
        if (copy.has("borehole")) {
            val borehole = copy.optJSONObject("borehole") ?: JSONObject()
            addInput(body, fields, "钻孔深度（米；未知填 null）", "boreholeDepth", if (borehole.isNull("depth")) "null" else borehole.optDouble("depth").toString())
        }
        val attributes = initialAttributes(copy, attributeTemplate)
        val attributeRows = LinearLayout(appContext).apply { orientation = LinearLayout.VERTICAL }
        addText(body, "自定义条目")
        body.addView(attributeRows, LinearLayout.LayoutParams(-1, -2))
        attributesRows(attributeRows, attributes, fields)
        body.addView(chrome.row("＋ 添加条目") {
            if (attributes.length() >= 40) toast("最多40个自定义条目") else {
                attributes.put(JSONObject().put("name", "").put("value", ""))
                attributesRows(attributeRows, attributes, fields)
            }
        }, LinearLayout.LayoutParams(-1, chrome.dp(28)).apply { topMargin = chrome.dp(2) })
        val footprint = copy.optJSONArray("footprint") ?: JSONArray()
        val footprintContainer = LinearLayout(appContext).apply { orientation = LinearLayout.VERTICAL }
        if (copy.optString("kind") == "prism") {
            addText(body, "轮廓点坐标（局部 -0.5 至 0.5）")
            body.addView(footprintContainer, LinearLayout.LayoutParams(-1, -2))
            footprintRows(footprintContainer, footprint, fields)
            body.addView(chrome.row("＋ 添加轮廓点") {
                if (footprint.length() >= 6000) toast("轮廓点最多6000个") else {
                    footprint.put(JSONArray().put(0.0).put(0.0))
                    footprintRows(footprintContainer, footprint, fields)
                }
            }, LinearLayout.LayoutParams(-1, chrome.dp(28)).apply { topMargin = chrome.dp(2) })
        }
        addActions(body,
            onSave = {
                val next = deepCopy(copy)
                val lon = fields.getValue("longitude").number(-180.0, 180.0) ?: return@addActions
                val lat = fields.getValue("latitude").number(-85.0, 85.0) ?: return@addActions
                next.put("coordinates", JSONArray().put(lon).put(lat))
                val groundText = fields.getValue("groundElevation").text.toString().trim()
                if (groundText == "null" || groundText.isEmpty()) next.put("groundElevation", JSONObject.NULL) else {
                    val ground = groundText.toDoubleOrNull()
                    if (ground == null || !ground.isFinite() || ground !in -12000.0..10000.0) { toast("地面海拔须在 -12000–10000 米内，或填 null"); return@addActions }
                    next.put("groundElevation", ground)
                }
                if (fields.containsKey("centerAltitude")) {
                    val altitude = fields.getValue("centerAltitude").number(-12000.0, 30000.0) ?: return@addActions
                    next.put("centerAltitude", altitude)
                }
                next.put("name", fields.getValue("name").text.toString().take(60))
                next.put("note", fields.getValue("note").text.toString().take(500))
                val color = fields.getValue("color").text.toString()
                if (!HEX.matches(color)) { toast("颜色须为 #RRGGBB"); return@addActions }
                next.put("color", color.lowercase())
                val ranges = mapOf("offset" to (0.0..10000.0), "width" to (0.1..10000.0),
                    "length" to (0.1..10000.0), "height" to (0.1..10000.0),
                    "heading" to (-360.0..360.0), "pitch" to (-360.0..360.0),
                    "roll" to (-360.0..360.0), "opacity" to (0.1..0.85))
                for ((key, range) in ranges) {
                    val value = fields.getValue(key).number(range.start, range.endInclusive) ?: return@addActions
                    next.put(key, value)
                }
                if (fields.containsKey("boreholeDepth")) {
                    val depthText = fields.getValue("boreholeDepth").text.toString().trim()
                    val depth = if (depthText == "null" || depthText.isEmpty()) JSONObject.NULL else {
                        val number = depthText.toDoubleOrNull()
                        if (number == null || !number.isFinite() || number !in 0.1..12000.0) { toast("钻孔深度须在 0.1–12000 米内，或填 null"); return@addActions }
                        number
                    }
                    val borehole = deepCopy(next.optJSONObject("borehole") ?: JSONObject())
                    borehole.put("depth", depth)
                    next.put("borehole", borehole)
                }
                val nextAttributes = JSONArray()
                if (attributes.length() > 40) { toast("自定义条目最多40个"); return@addActions }
                for (index in 0 until attributes.length()) {
                    val name = fields.getValue("attribute_name_$index").text.toString()
                    val value = fields.getValue("attribute_value_$index").text.toString()
                    if (name.length > 60 || value.length > 2000) { toast("条目名称最多60字，内容最多2000字"); return@addActions }
                    val attribute = deepCopy(attributes.optJSONObject(index) ?: JSONObject())
                    attribute.put("name", name).put("value", value)
                    nextAttributes.put(attribute)
                }
                if (attributes.length() > 0 || copy.has("attributes")) next.put("attributes", nextAttributes)
                if (copy.optString("kind") == "prism") {
                    if (footprint.length() !in 3..6000) { toast("轮廓至少需要3个点"); return@addActions }
                    val nextFootprint = JSONArray()
                    for (index in 0 until footprint.length()) {
                        val x = fields.getValue("footprint_x_$index").number(-0.5, 0.5) ?: return@addActions
                        val y = fields.getValue("footprint_y_$index").number(-0.5, 0.5) ?: return@addActions
                        nextFootprint.put(JSONArray().put(x).put(y))
                    }
                    if (!isSimplePolygon(nextFootprint)) { toast("轮廓点须组成有效且不自交的多边形"); return@addActions }
                    next.put("footprint", nextFootprint)
                }
                onSave(next)
            },
            onDelete = { confirmDelete("标记", copy.optString("name"), copy, onDelete) }
        )
        chrome.showPanelWithSlots(
            id = "marker-editor", title = "编辑标记", topAligned = true, width = 220, maxHeightDp = 200,
            fixedHeader = { addEditorHeader(this, "编辑标记") },
            fixedFooter = pendingActionsSlot,
            content = { addView(body) },
        )
    }

    fun showTrack(
        item: JSONObject,
        onSave: (JSONObject) -> Unit,
        onDelete: (JSONObject) -> Unit,
    ) {
        val copy = deepCopy(item)
        val fields = linkedMapOf<String, EditText>()
        val style = copy.optJSONObject("style") ?: JSONObject().put("color", "#ffb477").put("width", 1.5).put("opacity", 1.0)
        val body = LinearLayout(appContext).apply { orientation = LinearLayout.VERTICAL }
        addText(body, "编辑路线样式")
        addInput(body, fields, "名称", "name", copy.optString("name"), 120, compact = false)
        addChoice(body, "地图显示", listOf("显示", "隐藏"), if (copy.optBoolean("hidden", false)) "隐藏" else "显示") {
            copy.put("hidden", it == "隐藏")
        }
        addInput(body, fields, "线条颜色 #RRGGBB", "color", style.optString("color", "#ffb477"), 7, compact = false)
        addInput(body, fields, "线宽（0.5–5，步进0.5）", "width", style.optDouble("width", 1.5).toString(), numeric = true, compact = false)
        addInput(body, fields, "透明度（0.1–1）", "opacity", style.optDouble("opacity", 1.0).toString(), numeric = true, compact = false)
        addText(body, "${copy.optJSONArray("segments")?.length() ?: 0} 段；轨迹点、分段颜色、注记及其它路线元数据保持原样。")
        addActions(body,
            onSave = {
                val next = deepCopy(copy)
                next.put("name", fields.getValue("name").text.toString().take(120))
                val color = fields.getValue("color").text.toString()
                if (!HEX.matches(color)) { toast("颜色须为 #RRGGBB"); return@addActions }
                val width = fields.getValue("width").number(0.5, 5.0) ?: return@addActions
                if (kotlin.math.abs(width * 2 - (width * 2).toInt()) > 1e-6) { toast("线宽须按 0.5 递增"); return@addActions }
                val opacity = fields.getValue("opacity").number(0.1, 1.0) ?: return@addActions
                val nextStyle = deepCopy(style).put("color", color.lowercase()).put("width", width).put("opacity", opacity)
                next.put("style", nextStyle)
                onSave(next)
            },
            onDelete = { confirmDelete("路线", copy.optString("name"), copy, onDelete) }
        )
        chrome.showPanelWithSlots(
            id = "track-editor", title = "编辑路线", topAligned = true, width = 280, maxHeightDp = 200,
            fixedHeader = { addEditorHeader(this, "编辑路线") },
            fixedFooter = pendingActionsSlot,
            content = { addView(body) },
        )
    }

    private fun attributesRows(container: LinearLayout, source: JSONArray, fields: MutableMap<String, EditText>) {
        container.removeAllViews()
        for (index in 0 until source.length()) {
            val attribute = source.optJSONObject(index) ?: JSONObject()
            val row = LinearLayout(appContext).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
            row.addView(inlineInput("名称", attribute.optString("name"), 60).also { fields["attribute_name_$index"] = it }, LinearLayout.LayoutParams(0, chrome.dp(30), 1f))
            row.addView(inlineInput("值 / 单位", attribute.optString("value"), 2000).also { fields["attribute_value_$index"] = it }, LinearLayout.LayoutParams(0, chrome.dp(30), 1f).apply { leftMargin = chrome.dp(3) })
            row.addView(chrome.textButton("×", 14) {
                val updated = JSONArray()
                for (i in 0 until source.length()) if (i != index) updated.put(source.get(i))
                replaceArray(source, updated)
                attributesRows(container, source, fields)
            }.apply { minimumHeight = 0 }, LinearLayout.LayoutParams(chrome.dp(28), chrome.dp(28)))
            container.addView(row, LinearLayout.LayoutParams(-1, chrome.dp(32)).apply { topMargin = chrome.dp(2) })
        }
    }

    private fun footprintRows(container: LinearLayout, source: JSONArray, fields: MutableMap<String, EditText>) {
        container.removeAllViews()
        for (index in 0 until source.length()) {
            val point = source.optJSONArray(index) ?: JSONArray().put(0).put(0)
            val row = LinearLayout(appContext).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
            val indexLabel = TextView(appContext).apply { text = "${index + 1}"; textSize = 11f; setTextColor(ShantuColors.muted); gravity = Gravity.CENTER }
            row.addView(indexLabel, LinearLayout.LayoutParams(chrome.dp(20), chrome.dp(30)))
            row.addView(inlineInput("X", point.optDouble(0).toString(), 0, numeric = true).also { fields["footprint_x_$index"] = it }, LinearLayout.LayoutParams(0, chrome.dp(30), 1f))
            row.addView(inlineInput("Y", point.optDouble(1).toString(), 0, numeric = true).also { fields["footprint_y_$index"] = it }, LinearLayout.LayoutParams(0, chrome.dp(30), 1f).apply { leftMargin = chrome.dp(3) })
            row.addView(chrome.textButton("×", 14) {
                if (source.length() <= 3) { toast("轮廓至少保留3个点"); return@textButton }
                val updated = JSONArray()
                for (i in 0 until source.length()) if (i != index) updated.put(source.get(i))
                replaceArray(source, updated)
                footprintRows(container, source, fields)
            }.apply { minimumHeight = 0 }, LinearLayout.LayoutParams(chrome.dp(28), chrome.dp(28)))
            container.addView(row, LinearLayout.LayoutParams(-1, chrome.dp(32)).apply { topMargin = chrome.dp(2) })
        }
    }

    private fun inlineInput(hint: String, value: String, maxLength: Int, numeric: Boolean = false) = EditText(appContext).apply {
        this.hint = hint
        setText(value)
        textSize = 13f
        setTextColor(ShantuColors.ink)
        setHintTextColor(ShantuColors.muted)
        setPadding(chrome.dp(4), 0, chrome.dp(4), 0)
        background = chrome.surface(4, ShantuColors.raised)
        inputType = if (numeric) InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL or InputType.TYPE_NUMBER_FLAG_SIGNED else InputType.TYPE_CLASS_TEXT
        isSingleLine = true
        if (maxLength > 0) filters = arrayOf(android.text.InputFilter.LengthFilter(maxLength))
    }

    private fun replaceArray(target: JSONArray, value: JSONArray) {
        while (target.length() > 0) target.remove(target.length() - 1)
        for (index in 0 until value.length()) target.put(value.get(index))
    }

    private fun isSimplePolygon(points: JSONArray): Boolean {
        var area = 0.0
        val coords = (0 until points.length()).map { i -> points.getJSONArray(i).let { it.getDouble(0) to it.getDouble(1) } }
        for (index in 0 until points.length()) {
            val a = coords[index]; val b = coords[(index + 1) % coords.size]
            area += a.first * b.second - b.first * a.second
        }
        if (kotlin.math.abs(area) <= 1e-10) return false
        fun cross(a: Pair<Double, Double>, b: Pair<Double, Double>, c: Pair<Double, Double>) =
            (b.first - a.first) * (c.second - a.second) - (b.second - a.second) * (c.first - a.first)
        fun intersects(a: Pair<Double, Double>, b: Pair<Double, Double>, c: Pair<Double, Double>, d: Pair<Double, Double>): Boolean {
            val abC = cross(a, b, c); val abD = cross(a, b, d); val cdA = cross(c, d, a); val cdB = cross(c, d, b)
            return abC * abD < -1e-12 && cdA * cdB < -1e-12
        }
        for (i in coords.indices) for (j in i + 1 until coords.size) {
            if (j == i + 1 || (i == 0 && j == coords.lastIndex)) continue
            if (intersects(coords[i], coords[(i + 1) % coords.size], coords[j], coords[(j + 1) % coords.size])) return false
        }
        return true
    }

    private fun addInput(
        body: LinearLayout,
        fields: MutableMap<String, EditText>,
        label: String,
        key: String,
        value: String,
        maxLength: Int = 0,
        numeric: Boolean = false,
        multiline: Boolean = false,
        compact: Boolean = true,
    ) {
        addText(body, label)
        val edit = EditText(appContext).apply {
            setText(value)
            textSize = if (compact) 13f else 16f
            setTextColor(ShantuColors.ink)
            setHintTextColor(ShantuColors.muted)
            setPadding(chrome.dp(6), chrome.dp(3), chrome.dp(6), chrome.dp(3))
            background = chrome.surface(4, ShantuColors.raised)
            inputType = when { numeric -> InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL or InputType.TYPE_NUMBER_FLAG_SIGNED
                multiline -> InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE
                else -> InputType.TYPE_CLASS_TEXT }
            isSingleLine = !multiline
            minLines = if (multiline) 2 else 1
            if (maxLength > 0) filters = arrayOf(android.text.InputFilter.LengthFilter(maxLength))
        }
        fields[key] = edit
        body.addView(edit, LinearLayout.LayoutParams(-1, chrome.dp(if (multiline) 52 else if (compact) 32 else 40)).apply { topMargin = chrome.dp(2) })
    }

    private fun addChoice(body: LinearLayout, label: String, values: List<String>, initial: String, apply: (String) -> Unit) {
        var selected = values.indexOf(initial).coerceAtLeast(0)
        lateinit var button: TextView
        button = chrome.row("$label：${choiceText(label, values[selected])}") {
            selected = (selected + 1) % values.size
            apply(values[selected])
            button.text = "$label：${choiceText(label, values[selected])}"
        }
        body.addView(button, LinearLayout.LayoutParams(-1, chrome.dp(28)).apply { topMargin = chrome.dp(2) })
    }

    private var pendingActionsSlot: LinearLayout.() -> Unit = {}

    private fun addActions(body: LinearLayout, onSave: () -> Unit, onDelete: () -> Unit) {
        pendingActionsSlot = {
            val actions = LinearLayout(appContext).apply { gravity = Gravity.CENTER_VERTICAL }
            actions.addView(chrome.row("保存", onSave), LinearLayout.LayoutParams(0, chrome.dp(28), 1f))
            actions.addView(chrome.row("删除", onDelete), LinearLayout.LayoutParams(0, chrome.dp(28), 1f).apply { leftMargin = chrome.dp(4) })
            addView(actions, LinearLayout.LayoutParams(-1, chrome.dp(30)).apply { topMargin = chrome.dp(2) })
        }
    }

    private fun addEditorHeader(parent: LinearLayout, title: String) {
        val row = LinearLayout(appContext).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        row.addView(chrome.row("‹ 返回") { chrome.action("favorite") }, LinearLayout.LayoutParams(chrome.dp(52), chrome.dp(30)))
        row.addView(chrome.text(title, 12).apply { setTypeface(null, android.graphics.Typeface.BOLD); setPadding(chrome.dp(6), 0, chrome.dp(6), 0) },
            LinearLayout.LayoutParams(0, chrome.dp(30), 1f))
        parent.addView(row, LinearLayout.LayoutParams(-1, chrome.dp(32)))
    }

    private fun addIconPicker(body: LinearLayout, item: JSONObject) {
        lateinit var button: TextView
        button = chrome.row("图案：${ICON_NAMES[item.optString("icon", "pin")] ?: "地点"}  ▾") {
            lateinit var dialog: AlertDialog
            val grid = GridLayout(appContext).apply {
                columnCount = 3
                setPadding(chrome.dp(8), chrome.dp(4), chrome.dp(8), chrome.dp(4))
            }
            ICONS.forEach { icon ->
                val cell = chrome.row(ICON_NAMES.getValue(icon)) {
                    item.put("icon", icon)
                    button.text = "图案：${ICON_NAMES.getValue(icon)}  ▾"
                    dialog.dismiss()
                }.apply { textSize = 10f; minimumHeight = 0 }
                grid.addView(cell, GridLayout.LayoutParams().apply {
                    width = 0; height = chrome.dp(30); columnSpec = GridLayout.spec(GridLayout.UNDEFINED, 1f)
                    setMargins(chrome.dp(2), chrome.dp(2), chrome.dp(2), chrome.dp(2))
                })
            }
            dialog = AlertDialog.Builder(appContext).setTitle("选择图案").setView(grid).setNegativeButton("取消", null).create()
            dialog.show()
        }
        body.addView(button, LinearLayout.LayoutParams(-1, chrome.dp(28)).apply { topMargin = chrome.dp(2) })
    }

    private fun addColorPicker(body: LinearLayout, fields: MutableMap<String, EditText>, initial: String) {
        val value = EditText(appContext).apply {
            setText(initial); visibility = View.GONE; fields["color"] = this
        }
        lateinit var button: TextView
        fun updateColor(color: String) {
            value.setText(color)
            button.text = "颜色：● ${color.lowercase()}  ▾"
            button.setTextColor(runCatching { android.graphics.Color.parseColor(color) }.getOrDefault(ShantuColors.accent))
        }
        button = chrome.row("颜色：● ${initial.lowercase()}  ▾") {
            lateinit var dialog: AlertDialog
            val content = LinearLayout(appContext).apply { orientation = LinearLayout.VERTICAL; setPadding(chrome.dp(12), chrome.dp(8), chrome.dp(12), chrome.dp(4)) }
            val colors = listOf("#f2b45f", "#ef5652", "#5fdf79", "#598fff", "#a379de", "#ffffff")
            val grid = GridLayout(appContext).apply { columnCount = 3 }
            colors.forEach { color ->
                val chip = chrome.row("●") { updateColor(color); dialog.dismiss() }
                chip.textSize = 20f
                chip.setTextColor(runCatching { android.graphics.Color.parseColor(color) }.getOrDefault(ShantuColors.accent))
                chip.minimumHeight = 0
                grid.addView(chip, GridLayout.LayoutParams().apply { width = chrome.dp(46); height = chrome.dp(32); setMargins(chrome.dp(2), chrome.dp(2), chrome.dp(2), chrome.dp(2)) })
            }
            content.addView(grid)
            val custom = EditText(appContext).apply { setText(value.text); hint = "自定义颜色 #RRGGBB"; textSize = 13f; setSingleLine(true) }
            content.addView(custom, LinearLayout.LayoutParams(-1, chrome.dp(32)).apply { topMargin = chrome.dp(4) })
            dialog = AlertDialog.Builder(appContext).setTitle("选择颜色").setView(content)
                .setNegativeButton("取消", null).setPositiveButton("应用") { _, _ ->
                    val selected = custom.text.toString()
                    if (HEX.matches(selected)) updateColor(selected) else toast("颜色须为 #RRGGBB")
                }.create()
            dialog.show()
        }
        updateColor(initial)
        body.addView(button, LinearLayout.LayoutParams(-1, chrome.dp(28)).apply { topMargin = chrome.dp(2) })
    }

    private fun addText(body: LinearLayout, value: String) {
        body.addView(TextView(appContext).apply {
            text = value
            textSize = 11f
            setTextColor(ShantuColors.muted)
            gravity = Gravity.CENTER_VERTICAL
            setPadding(chrome.dp(2), 0, chrome.dp(2), 0)
        }, LinearLayout.LayoutParams(-1, chrome.dp(20)).apply { topMargin = chrome.dp(2) })
    }

    private fun confirmDelete(kind: String, title: String, value: JSONObject, callback: (JSONObject) -> Unit) {
        AlertDialog.Builder(appContext)
            .setTitle("删除$kind")
            .setMessage("确认删除“${title.ifBlank { "未命名" }}”？")
            .setNegativeButton("取消", null)
            .setPositiveButton("删除") { _, _ -> callback(deepCopy(value)) }
            .show()
    }

    private fun EditText.number(min: Double, max: Double): Double? {
        val value = text.toString().toDoubleOrNull()
        if (value == null || !value.isFinite() || value !in min..max) {
            error("数值须在 $min–$max 范围内")
            requestFocus()
            return null
        }
        return value
    }

    private fun EditText.error(message: String) { setError(message) }
    private fun toast(message: String) = android.widget.Toast.makeText(appContext, message, android.widget.Toast.LENGTH_SHORT).show()
    private fun deepCopy(source: JSONObject) = JSONObject(source.toString())

    private fun choiceText(label: String, value: String): String = when {
        label == "图案" -> ICON_NAMES[value] ?: "地点"
        label == "地表 / 地下" -> if (value == "underground") "地下" else "地表"
        label == "地图显示" -> value
        label == "地形裁切" || label == "地形相交" -> value
        else -> value
    }

    companion object {
        private val HEX = Regex("^#[0-9a-fA-F]{6}$")
        private val ICONS = listOf("pin", "flag", "star", "camp", "mountain", "water", "house", "cave", "danger", "parking", "bridge", "tree", "camera", "sample", "drill", "hospital", "food", "gate")
        private val ICON_NAMES = mapOf("pin" to "地点", "flag" to "旗帜", "star" to "重点", "camp" to "营地", "mountain" to "山峰", "water" to "水源", "house" to "房屋", "cave" to "洞口", "danger" to "危险", "parking" to "停车", "bridge" to "桥梁", "tree" to "树木", "camera" to "拍照", "sample" to "采样", "drill" to "钻孔", "hospital" to "救援", "food" to "餐饮", "gate" to "出入口")

        internal fun initialAttributes(item: JSONObject, templateNames: List<String>): JSONArray {
            item.optJSONArray("attributes")?.let { return JSONArray(it.toString()) }
            return JSONArray().apply { templateNames.take(100).filter { it.isNotBlank() }.forEach { put(JSONObject().put("name", it).put("value", "")) } }
        }
    }
}
