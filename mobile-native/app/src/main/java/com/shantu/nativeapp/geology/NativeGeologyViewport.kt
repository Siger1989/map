package com.shantu.nativeapp.geology

import kotlin.math.PI
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.sin
import kotlin.math.tan
import java.lang.Math.toRadians

/** Stable, screen-independent WORLD MVT request plan for a camera viewport. */
internal data class NativeGeologyViewportPlan(val zoom: Int, val tileKeys: Set<String>)

internal fun nativeGeologyViewportPlan(
    altitudeMeters: Double,
    fieldOfViewDegrees: Double,
    viewportWidth: Int,
    viewportHeight: Int,
    latitudeDegrees: Double,
    longitudeDegrees: Double,
): NativeGeologyViewportPlan {
    val altitude = altitudeMeters.takeIf(Double::isFinite)?.coerceAtLeast(100.0) ?: 100.0
    val fov = fieldOfViewDegrees.takeIf(Double::isFinite)?.coerceIn(5.0, 120.0) ?: 45.0
    val width = viewportWidth.coerceAtLeast(1)
    val height = viewportHeight.coerceAtLeast(1)
    val groundWidth = 2.0 * altitude * tan(toRadians(fov / 2.0)) * width / height
    val zoom = floor(ln((40_075_016.0 / groundWidth.coerceAtLeast(1.0)) / 256.0) / ln(2.0) + 4.0)
        .toInt().coerceIn(0, 5)
    val matrixSize = 1 shl zoom
    val latitude = latitudeDegrees.takeIf(Double::isFinite)?.coerceIn(-85.0, 85.0) ?: 0.0
    val longitude = longitudeDegrees.takeIf(Double::isFinite)?.let { ((it + 180.0) % 360.0 + 360.0) % 360.0 - 180.0 } ?: 0.0
    val centerX = (((longitude + 180.0) / 360.0 * matrixSize).toInt()).coerceIn(0, matrixSize - 1)
    val sinLatitude = sin(toRadians(latitude))
    val centerY = ((.5 - ln((1.0 + sinLatitude) / (1.0 - sinLatitude)) / (4.0 * PI)) * matrixSize)
        .toInt().coerceIn(0, matrixSize - 1)
    val radius = if (zoom < 2) 0 else 1
    val keys = linkedSetOf<String>()
    for (dy in -radius..radius) for (dx in -radius..radius) {
        val x = Math.floorMod(centerX + dx, matrixSize)
        val y = centerY + dy
        if (y in 0 until matrixSize) keys += "$zoom/$x/$y"
    }
    return NativeGeologyViewportPlan(zoom, keys)
}
