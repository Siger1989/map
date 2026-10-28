package com.shantu.nativeapp.map

import kotlinx.coroutines.CancellationException
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RuntimeEnvironment
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[35])
class NativeCacheServiceLifecycleTest {
    @Test fun `foreground transfer pause persists state and startup repairs interrupted manifest`() {
        val context=RuntimeEnvironment.getApplication()
        assertNull("cache service must be idle at test start",NativeCacheDownloadService.activeId)
        val requestStarted=CountDownLatch(1)
        val release=CountDownLatch(1)
        val calls=AtomicInteger()
        val fake=TileHttpClient {
            calls.incrementAndGet()
            requestStarted.countDown()
            try {
                check(release.await(8,TimeUnit.SECONDS))
            } catch(_:InterruptedException) {
                Thread.currentThread().interrupt()
                throw CancellationException("test pause")
            }
            TileHttpResponse(200,null,byteArrayOf(1,2,3))
        }
        val owner=NativeTileNetworkPool.acquire(context,{},fake)
        val manager=NativeCacheManager(context,owner.network)
        val source=source()
        val tiles=(0 until 32).map { NativeCacheTile(5,it,10,0) }
        val record=manager.create("lifecycle-test",source,tiles)
        val id=record.getString("id")
        try {
            manager.cacheOnly=false
            manager.start(record,source)
            assertTrue("background service should begin a real worker request",requestStarted.await(8,TimeUnit.SECONDS))
            NativeCacheDownloadService.pause(context)
            release.countDown()
            awaitPaused(manager,id)
            assertEquals("paused",manager.packages().first { it.optString("id")==id }.optString("state"))
            assertTrue("service attempted no more than its custom-source concurrency budget",calls.get()<=16)
            manager.delete(id)
            assertTrue(manager.packages().none { it.optString("id")==id })

            val interruptedId=UUID.randomUUID().toString()
            val archive=NativeTileArchive(context.filesDir.resolve("native-offline-tiles"))
            archive.save(JSONObject().put("id",interruptedId).put("name","restart recovery")
                .put("createdAt",System.currentTimeMillis()).put("state","downloading").put("error",""))
            val restarted=NativeCacheManager(context,owner.network)
            val repaired=restarted.packages().first { it.optString("id")==interruptedId }
            assertEquals("paused",repaired.optString("state"))
            assertTrue(repaired.optString("error").contains("进程已结束"))
            restarted.delete(interruptedId)
        } finally {
            release.countDown()
            if(NativeCacheDownloadService.activeId==id)NativeCacheDownloadService.pause(context)
            awaitInactive(id)
            owner.close()
        }
        assertNull(NativeCacheDownloadService.activeId)
    }

    private fun source():NativeCacheSource {
        val layer=NativeMapRasterLayer(listOf("https://cache-lifecycle.invalid/{z}/{x}/{y}.png"),
            0,8,256,NativeTileScheme.XYZ,false,false)
        val map=NativeMapSource("cache-lifecycle-test","Test source",listOf(layer),NativeRasterDatum.WGS84,
            256,"Test attribution",listOf("t0"),"",null,"png",emptyList())
        return NativeCacheSource(map.id,map.name,map)
    }

    private fun awaitPaused(manager:NativeCacheManager,id:String) {
        val deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(8)
        while(System.nanoTime()<deadline) {
            if(NativeCacheDownloadService.activeId!=id && manager.packages().firstOrNull { it.optString("id")==id }?.optString("state")=="paused")return
            Thread.sleep(20)
        }
        error("background transfer did not persist paused state")
    }

    private fun awaitInactive(id:String) {
        val deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(8)
        while(NativeCacheDownloadService.activeId==id && System.nanoTime()<deadline)Thread.sleep(20)
    }
}
