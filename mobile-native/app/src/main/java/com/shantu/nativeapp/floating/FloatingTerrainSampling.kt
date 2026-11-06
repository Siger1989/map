package com.shantu.nativeapp.floating

import com.shantu.nativeapp.map.bilinearElevation
import kotlin.math.floor

/** Pure XYZ/sample-center operations shared by the DEM loader and deterministic tests. */
internal object FloatingTerrainSampling {
    fun visibleTileIds(z: Int, centerX: Int, centerY: Int): List<Pair<Int, Int>> {
        require(z in FloatingTerrainSource.MIN_ZOOM..FloatingTerrainSource.MAX_ZOOM)
        val n = 1 shl z
        require(centerX in 0 until n && centerY in 0 until n)
        return (-1..1).flatMap { dy -> (-1..1).map { dx ->
            Math.floorMod(centerX + dx, n) to (centerY + dy).coerceIn(0, n - 1)
        } }.distinct().sortedBy { (x, y) ->
            val dx = wrappedDeltaX(x, centerX, n)
            dx * dx + (y - centerY) * (y - centerY)
        }
    }

    /** Input and output cells denote pixel/sample centers, never tile-edge vertices. */
    fun resampleCenters(input: DoubleArray, inputSide: Int, outputSide: Int): DoubleArray {
        require(inputSide >= 2 && outputSide >= 2 && input.size == inputSide * inputSide)
        val output = DoubleArray(outputSide * outputSide)
        for (row in 0 until outputSide) {
            val y = (row + .5) * inputSide / outputSide - .5
            for (column in 0 until outputSide) {
                val x = (column + .5) * inputSide / outputSide - .5
                output[row * outputSide + column] = interpolate(input, inputSide, x, y)
            }
        }
        return output
    }

    /** Crop a z13 sample-center grid into one child tile, preserving nodata as NaN. */
    fun cropParentCenters(parent: DoubleArray, parentX: Int, parentY: Int, scale: Int): DoubleArray {
        require(parent.size == 256 * 256 && scale in 2..8 && parentX in 0 until scale && parentY in 0 until scale)
        val outputSide = FloatingTerrainSource.GRID_SIDE
        val output = DoubleArray(outputSide * outputSide)
        for (row in 0 until outputSide) {
            val v = (row + .5) / outputSide
            val sourceY = ((parentY + v) * 256.0 / scale - .5).coerceIn(0.0, 255.0)
            for (column in 0 until outputSide) {
                val u = (column + .5) / outputSide
                val sourceX = ((parentX + u) * 256.0 / scale - .5).coerceIn(0.0, 255.0)
                output[row * outputSide + column] = interpolate(parent, 256, sourceX, sourceY)
            }
        }
        return output
    }

    private fun interpolate(values: DoubleArray, side: Int, x: Double, y: Double): Double {
        val floorX = floor(x)
        val floorY = floor(y)
        val x0 = floorX.toInt().coerceIn(0, side - 1)
        val y0 = floorY.toInt().coerceIn(0, side - 1)
        val x1 = (x0 + 1).coerceAtMost(side - 1)
        val y1 = (y0 + 1).coerceAtMost(side - 1)
        val fx = (x - floorX).coerceIn(0.0, 1.0)
        val fy = (y - floorY).coerceIn(0.0, 1.0)
        fun at(px: Int, py: Int) = values[py * side + px].takeIf(Double::isFinite)
        return bilinearElevation(at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1), fx, fy)
    }

    private fun wrappedDeltaX(x: Int, centerX: Int, n: Int): Int {
        val delta = x - centerX
        return when {
            delta > n / 2 -> delta - n
            delta < -n / 2 -> delta + n
            else -> delta
        }
    }
}
