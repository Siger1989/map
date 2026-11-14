package com.shantu.nativeapp.hybrid

import com.shantu.nativeapp.map.NativeCameraSnapshot
import org.junit.Assert.*
import org.junit.Test

class NativeCameraOffsetPolicyTest {
    @Test fun loadedTerrainTakesPrecedenceAndDoesNotInvokeEllipsoid() {
        var fallbackCalls = 0
        assertEquals(30.0 to 104.0, NativeCameraOffsetPolicy.ground({ 30.0 to 104.0 }, { fallbackCalls++; 29.0 to 103.0 }))
        assertEquals(0, fallbackCalls)
    }

    @Test fun unloadedTerrainUsesRealEllipsoidHitAndSkyRemainsUnresolved() {
        assertEquals(30.0 to 104.0, NativeCameraOffsetPolicy.ground({ null }, { 30.0 to 104.0 }))
        assertNull(NativeCameraOffsetPolicy.ground({ null }, { null }))
        assertNull(NativeCameraOffsetPolicy.ground({ Double.NaN to 104.0 }, { 100.0 to 104.0 }))
    }

    @Test fun cameraShiftKeepsPitchBearingRollAndRangeWithoutMutatingTargetData() {
        val pose = NativeCameraSnapshot(30.0, 104.0, 1850.0, 53.0, 61.0, 7.0)
        val target = 30.01 to 104.02
        val shifted = NativeCameraOffsetPolicy.translated(pose, target.first, target.second, 30.005 to 104.01)!!
        assertEquals(30.005, shifted.latitude, 1e-8); assertEquals(104.01, shifted.longitude, 1e-8)
        assertEquals(pose.rangeMeters, shifted.rangeMeters, 0.0)
        assertEquals(pose.headingDegrees, shifted.headingDegrees, 0.0)
        assertEquals(pose.pitchDegrees, shifted.pitchDegrees, 0.0)
        assertEquals(pose.rollDegrees, shifted.rollDegrees, 0.0)
        assertEquals(30.01 to 104.02, target)
        assertEquals(30.0, pose.latitude, 0.0); assertEquals(104.0, pose.longitude, 0.0)
    }

    @Test fun datelineUsesShortestDeltaAndConvergedTargetDoesNotMoveAgain() {
        val pose = NativeCameraSnapshot(10.0, 179.0, 1000.0, 45.0, 60.0)
        assertEquals(181.0, NativeCameraOffsetPolicy.translated(pose, 10.0, -179.0, 10.0 to 179.0)!!.longitude, 0.0)
        assertNull(NativeCameraOffsetPolicy.translated(pose, 10.0, 179.0, 10.0 to 179.0))
    }
}
