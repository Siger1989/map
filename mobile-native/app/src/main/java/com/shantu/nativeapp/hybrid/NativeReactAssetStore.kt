package com.shantu.nativeapp.hybrid

import android.content.Context
import android.util.Base64
import android.util.AtomicFile
import com.shantu.nativeapp.offlineMaps.NativeOfflineMapStore
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.math.BigDecimal
import java.security.MessageDigest

/** Bounded ordered binary transfer into an app-private native raster mirror. No source row is rewritten. */
class NativeReactAssetStore(context: Context) : AutoCloseable {
    private val app = context.applicationContext
    private val root = File(app.cacheDir, "hybrid-map-transfer").apply { mkdirs() }
    private val maps = NativeOfflineMapStore(app)
    private val indexFile = AtomicFile(File(app.filesDir, "native-offline-maps/native-react-assets-index.json"))
    private data class Transfer(val file: File, val size: Long, val sha256: String, val metadata: JSONObject,
        val mime: String, val digest: MessageDigest = MessageDigest.getInstance("SHA-256"), var index: Int = 0, var written: Long = 0)
    private val pending = linkedMapOf<String, Transfer>()
    private val completed = linkedMapOf<String, JSONObject>()
    private data class Mirror(val sourceId: String, val sha256: String, val fingerprint: String,
        val nativeAssetId: String, val size: Long)
    private val mirrors = linkedMapOf<String, Mirror>()
    private var indexLoaded = false

    @Synchronized fun command(name: String, payload: JSONObject): JSONObject? {
        if (name !in setOf("mapAssetLookup", "mapAssetBegin", "mapAssetChunk", "mapAssetCommit", "mapAssetAbort")) return null
        if (name == "mapAssetLookup") return lookup(payload)
        val id = payload.optString("transferId")
        require(id.matches(Regex("[a-zA-Z0-9-]{1,100}"))) { "离线地图传输编号无效" }
        return when (name) {
            "mapAssetBegin" -> {
                require(pending.size < 2 && !pending.containsKey(id)) { "已有离线地图正在同步" }
                val size = payload.optLong("size", -1)
                require(size in 1..NativeOfflineMapStore.MAX_FILE_BYTES) { "离线地图大小无效" }
                val sha = payload.optString("sha256")
                require(sha.matches(Regex("[a-f0-9]{64}"))) { "离线地图校验值无效" }
                val metadata = JSONObject((payload.optJSONObject("metadata") ?: error("缺少离线地图元数据")).toString())
                require(metadata.optString("id") == payload.optString("sourceId")) { "离线地图编号不一致" }
                require(metadata.optString("kind") in setOf("mbtiles", "image")) { "图源不需要文件同步" }
                val file = File(root, "$id.part")
                check(file.canonicalFile.parentFile == root.canonicalFile && file.createNewFile()) { "离线地图临时文件创建失败" }
                pending[id] = Transfer(file, size, sha, metadata, payload.optString("blobMime"))
                JSONObject().put("accepted", true)
            }
            "mapAssetChunk" -> {
                val transfer = pending[id] ?: error("离线地图传输已失效")
                require(payload.optInt("index", -1) == transfer.index) { "离线地图分片顺序不一致" }
                val encoded = payload.optString("base64")
                require(encoded.length in 1..349_528) { "离线地图分片超过256 KiB" }
                val bytes = Base64.decode(encoded, Base64.NO_WRAP)
                require(bytes.size in 1..262_144 && transfer.written + bytes.size <= transfer.size) { "离线地图分片容量不一致" }
                FileOutputStream(transfer.file, true).use { it.write(bytes) }
                transfer.digest.update(bytes); transfer.written += bytes.size; transfer.index++
                JSONObject().put("next", transfer.index).put("written", transfer.written)
            }
            "mapAssetCommit" -> {
                val transfer = pending[id] ?: error("离线地图传输已失效")
                require(transfer.written == transfer.size && transfer.file.length() == transfer.size) { "离线地图分片未完整接收" }
                val digest = transfer.digest.digest().joinToString("") { "%02x".format(it) }
                require(digest == transfer.sha256) { "离线地图SHA256校验失败" }
                FileOutputStream(transfer.file, true).use { it.fd.sync() }
                // Two map views can start the same source transfer before either lookup sees a
                // committed mirror. Serialize commits and recheck the durable index here.
                val existing = lookup(JSONObject().put("sourceId", transfer.metadata.getString("id"))
                    .put("sha256", transfer.sha256).put("metadata", transfer.metadata))
                if (existing.optBoolean("found")) {
                    pending.remove(id); transfer.file.delete()
                    return existing.put("size", transfer.size)
                }
                val native = maps.importStoredMapFile(transfer.metadata, transfer.file, transfer.mime)
                val assetId = "${native.id}:${transfer.sha256}"
                val completedRecord = nativeRecord(transfer.metadata, native)
                completed[assetId] = completedRecord
                val mirror = Mirror(transfer.metadata.getString("id"), transfer.sha256,
                    fingerprint(transfer.metadata), assetId, transfer.size)
                try {
                    loadIndex()
                    mirrors[mirrorKey(mirror.sourceId, mirror.sha256, mirror.fingerprint)] = mirror
                    persistIndex()
                } catch (error: Exception) {
                    completed.remove(assetId)
                    maps.delete(native.id)
                    throw error
                }
                pending.remove(id); transfer.file.delete()
                JSONObject().put("nativeAssetId", assetId).put("sha256", digest).put("size", transfer.size)
            }
            else -> {
                pending.remove(id)?.file?.delete()
                JSONObject().put("aborted", true)
            }
        }
    }

    @Synchronized fun resolve(source: JSONObject): JSONObject {
        if (source.optString("kind", "online") == "online") return source
        val stored = completed[source.optString("nativeAssetId")] ?: error("离线地图尚未完成原生同步")
        require(stored.optString("id") == source.optString("id")) { "离线地图编号不一致" }
        // Only a file created by this store may be resolved. Arbitrary JS file paths are ignored.
        return JSONObject(source.toString()).put("filePath", stored.getString("filePath"))
            .put("kind", stored.getString("kind")).put("format", stored.getString("format"))
    }

    private fun lookup(payload: JSONObject): JSONObject {
        val sourceId = payload.optString("sourceId")
        val sha = payload.optString("sha256")
        val metadata = payload.optJSONObject("metadata") ?: error("缺少离线地图元数据")
        require(sourceId.isNotBlank() && metadata.optString("id") == sourceId) { "离线地图编号不一致" }
        require(sha.matches(Regex("[a-f0-9]{64}"))) { "离线地图校验值无效" }
        loadIndex()
        val fp = fingerprint(metadata)
        val mirror = mirrors[mirrorKey(sourceId, sha, fp)] ?: return JSONObject().put("found", false).put("sha256", sha)
        val mapId = mirror.nativeAssetId.substringBefore(':')
        val native = maps.list().firstOrNull { it.id == mapId }
            ?: run { mirrors.remove(mirrorKey(sourceId, sha, fp)); persistIndex(); return JSONObject().put("found", false).put("sha256", sha) }
        val file = File(native.filePath)
        if (!file.isFile || file.length() != mirror.size || mirror.size <= 0 || sha256(file) != sha) {
            mirrors.remove(mirrorKey(sourceId, sha, fp)); persistIndex()
            return JSONObject().put("found", false).put("sha256", sha)
        }
        completed[mirror.nativeAssetId] = nativeRecord(metadata, native)
        return JSONObject().put("found", true).put("nativeAssetId", mirror.nativeAssetId)
            .put("sha256", sha).put("size", mirror.size)
    }

    private fun nativeRecord(source: JSONObject, native: com.shantu.nativeapp.offlineMaps.NativeOfflineMap) =
        JSONObject(source.toString()).put("kind", native.kind).put("filePath", native.filePath).put("format", native.format)

    private fun loadIndex() {
        if (indexLoaded) return
        indexLoaded = true
        runCatching {
            val entries = JSONObject(indexFile.openRead().bufferedReader(Charsets.UTF_8).use { it.readText() })
                .optJSONArray("mirrors") ?: return@runCatching
            for (i in 0 until entries.length()) {
                val o = entries.optJSONObject(i) ?: continue
                val m = Mirror(o.getString("sourceId"), o.getString("sha256"), o.getString("fingerprint"),
                    o.getString("nativeAssetId"), o.getLong("size"))
                if (m.sourceId.isNotBlank() && m.sha256.matches(Regex("[a-f0-9]{64}")) && m.size > 0)
                    mirrors[mirrorKey(m.sourceId, m.sha256, m.fingerprint)] = m
            }
        }
    }

    private fun persistIndex() {
        val out = JSONObject().put("version", 1).put("mirrors", org.json.JSONArray().also { array ->
            mirrors.values.forEach { m -> array.put(JSONObject().put("sourceId", m.sourceId).put("sha256", m.sha256)
                .put("fingerprint", m.fingerprint).put("nativeAssetId", m.nativeAssetId).put("size", m.size)) }
        })
        var stream: java.io.FileOutputStream? = null
        try {
            stream = indexFile.startWrite()
            stream.write(out.toString().toByteArray(Charsets.UTF_8)); stream.fd.sync()
            indexFile.finishWrite(stream)
        } catch (error: Exception) {
            if (stream != null) indexFile.failWrite(stream)
            throw error
        }
    }

    private fun fingerprint(json: JSONObject): String = MessageDigest.getInstance("SHA-256")
        .digest(canonical(json).toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
    private fun canonical(value: Any?): String = when (value) {
        is JSONObject -> value.keys().asSequence().filter { it !in setOf("nativeAssetId", "filePath") }.sorted()
            .joinToString(prefix = "{", postfix = "}") { key -> JSONObject.quote(key) + ":" + canonical(value.get(key)) }
        is org.json.JSONArray -> (0 until value.length()).joinToString(prefix = "[", postfix = "]") { canonical(value.get(it)) }
        JSONObject.NULL -> "null"
        is String -> JSONObject.quote(value)
        // JSON may round-trip integral doubles as longs (100.0 -> 100). Fingerprints
        // describe JSON values, so normalize numerically equivalent representations.
        is Number -> canonicalNumber(value)
        is Boolean -> value.toString()
        else -> JSONObject.quote(value.toString())
    }
    private fun canonicalNumber(value: Number): String = runCatching {
        val decimal = BigDecimal(value.toString()).stripTrailingZeros()
        if (decimal.compareTo(BigDecimal.ZERO) == 0) "0" else decimal.toPlainString()
    }.getOrElse { JSONObject.numberToString(value) }
    private fun mirrorKey(sourceId: String, sha: String, fp: String) = "$sourceId\u0000$sha\u0000$fp"
    private fun sha256(file: File): String = FileInputStream(file).use { input ->
        val digest = MessageDigest.getInstance("SHA-256"); val buffer = ByteArray(64 * 1024)
        while (true) { val count = input.read(buffer); if (count < 0) break; digest.update(buffer, 0, count) }
        digest.digest().joinToString("") { "%02x".format(it) }
    }

    @Synchronized fun clearPending() { pending.values.forEach { it.file.delete() }; pending.clear() }
    @Synchronized override fun close() { clearPending(); completed.clear(); mirrors.clear(); indexLoaded = false }
}
