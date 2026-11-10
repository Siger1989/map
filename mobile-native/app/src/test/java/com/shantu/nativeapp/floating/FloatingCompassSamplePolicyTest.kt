package com.shantu.nativeapp.floating

import org.junit.Assert.assertFalse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class FloatingCompassSamplePolicyTest {
    @Test fun sensorRecoveryRetriesAreBoundedAndResetForTheNextForegroundRun() {
        val recovery = FloatingCompassRecoveryPolicy(maximumRetries = 3)
        assertTrue(recovery.takeRetry())
        assertTrue(recovery.takeRetry())
        assertTrue(recovery.takeRetry())
        assertFalse(recovery.takeRetry())

        recovery.reset()
        assertTrue(recovery.takeRetry())
    }

    @Test fun rejectsStaleFutureAndInvalidAccuracySensorEvents() {
        val policy = FloatingCompassSamplePolicy(maxAgeNanos = 3_000_000_000L, minimumAccuracy = 2)
        val now = 50_000_000_000L
        policy.start()

        assertTrue(policy.accepts(now - 2_999_000_000L, now, accuracy = 2))
        assertTrue(policy.accepts(now, now, accuracy = 3))
        assertFalse(policy.accepts(now - 3_001_000_000L, now, accuracy = 3))
        assertFalse(policy.accepts(now + 1L, now, accuracy = 3))
        assertFalse(policy.accepts(now, now, accuracy = 1))
        assertFalse(policy.accepts(0L, now, accuracy = 3))
    }

    @Test fun stoppedSensorDropsEvenOtherwiseFreshSamplesAndCanRestart() {
        val policy = FloatingCompassSamplePolicy()
        val now = 7_000_000_000L
        assertFalse(policy.accepts(now, now, accuracy = 3))

        policy.start()
        assertTrue(policy.accepts(now, now, accuracy = 3))

        policy.stop()
        assertFalse(policy.accepts(now, now, accuracy = 3))

        policy.start()
        assertTrue(policy.accepts(now, now, accuracy = 2))
    }

    @Test fun screenResumeShowsRecentCacheAsPreviewAndExpiresItAfterTenMinutes() {
        val policy = FloatingCompassSamplePolicy()
        val now = 100_000_000_000L
        policy.start()
        policy.rememberAccepted(now - 2_000_000_000L, accuracy = 2)
        assertTrue(policy.cacheState(now) == FloatingCompassSamplePolicy.CacheState.FRESH)

        policy.stop() // Screen off unregisters sensors, but service-lifetime cache survives.
        policy.start()
        assertTrue(policy.cacheState(now + 5_000_000_000L) == FloatingCompassSamplePolicy.CacheState.PREVIEW)
        assertTrue(policy.cacheState(now + 600_000_000_001L) == FloatingCompassSamplePolicy.CacheState.EXPIRED)
        assertTrue(policy.cacheState(now + 600_000_000_001L) != FloatingCompassSamplePolicy.CacheState.FRESH)
    }

    @Test fun missingGpsUsesMagneticNorthThenNewLocationDeclinationProducesTrueNorth() {
        val policy = FloatingCompassSamplePolicy()
        val magnetic = policy.resolveHeading(350.0, null, locationCurrent = false)!!
        assertEquals(350.0, magnetic.degrees, 0.0)
        assertEquals("磁北，待定位校正", magnetic.label)

        val corrected = policy.resolveHeading(350.0, 15.0, locationCurrent = true)!!
        assertEquals(5.0, corrected.degrees, 0.0)
        assertEquals("真北", corrected.label)

        val cachedDeclination = policy.resolveHeading(350.0, 15.0, locationCurrent = false)!!
        assertEquals(5.0, cachedDeclination.degrees, 0.0)
        assertEquals("真北，沿用上次定位校正", cachedDeclination.label)
    }

    @Test fun cacheNeverAcceptsFutureOrInvalidSensorTimestamps() {
        val policy = FloatingCompassSamplePolicy()
        val now = 90_000_000_000L
        policy.rememberAccepted(now + 1L, accuracy = 3)
        assertTrue(policy.cacheState(now) == FloatingCompassSamplePolicy.CacheState.NONE)
        policy.rememberAccepted(0L, accuracy = 3)
        assertTrue(policy.cacheState(now) == FloatingCompassSamplePolicy.CacheState.NONE)
    }
}
