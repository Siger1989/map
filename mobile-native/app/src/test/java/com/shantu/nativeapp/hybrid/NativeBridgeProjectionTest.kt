package com.shantu.nativeapp.hybrid

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test

class NativeBridgeProjectionTest {
    @Test
    fun `identity WorldWind clip frame is remapped from WW axes to standard ECEF`() {
        val matrices = NativeBridgeProjection.standardEcefMatrices(identity())
        assertNotNull(matrices)
        val (vp, inverse) = matrices!!
        assertEquals(0.0, transform(vp, doubleArrayOf(1.0, 0.0, 0.0, 1.0))[0], 0.0)
        assertEquals(0.0, transform(vp, doubleArrayOf(1.0, 0.0, 0.0, 1.0))[1], 0.0)
        assertEquals(1.0, transform(vp, doubleArrayOf(1.0, 0.0, 0.0, 1.0))[2], 0.0)
        assertIdentity(multiply(vp, inverse))
    }

    @Test
    fun `inverse and column-major conversion roundtrip a nontrivial clip transform`() {
        val worldWind = doubleArrayOf(
            2.0, 0.0, 0.0, 4.0,
            0.0, 3.0, 0.0, -2.0,
            0.0, 0.0, 0.5, 1.0,
            0.0, 0.0, 0.0, 1.0,
        )
        val matrices = NativeBridgeProjection.standardEcefMatrices(worldWind)
        assertNotNull(matrices)
        val (vp, inverse) = matrices!!
        assertIdentity(multiply(vp, inverse))
        assertIdentity(multiply(inverse, vp))
    }

    @Test
    fun `singular or malformed frame never yields a fake projection`() {
        assertEquals(null, NativeBridgeProjection.standardEcefMatrices(DoubleArray(15)))
        assertEquals(null, NativeBridgeProjection.standardEcefMatrices(DoubleArray(16)))
    }

    private fun identity() = doubleArrayOf(
        1.0, 0.0, 0.0, 0.0,
        0.0, 1.0, 0.0, 0.0,
        0.0, 0.0, 1.0, 0.0,
        0.0, 0.0, 0.0, 1.0,
    )

    /** Inputs and outputs use column-major arrays, like the JavaScript consumer. */
    private fun multiply(a: DoubleArray, b: DoubleArray): DoubleArray = DoubleArray(16) { index ->
        val row = index % 4
        val col = index / 4
        (0..3).sumOf { k -> a[k * 4 + row] * b[col * 4 + k] }
    }

    private fun transform(m: DoubleArray, p: DoubleArray) = DoubleArray(4) { row ->
        (0..3).sumOf { col -> m[col * 4 + row] * p[col] }
    }

    private fun assertIdentity(m: DoubleArray) {
        for (row in 0..3) for (col in 0..3) {
            assertEquals(if (row == col) 1.0 else 0.0, m[col * 4 + row], 1e-9)
        }
    }
}
