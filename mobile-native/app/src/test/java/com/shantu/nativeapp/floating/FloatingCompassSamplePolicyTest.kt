package com.shantu.nativeapp.floating

import org.junit.Assert.assertFalse
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
}
