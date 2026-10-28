package com.shantu.nativeapp.map

import earth.worldwind.render.image.ArgbImage
import earth.worldwind.render.image.toImageSource
import kotlin.math.*

enum class NativeDirectionMode { FREE, NORTH, DEVICE, MOTION }
enum class NativeHeadingSource { GPS_COURSE, DEVICE_COMPASS, MOTION }

data class NativePositionFix(val latitude: Double, val longitude: Double, val accuracyMeters: Double, val timestampMillis: Long, val provider: String = "gps", val speedMetersPerSecond: Double? = null, val courseDegrees: Double? = null, val courseAccuracyDegrees: Double? = null)
data class NativePositionState(val fix: NativePositionFix?, val nowMillis: Long, val headingDegrees: Double? = null, val headingSource: NativeHeadingSource? = null, val headingTimestampMillis: Long? = null, val headingAccuracyDegrees: Double? = null, val mode: NativeDirectionMode = NativeDirectionMode.FREE)
data class NativePositionPresentation(val visible: Boolean, val accuracyMeters: Double?, val headingDegrees: Double?, val headingStale: Boolean, val status: String)

/** Pure policy shared by the native host and map renderer. Route geometry is never an input. */
internal object NativePositionPolicy {
    fun present(state: NativePositionState): NativePositionPresentation {
        val f = state.fix ?: return NativePositionPresentation(false, null, null, true, "等待定位")
        val age = state.nowMillis - f.timestampMillis
        if (!f.latitude.isFinite() || f.latitude !in -90.0..90.0 || !f.longitude.isFinite() || f.longitude !in -180.0..180.0 || !f.accuracyMeters.isFinite() || f.accuracyMeters < 0 || age < -3000 || age > 30_000)
            return NativePositionPresentation(false, null, null, true, "定位已过期")
        val recentHeading = state.headingDegrees?.takeIf { it.isFinite() && it in 0.0..<360.0 && state.headingTimestampMillis != null && state.nowMillis - state.headingTimestampMillis in 0..3000 && (state.headingAccuracyDegrees == null || state.headingAccuracyDegrees.isFinite() && state.headingAccuracyDegrees in 0.0..45.0) }
        val speed = f.speedMetersPerSecond?.takeIf { it.isFinite() }
        val course = f.courseDegrees?.takeIf {
            it.isFinite() && it in 0.0..<360.0 && f.provider != "ip" && f.provider != "network" &&
                speed != null && speed in 1.5..80.0 && f.accuracyMeters <= 25.0 &&
                (f.courseAccuracyDegrees?.let { a -> a.isFinite() && a in 0.0..25.0 } ?: (f.accuracyMeters <= 12.0 && speed >= 2.2))
        }
        // Camera orientation mode is deliberately orthogonal to the location arrow.
        // A phone compass changes the camera, never the arrow. Arrow orientation needs
        // fresh, accurate GPS course or a host-computed motion heading.
        val heading = course ?: recentHeading?.takeIf { (state.headingSource == NativeHeadingSource.MOTION || state.headingSource == NativeHeadingSource.GPS_COURSE) && f.provider !in listOf("ip","network") && f.accuracyMeters<=30 && (speed==null||speed in .5..80.0) }
        val stale = heading == null
        return NativePositionPresentation(true, f.accuracyMeters.coerceAtMost(50_000.0), heading, stale, if (stale) "等待可信方向" else "")
    }
}

/** North-up transparent arrow texture; Placemark rotates it relative to the globe. */
internal fun nativePositionArrowImage() = ArgbImage(32, 32, IntArray(32 * 32).also { pixels ->
    for (y in 2..29) {
        val halfWidth = when {
            y < 15 -> ((y - 2) * 0.72 + 1).toInt()
            else -> 4
        }
        for (x in (16 - halfWidth).coerceAtLeast(0)..(16 + halfWidth).coerceAtMost(31)) {
            val edge = x == 16 - halfWidth || x == 16 + halfWidth || y == 2 || y == 29
            pixels[y * 32 + x] = if (edge) 0xff064a83.toInt() else 0xff168fff.toInt()
        }
    }
}).toImageSource()
