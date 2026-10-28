package com.shantu.nativeapp.navigation

import com.shantu.nativeapp.map.NativeCameraSnapshot
import kotlin.math.*

/** Pure, conservative camera fit for a WGS84 route. Call on the UI thread when restoring the result. */
object NativeRouteViewport {
    private const val EARTH_RADIUS_METERS = 6_371_008.8
    private const val MIN_RANGE_METERS = 500.0
    private const val MAX_RANGE_METERS = 25_000_000.0

    /**
     * Computes a top-down camera centered on the shortest longitude arc containing all points.
     * `verticalFovDegrees` should match the map camera's actual vertical field of view.
     */
    fun fit(
        coordinates: List<NativeCoordinate>,
        current: NativeCameraSnapshot,
        viewportWidthPx: Int,
        viewportHeightPx: Int,
        verticalFovDegrees: Double = 45.0,
    ): NativeCameraSnapshot {
        require(coordinates.isNotEmpty() && coordinates.size <= 100_000) { "route coordinates are empty or too many" }
        require(viewportWidthPx > 0 && viewportHeightPx > 0) { "viewport size must be positive" }
        require(verticalFovDegrees.isFinite() && verticalFovDegrees in 10.0..120.0) { "invalid camera field of view" }
        coordinates.forEach { point ->
            require(point.longitude.isFinite() && point.longitude in -180.0..180.0 && point.latitude.isFinite() && point.latitude in -90.0..90.0) {
                "route coordinates must be WGS84"
            }
        }

        val latitudes = coordinates.map { it.latitude }
        val latMin = latitudes.minOrNull()!!
        val latMax = latitudes.maxOrNull()!!
        val latCenter = (latMin + latMax) / 2.0
        val (lonCenter, longitudeSpan) = shortestLongitudeBounds(coordinates.map { it.longitude })
        val radians = PI / 180.0
        val heightMeters = (latMax - latMin) * radians * EARTH_RADIUS_METERS
        val widthMeters = longitudeSpan * radians * EARTH_RADIUS_METERS * cos(latCenter * radians).absoluteValue
        val halfFovTangent = tan(verticalFovDegrees * radians / 2.0)
        val aspect = viewportWidthPx.toDouble() / viewportHeightPx.toDouble()
        val requiredRange = max(heightMeters / 2.0, widthMeters / (2.0 * aspect)) / halfFovTangent * 1.25
        val range = requiredRange.coerceIn(MIN_RANGE_METERS, MAX_RANGE_METERS)
        return NativeCameraSnapshot(
            latitude = latCenter,
            longitude = lonCenter,
            rangeMeters = range,
            headingDegrees = 0.0,
            pitchDegrees = 0.0,
            rollDegrees = 0.0,
        )
    }

    private fun shortestLongitudeBounds(longitudes: List<Double>): Pair<Double, Double> {
        val values = longitudes.map { (it + 360.0) % 360.0 }.sorted()
        if (values.size == 1) return wrap(values[0]) to 0.0
        var largestGap = -1.0
        var gapIndex = 0
        for (i in values.indices) {
            val next = if (i == values.lastIndex) values[0] + 360.0 else values[i + 1]
            val gap = next - values[i]
            if (gap > largestGap) { largestGap = gap; gapIndex = i }
        }
        val west = values[(gapIndex + 1) % values.size]
        val east = values[gapIndex].let { if (it < west) it + 360.0 else it }
        val span = (east - west).coerceAtLeast(0.0)
        return wrap(west + span / 2.0) to span
    }

    private fun wrap(longitude: Double): Double {
        val normalized = ((longitude + 180.0) % 360.0 + 360.0) % 360.0 - 180.0
        return if (normalized == -180.0 && longitude > 0.0) 180.0 else normalized
    }
}
