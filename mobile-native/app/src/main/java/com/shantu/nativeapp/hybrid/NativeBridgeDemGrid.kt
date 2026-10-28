package com.shantu.nativeapp.hybrid

import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.sinh
import kotlin.math.tan
import kotlin.math.PI
import kotlin.math.sqrt

/** Reprojects a real Web-Mercator DEM raster into the lon/lat regular grid consumed by React. */
internal object NativeBridgeDemGrid {
    data class Grid(val west: Double, val south: Double, val east: Double, val north: Double,
        val width: Int, val height: Int, val heights: List<Double?>)

    fun fromMercatorPixels(z: Int, x: Int, y: Int, pixels: DoubleArray, size: Int = 64): Grid? {
        val pixelSize = sqrt(pixels.size.toDouble()).toInt()
        if (z !in 0..13 || x !in 0 until (1 shl z) || y !in 0 until (1 shl z) ||
            pixelSize < 2 || pixelSize * pixelSize != pixels.size || size !in 2..128) return null
        val side = 1 shl z
        val westEdge = x.toDouble() / side * 360.0 - 180.0
        val eastEdge = (x + 1.0) / side * 360.0 - 180.0
        fun latitudeAtPixel(globalPixelY: Double): Double = Math.toDegrees(kotlin.math.atan(sinh(PI * (1.0 - 2.0 * globalPixelY / (pixelSize * side)))))
        fun mercatorPixelY(latitude: Double): Double {
            val radians = Math.toRadians(latitude.coerceIn(-85.05112878, 85.05112878))
            return (1.0 - ln(tan(PI / 4 + radians / 2)) / PI) / 2 * side * pixelSize - y * pixelSize - .5
        }
        fun sample(px: Double, py: Double): Double? {
            val x0 = floor(px).toInt().coerceIn(0, pixelSize - 1); val y0 = floor(py).toInt().coerceIn(0, pixelSize - 1)
            val x1 = (x0 + 1).coerceAtMost(pixelSize - 1); val y1 = (y0 + 1).coerceAtMost(pixelSize - 1)
            val v00 = pixels[y0 * pixelSize + x0]; val v10 = pixels[y0 * pixelSize + x1]
            val v01 = pixels[y1 * pixelSize + x0]; val v11 = pixels[y1 * pixelSize + x1]
            if (!v00.isFinite() || !v10.isFinite() || !v01.isFinite() || !v11.isFinite()) return null
            val fx = (px - floor(px)).coerceIn(0.0, 1.0); val fy = (py - floor(py)).coerceIn(0.0, 1.0)
            return (v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy
        }
        val west = westEdge + .5 / (side * pixelSize.toDouble()) * 360.0
        val east = eastEdge - .5 / (side * pixelSize.toDouble()) * 360.0
        val north = latitudeAtPixel(y * pixelSize + .5)
        val south = latitudeAtPixel((y + 1.0) * pixelSize - .5)
        val result = ArrayList<Double?>(size * size)
        for (row in 0 until size) for (col in 0 until size) {
            val lon = west + (east - west) * col / (size - 1)
            val lat = north + (south - north) * row / (size - 1)
            val px = (lon + 180.0) / 360.0 * side * pixelSize - x * pixelSize - .5
            result += sample(px, mercatorPixelY(lat))
        }
        return Grid(west, south, east, north, size, size, result)
    }
}
