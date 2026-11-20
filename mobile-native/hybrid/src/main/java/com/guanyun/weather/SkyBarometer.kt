package com.guanyun.weather

import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.pow

/** Relative pressure changes anchored to this observation's known absolute elevation. */
internal class SkyBarometer {
    private data class Reference(val latitude: Double, val longitude: Double, val altitude: Double, val source: String)
    private data class Calibration(val reference: Reference, val pressure: Double)
    data class Reading(val altitudeMeters: Double, val source: String)

    private var reference: Reference? = null
    private var calibration: Calibration? = null
    private var filteredAltitude: Double? = null
    private var reported: Reading? = null

    fun reference(latitude: Double, longitude: Double, altitude: Double, source: String): Boolean {
        if (latitude !in -90.0..90.0 || longitude !in -180.0..180.0 || altitude !in -500.0..12_000.0 ||
            (source != "gps-msl" && source != "dem-eye")) {
            val hadReference = reference != null
            clear()
            return hadReference
        }
        val current = Reference(latitude, longitude, altitude, source)
        reference = current
        val prior = calibration?.reference ?: return false
        val east = ((longitude - prior.longitude + 540) % 360 - 180) * cos(Math.toRadians(latitude))
        if (prior.source == source && hypot(latitude - prior.latitude, east) * 111_320 < 100) return false
        resetMeasurements()
        return true
    }

    fun pressure(hPa: Double): Reading? {
        val anchor = reference ?: return null
        if (hPa !in 200.0..1120.0) return null
        val baseline = calibration ?: Calibration(anchor, hPa).also { calibration = it }
        val change = 44_330.0 * (1 - (hPa / baseline.pressure).pow(0.190294957))
        if (abs(change) > 500) return null
        val measured = baseline.reference.altitude + change
        val smoothed = filteredAltitude?.let { it + (measured - it) * 0.35 } ?: measured
        filteredAltitude = smoothed
        if (reported?.let { abs(it.altitudeMeters - smoothed) < 0.6 } == true) return null
        return Reading(smoothed, "barometer-${baseline.reference.source}").also { reported = it }
    }

    fun resetMeasurements() {
        calibration = null
        filteredAltitude = null
        reported = null
    }

    fun clear() {
        reference = null
        resetMeasurements()
    }
}
