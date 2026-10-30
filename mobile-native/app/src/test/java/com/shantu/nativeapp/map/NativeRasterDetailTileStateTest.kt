package com.shantu.nativeapp.map

import org.junit.Assert.*
import org.junit.Test

class NativeRasterDetailTileStateTest {
    @Test fun `visible diff requests missing tiles once and preserves already ready detail`() {
        val state = NativeRasterDetailTileState(100)
        assertEquals(listOf("a", "b"), state.reconcile(setOf("a", "b"), true).request)
        state.ready("a", 40)
        val next = state.reconcile(setOf("a", "b", "c"), true)
        assertEquals(listOf("c"), next.request)
        assertEquals(listOf("a"), next.keep)
        assertTrue(state.contains("a"))
        assertTrue(state.reconcile(setOf("a", "b", "c"), true).request.isEmpty())
    }

    @Test fun `resident budget evicts oldest and failure leaves other ready tiles`() {
        val state = NativeRasterDetailTileState(80)
        state.ready("old", 40); state.ready("new", 40)
        state.failed("broken")
        assertEquals(listOf("old"), state.ready("last", 40))
        assertFalse(state.contains("old")); assertTrue(state.contains("new")); assertTrue(state.contains("last"))
        assertEquals(80, state.residentBytes())
    }

    @Test fun `offscreen ready detail survives until bounded budget forces eviction`() {
        val state = NativeRasterDetailTileState(80)
        state.ready("old-view", 40)
        val diff = state.reconcile(setOf("new-view"), true)
        assertTrue(diff.retire.isEmpty())
        assertTrue(state.contains("old-view"))
        state.ready("new-view", 40)
        assertTrue(state.contains("old-view"))
        assertTrue(state.contains("new-view"))
        assertEquals(listOf("old-view"), state.ready("newer", 40))
        assertFalse(state.contains("old-view"))
        assertTrue(state.contains("new-view"))
    }

    @Test fun `visible tile is touched and protected before offscreen residents`() {
        val state = NativeRasterDetailTileState(80)
        state.ready("visible", 40)
        state.ready("offscreen", 40)
        state.reconcile(setOf("visible"), true)
        assertEquals(listOf("offscreen"), state.ready("new", 40))
        assertTrue(state.contains("visible"))
    }

    @Test fun `hidden reconciliation retires out of view but schedules no fetch`() {
        val state = NativeRasterDetailTileState(100)
        state.ready("visible", 40)
        val diff = state.reconcile(setOf("visible", "new"), false)
        assertTrue(diff.request.isEmpty()); assertEquals(listOf("visible"), diff.keep)
        assertTrue(state.pendingKeys().isEmpty())
    }

    @Test fun `failed and canceled request can be requested again`() {
        val state = NativeRasterDetailTileState(100)
        state.reconcile(setOf("x"), true)
        state.cancelPending()
        assertEquals(listOf("x"), state.reconcile(setOf("x"), true).request)
        state.failed("x")
        assertEquals(listOf("x"), state.reconcile(setOf("x"), true).request)
    }

    @Test fun `single tile larger than budget is rejected without residency growth`() {
        val state = NativeRasterDetailTileState(40)
        state.reconcile(setOf("oversized"), true)
        assertEquals(listOf("oversized"), state.ready("oversized", 41))
        assertFalse(state.contains("oversized"))
        assertEquals(0L, state.residentBytes())
    }
}
