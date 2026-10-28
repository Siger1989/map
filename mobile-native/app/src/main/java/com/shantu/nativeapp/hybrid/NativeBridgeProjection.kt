package com.shantu.nativeapp.hybrid

/** Converts the exact WorldWind WGS84 clip matrix to standard ECEF coordinates. */
internal object NativeBridgeProjection {
    /** WorldWind axes are (east, north, Greenwich); standard ECEF axes are (Greenwich, east, north). */
    private val standardEcefToWorldWind = doubleArrayOf(
        0.0, 1.0, 0.0, 0.0,
        0.0, 0.0, 1.0, 0.0,
        1.0, 0.0, 0.0, 0.0,
        0.0, 0.0, 0.0, 1.0,
    )

    /**
     * `worldWindRowMajor` is the actual DrawContext modelviewProjection from a rendered frame.
     * Both returned arrays are flattened column-major for Three.js/DOM projection consumers.
     */
    fun standardEcefMatrices(worldWindRowMajor: DoubleArray): Pair<DoubleArray, DoubleArray>? {
        if (worldWindRowMajor.size != 16 || worldWindRowMajor.any { !it.isFinite() }) return null
        val vp = multiply(worldWindRowMajor, standardEcefToWorldWind)
        val inverse = invert(vp) ?: return null
        return flattenColumnMajor(vp) to flattenColumnMajor(inverse)
    }

    private fun multiply(a: DoubleArray, b: DoubleArray): DoubleArray = DoubleArray(16) { index ->
        val row = index / 4
        val column = index % 4
        (0..3).sumOf { k -> a[row * 4 + k] * b[k * 4 + column] }
    }

    private fun invert(matrix: DoubleArray): DoubleArray? {
        val rows = Array(4) { r -> DoubleArray(8) { c ->
            when {
                c < 4 -> matrix[r * 4 + c]
                c - 4 == r -> 1.0
                else -> 0.0
            }
        } }
        for (column in 0..3) {
            val pivotRow = (column..3).maxByOrNull { kotlin.math.abs(rows[it][column]) } ?: return null
            val pivot = rows[pivotRow][column]
            if (!pivot.isFinite() || kotlin.math.abs(pivot) < 1e-18) return null
            if (pivotRow != column) {
                val swap = rows[column]
                rows[column] = rows[pivotRow]
                rows[pivotRow] = swap
            }
            val divisor = rows[column][column]
            for (j in 0..7) rows[column][j] /= divisor
            for (r in 0..3) if (r != column) {
                val factor = rows[r][column]
                for (j in 0..7) rows[r][j] -= factor * rows[column][j]
            }
        }
        return DoubleArray(16) { index -> rows[index / 4][4 + index % 4] }
            .takeIf { values -> values.all(Double::isFinite) }
    }

    private fun flattenColumnMajor(rowMajor: DoubleArray) = DoubleArray(16) { index ->
        rowMajor[(index % 4) * 4 + index / 4]
    }
}
