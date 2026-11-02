package com.shantu.nativeapp.map

import org.junit.Assert.*
import org.junit.Test

class NativeTilePriorityIdleGateTest {
    @Test fun onlyFirstAdmissionWakesDeferredPlanner() {
        val gate = NativeTilePriorityIdleGate()
        assertFalse(gate.consumeWake())
        assertTrue(gate.shouldDefer(true) { false })
        assertTrue(gate.consumeWake())
        repeat(100) { assertFalse(gate.consumeWake()) }
        assertTrue(gate.shouldDefer(true) { false })
        assertTrue(gate.consumeWake())
    }

    @Test fun activeOrForcedPlanningDoesNotCreateUrgentAdmissionBurst() {
        val gate = NativeTilePriorityIdleGate()
        assertFalse(gate.shouldDefer(true) { true })
        assertFalse(gate.consumeWake())
        assertTrue(gate.shouldDefer(true) { false })
        assertFalse(gate.shouldDefer(false) { error("force/hidden must bypass idle check") })
        assertFalse(gate.consumeWake())
    }

    @Test fun admissionDuringIdleCheckCannotLoseWake() {
        val gate = NativeTilePriorityIdleGate()
        assertTrue(gate.shouldDefer(true) {
            assertTrue(gate.consumeWake())
            false // A fast transfer may already have completed; a wake is still posted.
        })
        assertFalse(gate.consumeWake())
        assertFalse(gate.shouldDefer(true) {
            assertTrue(gate.consumeWake())
            true
        })
    }
}
