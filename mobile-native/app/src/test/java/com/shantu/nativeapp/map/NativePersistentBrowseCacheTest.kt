package com.shantu.nativeapp.map

import kotlinx.coroutines.runBlocking
import android.database.sqlite.SQLiteDatabase
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.SQLiteMode
import java.io.File
import java.util.concurrent.atomic.AtomicReference

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[35])
@SQLiteMode(SQLiteMode.Mode.NATIVE)
class NativePersistentBrowseCacheTest {
    private val context get() = RuntimeEnvironment.getApplication()
    private val root get() = File(context.filesDir, "shantu-map-browse-cache")

    private fun reset() {
        val diagnostic=AtomicReference<String?>()
        NativePersistentBrowseCache(context,onCacheFailure={ operation, failureClass -> diagnostic.set("$operation:$failureClass") }).let { cache ->
            try {
                check(runBlocking { cache.clear() } != null) {
                    "persistent cache clear failed; diagnostic=${diagnostic.get()}; dbPathLength=${File(root, "index.sqlite").absolutePath.length}"
                }
            }
            finally { cache.close() }
        }
    }

    @Test fun `cache survives close and reopen with stale freshness preserved`() = runBlocking {
        reset()
        var now = 10_000L
        val cache = NativePersistentBrowseCache(context, maxBytes=1024, ttlMillis=100, clock={ now })
        val url="https://tiles.example.test/0/1/2?tk=must-not-be-stored"
        val bytes=byteArrayOf(1,2,3)
        assertTrue(cache.write(url,bytes,savedAtMillis=9_950))
        assertTrue(cache.read(url)!!.isFresh)
        cache.close()

        now=10_100
        val reopened=NativePersistentBrowseCache(context,maxBytes=1024,ttlMillis=100,clock={ now })
        val stale=reopened.read(url)!!
        assertArrayEquals(bytes,stale.bytes)
        assertFalse(stale.isFresh)
        assertEquals(9_950L,stale.savedAtMillis)
        assertNull(reopened.read(url,allowStale=false))
        assertEquals("reading stale bytes does not rewrite freshness",9_950L,reopened.read(url)!!.savedAtMillis)
        reopened.close()
    }

    @Test fun `LRU access controls eviction while stored timestamp remains unchanged`() = runBlocking {
        reset()
        var now=1_000L
        val cache=NativePersistentBrowseCache(context,maxBytes=6,ttlMillis=50,clock={ now })
        assertTrue(cache.write("https://tiles.test/a",byteArrayOf(1,1,1),savedAtMillis=900))
        now++
        assertTrue(cache.write("https://tiles.test/b",byteArrayOf(2,2,2),savedAtMillis=901))
        now++
        assertEquals(900L,cache.read("https://tiles.test/a")!!.savedAtMillis)
        now++
        assertTrue(cache.write("https://tiles.test/c",byteArrayOf(3,3,3),savedAtMillis=903))
        assertNotNull(cache.read("https://tiles.test/a"))
        assertNull(cache.read("https://tiles.test/b"))
        assertNotNull(cache.read("https://tiles.test/c"))
        assertEquals(6L,cache.stats()!!.bytes)
        cache.close()
    }

    @Test fun `clear advances generation and rejects an earlier in-flight response`() = runBlocking {
        reset()
        val cache=NativePersistentBrowseCache(context,maxBytes=1024)
        val outside=File(context.filesDir,"browse-cache-clear-sentinel").apply { writeText("keep") }
        val token=cache.generationToken()!!
        assertTrue(cache.write("https://tiles.test/before",byteArrayOf(1),generationToken=token))
        val next=cache.clear()!!
        assertTrue(next>token)
        assertFalse(cache.write("https://tiles.test/late",byteArrayOf(2),generationToken=token))
        assertTrue(cache.write("https://tiles.test/after",byteArrayOf(3),generationToken=next))
        assertNull(cache.read("https://tiles.test/before"))
        assertNotNull(cache.read("https://tiles.test/after"))
        assertTrue("clear is scoped to its own cache directory",outside.exists())
        assertFalse(File(root,"tiles/$token").exists())
        outside.delete()
        cache.close()
    }

    @Test fun `rejected writes preserve entries`() = runBlocking {
        reset()
        val failure=AtomicReference<String?>()
        val cache=NativePersistentBrowseCache(context,maxBytes=3,onCacheFailure={ operation, failureClass -> failure.set("$operation:$failureClass") })
        assertTrue("sanitized storage diagnostic=${failure.get()}",cache.write("https://tiles.test/good",byteArrayOf(4,5,6)))
        assertFalse(cache.write("https://tiles.test/large",byteArrayOf(1,2,3,4)))
        assertFalse(cache.write("https://tiles.test/empty",byteArrayOf()))
        assertArrayEquals(byteArrayOf(4,5,6),cache.read("https://tiles.test/good")!!.bytes)
        assertEquals(1L,cache.stats()!!.entries)
        cache.close()

        val lowSpace=NativePersistentBrowseCache(context,maxBytes=3,minFreeBytes=Long.MAX_VALUE)
        assertFalse("insufficient free-space reserve skips only the cache write",lowSpace.write("https://tiles.test/skipped",byteArrayOf(7)))
        assertEquals("a second instance reuses the shared persistent index",1L,lowSpace.stats()!!.entries)
        assertArrayEquals(byteArrayOf(4,5,6),lowSpace.read("https://tiles.test/good")!!.bytes)
        lowSpace.close()
    }

    @Test fun `oversized corrupt tile is rejected before reading and removed from the index`() = runBlocking {
        reset()
        val cache=NativePersistentBrowseCache(context,maxBytes=8L*1024*1024)
        val url="https://tiles.test/corrupt"
        assertTrue(cache.write(url,byteArrayOf(1,2,3)))
        val db=SQLiteDatabase.openDatabase(File(root,"index.sqlite").absolutePath,null,SQLiteDatabase.OPEN_READWRITE)
        val tilePath=db.rawQuery("SELECT relative_path FROM entries LIMIT 1",null).use { c ->
            assertTrue(c.moveToFirst()); c.getString(0)
        }
        db.close()
        val tile=File(root,tilePath)
        tile.writeBytes(ByteArray(4*1024*1024+1))

        assertNull(cache.read(url))
        assertEquals(0L,cache.stats()!!.entries)
        assertFalse("AtomicFile base and sidecars are cleaned",tile.exists())
        cache.close()
    }

    @Test fun `index stores only hashed URL identity and opaque tile path`() = runBlocking {
        reset()
        val cache=NativePersistentBrowseCache(context)
        val secretUrl="https://tiles.example.test/12/345/678?tk=FAKE_PRIVATE_KEY_DO_NOT_STORE"
        assertTrue(cache.write(secretUrl,byteArrayOf(1,2,3)))
        val db=SQLiteDatabase.openDatabase(File(root,"index.sqlite").absolutePath,null,SQLiteDatabase.OPEN_READONLY)
        val stored=db.rawQuery("SELECT url_hash,relative_path FROM entries LIMIT 1",null).use { c ->
            assertTrue(c.moveToFirst()); c.getString(0) to c.getString(1)
        }
        db.close()
        assertTrue(stored.first.matches(Regex("[0-9a-f]{64}")))
        assertFalse(stored.first.contains("FAKE_PRIVATE_KEY_DO_NOT_STORE"))
        assertFalse(stored.second.contains("FAKE_PRIVATE_KEY_DO_NOT_STORE"))
        assertFalse(stored.second.contains("tiles.example.test"))
        cache.close()
    }

    @Test fun `storage root that is a file degrades to cache miss outcomes`() = runBlocking {
        reset()
        root.deleteRecursively()
        assertTrue(root.createNewFile())
        root.writeText("block directory creation")
        val cache=NativePersistentBrowseCache(context)
        try {
            assertFalse(cache.write("https://tiles.test/unwritable",byteArrayOf(1)))
            assertNull(cache.read("https://tiles.test/unwritable"))
            assertNull(cache.stats())
        } finally {
            cache.close()
            root.delete()
        }
    }
}
