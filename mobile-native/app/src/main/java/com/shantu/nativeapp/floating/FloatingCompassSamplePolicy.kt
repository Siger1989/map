package com.shantu.nativeapp.floating

/** Gate for sensor samples: Android sensor timestamps share elapsedRealtimeNanos' timebase. */
internal class FloatingCompassSamplePolicy(
    private val maxAgeNanos: Long = 3_000_000_000L,
    private val minimumAccuracy: Int = 2, // SensorManager.SENSOR_STATUS_ACCURACY_MEDIUM
) {
    private var running = false

    fun start() { running = true }
    fun stop() { running = false }
    fun isRunning() = running

    fun accepts(eventTimestampNanos: Long, nowElapsedNanos: Long, accuracy: Int): Boolean {
        if (!running || accuracy < minimumAccuracy || eventTimestampNanos <= 0L || nowElapsedNanos <= 0L) return false
        if (eventTimestampNanos > nowElapsedNanos) return false
        return nowElapsedNanos - eventTimestampNanos <= maxAgeNanos
    }
}

/** Bounds sensor re-registration when a device reports success but sends no usable samples. */
internal class FloatingCompassRecoveryPolicy(private val maximumRetries: Int = 3) {
    private var retries = 0

    fun reset() { retries = 0 }

    fun takeRetry(): Boolean {
        if (retries >= maximumRetries) return false
        retries++
        return true
    }
}
