package com.shantu.nativeapp.geology

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeGeologyWorldRequestsTest {
    @Test fun `finished pending tiles are not eligible for refetch and failures honor backoff`() {
        val wanted = linkedSetOf("ready", "retry", "fresh")
        val eligible = nativeGeologyWorldTilesToRequest(
            wanted,
            pending = setOf("ready"),
            failedUntil = mapOf("retry" to 5_000L),
            nowMs = 4_000L,
        )
        assertEquals(setOf("fresh"), eligible)
        assertEquals(setOf("retry", "fresh"), nativeGeologyWorldTilesToRequest(
            wanted, pending = setOf("ready"), failedUntil = mapOf("retry" to 5_000L), nowMs = 5_000L))
    }

    @Test fun `identical committed scene is not scheduled for another swap`() {
        val tileA = Any()
        val tileB = Any()
        val displayed = linkedMapOf("a" to tileA, "b" to tileB)
        assertTrue(nativeGeologySceneMatchesByIdentity(displayed, displayed.toMap(), setOf("a", "b")))
        assertFalse(nativeGeologySceneMatchesByIdentity(displayed, mapOf("a" to Any(), "b" to tileB), setOf("a", "b")))
        assertFalse(nativeGeologySceneMatchesByIdentity(displayed, displayed, setOf("a")))
    }

    @Test fun `same wanted set is deduplicated and active requests stay under two`() {
        val scheduler = NativeGeologyWorldRequests(maxActive = 2)
        val first = scheduler.reconcile(linkedSetOf("a", "b", "c", "d"))
        assertEquals(2, first.start.size)
        assertEquals(2, scheduler.activeCount)
        assertEquals(4, scheduler.trackedCount)
        assertTrue(scheduler.reconcile(linkedSetOf("a", "b", "c", "d")).start.isEmpty())
        assertEquals(2, scheduler.activeCount)

        val next = scheduler.finish(first.start.first())
        assertEquals(1, next.start.size)
        assertEquals(2, scheduler.activeCount)
    }

    @Test fun `offscreen cancellation and stale finally preserve replacement identity`() {
        val scheduler = NativeGeologyWorldRequests(maxActive = 2)
        val initial = scheduler.reconcile(linkedSetOf("a", "b"))
        val oldA = initial.start.first { it.key == "a" }
        scheduler.reconcile(setOf("b"))
        assertFalse(scheduler.isCurrent(oldA))
        assertEquals("cancelled work keeps its slot until finally", 2, scheduler.activeCount)

        scheduler.reconcile(linkedSetOf("a", "b"))
        val replacement = scheduler.finish(oldA).start.single { it.key == "a" }
        assertNotSame(oldA, replacement)
        assertTrue(scheduler.isCurrent(replacement))

        scheduler.finish(oldA) // A delayed/stale finally must not remove the replacement.
        assertTrue(scheduler.isCurrent(replacement))
        assertEquals(2, scheduler.activeCount)
    }

    @Test fun `cancel all invalidates old source and honors the active ceiling until cancellation finishes`() {
        val scheduler = NativeGeologyWorldRequests(maxActive = 2)
        val old = scheduler.reconcile(linkedSetOf("a", "b")).start
        assertEquals(2, scheduler.cancelAll().size)
        assertFalse(scheduler.isCurrent(old.first()))
        assertTrue(scheduler.reconcile(setOf("new")).start.isEmpty())
        assertTrue(scheduler.activeCount <= 2)
        assertEquals(1, scheduler.finish(old.first()).start.size)
        assertTrue(scheduler.activeCount <= 2)
    }
}
