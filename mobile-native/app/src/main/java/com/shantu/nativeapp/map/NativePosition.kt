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
    // Use the full texture width for the arrowhead and keep the lower notch visible,
    // matching the broad location-arrow silhouette used by the web map.
    val outer = listOf(16 to 1, 31 to 29, 16 to 23, 1 to 29)
    val inner = listOf(16 to 6, 26 to 26, 16 to 21, 6 to 26)
    fun contains(x: Double, y: Double, polygon: List<Pair<Int, Int>>): Boolean {
        var inside = false
        var j = polygon.lastIndex
        for (i in polygon.indices) {
            val (xi, yi) = polygon[i]
            val (xj, yj) = polygon[j]
            if ((yi > y) != (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside
            j = i
        }
        return inside
    }
    for (y in 0 until 32) for (x in 0 until 32) {
        val px = x + 0.5; val py = y + 0.5
        if (contains(px, py, outer)) {
            pixels[y * 32 + x] = if (contains(px, py, inner)) 0xff168fff.toInt() else 0xff064a83.toInt()
        }
    }
}).toImageSource()

/** Keep the location heading glyph at a stable UI size on high-density hybrid viewports. */
internal fun nativePositionArrowScale(cssScale: Double): Double =
    24.0 / 32.0 * (cssScale.takeIf { it.isFinite() && it > 0.0 } ?: 1.0)
