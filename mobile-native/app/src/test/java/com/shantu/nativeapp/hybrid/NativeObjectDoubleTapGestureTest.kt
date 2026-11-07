package com.shantu.nativeapp.hybrid

import org.junit.Assert.*
import org.junit.Test

class NativeObjectDoubleTapGestureTest {
    @Test fun sameRealObjectHitPairsAndConsumesOnlyTheSecondTap() {
        val gate = NativeObjectDoubleTapGate()
        gate.noteTap(130L, 40f, 50f, true)
        assertEquals(NativeObjectDoubleTapGate.State.SINGLE, gate.resolve(130L, 40f, 50f, "annotation:7", true).state)
        assertTrue(gate.begin(260L, 42f, 50f, 1, true))
        val result = gate.resolve(300L, 42f, 50f, "annotation:7", true)
        assertEquals(NativeObjectDoubleTapGate.State.MATCH, result.state)
        assertEquals("annotation:7", result.objectId)
        assertFalse(gate.isCandidateActive)
    }

    @Test fun delayedFirstGpuPickDoesNotCancelTheSecondCameraCandidate() {
        val gate = NativeObjectDoubleTapGate()
        gate.noteTap(130L, 40f, 50f, true)
        assertTrue(gate.begin(260L, 42f, 50f, 1, true))
        assertEquals(NativeObjectDoubleTapGate.State.PENDING, gate.resolve(300L, 42f, 50f, "annotation:7", true).state)
        val result = gate.resolve(130L, 40f, 50f, "annotation:7", true)
        assertEquals(NativeObjectDoubleTapGate.State.MATCH, result.state)
        assertEquals("annotation:7", result.objectId)
        assertFalse(gate.isCandidateActive)
    }

    @Test fun differentObjectAndBlankPickRemainOrdinaryCameraTaps() {
        val gate = NativeObjectDoubleTapGate()
        gate.noteTap(10L, 1f, 1f, true)
        gate.resolve(10L, 1f, 1f, "route:1", true)
        assertTrue(gate.begin(80L, 1f, 1f, 1, true))
        assertEquals(NativeObjectDoubleTapGate.State.DIFFERENT, gate.resolve(100L, 1f, 1f, "area:2", true).state)
        assertTrue(gate.begin(150L, 1f, 1f, 1, true))
        assertEquals(NativeObjectDoubleTapGate.State.DIFFERENT, gate.resolve(180L, 1f, 1f, null, true).state)
        assertFalse(gate.begin(210L, 1f, 1f, 1, true))
    }

    @Test fun staleOrDistantTapDoesNotBecomeCandidate() {
        val gate = NativeObjectDoubleTapGate()
        gate.noteTap(10L, 1f, 1f, true)
        gate.resolve(10L, 1f, 1f, "track:1", true)
        assertFalse(gate.begin(311L, 1f, 1f, 1, true))
        assertFalse(gate.begin(20L, 60f, 1f, 1, true))
        assertFalse(gate.begin(20L, 1f, 1f, 2, true))
    }

    @Test fun cancelAndEditingModeNeverPairOrRetainAnOldObject() {
        val gate = NativeObjectDoubleTapGate()
        gate.noteTap(10L, 1f, 1f, true)
        gate.resolve(10L, 1f, 1f, "annotation:5", true)
        assertFalse(gate.begin(20L, 1f, 1f, 1, false))
        assertFalse(gate.begin(30L, 1f, 1f, 1, true))
        gate.noteTap(40L, 1f, 1f, true)
        gate.resolve(40L, 1f, 1f, "annotation:5", true)
        assertTrue(gate.begin(50L, 1f, 1f, 1, true))
        gate.cancel()
        assertFalse(gate.isCandidateActive)
        assertFalse(gate.begin(60L, 1f, 1f, 1, true))
    }

    @Test fun overlappingObjectsPairOnlyTheirTopSemanticHit() {
        val first = NativeObjectDoubleTapGate.primaryObjectId(
            listOf("marker-a", "shared-route", "terrain"), setOf("marker-a", "marker-b"),
            setOf("shared-route"), setOf("track-a"), setOf("area-a"),
        )
        val second = NativeObjectDoubleTapGate.primaryObjectId(
            listOf("marker-b", "shared-route", "terrain"), setOf("marker-a", "marker-b"),
            setOf("shared-route"), setOf("track-a"), setOf("area-a"),
        )
        assertEquals("annotation:marker-a", first)
        assertEquals("annotation:marker-b", second)
        val gate = NativeObjectDoubleTapGate()
        gate.noteTap(10L, 1f, 1f, true)
        gate.resolve(20L, 1f, 1f, first, true)
        assertTrue(gate.begin(40L, 1f, 1f, 1, true))
        assertEquals(NativeObjectDoubleTapGate.State.DIFFERENT, gate.resolve(50L, 1f, 1f, second, true).state)
    }

    @Test fun reverseOrderDifferentPicksResolveAsOrdinarySecondTap() {
        val gate = NativeObjectDoubleTapGate()
        gate.noteTap(10L, 1f, 1f, true)
        assertTrue(gate.begin(40L, 1f, 1f, 1, true))
        assertEquals(NativeObjectDoubleTapGate.State.PENDING, gate.resolve(50L, 1f, 1f, "area:b", true).state)
        val result = gate.resolve(20L, 1f, 1f, "annotation:a", true)
        assertEquals(NativeObjectDoubleTapGate.State.DIFFERENT, result.state)
        assertEquals(50L, result.secondEventTime) // actual second ACTION_UP, not its DOWN
    }

    @Test fun nativePickTimeoutExpiresTheCandidateAndIgnoresLatePairing() {
        val gate = NativeObjectDoubleTapGate()
        gate.noteTap(10L, 1f, 1f, true)
        gate.resolve(10L, 1f, 1f, "annotation:a", true)
        assertTrue(gate.begin(40L, 1f, 1f, 1, true))
        assertFalse(gate.expire(489L))
        assertTrue(gate.expire(490L)) // a timer delivered exactly on its deadline must release input
        assertFalse(gate.isCandidateActive)
        assertEquals(NativeObjectDoubleTapGate.State.SINGLE, gate.resolve(500L, 1f, 1f, "annotation:a", true).state)
    }

    @Test fun confirmedBlankFirstPickDoesNotDelayOrdinaryCameraDoubleTap() {
        val gate = NativeObjectDoubleTapGate()
        gate.noteTap(10L, 1f, 1f, true)
        assertEquals(NativeObjectDoubleTapGate.State.SINGLE, gate.resolve(10L, 1f, 1f, null, true).state)
        assertFalse(gate.begin(40L, 1f, 1f, 1, true))
        assertFalse(gate.isCandidateActive)
    }
}
