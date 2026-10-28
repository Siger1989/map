package com.shantu.nativeapp.hybrid

import org.json.JSONArray

// The camera fitter already enforces a 500 m minimum range. This epsilon only
// makes degenerate extents non-zero for bounds consumers; it must not drive fit.
private const val SHARE_ZERO_AXIS_SPAN_DEGREES = 0.000001

/** Parses the original [southwest,northeast] wire bounds and pads only degenerate fit axes. */
internal fun parseNativeShareFitBounds(value: JSONArray): DoubleArray {
    require(value.length() == 2) { "分享范围无效" }
    val southwest = value.optJSONArray(0) ?: throw IllegalArgumentException("分享范围无效")
    val northeast = value.optJSONArray(1) ?: throw IllegalArgumentException("分享范围无效")
    require(southwest.length() >= 2 && northeast.length() >= 2) { "分享范围无效" }
    val west = southwest.optDouble(0, Double.NaN)
    val south = southwest.optDouble(1, Double.NaN)
    val east = northeast.optDouble(0, Double.NaN)
    val north = northeast.optDouble(1, Double.NaN)
    require(listOf(west, south, east, north).all(Double::isFinite) &&
        west in -180.0..180.0 && east in -180.0..180.0 &&
        south in -85.0..85.0 && north in -85.0..85.0 && west <= east && south <= north) {
        "分享范围无效"
    }

    val longitude = if (west == east) padDegenerateAxis(west, -180.0, 180.0) else west to east
    val latitude = if (south == north) padDegenerateAxis(south, -85.0, 85.0) else south to north
    return doubleArrayOf(longitude.first, latitude.first, longitude.second, latitude.second)
}

private fun padDegenerateAxis(value: Double, minimum: Double, maximum: Double): Pair<Double, Double> {
    val halfSpan = SHARE_ZERO_AXIS_SPAN_DEGREES / 2.0
    var low = maxOf(minimum, value - halfSpan)
    var high = minOf(maximum, value + halfSpan)
    if (high - low < SHARE_ZERO_AXIS_SPAN_DEGREES) {
        if (low == minimum) high = minOf(maximum, low + SHARE_ZERO_AXIS_SPAN_DEGREES)
        else if (high == maximum) low = maxOf(minimum, high - SHARE_ZERO_AXIS_SPAN_DEGREES)
    }
    require(high > low) { "分享范围无效" }
    return low to high
}
