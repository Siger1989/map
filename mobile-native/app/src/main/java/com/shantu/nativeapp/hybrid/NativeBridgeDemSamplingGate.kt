package com.shantu.nativeapp.hybrid

/** State gate for viewport DEM planning. It distinguishes viewport changes from DEM revisions. */
internal class NativeBridgeDemSamplingGate {
    enum class Decision { PLAN, ACTIVE_SAME_VIEW, RETRY_WINDOW, THROTTLED }

    data class Inputs(
        val camera: String,
        val viewportWidth: Int,
        val viewportHeight: Int,
        val cssScale: Double,
        val terrainEnabled: Boolean,
        val exaggeration: Double,
        val demRevision: Long,
    ) {
        fun geometryFingerprint(): String = listOf(
            camera,
            "${viewportWidth}x${viewportHeight}",
            cssScale.toString(),
            terrainEnabled.toString(),
            exaggeration.toString(),
        ).joinToString("|")

        fun fingerprint(): String = "${geometryFingerprint()}|$demRevision"
    }

    private var activeInputKey: String? = null
    private var activeGeometryKey: String? = null
    private var pendingInputKey: String? = null
    private var retryInputKey: String? = null
    private var retryAfterMillis: Long = 0L
    private var lastPlanAtMillis: Long = Long.MIN_VALUE / 2

    /** Same-view DEM revisions wait for active sampling; a new view can supersede that job. */
    fun evaluate(inputKey: String, geometryKey: String, nowMillis: Long, jobActive: Boolean): Decision {
        if (jobActive && geometryKey == activeGeometryKey) {
            pendingInputKey = inputKey.takeIf { it != activeInputKey }
            return Decision.ACTIVE_SAME_VIEW
        }
        if (inputKey == retryInputKey && nowMillis < retryAfterMillis) return Decision.RETRY_WINDOW
        if (nowMillis - lastPlanAtMillis < MINIMUM_INTERVAL_MILLIS) {
            if (jobActive && geometryKey == activeGeometryKey) pendingInputKey = inputKey
            return Decision.THROTTLED
        }
        return Decision.PLAN
    }

    /** Called immediately before computing a real viewport footprint. */
    fun begin(inputKey: String, geometryKey: String, nowMillis: Long) {
        activeInputKey = inputKey
        activeGeometryKey = geometryKey
        pendingInputKey = null
        lastPlanAtMillis = nowMillis
    }

    /** Only the currently active attempt may settle the gate; superseded jobs cannot clear it. */
    fun finish(inputKey: String, nowMillis: Long, retryDelayMillis: Long): String? {
        if (activeInputKey != inputKey) return null
        activeInputKey = null
        activeGeometryKey = null
        retryInputKey = inputKey
        retryAfterMillis = nowMillis + retryDelayMillis.coerceAtLeast(0L)
        val pending = pendingInputKey?.takeIf { it != inputKey }
        pendingInputKey = null
        return pending
    }

    /** Reuse an already-fresh tile plan without extending its original cache lifetime. */
    fun settleOnExistingCache(inputKey: String, nowMillis: Long, retryUntilMillis: Long): String? {
        if (activeInputKey == inputKey) {
            activeInputKey = null
            activeGeometryKey = null
        }
        retryInputKey = inputKey
        retryAfterMillis = retryUntilMillis
        lastPlanAtMillis = nowMillis
        val pending = pendingInputKey?.takeIf { it != inputKey }
        pendingInputKey = null
        return pending
    }

    fun notePending(inputKey: String) {
        pendingInputKey = inputKey.takeIf { it != activeInputKey }
    }

    fun pendingInputKey(): String? = pendingInputKey

    companion object {
        const val MINIMUM_INTERVAL_MILLIS = 250L
        const val PARTIAL_RETRY_MILLIS = 5_000L
        const val COMPLETE_REFRESH_MILLIS = 30_000L

        /** Stable camera key: sub-metre center noise and sub-pixel zoom jitter are ignored. */
        fun cameraFingerprint(longitude: Double, latitude: Double, zoom: Double, pitch: Double, bearing: Double): String =
            listOf(
                quantize(longitude, 1_000_000.0),
                quantize(latitude, 1_000_000.0),
                quantize(zoom, 100_000.0),
                quantize(pitch, 10_000.0),
                quantize(bearing, 10_000.0),
            ).joinToString(",")

        private fun quantize(value: Double, scale: Double): Double {
            if (!value.isFinite()) return value
            val rounded = kotlin.math.round(value * scale) / scale
            return if (rounded == 0.0) 0.0 else rounded
        }
    }
}
