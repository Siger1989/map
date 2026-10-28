package com.shantu.nativeapp.map

import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RuntimeEnvironment
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.nio.file.Files
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[35])
class NativeCacheTest {
    @Test fun `map and service leases share single flight until both release`() = runBlocking {
        val context=RuntimeEnvironment.getApplication()
        val before=NativeTileNetworkPool.referenceCount()
        val calls=AtomicInteger()
        val started=CountDownLatch(1)
        val release=CountDownLatch(1)
        val fake=TileHttpClient {
            calls.incrementAndGet(); started.countDown(); check(release.await(5,TimeUnit.SECONDS)); TileHttpResponse(200,null,byteArrayOf(1,2,3))
        }
        val map=NativeTileNetworkPool.acquire(context,{},fake)
        val service=NativeTileNetworkPool.acquire(context) {}
        assertTrue(map.retainsCallbackForTest())
        assertSame(map.network,service.network)
        assertEquals(before+2,NativeTileNetworkPool.referenceCount())
        val url="https://example.invalid/shared-map-cache-tile"
        val mapRequest=async(Dispatchers.IO) { map.network.fetch(url) }
        assertTrue(started.await(5,TimeUnit.SECONDS))
        val serviceRequest=async(Dispatchers.IO) { service.network.fetch(url,bulkDownload=true) }
        Thread.sleep(40) // Let the service join the in-flight map request before the fake response opens.
        release.countDown()
        assertArrayEquals(byteArrayOf(1,2,3),mapRequest.await())
        assertArrayEquals(byteArrayOf(1,2,3),serviceRequest.await())
        assertEquals("shared loader de-duplicates map and background-service requests",1,calls.get())
        map.close()
        val dualMap=NativeTileNetworkPool.acquire(context) {}
        assertSame(service.network,dualMap.network)
        service.close()
        assertEquals(before+1,NativeTileNetworkPool.referenceCount())
        dualMap.close()
        assertEquals(before,NativeTileNetworkPool.referenceCount())
        assertTrue(!map.retainsCallbackForTest())
        assertEquals("last owner release drops the process-wide bitmap memory cache",0,map.network.memorySizeBytesForTest())
    }
    @Test fun `request and storage budgets are independently enforced`() {
        assertEquals(250_000,NativeCachePlan.MAX_REQUESTS)
        assertEquals(8L*1024*1024*1024,NativeCachePlan.MAX_ARCHIVE_BYTES)
        assertEquals(250_000L*20*1024,NativeCachePlan.estimateBytes(250_000))
        assertThrows(IllegalArgumentException::class.java) { NativeCachePlan.estimateBytes(250_000,100*1024) }
        assertThrows(IllegalArgumentException::class.java) { NativeCachePlan.estimateBytes(250_001) }
    }
    @Test fun `batch corridors deduplicate overlaps and never join disconnected tracks`() {
        val source=NativeCacheSource(NativeMapController.SOURCE_IMAGERY,"test",null,"test")
        val west=listOf(100.0 to 30.0,100.001 to 30.001)
        val east=listOf(110.0 to 30.0,110.001 to 30.001)
        val expected=(source.tiles(west,12,12,.05)+source.tiles(east,12,12,.05)).toSet()
        val result=source.tilesForSegments(listOf(west,east,west),12,12,.05)
        assertEquals(expected,result.toSet())
        assertEquals(expected.size,result.size)
        assertTrue(result.none {it.x in 3200..3250})
    }
    @Test fun `date line corridor stays near both edges rather than crossing globe`() {
        val tiles=NativeCachePlan.corridor(listOf(179.99 to 30.0,-179.99 to 30.0),12,12,.1)
        assertTrue(tiles.isNotEmpty())
        assertTrue(tiles.all { it.x<5 || it.x>4090 })
        assertEquals(tiles,NativeCachePlan.decode(NativeCachePlan.encode(tiles)))
    }
    @Test fun `large estimate refuses instead of silently losing route tiles`() {
        assertThrows(IllegalArgumentException::class.java) {
            NativeCachePlan.corridor(listOf(100.0 to 30.0,110.0 to 35.0),18,20,25.0)
        }
    }
    @Test fun `offline tiles survive cache expiry and only selected package is deleted`() = runBlocking {
        val root=Files.createTempDirectory("offline-package").toFile()
        val archive=NativeTileArchive(root.resolve("packages"))
        val liveMapArchive=NativeTileArchive(root.resolve("packages"))
        val a=UUID.randomUUID().toString(); val b=UUID.randomUUID().toString()
        val url="https://example.invalid/tile?key=private"
        val bytes=byteArrayOf(1,2,3)
        assertNull(liveMapArchive.read(url)) // Hold an initially empty index just like the map-side loader.
        archive.write(a,url,bytes); archive.write(b,url,bytes)
        assertArrayEquals(bytes,liveMapArchive.read(url)) // Service writes invalidate other archive instances' indexes.
        archive.save(JSONObject().put("id",a).put("name","A").put("state","paused"))
        archive.save(JSONObject().put("id",b).put("name","B").put("state","complete"))
        root.walkTopDown().filter { it.extension=="tile" }.forEach { it.setLastModified(1) }
        val calls=AtomicInteger()
        val network=BoundedTileNetwork(root.resolve("browse"),{},TileHttpClient {
            calls.incrementAndGet(); TileHttpResponse(200,null,bytes)
        },isValidImage={ it.contentEquals(bytes) })
        network.archive=archive; network.cacheOnly=true
        assertArrayEquals(bytes,network.fetch(url))
        assertNull(network.fetch("https://example.invalid/missing"))
        assertEquals(0,calls.get())
        archive.delete(a)
        assertArrayEquals(bytes,archive.read(url))
        archive.delete(b)
        assertNull(archive.read(url))
        assertThrows(IllegalArgumentException::class.java) { archive.delete("../outside") }
        network.close()
    }

    @Test fun `separate archive instances enforce one atomic global capacity limit`() {
        val root=Files.createTempDirectory("offline-package-capacity").toFile().resolve("packages")
        val first=NativeTileArchive(root,10)
        val second=NativeTileArchive(root,10)
        val ids=listOf(UUID.randomUUID().toString(),UUID.randomUUID().toString())
        val gate=CountDownLatch(1)
        val done=CountDownLatch(2)
        val successes=AtomicInteger()
        val workers=ids.mapIndexed { index,id -> Thread {
            gate.await()
            try {
                (if(index==0) first else second).write(id,"https://example.invalid/$index",ByteArray(6) { index.toByte() })
                successes.incrementAndGet()
            } catch(_:IllegalArgumentException) {
                // The other archive instance committed first and consumed the shared budget.
            } finally { done.countDown() }
        }.apply { start() } }
        gate.countDown()
        assertTrue(done.await(5,TimeUnit.SECONDS))
        workers.forEach { it.join() }
        assertEquals("only one 6-byte tile fits in the shared 10-byte archive",1,successes.get())
        assertEquals(6L,root.walkTopDown().filter { it.isFile && it.extension=="tile" }.sumOf { it.length() })
    }
}
