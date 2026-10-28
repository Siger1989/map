package com.shantu.nativeapp.data

import android.content.Context
import android.util.AtomicFile
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.nio.charset.StandardCharsets
import java.util.Base64
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/** Counts describe incoming records only; receiver-only records are never removed. */
data class ImportSummary(
    val added: Map<String, Int>,
    val overwritten: Map<String, Int>,
)

data class NativeTaskMigrationImportResult(val tracks: List<JSONObject>, val fileReferences: List<JSONObject>)

data class CollectionUndoToken internal constructor(val value: String)

/**
 * A separate, native workspace snapshot. This store deliberately has no access to the
 * legacy WebView/Android preference stores. Every import is validated and merged in
 * memory before a single AtomicFile commit.
 */
class WorkspaceStore(context: Context) {
    private val appContext = context.applicationContext
    private val file = AtomicFile(context.applicationContext.filesDir.resolve("workspace-v2.json"))
    private data class RecordDelta(
        val ref: CollectionRecordRef,
        val before: JSONObject,
        val beforeIndex: Int,
        val after: JSONObject?,
        val afterIndex: Int,
    )
    private data class JsonValue(val present: Boolean, val wrapped: String?)
    private data class CollectionUndoDelta(
        val records: List<RecordDelta>,
        val metadataBefore: Map<String, JsonValue>,
        val metadataAfter: Map<String, JsonValue>,
        val regionsBefore: Map<String, JsonValue>,
        val regionsAfter: Map<String, JsonValue>,
        val regionsContainerBefore: Boolean?,
    )
    private val collectionUndo = linkedMapOf<String, CollectionUndoDelta>()

    @Synchronized
    fun load(): JSONObject = lock.withLock { readCurrent() }

    @Synchronized
    fun updateSetting(key:String,value:String) = lock.withLock {
        val current=readCurrent();val next=JSONObject(current.toString())
        next.getJSONObject("settings").put(key,value);validateWorkspace(next);commit(next,current)
    }

    /** Parameters and notes commit together; concurrent edits are never silently replaced. */
    @Synchronized
    fun replaceSections(expectedSections:JSONArray,expectedNotes:JSONArray,sections:JSONArray,notes:JSONArray)=lock.withLock {
        val current=readCurrent();val core=current.getJSONObject("core")
        require((core.optJSONArray("sections") ?: JSONArray()).toString()==expectedSections.toString() &&
            (core.optJSONArray("sectionNotes") ?: JSONArray()).toString()==expectedNotes.toString()) { "剖面已在其他操作中变更，请重新打开后保存" }
        val next=JSONObject(current.toString())
        next.getJSONObject("core").put("sections",JSONArray(sections.toString())).put("sectionNotes",JSONArray(notes.toString()))
        validateWorkspace(next);commit(next,current)
    }

    /** Explicit source-manager save replaces its catalog atomically, including deletions. */
    @Synchronized
    fun replaceMapSources(sources: JSONArray) = lock.withLock {
        val current=readCurrent()
        val next=JSONObject(current.toString()).put("mapSources",JSONArray(sources.toString()))
            .put("nativeSourceCatalogManaged",true)
        validateWorkspace(next)
        commit(next,current)
    }

    @Synchronized
    fun importWorkspace(input: InputStream): ImportSummary = lock.withLock {
        val bytes = readBounded(input, WORKSPACE_MAX_BYTES)
        val parsed = try {
            JSONObject(String(bytes, StandardCharsets.UTF_8))
        } catch (e: JSONException) {
            throw IllegalArgumentException("工作区 JSON 无效", e)
        }
        val legacyV1 = parsed.optString("format") == "guanyun-backup"
        val normalized = normalizeIncoming(parsed)
        validateWorkspace(normalized)
        val current = readCurrent()
        val merged = if (legacyV1) mergeLegacyWorkspace(current, normalized) else mergeWorkspace(current, normalized)
        validateWorkspace(merged)
        val summary = summarizeImport(current, normalized)
        commit(merged, current)
        summary
    }

    /** Merge a validated legacy transfer payload into the native workspace. */
    @Synchronized
    fun importRoutes(routes: JSONObject): ImportSummary = lock.withLock {
        val incoming = normalizeLegacy(routes)
        validateCore(incoming.getJSONObject("core"))
        val current = readCurrent()
        val merged = JSONObject(current.toString()).put("core", mergeLegacyCore(current.getJSONObject("core"), incoming.getJSONObject("core")))
        validateWorkspace(merged)
        val summary = summarizeImport(current, incoming)
        commit(merged, current)
        summary
    }

    /** Explicit, confirmed task handoff. Every imported task becomes a saved track; ID collisions are copied. */
    @Synchronized
    fun importTaskMigration(input: InputStream): NativeTaskMigrationImportResult = lock.withLock {
        val parsed = NativeTaskMigration.parse(String(readBounded(input, NativeTaskMigration.MAX_BYTES), StandardCharsets.UTF_8))
        val current = readCurrent()
        val next = JSONObject(current.toString())
        val core = next.getJSONObject("core")
        val tracks = JSONArray(core.optJSONArray("tracks")?.toString() ?: "[]")
        val ids = (0 until tracks.length()).mapNotNull { tracks.optJSONObject(it)?.optString("id") }.toMutableSet()
        val copied = mutableListOf<JSONObject>()
        parsed.toTracks().forEach { item ->
            val sourceId = item.optString("id")
            var newId = sourceId
            if (newId in ids) {
                var suffix = 1
                do { newId = "${sourceId.take(220)}-migrated-$suffix"; suffix++ } while (newId in ids)
                item.put("migrationSourceId", sourceId)
                item.put("id", newId)
            }
            ids += newId
            tracks.put(item)
            copied += JSONObject(item.toString())
        }
        require(tracks.length() <= 100) { "迁入后轨迹超过100条；本机数据未更改" }
        core.put("tracks", tracks)
        validateWorkspace(next)
        commit(next, current)
        NativeTaskMigrationImportResult(copied, (0 until parsed.fileReferences.length()).map { parsed.fileReferences.getJSONObject(it) })
    }

    /** Export all native tracks, favorites and pins as GPX or GeoJSON bytes. */
    @Synchronized
    fun exportRoutes(format: NativeRouteFormats.Format): ByteArray = lock.withLock {
        NativeRouteFormats.exportFile(format, readCurrent(), NativeImportedSettings.readRuntime(appContext).areaUnit)
    }

    /** Organization changes are atomic and never rewrite collection objects. */
    @Synchronized
    fun updateCollections(layout: JSONObject) = lock.withLock {
        val validated = NativeCollections.validate(layout)
        val current = readCurrent()
        val next = JSONObject(current.toString())
        next.getJSONObject("core").put("collections", validated)
        validateWorkspace(next)
        commit(next, current)
    }

    /**
     * Atomic collection bulk action with an optimistic metadata check. Only selected records and
     * changed collection metadata are retained for undo; unrelated workspace data is never rolled
     * back. Visibility maps to the native schema for each record container.
     */
    @Synchronized
    fun applyCollectionBatch(
        visibility: Map<CollectionRecordRef, Boolean>,
        deletes: List<CollectionRecordRef>,
        expectedCollections: JSONObject,
        nextCollections: JSONObject,
        updates: Map<CollectionRecordRef, JSONObject> = emptyMap(),
        regionChanges: Map<String, JSONObject?> = emptyMap(),
        expectedRecords: Map<CollectionRecordRef, JSONObject> = emptyMap(),
        expectedRegionValues: Map<String, JSONObject?> = emptyMap(),
    ): CollectionUndoToken = lock.withLock {
        val current = readCurrent()
        val core = current.getJSONObject("core")
        val oldLayout = NativeCollections.validate(core.optJSONObject("collections") ?: NativeCollections.defaultLayout())
        val expected = NativeCollections.validate(expectedCollections)
        require(jsonEquals(oldLayout, expected)) { "收藏目录已被其他操作更新，请刷新后重试" }
        val nextLayout = NativeCollections.validate(nextCollections)
        val deleteRefs = deletes.distinct()
        require(visibility.keys.intersect(deleteRefs.toSet()).isEmpty()) { "同一对象不能同时显隐和删除" }
        require(updates.keys.intersect(deleteRefs.toSet()).isEmpty() && updates.keys.intersect(visibility.keys).isEmpty()) { "同一对象不能重复编辑" }
        require(expectedRecords.keys.all { it in visibility || it in deleteRefs || it in updates || regionChanges.containsKey(NativeCollections.keyFor(it)) }) { "收藏对象快照引用无效" }
        require(updates.isEmpty() || expectedRecords.keys.containsAll(updates.keys)) { "编辑操作缺少对象快照" }
        require(expectedRegionValues.keys.containsAll(regionChanges.keys)) { "地区编辑缺少地区快照" }
        val refs = (visibility.keys + deleteRefs + updates.keys + expectedRecords.keys).distinct()
        val deltas = mutableListOf<RecordDelta>()
        val next = JSONObject(current.toString())
        val nextCore = next.getJSONObject("core")
        val allowed = setOf("tracks", "annotations", "favorites", "sections", "areas", "measurements")
        refs.forEach { ref ->
            require(ref.container in allowed && ref.id.isNotBlank()) { "收藏对象引用无效" }
            val array = nextCore.optJSONArray(ref.container) ?: throw IllegalArgumentException("收藏对象不存在")
            val index = (0 until array.length()).firstOrNull { array.optJSONObject(it)?.optString("id") == ref.id }
                ?: throw IllegalArgumentException("收藏对象已不存在，请刷新后重试")
            val before = JSONObject(array.getJSONObject(index).toString())
            expectedRecords[ref]?.let { require(jsonEquals(before, it)) { "收藏对象已变化，请刷新后重试" } }
            val updated = updates[ref]?.let { JSONObject(it.toString()) } ?: JSONObject(before.toString())
            require(updated.optString("id") == ref.id) { "更新对象编号不能改变" }
            visibility[ref]?.let { visible ->
                when (ref.container) {
                    "tracks" -> updated.put("hidden", !visible)
                    "sections" -> (updated.optJSONObject("settings")?.let { JSONObject(it.toString()) } ?: JSONObject())
                        .also { it.put("enabled", visible); updated.put("settings", it) }
                    else -> updated.put("visible", visible)
                }
            }
            val isDeleted = ref in deleteRefs
            val after = if (isDeleted) null else updated
            val afterIndex = if (isDeleted) -1 else index
            val replaced = JSONArray()
            for (i in 0 until array.length()) {
                if (i == index) { if (!isDeleted) replaced.put(updated) }
                else replaced.put(array.get(i))
            }
            nextCore.put(ref.container, replaced)
            deltas += RecordDelta(ref, before, index, after?.let { JSONObject(it.toString()) }, afterIndex)
        }
        val removedKeys = deleteRefs.map { collectionKey(it) }
        val cleanedLayout = NativeCollections.removeItems(nextLayout, removedKeys)
        nextCore.put("collections", cleanedLayout)
        val beforeRegions = core.optJSONObject("regions") ?: JSONObject()
        val afterRegions = JSONObject(beforeRegions.toString())
        for((key,expectedValue) in expectedRegionValues){
            require(keyPattern.matches(key)) { "收藏地区快照引用无效" }
            val actual=beforeRegions.optJSONObject(key)
            require((actual==null&&expectedValue==null)||(actual!=null&&expectedValue!=null&&jsonEquals(actual,expectedValue))) { "收藏地区已变化，请刷新后重试" }
        }
        val removedRegionKeys = removedKeys.filter(beforeRegions::has)
        removedRegionKeys.forEach { afterRegions.remove(it) }
        for ((key, value) in regionChanges) {
            require(keyPattern.matches(key)) { "收藏地区引用无效" }
            require(recordExists(core, key)) { "收藏地区对象已不存在，请刷新后重试" }
            require(expectedRecords.containsKey(NativeCollections.recordForKey(key))) { "地区编辑缺少收藏对象快照" }
            if (value == null) afterRegions.remove(key) else afterRegions.put(key, JSONObject(value.toString()))
        }
        val changedRegionKeys = (removedRegionKeys + regionChanges.keys).distinct()
        if (core.has("regions") || afterRegions.length() > 0) nextCore.put("regions", afterRegions)
        else nextCore.remove("regions")

        val changedKeys = (oldLayout.keys().asSequence().toSet() + cleanedLayout.keys().asSequence().toSet())
            .filter { !jsonEquals(oldLayout.opt(it), cleanedLayout.opt(it)) || oldLayout.has(it) != cleanedLayout.has(it) }
        val beforeMeta = changedKeys.associateWith { snapshotValue(oldLayout, it) }
        val afterMeta = changedKeys.associateWith { snapshotValue(cleanedLayout, it) }
        val regionsBefore = changedRegionKeys.associateWith { snapshotValue(beforeRegions, it) }
        val regionsAfter = changedRegionKeys.associateWith { snapshotValue(afterRegions, it) }
        val regionsContainerBefore = if (changedRegionKeys.isNotEmpty()) core.has("regions") else null
        validateWorkspace(next)
        commit(next, current)

        val token = CollectionUndoToken(java.util.UUID.randomUUID().toString())
        collectionUndo[token.value] = CollectionUndoDelta(deltas, beforeMeta, afterMeta, regionsBefore, regionsAfter, regionsContainerBefore)
        while (collectionUndo.size > 8) collectionUndo.remove(collectionUndo.keys.first())
        token
    }

    /** Undo only if all affected records/metadata still match this action's result. */
    @Synchronized
    fun undoCollectionBatch(token: CollectionUndoToken): Boolean = lock.withLock {
        val delta = collectionUndo[token.value] ?: return@withLock false
        val current = readCurrent()
        val core = current.getJSONObject("core")
        val layout = NativeCollections.validate(core.optJSONObject("collections") ?: NativeCollections.defaultLayout())
        if (delta.metadataAfter.any { (key, value) -> !matchesValue(layout, key, value) }) return@withLock false
        val currentRegions = core.optJSONObject("regions") ?: JSONObject()
        if (delta.regionsAfter.any { (key, value) -> !matchesValue(currentRegions, key, value) }) return@withLock false
        for (record in delta.records) {
            val source = core.optJSONArray(record.ref.container) ?: JSONArray()
            val matches = (0 until source.length()).filter { source.optJSONObject(it)?.optString("id") == record.ref.id }
            if (record.after == null) {
                if (matches.isNotEmpty()) return@withLock false
            } else if (matches.size != 1 || !jsonEquals(source.optJSONObject(matches.single()), record.after)) return@withLock false
        }
        val next = JSONObject(current.toString())
        val nextCore = next.getJSONObject("core")
        delta.records.groupBy { it.ref.container }.forEach { (container, records) ->
            val source = nextCore.optJSONArray(container) ?: JSONArray()
            val affectedIds = records.map { it.ref.id }.toSet()
            val kept = (0 until source.length()).filter { source.optJSONObject(it)?.optString("id") !in affectedIds }
                .map { source.get(it) }
            val restored = records.sortedBy { it.beforeIndex }.toMutableList()
            val result = kept.toMutableList()
            restored.forEach { record -> result.add(record.beforeIndex.coerceIn(0, result.size), JSONObject(record.before.toString())) }
            nextCore.put(container, JSONArray(result))
        }
        val restoredLayout = NativeCollections.deepCopy(layout)
        delta.metadataBefore.forEach { (key, value) -> applyValue(restoredLayout, key, value) }
        nextCore.put("collections", NativeCollections.validate(restoredLayout))
        if (delta.regionsBefore.isNotEmpty()) {
            val restoredRegions = JSONObject((nextCore.optJSONObject("regions") ?: JSONObject()).toString())
            delta.regionsBefore.forEach { (key, value) -> applyValue(restoredRegions, key, value) }
            if (delta.regionsContainerBefore == false && restoredRegions.length() == 0) nextCore.remove("regions")
            else nextCore.put("regions", restoredRegions)
        }
        validateWorkspace(next)
        commit(next, current)
        collectionUndo.remove(token.value)
        true
    }

    @Synchronized
    fun exportWorkspace(output: OutputStream) = lock.withLock {
        val snapshot = JSONObject(readCurrent().toString())
        val maps = linkedMapOf<String, JSONObject>()
        val configured = snapshot.optJSONArray("mapSources") ?: JSONArray()
        for (i in 0 until configured.length()) configured.optJSONObject(i)?.let { maps[it.optString("id")] = JSONObject(it.toString()) }
        val offlineMaps = com.shantu.nativeapp.offlineMaps.NativeOfflineMapStore(appContext)
        offlineMaps.list().forEach { map -> maps[map.id] = offlineMaps.exportLegacyStoredMap(map.id) }
        snapshot.put("mapSources", JSONArray(maps.values.toList()))
        val bytes = snapshot.toString().toByteArray(StandardCharsets.UTF_8)
        require(bytes.size <= WORKSPACE_MAX_BYTES) { "工作区备份超过100MB" }
        output.write(bytes)
        output.flush()
    }

    /** Upsert one record into a supported collection by its stable id. */
    @Synchronized
    fun upsert(container: String, entity: JSONObject) = lock.withLock {
        val current = readCurrent()
        val next = JSONObject(current.toString())
        val id = entity.optString("id", "")
        require(id.isNotBlank() && id.length <= 250) { "记录编号无效" }
        when (container) {
            "tracks", "annotations", "favorites", "sections", "areas", "measurements",
            "photos", "mapSources", "cadDocuments", "industryProjects" -> {
                val array = if (container == "tracks" || container == "annotations" || container == "favorites" ||
                    container == "sections" || container == "areas" || container == "measurements") {
                    next.getJSONObject("core").optJSONArray(container) ?: JSONArray().also { next.getJSONObject("core").put(container, it) }
                } else next.optJSONArray(container) ?: JSONArray().also { next.put(container, it) }
                val replacement = JSONArray()
                var found = false
                for (i in 0 until array.length()) {
                    val old = array.optJSONObject(i)
                    if (old?.optString("id") == id) {
                        if (!found) replacement.put(JSONObject(entity.toString()))
                        found = true
                    } else replacement.put(old)
                }
                if (!found) replacement.put(JSONObject(entity.toString()))
                if (container == "tracks" || container == "annotations" || container == "favorites" ||
                    container == "sections" || container == "areas" || container == "measurements")
                    next.getJSONObject("core").put(container, replacement)
                else next.put(container, replacement)
            }
            else -> throw IllegalArgumentException("不支持的工作区容器: $container")
        }
        validateWorkspace(next)
        commit(next, current)
    }

    /** Remove one object from exactly one collection; related records are retained. */
    @Synchronized
    fun remove(container: String, id: String) = lock.withLock {
        require(id.isNotBlank() && id.length <= 250) { "记录编号无效" }
        val current = readCurrent()
        val next = JSONObject(current.toString())
        val inCore = container in setOf("tracks", "annotations", "favorites", "sections", "areas", "measurements")
        val owner = if (inCore) next.getJSONObject("core") else next
        require(container in setOf("tracks", "annotations", "favorites", "sections", "areas", "measurements", "photos", "mapSources", "cadDocuments", "industryProjects")) {
            "不支持的工作区容器: $container"
        }
        val source = owner.optJSONArray(container) ?: return@withLock
        val kept = JSONArray()
        for (i in 0 until source.length()) {
            val item = source.optJSONObject(i)
            if (item?.optString("id") != id) kept.put(source.get(i))
        }
        if (kept.length() == source.length()) return@withLock
        owner.put(container, kept)
        validateWorkspace(next)
        commit(next, current)
    }

    private fun collectionKey(ref: CollectionRecordRef): String = NativeCollections.keyFor(ref)

    private fun recordExists(core: JSONObject, key: String): Boolean {
        val ref=runCatching{NativeCollections.recordForKey(key)}.getOrNull()?:return false
        val array=core.optJSONArray(ref.container)?:return false
        return (0 until array.length()).any{array.optJSONObject(it)?.optString("id")==ref.id}
    }

    private fun snapshotValue(owner: JSONObject, key: String): JsonValue = if (owner.has(key)) {
        JsonValue(true, JSONObject().put("value", owner.opt(key)).toString())
    } else JsonValue(false, null)

    private fun matchesValue(owner: JSONObject, key: String, expected: JsonValue): Boolean =
        owner.has(key) == expected.present && (!expected.present || jsonEquals(owner.opt(key), JSONObject(expected.wrapped!!).opt("value")))

    private fun applyValue(owner: JSONObject, key: String, value: JsonValue) {
        if (value.present) owner.put(key, JSONObject(value.wrapped!!).opt("value")) else owner.remove(key)
    }

    private fun readCurrent(): JSONObject {
        val backupFile = java.io.File(file.baseFile.path + ".bak")
        if (!file.baseFile.exists() && !backupFile.exists()) return emptyWorkspace()
        val bytes = file.openRead().use { readBounded(it, WORKSPACE_MAX_BYTES) }
        return try {
            JSONObject(String(bytes, StandardCharsets.UTF_8)).also(::validateWorkspace)
        } catch (e: JSONException) {
            throw IllegalStateException("本机工作区存档损坏，原文件已保留", e)
        }
    }

    private fun commit(value: JSONObject, fallback: JSONObject) {
        val bytes = value.toString().toByteArray(StandardCharsets.UTF_8)
        require(bytes.size <= WORKSPACE_MAX_BYTES) { "工作区备份超过100MB" }
        writeAtomic(bytes)
        try {
            val persisted = readCurrent()
            check(jsonEquals(persisted, value)) { "工作区写入回读不一致，原存档已恢复" }
        } catch (error: Throwable) {
            try {
                writeAtomic(fallback.toString().toByteArray(StandardCharsets.UTF_8))
            } catch (restoreError: Throwable) {
                error.addSuppressed(restoreError)
            }
            throw error
        }
    }

    private fun writeAtomic(bytes: ByteArray) {
        var stream: java.io.FileOutputStream? = null
        try {
            stream = file.startWrite()
            stream.write(bytes)
            stream.fd.sync()
            file.finishWrite(stream)
        } catch (t: Throwable) {
            if (stream != null) file.failWrite(stream)
            throw t
        }
    }

    companion object {
        const val WORKSPACE_FORMAT = "shantu-workspace"
        const val WORKSPACE_VERSION = 2
        const val WORKSPACE_MAX_BYTES = 100 * 1024 * 1024
        private const val PHOTO_MAX_BYTES = 40 * 1024 * 1024
        private const val PHOTO_TOTAL_BYTES = 200 * 1024 * 1024
        private const val MAP_FILE_MAX_BYTES = 64 * 1024 * 1024
        private const val MAP_STORAGE_MAX_BYTES = 256 * 1024 * 1024
        private val lock = ReentrantLock()

        private val allowedSettings = setOf(
            "shantu.map.layer-preferences.v1", "shantu.route-display.v1", "shantu.routing-mode.v1",
            "shantu.appearance.v1", "shantu-map-source-favorites-v1", "shantu.map-source-coordinates.v1",
            "shantu.project-crs.v1", "shantu-selected-map", "shantu.ui-layout.v1",
            "shantu.map.last-view.v1", "guanyun.track-style.v1", "shantu.annotation-attributes.v1",
            "shantu-area-display-unit-v1", "shantu.contour-interval.v1",
            "shantu-map-comparison-source-groups-v1", "guanyun.recording.max-accuracy.v1",
        )

        private val keyPattern = Regex("^(route|track|annotation|area|section|measurement):.{1,200}$")
        private val idPattern = Regex("^[A-Za-z0-9_-]{1,250}$")
        private val hexColor = Regex("^#[0-9a-fA-F]{6}$")
        private val markerIcons = setOf("pin","flag","star","camp","mountain","water","house","cave","danger","parking","bridge","tree","camera","sample","drill","hospital","food","gate")

        private fun emptyWorkspace() = JSONObject()
            .put("format", WORKSPACE_FORMAT).put("version", WORKSPACE_VERSION)
            .put("core", JSONObject().put("format", "guanyun-backup").put("version", 1)
                .put("tracks", JSONArray()).put("annotations", JSONArray()).put("favorites", JSONArray()))
            .put("photos", JSONArray()).put("settings", JSONObject()).put("mapSources", JSONArray())
            .put("cadDocuments", JSONArray()).put("industryProjects", JSONArray()).put("limitations", JSONArray())

        private fun normalizeIncoming(value: JSONObject): JSONObject =
            if (value.optString("format") == "guanyun-backup") normalizeLegacy(value) else JSONObject(value.toString())

        private fun normalizeLegacy(value: JSONObject): JSONObject {
            require(value.optString("format") == "guanyun-backup" && numberEquals(value, "version", 1)) { "备份版本或格式不支持" }
            val core = JSONObject(value.toString())
            val wrapper = emptyWorkspace().put("core", core)
            wrapper.remove("limitations")
            validateCore(core)
            return wrapper
        }

        private fun jsonEquals(left: Any?, right: Any?): Boolean = when {
            left === right -> true
            left is JSONObject && right is JSONObject -> {
                if (left.length() != right.length()) false else {
                    val keys = left.keys(); var equal = true
                    while (keys.hasNext() && equal) { val key = keys.next(); equal = right.has(key) && jsonEquals(left.opt(key), right.opt(key)) }
                    equal
                }
            }
            left is JSONArray && right is JSONArray -> left.length() == right.length() && (0 until left.length()).all { jsonEquals(left.opt(it), right.opt(it)) }
            left === JSONObject.NULL || right === JSONObject.NULL -> left === JSONObject.NULL && right === JSONObject.NULL
            left is Number && right is Number -> runCatching { java.math.BigDecimal(left.toString()).compareTo(java.math.BigDecimal(right.toString())) == 0 }.getOrDefault(false)
            else -> left == right
        }

        private fun readBounded(input: InputStream, limit: Int): ByteArray {
            val out = ByteArrayOutputStream()
            val buf = ByteArray(32 * 1024)
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                require(out.size().toLong() + n <= limit) { "工作区文件超过100MB" }
                out.write(buf, 0, n)
            }
            return out.toByteArray()
        }

        internal fun validateWorkspace(v: JSONObject) {
            if (v.optString("format") == "guanyun-backup" || v.optString("format") == "shantu-workspace" && numberEquals(v, "version", 1))
                throw IllegalArgumentException("检测到旧版 v1 手动合并备份；为避免将其按完整工作区覆盖，请先完成 v1 兼容迁移规划。")
            require(v.optString("format") == WORKSPACE_FORMAT && numberEquals(v, "version", WORKSPACE_VERSION)) { "工作区版本或格式不支持" }
            val core = v.optJSONObject("core") ?: invalid("工作区业务数据无效")
            validateCore(core)
            val photos = v.optJSONArray("photos") ?: invalid("照片清单无效")
            validatePhotos(photos)
            validateSettings(v.optJSONObject("settings") ?: invalid("偏好设置无效"))
            validateMaps(v.optJSONArray("mapSources") ?: invalid("用户图源清单无效"))
            validateCad(v.optJSONArray("cadDocuments") ?: invalid("CAD 文档清单无效"))
            if (v.has("industryProjects")) validateIndustry(v.optJSONArray("industryProjects") ?: invalid("行业项目清单无效"))
            if (v.has("limitations")) {
                val limitations = v.optJSONArray("limitations") ?: invalid("限制说明格式无效")
                require(limitations.length() <= 20 && (0 until limitations.length()).all { limitations.opt(it) is String }) { "限制说明格式无效" }
            }
            require(v.toString().toByteArray(StandardCharsets.UTF_8).size <= WORKSPACE_MAX_BYTES) { "工作区文件超过100MB" }
        }

        private fun validateCore(core: JSONObject) {
            require(core.optString("format") == "guanyun-backup" && numberEquals(core, "version", 1)) { "工作区核心格式无效" }
            if (core.has("importWarnings")) { val warnings=core.optJSONArray("importWarnings") ?: invalid("文件提示信息格式无效"); require(warnings.length()<=10); for(i in 0 until warnings.length()) require(warnings.opt(i) is String&&warnings.optString(i).length<=500) }
            val tracks = core.optJSONArray("tracks") ?: invalid("轨迹清单无效")
            require(tracks.length() <= 100) { "轨迹清单超过100条" }
            uniqueIds(tracks, "轨迹") { item -> validateTrack(item) }
            val annotations = core.optJSONArray("annotations") ?: invalid("标记清单无效")
            require(annotations.length() <= 2080) { "标记清单超过上限" }
            uniqueIds(annotations, "标记") { validateAnnotation(it) }
            require((0 until annotations.length()).count { annotations.getJSONObject(it).optString("kind") == "pin" } <= 2000 &&
                (0 until annotations.length()).count { annotations.getJSONObject(it).optString("kind") != "pin" } <= 80) { "地点标记或模型超过数量上限" }
            val favorites = core.optJSONArray("favorites") ?: invalid("收藏清单无效")
            require(favorites.length() <= 20) { "路线收藏超过20条" }
            uniqueIds(favorites, "收藏路线") { validateFavorite(it) }
            core.optJSONObject("collections")?.let(::validateCollections)
            core.optJSONArray("sections")?.let { arr ->
                require(arr.length() <= 20) { "剖面列表超过20项" }
                uniqueIds(arr, "剖面") { obj ->
                    require(id(obj, "id", 80) && obj.optString("id").matches(Regex("^[A-Za-z0-9-]{1,80}$")) &&
                        text(obj, "name", 60, nonBlank = true)) { "剖面记录无效" }
                    validateSection(obj.optJSONObject("settings") ?: invalid("剖面参数无效"))
                    val settings = obj.getJSONObject("settings")
                    require(!settings.has("objectId") || settings.optString("objectId") == obj.optString("id")) { "剖面对象编号不匹配" }
                    require(settings.has("enabled") && settings.opt("enabled") is Boolean) { "剖面启用状态无效" }
                }
            }
            core.optJSONArray("sectionNotes")?.let(::validateSectionNotes)
            core.optJSONObject("regions")?.let(::validateRegions)
            core.optJSONArray("areas")?.let { arr -> require(arr.length() <= 40) { "区域超过40项" }; uniqueIds(arr, "区域") { validateArea(it) } }
            core.optJSONArray("measurements")?.let { arr -> require(arr.length() <= 200) { "测量清单超过200项" }; uniqueIds(arr, "测量") { validateMeasurement(it) } }
        }

        private fun validateTrack(o: JSONObject) {
            require(id(o, "id", 250) && o.has("name") && o.opt("name") is String && o.optString("name").length <= 200 && finite(o, "createdAt")) { "轨迹基本信息无效" }
            if (o.has("source")) require(o.optString("source") in setOf("recorded", "gpx", "kml", "manual", "shared")) { "轨迹来源无效" }
            val segments = o.optJSONArray("segments") ?: invalid("轨迹线段无效")
            require(segments.length() <= 100) { "轨迹线段超过限制" }
            var count = 0
            for (i in 0 until segments.length()) {
                val line = segments.optJSONArray(i) ?: invalid("轨迹坐标无效")
                val source = o.optString("source")
                require(line.length() >= if (source == "manual" || source == "recorded" || source.isEmpty()) 1 else 2) { "轨迹线段点数不足" }
                for (j in 0 until line.length()) validateCoordinate(line.optJSONArray(j), 85.051129)
                count += line.length()
            }
            require(count <= 6000) { "轨迹超过6000个点" }
            if (o.has("nodes")) { val nodes = o.optJSONArray("nodes") ?: invalid("轨迹节点无效"); require(nodes.length() <= 6000); for (i in 0 until nodes.length()) validateCoordinate(nodes.optJSONArray(i), 90.0) }
            if (o.has("samples")) {
                val samples = o.optJSONArray("samples") ?: invalid("轨迹采样无效")
                require(samples.length() == segments.length()) { "轨迹采样与线段不匹配" }
                for (i in 0 until samples.length()) {
                    val row = samples.optJSONArray(i) ?: invalid("轨迹采样无效"); val line = segments.getJSONArray(i)
                    require(row.length() == line.length()) { "轨迹采样与坐标数不匹配" }
                    for (j in 0 until row.length()) {
                        val s = row.optJSONObject(j) ?: invalid("轨迹采样无效")
                        require(nullableFinite(s, "time", 8.64e15) && nullableFinite(s, "altitude", Double.MAX_VALUE)) { "轨迹采样值无效" }
                    }
                }
            }
        }

        private fun validateAnnotation(o: JSONObject) {
            require(id(o, "id", 100) && o.optString("kind") in setOf("pin", "box", "cylinder", "sphere", "prism") &&
                text(o, "name", 60) && text(o, "note", 500) && o.has("color") && hexColor.matches(o.optString("color")) &&
                o.has("coordinates") && coordinate(o.optJSONArray("coordinates"), 85.0) &&
                nullableFinite(o, "groundElevation", -12000.0, 10000.0) &&
                o.optString("placement") in setOf("surface", "underground") && bounded(o, "offset", 0.0, 10000.0) &&
                bounded(o, "width", .1, 10000.0) && bounded(o, "length", .1, 10000.0) && bounded(o, "height", .1, 10000.0) &&
                bounded(o, "heading", -360.0, 360.0) && bounded(o, "pitch", -360.0, 360.0) && bounded(o, "roll", -360.0, 360.0) &&
                bounded(o, "opacity", .1, .85) && o.opt("visible") is Boolean) { "标记字段无效" }
            optionalBool(o, "terrainCut"); optionalBool(o, "terrainIntersection")
            if (o.has("centerAltitude")) require(bounded(o, "centerAltitude", -12000.0, 30000.0)) { "标记高程无效" }
            if (o.has("borehole")) { val b = o.optJSONObject("borehole") ?: invalid("钻孔参数无效"); require(nullableBounded(b, "depth", .1, 12000.0)) { "钻孔深度无效" } }
            if (o.has("icon")) require(o.optString("icon") in markerIcons) { "标记图标无效" }
            if (o.has("attributes")) validateAttributes(o.optJSONArray("attributes") ?: invalid("标记属性无效"))
            if (o.has("trackAnchor")) { val a=o.optJSONObject("trackAnchor") ?: invalid("轨迹锚点无效"); require(id(a,"trackId",100)&&bounded(a,"distance",0.0,Double.MAX_VALUE)) { "轨迹锚点无效" } }
            if (o.has("sectionAnchor")) { val a=o.optJSONObject("sectionAnchor") ?: invalid("剖面锚点无效"); require(a.optString("sectionId").matches(Regex("^[a-zA-Z0-9-]{1,80}$"))&&bounded(a,"distance",-50000.0,50000.0)&&(!a.has("stationId")||a.optString("stationId").matches(Regex("^[a-zA-Z0-9-]{1,100}$")))) { "剖面锚点无效" } }
            if (o.optString("kind") == "prism") validateFootprint(o.optJSONArray("footprint") ?: invalid("轮廓模型无效"))
        }

        private fun validateFavorite(o: JSONObject) {
            require(id(o, "id", 250) && text(o, "name", 200) && finite(o, "savedAt") && place(o.optJSONObject("start")) && place(o.optJSONObject("end"))) { "收藏路线基本字段无效" }
            val r = o.optJSONObject("route") ?: invalid("收藏路线内容无效")
            require(r.optString("mode") in setOf("auto", "bicycle", "pedestrian") && bounded(r, "distance", 0.0, Double.MAX_VALUE) &&
                bounded(r, "duration", 0.0, Double.MAX_VALUE) && finite(r, "createdAt")) { "路线参数无效" }
            val coords = r.optJSONArray("coordinates") ?: invalid("路线坐标无效")
            require(coords.length() in 2..100000); for (i in 0 until coords.length()) validateCoordinate(coords.optJSONArray(i), 90.0)
            val snapped = r.optJSONArray("snapped") ?: invalid("路线吸附点无效")
            require(snapped.length() == (r.optJSONArray("stops")?.length() ?: 2)) { "路线吸附点数与途经点不匹配" }
            for (i in 0 until snapped.length()) validateCoordinate(snapped.optJSONArray(i), 90.0)
            val steps = r.optJSONArray("steps") ?: invalid("路线步骤无效"); require(steps.length() <= 10000)
            for (i in 0 until steps.length()) { val s=steps.optJSONObject(i) ?: invalid("路线步骤无效"); require(text(s,"instruction",10000) && bounded(s,"distance",0.0,Double.MAX_VALUE) && bounded(s,"duration",0.0,Double.MAX_VALUE) && bounded(s,"elapsedSeconds",0.0,Double.MAX_VALUE)); val cs=s.optJSONArray("coordinates") ?: invalid("路线步骤坐标无效"); for(j in 0 until cs.length()) validateCoordinate(cs.optJSONArray(j),90.0) }
            if (r.has("stops")) { val stops=r.optJSONArray("stops") ?: invalid("路线途经点无效"); require(stops.length() in 2..12); for(i in 0 until stops.length()) require(place(stops.optJSONObject(i))) { "路线途经点无效" }; require(snapped.length()==stops.length()) }
            if (r.has("style")) { val style=r.optJSONObject("style") ?: invalid("路线样式无效"); require(hexColor.matches(style.optString("color")) && bounded(style,"width",.5,5.0)) }
            if (r.has("displayOpacity")) require(bounded(r,"displayOpacity",0.0,1.0))
            if (r.has("preferredTrackPath")) validateCoordinateArray(r.optJSONArray("preferredTrackPath"), 2, 100000)
            if (r.has("trackNetwork")) { val net=r.optJSONArray("trackNetwork") ?: invalid("路线网络无效"); require(net.length()<=2000); var n=0; for(i in 0 until net.length()) {val line=net.optJSONArray(i) ?: invalid("路线网络线段无效"); require(line.length()>=2); n+=line.length(); for(j in 0 until line.length()) validateCoordinate(line.optJSONArray(j),90.0)}; require(n<=120000) }
        }

        private fun validateCollections(o: JSONObject) {
            require(numberEquals(o, "version", 1)) { "收藏目录版本无效" }
            val groups=o.optJSONArray("groups") ?: invalid("收藏分组无效"); require(groups.length()<=64)
            val groupIds=mutableSetOf<String>()
            for(i in 0 until groups.length()) { val g=groups.optJSONObject(i) ?: invalid("收藏分组无效"); require(id(g,"id",80) && g.optString("id")!="unfiled" && groupIds.add(g.optString("id")) && text(g,"name",30,true) && hexColor.matches(g.optString("color"))); if(g.has("parentId")) require(id(g,"parentId",80)) }
            val assignments=o.optJSONObject("assignments") ?: invalid("收藏归类无效"); require(assignments.length()<=12000)
            val keys=assignments.keys(); while(keys.hasNext()) { val k=keys.next(); require(keyPattern.matches(k) && groupId(assignments.optString(k))) { "收藏归类无效" } }
            val order=o.optJSONArray("order") ?: invalid("收藏顺序无效"); require(order.length()<=12000); validateUniqueStrings(order, keyPattern)
            if(o.has("treeOrder")) {val tree=o.optJSONArray("treeOrder") ?: invalid("收藏树顺序无效"); require(tree.length()<=12064); validateUniqueStrings(tree, Regex("^(folder:[\\w-]{1,80}|(route|track|annotation|area|section|measurement):.{1,200})$")) }
            if(o.has("tabOrder")) { val tabs=o.optJSONArray("tabOrder") ?: invalid("收藏标签顺序无效"); require(tabs.length()<=11); validateUniqueStrings(tabs, Regex("^(regions|all|cache|hidden|route|track|pin|model|area|section|measurement)$")) }
            for(i in 0 until groups.length()) { var parent=groups.getJSONObject(i).optString("parentId", ""); val seen=mutableSetOf(groups.getJSONObject(i).optString("id")); var depth=1; while(parent.isNotEmpty()) { require(groupIds.contains(parent) && seen.add(parent) && depth++ < 8) { "收藏分组层级无效" }; parent=(0 until groups.length()).map{groups.getJSONObject(it)}.first{it.optString("id")==parent}.optString("parentId", "") } }
        }

        private fun validateSectionNotes(a: JSONArray) {
            require(a.length() <= 2000) { "剖面测点记录过多" }
            for (i in 0 until a.length()) { val rec=a.optJSONObject(i) ?: invalid("剖面测点记录无效"); validateSection(rec.optJSONObject("settings") ?: invalid("剖面参数无效")); require(finite(rec,"savedAt")); val notes=rec.optJSONArray("notes") ?: invalid("测点清单无效"); val ids=mutableSetOf<String>(); for(j in 0 until notes.length()) {val n=notes.optJSONObject(j) ?: invalid("测点无效"); require(id(n,"id",250) && ids.add(n.optString("id")) && text(n,"name",80) && text(n,"note",1000) && text(n,"curveName",300) && n.optString("source") in setOf("terrain","model") && finite(n,"sampledAt") && n.optJSONArray("fields") != null); if(n.has("color")) require(hexColor.matches(n.optString("color"))); if(n.has("fraction")) require(bounded(n,"fraction",0.0,1.0)); val p=n.optJSONObject("point") ?: invalid("测点坐标无效"); require(finite(p,"u")&&finite(p,"v")&&finite(p,"altitude")&&bounded(p,"distance",0.0,Double.MAX_VALUE)); validateCoordinate(p.optJSONArray("coordinates"),90.0); val local=p.optJSONArray("local") ?: invalid("测点局部坐标无效"); require(local.length()==3 && (0..2).all{local.opt(it) is Number && local.optDouble(it).isFinite()}); val fields=n.getJSONArray("fields"); for(k in 0 until fields.length()){val f=fields.optJSONObject(k) ?: invalid("测点字段无效"); require(text(f,"name",80)&&text(f,"value",500)&&text(f,"unit",40))} } }
        }

        private fun validateSection(s: JSONObject) {
            val p=s.optJSONObject("plane") ?: invalid("剖面平面无效"); validateCoordinate(p.optJSONArray("center"),85.0)
            require(bounded(s,"altitude",-12000.0,30000.0) && bounded(p,"width",.1,200000.0) && bounded(p,"height",.1,200000.0) && finite(p,"heading") && finite(p,"tilt") && (!p.has("roll") || finite(p,"roll")) && s.has("color") && hexColor.matches(s.optString("color"))) { "剖面参数无效" }
            if(s.has("objectId")) require(s.optString("objectId").matches(Regex("^[A-Za-z0-9-]{1,80}$")))
            if(s.has("survey")) { val line=s.optJSONObject("survey") ?: invalid("测线参数无效"); require(numberEquals(line,"version",1)&&coordinate(line.optJSONArray("a"),85.0)&&coordinate(line.optJSONArray("b"),85.0)&&numberIn(line,"interval",setOf(1,2,5,10,20,25,50,100,200,500))&&bounded(line,"halfWidth",.1,10000.0)); val stations=line.optJSONArray("stations") ?: invalid("测线测点无效"); require(stations.length()<=200); val stationIds=mutableSetOf<String>(); for(i in 0 until stations.length()){val station=stations.optJSONObject(i) ?: invalid("测线测点无效"); require(id(station,"id",100)&&station.optString("id").matches(Regex("^[a-zA-Z0-9-]{1,100}$"))&&stationIds.add(station.optString("id"))&&station.optString("id") !in setOf("A","B")&&text(station,"label",60,true)&&bounded(station,"distance",-50000.0,50000.0))}; if(line.has("printScale")) require(numberIn(line,"printScale",setOf(500,1000,2000,5000,10000,25000,50000,100000,250000,500000,1000000))); if(line.has("info")){val info=line.optJSONObject("info") ?: invalid("测线说明无效"); require(listOf("project","title","number","author","reviewer","source").all{text(info,it,100)}&&text(info,"date",100)&&text(info,"note",500)&& (info.optString("date").isEmpty()||info.optString("date").matches(Regex("^\\d{4}-\\d{2}-\\d{2}$")) ))}; if(line.has("pointData")){val data=line.optJSONObject("pointData") ?: invalid("测线测点说明无效"); val keys=data.keys(); while(keys.hasNext()){val k=keys.next();val p=data.optJSONObject(k) ?: invalid("测线测点说明无效");require((k=="A"||k=="B"||stationIds.contains(k))&&text(p,"name",60)&&text(p,"note",500))}} }
            if(s.has("surveyTerrain")) {val terrain=s.optJSONObject("surveyTerrain") ?: invalid("测线地形采样无效"); require(s.has("survey")); val line=s.getJSONObject("survey"); val rows=terrain.optInt("rows",-1); val columns=terrain.optInt("columns",-1); require(text(terrain,"key",1000)&&integerRange(terrain,"columns",2,257)&&integerRange(terrain,"rows",3,65)&&rows%2==1&&finite(terrain,"start")&&finite(terrain,"end")&&bounded(terrain,"halfWidth",.1,10000.0)&&finite(terrain,"sampledAt")&&integerRange(terrain,"zoom",0,12)&&text(terrain,"source",200)); val range=JSONArray().put(terrain.optDouble("start")).put(terrain.optDouble("end")); require(range.getDouble(1)>=range.getDouble(0)); val heights=terrain.optJSONArray("heights") ?: invalid("测线高程样本无效"); require(heights.length()==rows*columns); for(i in 0 until heights.length()){val h=heights.opt(i);require(h==JSONObject.NULL||h is Number&&h.toDouble().isFinite()&&h.toDouble() in -12000.0..10000.0)}; require(line.has("version")) }
            if(s.has("scale")) { val scale=s.optJSONObject("scale") ?: invalid("剖面比例尺无效"); require(scale.optString("unit") in setOf("m","km") && (scale.opt("interval")=="auto" || scale.optDouble("interval",Double.NaN).let{it.isFinite()&&it in .0001..200000.0})) }
        }

        private fun validateRegions(o: JSONObject) {
            require(o.length()<=3000); val keys=o.keys(); while(keys.hasNext()){val k=keys.next(); val r=o.optJSONObject(k) ?: invalid("地区信息无效"); require(keyPattern.matches(k) && r.optString("coordinateKey").matches(Regex("^-?\\d{1,3}\\.\\d{6},-?\\d{1,2}\\.\\d{6}$")) && listOf("country","province","city").all{text(r,it,80)} && listOf("district","township","street","locality").all{!r.has(it)||text(r,it,80)} && r.optString("source") in setOf("auto","manual") && finite(r,"checkedAt")) { "地区信息无效" } }
        }

        private fun validateArea(a: JSONObject) {
            require(id(a,"id",100) && text(a,"name",60) && text(a,"note",500) && hexColor.matches(a.optString("color")) && a.opt("visible") is Boolean && finite(a,"createdAt")) { "区域字段无效" }
            val b=a.optJSONArray("boundary") ?: invalid("区域边界无效"); require(b.length() in 4..6001); for(i in 0 until b.length()) validateCoordinate(b.optJSONArray(i),85.0); require(b.getJSONArray(0).toString()==b.getJSONArray(b.length()-1).toString()) { "区域边界未闭合" }
            if(a.has("attributes")) validateAttributes(a.optJSONArray("attributes") ?: invalid("区域属性无效"))
            if(a.has("icon")) require(a.optString("icon") in markerIcons) { "区域图标无效" }
        }

        private fun validateMeasurement(m: JSONObject) {
            require(id(m,"id",100) && text(m,"name",100,true) && finite(m,"updatedAt")) { "测量字段无效" }
            if(m.has("visible")) require(m.opt("visible") is Boolean)
            val points=m.optJSONArray("points") ?: invalid("测量点无效"); require(points.length() in 2..200); val ids=mutableSetOf<String>(); for(i in 0 until points.length()){val p=points.optJSONObject(i) ?: invalid("测量点无效"); require(id(p,"id",100)&&ids.add(p.optString("id"))&&nullableFinite(p,"altitude",-12000.0,100000.0)&&p.optString("heightSource") in setOf("terrain","manual","unknown")&&p.isNull("altitude")== (p.optString("heightSource")=="unknown")); validateCoordinate(p.optJSONArray("coordinates"),85.0)}
        }

        private fun validatePhotos(a: JSONArray) {
            require(a.length()<=200) { "照片清单无效或超过200张" }; val ids=mutableSetOf<String>(); var previews=0L; var all=0L
            for(i in 0 until a.length()) { val p=a.optJSONObject(i) ?: invalid("照片记录无效"); require(id(p,"id",250)&&ids.add(p.optString("id"))&&text(p,"name",200)&&text(p,"trackId",250)&&text(p,"trackName",250)&&finite(p,"time")&&coordinate(p.optJSONArray("coordinates"),90.0)&&p.optString("kind") in setOf("point","interpolated","annotation")&&p.optString("mime")=="image/jpeg") { "照片字段无效" }
                if(p.optString("kind")=="annotation") require(id(p,"annotationId",100)&&p.optString("trackId").isEmpty()) { "标记照片关联无效" }
                if(p.has("timeSource")) require(p.optString("timeSource") in setOf("exif","camera")); if(p.has("timeSourceDetail")) require(p.optString("timeSourceDetail") in setOf("return-estimate","manual")); if(p.has("locationSource")) require(p.optString("locationSource") in setOf("track","camera")); if(p.has("locationTimeSource")) require(p.optString("locationTimeSource") in setOf("capture","return")); if(p.has("locationAccuracy")) require(bounded(p,"locationAccuracy",0.0,100000.0))
                val preview=decodeBase64(p.optString("previewBase64", "")); previews+=preview.size; all+=preview.size; require(preview.size<=1024*1024) { "单张照片预览超过1MB" }
                if(p.has("detailBase64")){ val detail=decodeBase64(p.optString("detailBase64")); require(detail.size<=4*1024*1024) { "单张照片清晰副本超过4MB" }; all+=detail.size }
                if(p.has("altitude")){val alt=p.optJSONObject("altitude") ?: invalid("照片海拔信息无效"); require(bounded(alt,"metres",-12000.0,100000.0)&&alt.optString("source") in setOf("exif","track","interpolated"))}
                if(p.has("title")) require(text(p,"title",100))
                if(p.has("note")) require(text(p,"note",1000))
                if(p.has("rotation")) require(numberIn(p,"rotation",setOf(0,90,180,270)))
                if(p.has("weatherError")) require(text(p,"weatherError",200))
                if(p.has("strokes")){val strokes=p.optJSONArray("strokes") ?: invalid("照片涂鸦无效"); require(strokes.length()<=80); for(j in 0 until strokes.length()){val stroke=strokes.optJSONObject(j) ?: invalid("照片涂鸦无效"); require(stroke.optString("color") in setOf("#ff625c","#ffda63","#ffffff")); val points=stroke.optJSONArray("points") ?: invalid("照片涂鸦坐标无效"); require(points.length() in 1..400); for(k in 0 until points.length()){val point=points.optJSONArray(k) ?: invalid("照片涂鸦坐标无效"); require(point.length()==2&&(0..1).all{point.opt(it) is Number&&point.optDouble(it).isFinite()&&point.optDouble(it) in 0.0..1.0})}} }
                if(p.has("weather")){val w=p.optJSONObject("weather") ?: invalid("照片天气信息无效"); require(w.optString("source") in setOf("era5","forecast")&&finite(w,"time")&&finite(w,"fetchedAt")&&listOf("temperature","precipitation","wind","code").all{nullableFinite(w,it)})}
            }
            require(previews<=PHOTO_MAX_BYTES && all<=PHOTO_TOTAL_BYTES) { "备份照片超过预览40MB / 含清晰副本200MB限制" }
        }

        private fun validateSettings(o: JSONObject) {
            require(o.length()<=allowedSettings.size); val keys=o.keys(); while(keys.hasNext()){val k=keys.next(); val raw=o.opt(k); require(allowedSettings.contains(k)&&raw is String&&raw.length<=2_000_000) { "备份包含不允许的设置项" }; validateSettingValue(k,raw) }
        }

        private fun validateSettingValue(key: String, raw: String) {
            if(key=="shantu.routing-mode.v1"){ require(raw in setOf("auto","online","offline")); return }
            if(key=="shantu-selected-map"){require(raw.length<=250); return}
            if(key=="shantu-area-display-unit-v1"){require(raw in setOf("m2","km2","ha","mu","ft2","acre","mi2")); return}
            if(key=="guanyun.recording.max-accuracy.v1"){val n=raw.toDoubleOrNull(); require(n!=null&&n.isFinite()&&n%1.0==0.0&&n in 5.0..80.0); return}
            if(key=="shantu-map-source-favorites-v1" || key=="shantu-map-comparison-source-groups-v1") {
                val a=try{JSONArray(raw)}catch(e:JSONException){throw IllegalArgumentException("偏好设置“$key”格式无效，未导入",e)}
                if(key=="shantu-map-source-favorites-v1") { require(a.length()<=500); for(i in 0 until a.length()) require(a.opt(i) is String && a.optString(i).isNotEmpty() && a.optString(i).length<=256) }
                else { require(a.length()<=5); for(i in 0 until a.length()) require(a.optString(i) in setOf("常用","当前","内置","我的图源","公共库")) }
                return
            }
            val j=try{JSONObject(raw)}catch(e:JSONException){throw IllegalArgumentException("偏好设置“$key”格式无效，未导入",e)}
            when(key){
                "shantu.map.layer-preferences.v1" -> {
                    require(numberEquals(j,"version",1)); val layers=j.optJSONObject("layers") ?: invalid("地图图层偏好无效")
                    for(k in listOf("terrain","satellite","offlineBasemap","tiandituBoundaries","contours","elevationColors","geology","roads","labels")) if(layers.has(k)) require(layers.opt(k) is Boolean)
                    if(layers.has("satelliteProvider")) require(layers.optString("satelliteProvider") in setOf("sentinel","tianditu"))
                    if(layers.has("tiandituBase")) require(layers.optString("tiandituBase") in setOf("vec","img","ter"))
                    if(layers.has("tiandituLabels")) require(layers.optString("tiandituLabels") in setOf("auto","cva","cia","cta","vector","none"))
                    if(layers.has("geologySource")) require(layers.optString("geologySource") in setOf("world","geocloud20w"))
                    if(layers.has("imageryMode")) require(layers.optString("imageryMode") in setOf("detail","latest"))
                    if(layers.has("contourInterval")) require(numberIn(layers,"contourInterval",setOf(30,50,100,200)))
                    for(k in listOf("elevationColorsOpacity","geologyOpacity","roadsOpacity")) if(layers.has(k)) require(bounded(layers,k,0.0,1.0))
                    if(layers.has("exaggeration")) require(bounded(layers,"exaggeration",.1,5.0))
                    if(layers.has("rasterLevel")) require(layers.isNull("rasterLevel")||integerRange(layers,"rasterLevel",0,24))
                    if(layers.has("rasterQuality")) require(layers.optString("rasterQuality") in setOf("standard","high"))
                }
                "shantu.route-display.v1" -> require(j.optString("mode") in setOf("original","solid","elevation","speed","slope") && listOf("legend","statistics","profile","steep","coordinates").all{j.opt(it) is Boolean})
                "shantu.appearance.v1" -> {require(j.optString("mode") in setOf("light","dark","system")); for(theme in listOf("light","dark")){val p=j.optJSONObject(theme) ?: invalid("主题颜色无效"); require(hexColor.matches(p.optString("accent"))&&hexColor.matches(p.optString("background"))&&hexColor.matches(p.optString("foreground"))&&bounded(p,"contrast",0.0,100.0)&&(!p.has("button")||hexColor.matches(p.optString("button"))))} }
                "shantu.map-source-coordinates.v1" -> {val keys=j.keys(); while(keys.hasNext()){val k=keys.next(); require(k.isNotEmpty()&&k.length<=100&&j.optString(k) in setOf("wgs84","gcj02","bd09"))}}
                "shantu.project-crs.v1" -> {require(text(j,"id",200,true)&&text(j,"name",200,true)); if(j.has("definition")) require(text(j,"definition",8192,true)); if(j.has("datumParameters")){val a=j.optJSONArray("datumParameters") ?: invalid("坐标系参数无效"); require(a.length()==3||a.length()==7); for(i in 0 until a.length()) require(a.opt(i) is Number&&a.optDouble(i).isFinite())} }
                "shantu.ui-layout.v1" -> require(numberEquals(j,"version",1)&&j.length()<=100)
                "shantu.map.last-view.v1" -> {val c=j.optJSONArray("center") ?: invalid("地图视角无效"); require(c.length()==2&&(0..1).all{c.opt(it) is Number&&c.optDouble(it).isFinite()}&&kotlin.math.abs(c.optDouble(0))<=180&&kotlin.math.abs(c.optDouble(1))<=85.051129&&bounded(j,"zoom",0.0,20.0)&&finite(j,"bearing")&&bounded(j,"pitch",0.0,80.0)&&(!j.has("terrain")||j.opt("terrain") is Boolean))}
                "guanyun.track-style.v1" -> require(hexColor.matches(j.optString("color"))&&bounded(j,"width",.5,5.0)&&(!j.has("pointSize")||integerRange(j,"pointSize",4,16))&&(!j.has("opacity")||bounded(j,"opacity",.1,1.0))&&(!j.has("colorMode")||j.optString("colorMode") in setOf("solid","speed","slope","elevation")))
                "shantu.annotation-attributes.v1" -> {val names=j.optJSONArray("names") ?: invalid("属性模板无效"); val recent=j.optJSONArray("recent") ?: invalid("属性模板无效"); require(names.length()<=100&&recent.length()<=100); for(a in listOf(names,recent)) for(i in 0 until a.length()) require(a.opt(i) is String&&a.optString(i).trim().isNotEmpty()&&a.optString(i).length<=60)}
                "shantu.contour-interval.v1" -> require(raw.toDoubleOrNull() in setOf(1.0,2.0,5.0,10.0,20.0,50.0,100.0))
            }
        }

        private fun validateMaps(a: JSONArray) {
            require(a.length()<=100) { "用户图源超过100项" }; val ids=mutableSetOf<String>(); var total=0L
            for(i in 0 until a.length()){val m=a.optJSONObject(i) ?: invalid("图源记录无效"); require(id(m,"id",250)&&ids.add(m.optString("id"))&&text(m,"name",240,true)&&m.optString("kind") in setOf("online","mbtiles","image")&&text(m,"format",80,true)&&text(m,"attribution",1000)&&integerRange(m,"minzoom",0,24)&&integerRange(m,"maxzoom",m.optDouble("minzoom",Double.NaN).toInt(),24)&&numberIn(m,"tileSize",setOf(256,512,1024,2048))&&safeInteger(m,"bytes")&&m.optLong("bytes")>=0&&(!m.has("scheme")||m.optString("scheme") in setOf("xyz","tms"))&&(!m.has("datum")||m.optString("datum") in setOf("wgs84","gcj02","bd09"))) { "图源字段无效" }; total+=m.optLong("bytes"); require(total<=MAP_STORAGE_MAX_BYTES)
                if(m.has("tiles")){val tiles=m.optJSONArray("tiles") ?: invalid("图源瓦片地址无效"); require(tiles.length() in 1..8); for(j in 0 until tiles.length()) require(tiles.optString(j).length<=8192&&tiles.optString(j).matches(Regex("^https?://.+",RegexOption.IGNORE_CASE))) }
                if(m.optString("kind")=="online") require(m.optJSONArray("tiles")?.length() ?: 0 > 0) { "在线图源缺少瓦片地址" }
                if(m.has("detail")) require(text(m,"detail",2000))
                if(m.has("bounds")){val b=m.optJSONArray("bounds") ?: invalid("图源范围无效"); require(b.length()==4 && (0..3).all{b.opt(it) is Number && b.optDouble(it).isFinite()}); require(b.getDouble(0)<b.getDouble(2)&&b.getDouble(1)<b.getDouble(3)&&b.getDouble(0)>=-180&&b.getDouble(2)<=180&&b.getDouble(1)>=-85.051129&&b.getDouble(3)<=85.051129) }
                if(m.has("blobBase64")){require(m.opt("blobMime") is String); val bytes=decodeBase64(m.optString("blobBase64")); require(bytes.size<=MAP_FILE_MAX_BYTES&&m.optString("blobMime").length<=100); require(m.optLong("bytes")>=bytes.size) { "图源容量信息小于本地文件" }}
                if(m.has("ovmap")) validateOvmap(m.optJSONObject("ovmap") ?: invalid("OVMAP 图源结构无效"))
            }
        }

        private fun validateOvmap(o: JSONObject) { val layers=o.optJSONArray("layers") ?: invalid("OVMAP 图层无效"); require(layers.length() in 1..8); for(i in 0 until layers.length()){val l=layers.optJSONObject(i) ?: invalid("OVMAP 图层无效"); val tiles=l.optJSONArray("tiles") ?: invalid("OVMAP 瓦片无效"); require(tiles.length() in 1..8&&numberIn(l,"tileSize",setOf(256,512))&&integerRange(l,"minzoom",0,24)&&integerRange(l,"maxzoom",l.optDouble("minzoom",Double.NaN).toInt(),24)); for(j in 0 until tiles.length()) require(tiles.optString(j).matches(Regex("^https?://.+",RegexOption.IGNORE_CASE))) }; for(k in listOf("missingOverlayIds","overlayIds","overlayFlags")){if(o.has(k)){val a=o.optJSONArray(k) ?: invalid("OVMAP 编号列表无效"); for(i in 0 until a.length()) require(a.opt(i) is Number && a.optDouble(i).isFinite() && a.optDouble(i)%1.0==0.0 && a.optDouble(i)>=0.0)}} }

        private fun validateCad(a: JSONArray) {
            require(a.length()<=20) { "CAD 文档清单超过20份" }; var sourceChars=0L
            for(i in 0 until a.length()){val d=a.optJSONObject(i) ?: invalid("CAD 文档记录无效"); require(id(d,"id",250)&&text(d,"name",250)&&d.optString("format") in setOf("dwg","dxf")); val src=d.optString("sourceBase64", ""); require(src.length<=28_000_000); val bytes=decodeBase64(src); require(bytes.size<=20*1024*1024); sourceChars+=src.length; require(sourceChars<=100L*1024*1024); require(d.optJSONObject("sourceCrs")!=null&&d.opt("visible") is Boolean&&finite(d,"createdAt")&&d.optString("axisOrder") in setOf("xy","yx")&&bounded(d,"unitScale",Double.MIN_VALUE,1_000_000.0)); val layers=d.optJSONArray("layers") ?: invalid("CAD 图层无效"); require(layers.length()<=20000); for(j in 0 until layers.length()) require(layers.optJSONObject(j)?.opt("name") is String); val warnings=d.optJSONArray("warnings") ?: invalid("CAD 提示无效"); for(j in 0 until warnings.length()) require(warnings.opt(j) is String); validateCadFeatures(d.optJSONArray("features") ?: invalid("CAD 图元无效"), false); validateCadFeatures(d.optJSONArray("mapFeatures") ?: invalid("CAD 地图图元无效"), true); require(d.getJSONArray("features").length()==d.getJSONArray("mapFeatures").length()) { "CAD 原图与地图图元数不一致"} }
        }
        private fun validateCadFeatures(a: JSONArray, geographic: Boolean){ require(a.length()<=20000); var vertices=0; val ids=mutableSetOf<String>(); for(i in 0 until a.length()){val f=a.optJSONObject(i) ?: invalid("CAD 图元无效"); require(id(f,"id",250)&&ids.add(f.optString("id"))&&text(f,"layer",250)&&text(f,"entityType",250,true)); if(f.has("color")) require(hexColor.matches(f.optString("color"))); if(f.has("text")) require(text(f,"text",20000)); val g=f.optJSONObject("geometry") ?: invalid("CAD 几何无效"); when(g.optString("type")){"Point"->validateCadPoint(g.optJSONArray("coordinates"),geographic){vertices++}; "LineString"->{val c=g.optJSONArray("coordinates") ?: invalid("CAD 线无效"); require(c.length()>=2); for(j in 0 until c.length()) validateCadPoint(c.optJSONArray(j),geographic){vertices++}}; "Polygon"->{val rings=g.optJSONArray("coordinates") ?: invalid("CAD 面无效"); require(rings.length()>0); for(j in 0 until rings.length()){val ring=rings.optJSONArray(j) ?: invalid("CAD 面环无效"); require(ring.length()>=4&&ring.getJSONArray(0).toString()==ring.getJSONArray(ring.length()-1).toString()); for(k in 0 until ring.length()) validateCadPoint(ring.optJSONArray(k),geographic){vertices++}}}; else -> invalid("不支持的 CAD 几何")}; require(vertices<=100000) { "CAD 超过十万顶点"} } }
        private fun validateCadPoint(p:JSONArray?, geographic:Boolean, increment:()->Unit){require(p!=null&&p.length() in 2..3&&(0 until p.length()).all{p.opt(it) is Number&&p.optDouble(it).isFinite()}); increment(); if(geographic) require(kotlin.math.abs(p.getDouble(0))<=180&&kotlin.math.abs(p.getDouble(1))<=90) }

        private fun validateIndustry(a: JSONArray){require(a.length()<=100) { "行业项目最多100项"}; val ids=mutableSetOf<String>(); var total=0L; for(i in 0 until a.length()){val p=a.optJSONObject(i) ?: invalid("行业项目记录无效"); require(id(p,"id",200)&&p.optString("id").isNotBlank()&&ids.add(p.optString("id"))&&text(p,"name",240,true)&&p.optString("kind") in setOf("section","drill")&&safeInteger(p,"createdAt")&&p.optLong("createdAt")>=0); val bytes=decodeBase64(p.optString("sourceBase64", "")); require(bytes.size in 1..20*1024*1024); total+=bytes.size; require(total<=40L*1024*1024) { "行业项目原文件合计不得超过40MB"} } }

        private fun validateAttributes(a:JSONArray){require(a.length()<=40); for(i in 0 until a.length()){val v=a.optJSONObject(i) ?: invalid("属性字段无效"); require(text(v,"name",60)&&text(v,"value",2000)) { "属性字段无效"} } }
        private fun validateFootprint(a:JSONArray){require(a.length() in 3..6000); var area=0.0; for(i in 0 until a.length()){val p=a.optJSONArray(i) ?: invalid("轮廓坐标无效"); val q=a.getJSONArray((i+1)%a.length()); require(p.length()==2&&(0..1).all{p.opt(it) is Number&&p.optDouble(it).isFinite()&&kotlin.math.abs(p.optDouble(it))<=.500001}); area+=p.getDouble(0)*q.getDouble(1)-q.getDouble(0)*p.getDouble(1) }; require(kotlin.math.abs(area)>2e-10) { "轮廓面积为零"} }
        private fun place(o:JSONObject?):Boolean = o != null && o.opt("name") is String && coordinate(o.optJSONArray("coordinates"),90.0)
        private fun validateCoordinateArray(a:JSONArray?,min:Int,max:Int){require(a!=null&&a.length() in min..max); for(i in 0 until a.length()) validateCoordinate(a.optJSONArray(i),90.0)}
        private fun validateCoordinate(p:JSONArray?,latMax:Double){require(coordinate(p,latMax)) { "坐标无效"} }
        private fun coordinate(p:JSONArray?,latMax:Double):Boolean = p!=null&&p.length()>=2&&p.opt(0) is Number&&p.opt(1) is Number&&p.optDouble(0).isFinite()&&p.optDouble(1).isFinite()&&kotlin.math.abs(p.optDouble(0))<=180&&kotlin.math.abs(p.optDouble(1))<=latMax
        private fun uniqueIds(a:JSONArray,label:String,check:(JSONObject)->Unit){val ids=mutableSetOf<String>(); for(i in 0 until a.length()){val o=a.optJSONObject(i) ?: invalid("${label}记录无效"); check(o); require(ids.add(o.optString("id"))) { "文件含重复编号"} }}
        private fun validateUniqueStrings(a:JSONArray,pattern:Regex){val set=mutableSetOf<String>(); for(i in 0 until a.length()){val s=a.optString(i,"\u0000"); require(pattern.matches(s)&&set.add(s)) { "列表含无效或重复项"} }}
        private fun validateBase64(value:String):Int=decodeBase64(value).size
        private fun decodeBase64(value:String):ByteArray { require(value.length%4==0&&value.matches(Regex("^[A-Za-z0-9+/]*={0,2}$"))) { "二进制文件 Base64 编码无效"}; val bytes=try{Base64.getDecoder().decode(value)}catch(e:IllegalArgumentException){throw IllegalArgumentException("二进制文件 Base64 编码无效",e)}; require(Base64.getEncoder().encodeToString(bytes)==value) { "二进制文件 Base64 编码无效"}; return bytes }
        private fun id(o:JSONObject,k:String,max:Int):Boolean = o.opt(k) is String && o.optString(k).isNotBlank() && o.optString(k).length<=max
        private fun text(o:JSONObject,k:String,max:Int,nonBlank:Boolean=false):Boolean = o.opt(k) is String && o.optString(k).length<=max && (!nonBlank||o.optString(k).trim().isNotEmpty())
        private fun finite(o:JSONObject,k:String):Boolean = o.opt(k) is Number && o.optDouble(k).isFinite()
        private fun safeInteger(o:JSONObject,k:String):Boolean = o.opt(k) is Number && o.optDouble(k).isFinite() && o.optDouble(k)%1.0==0.0 && kotlin.math.abs(o.optDouble(k))<=9007199254740991.0
        private fun bounded(o:JSONObject,k:String,min:Double,max:Double):Boolean = finite(o,k) && o.optDouble(k) in min..max
        private fun nullableFinite(o:JSONObject,k:String,maxAbs:Double=Double.MAX_VALUE):Boolean = o.has(k) && (o.isNull(k) || bounded(o,k,-maxAbs,maxAbs))
        private fun nullableFinite(o:JSONObject,k:String,min:Double,max:Double):Boolean = o.has(k) && (o.isNull(k)||bounded(o,k,min,max))
        private fun nullableBounded(o:JSONObject,k:String,min:Double,max:Double):Boolean = o.has(k) && (o.isNull(k)||bounded(o,k,min,max))
        private fun optionalBool(o:JSONObject,k:String){if(o.has(k)) require(o.opt(k) is Boolean) { "$k 格式无效"} }
        private fun integerRange(o:JSONObject,k:String,min:Int,max:Int):Boolean = o.opt(k) is Number && o.optDouble(k).isFinite() && o.optDouble(k)%1.0==0.0 && o.optDouble(k)>=min.toDouble() && o.optDouble(k)<=max.toDouble()
        private fun numberEquals(o:JSONObject,k:String,wanted:Int):Boolean = o.opt(k) is Number && o.optDouble(k).isFinite() && o.optDouble(k)==wanted.toDouble()
        private fun numberIn(o:JSONObject,k:String,allowed:Set<Int>):Boolean = o.opt(k) is Number && o.optDouble(k).isFinite() && o.optDouble(k)%1.0==0.0 && allowed.any{it.toDouble()==o.optDouble(k)}
        private fun groupId(v:String)=v.matches(Regex("^[\\w-]{1,80}$"))
        private fun invalid(message:String):Nothing=throw IllegalArgumentException(message)

        /** Legacy v1 is a copy/import operation: colliding IDs receive fresh IDs and all
         * references inside the imported graph follow those IDs. v2 deliberately keeps
         * mergeById's stable-ID overwrite semantics. */
        private fun mergeLegacyWorkspace(current:JSONObject,incoming:JSONObject):JSONObject {
            val out=JSONObject(current.toString())
            out.put("core", mergeLegacyCore(current.getJSONObject("core"),incoming.getJSONObject("core")))
            for(key in listOf("photos","mapSources","cadDocuments","industryProjects")) if(incoming.has(key)) out.put(key,mergeById(current.optJSONArray(key)?:JSONArray(),incoming.getJSONArray(key)))
            val settings=JSONObject(current.optJSONObject("settings")?.toString() ?: "{}"); val incSettings=incoming.optJSONObject("settings") ?: JSONObject(); val keys=incSettings.keys(); while(keys.hasNext()){val k=keys.next();settings.put(k,incSettings.get(k))}; out.put("settings",settings)
            return out
        }

        private fun mergeLegacyCore(local:JSONObject,incoming:JSONObject):JSONObject {
            val out=JSONObject(local.toString())
            val ids=mutableMapOf<String,String>()
            val copiedRecords=mutableSetOf<String>()
            fun mapped(kind:String,id:String)=ids["$kind:$id"] ?: id
            val changedSections=(0 until (incoming.optJSONArray("sections")?.length() ?: 0)).mapNotNull { incoming.optJSONArray("sections")?.optJSONObject(it) }.filter { next ->
                (0 until (local.optJSONArray("sections")?.length() ?: 0)).any { local.optJSONArray("sections")?.optJSONObject(it)?.let { it.optString("id")==next.optString("id") && !jsonEquals(it,next) } == true }
            }.map { it.optString("id") }.toSet()
            val linkedCopies=(0 until (incoming.optJSONArray("annotations")?.length() ?: 0)).mapNotNull { incoming.optJSONArray("annotations")?.optJSONObject(it) }.filter { a ->
                val sectionId=a.optJSONObject("sectionAnchor")?.optString("sectionId")
                sectionId != null && sectionId in changedSections
            }.map { it.optString("id") }.toSet()
            fun copy(kind:String,field:String,forceCopy:Set<String> = emptySet(), rewrite:(JSONObject)->JSONObject={it}) {
                val src=incoming.optJSONArray(field) ?: return
                val dst=JSONArray(); val existing=local.optJSONArray(field) ?: JSONArray()
                for(i in 0 until existing.length()) dst.put(existing.get(i))
                for(i in 0 until src.length()) {
                    val original=src.getJSONObject(i); val id=original.getString("id")
                    val identical=(0 until existing.length()).any { existing.optJSONObject(it)?.let { old -> old.optString("id")==id && jsonEquals(old,original) }==true }
                    if(identical && id !in forceCopy) { ids["$kind:$id"]=id; continue }
                    val collision=(0 until existing.length()).any { existing.optJSONObject(it)?.optString("id")==id } || (0 until i).any { src.optJSONObject(it)?.optString("id")==id }
                    val nextId=if(collision) java.util.UUID.randomUUID().toString() else id
                    ids["$kind:$id"]=nextId
                    val item=JSONObject(original.toString()).put("id",nextId)
                    dst.put(rewrite(item))
                    copiedRecords.add("$kind:$nextId")
                }
                out.put(field,dst)
            }
            copy("track","tracks")
            copy("annotation","annotations",linkedCopies)
            copy("route","favorites")
            copy("area","areas")
            copy("measurement","measurements")
            copy("section","sections")
            // Resolve references after every entity ID has a mapping.
            val tracks=out.optJSONArray("tracks") ?: JSONArray()
            for(i in 0 until tracks.length()) {
                val item=tracks.getJSONObject(i); if(item.optString("id") !in (0 until (local.optJSONArray("tracks")?.length() ?: 0)).mapNotNull { local.optJSONArray("tracks")?.optJSONObject(it)?.optString("id") }) {
                    item.optJSONArray("sourceTrackIds")?.let { refs -> for(j in 0 until refs.length()) refs.put(j,mapped("track",refs.getString(j))) }
                }
            }
            val annotations=out.optJSONArray("annotations") ?: JSONArray()
            for(i in 0 until annotations.length()) {
                val a=annotations.getJSONObject(i)
                if(a.has("trackAnchor")) { val anchor=a.getJSONObject("trackAnchor"); anchor.put("trackId",mapped("track",anchor.getString("trackId"))) }
                if(a.has("sectionAnchor")) { val anchor=a.getJSONObject("sectionAnchor"); anchor.put("sectionId",mapped("section",anchor.getString("sectionId"))); if(anchor.has("stationId")) anchor.put("stationId",mapped("annotation",anchor.getString("stationId"))) }
            }
            val sections=out.optJSONArray("sections") ?: JSONArray()
            for(i in 0 until sections.length()) {
                val s=sections.getJSONObject(i); val settings=s.optJSONObject("settings") ?: continue
                if(settings.optString("objectId").isNotEmpty()) settings.put("objectId",s.getString("id"))
                val survey=settings.optJSONObject("survey") ?: continue
                survey.optJSONArray("stations")?.let { arr -> for(j in 0 until arr.length()) { val p=arr.optJSONObject(j) ?: continue; val id=p.optString("id"); if(id!="A"&&id!="B") p.put("id",mapped("annotation",id)) } }
                survey.optJSONObject("pointData")?.let { points -> val replacement=JSONObject(); val it=points.keys(); while(it.hasNext()){val k=it.next();replacement.put(if(k=="A"||k=="B") k else mapped("annotation",k),points.get(k))}; settings.put("survey",JSONObject(survey.toString()).put("pointData",replacement)) }
            }
            incoming.optJSONObject("regions")?.let { regions ->
                val target=JSONObject(out.optJSONObject("regions")?.toString() ?: "{}")
                val it=regions.keys(); while(it.hasNext()) { val key=it.next(); val split=key.indexOf(':'); val mappedKey=if(split<0) key else key.substring(0,split)+":"+mapped(key.substring(0,split),key.substring(split+1)); if(!target.has(mappedKey)) target.put(mappedKey,regions.get(key)) }
                out.put("regions",target)
            }
            incoming.optJSONObject("collections")?.let { out.put("collections",mergeLegacyCollections(local.optJSONObject("collections"),it,out,ids,copiedRecords)) }
            incoming.optJSONArray("sectionNotes")?.let { notes ->
                val old=out.optJSONArray("sectionNotes") ?: JSONArray(); val combined=JSONArray(); for(i in 0 until old.length()) combined.put(old.get(i))
                for(i in 0 until notes.length()) { val rec=JSONObject(notes.getJSONObject(i).toString()); val settings=rec.optJSONObject("settings") ?: continue; val owner=settings.optString("objectId"); if(owner.isNotEmpty() && mapped("section",owner)!=owner) settings.put("objectId",mapped("section",owner)); combined.put(rec) }
                out.put("sectionNotes",mergeNotes(old,JSONArray().also { a -> for(i in 0 until combined.length()) a.put(combined.get(i)) }))
            }
            return out
        }

        private fun mergeLegacyCollections(local:JSONObject?,incoming:JSONObject,core:JSONObject,ids:Map<String,String>,copiedRecords:Set<String>):JSONObject {
            val before=local ?: JSONObject().put("version",1).put("groups",JSONArray()).put("assignments",JSONObject()).put("order",JSONArray())
            val groups=mutableListOf<JSONObject>(); val localGroups=before.optJSONArray("groups") ?: JSONArray(); for(i in 0 until localGroups.length()) groups.add(localGroups.getJSONObject(i))
            val incomingGroups=incoming.optJSONArray("groups") ?: JSONArray(); val groupIds=mutableMapOf<String,String>()
            fun resolve(group:JSONObject):String {
                val id=group.getString("id"); groupIds[id]?.let{return it}
                val parent=if(group.has("parentId")&&!group.isNull("parentId")) {
                    val parentId=group.getString("parentId"); val parentGroup=(0 until incomingGroups.length()).map{incomingGroups.getJSONObject(it)}.firstOrNull{it.optString("id")==parentId} ?: return ""
                    resolve(parentGroup)
                } else null
                val same=groups.firstOrNull{it.optString("id")==id}
                val remapped=if(same!=null && (same.optString("name")!=group.optString("name") || same.optString("color")!=group.optString("color") || same.optString("parentId")!=(parent ?: "")))
                    groups.firstOrNull{it.optString("name")==group.optString("name")&&it.optString("color")==group.optString("color")&&it.optString("parentId")== (parent ?: "") }?.optString("id") ?: java.util.UUID.randomUUID().toString()
                else id
                groupIds[id]=remapped
                if(groups.none{it.optString("id")==remapped}) { val copy=JSONObject(group.toString()).put("id",remapped); if(parent!=null)copy.put("parentId",parent) else copy.remove("parentId"); groups.add(copy) }
                return remapped
            }
            for(i in 0 until incomingGroups.length()) resolve(incomingGroups.getJSONObject(i))
            fun recordKey(key:String):String { val split=key.indexOf(':'); return if(split<0) key else key.substring(0,split)+":"+(ids[key.substring(0,split)+":"+key.substring(split+1)] ?: key.substring(split+1)) }
            val assignments=JSONObject(before.optJSONObject("assignments")?.toString() ?: "{}")
            val incomingAssignments=incoming.optJSONObject("assignments") ?: JSONObject(); val assignmentKeys=incomingAssignments.keys()
            while(assignmentKeys.hasNext()) { val key=assignmentKeys.next(); val mappedKey=recordKey(key); if(mappedKey in copiedRecords) { val group=incomingAssignments.optString(key); assignments.put(mappedKey,groupIds[group] ?: "unfiled") } }
            val order=JSONArray(); val orderSeen=mutableSetOf<String>(); val oldOrder=before.optJSONArray("order") ?: JSONArray()
            for(i in 0 until oldOrder.length()) { val key=oldOrder.getString(i); if(orderSeen.add(key))order.put(key) }
            val importedKeys=copiedRecords
            val newOrder=incoming.optJSONArray("order") ?: JSONArray(); for(i in 0 until newOrder.length()) { val key=recordKey(newOrder.getString(i)); if(key in importedKeys&&orderSeen.add(key))order.put(key) }
            val tree=JSONArray(); val treeSeen=mutableSetOf<String>(); val oldTree=before.optJSONArray("treeOrder") ?: JSONArray()
            for(i in 0 until oldTree.length()) { val key=oldTree.getString(i); if(treeSeen.add(key))tree.put(key) }
            val newTree=incoming.optJSONArray("treeOrder") ?: JSONArray(); for(i in 0 until newTree.length()) { val key=newTree.getString(i); val mapped=if(key=="folder:unfiled")key else if(key.startsWith("folder:")) groupIds[key.removePrefix("folder:")]?.let{"folder:$it"} else recordKey(key).takeIf{it in importedKeys}; if(mapped!=null&&treeSeen.add(mapped))tree.put(mapped) }
            return JSONObject(before.toString()).put("version",1).put("groups",JSONArray().also{groups.forEach(it::put)}).put("assignments",assignments).put("order",order).also{if(tree.length()>0)it.put("treeOrder",tree); if(incoming.has("tabOrder")&&!before.has("tabOrder"))it.put("tabOrder",incoming.getJSONArray("tabOrder"))}
        }

        private fun mergeWorkspace(current:JSONObject,incoming:JSONObject):JSONObject {
            val out=JSONObject(current.toString())
            val incomingKeys=incoming.keys(); while(incomingKeys.hasNext()){val k=incomingKeys.next(); out.put(k,incoming.get(k))}
            val localCore=current.getJSONObject("core"); val incCore=incoming.getJSONObject("core")
            val core=mergeCore(localCore,incCore); out.put("core",core)
            for(key in listOf("photos","mapSources","cadDocuments","industryProjects")){
                if(incoming.has(key)) out.put(key,mergeById(current.optJSONArray(key)?:JSONArray(),incoming.getJSONArray(key)))
            }
            val settings=JSONObject(current.optJSONObject("settings")?.toString() ?: "{}"); val incSettings=incoming.getJSONObject("settings"); val keys=incSettings.keys(); while(keys.hasNext()){val k=keys.next(); settings.put(k,incSettings.getString(k))}; out.put("settings",settings)
            if(incoming.has("limitations")) out.put("limitations",incoming.getJSONArray("limitations"))
            return out
        }

        private fun mergeCore(local:JSONObject,incoming:JSONObject):JSONObject {
            val out=JSONObject(local.toString())
            val incomingKeys=incoming.keys(); while(incomingKeys.hasNext()){val k=incomingKeys.next(); out.put(k,incoming.get(k))}
            for(k in listOf("tracks","annotations","favorites","areas","measurements","sections")) if(incoming.has(k)) out.put(k,mergeById(local.optJSONArray(k)?:JSONArray(),incoming.getJSONArray(k)))
            if(incoming.has("regions")){val regions=JSONObject(local.optJSONObject("regions")?.toString()?:"{}"); val r=incoming.getJSONObject("regions"); val keys=r.keys(); while(keys.hasNext()){val k=keys.next(); regions.put(k,r.get(k))}; out.put("regions",regions)}
            if(incoming.has("collections")) out.put("collections",mergeCollections(local.optJSONObject("collections"),incoming.getJSONObject("collections"),incoming))
            if(incoming.has("sectionNotes")) out.put("sectionNotes",mergeNotes(local.optJSONArray("sectionNotes")?:JSONArray(),incoming.getJSONArray("sectionNotes")))
            return out
        }

        private fun mergeById(local:JSONArray,incoming:JSONArray):JSONArray {
            val values=LinkedHashMap<String,JSONObject>()
            for(i in 0 until local.length()){val item=local.getJSONObject(i); values[item.getString("id")]=item}
            for(i in 0 until incoming.length()){val item=incoming.getJSONObject(i); values[item.getString("id")]=item}
            return JSONArray().also{out->values.values.forEach(out::put)}
        }

        private fun mergeNotes(local:JSONArray,incoming:JSONArray):JSONArray {
            fun key(o:JSONObject):String {val s=o.getJSONObject("settings"); if(s.has("objectId")) return "id:${s.getString("objectId")}"; val p=s.getJSONObject("plane"); val tuple=JSONArray().put(p.getJSONArray("center")).put(s.get("altitude")).put(p.get("width")).put(p.get("height")).put(p.get("heading")).put(p.get("tilt")).put(p.opt("roll")?:0); return "geometry:$tuple"}
            val out=LinkedHashMap<String,JSONObject>()
            for(i in 0 until local.length()){val item=local.getJSONObject(i); out[key(item)]=item}
            for(i in 0 until incoming.length()) { val item=incoming.getJSONObject(i); val k=key(item); val old=out[k]; if(old==null){out[k]=item;continue}; val notes=mergeById(old.getJSONArray("notes"),item.getJSONArray("notes")); out[k]=JSONObject(item.toString()).put("notes",notes) }
            return JSONArray().also{arr->out.values.forEach(arr::put)}
        }

        private fun mergeCollections(local:JSONObject?,incoming:JSONObject,core:JSONObject):JSONObject {
            val existing=local?:JSONObject().put("version",1).put("groups",JSONArray()).put("assignments",JSONObject()).put("order",JSONArray())
            val groups=LinkedHashMap<String,JSONObject>(); val localGroups=existing.optJSONArray("groups")?:JSONArray(); val incGroups=incoming.getJSONArray("groups")
            for(i in 0 until localGroups.length()){val g=localGroups.getJSONObject(i);groups[g.getString("id")]=g}
            for(i in 0 until incGroups.length()){val g=incGroups.getJSONObject(i);groups[g.getString("id")]=g}
            val imported=mutableSetOf<String>(); for((container,prefix) in listOf("tracks" to "track","favorites" to "route","annotations" to "annotation","areas" to "area","measurements" to "measurement","sections" to "section")){val a=core.optJSONArray(container)?:continue; for(i in 0 until a.length()) imported.add("$prefix:${a.getJSONObject(i).getString("id")}")}
            val assignments=JSONObject(existing.optJSONObject("assignments")?.toString()?:"{}"); val keys=assignments.keys().asSequence().toList(); keys.filter(imported::contains).forEach(assignments::remove)
            val incAssign=incoming.optJSONObject("assignments")?:JSONObject(); val akeys=incAssign.keys(); while(akeys.hasNext()){val k=akeys.next(); if(imported.contains(k)) assignments.put(k,incAssign.get(k))}
            val order=JSONArray(); val orderSet=mutableSetOf<String>(); val localOrder=existing.optJSONArray("order")?:JSONArray(); for(i in 0 until localOrder.length()){val k=localOrder.getString(i);if(!imported.contains(k)&&orderSet.add(k))order.put(k)}; val incOrder=incoming.getJSONArray("order"); for(i in 0 until incOrder.length()){val k=incOrder.getString(i);if(imported.contains(k)&&orderSet.add(k))order.put(k)}
            val tree=JSONArray(); val treeSet=mutableSetOf<String>(); val localTree=existing.optJSONArray("treeOrder")?:JSONArray(); val incTree=incoming.optJSONArray("treeOrder")?:JSONArray(); val incomingFolderKeys=(0 until incGroups.length()).map{"folder:${incGroups.getJSONObject(it).optString("id")}"}.toSet(); for(i in 0 until localTree.length()){val k=localTree.getString(i);if((if(k.startsWith("folder:"))k !in incomingFolderKeys else !imported.contains(k))&&treeSet.add(k))tree.put(k)}; for(i in 0 until incTree.length()){val k=incTree.getString(i);if(treeSet.add(k))tree.put(k)}
            val out=JSONObject(existing.toString()); val custom=incoming.keys(); while(custom.hasNext()){val k=custom.next(); if(k !in setOf("version","groups","assignments","order","treeOrder","tabOrder")) out.put(k,incoming.get(k))}; out.put("version",1).put("groups",JSONArray().also{arr->groups.values.forEach(arr::put)}).put("assignments",assignments).put("order",order)
            if(incoming.has("tabOrder")) out.put("tabOrder",incoming.getJSONArray("tabOrder")) else if(existing.has("tabOrder")) out.put("tabOrder",existing.getJSONArray("tabOrder"))
            if(tree.length()>0)out.put("treeOrder",tree) else out.remove("treeOrder")
            return out
        }

        private fun summarizeImport(before:JSONObject,incoming:JSONObject):ImportSummary {
            val add=mutableMapOf<String,Int>(); val overwrite=mutableMapOf<String,Int>()
            fun count(name:String,old:JSONArray?,inc:JSONArray?){if(inc==null)return;val map=mutableMapOf<String,String>();if(old!=null)for(i in 0 until old.length()){val o=old.getJSONObject(i);map[o.optString("id")]=o.toString()}; for(i in 0 until inc.length()){val o=inc.getJSONObject(i);val id=o.optString("id");if(id !in map)add[name]=(add[name]?:0)+1 else if(map[id]!=o.toString())overwrite[name]=(overwrite[name]?:0)+1} }
            val bcore=before.optJSONObject("core")?:JSONObject();val icore=incoming.getJSONObject("core")
            for(k in listOf("tracks","annotations","favorites","areas","measurements","sections")) count(k,bcore.optJSONArray(k),icore.optJSONArray(k))
            for(k in listOf("photos","mapSources","cadDocuments","industryProjects")) count(k,before.optJSONArray(k),incoming.optJSONArray(k))
            count("groups",bcore.optJSONObject("collections")?.optJSONArray("groups"),icore.optJSONObject("collections")?.optJSONArray("groups"))
            return ImportSummary(add,overwrite)
        }
    }
}
