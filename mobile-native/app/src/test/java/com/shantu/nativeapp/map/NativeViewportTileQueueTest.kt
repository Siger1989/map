package com.shantu.nativeapp.map

import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import kotlin.coroutines.CoroutineContext
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeViewportTileQueueTest {
    @Test fun admissionStaysBoundedUntilCallerClosesPermit() = runBlocking {
        val queue = NativeViewportTileQueue<String>(capacity = 1, maximumRequests = 2)
        val first = async { queue.acquire("center") }
        val second = async { queue.acquire("edge") }
        yield()
        assertEquals(2, queue.registeredCount)
        assertNull(queue.acquire("overflow"))
        assertEquals(listOf("center"), queue.dispatch { 0.0 })
        val permit = first.await()!!
        assertEquals(1, queue.activeCount)
        assertEquals(1, queue.pendingCount)
        assertTrue(queue.dispatch { 1.0 }.isEmpty())

        permit.close()
        permit.close()
        assertEquals(listOf("edge"), queue.dispatch { 1.0 })
        val edgePermit = second.await()!!
        edgePermit.close()
        assertEquals(0, queue.registeredCount)
        queue.close()
    }

    @Test fun dispatchIsCenterFirstKeepsFifoTiesAndEventuallyAdmitsVisibleEdge() = runBlocking {
        val queue = NativeViewportTileQueue<String>(capacity = 2)
        val requests = listOf("edge", "center-b", "center-a").map { async { queue.acquire(it) } }
        yield()
        assertEquals(listOf("center-b", "center-a"), queue.dispatch { if (it == "edge") 10.0 else 1.0 })
        val permits = requests.drop(1).map { it.await() }
        assertEquals(1, queue.pendingCount)
        permits.filterNotNull().forEach(AutoCloseable::close)
        assertEquals(listOf("edge"), queue.dispatch { if (it == "edge") 10.0 else null })
        requests.first().await()!!.close()
        assertEquals(0, queue.registeredCount)
    }

    @Test fun invalidRanksStayWaitingAndCanRecover() = runBlocking {
        val queue = NativeViewportTileQueue<String>(capacity = 1)
        val request = async { queue.acquire("tile") }
        yield()
        for (rank in listOf<Double?>(null, Double.NaN, Double.POSITIVE_INFINITY, -1.0)) {
            assertTrue(queue.dispatch { rank }.isEmpty())
            assertEquals(1, queue.pendingCount)
            assertFalse(request.isCompleted)
        }
        assertEquals(listOf("tile"), queue.dispatch { 0.0 })
        request.await()!!.close()
        assertEquals(0, queue.registeredCount)
    }

    @Test fun zoomOutPrunesOnlyWaitingAndInvalidatesBeforeWaiterReturns() = runBlocking {
        val queue = NativeViewportTileQueue<String>(capacity = 1)
        val active = async { queue.acquire("resident") }
        val stale = async { queue.acquire("stale") }
        yield()
        queue.dispatch { if (it == "resident") 0.0 else 1.0 }
        val residentPermit = active.await()!!
        val invalidationObserved = java.util.concurrent.atomic.AtomicBoolean(false)
        val removed = queue.removePendingNotIn(setOf("resident")) {
            assertEquals("stale", it)
            invalidationObserved.set(true)
        }
        assertEquals(listOf("stale"), removed)
        assertNull(stale.await())
        assertTrue("invalidation must precede waiter completion", invalidationObserved.get())
        assertEquals(1, queue.activeCount)
        assertEquals(1, queue.registeredCount)
        residentPermit.close()
        assertEquals(0, queue.registeredCount)
    }

    @Test fun cancellationDuringRankDoesNotGrantRemovedRequest() = runBlocking {
        val queue = NativeViewportTileQueue<String>(capacity = 1)
        val request = async { queue.acquire("cancel-me") }
        yield()
        val rankEntered = java.util.concurrent.CountDownLatch(1)
        val releaseRank = java.util.concurrent.CountDownLatch(1)
        val dispatch = async(Dispatchers.Default) {
            queue.dispatch {
                rankEntered.countDown()
                releaseRank.await()
                0.0
            }
        }
        check(rankEntered.await(5, java.util.concurrent.TimeUnit.SECONDS))
        request.cancelAndJoin()
        releaseRank.countDown()
        assertTrue(dispatch.await().isEmpty())
        assertEquals(0, queue.registeredCount)
    }

    @Test fun cancellationAfterGrantButBeforeResumptionReleasesPermit() {
        val queue = NativeViewportTileQueue<String>(capacity = 1)
        val dispatcher = QueuedDispatcher()
        val job = Job()
        var acquired: NativeViewportTileQueue.Permit? = null
        CoroutineScope(job + dispatcher).launch { acquired = queue.acquire("tile") }
        dispatcher.runNext() // Starts acquire and suspends after registering.
        assertEquals(1, queue.pendingCount)

        assertEquals(listOf("tile"), queue.dispatch { 0.0 })
        assertEquals(1, queue.activeCount)
        job.cancel() // Cancellation wins before the queued continuation resumes.
        dispatcher.runAll()

        assertNull(acquired)
        assertEquals(0, queue.registeredCount)
    }

    @Test fun cancellationAfterAcquireDoesNotReleaseCapacityBeforeCpuWorkExits() = runBlocking {
        val queue = NativeViewportTileQueue<String>(capacity = 1)
        val entered = java.util.concurrent.CountDownLatch(1)
        val exit = java.util.concurrent.CountDownLatch(1)
        val working = async(Dispatchers.Default) {
            val permit = queue.acquire("working")!!
            try {
                entered.countDown()
                check(exit.await(5, java.util.concurrent.TimeUnit.SECONDS))
            } finally { permit.close() }
        }
        kotlinx.coroutines.withTimeout(5_000) { while (queue.pendingCount == 0) yield() }
        queue.dispatch { 0.0 }
        check(entered.await(5, java.util.concurrent.TimeUnit.SECONDS))
        val waiting = async { queue.acquire("next") }
        yield()
        try {
            working.cancel()
            assertEquals("synchronous work still owns the slot", 1, queue.activeCount)
            assertTrue(queue.dispatch { 0.0 }.isEmpty())
        } finally { exit.countDown() }
        working.join()
        assertEquals(listOf("next"), queue.dispatch { 0.0 })
        waiting.await()!!.close()
        assertEquals(0, queue.registeredCount)
    }

    @Test fun closeIsIdempotentRejectsNewWorkAndMakesGrantedPermitHarmless() = runBlocking {
        val queue = NativeViewportTileQueue<String>(capacity = 1)
        val granted = async { queue.acquire("active") }
        val waiting = async { queue.acquire("pending") }
        yield()
        queue.dispatch { if (it == "active") 0.0 else 1.0 }
        val permit = granted.await()!!
        queue.close()
        queue.close()
        assertNull(waiting.await())
        assertNull(queue.acquire("after-close"))
        assertEquals(0, queue.registeredCount)
        permit.close()
        permit.close()
        assertEquals(0, queue.activeCount)
    }

    private class QueuedDispatcher : CoroutineDispatcher() {
        private val tasks = java.util.concurrent.ConcurrentLinkedQueue<Runnable>()
        override fun dispatch(context: CoroutineContext, block: Runnable) { tasks.add(block) }
        fun runNext() { checkNotNull(tasks.poll()) { "No queued continuation" }.run() }
        fun runAll() { while (tasks.isNotEmpty()) runNext() }
    }
}
