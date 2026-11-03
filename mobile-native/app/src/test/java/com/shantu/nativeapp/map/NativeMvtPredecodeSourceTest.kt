package com.shantu.nativeapp.map

import earth.worldwind.layer.cache.RevalidatingSource
import earth.worldwind.layer.source.TileBlob
import earth.worldwind.layer.source.TileSource
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeMvtPredecodeSourceTest {
    @Test fun cacheMissDoesNotTakeDecodePermit() = runBlocking {
        val raw = RecordingSource()
        var gateCalls = 0
        val source = wrapped(raw, beforeCachedDecode = { _, _, _ -> gateCalls++ })

        assertSame(null, source.tryReadCachedTile(12, 4, 9))
        assertEquals(1, raw.cacheReads)
        assertEquals(0, gateCalls)
    }

    @Test fun knownEmptyTilesPreserveNegativeCacheWithoutOccupyingDecodeSlot() = runBlocking {
        val raw = RecordingSource(cached = TileBlob.EMPTY, fetched = TileBlob.EMPTY)
        var gateCalls = 0
        val source = wrapped(raw, beforeCachedDecode = { _, _, _ -> gateCalls++ })
        assertSame(TileBlob.EMPTY, source.tryReadCachedTile(12, 4, 9))
        assertSame(TileBlob.EMPTY, source.fetchTile(12, 4, 9))
        assertEquals(0, gateCalls)
    }

    @Test fun cachedHitWaitsForDecodeGateAndReturnsOriginalBlobAndMetadata() = runBlocking {
        val blob = TileBlob(byteArrayOf(1, 2, 3), "etag-a", "modified-a", "application/x-protobuf", 1234L)
        val raw = RecordingSource(cached = blob)
        val gateEntered = CompletableDeferred<Unit>()
        val releaseGate = CompletableDeferred<Unit>()
        val source = wrapped(raw, beforeCachedDecode = { z, x, y ->
            assertEquals(listOf(12, 4, 9), listOf(z, x, y))
            gateEntered.complete(Unit)
            releaseGate.await()
        })
        val read = async { source.tryReadCachedTile(12, 4, 9) }

        gateEntered.await()
        assertFalse(read.isCompleted)
        releaseGate.complete(Unit)
        val result = read.await()!!
        assertSame(blob, result)
        assertTrue(blob.bytes.contentEquals(byteArrayOf(1, 2, 3)))
        assertEquals("etag-a", result.etag)
        assertEquals("modified-a", result.lastModified)
        assertEquals("application/x-protobuf", result.contentType)
        assertEquals(1234L, result.cachedAt)
    }

    @Test fun cacheBlobThatBecomesObsoleteIsRejectedBeforeDecodeGate() = runBlocking {
        val raw = RecordingSource(cached = TileBlob(byteArrayOf(8)))
        var checks = 0
        var gateCalls = 0
        val source = NativeMvtPredecodeSource.wrap(raw, checkNeeded = { _, _, _ ->
            checks++
            if (checks == 2) throw CancellationException("tile left viewport after raw read")
        }, beforeCachedDecode = { _, _, _ -> gateCalls++ })

        expectCancellation { source.tryReadCachedTile(10, 2, 3) }
        assertEquals(2, checks)
        assertEquals(1, raw.cacheReads)
        assertEquals(0, gateCalls)
    }

    @Test fun rejectedPreLookupDemandDoesNotTouchRawSource() = runBlocking {
        val raw = RecordingSource(cached = TileBlob(byteArrayOf(1)))
        var gateCalls = 0
        val source = NativeMvtPredecodeSource.wrap(raw, checkNeeded = { _, _, _ ->
            throw CancellationException("tile is no longer needed")
        }, beforeCachedDecode = { _, _, _ -> gateCalls++ })

        expectCancellation { source.tryReadCachedTile(11, 5, 7) }
        assertEquals(0, raw.cacheReads)
        assertEquals(0, raw.fetches)
        assertEquals(0, gateCalls)
    }

    @Test fun networkResponsePreservesMetadataWithoutWaitingForCachedDecodeAdmission() = runBlocking {
        val blob = TileBlob(byteArrayOf(4, 5, 6), "etag-c", "modified-c", "application/x-protobuf", 987L)
        val raw = RecordingSource(fetched = blob)
        var gateCalls = 0
        val source = wrapped(raw, beforeCachedDecode = { _, _, _ ->
            gateCalls++
            throw AssertionError("network permit must not wait behind the cached decode queue")
        })
        val result = source.fetchTile(14, 15, 7, "prior-etag", "prior-date")
        assertEquals(0, gateCalls)
        assertEquals(Triple(14, 15, 7), raw.fetchArgs)
        assertEquals("prior-etag", raw.previousEtag)
        assertEquals("prior-date", raw.previousLastModified)
        assertSame(blob, result)
    }

    @Test fun networkResponseThatBecomesObsoleteNeverReachesDecodeConsumer() = runBlocking {
        val raw = RecordingSource(fetched = TileBlob(byteArrayOf(8)))
        var checks = 0
        var gateCalls = 0
        var decodeCalls = 0
        val source = NativeMvtPredecodeSource.wrap(raw, checkNeeded = { _, _, _ ->
            checks++
            if (checks == 2) throw CancellationException("viewport changed during fetch")
        }, beforeCachedDecode = { _, _, _ -> gateCalls++ })
        expectCancellation {
            source.fetchTile(12, 4, 9)
            decodeCalls++
        }
        assertEquals(1, raw.fetches)
        assertEquals(0, gateCalls)
        assertEquals(0, decodeCalls)
    }

    @Test fun receivedBytesCompeteAtDecodeGateAndStaleEdgeNeverDecodes() = runBlocking {
        val raw = RecordingSource(cached = TileBlob(byteArrayOf(4, 5)))
        val queue = NativeViewportTileQueue<Int>(capacity = 1)
        val permits = mutableMapOf<Int, NativeViewportTileQueue.Permit>()
        val decoded = mutableListOf<Int>()
        val source = NativeMvtPredecodeSource.wrap(raw, checkNeeded = { _, _, _ -> }, beforeCachedDecode = { _, x, _ ->
            permits[x] = queue.acquire(x) ?: throw CancellationException("decode no longer needed")
        })
        val edge = async {
            try { source.tryReadCachedTile(12, 2, 3); decoded += 2 }
            finally { permits.remove(2)?.close() }
        }
        val center = async {
            try { source.tryReadCachedTile(12, 1, 3); decoded += 1 }
            finally { permits.remove(1)?.close() }
        }
        yield()
        assertEquals(2, raw.cacheReads)
        assertTrue(decoded.isEmpty())
        assertEquals(listOf(1), queue.dispatch { if (it == 1) 0.0 else 10.0 })
        center.await()
        assertEquals(listOf(1), decoded)
        var invalidated = false
        queue.removePendingNotIn(setOf(1)) { invalidated = true }
        expectCancellation { edge.await() }
        assertTrue(invalidated)
        assertEquals(listOf(1), decoded)
        assertEquals(0, queue.registeredCount)
    }

    @Test fun preservesRevalidationCallbackAndUnwrapsToOriginalSource() {
        val raw = RevalidatingRecordingSource()
        val source = NativeMvtPredecodeSource.wrap(raw, checkNeeded = { _, _, _ -> }, beforeCachedDecode = { _, _, _ -> })
        assertTrue(source is RevalidatingSource)
        assertSame(raw, NativeMvtPredecodeSource.unwrap(source))

        var notified = Triple(-1, -1, -1)
        val callback: (Int, Int, Int) -> Unit = { z, x, y -> notified = Triple(z, x, y) }
        (source as RevalidatingSource).onTileRevalidated = callback
        assertSame(callback, raw.onTileRevalidated)
        raw.onTileRevalidated?.invoke(8, 44, 29)
        assertEquals(Triple(8, 44, 29), notified)

        val plain = RecordingSource()
        assertFalse(NativeMvtPredecodeSource.wrap(plain, { _, _, _ -> }, { _, _, _ -> }) is RevalidatingSource)
        assertSame(plain, NativeMvtPredecodeSource.unwrap(plain))
    }

    @Test fun closeDelegatesToTheWrappedSource() {
        val raw = RecordingSource()
        val source = NativeMvtPredecodeSource.wrap(raw, { _, _, _ -> }, { _, _, _ -> })
        source.close()
        assertEquals(1, raw.closeCalls)
    }

    private fun wrapped(
        source: TileSource,
        beforeCachedDecode: suspend (Int, Int, Int) -> Unit,
    ) = NativeMvtPredecodeSource.wrap(source, checkNeeded = { _, _, _ -> }, beforeCachedDecode = beforeCachedDecode)

    private suspend fun expectCancellation(block: suspend () -> Unit) {
        try {
            block()
            throw AssertionError("Expected CancellationException")
        } catch (_: CancellationException) {
            // Expected.
        }
    }

    private open class RecordingSource(
        private val cached: TileBlob? = null,
        private val fetched: TileBlob? = null,
    ) : TileSource {
        var cacheReads = 0
        var fetches = 0
        var closeCalls = 0
        var fetchArgs: Triple<Int, Int, Int>? = null
        var previousEtag: String? = null
        var previousLastModified: String? = null

        override suspend fun tryReadCachedTile(z: Int, x: Int, y: Int): TileBlob? {
            cacheReads++
            return cached
        }

        override suspend fun fetchTile(
            z: Int,
            x: Int,
            y: Int,
            previousEtag: String?,
            previousLastModified: String?,
        ): TileBlob? {
            fetches++
            fetchArgs = Triple(z, x, y)
            this.previousEtag = previousEtag
            this.previousLastModified = previousLastModified
            return fetched
        }

        override fun close() { closeCalls++ }
    }

    private class RevalidatingRecordingSource : RecordingSource(), RevalidatingSource {
        override var onTileRevalidated: ((z: Int, x: Int, y: Int) -> Unit)? = null
    }
}
