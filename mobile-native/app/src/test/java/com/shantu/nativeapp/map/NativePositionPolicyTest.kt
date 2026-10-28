package com.shantu.nativeapp.map

import org.junit.Assert.*
import org.junit.Test

class NativePositionPolicyTest {
    @Test fun `motion direction rejects network fix low speed and stale heading`() {
        val fix = NativePositionFix(30.0, 120.0, 4.0, 10_000, speedMetersPerSecond = 0.1, courseDegrees = 90.0)
        val result = NativePositionPolicy.present(NativePositionState(fix, 10_500, mode = NativeDirectionMode.MOTION))
        assertTrue(result.visible)
        assertNull(result.headingDegrees)
        assertTrue(result.headingStale)
        val ip = fix.copy(provider = "ip", speedMetersPerSecond = 8.0)
        assertNull(NativePositionPolicy.present(NativePositionState(ip, 10_500, mode = NativeDirectionMode.MOTION)).headingDegrees)
        val network = fix.copy(provider = "network", speedMetersPerSecond = 8.0, courseDegrees = 90.0, courseAccuracyDegrees = 2.0)
        assertNull(NativePositionPolicy.present(NativePositionState(network, 10_500, mode = NativeDirectionMode.MOTION)).headingDegrees)
    }

    @Test fun `camera direction mode never changes actual GPS course arrow`() {
        val fix = NativePositionFix(30.0, 120.0, 6.0, 10_000)
        val compass = NativePositionState(fix, 10_500, 270.0, NativeHeadingSource.DEVICE_COMPASS, 10_400, 8.0, NativeDirectionMode.DEVICE)
        val noCourse = NativePositionPolicy.present(compass)
        assertTrue(noCourse.visible); assertNull(noCourse.headingDegrees); assertTrue(noCourse.headingStale)
        val moving = fix.copy(speedMetersPerSecond = 4.0, courseDegrees = 0.0, courseAccuracyDegrees = 10.0)
        val headings = NativeDirectionMode.entries.map { mode -> NativePositionPolicy.present(compass.copy(fix = moving, mode = mode)).headingDegrees }
        assertEquals(listOf(0.0, 0.0, 0.0, 0.0), headings)
        assertFalse(NativePositionPolicy.present(NativePositionState(fix, 50_001)).visible)
    }

    @Test fun `rejects noisy course and accepts north and wraparound courses`() {
        val base = NativePositionFix(30.0, 120.0, 4.0, 1000, speedMetersPerSecond = 2.0)
        fun present(course: Double, speed: Double = 2.0, accuracy: Double = 4.0) = NativePositionPolicy.present(NativePositionState(base.copy(courseDegrees = course, speedMetersPerSecond = speed, accuracyMeters = accuracy), 1100, mode = NativeDirectionMode.FREE))
        assertEquals(0.0, present(0.0).headingDegrees!!, 0.0)
        assertEquals(180.0, present(180.0).headingDegrees!!, 0.0)
        assertEquals(359.0, present(359.0).headingDegrees!!, 0.0)
        assertNull(present(10.0, speed = 0.2).headingDegrees)
        assertNull(present(10.0, accuracy = 40.0).headingDegrees)
    }

    @Test fun `route direction cannot be passed or substituted for missing heading`() {
        val fix = NativePositionFix(30.0, 120.0, 5.0, 1_000, speedMetersPerSecond = 0.0)
        val result = NativePositionPolicy.present(NativePositionState(fix, 1_100, mode = NativeDirectionMode.MOTION))
        assertNull(result.headingDegrees)
        assertTrue(result.headingStale)
    }
}
