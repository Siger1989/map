package com.shantu.nativeapp.map

import org.junit.Assert.*
import org.junit.Test

class NativeContourRefinementStateTest {
    @Test fun `visible forced parents cannot be displaced when state is full`() {
        val state = NativeContourRefinementState<String>(2)
        assertTrue(state.requestRefinement("visible"))
        assertTrue(state.requestRefinement("other"))

        repeat(3) {
            state.advanceFrame()
            assertTrue(state.shouldRefine("visible"))
            assertTrue(state.shouldRefine("other"))
        }
        assertFalse(state.requestRefinement("new"))
        assertEquals(2, state.size)
        assertTrue(state.shouldRefine("visible"))
        assertTrue(state.shouldRefine("other"))
    }

    @Test fun `inactive LRU key is reclaimed while recently visible key remains`() {
        val state = NativeContourRefinementState<String>(2)
        assertTrue(state.requestRefinement("oldest"))
        state.advanceFrame()
        assertTrue(state.requestRefinement("newer"))
        repeat(3) { state.advanceFrame() }
        assertTrue(state.shouldRefine("newer"))

        assertTrue(state.requestRefinement("replacement"))
        assertEquals(2, state.size)
        assertFalse(state.shouldRefine("oldest"))
        assertTrue(state.shouldRefine("newer"))
        assertTrue(state.shouldRefine("replacement"))
    }

    @Test fun `closed owner cannot reinsert a late worker result`() {
        val state = NativeContourRefinementState<String>()
        assertTrue(state.requestRefinement("before-close"))
        state.clear()

        assertFalse(state.requestRefinement("late", allowed = { false }))
        assertEquals(0, state.size)
        assertFalse(state.shouldRefine("late"))
    }

    @Test fun `duplicate requests refresh existing key without consuming capacity`() {
        val state = NativeContourRefinementState<String>(1)
        assertTrue(state.requestRefinement("same"))
        repeat(5) {
            state.advanceFrame()
            assertTrue(state.requestRefinement("same"))
        }
        assertEquals(1, state.size)
        assertTrue(state.shouldRefine("same"))
        assertFalse(state.requestRefinement("different"))
    }

    @Test fun `clear releases all bounded refinement keys`() {
        val state = NativeContourRefinementState<String>(3)
        listOf("a", "b", "c").forEach { assertTrue(state.requestRefinement(it)) }
        assertEquals(3, state.size)

        state.clear()

        assertEquals(0, state.size)
        listOf("a", "b", "c").forEach { assertFalse(state.shouldRefine(it)) }
        assertTrue(state.requestRefinement("after-clear"))
        assertEquals(1, state.size)
    }
}
