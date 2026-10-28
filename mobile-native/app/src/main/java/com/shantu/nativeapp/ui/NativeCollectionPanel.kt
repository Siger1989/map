package com.shantu.nativeapp.ui

import android.app.AlertDialog
import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.text.Editable
import android.text.TextWatcher
import android.widget.CheckBox
import android.widget.EditText
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import com.shantu.nativeapp.data.NativeCollections
import com.shantu.nativeapp.data.CollectionRecordRef
import com.shantu.nativeapp.data.CollectionUndoToken
import com.shantu.nativeapp.data.NativeCollectionTransform
import com.shantu.nativeapp.data.NativeCollectionTransformSpec
import com.shantu.nativeapp.data.WorkspaceStore
import org.json.JSONArray
import org.json.JSONObject

/** Native collection browser. It stores organization metadata through WorkspaceStore while
 * handing selected record copies back to the host for the existing detail/editor flow. */
class NativeCollectionPanel(
    private val context: Context,
    private val chrome: HomeChrome,
    private val store: WorkspaceStore,
    private val onObject: (container: String, item: JSONObject) -> Unit,
    private val onImport: () -> Unit,
    private val onExport: () -> Unit,
    private val onShare: (List<CollectionRecordRef>) -> Unit = {},
    private val onChanged: () -> Unit = {},
    private val mapCenter: (() -> Pair<Double, Double>?)? = null,
    private val onOpenCache: (() -> Unit)? = null,
    private val onCacheRecords: ((List<CollectionRecordRef>) -> Unit)? = null,
    private val onPreviewTransform: (Map<CollectionRecordRef, JSONObject>) -> Unit = {},
    private val onClearTransformPreview: () -> Unit = {},
) {
    private data class Entry(
        val key: String,
        val container: String,
        val item: JSONObject,
        val name: String,
        val defaultGroup: String,
        val category: String,
        val visible: Boolean,
        val createdAt: Long?,
    )
    private data class FolderTreeRow(val id: String, val depth: Int, val name: String, val hasChildren: Boolean)

    private var selectedTab = "all"
    private var selectedFolder: String? = null
    private val tabOrder = listOf("regions", "all", "cache", "hidden", "route", "track", "pin", "model", "area", "section", "measurement")
    private val tabNames = mapOf("regions" to "地区", "all" to "全部", "cache" to "缓存", "route" to "路线", "track" to "轨迹", "pin" to "标记", "model" to "模型", "area" to "区域", "section" to "剖面", "measurement" to "测量", "hidden" to "隐藏")
    private val selectedKeys = linkedSetOf<String>()
    private var selectMode = false
    private var query = ""
    private var searchDraft = ""
    private var sortMode = "manual"
    private var selectedRegion: String? = null
    private var lastUndo: CollectionUndoToken? = null
    private val collapsedFolders = mutableSetOf<String>()

    fun showSelection(refs:List<CollectionRecordRef>) {
        selectMode=true;selectedKeys.clear()
        refs.forEach { ref -> selectedKeys.add(when(ref.container){"tracks"->"track";"favorites"->"route";"annotations"->"annotation";"areas"->"area";"sections"->"section";"measurements"->"measurement";else->ref.container}+":"+ref.id) }
        selectedTab="all";selectedFolder=null;selectedRegion=null;query="";searchDraft=""
        show()
    }

    fun show() {
        val snapshot = store.load()
        val core = snapshot.optJSONObject("core") ?: JSONObject()
        val layout = try { NativeCollections.validate(core.optJSONObject("collections") ?: NativeCollections.defaultLayout()) }
        catch (error: Exception) { toast(error.message ?: "收藏目录无法读取"); return }
        val entries = readEntries(core)
        val body = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; setPadding(chrome.dp(4), chrome.dp(2), chrome.dp(4), 0) }
        val savedTabs = strings(layout.optJSONArray("tabOrder"))
        val visibleTabs = tabOrder.sortedBy { key -> savedTabs.indexOf(key).let { if (it < 0) Int.MAX_VALUE else it } }
        val header: LinearLayout.() -> Unit = {
            setPadding(chrome.dp(4), 0, chrome.dp(4), 0)
            val actionRow = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
            actionRow.addView(chrome.text("收藏", 14).apply { setTypeface(null, android.graphics.Typeface.BOLD); setTextColor(INK); gravity = Gravity.CENTER_VERTICAL or Gravity.START; setPadding(chrome.dp(6), 0, 0, 0) }, LinearLayout.LayoutParams(0, chrome.dp(32), 1f))
            actionRow.addView(control("导入", onImport), LinearLayout.LayoutParams(chrome.dp(48), chrome.dp(32)).apply { rightMargin = chrome.dp(3) })
            actionRow.addView(control("导出", onExport), LinearLayout.LayoutParams(chrome.dp(48), chrome.dp(32)).apply { rightMargin = chrome.dp(3) })
            actionRow.addView(control(if (selectMode) "取消选" else "多选") { selectMode = !selectMode; selectedKeys.clear(); show() }, LinearLayout.LayoutParams(chrome.dp(48), chrome.dp(32)).apply { rightMargin = chrome.dp(3) })
            actionRow.addView(control("×") { chrome.closePanel() }, LinearLayout.LayoutParams(chrome.dp(32), chrome.dp(32)).apply { rightMargin = chrome.dp(4) })
            addView(actionRow, LinearLayout.LayoutParams(-1, chrome.dp(34)))
            val searchRow = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
            val search = EditText(context).apply {
                hint = "搜索名称"; textSize = 16f; setSingleLine(); setTextColor(INK); setHintTextColor(MUTED)
                setPadding(chrome.dp(8), 0, chrome.dp(8), 0); background = rounded(SURFACE, 4)
                setText(searchDraft)
            }
            search.addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) { searchDraft = s?.toString().orEmpty() }
                override fun afterTextChanged(s: Editable?) = Unit
            })
            searchRow.addView(search, LinearLayout.LayoutParams(0, chrome.dp(36), 1f))
            search.setOnEditorActionListener { _, _, _ -> query = searchDraft.trim(); show(); true }
            searchRow.addView(control("搜索") { query = searchDraft.trim(); show() }, LinearLayout.LayoutParams(chrome.dp(48), chrome.dp(36)).apply { leftMargin = chrome.dp(3) })
            searchRow.addView(control(sortLabel()) { chooseSort() }, LinearLayout.LayoutParams(chrome.dp(52), chrome.dp(36)).apply { leftMargin = chrome.dp(3) })
            addView(searchRow, LinearLayout.LayoutParams(-1, chrome.dp(38)).apply { topMargin = chrome.dp(3) })
            val tabs = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
            visibleTabs.forEach { key -> tabs.addView(control(tabNames.getValue(key), { selectedTab = key; selectedRegion = null; show() }, selected = selectedTab == key), LinearLayout.LayoutParams(chrome.dp(52), chrome.dp(30)).apply { rightMargin = chrome.dp(3) }) }
            addView(HorizontalScrollView(context).apply { isHorizontalScrollBarEnabled = false; addView(tabs, LinearLayout.LayoutParams(-2, chrome.dp(30))) }, LinearLayout.LayoutParams(-1, chrome.dp(32)).apply { topMargin = chrome.dp(2) })
            val categoryOrder = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
            categoryOrder.addView(control("分类上移") { reorderTab(layout, savedTabs, -1) }, LinearLayout.LayoutParams(0, chrome.dp(28), 1f))
            categoryOrder.addView(control("分类下移") { reorderTab(layout, savedTabs, 1) }, LinearLayout.LayoutParams(0, chrome.dp(28), 1f).apply { leftMargin = chrome.dp(4) })
            addView(categoryOrder, LinearLayout.LayoutParams(-1, chrome.dp(30)).apply { topMargin = chrome.dp(2) })
            addView(View(context).apply { setBackgroundColor(LINE) }, LinearLayout.LayoutParams(-1, chrome.dp(1)).apply { topMargin = chrome.dp(3); bottomMargin = chrome.dp(2) })
        }

        val folderName = selectedFolder?.let { if (it == "unfiled") "未分组" else groupPath(layout, it) } ?: "全部文件夹"
        addCaption(body, "目录：$folderName  ·  ${entries.size} 项")
        val folderActions = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
        folderActions.addView(control("＋ 文件夹") { promptCreateFolder(layout) }, LinearLayout.LayoutParams(0, chrome.dp(30), 1f))
        if (selectedFolder != null && selectedFolder != "unfiled" && groupList(layout).any { it.optString("id") == selectedFolder }) {
            folderActions.addView(control("改名") { promptRenameFolder(layout, selectedFolder!!) }, LinearLayout.LayoutParams(0, chrome.dp(30), 1f).apply { leftMargin = chrome.dp(3) })
            folderActions.addView(control("移动") { promptMoveFolder(layout, selectedFolder!!) }, LinearLayout.LayoutParams(0, chrome.dp(30), 1f).apply { leftMargin = chrome.dp(3) })
            folderActions.addView(control("删除") { confirmDeleteFolder(layout, selectedFolder!!) }, LinearLayout.LayoutParams(0, chrome.dp(30), 1f).apply { leftMargin = chrome.dp(3) })
        }
        body.addView(folderActions, LinearLayout.LayoutParams(-1, chrome.dp(32)))
        folderTreeRows(layout).forEach { (id, depth, name, hasChildren) ->
            val line = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
            if (hasChildren) line.addView(control(if (id in collapsedFolders) "›" else "⌄") {
                if (!collapsedFolders.add(id)) collapsedFolders.remove(id)
                show()
            }, LinearLayout.LayoutParams(chrome.dp(26), chrome.dp(30)))
            else line.addView(View(context), LinearLayout.LayoutParams(chrome.dp(26), chrome.dp(30)))
            line.addView(control("${"　".repeat(depth.coerceAtMost(4))}📁 $name", { selectedFolder = id; show() }, selectedFolder == id), LinearLayout.LayoutParams(0, chrome.dp(30), 1f))
            val folderEntries = if (id == "unfiled") entries.filter { resolveGroup(layout, it) == "unfiled" }
                else entries.filter { resolveGroup(layout, it) in descendants(layout, id) }
            if (id != "unfiled" && folderEntries.isNotEmpty()) {
                val allVisible = folderEntries.all { it.visible }
                line.addView(control(if (allVisible) "隐" else "显") {
                    applyBatch(layout, folderEntries.associate { recordRef(it) to !allVisible }, emptyList(), layout)
                }, LinearLayout.LayoutParams(chrome.dp(30), chrome.dp(30)))
            }
            if (id != "unfiled") {
                line.addView(control("↑") { reorderFolder(layout, id, -1) }, LinearLayout.LayoutParams(chrome.dp(30), chrome.dp(30)))
                line.addView(control("↓") { reorderFolder(layout, id, 1) }, LinearLayout.LayoutParams(chrome.dp(30), chrome.dp(30)))
            }
            body.addView(line, LinearLayout.LayoutParams(-1, chrome.dp(32)))
        }

        val regionMap = core.optJSONObject("regions") ?: JSONObject()
        val groupIds = descendants(layout, selectedFolder)
        val needle = query.trim().lowercase()
        val candidates = entries.filter { entry ->
            val inFolder = selectedTab == "regions" || selectedFolder == null || resolveGroup(layout, entry) in groupIds
            val inTab = when (selectedTab) { "all", "regions" -> true; "cache" -> false; "hidden" -> !entry.visible; else -> entry.category == selectedTab }
            inFolder && inTab && (needle.isEmpty() || entry.name.lowercase().contains(needle))
        }
        val ordered = when (sortMode) {
            "name" -> candidates.sortedBy { it.name.lowercase() }
            "manual" -> candidates.sortedBy { strings(layout.optJSONArray("order")).indexOf(it.key).let { i -> if (i < 0) Int.MAX_VALUE else i } }
            else -> NativeCollectionPanelLogic.sort(candidates, candidates.map { entry ->
                NativeCollectionPanelLogic.SortItem(entry.key, entry.category, entry.createdAt, coordinates(entry))
            }, sortMode, mapCenter?.invoke()) { it.key }
        }
        val visibleEntries = if (selectedTab == "regions") ordered.filter { selectedRegion == null || regionLabel(regionMap, it) == selectedRegion } else ordered
        if (selectedTab == "regions") {
            val regions = ordered.map { regionLabel(regionMap, it) }.distinct().sorted()
            val regionRow = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
            regionRow.addView(control("全部地区", { selectedRegion = null; show() }, selectedRegion == null), LinearLayout.LayoutParams(chrome.dp(72), chrome.dp(28)).apply { rightMargin = chrome.dp(3) })
            regions.forEach { region -> regionRow.addView(control(region, { selectedRegion = region; show() }, selectedRegion == region), LinearLayout.LayoutParams(-2, chrome.dp(28)).apply { rightMargin = chrome.dp(3) }) }
            body.addView(HorizontalScrollView(context).apply { isHorizontalScrollBarEnabled = false; addView(regionRow, LinearLayout.LayoutParams(-2, chrome.dp(28))) }, LinearLayout.LayoutParams(-1, chrome.dp(30)))
        }
        addCaption(body, "${if (selectedTab == "regions") selectedRegion ?: "地区汇总" else tabNames[selectedTab] ?: "收藏"} · ${visibleEntries.size} 项")
        if ((selectedTab == "all" || selectedTab == "cache") && onOpenCache != null) {
            body.addView(control("离线地图缓存 · 打开缓存包") { onOpenCache.invoke() }, LinearLayout.LayoutParams(-1, chrome.dp(32)).apply { bottomMargin = chrome.dp(3) })
        } else if (selectedTab == "cache") {
            addCaption(body, "缓存包入口尚未由主界面接入。")
        }
        visibleEntries.forEach { entry ->
            val line = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
            if (selectMode) {
                val check = CheckBox(context).apply { buttonTintList = android.content.res.ColorStateList.valueOf(ACCENT); isChecked = entry.key in selectedKeys; setOnClickListener { if (isChecked) selectedKeys.add(entry.key) else selectedKeys.remove(entry.key); show() } }
                line.addView(check, LinearLayout.LayoutParams(chrome.dp(32), chrome.dp(32)))
            }
            line.addView(control(entry.name.ifBlank { tabNames[entry.category] ?: "收藏" }, { if (selectMode) { if (!selectedKeys.add(entry.key)) selectedKeys.remove(entry.key); show() } else onObject(entry.container, JSONObject(entry.item.toString())) }), LinearLayout.LayoutParams(0, chrome.dp(32), 1f))
            line.addView(chrome.text(groupName(layout, resolveGroup(layout, entry)), 9).apply { gravity = Gravity.CENTER; maxLines = 1; setTextColor(MUTED) }, LinearLayout.LayoutParams(chrome.dp(54), chrome.dp(32)))
            line.addView(control(if (entry.visible) "显" else "隐", { toggleOne(layout, entry) }, entry.visible), LinearLayout.LayoutParams(chrome.dp(32), chrome.dp(32)))
            line.addView(control("移") { promptMoveItem(layout, entries, entry) }, LinearLayout.LayoutParams(chrome.dp(30), chrome.dp(32)))
            line.addView(control("地区") { promptEditRegions(layout, listOf(entry), core) }, LinearLayout.LayoutParams(chrome.dp(38), chrome.dp(32)))
            if (sortMode == "manual") {
                line.addView(control("↑") { moveEntry(layout, entries, entry, -1) }, LinearLayout.LayoutParams(chrome.dp(28), chrome.dp(32)))
                line.addView(control("↓") { moveEntry(layout, entries, entry, 1) }, LinearLayout.LayoutParams(chrome.dp(28), chrome.dp(32)))
            }
            body.addView(line, LinearLayout.LayoutParams(-1, chrome.dp(34)))
        }
        if (visibleEntries.isEmpty()) addCaption(body, if (selectedTab == "regions") "没有可按地区归类的收藏对象。" else if (selectedTab == "cache") "缓存包不属于收藏对象列表。" else "没有符合条件的收藏对象。")
        if (selectMode) addBulkActions(body, layout, entries, visibleEntries)
        lastUndo?.let { token -> body.addView(control("撤销上次目录操作") { if (store.undoCollectionBatch(token)) { lastUndo = null; selectedKeys.clear(); onChanged(); show() } else toast("对象或目录已变化，无法安全撤销") }, LinearLayout.LayoutParams(-1, chrome.dp(32)).apply { topMargin = chrome.dp(4) }) }
        chrome.showCollectionWorkbench("收藏", fixedHeader = header) { addView(body) }
    }

    private fun readEntries(core: JSONObject): List<Entry> {
        val out = mutableListOf<Entry>()
        fun read(container: String, category: String, default: (JSONObject) -> String, visible: (JSONObject) -> Boolean) {
            val array = core.optJSONArray(container) ?: JSONArray()
            for (i in 0 until array.length()) {
                val item = array.optJSONObject(i) ?: continue
                val id = item.optString("id")
                if (id.isBlank()) continue
                val keyType = when (container) { "favorites" -> "route"; "tracks" -> "track"; "annotations" -> "annotation"; "areas" -> "area"; "sections" -> "section"; else -> "measurement" }
                val timestamp = when {
                    item.has("createdAt") -> item.optLong("createdAt")
                    item.has("updatedAt") -> item.optLong("updatedAt")
                    else -> null
                }
                out += Entry("$keyType:$id", container, JSONObject(item.toString()), item.optString("name", category), default(item), category, visible(item), timestamp)
            }
        }
        read("favorites", "route", { it.optJSONObject("route")?.optString("mode", "auto") ?: "auto" }, { it.optBoolean("visible", true) })
        read("tracks", "track", {
            when {
                it.optString("source") == "recorded" -> "recorded"
                it.optString("source") in setOf("gpx", "kml") || it.optJSONArray("samples")?.length()?.let { n -> n > 0 } == true -> "imported"
                else -> "manual"
            }
        }, { !it.optBoolean("hidden", false) })
        read("annotations", "pin", { "unfiled" }, { it.optBoolean("visible", true) })
        // Models share the annotation store; change their category after identifying kind.
        for (i in out.indices) if (out[i].container == "annotations" && out[i].item.optString("kind") != "pin") out[i] = out[i].copy(category = "model")
        read("areas", "area", { "unfiled" }, { it.optBoolean("visible", true) })
        read("sections", "section", { "unfiled" }, { it.optJSONObject("settings")?.optBoolean("enabled", false) == true })
        read("measurements", "measurement", { "unfiled" }, { it.optBoolean("visible", true) })
        return out
    }

    private fun promptCreateFolder(layout: JSONObject) {
        val name = EditText(context).apply { hint = "文件夹名称"; textSize = 16f; setTextColor(ShantuColors.ink) }
        AlertDialog.Builder(context).setTitle("新建文件夹").setView(name)
            .setNegativeButton("取消", null)
            .setPositiveButton("创建") { _, _ -> runCatching { NativeCollections.createFolder(layout, name.text.toString(), selectedFolder?.takeUnless { it == "unfiled" }) }
                .onSuccess { selectedFolder = it.getJSONArray("groups").getJSONObject(it.getJSONArray("groups").length() - 1).getString("id"); runUpdate(it, layout) }
                .onFailure { toast(it.message ?: "文件夹创建失败") } }
            .show()
    }

    private fun promptRenameFolder(layout: JSONObject, id: String) {
        val group = groupList(layout).first { it.optString("id") == id }
        val fields = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; setPadding(chrome.dp(16), 0, chrome.dp(16), 0) }
        val name = EditText(context).apply { hint = "文件夹名称"; setText(group.optString("name")); textSize = 16f; setTextColor(ShantuColors.ink) }
        val color = EditText(context).apply { hint = "颜色 #RRGGBB"; setText(group.optString("color")); textSize = 16f; setTextColor(ShantuColors.ink) }
        fields.addView(name); fields.addView(color)
        AlertDialog.Builder(context).setTitle("编辑文件夹").setView(fields)
            .setNegativeButton("取消", null)
            .setPositiveButton("保存") { _, _ -> runCatching { NativeCollections.renameFolder(layout, id, name.text.toString(), color.text.toString()) }
                .onSuccess { runUpdate(it, layout) }.onFailure { toast(it.message ?: "文件夹修改失败") } }
            .show()
    }

    private fun promptMoveFolder(layout: JSONObject, id: String) {
        val choices: List<Pair<String?, String>> = listOf(null to "收藏根目录") + groupList(layout).map { it.getString("id") to it.optString("name") }
            .filter { it.first != id && (it.first == null || !descendants(layout, id).contains(it.first)) }
        AlertDialog.Builder(context).setTitle("移动文件夹").setItems(choices.map { it.second }.toTypedArray()) { _, index ->
            runCatching { NativeCollections.moveFolder(layout, id, choices[index].first) }.onSuccess { runUpdate(it, layout) }.onFailure { toast(it.message ?: "文件夹移动失败") }
        }.setNegativeButton("取消", null).show()
    }

    private fun confirmDeleteFolder(layout: JSONObject, id: String) {
        val name = groupList(layout).firstOrNull { it.optString("id") == id }?.optString("name") ?: return
        AlertDialog.Builder(context).setTitle("删除文件夹")
            .setMessage("删除“$name”文件夹？收藏对象会保留并移至未分组，子文件夹会提升一级。")
            .setNegativeButton("取消", null)
            .setPositiveButton("删除") { _, _ -> selectedFolder = "unfiled"; runUpdate(NativeCollections.deleteFolder(layout, id), layout) }
            .show()
    }

    private fun promptMoveItem(layout: JSONObject, entries: List<Entry>, entry: Entry) {
        val choices = listOf("未分组" to "unfiled") + groupList(layout).map { it.optString("name") to it.optString("id") }
        AlertDialog.Builder(context).setTitle("移动收藏").setItems(choices.map { it.first }.toTypedArray()) { _, index ->
            val refs = entries.map { NativeCollections.ItemRef(it.key, it.defaultGroup) }
            runCatching { NativeCollections.moveItem(layout, entry.key, choices[index].second, items = refs) }
                .onSuccess { runUpdate(it, layout) }.onFailure { toast(it.message ?: "收藏移动失败") }
        }.setNegativeButton("取消", null).show()
    }

    private fun moveEntry(layout: JSONObject, entries: List<Entry>, entry: Entry, delta: Int) {
        val refs = entries.map { NativeCollections.ItemRef(it.key, it.defaultGroup) }
        val siblings = entries.filter { resolveGroup(layout, it) == resolveGroup(layout, entry) }
            .sortedBy { strings(layout.optJSONArray("order")).indexOf(it.key).let { i -> if (i < 0) Int.MAX_VALUE else i } }
        val index = siblings.indexOfFirst { it.key == entry.key }
        val target = when (delta) { -1 -> if (index > 0) entry.key else null; else -> if (index >= 0 && index + 1 < siblings.size) siblings[index + 1].key else null }
        if (target == null) return
        val next = if (delta < 0) NativeCollections.moveItem(layout, entry.key, resolveGroup(layout, entry), siblings[index - 1].key, refs)
        else NativeCollections.moveItem(layout, target, resolveGroup(layout, entry), entry.key, refs)
        runUpdate(next, layout)
    }

    private fun reorderFolder(layout: JSONObject, id: String, delta: Int) {
        val group = groupList(layout).firstOrNull { it.optString("id") == id } ?: return
        val parent = group.optString("parentId").takeIf { group.has("parentId") }
        val siblings = groupList(layout).filter { it.optString("parentId") == (parent ?: "") }
        val index = siblings.indexOfFirst { it.optString("id") == id }
        val target = when (delta) { -1 -> if (index > 0) siblings[index - 1].optString("id") else null; else -> if (index >= 0 && index + 1 < siblings.size) siblings[index + 1].optString("id") else null }
        if (target == null) return
        val next = if (delta < 0) NativeCollections.moveFolder(layout, id, parent, target) else NativeCollections.moveFolder(layout, target, parent, id)
        runUpdate(next, layout)
    }

    private fun reorderTab(layout: JSONObject, saved: List<String>, delta: Int) {
        runUpdate(NativeCollections.moveVisibleTab(layout, selectedTab, tabOrder, delta), layout)
    }

    private fun runUpdate(layout: JSONObject, expected: JSONObject) {
        runCatching { store.applyCollectionBatch(emptyMap(), emptyList(), expected, layout) }
            .onSuccess { lastUndo = it; onChanged(); show() }
            .onFailure { toast(it.message ?: "收藏目录保存失败") }
    }

    private fun addBulkActions(body: LinearLayout, layout: JSONObject, entries: List<Entry>, visibleEntries: List<Entry>) {
        val selected = entries.filter { it.key in selectedKeys }
        val refs = selected.map(::recordRef)
        val selectionControls = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
        selectionControls.addView(control("全选当前列表") {
            selectedKeys.addAll(visibleEntries.map { it.key })
            show()
        }, LinearLayout.LayoutParams(0, chrome.dp(30), 1f))
        selectionControls.addView(control("反选当前列表") {
            visibleEntries.forEach { if (!selectedKeys.add(it.key)) selectedKeys.remove(it.key) }
            show()
        }, LinearLayout.LayoutParams(0, chrome.dp(30), 1f).apply { leftMargin = chrome.dp(3) })
        body.addView(selectionControls, LinearLayout.LayoutParams(-1, chrome.dp(32)).apply { topMargin = chrome.dp(3) })
        val actions = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
        fun row(vararg labelsAndActions: Pair<String, () -> Unit>) {
            val line = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
            labelsAndActions.forEachIndexed { index, (label, action) ->
                line.addView(control(label, action), LinearLayout.LayoutParams(0, chrome.dp(32), 1f).apply {
                    if (index > 0) leftMargin = chrome.dp(3)
                })
            }
            actions.addView(line, LinearLayout.LayoutParams(-1, chrome.dp(34)))
        }
        row(
            "显示" to { applyBatch(layout, selected.associate { recordRef(it) to true }, emptyList(), layout) },
            "隐藏" to { applyBatch(layout, selected.associate { recordRef(it) to false }, emptyList(), layout) },
            "移动" to { promptBulkMove(layout, selected) },
        )
        val secondaryActions = mutableListOf<Pair<String, () -> Unit>>()
        secondaryActions += "分享" to { if (refs.isEmpty()) toast("先选择收藏对象") else onShare(refs) }
        onCacheRecords?.let { callback ->
            secondaryActions += "缓存" to {
                val cacheable = selected.filter { it.category == "route" || it.category == "track" }.map(::recordRef)
                if (cacheable.isEmpty()) toast("先选择路线或轨迹") else callback(cacheable)
            }
        }
        secondaryActions += "删除" to { confirmBulkDelete(layout, selected) }
        secondaryActions += "地区" to { promptEditRegions(layout, selected, store.load().optJSONObject("core") ?: JSONObject()) }
        secondaryActions += "变换" to { promptBulkTransform(layout, selected) }
        row(*secondaryActions.toTypedArray())
        body.addView(actions, LinearLayout.LayoutParams(-1, chrome.dp(68)).apply { topMargin = chrome.dp(4) })
        if (selected.isEmpty()) addCaption(body, "勾选列表对象后可批量显隐、移动、分享或删除。")
    }

    private fun toggleOne(layout: JSONObject, entry: Entry) =
        applyBatch(layout, mapOf(recordRef(entry) to !entry.visible), emptyList(), layout)

    private fun promptBulkMove(layout: JSONObject, selected: List<Entry>) {
        if (selected.isEmpty()) { toast("先选择收藏对象"); return }
        val choices = listOf("未分组" to "unfiled") + groupList(layout).map { it.optString("name") to it.optString("id") }
        AlertDialog.Builder(context).setTitle("移动 ${selected.size} 项")
            .setItems(choices.map { it.first }.toTypedArray()) { _, index ->
                val refs = readEntries(store.load().optJSONObject("core") ?: JSONObject()).map { NativeCollections.ItemRef(it.key, it.defaultGroup) }
                val next = NativeCollections.moveItems(layout, selected.map { it.key }, choices[index].second, refs)
                runUpdate(next, layout)
            }.setNegativeButton("取消", null).show()
    }

    private fun promptEditRegions(layout:JSONObject,selected:List<Entry>,core:JSONObject) {
        if(selected.isEmpty()){toast("先选择收藏对象");return}
        val regions=core.optJSONObject("regions")?:JSONObject()
        val fields=linkedMapOf<String,EditText>()
        val labels=listOf("country" to "国家 / 地区","province" to "省 / 州","city" to "城市","district" to "区县","township" to "乡镇","street" to "街道","locality" to "地点")
        val body=LinearLayout(context).apply{orientation=LinearLayout.VERTICAL;setPadding(chrome.dp(16),chrome.dp(4),chrome.dp(16),0)}
        addCaption(body,"对所选${selected.size}个对象统一保存地区；每个对象保留自己的坐标与地区字段。")
        for((key,label) in labels){
            val values=selected.map{regions.optJSONObject(it.key)?.optString(key).orEmpty()}.distinct()
            val input=EditText(context).apply{hint=label;textSize=16f;setSingleLine();setTextColor(INK);setHintTextColor(MUTED);setText(values.singleOrNull().orEmpty());setPadding(chrome.dp(8),0,chrome.dp(8),0);background=rounded(SURFACE,4)}
            body.addView(input,LinearLayout.LayoutParams(-1,chrome.dp(38)).apply{topMargin=chrome.dp(3)});fields[key]=input
        }
        val dialog=AlertDialog.Builder(context).setTitle("收藏地区归类").setView(body).setNegativeButton("取消",null).setNeutralButton("清除地区",null).setPositiveButton("保存全部",null).create()
        dialog.setOnShowListener{
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener{
                val changes=linkedMapOf<String,JSONObject>()
                for(entry in selected){val point=coordinates(entry);if(point==null){toast("${entry.name}缺少有效坐标，地区分类未保存");return@setOnClickListener};val key=entry.key;val old=regions.optJSONObject(key);val value=if(old!=null)JSONObject(old.toString())else JSONObject()
                    labels.forEach{(field,_)->value.put(field,fields.getValue(field).text.toString().trim().take(80))}
                    value.put("coordinateKey",NativeCollections.coordinateKey(point.first,point.second)).put("source","manual").put("checkedAt",System.currentTimeMillis());changes[key]=value
                }
                saveRegionChanges(layout,changes,selected.associate{recordRef(it) to it.item},selected.associate{entry->entry.key to regions.optJSONObject(entry.key)?.let{r->JSONObject(r.toString())}})
                dialog.dismiss()
            }
            dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener{saveRegionChanges(layout,selected.associate{it.key to null},selected.associate{recordRef(it) to it.item},selected.associate{entry->entry.key to regions.optJSONObject(entry.key)?.let{r->JSONObject(r.toString())}});dialog.dismiss()}
        }
        dialog.show()
    }

    private fun saveRegionChanges(layout:JSONObject,changes:Map<String,JSONObject?>,expected:Map<CollectionRecordRef,JSONObject>,expectedRegions:Map<String,JSONObject?>){
        runCatching{store.applyCollectionBatch(emptyMap(),emptyList(),layout,layout,regionChanges=changes,expectedRecords=expected,expectedRegionValues=expectedRegions)}
            .onSuccess{lastUndo=it;onChanged();show()}.onFailure{toast(it.message?:"地区分类保存失败")}
    }

    private fun promptBulkTransform(layout:JSONObject,selected:List<Entry>){
        if(selected.isEmpty()){toast("先选择收藏对象");return}
        val fields=linkedMapOf<String,EditText>();val body=LinearLayout(context).apply{orientation=LinearLayout.VERTICAL;setPadding(chrome.dp(16),chrome.dp(4),chrome.dp(16),0)}
        addCaption(body,"平移按米输入；旋转为逆时针角度；缩放围绕所选对象的共同地理中心。模型尺寸、剖面宽高和支线距离同步缩放。")
        val definitions=listOf("east" to "向东（米）","north" to "向北（米）","up" to "向上（米）","rotation" to "逆时针旋转（度）","scale" to "比例因子（0.01–100）")
        for((key,label) in definitions){val input=EditText(context).apply{hint=label;textSize=16f;setSingleLine();setTextColor(INK);setHintTextColor(MUTED);setText(if(key=="scale")"1" else "0");inputType=android.text.InputType.TYPE_CLASS_NUMBER or android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL or android.text.InputType.TYPE_NUMBER_FLAG_SIGNED;setPadding(chrome.dp(8),0,chrome.dp(8),0);background=rounded(SURFACE,4)};body.addView(input,LinearLayout.LayoutParams(-1,chrome.dp(38)).apply{topMargin=chrome.dp(3)});fields[key]=input}
        fun spec(): NativeCollectionTransformSpec {
            fun number(key: String): Double {
                val label = definitions.first { it.first == key }.second
                return fields.getValue(key).text.toString().trim().toDoubleOrNull()
                    ?: throw IllegalArgumentException("${label}不是有效数字")
            }
            return NativeCollectionTransformSpec(number("east"), number("north"), number("up"), number("rotation"), number("scale"))
                .also { it.validate() }
        }
        fun transformed()=NativeCollectionTransform.transformBatch(selected.map{recordRef(it) to it.item},spec())
        val dialog=AlertDialog.Builder(context).setTitle("批量对象变换 · ${selected.size}项").setView(body).setNegativeButton("取消",null).setNeutralButton("地图预览",null).setPositiveButton("应用变换",null).create()
        dialog.setOnDismissListener{onClearTransformPreview()}
        dialog.setOnShowListener{
            dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener{runCatching{transformed()}.onSuccess{preview->runCatching{onPreviewTransform(preview)}.onSuccess{toast("已在地图显示变换预览；尚未保存")}.onFailure{toast(it.message?:"地图预览失败")}}.onFailure{toast(it.message?:"变换参数无效")}}
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener{
                val result=runCatching{transformed()};if(result.isFailure){toast(result.exceptionOrNull()?.message?:"变换参数无效");return@setOnClickListener}
                val updates=result.getOrThrow();val core=store.load().optJSONObject("core")?:JSONObject();val regions=core.optJSONObject("regions")?:JSONObject();val regionChanges=linkedMapOf<String,JSONObject?>();val expectedRegions=linkedMapOf<String,JSONObject?>()
                for((ref,next) in updates){val key=collectionKey(ref);val old=regions.optJSONObject(key);expectedRegions[key]=old?.let{JSONObject(it.toString())};if(old?.optString("source")=="manual"){
                    val point=NativeCollectionTransform.anchor(ref.container,next);regionChanges[key]=if(point==null)JSONObject(old.toString()) else JSONObject(old.toString()).put("coordinateKey",NativeCollections.coordinateKey(point.first,point.second))
                }else regionChanges[key]=null}
                runCatching{store.applyCollectionBatch(emptyMap(),emptyList(),layout,layout,updates=updates,regionChanges=regionChanges,expectedRecords=selected.associate{recordRef(it) to it.item},expectedRegionValues=expectedRegions)}
                    .onSuccess{lastUndo=it;selectedKeys.clear();onClearTransformPreview();onChanged();show();dialog.dismiss()}
                    .onFailure{toast(it.message?:"变换未保存；原对象保持不变")}
            }
        }
        dialog.show()
    }

    private fun collectionKey(ref:CollectionRecordRef):String=NativeCollections.keyFor(ref)

    private fun confirmBulkDelete(layout: JSONObject, selected: List<Entry>) {
        if (selected.isEmpty()) { toast("先选择收藏对象"); return }
        AlertDialog.Builder(context).setTitle("删除所选收藏")
            .setMessage("删除 ${selected.size} 个对象？关联照片和其他数据会保留。此操作可撤销。")
            .setNegativeButton("取消", null)
            .setPositiveButton("删除") { _, _ ->
                val deletes = selected.map(::recordRef)
                val next = NativeCollections.removeItems(layout, selected.map { it.key })
                applyBatch(layout, emptyMap(), deletes, next)
            }.show()
    }

    private fun applyBatch(
        expected: JSONObject,
        visibility: Map<CollectionRecordRef, Boolean>,
        deletes: List<CollectionRecordRef>,
        next: JSONObject,
    ) {
        runCatching { store.applyCollectionBatch(visibility, deletes, expected, next) }
            .onSuccess { lastUndo = it; selectedKeys.clear(); onChanged(); show() }
            .onFailure { toast(it.message ?: "批量操作失败") }
    }

    private fun recordRef(entry: Entry) = CollectionRecordRef(entry.container, entry.item.optString("id"))

    private fun sortLabel() = when (sortMode) {
        "manual" -> "手动"; "name" -> "名称"; "newest" -> "最新"; "oldest" -> "最早"
        "nearest" -> "最近"; "farthest" -> "最远"; "kind" -> "种类"; else -> "手动"
    }

    private fun chooseSort() {
        val center = mapCenter?.invoke()
        val options = mutableListOf("手动顺序", "名称", "最新在前", "最早在前")
        val modes = mutableListOf("manual", "name", "newest", "oldest")
        if (mapCenter != null) {
            options += listOf("从近到远", "从远到近")
            modes += listOf("nearest", "farthest")
        }
        options += "按种类"
        modes += "kind"
        AlertDialog.Builder(context).setTitle("收藏排序")
            .setItems(options.toTypedArray()) { _, index ->
                val mode = modes[index]
                if ((mode == "nearest" || mode == "farthest") && center == null) {
                    toast("当前地图中心不可用，排序未改变")
                } else sortMode = mode
                show()
            }.setNegativeButton("取消", null).show()
    }

    private fun coordinates(entry: Entry): Pair<Double, Double>? {
        fun pair(value: JSONArray?): Pair<Double, Double>? {
            if (value == null || value.length() < 2) return null
            val lon = value.optDouble(0, Double.NaN); val lat = value.optDouble(1, Double.NaN)
            return if (lon.isFinite() && lat.isFinite() && lon in -180.0..180.0 && lat in -90.0..90.0) lon to lat else null
        }
        val item = entry.item
        pair(item.optJSONArray("coordinates"))?.let { return it }
        val routePoints = item.optJSONObject("route")?.optJSONArray("coordinates")
        pair(routePoints?.optJSONArray(0))?.let { return it }
        val segments = item.optJSONArray("segments")
        for (i in 0 until (segments?.length() ?: 0)) {
            val segment = segments?.optJSONArray(i) ?: continue
            pair(segment.optJSONArray(0))?.let { return it }
        }
        pair(item.optJSONArray("boundary")?.optJSONArray(0))?.let { return it }
        val measured = item.optJSONArray("points")?.optJSONObject(0)?.optJSONArray("coordinates")
        pair(measured)?.let { return it }
        return pair(item.optJSONObject("settings")?.optJSONObject("plane")?.optJSONArray("center"))
    }

    private fun regionLabel(regions: JSONObject, entry: Entry): String {
        val region = regions.optJSONObject(entry.key) ?: return "待归类"
        val labels = listOf("country", "province", "city", "district", "township", "street", "locality")
            .map { region.optString(it).trim() }.filter { it.isNotEmpty() }.distinct()
        return labels.joinToString(" / ").ifBlank { "待归类" }
    }

    private fun control(label: String, click: () -> Unit) = control(label, click, false)

    private fun control(label: String, click: () -> Unit, selected: Boolean) = TextView(context).apply {
        text = label; textSize = 11f; includeFontPadding = false; gravity = Gravity.CENTER
        setTextColor(if (selected) ACCENT else INK)
        background = rounded(if (selected) ACCENT_DARK else SURFACE, 3, LINE)
        isClickable = true; isFocusable = true; minimumHeight = 0
        setOnClickListener { click() }
    }

    private fun rounded(color: Int, radius: Int, stroke: Int? = null) = GradientDrawable().apply {
        setColor(color); cornerRadius = chrome.dp(radius).toFloat()
        if (stroke != null) setStroke(chrome.dp(1), stroke)
    }

    private fun resolveGroup(layout: JSONObject, entry: Entry) = layout.getJSONObject("assignments").optString(entry.key).takeIf { it.isNotBlank() } ?: entry.defaultGroup

    private fun descendants(layout: JSONObject, root: String?): Set<String> =
        NativeCollectionPanelLogic.descendantFolderIds(groupList(layout).map {
            NativeCollectionPanelLogic.Folder(it.optString("id"), it.optString("parentId").takeIf { _ -> it.has("parentId") }, it.optString("name"))
        }, root)

    private fun groupPath(layout: JSONObject, id: String): String {
        val group = groupList(layout).firstOrNull { it.optString("id") == id } ?: return "未分组"
        val parent = group.optString("parentId").takeIf { group.has("parentId") }
        return (parent?.let { groupPath(layout, it) + " / " } ?: "") + group.optString("name")
    }

    private fun groupName(layout: JSONObject, id: String) = if (id == "unfiled") "未分组" else groupList(layout).firstOrNull { it.optString("id") == id }?.optString("name") ?: "未分组"

    private fun folderTreeRows(layout: JSONObject): List<FolderTreeRow> {
        val folders = groupList(layout).map {
            group -> NativeCollectionPanelLogic.Folder(group.optString("id"), group.optString("parentId").takeIf { group.has("parentId") }, group.optString("name"))
        }
        return NativeCollectionPanelLogic.visibleFolders(folders, collapsedFolders).map {
            FolderTreeRow(it.folder.id, it.depth, it.folder.name, it.hasChildren)
        } + FolderTreeRow("unfiled", 0, "未分组", false)
    }

    private fun groups(layout: JSONObject) = layout.optJSONArray("groups") ?: JSONArray()
    private fun groupList(layout: JSONObject) = (0 until groups(layout).length()).map { groups(layout).getJSONObject(it) }
    private fun strings(array: JSONArray?) = array?.let { (0 until it.length()).map(it::getString) } ?: emptyList()
    private fun addCaption(body: LinearLayout, text: String) {
        body.addView(TextView(context).apply { this.text = text; textSize = 11f; setTextColor(MUTED); gravity = Gravity.CENTER_VERTICAL; includeFontPadding = false }, LinearLayout.LayoutParams(-1, chrome.dp(22)))
    }
    private fun toast(text: String) = Toast.makeText(context, text, Toast.LENGTH_SHORT).show()

    private companion object {
        val SURFACE = ShantuColors.raised
        val INK = ShantuColors.ink
        val MUTED = ShantuColors.muted
        val LINE = Color.rgb(69, 77, 72)
        val ACCENT_DARK = ShantuColors.raised
        val ACCENT = ShantuColors.accent
    }
}
