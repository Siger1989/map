package com.shantu.nativeapp.data

import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/** Stable reference used for collection bulk actions; payload objects stay in their core array. */
data class CollectionRecordRef(val container: String, val id: String)

/** Pure version-1 collection layout transforms. Collection metadata only references records;
 * none of these operations edits or deletes the saved route/track/annotation objects. */
object NativeCollections {
    data class ItemRef(val key: String, val defaultGroup: String)

    private val idPattern = Regex("^[\\w-]{1,80}$")
    private val itemPattern = Regex("^(route|track|annotation|area|section|measurement):.{1,200}$")
    private val colorPattern = Regex("^#[0-9a-fA-F]{6}$")
    private val tabs = listOf("regions", "all", "cache", "hidden", "route", "track", "pin", "model", "area", "section", "measurement")
    private val groupColors = listOf("#4e79a7", "#59a14f", "#f28e2b", "#af7aa1", "#76b7b2", "#e15759")
    private val groupNames = listOf("驾车路线", "骑行路线", "步行路线", "实走轨迹", "导入轨迹", "手绘轨迹")
    private val groupIds = listOf("auto", "bicycle", "pedestrian", "recorded", "imported", "manual")

    fun deepCopy(layout: JSONObject): JSONObject = JSONObject(layout.toString())

    fun keyFor(ref:CollectionRecordRef):String {
        val kind=when(ref.container){"favorites"->"route";"tracks"->"track";"annotations"->"annotation";"areas"->"area";"sections"->"section";"measurements"->"measurement";else->throw IllegalArgumentException("收藏对象容器无效")}
        require(ref.id.isNotBlank()&&ref.id.length<=200)
        return "$kind:${ref.id}"
    }

    fun recordForKey(key:String):CollectionRecordRef {
        require(itemPattern.matches(key)){"收藏对象引用无效"};val split=key.indexOf(':')
        val container=when(key.substring(0,split)){"route"->"favorites";"track"->"tracks";"annotation"->"annotations";"area"->"areas";"section"->"sections";"measurement"->"measurements";else->throw IllegalArgumentException("收藏对象类型无效")}
        return CollectionRecordRef(container,key.substring(split+1))
    }

    fun coordinateKey(longitude:Double,latitude:Double):String {
        require(longitude.isFinite()&&longitude in -180.0..180.0&&latitude.isFinite()&&latitude in -90.0..90.0){"收藏坐标无效"}
        return String.format(java.util.Locale.ROOT,"%.6f,%.6f",longitude,latitude)
    }

    fun defaultLayout(): JSONObject = JSONObject()
        .put("version", 1)
        .put("groups", JSONArray().also { groups ->
            for (i in groupIds.indices) groups.put(JSONObject()
                .put("id", groupIds[i]).put("name", groupNames[i]).put("color", groupColors[i]))
        })
        .put("assignments", JSONObject())
        .put("order", JSONArray())

    fun parseLayout(raw: String?): JSONObject = if (raw.isNullOrBlank()) defaultLayout() else validate(JSONObject(raw))

    /** Returns an isolated copy; unknown top-level/group fields are retained. */
    fun validate(input: JSONObject): JSONObject {
        val v = deepCopy(input)
        require(v.optInt("version", -1) == 1) { "收藏目录版本无效" }
        val groups = v.optJSONArray("groups") ?: throw IllegalArgumentException("收藏分组无效")
        require(groups.length() <= 64) { "收藏分组最多64个" }
        val ids = mutableSetOf<String>()
        for (index in 0 until groups.length()) {
            val g = groups.optJSONObject(index) ?: throw IllegalArgumentException("收藏分组无效")
            val id = g.optString("id")
            val name = g.optString("name")
            require(idPattern.matches(id) && id != UNFILED && ids.add(id)) { "收藏分组编号无效或重复" }
            require(name.trim().isNotEmpty() && name.length <= 30 && colorPattern.matches(g.optString("color"))) { "收藏分组名称或颜色无效" }
            if (g.has("parentId")) require(idPattern.matches(g.optString("parentId"))) { "收藏文件夹层级无效" }
        }
        val assignments = v.optJSONObject("assignments") ?: throw IllegalArgumentException("收藏归档无效")
        require(assignments.length() <= 12000) { "收藏归档过多" }
        val keys = assignments.keys()
        while (keys.hasNext()) {
            val key = keys.next()
            require(itemPattern.matches(key) && idPattern.matches(assignments.optString(key))) { "收藏归档引用无效" }
        }
        val order = v.optJSONArray("order") ?: throw IllegalArgumentException("收藏顺序无效")
        val orderKeys = (0 until order.length()).map { order.optString(it) }
        require(order.length() <= 12000 && orderKeys.all(itemPattern::matches) && orderKeys.toSet().size == orderKeys.size) { "收藏顺序无效" }
        val groupMap = (0 until groups.length()).associate { groups.getJSONObject(it).getString("id") to groups.getJSONObject(it) }
        for (index in 0 until groups.length()) {
            val id = groups.getJSONObject(index).getString("id")
            val seen = mutableSetOf(id)
            var parent = groups.getJSONObject(index).optString("parentId").takeIf { groups.getJSONObject(index).has("parentId") }
            while (parent != null) {
                val ancestor = parent
                require(ancestor in groupMap && seen.add(ancestor) && seen.size < 9) { "收藏文件夹循环或超过8层" }
                parent = groupMap[ancestor]?.optString("parentId")?.takeIf { groupMap[ancestor]?.has("parentId") == true }
            }
        }
        if (v.has("tabOrder")) {
            val tabOrder = v.optJSONArray("tabOrder") ?: throw IllegalArgumentException("收藏分类顺序无效")
            val values = (0 until tabOrder.length()).map { tabOrder.optString(it) }
            require(values.size <= tabs.size && values.all(tabs::contains) && values.toSet().size == values.size) { "收藏分类顺序无效" }
        }
        if (v.has("treeOrder")) {
            val tree = v.optJSONArray("treeOrder") ?: throw IllegalArgumentException("收藏树顺序无效")
            val values = (0 until tree.length()).map { tree.optString(it) }
            require(values.size <= 12064 && values.all { it.startsWith("folder:") && idPattern.matches(it.removePrefix("folder:")) || itemPattern.matches(it) } && values.toSet().size == values.size) { "收藏树顺序无效" }
        }
        return v
    }

    fun createFolder(layout: JSONObject, name: String, parentId: String? = null, id: String = UUID.randomUUID().toString()): JSONObject {
        val next = validate(layout)
        require(name.trim().isNotEmpty() && name.length <= 30) { "文件夹名称需为1至30个字符" }
        require(idPattern.matches(id) && id != UNFILED && groupList(next).none { it.optString("id") == id }) { "文件夹编号无效或重复" }
        require(parentId == null || groupList(next).any { it.optString("id") == parentId }) { "上级文件夹不存在" }
        require((parentId?.let { depth(next, it) } ?: 0) < 8) { "文件夹最多支持8层" }
        require(groupList(next).none { it.optString("parentId") == (parentId ?: "") && it.optString("name") == name }) { "同级已有同名文件夹" }
        val list = groups(next)
        list.put(JSONObject().put("id", id).put("name", name).put("color", "#4e79a7").also { if (parentId != null) it.put("parentId", parentId) })
        next.put("groups", list)
        appendTree(next, "folder:$id")
        return validate(next)
    }

    fun renameFolder(layout: JSONObject, id: String, name: String, color: String? = null): JSONObject {
        val next = validate(layout)
        require(name.trim().isNotEmpty() && name.length <= 30) { "文件夹名称需为1至30个字符" }
        if (color != null) require(colorPattern.matches(color)) { "文件夹颜色无效" }
        val target = groupList(next).firstOrNull { it.optString("id") == id } ?: throw IllegalArgumentException("文件夹不存在")
        require(groupList(next).none { it.optString("id") != id && it.optString("parentId") == target.optString("parentId") && it.optString("name") == name }) { "同级已有同名文件夹" }
        target.put("name", name)
        if (color != null) target.put("color", color)
        return validate(next)
    }

    fun moveFolder(layout: JSONObject, id: String, parentId: String?, beforeId: String? = null): JSONObject {
        val next = validate(layout)
        val target = groupList(next).firstOrNull { it.optString("id") == id } ?: throw IllegalArgumentException("文件夹不存在")
        require(parentId == null || groupList(next).any { it.optString("id") == parentId }) { "上级文件夹不存在" }
        require(parentId != id && (parentId == null || !descendants(next, id).contains(parentId))) { "不能将文件夹移入自身或下级" }
        require((parentId?.let { depth(next, it) } ?: 0) + subtreeHeight(next, id) <= 8) { "文件夹最多支持8层" }
        require(beforeId == null || groupList(next).any { it.optString("id") == beforeId && it.optString("id") != id && it.optString("parentId") == (parentId ?: "") }) { "目标位置无效" }
        require(groupList(next).none { it.optString("id") != id && it.optString("parentId") == (parentId ?: "") && it.optString("name") == target.optString("name") }) { "目标文件夹中已有同名文件夹" }
        if (parentId == null) target.remove("parentId") else target.put("parentId", parentId)
        val ordered = groups(next)
        val node = removeGroup(ordered, id)
        val beforeIndex = beforeId?.let { findGroupIndex(ordered, it) } ?: -1
        val reinserted = JSONArray()
        for (index in 0 until ordered.length()) {
            if (index == beforeIndex) reinserted.put(node)
            reinserted.put(ordered.get(index))
        }
        if (beforeIndex < 0) reinserted.put(node)
        next.put("groups", reinserted)
        reorderTreeNode(next, "folder:$id", beforeId?.let { "folder:$it" }, parentId?.let { "folder:$it" })
        return validate(next)
    }

    /** Removes only the folder metadata; its child folders are promoted and item assignments become unfiled. */
    fun deleteFolder(layout: JSONObject, id: String): JSONObject {
        val next = validate(layout)
        val target = groupList(next).firstOrNull { it.optString("id") == id } ?: return next
        val parent = target.optString("parentId").takeIf { target.has("parentId") }
        val list = JSONArray()
        for (index in 0 until groups(next).length()) {
            val group = groups(next).getJSONObject(index)
            if (group.optString("id") == id) continue
            if (group.optString("parentId") == id) {
                val copy = deepCopy(group)
                if (parent == null) copy.remove("parentId") else copy.put("parentId", parent)
                list.put(copy)
            } else list.put(group)
        }
        next.put("groups", list)
        val assignments = next.getJSONObject("assignments")
        val keys = assignments.keys()
        val move = mutableListOf<String>()
        while (keys.hasNext()) { val key = keys.next(); if (assignments.optString(key) == id) move.add(key) }
        move.forEach { assignments.put(it, UNFILED) }
        next.put("assignments", assignments)
        removeTreeKey(next, "folder:$id")
        return validate(next)
    }

    fun moveItem(layout: JSONObject, itemKey: String, groupId: String, beforeKey: String? = null, items: List<ItemRef> = emptyList()): JSONObject {
        val next = validate(layout)
        require(itemPattern.matches(itemKey) && (groupId == UNFILED || groupList(next).any { it.optString("id") == groupId })) { "收藏移动目标无效" }
        require(beforeKey == null || itemPattern.matches(beforeKey)) { "收藏顺序目标无效" }
        require(beforeKey != itemKey) { "收藏顺序目标无效" }
        val order = strings(next.optJSONArray("order"))
        if (itemKey !in order) order.add(itemKey)
        order.remove(itemKey)
        val destination = beforeKey?.let(order::indexOf)?.takeIf { it >= 0 } ?: run {
            val last = order.indexOfLast { key -> resolveGroup(next, key, items) == groupId }
            if (last < 0) order.size else last + 1
        }
        order.add(destination.coerceIn(0, order.size), itemKey)
        next.put("order", JSONArray(order))
        next.getJSONObject("assignments").put(itemKey, groupId)
        reorderTreeNode(next, itemKey, beforeKey, groupId.takeIf { it != UNFILED }?.let { "folder:$it" })
        return validate(next)
    }

    fun moveItemToUnfiled(layout: JSONObject, itemKey: String, items: List<ItemRef> = emptyList()): JSONObject = moveItem(layout, itemKey, UNFILED, null, items)

    fun reorderItems(layout: JSONObject, order: List<String>): JSONObject {
        val next = validate(layout)
        require(order.all(itemPattern::matches) && order.toSet().size == order.size) { "收藏顺序无效" }
        val old = strings(next.optJSONArray("order"))
        val desired = order + old.filterNot(order::contains)
        next.put("order", JSONArray(desired))
        val tree = strings(next.optJSONArray("treeOrder"))
        if (tree.isNotEmpty()) {
            val itemSlots = tree.indices.filter { !tree[it].startsWith("folder:") }
            val treeItems = desired.filter { it in tree } + tree.filter { !it.startsWith("folder:") && it !in desired }
            val sorted = tree.toMutableList()
            itemSlots.forEachIndexed { index, slot -> if (index < treeItems.size) sorted[slot] = treeItems[index] }
            next.put("treeOrder", JSONArray(sorted))
        }
        return validate(next)
    }

    /** Remove selected keys from collection indexes only; saved records are retained. */
    fun removeItems(layout: JSONObject, itemKeys: Collection<String>): JSONObject {
        val next = validate(layout)
        val removed = itemKeys.toSet()
        val assignments = next.getJSONObject("assignments")
        removed.forEach { assignments.remove(it) }
        next.put("order", JSONArray(strings(next.optJSONArray("order")).filterNot(removed::contains)))
        if (next.has("treeOrder")) next.put("treeOrder", JSONArray(strings(next.optJSONArray("treeOrder")).filterNot(removed::contains)))
        return validate(next)
    }

    /** Move many selected records in their current display order as one metadata transform. */
    fun moveItems(layout: JSONObject, itemKeys: List<String>, groupId: String, items: List<ItemRef>): JSONObject {
        var next = validate(layout)
        val selected = itemKeys.distinct()
        selected.forEach { key -> next = moveItem(next, key, groupId, null, items) }
        return validate(next)
    }

    fun reorderTabs(layout: JSONObject, order: List<String>): JSONObject {
        val next = validate(layout)
        require(order.size <= tabs.size && order.all(tabs::contains) && order.toSet().size == order.size) { "收藏分类顺序无效" }
        val existing = strings(next.optJSONArray("tabOrder"))
        next.put("tabOrder", JSONArray(order + existing.filterNot(order::contains)))
        return validate(next)
    }

    /** Moves one displayed tab among displayed tabs while keeping hidden tabs in their saved slots. */
    fun moveVisibleTab(layout: JSONObject, selected: String, visibleTabs: List<String>, delta: Int): JSONObject {
        require(visibleTabs.isNotEmpty() && visibleTabs.toSet().size == visibleTabs.size && visibleTabs.all(tabs::contains)) {
            "可见收藏分类无效"
        }
        require(selected in visibleTabs && delta in -1..1) { "收藏分类移动参数无效" }
        val next = validate(layout)
        val saved = strings(next.optJSONArray("tabOrder"))
        val complete = (saved + tabs.filterNot(saved::contains)).toMutableList()
        val slots = complete.indices.filter { complete[it] in visibleTabs }
        val displayed = slots.map { complete[it] }.toMutableList()
        val from = displayed.indexOf(selected)
        val to = (from + delta).coerceIn(0, displayed.lastIndex)
        if (from == to) return next
        displayed.add(to, displayed.removeAt(from))
        slots.forEachIndexed { index, slot -> complete[slot] = displayed[index] }
        return reorderTabs(next, complete)
    }

    private fun groups(layout: JSONObject) = layout.getJSONArray("groups")
    private fun groupList(layout: JSONObject) = (0 until groups(layout).length()).map { groups(layout).getJSONObject(it) }
    private fun depth(layout: JSONObject, id: String): Int {
        val map = (0 until groups(layout).length()).associate { groups(layout).getJSONObject(it).getString("id") to groups(layout).getJSONObject(it) }
        var current: String? = id; var result = 1
        while (current != null && map[current]?.has("parentId") == true) { current = map[current]?.getString("parentId"); result++ }
        return result
    }
    private fun descendants(layout: JSONObject, id: String): Set<String> {
        val out = mutableSetOf(id); var changed = true
        while (changed) { changed = false; for (g in groups(layout).let { a -> (0 until a.length()).map(a::getJSONObject) }) if (g.optString("parentId") in out && out.add(g.optString("id"))) changed = true }
        return out
    }
    private fun subtreeHeight(layout: JSONObject, id: String): Int = descendants(layout, id).maxOfOrNull { depth(layout, it) - depth(layout, id) + 1 } ?: 1
    private fun resolveGroup(layout: JSONObject, key: String, items: List<ItemRef>): String = layout.getJSONObject("assignments").optString(key).takeIf { it.isNotEmpty() } ?: items.firstOrNull { it.key == key }?.defaultGroup ?: UNFILED
    private fun strings(array: JSONArray?) = array?.let { (0 until it.length()).map { index -> it.getString(index) }.toMutableList() } ?: mutableListOf()
    private fun appendTree(layout: JSONObject, key: String) { val tree = strings(layout.optJSONArray("treeOrder")); tree.add(key); layout.put("treeOrder", JSONArray(tree)) }
    private fun removeTreeKey(layout: JSONObject, key: String) { val tree = strings(layout.optJSONArray("treeOrder")); tree.remove(key); if (tree.isNotEmpty() || layout.has("treeOrder")) layout.put("treeOrder", JSONArray(tree)) }
    private fun reorderTreeNode(layout: JSONObject, key: String, before: String?, parent: String?) {
        if (!layout.has("treeOrder")) return
        val tree = strings(layout.optJSONArray("treeOrder")); tree.remove(key)
        val beforeIndex = before?.let(tree::indexOf)?.takeIf { it >= 0 }
        val index = beforeIndex ?: parent?.let { tree.indexOf(it) }?.takeIf { it >= 0 }?.let { parentIndex ->
            val children = descendants(layout, parent.removePrefix("folder:"))
            tree.indexOfLast { it.startsWith("folder:") && it.removePrefix("folder:") in children }.takeIf { it >= parentIndex }?.plus(1) ?: parentIndex + 1
        } ?: tree.size
        tree.add(index.coerceIn(0, tree.size), key)
        layout.put("treeOrder", JSONArray(tree))
    }
    private fun removeGroup(array: JSONArray, id: String): JSONObject {
        val kept = JSONArray(); var removed: JSONObject? = null
        for (i in 0 until array.length()) { val item = array.getJSONObject(i); if (item.optString("id") == id) removed = item else kept.put(item) }
        while (array.length() > 0) array.remove(array.length() - 1)
        for (i in 0 until kept.length()) array.put(kept.get(i))
        return removed ?: throw IllegalArgumentException("文件夹不存在")
    }
    private fun findGroupIndex(array: JSONArray, id: String) = (0 until array.length()).firstOrNull { array.getJSONObject(it).optString("id") == id } ?: -1
    private const val UNFILED = "unfiled"
}
