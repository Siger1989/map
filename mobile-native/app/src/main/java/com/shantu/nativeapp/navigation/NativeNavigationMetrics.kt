package com.shantu.nativeapp.navigation

/** Average speed from distance accepted by the live GPS guidance state and fresh-fix time only. */
fun nativeAverageSpeedKmh(gpsTravelledMeters: Double, activeFixMillis: Long): Double? {
    if (!gpsTravelledMeters.isFinite() || gpsTravelledMeters <= 0.0 || activeFixMillis < 1000L) return null
    return (gpsTravelledMeters / (activeFixMillis / 1000.0) * 3.6).takeIf { it.isFinite() }
}
