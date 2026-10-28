package com.shantu.nativeapp.hybrid

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeBridgeDemSamplingGateTest {
    private val base = NativeBridgeDemSamplingGate.Inputs(
        camera = "{center:[104,30],zoom:12,pitch:45,bearing:20}",
        viewportWidth = 800,
        viewportHeight = 600,
        cssScale = 2.0,
        terrainEnabled = true,
        exaggeration = 1.0,
        demRevision = 9,
    )

    @Test fun revisionObservedDuringActiveSameViewJobBecomesPendingAndRunsAfterFinish() {
        val gate = NativeBridgeDemSamplingGate()
        val oldKey = base.fingerprint()
        val geometry = base.geometryFingerprint()
        val nextKey = base.copy(demRevision = 10).fingerprint()

        assertEquals(NativeBridgeDemSamplingGate.Decision.PLAN, gate.evaluate(oldKey, geometry, 1_000, false))
        gate.begin(oldKey, geometry, 1_000)
        assertEquals(NativeBridgeDemSamplingGate.Decision.ACTIVE_SAME_VIEW, gate.evaluate(nextKey, geometry, 1_500, true))
        assertEquals(nextKey, gate.pendingInputKey())
        // Repeated host frames while the IO job is active do not perform more rays.
        assertEquals(NativeBridgeDemSamplingGate.Decision.ACTIVE_SAME_VIEW, gate.evaluate(nextKey, geometry, 2_000, true))
        assertEquals(nextKey, gate.finish(oldKey, 2_100, NativeBridgeDemSamplingGate.COMPLETE_REFRESH_MILLIS))

        // The old input's 30s refresh window is key-scoped; the new revision replans immediately.
        assertEquals(NativeBridgeDemSamplingGate.Decision.PLAN, gate.evaluate(nextKey, geometry, 2_100, false))
    }

    @Test fun changedCameraCanSupersedeAnActiveJobAfter250MillisecondGate() {
        val gate = NativeBridgeDemSamplingGate()
        val oldKey = base.fingerprint()
        val next = base.copy(camera = "{center:[105,30],zoom:12,pitch:45,bearing:20}")
        gate.begin(oldKey, base.geometryFingerprint(), 1_000)

        assertEquals(NativeBridgeDemSamplingGate.Decision.THROTTLED,
            gate.evaluate(next.fingerprint(), next.geometryFingerprint(), 1_249, true))
        assertEquals(NativeBridgeDemSamplingGate.Decision.PLAN,
            gate.evaluate(next.fingerprint(), next.geometryFingerprint(), 1_250, true))
        gate.begin(next.fingerprint(), next.geometryFingerprint(), 1_250)
        // A superseded job's completion cannot clear the newer attempt.
        assertNull(gate.finish(oldKey, 1_300, NativeBridgeDemSamplingGate.PARTIAL_RETRY_MILLIS))
        assertEquals(NativeBridgeDemSamplingGate.Decision.ACTIVE_SAME_VIEW,
            gate.evaluate(next.fingerprint(), next.geometryFingerprint(), 1_500, true))
    }

    @Test fun insignificantCameraNoiseKeepsActiveJobButMeaningfulPanSupersedesIt() {
        val gate = NativeBridgeDemSamplingGate()
        val lon = 104.0
        val lat = 30.0
        val zoom = 12.984279568640632
        fun input(x: Double, z: Double) = base.copy(camera = NativeBridgeDemSamplingGate.cameraFingerprint(x, lat, z, 45.0, 20.0))
        val initial = input(lon, zoom)
        val noiseOnly = input(lon, zoom + 1.57e-13)
        assertEquals(initial.geometryFingerprint(), noiseOnly.geometryFingerprint())
        gate.begin(initial.fingerprint(), initial.geometryFingerprint(), 1_000)
        assertEquals(NativeBridgeDemSamplingGate.Decision.ACTIVE_SAME_VIEW,
            gate.evaluate(noiseOnly.fingerprint(), noiseOnly.geometryFingerprint(), 1_100, true))
        assertNull(gate.pendingInputKey())

        val panned = input(lon + 0.00002, zoom)
        assertTrue(panned.geometryFingerprint() != initial.geometryFingerprint())
        assertEquals(NativeBridgeDemSamplingGate.Decision.PLAN,
            gate.evaluate(panned.fingerprint(), panned.geometryFingerprint(), 1_250, true))
    }

    @Test fun onlyCompletePlanGetsThirtySecondRefreshAndPartialGetsFiveSecondRetry() {
        val key = base.fingerprint()
        val geometry = base.geometryFingerprint()

        val complete = NativeBridgeDemSamplingGate()
        complete.begin(key, geometry, 1_000)
        complete.finish(key, 2_000, NativeBridgeDemSamplingGate.COMPLETE_REFRESH_MILLIS)
        assertEquals(NativeBridgeDemSamplingGate.Decision.RETRY_WINDOW, complete.evaluate(key, geometry, 31_999, false))
        assertEquals(NativeBridgeDemSamplingGate.Decision.PLAN, complete.evaluate(key, geometry, 32_000, false))

        val partial = NativeBridgeDemSamplingGate()
        partial.begin(key, geometry, 1_000)
        partial.finish(key, 2_000, NativeBridgeDemSamplingGate.PARTIAL_RETRY_MILLIS)
        assertEquals(NativeBridgeDemSamplingGate.Decision.RETRY_WINDOW, partial.evaluate(key, geometry, 6_999, false))
        assertEquals(NativeBridgeDemSamplingGate.Decision.PLAN, partial.evaluate(key, geometry, 7_000, false))
    }

    @Test fun changedViewportTerrainExaggerationAndRevisionAreDistinctInputs() {
        val variants = listOf(
            base.copy(camera = base.camera + ",pitch:46"),
            base.copy(viewportWidth = 801),
            base.copy(terrainEnabled = false),
            base.copy(exaggeration = 1.25),
            base.copy(demRevision = 10),
        )
        for (input in variants) {
            assertTrue(input.fingerprint() != base.fingerprint())
        }
        assertTrue(base.geometryFingerprint() != base.copy(viewportWidth = 801).geometryFingerprint())
        assertEquals(base.geometryFingerprint(), base.copy(demRevision = 10).geometryFingerprint())
    }

    @Test fun sameInputDoesNotRetryBefore250MillisecondsButDoesAfter() {
        val gate = NativeBridgeDemSamplingGate()
        val key = base.fingerprint()
        val geometry = base.geometryFingerprint()
        gate.begin(key, geometry, 1_000)
        gate.finish(key, 1_000, 0)
        assertEquals(NativeBridgeDemSamplingGate.Decision.THROTTLED, gate.evaluate(key, geometry, 1_249, false))
        assertEquals(NativeBridgeDemSamplingGate.Decision.PLAN, gate.evaluate(key, geometry, 1_250, false))
    }
}
