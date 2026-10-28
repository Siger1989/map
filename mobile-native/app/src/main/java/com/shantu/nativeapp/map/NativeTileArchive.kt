package com.shantu.nativeapp.map

import android.util.AtomicFile
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.atomic.AtomicLong

/** User-created offline packages live in filesDir, separately from disposable browse cache. */
internal class NativeTileArchive(
    private val root: File,
    private val maxArchiveBytes: Long = MAX_ARCHIVE_BYTES,
) {
    private val rootLock = lockFor(root)
    private val files = linkedMapOf<String, MutableSet<File>>()
    @Volatile private var indexed = false
    private var indexedRevision = -1L
    private var usedBytes = 0L
    private val version=revisionFor(root)
    init { require(maxArchiveBytes in 1..MAX_ARCHIVE_BYTES) }
    private fun packageDir(id: String): File {
        require(runCatching { UUID.fromString(id).toString() == id }.getOrDefault(false))
        return root.resolve(id)
    }
    @Synchronized private fun index() {
        val current=version.get()
        if (indexed && indexedRevision==current) return
        files.clear()
        usedBytes=0L
        root.listFiles()?.filter { it.isDirectory && runCatching { UUID.fromString(it.name) }.isSuccess }?.forEach { dir ->
            dir.listFiles()?.filter { it.isFile && it.name.matches(Regex("[0-9a-f]{64}\\.tile")) }?.forEach {
                files.getOrPut(it.name) { linkedSetOf() }.add(it)
                usedBytes += it.length()
            }
        }
        indexed = true
        indexedRevision=current
    }
    @Synchronized fun read(url: String): ByteArray? = synchronized(rootLock) {
        index()
        files[digest(url) + ".tile"]?.firstNotNullOfOrNull { file ->
            if (!file.isFile || file.length() !in 1..MAX_TILE_BYTES) null
            else runCatching { AtomicFile(file).openRead().use { it.readBytes() } }.getOrNull()
        }
    }
    @Synchronized fun contains(id: String, url: String): Boolean = synchronized(rootLock) { packageDir(id).resolve(digest(url) + ".tile").let {
        it.isFile && it.length() in 1..MAX_TILE_BYTES
    } }
    @Synchronized fun write(id: String, url: String, bytes: ByteArray) = synchronized(rootLock) {
        require(bytes.size in 1..MAX_TILE_BYTES.toInt())
        index()
        val dir = packageDir(id).apply { mkdirs() }
        val file = dir.resolve(digest(url) + ".tile")
        val nextSize = usedBytes - (if (file.isFile) file.length() else 0) + bytes.size
        require(nextSize <= maxArchiveBytes) { "离线包总空间已达到 8 GiB 上限" }
        atomic(file, bytes)
        usedBytes = nextSize
        files.getOrPut(file.name) { linkedSetOf() }.add(file)
        indexedRevision=version.incrementAndGet()
    }
    @Synchronized fun save(manifest: JSONObject) = synchronized(rootLock) {
        val dir = packageDir(manifest.getString("id")).apply { mkdirs() }
        atomic(dir.resolve("manifest.json"), manifest.toString().toByteArray(Charsets.UTF_8))
    }
    @Synchronized fun list(): List<JSONObject> = synchronized(rootLock) { root.listFiles()?.filter { it.isDirectory }?.mapNotNull { dir ->
        runCatching {
            packageDir(dir.name)
            val file = dir.resolve("manifest.json")
            require(file.length() <= 8 * 1024 * 1024)
            JSONObject(AtomicFile(file).openRead().bufferedReader().use { it.readText() })
                .put("bytes", dir.listFiles()?.filter { it.extension == "tile" }?.sumOf { it.length() } ?: 0)
                .put("stored", dir.listFiles()?.count { it.extension == "tile" } ?: 0)
        }.getOrNull()
    }?.sortedByDescending { it.optLong("createdAt") } ?: emptyList() }
    /** Only invoked after the user chooses and confirms this specific package. */
    @Synchronized fun delete(id: String):Unit = synchronized(rootLock) {
        val dir = packageDir(id)
        require(dir.canonicalFile.parentFile == root.canonicalFile)
        check(!dir.exists() || dir.deleteRecursively()) { "离线包未能完整删除，请重试" }
        indexed = false
        usedBytes = 0L
        files.clear()
        version.incrementAndGet()
        Unit
    }
    private fun atomic(file: File, bytes: ByteArray) {
        val target = AtomicFile(file)
        val stream = target.startWrite()
        try { stream.write(bytes); target.finishWrite(stream) }
        catch (error: Exception) { target.failWrite(stream); throw error }
    }
    companion object {
        const val MAX_ARCHIVE_BYTES = NativeCachePlan.MAX_ARCHIVE_BYTES
        private const val MAX_TILE_BYTES = 4L * 1024 * 1024
        private val revisions=hashMapOf<String,AtomicLong>()
        private val rootLocks=hashMapOf<String,Any>()
        private fun lockFor(root:File):Any {
            val key=runCatching { root.canonicalFile.path }.getOrDefault(root.absolutePath)
            return synchronized(rootLocks) { rootLocks.getOrPut(key) { Any() } }
        }
        private fun revisionFor(root:File):AtomicLong {
            val key=runCatching { root.canonicalFile.path }.getOrDefault(root.absolutePath)
            return synchronized(revisions) { revisions.getOrPut(key) { AtomicLong() } }
        }
        fun digest(value: String) = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
    }
}
