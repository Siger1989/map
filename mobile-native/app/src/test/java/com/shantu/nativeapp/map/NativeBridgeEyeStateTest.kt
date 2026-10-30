package com.shantu.nativeapp.map

import earth.worldwind.geom.Camera
import earth.worldwind.geom.AltitudeMode
import earth.worldwind.geom.Angle.Companion.degrees
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class NativeBridgeEyeStateTest {
    @Test fun exactEyeSignatureDetectsSubMeterAndFewMeterChanges() {
        val camera = Camera().apply {
            set(31.0.degrees, 103.0.degrees, 1200.0, altitudeMode, 10.0.degrees, 45.0.degrees, 0.0.degrees)
        }
        val original = NativeBridgeEyeState.from(camera)
        camera.position.altitude += 0.5
        assertNotEquals(original, NativeBridgeEyeState.from(camera))
        camera.position.altitude -= 0.5
        camera.position.latitude = 31.00002.degrees // about 2.2 meters north.
        assertNotEquals(original, NativeBridgeEyeState.from(camera))
    }

    @Test fun capturedEyeIsImmutableAndTracksAllProjectionFields() {
        val camera = Camera().apply {
            set(31.0.degrees, 103.0.degrees, 1200.0, AltitudeMode.ABSOLUTE,
                10.0.degrees, 45.0.degrees, 2.0.degrees, 45.0.degrees)
        }
        val captured = NativeBridgeEyeState.from(camera)
        camera.position.latitude = 31.00002.degrees
        camera.position.longitude = 103.00003.degrees
        camera.position.altitude = 1200.5
        camera.altitudeMode = AltitudeMode.RELATIVE_TO_GROUND
        camera.heading = 10.1.degrees
        camera.tilt = 45.1.degrees
        camera.roll = 2.1.degrees
        camera.fieldOfView = 46.0.degrees

        assertEquals(31.0, captured.latitudeDegrees, 0.0)
        assertEquals(103.0, captured.longitudeDegrees, 0.0)
        assertEquals(1200.0, captured.altitudeMeters, 0.0)
        assertEquals(AltitudeMode.ABSOLUTE, captured.altitudeMode)
        assertEquals(10.0, captured.headingDegrees, 0.0)
        assertEquals(45.0, captured.tiltDegrees, 0.0)
        assertEquals(2.0, captured.rollDegrees, 0.0)
        assertEquals(45.0, captured.fieldOfViewDegrees, 0.0)
        assertNotEquals(captured, NativeBridgeEyeState.from(camera))
    }
}
