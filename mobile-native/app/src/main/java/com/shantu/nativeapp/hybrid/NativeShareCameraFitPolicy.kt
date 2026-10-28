package com.shantu.nativeapp.hybrid

import com.shantu.nativeapp.map.NativeCameraSnapshot
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.tan

/** Matches the web route-share fit's maxZoom=16 using the bridge's 45-degree camera scale. */
internal object NativeShareCameraFitPolicy {
    const val MAX_ZOOM = 16
    private const val EARTH_CIRCUMFERENCE_METERS = 40_075_016.68557849
    private const val TILE_SIZE = 512.0
    private const val VERTICAL_FOV_DEGREES = 45.0

    fun applyMaxZoom(camera: NativeCameraSnapshot, viewportHeightPx: Int): NativeCameraSnapshot {
        require(viewportHeightPx > 0)
        val minRange = rangeAtZoom(MAX_ZOOM.toDouble(), camera.latitude, viewportHeightPx)
        return camera.copy(rangeMeters = maxOf(camera.rangeMeters, minRange))
    }

    fun rangeAtZoom(zoom: Double, latitude: Double, viewportHeightPx: Int): Double {
        require(zoom.isFinite() && zoom in 0.0..24.0)
        require(latitude.isFinite() && latitude in -90.0..90.0)
        require(viewportHeightPx > 0)
        val worldPixels = TILE_SIZE * 2.0.pow(zoom)
        val verticalGroundSpan = EARTH_CIRCUMFERENCE_METERS * cos(Math.toRadians(latitude)) * viewportHeightPx / worldPixels
        return verticalGroundSpan / (2.0 * tan(Math.toRadians(VERTICAL_FOV_DEGREES) / 2.0))
    }
}
