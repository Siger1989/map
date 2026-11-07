package com.shantu.nativeapp.map

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import earth.worldwind.geom.Sector
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.fail
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class NativeContourGeometryStoreTest {
    @Test fun `sample digest covers all values and key includes tile row and contour interval`() {
        val base = doubleArrayOf(0.0, 10.0, 20.0, 30.0)
        val key = NativeContourGeometryKey.fromSamples(9, 17, 23, 50, base)
        assertEquals(key, NativeContourGeometryKey.fromSamples(9, 17, 23, 50, base.copyOf()))
        assertNotEquals(key, NativeContourGeometryKey.fromSamples(10, 17, 23, 50, base))
        assertNotEquals(key, NativeContourGeometryKey.fromSamples(9, 18, 23, 50, base))
        assertNotEquals(key, NativeContourGeometryKey.fromSamples(9, 17, 24, 50, base))
        assertNotEquals(key, NativeContourGeometryKey.fromSamples(9, 17, 23, 100, base))
        assertNotEquals(key, NativeContourGeometryKey.fromSamples(9, 17, 23, 50, doubleArrayOf(0.0, 10.0, 20.0, 31.0)))
        // Equal sums are not enough: a complete ordered sample digest is required.
        assertNotEquals(key, NativeContourGeometryKey.fromSamples(9, 17, 23, 50, doubleArrayOf(0.0, 10.0, 21.0, 29.0)))
    }

    @Test fun `active panes share one value until the last lease closes and store retains nothing afterward`() {
        val store = NativeContourGeometryStore<String, Any>()
        val value = Any()
        val firstBuilds = AtomicInteger()
        val first = store.acquireOrCreate("full-sample-key") { firstBuilds.incrementAndGet(); value }
        val second = store.acquireOrCreate("full-sample-key") { error("active geometry should be reused") }

        assertSame(first.value, second.value)
        assertEquals(1, firstBuilds.get())
        assertEquals(NativeContourGeometryStore.Snapshot(1, 2), store.snapshot())
        assertFalse(first.release())
        assertEquals(NativeContourGeometryStore.Snapshot(1, 1), store.snapshot())
        try {
            first.value
            fail("released pane lease must drop its geometry reference")
        } catch (_: IllegalStateException) { }
        assertSame(value, second.value)
        assertTrue(second.release())
        assertEquals(NativeContourGeometryStore.Snapshot(0, 0), store.snapshot())

        val replacement = Any()
        val third = store.acquireOrCreate("full-sample-key") { replacement }
        assertSame(replacement, third.value)
        assertTrue(third.release())
    }

    @Test fun `pane wrappers share geometry but keep independent idempotent admission permits`() {
        val store = NativeContourGeometryStore<String, NativeContourSharedGeometry>()
        val geometry = NativeContourSharedGeometry(emptyList(), null, 0, 0, Sector(), 256)
        var firstAdmissionRelease = 0
        var secondAdmissionRelease = 0
        val first = NativeContourTileContent(store.acquireOrCreate("same-exact-samples") { geometry }) {
            firstAdmissionRelease++
        }
        val second = NativeContourTileContent(store.acquireOrCreate("same-exact-samples") { error("geometry should be shared") }) {
            secondAdmissionRelease++
        }
        assertSame(first.geometry, second.geometry)

        first.admitted()
        first.admitted()
        assertEquals(1, firstAdmissionRelease)
        assertEquals(0, secondAdmissionRelease)
        first.discard(null)
        assertEquals(NativeContourGeometryStore.Snapshot(1, 1), store.snapshot())
        assertEquals(256, first.byteWeight) // SDK byte admission reads only the cached scalar after close.
        try {
            first.size
            fail("discarded wrapper must not retain its renderable list")
        } catch (_: IllegalStateException) { }
        second.discard(null)
        second.discard(null)
        assertEquals(1, secondAdmissionRelease)
        assertEquals(NativeContourGeometryStore.Snapshot(0, 0), store.snapshot())
    }

    @Test fun `failed geometry assembly leaves no key or retained value`() {
        val store = NativeContourGeometryStore<String, Any>()
        try {
            store.acquireOrCreate("cancelled-build") { throw kotlinx.coroutines.CancellationException("cancelled") }
        } catch (_: kotlinx.coroutines.CancellationException) {
            // Production cancellation must propagate without installing a partially-built cache entry.
        }
        assertEquals(NativeContourGeometryStore.Snapshot(0, 0), store.snapshot())
        val value = Any()
        val lease = store.acquireOrCreate("cancelled-build") { value }
        assertSame(value, lease.value)
        assertTrue(lease.release())
    }

    @Test fun `concurrent panes can release their leases without evicting another live owner`() = runBlocking {
        val store = NativeContourGeometryStore<Int, Any>()
        val value = Any()
        val first = store.acquireOrCreate(1) { value }
        val ready = CountDownLatch(2)
        val release = CountDownLatch(1)
        val workers = (0 until 2).map {
            async(Dispatchers.Default) {
                val lease = store.acquireOrCreate(1) { error("existing process entry expected") }
                ready.countDown()
                check(release.await(2, TimeUnit.SECONDS))
                lease.close()
            }
        }
        assertTrue(ready.await(2, TimeUnit.SECONDS))
        assertEquals(NativeContourGeometryStore.Snapshot(1, 3), store.snapshot())
        assertFalse(first.release())
        release.countDown()
        workers.forEach { it.await() }
        assertEquals(NativeContourGeometryStore.Snapshot(0, 0), store.snapshot())
    }

    @Test fun `cancellation closes a pane lease and removes the geometry entry`() = runBlocking {
        val store = NativeContourGeometryStore<Int, Any>()
        val lease = store.acquireOrCreate(42) { Any() }
        val entered = CompletableDeferred<Unit>()
        val worker = async(Dispatchers.Default) {
            withContext(Dispatchers.Default) {
                try { entered.complete(Unit); awaitCancellation() } finally { lease.close() }
            }
        }
        // Cancel only after the lease-owning block is entered. Cancelling an unstarted
        // coroutine never executes its body/finally and does not exercise this contract.
        entered.await()
        assertEquals(NativeContourGeometryStore.Snapshot(1, 1), store.snapshot())
        worker.cancelAndJoin()
        assertEquals(NativeContourGeometryStore.Snapshot(0, 0), store.snapshot())
    }
}
