package com.shantu.nativeapp.map

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertSame
import org.junit.Assert.fail
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class NativeRenderResourceCachePoolTest {
    @Test
    fun concurrentWindowsShareOneGenerationUntilTheLastLeaseCloses() {
        val pool = NativeSharedLeasePool<Int, Any>()
        val created = AtomicInteger()
        val first = pool.acquire(240) { Any().also { created.incrementAndGet() } }
        val second = pool.acquire(240) { Any().also { created.incrementAndGet() } }

        assertSame(first.resource, second.resource)
        assertEquals(1, created.get())
        first.close()
        val third = pool.acquire(240) { Any().also { created.incrementAndGet() } }
        assertSame(second.resource, third.resource)

        second.close()
        third.close()
        third.close() // A controller teardown may be reached through more than one path.
        val nextGeneration = pool.acquire(240) { Any().also { created.incrementAndGet() } }
        assertNotSame(first.resource, nextGeneration.resource)
        assertEquals(2, created.get())
        nextGeneration.close()
    }

    @Test
    fun capacityCannotChangeUntilAllWindowsReleaseTheSharedBudget() {
        val pool = NativeSharedLeasePool<Int, Any>()
        val lease = pool.acquire(240) { Any() }
        try {
            pool.acquire(256) { fail("A second cache generation must not start while one is leased") }
            fail("A process cache cannot have two competing capacities")
        } catch (_: IllegalArgumentException) {
            // Expected. The original lease remains valid and is released below.
        }
        lease.close()
        pool.acquire(256) { Any() }.close()
    }

    @Test
    fun simultaneousAcquiresAreReferenceCountedAsOneInstance() {
        val pool = NativeSharedLeasePool<Int, Any>()
        val created = AtomicInteger()
        val ready = CountDownLatch(8)
        val start = CountDownLatch(1)
        val executor = Executors.newFixedThreadPool(8)
        try {
            val leases = (0 until 8).map {
                executor.submit<NativeSharedLeasePool.Lease<Any>> {
                    ready.countDown()
                    check(start.await(5, TimeUnit.SECONDS))
                    pool.acquire(240) { Any().also { created.incrementAndGet() } }
                }
            }
            check(ready.await(5, TimeUnit.SECONDS))
            start.countDown()
            val acquired = leases.map { it.get(5, TimeUnit.SECONDS) }
            assertEquals(1, created.get())
            acquired.forEach { assertSame(acquired.first().resource, it.resource) }
            acquired.forEach { it.close() }
        } finally {
            start.countDown()
            executor.shutdownNow()
        }
    }
}
