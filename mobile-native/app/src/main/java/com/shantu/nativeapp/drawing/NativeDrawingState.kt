package com.shantu.nativeapp.drawing

import com.shantu.nativeapp.navigation.NativeCoordinate
import com.shantu.nativeapp.navigation.NativePlannedRoute
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import kotlin.math.abs

enum class NativeDrawingSnapMode { NODE, ROAD, RIVER, OFF }

data class NativeDrawingNodeRef(val segment: Int, val index: Int)

/** Mutable, UI-independent drawing document. Every edit is an isolated JSON snapshot. */
class NativeDrawingState private constructor(
    initial: JSONObject,
    pausedInitially: Boolean,
    snapInitially: NativeDrawingSnapMode,
    modeInitially: String,
    private val recordId: String?,
) {
    private var document = copy(initial)
    private val undoStack = mutableListOf<String>()
    private val redoStack = mutableListOf<String>()
    var paused: Boolean = pausedInitially
        private set
    var snapMode: NativeDrawingSnapMode = snapInitially
        private set
    var travelMode: String = modeInitially
        private set
    val canUndo get() = undoStack.isNotEmpty()
    val canRedo get() = redoStack.isNotEmpty()
    val isContinuation get() = recordId != null

    fun snapshot(): JSONObject = copy(document)
    fun nodes(): List<Pair<Int, NativeCoordinate>> = readSegments(document).flatMapIndexed { segment, line ->
        line.map { segment to it }
    }
    fun pointCount(): Int = readSegments(document).sumOf { it.size }
    fun segmentCount(): Int = readSegments(document).size

    fun setPaused(value: Boolean) { paused = value }
    fun setSnapMode(value: NativeDrawingSnapMode) { snapMode = value }
    fun setTravelMode(value: String) {
        require(value in TRAVEL_MODES) { "出行方式无效" }
        travelMode = value
    }

    fun setName(name: String) = mutate {
        val normalized = name.trim()
        require(normalized.length <= 60) { "名称最多60个字符" }
        document.put("name", normalized)
    }

    fun setNote(note: String) = mutate {
        require(note.length <= MAX_NOTE_LENGTH) { "说明最多1600个字符" }
        document.put("note", note)
    }

    fun setColorCondition(color: String, condition: String) = mutate {
        require(COLOR.matches(color)) { "颜色格式无效" }
        require(condition.length <= MAX_NOTE_LENGTH) { "路况备注最多1600个字符" }
        val conditions = document.optJSONObject("colorConditions")?.let { JSONObject(it.toString()) } ?: JSONObject()
        conditions.put(color.lowercase(), condition)
        document.put("colorConditions", conditions)
    }

    fun setStyleColor(color: String) = mutate {
        require(COLOR.matches(color)) { "颜色格式无效" }
        style().put("color", color.lowercase())
    }

    fun setStyleWidth(width: Double) = mutate {
        require(width.isFinite() && width in .5..5.0 && width * 2 % 1.0 == 0.0) { "线宽需为0.5至5像素，按0.5递增" }
        style().put("width", width)
    }

    fun setStyleOpacity(opacity: Double) = mutate {
        require(opacity.isFinite() && opacity in .1..1.0) { "不透明度需在10%至100%之间" }
        style().put("opacity", opacity)
    }

    fun appendPoint(point: NativeCoordinate): Boolean = mutateBoolean {
        validate(point)
        val segments = segmentsArray()
        val last = if (segments.length() == 0) null else segments.optJSONArray(segments.length() - 1)
        if (last != null && last.length() > 0 && same(readCoordinate(last.getJSONArray(last.length() - 1)), point)) return@mutateBoolean false
        if (pointCount() >= MAX_POINTS) throw IllegalArgumentException("轨迹点数已达6000点上限")
        val previousLength = last?.length() ?: 0
        if (last == null) segments.put(JSONArray().put(point.toJson())) else last.put(point.toJson())
        document.put("segments", segments)
        if (previousLength > 0) appendAuxiliaryEdge(lastSegmentIndex = segments.length() - 1)
        ensureNode(point)
        if (previousLength == 0 && !document.has("drawingLocation")) {
            document.put("drawingLocation", JSONObject()
                .put("coordinate", point.toJson())
                .put("label", ""))
        }
        true
    }

    /** Commit one freehand gesture as one segment and one undo entry. */
    fun appendStroke(points: List<NativeCoordinate>): Boolean = mutateBoolean {
        require(points.size >= 2) { "手绘线至少需要两个有效坐标" }
        points.forEach(::validate)
        val stroke = points.fold(mutableListOf<NativeCoordinate>()) { output, point ->
            if (output.lastOrNull()?.let { same(it, point) } != true) output += point
            output
        }
        require(stroke.size >= 2) { "手绘线至少需要两个不同坐标" }
        require(pointCount() + stroke.size <= MAX_POINTS) { "轨迹点数已达6000点上限" }
        require(segmentCount() < MAX_SEGMENTS) { "路线超过100段上限" }
        val segments = readSegments(document).toMutableList()
        segments += stroke
        document.put("segments", writeSegments(segments))
        appendSegmentEdges(stroke.size, segments.lastIndex)
        ensureNode(stroke.first())
        ensureNode(stroke.last())
        true
    }

    /** Insert between the existing vertices at index-1 and index. */
    fun insertNode(segmentIndex: Int, index: Int, point: NativeCoordinate): Boolean = mutateBoolean {
        validate(point)
        val segments = segmentsArray()
        require(segmentIndex in 0 until segments.length()) { "路线节点已变化" }
        val line = segments.getJSONArray(segmentIndex)
        require(index in 1 until line.length()) { "请选择两个相邻节点之间的位置" }
        require(pointCount() < MAX_POINTS) { "轨迹点数已达6000点上限" }
        segments.put(segmentIndex, insertValue(line, index, point.toJson()))
        rebuildEdgeAuxiliary(segmentIndex, index)
        document.put("segments", segments)
        ensureNode(point)
        true
    }

    /** Remove one vertex; if it was inside a line, leave a gap rather than invent an edge. */
    fun deleteNode(segmentIndex: Int, index: Int): Boolean = mutateBoolean {
        val segments = readSegments(document)
        require(segmentIndex in segments.indices && index in segments[segmentIndex].indices) { "路线节点已变化" }
        val before = segments[segmentIndex]
        val removedPoint = before[index]
        val outputSegments = mutableListOf<List<NativeCoordinate>>()
        val outputColors = mutableListOf<List<Any?>>()
        val outputNotes = mutableListOf<List<Any?>>()
        val colors = document.optJSONArray("edgeColors")
        val notes = document.optJSONArray("edgeNotes")
        segments.forEachIndexed { s, line ->
            val runs = mutableListOf<Pair<Int, List<NativeCoordinate>>>()
            var start = 0
            line.forEachIndexed { i, point ->
                if (s == segmentIndex && i == index) {
                    if (i > start) runs += start to line.subList(start, i)
                    start = i + 1
                }
            }
            if (start < line.size) runs += start to line.subList(start, line.size)
            runs.forEach { (runStart, run) ->
                outputSegments += run
                outputColors += edgeRow(colors?.optJSONArray(s), runStart, run.size - 1)
                outputNotes += edgeRow(notes?.optJSONArray(s), runStart, run.size - 1)
            }
        }
        document.put("segments", writeSegments(outputSegments))
        if (colors != null) document.put("edgeColors", writeRows(outputColors))
        if (notes != null) document.put("edgeNotes", writeRows(outputNotes))
        removeNodeReferences(removedPoint, outputSegments)
        true
    }

    /** Delete a batch in one undo step while preserving every surviving run as a separate segment. */
    fun deleteNodes(selection: Set<NativeDrawingNodeRef>): Int {
        if (selection.isEmpty()) return 0
        var removed = 0
        mutate {
            val segments = readSegments(document)
            selection.forEach { require(it.segment in segments.indices && it.index in segments[it.segment].indices) { "路线节点已变化" } }
            val output = mutableListOf<List<NativeCoordinate>>()
            val colors = mutableListOf<List<Any?>>()
            val notes = mutableListOf<List<Any?>>()
            val colorRows = document.optJSONArray("edgeColors")
            val noteRows = document.optJSONArray("edgeNotes")
            segments.forEachIndexed { segmentIndex, line ->
                var runStart = 0
                fun keep(end: Int) {
                    if (end <= runStart) return
                    val run = line.subList(runStart, end)
                    output += run
                    colors += edgeRow(colorRows?.optJSONArray(segmentIndex), runStart, run.size - 1)
                    notes += edgeRow(noteRows?.optJSONArray(segmentIndex), runStart, run.size - 1)
                }
                line.forEachIndexed { index, point ->
                    if (NativeDrawingNodeRef(segmentIndex, index) in selection) {
                        keep(index)
                        runStart = index + 1
                        removed++
                    }
                }
                keep(line.size)
            }
            document.put("segments", writeSegments(output))
            if (colorRows != null) document.put("edgeColors", writeRows(colors))
            if (noteRows != null) document.put("edgeNotes", writeRows(notes))
            // Reconcile node/terminal references after all geometry has been rebuilt.
            document.optJSONArray("nodes")?.let { nodes ->
                val retained = (0 until nodes.length()).mapNotNull { nodes.optJSONArray(it)?.let(::readCoordinate) }
                    .filter { point -> output.flatten().any { same(it, point) } }
                document.put("nodes", writeCoordinates(retained.distinctBy { "${it.longitude},${it.latitude}" }))
            }
            document.optJSONObject("routeTerminals")?.let { terminals ->
                listOf("start", "end").forEach { key ->
                    terminals.optJSONArray(key)?.let { terminal ->
                        if (output.flatten().none { same(it, readCoordinate(terminal)) }) terminals.remove(key)
                    }
                }
            }
            document.optJSONObject("pointDetails")?.let { details ->
                val live = output.flatten().map { "${it.longitude},${it.latitude}" }.toSet()
                val keys = (0 until details.length()).toList().filter { index -> details.names()?.optString(index)?.let { it !in live } == true }
                    .mapNotNull { details.names()?.optString(it) }
                keys.forEach(details::remove)
            }
        }
        return removed
    }

    /** Add a branch as its own segment; a one-point segment is a valid branch anchor. */
    fun appendBranch(anchor: NativeCoordinate, point: NativeCoordinate): Boolean = mutateBoolean {
        validate(anchor); validate(point)
        require(pointCount() + (if (same(anchor, point)) 1 else 2) <= MAX_POINTS) { "轨迹点数已达6000点上限" }
        require(segmentCount() < MAX_SEGMENTS) { "路线超过100段上限" }
        val branch = if (same(anchor, point)) listOf(anchor) else listOf(anchor, point)
        val segments = readSegments(document) + listOf(branch)
        document.put("segments", writeSegments(segments))
        appendSegmentEdges(branch.size, segments.lastIndex)
        ensureNode(anchor); ensureNode(point)
        true
    }

    /** Explicitly connect two selected nodes with a real connector segment. */
    fun connectNodes(first: NativeDrawingNodeRef, second: NativeDrawingNodeRef): Boolean = mutateBoolean {
        val segments = readSegments(document)
        require(first.segment in segments.indices && first.index in segments[first.segment].indices && second.segment in segments.indices && second.index in segments[second.segment].indices) { "路线节点已变化" }
        val a = segments[first.segment][first.index]; val b = segments[second.segment][second.index]
        require(!same(a, b)) { "所选节点已经重合" }
        require(segmentCount() < MAX_SEGMENTS && pointCount() + 2 <= MAX_POINTS) { "路线超过100段或6000点上限" }
        val all = segments + listOf(listOf(a, b))
        document.put("segments", writeSegments(all)); appendSegmentEdges(2, all.lastIndex)
        true
    }

    /** Merge only segments sharing the exact endpoint; never fabricate a bridge. */
    fun mergeSegments(first: Int, second: Int): Boolean = mutateBoolean {
        val segments = readSegments(document)
        require(first in segments.indices && second in segments.indices && first != second) { "请选择两条有效线段" }
        val a = segments[first]; val b = segments[second]
        val orientation = when {
            same(a.last(), b.first()) -> 0
            same(a.last(), b.last()) -> 1
            same(a.first(), b.last()) -> 2
            same(a.first(), b.first()) -> 3
            else -> throw IllegalArgumentException("线段端点未相接；请先明确连接节点")
        }
        val merged = when (orientation) {
            0 -> a + b.drop(1)
            1 -> a + b.asReversed().drop(1)
            2 -> b + a.drop(1)
            else -> b.asReversed() + a.drop(1)
        }
        fun joinedRows(key: String): JSONArray? {
            val rows = document.optJSONArray(key) ?: return null
            fun row(index: Int, length: Int) = edgeRow(rows.optJSONArray(index), 0, length - 1)
            val left = row(first, a.size); val right = row(second, b.size)
            val joined = when (orientation) {
                0 -> left + right
                1 -> left + right.asReversed()
                2 -> right + left
                else -> right.asReversed() + left
            }
            val entries = segments.indices.filter { it != first && it != second }.map { index ->
                index to row(index, segments[index].size)
            }.toMutableList()
            entries.add(minOf(first, second).coerceAtMost(entries.size), -1 to joined)
            return writeRows(entries.map { it.second })
        }
        val out = segments.filterIndexed { index, _ -> index != first && index != second }.toMutableList()
        out.add(minOf(first, second).coerceAtMost(out.size), merged)
        document.put("segments", writeSegments(out))
        joinedRows("edgeColors")?.let { document.put("edgeColors", it) }
        joinedRows("edgeNotes")?.let { document.put("edgeNotes", it) }
        true
    }

    fun moveNode(segmentIndex: Int, index: Int, point: NativeCoordinate): Boolean = mutateBoolean {
        validate(point)
        val segments = segmentsArray()
        require(segmentIndex in 0 until segments.length()) { "路线节点已变化" }
        val line = segments.getJSONArray(segmentIndex)
        require(index in 0 until line.length()) { "路线节点已变化" }
        val from = readCoordinate(line.getJSONArray(index))
        if (same(from, point)) return@mutateBoolean false
        for (s in 0 until segments.length()) {
            val candidate = segments.getJSONArray(s)
            for (i in 0 until candidate.length()) {
                if (same(readCoordinate(candidate.getJSONArray(i)), from)) candidate.put(i, point.toJson())
            }
        }
        document.put("segments", segments)
        replaceNodeReferences(from, point)
        replaceTerminalReferences(from, point)
        replacePointDetails(from, point)
        true
    }

    fun reverse() = mutate {
        val oldSegments = readSegments(document)
        document.put("segments", writeSegments(oldSegments.asReversed().map { it.asReversed() }))
        document.optJSONArray("nodes")?.let { nodes -> document.put("nodes", JSONArray((0 until nodes.length()).map { nodes.get(it) }.reversed())) }
        reverseRows("edgeColors")
        reverseRows("edgeNotes")
        document.optJSONArray("roadLegs")?.let { roads ->
            document.put("roadLegs", JSONArray().also { out ->
                for (i in roads.length() - 1 downTo 0) {
                    val leg = roads.optJSONObject(i) ?: continue
                    val coords = leg.optJSONArray("coordinates") ?: JSONArray()
                    val reversed = JSONArray((0 until coords.length()).map { coords.get(it) }.reversed())
                    out.put(JSONObject(leg.toString()).put("coordinates", reversed))
                }
            })
        }
        document.optJSONObject("routeTerminals")?.let { terminals ->
            val start = terminals.opt("start")
            val end = terminals.opt("end")
            if (end != null) terminals.put("start", end)
            else terminals.remove("start")
            if (start != null) terminals.put("end", start)
            else terminals.remove("end")
        }
    }

    /** Append only the service's road geometry; no straight access connector is presented as a road. */
    fun appendRoadLeg(route: NativePlannedRoute): Boolean = mutateBoolean {
        require(route.mode in TRAVEL_MODES) { "出行方式无效" }
        val road = route.roadLegs.lastOrNull() ?: throw IllegalArgumentException("路线服务没有返回道路路段")
        require(road.size >= 2) { "道路路段不足两个节点" }
        if (pointCount() + road.size > MAX_POINTS) throw IllegalArgumentException("轨迹点数已达6000点上限")
        val segments = readSegments(document).toMutableList()
        segments += road
        document.put("segments", writeSegments(segments))
        appendSegmentEdges(road.size, segments.lastIndex)
        val allRoads = document.optJSONArray("roadLegs") ?: JSONArray()
        document.put("roadLegs", JSONArray(allRoads.toString()).put(JSONObject()
            .put("mode", route.mode)
            .put("coordinates", JSONArray().also { out -> road.forEach { out.put(it.toJson()) } })
            .put("accessDistance", route.accessDistance)))
        document.put("navigationMode", route.mode)
        route.snapped.forEach(::ensureNode)
        travelMode = route.mode
        true
    }

    fun appendRiverLeg(points: List<NativeCoordinate>): Boolean = mutateBoolean {
        require(points.size >= 2) { "河流吸附没有返回有效线段" }
        points.forEach(::validate)
        require(pointCount() + points.size <= MAX_POINTS) { "轨迹点数已达6000点上限" }
        val segments = readSegments(document).toMutableList()
        segments += points
        document.put("segments", writeSegments(segments))
        appendSegmentEdges(points.size, segments.lastIndex)
        val legs = document.optJSONArray("riverLegs") ?: JSONArray()
        legs.put(JSONArray().also { out -> points.forEach { out.put(it.toJson()) } })
        document.put("riverLegs", legs)
        points.forEach(::ensureNode)
        true
    }

    fun undo(): Boolean {
        if (undoStack.isEmpty()) return false
        redoStack += document.toString()
        document = JSONObject(undoStack.removeAt(undoStack.lastIndex))
        paused = true
        return true
    }

    fun redo(): Boolean {
        if (redoStack.isEmpty()) return false
        undoStack += document.toString()
        document = JSONObject(redoStack.removeAt(redoStack.lastIndex))
        paused = true
        return true
    }

    fun toTrack(): JSONObject = copy(document).apply {
        put("updatedAt", System.currentTimeMillis())
        if (!optString("name").isNotBlank()) put("name", "新建线条")
        if (!has("drawingLocation")) readSegments(this).firstOrNull()?.firstOrNull()?.let { point ->
            put("drawingLocation", JSONObject().put("coordinate", point.toJson()).put("label", ""))
        }
    }

    fun toDraft(): JSONObject = JSONObject()
        .put("format", DRAFT_FORMAT)
        .put("version", DRAFT_VERSION)
        .put("track", copy(document))
        .put("paused", paused)
        .put("snapMode", snapMode.name.lowercase())
        .put("travelMode", travelMode)
        .put("recordId", recordId ?: JSONObject.NULL)

    private fun mutate(block: () -> Unit) {
        val before = document.toString()
        val beforeTravelMode = travelMode
        try {
            block()
            validateDocument(document)
            if (before != document.toString()) remember(before)
        } catch (error: Throwable) {
            document = JSONObject(before)
            travelMode = beforeTravelMode
            throw error
        }
    }

    private fun mutateBoolean(block: () -> Boolean): Boolean {
        val before = document.toString()
        val beforeTravelMode = travelMode
        try {
            val changed = block()
            if (changed) {
                validateDocument(document)
                if (before != document.toString()) remember(before)
            }
            return changed
        } catch (error: Throwable) {
            document = JSONObject(before)
            travelMode = beforeTravelMode
            throw error
        }
    }

    private fun remember(before: String) {
        undoStack += before
        if (undoStack.size > HISTORY_LIMIT) undoStack.removeAt(0)
        redoStack.clear()
    }

    private fun style(): JSONObject {
        val existing = document.optJSONObject("style")
        val next = if (existing == null) JSONObject().put("color", DEFAULT_COLOR).put("width", 1.5).put("opacity", 1.0)
            else JSONObject(existing.toString())
        document.put("style", next)
        return next
    }

    private fun segmentsArray() = JSONArray(document.optJSONArray("segments")?.toString() ?: "[]")

    private fun appendAuxiliaryEdge(lastSegmentIndex: Int) {
        val colorRows = document.optJSONArray("edgeColors")
        colorRows?.let { rows ->
            while (rows.length() <= lastSegmentIndex) rows.put(JSONArray())
            val row = rows.getJSONArray(lastSegmentIndex)
            row.put(row.opt(row.length() - 1) ?: style().optString("color", DEFAULT_COLOR))
        }
        val noteRows = document.optJSONArray("edgeNotes")
        noteRows?.let { rows ->
            while (rows.length() <= lastSegmentIndex) rows.put(JSONArray())
            rows.getJSONArray(lastSegmentIndex).put(JSONObject.NULL)
        }
    }

    private fun appendSegmentEdges(pointCount: Int, segmentIndex: Int) {
        document.optJSONArray("edgeColors")?.let { rows ->
            while (rows.length() < segmentIndex) rows.put(JSONArray())
            rows.put(JSONArray().also { row -> repeat((pointCount - 1).coerceAtLeast(0)) { row.put(style().optString("color", DEFAULT_COLOR)) } })
        }
        document.optJSONArray("edgeNotes")?.let { rows ->
            while (rows.length() < segmentIndex) rows.put(JSONArray())
            rows.put(JSONArray().also { row -> repeat((pointCount - 1).coerceAtLeast(0)) { row.put(JSONObject.NULL) } })
        }
    }

    private fun rebuildEdgeAuxiliary(segmentIndex: Int, index: Int) {
        val colors = document.optJSONArray("edgeColors")
        colors?.optJSONArray(segmentIndex)?.let { row ->
            val edge = row.opt(index - 1)
            colors.put(segmentIndex, insertValue(row, index, edge ?: JSONObject.NULL))
        }
        val notes = document.optJSONArray("edgeNotes")
        notes?.optJSONArray(segmentIndex)?.let { row ->
            val edge = row.opt(index - 1) ?: JSONObject.NULL
            notes.put(segmentIndex, insertValue(row, index, edge))
        }
    }

    private fun insertValue(array: JSONArray, index: Int, value: Any): JSONArray = JSONArray().also { out ->
        for (i in 0 until array.length()) {
            if (i == index) out.put(value)
            out.put(array.get(i))
        }
        if (index >= array.length()) out.put(value)
    }

    private fun edgeRow(row: JSONArray?, start: Int, count: Int): List<Any?> = if (row == null || count <= 0) emptyList()
        else (start until (start + count).coerceAtMost(row.length())).map { row.opt(it) }

    private fun removeNodeReferences(point: NativeCoordinate, remaining: List<List<NativeCoordinate>>) {
        // Coordinates can be shared by more than one segment. Keep explicit node and
        // terminal references while any surviving geometry still uses that coordinate.
        if (remaining.flatten().any { same(it, point) }) return
        val nodeList = document.optJSONArray("nodes") ?: JSONArray()
        val known = remaining.flatten().toList()
        val retained = (0 until nodeList.length()).mapNotNull { i ->
            val item = nodeList.optJSONArray(i) ?: return@mapNotNull null
            val coord = readCoordinate(item)
            coord.takeUnless { same(it, point) || known.none { candidate -> same(candidate, it) } }
        }
        if (document.has("nodes")) document.put("nodes", writeCoordinates(retained))
        document.optJSONObject("routeTerminals")?.let { terminal ->
            listOf("start", "end").forEach { key ->
                terminal.optJSONArray(key)?.let { if (same(readCoordinate(it), point)) terminal.remove(key) }
            }
        }
    }

    private fun replaceNodeReferences(from: NativeCoordinate, to: NativeCoordinate) {
        document.optJSONArray("nodes")?.let { nodes ->
            for (i in 0 until nodes.length()) nodes.optJSONArray(i)?.let { if (same(readCoordinate(it), from)) nodes.put(i, to.toJson()) }
        }
    }

    private fun replaceTerminalReferences(from: NativeCoordinate, to: NativeCoordinate) {
        document.optJSONObject("routeTerminals")?.let { terminal ->
            listOf("start", "end").forEach { key ->
                terminal.optJSONArray(key)?.let { if (same(readCoordinate(it), from)) terminal.put(key, to.toJson()) }
            }
        }
    }

    private fun replacePointDetails(from: NativeCoordinate, to: NativeCoordinate) {
        document.optJSONObject("pointDetails")?.let { details ->
            val oldKey = "${from.longitude},${from.latitude}"
            val newKey = "${to.longitude},${to.latitude}"
            val moving = details.optJSONObject(oldKey) ?: return@let
            val target = details.optJSONObject(newKey)
            val merged = JSONObject(target?.toString() ?: "{}")
            val oldNote = moving.optString("note").takeIf { it.isNotBlank() }
            val targetNote = merged.optString("note").takeIf { it.isNotBlank() }
            if (oldNote != null || targetNote != null) {
                val note = listOfNotNull(oldNote, targetNote).distinct().joinToString("；")
                require(note.length <= MAX_NOTE_LENGTH) { "拼接点备注超过1600字，请先整理备注" }
                merged.put("note", note)
            }
            for (key in moving.keys()) if (key != "note") merged.put(key, moving.get(key))
            details.put(newKey, merged)
            details.remove(oldKey)
        }
    }

    private fun ensureNode(point: NativeCoordinate) {
        val nodes = document.optJSONArray("nodes") ?: JSONArray()
        if ((0 until nodes.length()).none { nodes.optJSONArray(it)?.let { node -> same(readCoordinate(node), point) } == true })
            nodes.put(point.toJson())
        document.put("nodes", nodes)
    }

    private fun reverseRows(key: String) {
        document.optJSONArray(key)?.let { rows ->
            document.put(key, JSONArray().also { out ->
                for (i in rows.length() - 1 downTo 0) {
                    val row = rows.optJSONArray(i) ?: JSONArray()
                    out.put(JSONArray((0 until row.length()).map { row.get(it) }.reversed()))
                }
            })
        }
    }

    private fun validateDocument(value: JSONObject) {
        require(value.optString("id").isNotBlank() && value.optString("id").length <= 250) { "路线编号无效" }
        require(value.optString("name").length <= 200) { "路线名称过长" }
        require(value.opt("createdAt") is Number && value.optDouble("createdAt").isFinite()) { "创建时间无效" }
        val segments = readSegments(value)
        require(segments.size <= MAX_SEGMENTS && segments.sumOf { it.size } <= MAX_POINTS) { "路线超过100段或6000点上限" }
        if (value.optString("source") == "manual") require(segments.all { it.isNotEmpty() }) { "路线线段不能没有节点" }
        segments.flatten().forEach(::validate)
        value.optJSONObject("style")?.let { style ->
            require(COLOR.matches(style.optString("color")) && style.optDouble("width", 1.5) in .5..5.0) { "路线样式无效" }
            if (style.has("opacity")) require(style.optDouble("opacity").isFinite() && style.optDouble("opacity") in .1..1.0) { "路线透明度无效" }
        }
    }

    private fun NativeCoordinate.toJson() = JSONArray().put(longitude).put(latitude)

    companion object {
        const val MAX_POINTS = 6000
        const val MAX_SEGMENTS = 100
        const val MAX_NOTE_LENGTH = 1600
        const val DRAFT_FORMAT = "shantu-native-drawing-draft"
        const val DRAFT_VERSION = 1
        const val DEFAULT_COLOR = "#ffb477"
        val TRAVEL_MODES = setOf("auto", "bicycle", "pedestrian")
        private val COLOR = Regex("^#[0-9a-fA-F]{6}$")
        private const val HISTORY_LIMIT = 100

        fun newTrack(name: String = "", styleDefaults: JSONObject? = null): NativeDrawingState {
            val now = System.currentTimeMillis()
            val color=styleDefaults?.optString("color",DEFAULT_COLOR)?.takeIf { COLOR.matches(it) } ?: DEFAULT_COLOR
            val width=styleDefaults?.optDouble("width",1.5)?.takeIf { it.isFinite() }?.coerceIn(.5,5.0) ?: 1.5
            val opacity=styleDefaults?.optDouble("opacity",1.0)?.takeIf { it.isFinite() }?.coerceIn(.1,1.0) ?: 1.0
            val pointSize=styleDefaults?.optInt("pointSize",8)?.coerceIn(4,16) ?: 8
            val colorMode=styleDefaults?.optString("colorMode","solid")?.takeIf { it in setOf("solid","speed","slope","elevation") } ?: "solid"
            val persistedTravel=styleDefaults?.optString("travelMode")?.takeIf { it in setOf("walk","run","bicycle","motorcycle","car") }
            val mode=when(persistedTravel) { "car","motorcycle"->"auto"; "bicycle"->"bicycle"; else->"pedestrian" }
            val track = JSONObject().put("id", UUID.randomUUID().toString())
                .put("name", name.trim().take(60)).put("createdAt", now).put("source", "manual")
                .put("segments", JSONArray()).put("style", JSONObject()
                    .put("color", color).put("width", width).put("opacity", opacity).put("pointSize",pointSize).put("colorMode",colorMode)
                    .also { if(persistedTravel!=null) it.put("travelMode",persistedTravel) })
            return NativeDrawingState(track, false, NativeDrawingSnapMode.NODE, mode, null)
        }

        /** Existing drawings are edited in-place on save; timed/recorded lines become a separate manual clone. */
        fun continueFrom(saved: JSONObject, existingDraft: JSONObject? = null): NativeDrawingState {
            val restored = existingDraft?.let { runCatching { restore(it) }.getOrNull() }
            if (restored != null && restored.pointCount() > 0) return restored
            val track = copy(saved)
            val timed = track.optString("source") == "recorded" || track.has("samples")
            val priorId = track.optString("id")
            track.put("source", "manual")
            track.remove("samples"); track.remove("simulation"); track.remove("sharedRoute")
            if (timed) {
                track.put("id", UUID.randomUUID().toString())
                track.put("name", "${track.optString("name")} · 手绘副本".take(60))
                val sources = track.optJSONArray("sourceTrackIds") ?: JSONArray()
                if ((0 until sources.length()).none { sources.optString(it) == priorId } && priorId.isNotBlank()) sources.put(priorId)
                track.put("sourceTrackIds", sources)
            }
            if (track.optJSONObject("style") == null) track.put("style", JSONObject().put("color", DEFAULT_COLOR).put("width", 1.5).put("opacity", 1.0))
            return NativeDrawingState(track, false, NativeDrawingSnapMode.NODE,
                track.optString("navigationMode").takeIf { it in TRAVEL_MODES } ?: "pedestrian", if (timed) null else priorId)
        }

        fun restore(draft: JSONObject): NativeDrawingState {
            if (!draft.has("format") && draft.has("id") && draft.optJSONArray("points") != null) {
                val points = draft.getJSONArray("points")
                require(points.length() <= MAX_POINTS) { "草稿超过6000点上限" }
                val line = JSONArray()
                for (index in 0 until points.length()) {
                    val coordinate = points.optJSONArray(index) ?: throw IllegalArgumentException("路线坐标无效")
                    line.put(readCoordinate(coordinate).toJson())
                }
                val track = JSONObject().put("id", draft.optString("id").takeIf { it.isNotBlank() } ?: UUID.randomUUID().toString())
                    .put("name", draft.optString("name").take(60))
                    .put("createdAt", draft.optLong("createdAt", System.currentTimeMillis()))
                    .put("source", "manual")
                    .put("segments", if (line.length() == 0) JSONArray() else JSONArray().put(line))
                    .put("style", JSONObject().put("color", DEFAULT_COLOR).put("width", 1.5).put("opacity", 1.0))
                return NativeDrawingState(track, true, NativeDrawingSnapMode.NODE, "pedestrian", null)
            }
            require(draft.optString("format") == DRAFT_FORMAT && draft.optInt("version") == DRAFT_VERSION) { "画线草稿格式无法识别" }
            val track = draft.optJSONObject("track") ?: throw IllegalArgumentException("画线草稿内容缺失")
            val mode = draft.optString("snapMode", "node").uppercase().let { runCatching { NativeDrawingSnapMode.valueOf(it) }.getOrDefault(NativeDrawingSnapMode.NODE) }
            val travel = draft.optString("travelMode", "pedestrian").takeIf { it in TRAVEL_MODES } ?: "pedestrian"
            val recordId = (draft.opt("recordId") as? String)?.takeIf { it.isNotBlank() }
            val state = NativeDrawingState(copy(track), draft.optBoolean("paused", true), mode, travel, recordId)
            state.validateDocument(state.document)
            return state
        }

        private fun readSegments(track: JSONObject): List<List<NativeCoordinate>> {
            val array = track.optJSONArray("segments") ?: return emptyList()
            return (0 until array.length()).map { i ->
                val line = array.optJSONArray(i) ?: throw IllegalArgumentException("路线坐标无效")
                (0 until line.length()).map { j -> readCoordinate(line.optJSONArray(j) ?: throw IllegalArgumentException("路线坐标无效")) }
            }
        }

        private fun readCoordinate(array: JSONArray): NativeCoordinate {
            require(array.length() >= 2)
            val lon = array.optDouble(0, Double.NaN); val lat = array.optDouble(1, Double.NaN)
            val result = NativeCoordinate(lon, lat)
            validate(result)
            return result
        }

        private fun validate(point: NativeCoordinate) {
            require(point.longitude.isFinite() && point.latitude.isFinite() && point.longitude in -180.0..180.0 && point.latitude in -85.051129..85.051129) { "坐标无效" }
        }

        private fun same(a: NativeCoordinate, b: NativeCoordinate) = abs(a.longitude - b.longitude) <= 1e-8 && abs(a.latitude - b.latitude) <= 1e-8
        private fun copy(value: JSONObject) = JSONObject(value.toString())
        private fun writeSegments(lines: List<List<NativeCoordinate>>) = JSONArray().also { out -> lines.forEach { line -> out.put(writeCoordinates(line)) } }
        private fun writeCoordinates(points: List<NativeCoordinate>) = JSONArray().also { out -> points.forEach { out.put(it.toJson()) } }
        private fun writeRows(rows: List<List<Any?>>) = JSONArray().also { out -> rows.forEach { row -> out.put(JSONArray().also { values -> row.forEach { values.put(it ?: JSONObject.NULL) } }) } }
    }
}
