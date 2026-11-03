package com.shantu.nativeapp.map

import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeContourPriorityQueueTest {
    @Test fun `invalid ranks remain pending and never take a permit`() = runBlocking {
        val queue = NativeContourPriorityQueue<String>(capacity = 1)
        val invalidRanks = mapOf(
            "null" to null,
            "nan" to Double.NaN,
            "infinity" to Double.POSITIVE_INFINITY,
            "negative" to -0.01,
        )
        val jobs = invalidRanks.keys.map { key -> async { queue.acquire(key) } }
        withTimeout(1_000) { while (queue.pendingCount != invalidRanks.size) yield() }

        assertTrue(queue.dispatch { invalidRanks[it] }.isEmpty())
        assertEquals(invalidRanks.size, queue.pendingCount)
        assertEquals(0, queue.activeCount)
        queue.close()
        jobs.forEach { assertNull(it.await()) }
    }

    @Test fun `center is selected first and edge remains reachable`() = runBlocking {
        val queue = NativeContourPriorityQueue<String>(capacity = 1)
        val center = async { queue.acquire("center") }
        val edge = async { queue.acquire("edge") }
        withTimeout(1_000) { while (queue.pendingCount != 2) yield() }

        assertEquals(listOf("center"), queue.dispatch { if (it == "center") 0.0 else 10.0 })
        center.await()!!.close()
        assertEquals(listOf("edge"), queue.dispatch { if (it == "center") 0.0 else 10.0 })
        edge.await()!!.close()
        assertEquals(0, queue.activeCount)
        queue.close()
    }

    @Test fun `rank becoming valid on a later camera dispatch starts waiting work`() = runBlocking {
        val queue = NativeContourPriorityQueue<String>(capacity = 1)
        val job = async { queue.acquire("offscreen") }
        withTimeout(1_000) { while (queue.pendingCount != 1) yield() }

        assertTrue(queue.dispatch { null }.isEmpty())
        assertEquals(1, queue.pendingCount)
        assertEquals(listOf("offscreen"), queue.dispatch { 2.0 })
        job.await()!!.close()
        assertEquals(0, queue.registeredCount)
        queue.close()
    }

    @Test fun `stale removal and cancelled waiters do not leak permits`() = runBlocking {
        val queue = NativeContourPriorityQueue<String>(capacity = 1)
        val stale = async { queue.acquire("stale") }
        val cancelled = async { queue.acquire("cancelled") }
        withTimeout(1_000) { while (queue.pendingCount != 2) yield() }

        assertEquals(listOf("stale"), queue.removePendingNotIn(setOf("cancelled")))
        assertNull(stale.await())
        cancelled.cancelAndJoin()
        assertEquals(0, queue.registeredCount)

        val next = async { queue.acquire("next") }
        withTimeout(1_000) { while (queue.pendingCount != 1) yield() }
        assertEquals(listOf("next"), queue.dispatch { 0.0 })
        next.await()!!.close()
        assertEquals(0, queue.activeCount)
        queue.close()
    }
}
