package com.shantu.nativeapp.map

import kotlinx.coroutines.async
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.yield
import org.junit.Assert.assertEquals
import org.junit.Test

class NativeContourProcessBudgetTest {
    @Test fun `assembly slot releases before returned content admission so hidden results cannot starve another pane`() = runBlocking {
        val budget = NativeContourProcessBudget(capacity = 1)
        val firstPreparedResult = budget.withAssemblyPermit { "generated-but-not-yet-admitted" }
        assertEquals("generated-but-not-yet-admitted", firstPreparedResult)
        assertEquals(0, budget.snapshot().activeSlots)

        // A lower-zoom pane can retain this result without holding the global assembly lane.
        val secondResult = budget.withAssemblyPermit {
            assertEquals("generated-but-not-yet-admitted", firstPreparedResult)
            "visible-pane-result"
        }
        assertEquals("visible-pane-result", secondResult)
        assertEquals(0, budget.snapshot().activeSlots)
    }

    @Test fun `process lane is FIFO and never exceeds one active preparation`() = runBlocking {
        val budget = NativeContourProcessBudget(capacity = 1)
        val first = budget.acquire()
        val order = mutableListOf<Int>()
        val waiting = (1..2).map { id ->
            async {
                val permit = budget.acquire()
                try { synchronized(order) { order += id } } finally { permit.close() }
            }
        }
        withTimeout(1_000) { while (budget.snapshot().queuedRequests != 2) yield() }
        assertEquals(1, budget.snapshot().activeSlots)
        assertEquals(1, budget.snapshot().maximumActiveSlots)
        first.close()
        waiting.forEach { it.await() }

        assertEquals(listOf(1, 2), order)
        assertEquals(0, budget.snapshot().activeSlots)
        assertEquals(1, budget.snapshot().maximumActiveSlots)
        assertEquals(2L, budget.snapshot().waits)
    }

    @Test fun `cancelled waiter leaves no queued or active slot and later work proceeds`() = runBlocking {
        val budget = NativeContourProcessBudget(capacity = 1)
        val held = budget.acquire()
        val cancelled = async { budget.acquire() }
        withTimeout(1_000) { while (budget.snapshot().queuedRequests != 1) yield() }

        cancelled.cancelAndJoin()
        assertEquals(0, budget.snapshot().queuedRequests)
        assertEquals(1, budget.snapshot().activeSlots)

        held.close()
        val next = budget.acquire()
        assertEquals(1, budget.snapshot().activeSlots)
        next.close()
        assertEquals(0, budget.snapshot().activeSlots)
        assertEquals(1L, budget.snapshot().waits)
    }

    @Test fun `cancellation during assembly releases its process slot`() = runBlocking {
        val budget = NativeContourProcessBudget(capacity = 1)
        val started = kotlinx.coroutines.CompletableDeferred<Unit>()
        val worker = async {
            budget.withAssemblyPermit {
                started.complete(Unit)
                awaitCancellation()
            }
        }
        withTimeout(1_000) { started.await() }
        assertEquals(1, budget.snapshot().activeSlots)

        worker.cancelAndJoin()
        assertEquals(0, budget.snapshot().activeSlots)
        val next = budget.acquire()
        next.close()
        assertEquals(1, budget.snapshot().maximumActiveSlots)
    }
}
