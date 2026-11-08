package com.shantu.nativeapp.map

import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeContourVisibleBudgetPolicyTest {
    @Test fun `higher pressure never readmits a deferred patch`() {
        val policy = NativeContourVisibleBudgetPolicy(capacityBytes = 100, pressureFramesToRaise = 1)
        val patches = listOf(0.0, 40.0, 72.0, 150.0, 200.0, 250.0).flatMap { distance ->
            listOf(2.0, 20.0, 50.0, 80.0, 160.0).map { extent ->
                NativeContourProjectedFootprint(distance, extent)
            }
        }
        var deferred = emptySet<NativeContourProjectedFootprint>()
        for ((index, bytes) in listOf(60L, 75L, 90L).withIndex()) {
            policy.observe(bytes, index.toLong(), generationWorkPending = true)
            val next = patches.filter { policy.shouldDefer(it, 390, 857) }.toSet()
            assertTrue(next.containsAll(deferred))
            deferred = next
        }
    }

    @Test fun `pressure has hysteresis and cannot recover while generation work remains queued`() {
        val policy = NativeContourVisibleBudgetPolicy(
            capacityBytes = 100, pressureFramesToRaise = 1, recoveryStableNanos = 100,
        )
        val mediumTile = NativeContourProjectedFootprint(distanceFromFocusPx = 150.0, minimumVisibleExtentPx = 40.0)
        assertEquals(1, policy.observe(60, nowNanos = 0, generationWorkPending = true))
        assertFalse(policy.shouldDefer(mediumTile, 390, 857))
        assertEquals(2, policy.observe(75, nowNanos = 1, generationWorkPending = true))
        assertFalse(policy.shouldDefer(mediumTile, 390, 857))
        assertEquals(3, policy.observe(90, nowNanos = 2, generationWorkPending = true))
        assertTrue(policy.shouldDefer(mediumTile, 390, 857)) // the near-focus radius shrinks as pressure rises

        assertEquals(3, policy.observe(55, nowNanos = 10, generationWorkPending = true))
        assertEquals(3, policy.observe(55, nowNanos = 100, generationWorkPending = false))
        assertEquals(3, policy.observe(55, nowNanos = 199, generationWorkPending = false))
        assertEquals(2, policy.observe(55, nowNanos = 200, generationWorkPending = false))
    }

    @Test fun `deferred far requests retain no permit and nearby requests pass`() = runBlocking {
        val policy = NativeContourVisibleBudgetPolicy(capacityBytes = 100, pressureFramesToRaise = 1)
        policy.observe(60, nowNanos = 1, generationWorkPending = true)
        val queue = NativeContourPriorityQueue<String>(capacity = 1)
        val far = async { queue.acquire("far") }
        val near = async { queue.acquire("near") }
        withTimeout(1_000) { while (queue.pendingCount != 2) yield() }

        val deferred = mutableSetOf<String>()
        assertEquals(listOf("near"), queue.dispatch { key ->
            val footprintDistance = if (key == "far") 250.0 else 0.0
            if (policy.shouldDefer(NativeContourProjectedFootprint(footprintDistance, 160.0), 390, 857)) {
                deferred += key
                null
            } else footprintDistance
        })
        assertTrue(deferred.contains("far"))
        assertEquals(1, queue.pendingCount)
        assertEquals(1, queue.activeCount)
        near.await()!!.close()

        assertTrue(queue.dispatch { key ->
            val distance = if (key == "far") 250.0 else 0.0
            if (policy.shouldDefer(NativeContourProjectedFootprint(distance, 160.0), 390, 857)) null else 0.0
        }.isEmpty())
        assertEquals(1, queue.pendingCount)
        assertEquals(0, queue.activeCount)

        // When the camera moves this tile under the focus, the same pending request is eligible.
        assertEquals(listOf("far"), queue.dispatch { key ->
            val distance = if (key == "far") 0.0 else 250.0
            if (policy.shouldDefer(NativeContourProjectedFootprint(distance, 160.0), 390, 857)) null else 0.0
        })
        far.await()!!.close()
        assertEquals(0, queue.registeredCount)
        queue.close()
    }

    @Test fun `focus-covering tiles and unprojectable tiles are kept while thin horizon tiles defer`() {
        val policy = NativeContourVisibleBudgetPolicy(capacityBytes = 100, pressureFramesToRaise = 1)
        policy.observe(60, nowNanos = 1, generationWorkPending = true)

        // distanceToQuad is zero when the projected footprint covers focus, even if its center
        // would be hundreds of pixels away. Projection failure is conservatively allowed too.
        assertFalse(policy.shouldDefer(NativeContourProjectedFootprint(0.0, 2.0), 390, 857))
        assertFalse(policy.shouldDefer(null, 390, 857))
        // A steep-angle horizon strip can be only 20px thick while its distance-to-footprint is 72px.
        assertTrue(policy.shouldDefer(NativeContourProjectedFootprint(72.0, 20.0), 390, 857))
        // A nearby broad footprint remains visible, even when it does not contain the focus point.
        assertFalse(policy.shouldDefer(NativeContourProjectedFootprint(72.0, 80.0), 390, 857))
        // Distant broad tiles are still deferred by the outer near-focus radius.
        assertTrue(policy.shouldDefer(NativeContourProjectedFootprint(250.0, 80.0), 390, 857))
    }
}
