package com.shantu.nativeapp.map

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.util.AtomicFile
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.util.concurrent.ConcurrentHashMap

/** Durable cache for ordinary map browsing. This is separate from temporary HTTP cache and offline packages. */
internal class NativePersistentBrowseCache(
    context: Context,
    private val maxBytes: Long = DEFAULT_MAX_BYTES,
    private val ttlMillis: Long = DEFAULT_TTL_MILLIS,
    private val minFreeBytes: Long = DEFAULT_MIN_FREE_BYTES,
    private val clock: () -> Long = System::currentTimeMillis,
    private val onCacheFailure: ((operation: String, failureClass: String) -> Unit)? = null,
) : AutoCloseable {
    data class Entry(val bytes: ByteArray, val savedAtMillis: Long, val isFresh: Boolean)
    data class Stats(val bytes: Long, val entries: Long, val maxBytes: Long, val generation: Long)

    private val root = File(context.applicationContext.filesDir, CACHE_DIRECTORY)
    private val tilesRoot = File(root, "tiles")
    private val lock = locks.computeIfAbsent(root.canonicalPath) { Any() }
    private val helper = Index(context.applicationContext, File(root, "index.sqlite"))
    @Volatile private var closed = false

    init {
        require(maxBytes > 0) { "maxBytes must be positive" }
        require(ttlMillis >= 0) { "ttlMillis must not be negative" }
        require(minFreeBytes >= 0) { "minFreeBytes must not be negative" }
    }

    /** Capture before a network request and pass to write; a clear invalidates responses from older generations. */
    suspend fun generationToken(): Long? = ioOrNull("generationToken") {
        synchronized(lock) { ensureOpen(); generation(helper.readableDatabase) }
    }

    /** Disk work always runs on Dispatchers.IO. Stale bytes remain available when allowStale is true. */
    suspend fun read(url: String, allowStale: Boolean = true): Entry? = ioOrNull("read") {
        val key = hash(url)
        synchronized(lock) {
            ensureOpen()
            val db = helper.writableDatabase
            drainDeletes(db)
            val gen = generation(db)
            val row = find(db, key, gen) ?: return@synchronized null
            val file = safeFile(row.path)
            if (file == null || file.length() != row.size || row.size !in 1..MAX_TILE_BYTES) {
                removeEntry(db, key, gen, row)
                drainDeletes(db)
                return@synchronized null
            }
            val bytes = try { file.readBytes() } catch (_: Exception) { null }
            if (bytes == null || bytes.size.toLong() != row.size) {
                removeEntry(db, key, gen, row)
                drainDeletes(db)
                return@synchronized null
            }
            val now = clock()
            val age = now - row.savedAt
            val fresh = age >= 0 && age <= ttlMillis
            if (!fresh && !allowStale) return@synchronized null
            ContentValues().apply { put("last_accessed", now) }.also {
                db.update("entries", it, "url_hash=? AND generation=?", arrayOf(key, gen.toString()))
            }
            Entry(bytes, row.savedAt, fresh)
        }
    }

    /** Returns false for storage errors, oversized values, closed cache, or a response invalidated by clear(). */
    suspend fun write(url: String, bytes: ByteArray, savedAtMillis: Long = clock(), generationToken: Long? = null): Boolean =
        ioOrFalse("write") {
            if (bytes.isEmpty() || bytes.size.toLong() > MAX_TILE_BYTES || bytes.size.toLong() > maxBytes) return@ioOrFalse false
            val key = hash(url)
            synchronized(lock) {
                ensureOpen()
                val db = helper.writableDatabase
                drainDeletes(db)
                val gen = generation(db)
                if (generationToken != null && generationToken != gen) return@synchronized false
                if (!tilesRoot.exists() && !tilesRoot.mkdirs()) {
                    reportCacheFailure("write", "StorageUnavailable")
                    return@synchronized false
                }
                if (tilesRoot.usableSpace - bytes.size < minFreeBytes) {
                    reportCacheFailure("write", "InsufficientSpace")
                    return@synchronized false
                }
                val rel = "tiles/$gen/${key.take(2)}/$key-${java.util.UUID.randomUUID()}.tile"
                val file = safeFile(rel) ?: return@synchronized false
                val atomic = AtomicFile(file)
                var committed = false
                try {
                    file.parentFile?.let {
                        if (!it.exists() && !it.mkdirs()) {
                            reportCacheFailure("write", "StorageUnavailable")
                            return@synchronized false
                        }
                    }
                    // A committed pending-delete marker makes a crash during atomic file creation
                    // recoverable without scanning the cache directory.
                    check(enqueueDelete(db, rel) != -1L) { "cache write marker failed" }
                    val stream = atomic.startWrite()
                    try { stream.write(bytes); atomic.finishWrite(stream) }
                    catch (error: Exception) { atomic.failWrite(stream); throw error }

                    val now = clock()
                    val old = find(db, key, gen)
                    db.beginTransaction()
                    try {
                        if (generation(db) != gen || (generationToken != null && generationToken != gen)) {
                            throw IllegalStateException("cache generation changed")
                        }
                        var projected = totalBytes(db) - (old?.size ?: 0L) + bytes.size
                        if (projected > maxBytes) {
                            db.rawQuery(
                                "SELECT url_hash,relative_path,size FROM entries WHERE generation=? AND url_hash<>? ORDER BY last_accessed ASC, saved_at ASC",
                                arrayOf(gen.toString(), key),
                            ).use { cursor ->
                                while (projected > maxBytes && cursor.moveToNext()) {
                                    val victimKey = cursor.getString(0)
                                    val victimPath = cursor.getString(1)
                                    val victimSize = cursor.getLong(2)
                                    db.delete("entries", "url_hash=? AND generation=?", arrayOf(victimKey, gen.toString()))
                                    enqueueDelete(db, victimPath)
                                    projected -= victimSize
                                }
                            }
                        }
                        if (projected > maxBytes) throw IllegalStateException("cache budget cannot be satisfied")
                        ContentValues().apply { put("value", projected) }.also {
                            db.update("metadata", it, "name='total_bytes'", null)
                        }
                        val values = ContentValues().apply {
                            put("url_hash", key); put("relative_path", rel); put("size", bytes.size.toLong())
                            put("saved_at", savedAtMillis); put("last_accessed", now); put("generation", gen)
                        }
                        check(db.insertWithOnConflict("entries", null, values, SQLiteDatabase.CONFLICT_REPLACE) != -1L) {
                            "cache index insert failed"
                        }
                        db.delete("pending_delete", "relative_path=?", arrayOf(rel))
                        old?.let { if (it.path != rel) enqueueDelete(db, it.path) }
                        db.setTransactionSuccessful()
                    } finally { db.endTransaction() }
                    committed = true
                    try { drainDeletes(db) } catch (_: Exception) { /* The committed tile remains valid. */ }
                    true
                } catch (error: Exception) {
                    reportCacheFailure("write", error.javaClass.simpleName)
                    if (!committed) try { atomic.delete() } catch (_: Exception) { }
                    false
                }
            }
        } ?: false

    /** Advances generation before clearing rows. In-flight writes carrying an earlier token are rejected. */
    suspend fun clear(): Long? = ioOrNull("clear") {
        synchronized(lock) {
            ensureOpen()
            val db = helper.writableDatabase
            val oldGeneration = generation(db)
            val next = oldGeneration + 1
            db.beginTransaction()
            try {
                db.rawQuery("SELECT relative_path FROM entries WHERE generation=?", arrayOf(oldGeneration.toString())).use { c ->
                    while (c.moveToNext()) enqueueDelete(db, c.getString(0))
                }
                db.delete("entries", "generation=?", arrayOf(oldGeneration.toString()))
                ContentValues().apply { put("value", next) }.also { db.update("metadata", it, "name='generation'", null) }
                ContentValues().apply { put("value", 0L) }.also { db.update("metadata", it, "name='total_bytes'", null) }
                db.setTransactionSuccessful()
            } finally { db.endTransaction() }
            drainDeletes(db)
            deleteTree(tilesRoot)
            next
        }
    }

    suspend fun stats(): Stats? = ioOrNull("stats") {
        synchronized(lock) {
            ensureOpen()
            val db = helper.writableDatabase
            val gen = generation(db)
            Stats(totalBytes(db), countEntries(db, gen), maxBytes, gen)
        }
    }

    override fun close() {
        synchronized(lock) {
            if (!closed) { closed = true; helper.close() }
        }
    }

    private fun ensureOpen() {
        check(!closed)
        check(root.isDirectory || root.mkdirs()) { "cache directory unavailable" }
    }
    private fun safeFile(relative: String): File? = try {
        val file = File(root, relative).canonicalFile
        if (file.toPath().startsWith(root.canonicalFile.toPath())) file else null
    } catch (_: Exception) { null }

    private suspend fun <T> ioOrNull(operation: String, block: () -> T): T? = try { withContext(Dispatchers.IO) { block() } }
    catch (cancelled: CancellationException) { throw cancelled }
    catch (error: Exception) {
        reportCacheFailure(operation, error.javaClass.simpleName)
        null
    }
    private suspend fun ioOrFalse(operation: String, block: () -> Boolean): Boolean? = try { withContext(Dispatchers.IO) { block() } }
    catch (cancelled: CancellationException) { throw cancelled }
    catch (error: Exception) {
        reportCacheFailure(operation, error.javaClass.simpleName)
        false
    }

    private fun reportCacheFailure(operation: String, failureClass: String) {
        runCatching { onCacheFailure?.invoke(operation, failureClass) }
    }

    private data class Row(val path: String, val size: Long, val savedAt: Long)
    private fun find(db: SQLiteDatabase, key: String, gen: Long): Row? = db.rawQuery(
        "SELECT relative_path,size,saved_at FROM entries WHERE url_hash=? AND generation=?", arrayOf(key, gen.toString())
    ).use { if (it.moveToFirst()) Row(it.getString(0), it.getLong(1), it.getLong(2)) else null }
    private fun generation(db: SQLiteDatabase): Long = db.rawQuery("SELECT value FROM metadata WHERE name='generation'", null)
        .use { if (it.moveToFirst()) it.getLong(0) else 1L }
    private fun totalBytes(db: SQLiteDatabase): Long = db.rawQuery("SELECT value FROM metadata WHERE name='total_bytes'", null)
        .use { if (it.moveToFirst()) it.getLong(0) else 0L }
    private fun adjustTotalBytes(db: SQLiteDatabase, delta: Long) {
        db.execSQL("UPDATE metadata SET value=MAX(0,value+?) WHERE name='total_bytes'", arrayOf(delta))
    }
    private fun countEntries(db: SQLiteDatabase, gen: Long): Long = db.rawQuery("SELECT COUNT(*) FROM entries WHERE generation=?", arrayOf(gen.toString()))
        .use { if (it.moveToFirst()) it.getLong(0) else 0L }

    private fun enqueueDelete(db: SQLiteDatabase, relative: String): Long =
        ContentValues().apply { put("relative_path", relative) }.let {
            db.insertWithOnConflict("pending_delete", null, it, SQLiteDatabase.CONFLICT_IGNORE)
        }
    private fun removeEntry(db: SQLiteDatabase, key: String, gen: Long, row: Row) {
        db.delete("entries", "url_hash=? AND generation=?", arrayOf(key, gen.toString()))
        adjustTotalBytes(db, -row.size)
        enqueueDelete(db, row.path)
    }
    private fun drainDeletes(db: SQLiteDatabase) {
        val pending = mutableListOf<Pair<Long, String>>()
        db.rawQuery("SELECT id,relative_path FROM pending_delete LIMIT 256", null).use { c ->
            while (c.moveToNext()) pending += c.getLong(0) to c.getString(1)
        }
        pending.forEach { (id, relative) ->
            val file = safeFile(relative)
            val deleted = try {
                if (file == null || !file.exists()) true else { AtomicFile(file).delete(); true }
            } catch (_: Exception) { false }
            if (deleted) try { db.delete("pending_delete", "id=?", arrayOf(id.toString())) } catch (_: Exception) { }
        }
    }
    private fun deleteTree(file: File) { if (file.exists()) file.walkBottomUp().forEach { it.delete() } }

    private class Index(context: Context, file: File) : SQLiteOpenHelper(context, file.absolutePath, null, 1) {
        init { setWriteAheadLoggingEnabled(true) }

        override fun onConfigure(db: SQLiteDatabase) {
            super.onConfigure(db)
            db.execSQL("PRAGMA synchronous=NORMAL")
        }

        override fun onCreate(db: SQLiteDatabase) {
            db.execSQL("CREATE TABLE entries(url_hash TEXT NOT NULL,generation INTEGER NOT NULL,relative_path TEXT NOT NULL,size INTEGER NOT NULL,saved_at INTEGER NOT NULL,last_accessed INTEGER NOT NULL,PRIMARY KEY(url_hash,generation))")
            db.execSQL("CREATE INDEX entries_lru ON entries(generation,last_accessed,saved_at)")
            db.execSQL("CREATE TABLE metadata(name TEXT PRIMARY KEY,value INTEGER NOT NULL)")
            db.execSQL("INSERT INTO metadata(name,value) VALUES('generation',1)")
            db.execSQL("INSERT INTO metadata(name,value) VALUES('total_bytes',0)")
            db.execSQL("CREATE TABLE pending_delete(id INTEGER PRIMARY KEY AUTOINCREMENT,relative_path TEXT NOT NULL UNIQUE)")
        }
        override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit
    }

    private companion object {
        const val CACHE_DIRECTORY = "shantu-map-browse-cache"
        const val DEFAULT_MAX_BYTES = 8L * 1024 * 1024 * 1024
        const val DEFAULT_TTL_MILLIS = 24L * 60 * 60 * 1000
        const val DEFAULT_MIN_FREE_BYTES = 256L * 1024 * 1024
        const val MAX_TILE_BYTES = 4L * 1024 * 1024
        val locks = ConcurrentHashMap<String, Any>()
        fun hash(url: String): String = sha256Hex(url.toByteArray(Charsets.UTF_8))
    }
}
