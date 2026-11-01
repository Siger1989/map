package com.shantu.nativeapp.map

import earth.worldwind.layer.source.TileBlob
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger

class NativeSharedRawTileStoreTest {
    private data class Key(val source: String, val offlinePackage: String?, val z: Int, val x: Int, val y: Int)

    @Test fun `concurrent same identity tile requests share one immutable raw response`() = runBlocking {
        val entered = CompletableDeferred<Unit>()
        val gate = CompletableDeferred<TileBlob?>()
        val calls = AtomicInteger()
        val store = NativeSharedRawTileStore<Key>(loader = {
            calls.incrementAndGet()
            entered.complete(Unit)
            gate.await()
        })
        val a = store.acquire(); val b = store.acquire()
        val key = Key("openfreemap", null, 8, 37, 91)
        val first = async { a.fetch(key) }
        entered.await()
        val second = async { b.fetch(key) }
        withTimeout(2_000) { while (store.snapshot().deduplicated == 0L) kotlinx.coroutines.yield() }
        val payload = TileBlob(byteArrayOf(2, 4, 8), contentType = "application/vnd.mapbox-vector-tile")
        gate.complete(payload)
        assertSame(payload, first.await())
        assertSame(payload, second.await())
        assertEquals(1, calls.get())
        assertEquals(1, store.snapshot().rawTiles)
        assertEquals(3L, store.snapshot().rawBytes)
        a.close(); b.close()
    }

    @Test fun `closing one owner cannot cancel a fetch still awaited by another owner`() = runBlocking {
        val entered = CompletableDeferred<Unit>()
        val gate = CompletableDeferred<TileBlob?>()
        val store = NativeSharedRawTileStore<Key>(loader = { entered.complete(Unit); gate.await() })
        val a = store.acquire(); val b = store.acquire()
        val key = Key("openfreemap", null, 7, 12, 35)
        val first = async { a.fetch(key) }
        entered.await()
        val second = async { b.fetch(key) }
        withTimeout(2_000) { while (store.snapshot().deduplicated == 0L) kotlinx.coroutines.yield() }
        a.close()
        first.cancelAndJoin()
        assertEquals(1, store.snapshot().inFlight)
        val result = TileBlob(byteArrayOf(1, 3, 5))
        gate.complete(result)
        assertSame(result, second.await())
        assertEquals(0, store.snapshot().inFlight)
        assertEquals(1, store.snapshot().owners)
        b.close()
    }

    @Test fun `production raw key separates offline package and source identities at equal XYZ`() = runBlocking {
        val calls = AtomicInteger()
        val store = NativeSharedRawTileStore<NativeOpenFreeMapRawTileKey>(loader = { key ->
            calls.incrementAndGet()
            TileBlob(byteArrayOf(key.identity.provider?.length?.toByte() ?: 0, key.identity.packageId?.length?.toByte() ?: 0))
        })
        val owner = store.acquire()
        val xyz = Triple(9, 80, 190)
        fun request(state: NativeOfflineDisplayPolicyState) = NativeOpenFreeMapRawTileKey(
            NativeOpenFreeMapRawSourceIdentity.from(state), xyz.first, xyz.second, xyz.third,
        )
        val online = request(NativeOfflineDisplayPolicyState(enabled = false))
        val onlineWithDormantOfflineSelection = request(NativeOfflineDisplayPolicyState(
            enabled = false, packageId = "stale-package", sourceId = "stale-source", provider = "openfreemap",
            vectorTileTemplates = listOf("https://tiles.openfreemap.org/planet/stale/{z}/{x}/{y}.pbf"),
        ))
        val packageA = request(NativeOfflineDisplayPolicyState(
            enabled = true, packageId = "package-a", sourceId = "openfreemap", provider = "openfreemap",
            vectorTileTemplates = listOf("https://tiles.openfreemap.org/planet/latest/{z}/{x}/{y}.pbf"),
        ))
        val packageB = request(NativeOfflineDisplayPolicyState(
            enabled = true, packageId = "package-b", sourceId = "imported-source-b", provider = "imported",
            vectorTileTemplates = listOf("https://tiles.openfreemap.org/planet/stable/{z}/{x}/{y}.pbf"),
        ))
        val a = owner.fetch(online)
        val b = owner.fetch(packageA)
        val c = owner.fetch(packageB)
        assertEquals(3, calls.get())
        assertEquals(online, onlineWithDormantOfflineSelection)
        assertFalse(online == packageA)
        assertFalse(packageA == packageB)
        assertFalse(a!!.bytes.contentEquals(b!!.bytes))
        assertFalse(b.bytes.contentEquals(c!!.bytes))
        assertEquals(3, store.snapshot().rawTiles)
        owner.close()
    }

    @Test fun `last lease closes the old generation and late completion cannot repopulate it`() = runBlocking {
        val entered = CompletableDeferred<Unit>()
        val allowLateReturn = CompletableDeferred<TileBlob?>()
        val old = NativeSharedRawTileStore<Key>(loader = {
            entered.complete(Unit)
            kotlinx.coroutines.withContext(kotlinx.coroutines.NonCancellable) { allowLateReturn.await() }
        })
        val lease = old.acquire()
        val request = async { lease.fetch(Key("source", null, 4, 3, 2)) }
        entered.await()
        lease.close()
        assertEquals(0, old.snapshot().owners)
        assertEquals(0, old.snapshot().rawTiles)
        val next = NativeSharedRawTileStore<Key>(loader = { TileBlob(byteArrayOf(9)) })
        val nextLease = next.acquire()
        assertEquals(listOf(9.toByte()), nextLease.fetch(Key("source", null, 4, 3, 2))!!.bytes.toList())
        allowLateReturn.complete(TileBlob(byteArrayOf(7)))
        request.join()
        assertEquals(0, old.snapshot().rawTiles)
        assertEquals(listOf(9.toByte()), nextLease.fetch(Key("source", null, 4, 3, 2))!!.bytes.toList())
        nextLease.close()
    }

    @Test fun `observer registrations are removed per lease and close is idempotent`() = runBlocking {
        val gate = CompletableDeferred<Unit>()
        val store = NativeSharedRawTileStore<Key>(loader = { gate.await(); TileBlob(byteArrayOf(1)) })
        val a = store.acquire(); val b = store.acquire()
        val callsA = AtomicInteger(); val callsB = AtomicInteger()
        a.observe { _, _ -> callsA.incrementAndGet() }
        b.observe { _, _ -> callsB.incrementAndGet() }
        val pending = async { b.fetch(Key("source", null, 2, 1, 1)) }
        withTimeout(2_000) { while (store.snapshot().inFlight == 0) kotlinx.coroutines.yield() }
        a.close(); a.close()
        gate.complete(Unit)
        pending.await()
        assertEquals(0, callsA.get())
        assertEquals(1, callsB.get())
        assertEquals(1, store.snapshot().owners)
        b.close()
        assertEquals(0, store.snapshot().owners)
        assertEquals(0, store.snapshot().rawBytes)
    }

    @Test fun `cache enforces tile byte tile count and total byte bounds`() = runBlocking {
        assertEquals(32 * 1024 * 1024, NativeSharedRawTileStore.DEFAULT_MAX_BYTES)
        assertEquals(256, NativeSharedRawTileStore.DEFAULT_MAX_TILES)
        assertEquals(4 * 1024 * 1024, NativeSharedRawTileStore.DEFAULT_MAX_TILE_BYTES)
        val store = NativeSharedRawTileStore<Int>(maxBytes = 6, maxTiles = 2, maxTileBytes = 4, loader = { key ->
            when (key) {
                1 -> TileBlob(byteArrayOf(1, 1, 1))
                2 -> TileBlob(byteArrayOf(2, 2, 2))
                3 -> TileBlob(byteArrayOf(3, 3, 3))
                else -> TileBlob(ByteArray(5))
            }
        })
        val lease = store.acquire()
        lease.fetch(1); lease.fetch(2)
        assertEquals(6L, store.snapshot().rawBytes)
        lease.cached(1) // Make key 2 the least-recently-used entry.
        lease.fetch(3)
        assertEquals(2, store.snapshot().rawTiles)
        assertEquals(6L, store.snapshot().rawBytes)
        assertNull(lease.cached(2))
        assertNull(lease.fetch(4)) // Over-4MiB-equivalent payload is never returned or cached.
        assertEquals(2, store.snapshot().rawTiles)
        assertTrue(store.snapshot().evictions >= 1L)
        lease.close()
    }
}
