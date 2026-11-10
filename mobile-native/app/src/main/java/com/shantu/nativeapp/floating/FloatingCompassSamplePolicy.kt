package com.shantu.nativeapp.floating

/** Gate for sensor samples: Android sensor timestamps share elapsedRealtimeNanos' timebase. */
internal class FloatingCompassSamplePolicy(
    private val maxAgeNanos: Long = 3_000_000_000L,
    private val maxPreviewAgeNanos: Long = 600_000_000_000L,
    private val minimumAccuracy: Int = 2, // SensorManager.SENSOR_STATUS_ACCURACY_MEDIUM
) {
    private var running = false
    private var cachedTimestampNanos = 0L
    private var cachedAccuracy = Int.MIN_VALUE

    enum class CacheState { NONE, FRESH, PREVIEW, EXPIRED }
    data class Heading(val degrees: Double, val label: String)

    fun start() { running = true }
    fun stop() { running = false }
    fun isRunning() = running

    fun rememberAccepted(timestampNanos: Long, accuracy: Int) {
        cachedTimestampNanos = timestampNanos
        cachedAccuracy = accuracy
    }

    fun cacheState(nowElapsedNanos: Long): CacheState {
        val timestamp = cachedTimestampNanos
        if (timestamp <= 0L || cachedAccuracy < minimumAccuracy || nowElapsedNanos <= 0L || timestamp > nowElapsedNanos)
            return CacheState.NONE
        val age = nowElapsedNanos - timestamp
        return when {
            age <= maxAgeNanos -> CacheState.FRESH
            age <= maxPreviewAgeNanos -> CacheState.PREVIEW
            else -> CacheState.EXPIRED
        }
    }

    fun cachedTimestampNanos() = cachedTimestampNanos

    fun resolveHeading(magneticAzimuth: Double, declinationDegrees: Double?, locationCurrent: Boolean): Heading? {
        if (!magneticAzimuth.isFinite() || declinationDegrees?.isFinite() == false) return null
        val correction = declinationDegrees ?: 0.0
        val degrees = ((magneticAzimuth + correction) % 360.0 + 360.0) % 360.0
        val label = when {
            declinationDegrees == null -> "磁北，待定位校正"
            locationCurrent -> "真北"
            else -> "真北，沿用上次定位校正"
        }
        return Heading(degrees, label)
    }

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
