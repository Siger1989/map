package com.shantu.nativeapp.data

import org.json.JSONArray
import org.json.JSONObject

/** Small, allowlisted handoff for unsaved drawing and a paused GPS recording. */
data class NativeTaskMigration(val draft: JSONObject?, val recording: JSONObject?, val fileReferences: JSONArray) {
    fun toTracks(): List<JSONObject> = buildList {
        draft?.let { add(JSONObject(it.toString())) }
        recording?.let { add(JSONObject(it.toString())) }
    }

    companion object {
        const val FORMAT = "shantu-paused-task-migration"
        const val VERSION = 1
        const val MAX_BYTES = 8 * 1024 * 1024
        private val DRAFT_KEYS = setOf("id", "name", "createdAt", "source", "segments", "style", "edgeColors", "colorConditions", "pointDetails", "edgeNotes", "routeTerminals", "nodes")
        private val RECORD_KEYS = setOf("id", "startedAt", "segments", "style")

        fun parse(raw: String): NativeTaskMigration {
            require(raw.toByteArray(Charsets.UTF_8).size <= MAX_BYTES) { "暂停任务迁移文件超过8MiB" }
            val root = try { JSONObject(raw) } catch (e: Exception) { throw IllegalArgumentException("暂停任务迁移 JSON 无效", e) }
            require(root.optString("format") == FORMAT && root.optInt("version") == VERSION) { "暂停任务迁移版本或格式不支持" }
            val draft = root.optJSONObject("draft")?.let { validateDraft(it) }
            val recording = root.optJSONObject("recording")?.let { validateRecording(it) }
            require(draft != null || recording != null) { "迁移文件没有可恢复的画线草稿或记录检查点" }
            val refs = root.optJSONArray("fileReferences") ?: JSONArray()
            require(refs.length() <= 100) { "可重新选择的文件引用超过100项" }
            val safeRefs = JSONArray()
            for (i in 0 until refs.length()) {
                val item = refs.optJSONObject(i) ?: invalid("文件引用无效")
                require(item.keys().asSequence().all { it == "displayName" || it == "purpose" }) { "文件引用含不允许的数据字段" }
                val name = item.optString("displayName")
                val purpose = item.optString("purpose")
                require(name.isNotBlank() && name.length <= 240 && purpose.length <= 120) { "文件引用说明无效" }
                // A URI/permission token is intentionally never accepted: grants do not cross apps.
                require(!item.has("uri") && !item.has("grant") && !item.has("permission")) { "文件引用不能携带跨应用 URI 授权，请在新应用中重新选择文件" }
                safeRefs.put(JSONObject().put("displayName", name).put("purpose", purpose).put("reselectRequired", true))
            }
            val allowedRoot = setOf("format", "version", "createdAt", "draft", "recording", "fileReferences")
            require((root.keys().asSequence().toSet() - allowedRoot).isEmpty()) { "迁移文件含不允许的数据字段" }
            if (root.has("createdAt")) require(root.opt("createdAt") is Number && root.optDouble("createdAt").isFinite()) { "迁移时间无效" }
            return NativeTaskMigration(draft, recording, safeRefs)
        }

        private fun validateDraft(input: JSONObject): JSONObject {
            require(input.keys().asSequence().all { it in DRAFT_KEYS }) { "画线草稿含不允许的字段" }
            val id = input.optString("id")
            require(id.isNotBlank() && id.length <= 250) { "画线草稿编号无效" }
            val segments = input.optJSONArray("segments") ?: invalid("画线草稿缺少线段")
            validateSegments(segments, 1)
            val out = JSONObject().put("id", id).put("name", input.optString("name", "迁入的画线草稿").take(200))
                .put("createdAt", input.optDouble("createdAt", System.currentTimeMillis().toDouble()))
                .put("source", "manual").put("segments", JSONArray(segments.toString()))
            copyOptional(input, out, "style", "edgeColors", "colorConditions", "pointDetails", "edgeNotes", "routeTerminals", "nodes")
            return out
        }

        private fun validateRecording(input: JSONObject): JSONObject {
            require(input.keys().asSequence().all { it in RECORD_KEYS || it == "phase" }) { "记录检查点含不允许的字段" }
            require(input.optString("phase") in setOf("recording", "paused")) { "只允许迁入进行中或暂停的记录检查点" }
            val id = input.optString("id")
            require(id.isNotBlank() && id.length <= 250) { "记录检查点编号无效" }
            val source = input.optJSONArray("segments") ?: invalid("记录检查点缺少线段")
            require(source.length() in 1..100) { "记录检查点分段数量无效" }
            val segments = JSONArray(); val samples = JSONArray(); var total = 0
            for (i in 0 until source.length()) {
                val line = source.optJSONArray(i) ?: invalid("记录检查点线段无效")
                if (line.length() == 0) continue
                val coordinates = JSONArray(); val row = JSONArray()
                for (j in 0 until line.length()) {
                    val fix = line.optJSONObject(j) ?: invalid("记录点无效")
                    val coord = fix.optJSONArray("coordinates") ?: invalid("记录点坐标无效")
                    require(coord.length() == 2 && coord.optDouble(0).isFinite() && coord.optDouble(1).isFinite() && kotlin.math.abs(coord.optDouble(0)) <= 180 && kotlin.math.abs(coord.optDouble(1)) <= 85.051129) { "记录点坐标越界" }
                    val time = fix.opt("time"); val accuracy = fix.optDouble("accuracy", Double.NaN)
                    require(time is Number && time.toDouble().isFinite() && accuracy.isFinite() && accuracy in 0.0..80.0) { "记录点时间或定位精度无效" }
                    val altitude = fix.opt("altitude")
                    require(altitude == null || altitude == JSONObject.NULL || altitude is Number && altitude.toDouble().isFinite()) { "记录点高程无效" }
                    coordinates.put(JSONArray(coord.toString()))
                    row.put(JSONObject().put("time", time).put("altitude", altitude ?: JSONObject.NULL))
                    total++
                }
                segments.put(coordinates); samples.put(row)
            }
            require(total in 1..6000 && segments.length() > 0) { "记录检查点须含1至6000个点" }
            val out = JSONObject().put("id", id).put("name", "迁入的暂停记录")
            .put("createdAt", input.optDouble("startedAt", System.currentTimeMillis().toDouble()))
                .put("source", "recorded").put("segments", segments).put("samples", samples)
                .put("migrationCheckpoint", JSONObject().put("phase", "paused").put("originalId", id))
            input.optJSONObject("style")?.let { out.put("style", JSONObject(it.toString())) }
            return out
        }

        private fun validateSegments(segments: JSONArray, minimum: Int) {
            require(segments.length() in 1..100) { "草稿分段数量无效" }
            var count = 0
            for (i in 0 until segments.length()) {
                val line = segments.optJSONArray(i) ?: invalid("草稿线段无效")
                require(line.length() >= minimum) { "草稿线段点数不足" }
                for (j in 0 until line.length()) {
                    val point = line.optJSONArray(j) ?: invalid("草稿坐标无效")
                    require(point.length() >= 2 && point.optDouble(0).isFinite() && point.optDouble(1).isFinite() && kotlin.math.abs(point.optDouble(0)) <= 180 && kotlin.math.abs(point.optDouble(1)) <= 85.051129) { "草稿坐标越界" }
                    count++
                }
            }
            require(count in 1..6000) { "草稿须含1至6000个点" }
        }
        private fun copyOptional(from: JSONObject, to: JSONObject, vararg keys: String) { keys.forEach { key -> from.opt(key)?.let { to.put(key, it) } } }
        private fun invalid(message: String): Nothing = throw IllegalArgumentException(message)
    }
}
