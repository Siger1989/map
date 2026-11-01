package com.shantu.nativeapp.map

import earth.worldwind.geom.Angle.Companion.degrees
import earth.worldwind.geom.Matrix4
import earth.worldwind.geom.Vec3
import earth.worldwind.geom.Viewport
import earth.worldwind.globe.Globe
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class NativeTileProjectionBatchTest {
    private val globe = Globe()

    @Test
    fun `batch matches SDK geographic conversion and projection for frame matrices and viewports`() {
        val cases = listOf(
            ProjectionCase(
                matrix = matrix(
                    1.0 / 6_500_000.0, 0.0, 0.0, 0.1,
                    0.0, 1.0 / 6_500_000.0, 0.0, -0.2,
                    0.0, 0.0, 0.0, 0.0,
                    0.0, 0.0, 0.0, 1.0,
                ),
                viewport = Viewport(0, 0, 390, 857),
            ),
            ProjectionCase(
                matrix = matrix(
                    0.0, 1.0 / 6_500_000.0, 0.0, -0.15,
                    -1.0 / 6_500_000.0, 0.0, 0.0, 0.25,
                    0.0, 0.0, 0.0, 0.0,
                    0.0, 0.0, 0.0, 1.0,
                ),
                viewport = Viewport(13, 29, 512, 384),
            ),
            ProjectionCase(
                matrix = matrix(
                    1.0 / 7_000_000.0, 0.0, 0.0, 0.05,
                    0.0, 1.0 / 7_000_000.0, 0.0, 0.1,
                    0.0, 0.0, 0.0, 0.0,
                    1.0 / 20_000_000.0, 0.0, 0.0, 1.0,
                ),
                viewport = Viewport(-7, 5, 720, 480),
            ),
        )
        val coordinates = listOf(
            0.0 to 0.0,
            30.5728 to 104.0668,
            -45.25 to 151.2,
            67.0 to -179.5,
            12.0 to 541.25, // exercises the same longitude wrapping used by the controller
        )

        for (case in cases) {
            val batch = NativeTileProjectionBatch(case.matrix, case.viewport, globe)
            for ((latitude, longitude) in coordinates) {
                val expected = sdkProject(case.matrix, case.viewport, latitude, longitude)
                val actual = batch.project(latitude, longitude)
                if (expected == null) {
                    assertNull("$latitude,$longitude with $case", actual)
                } else {
                    assertEquals(expected.x, actual?.x ?: Double.NaN, 1e-9)
                    assertEquals(expected.y, actual?.y ?: Double.NaN, 1e-9)
                }
            }
        }
    }

    @Test
    fun `near and far clipping matches SDK inclusive clip interval`() {
        val viewport = Viewport(4, 9, 320, 240)
        for (clipZ in listOf(-1.0, 1.0)) {
            val mvp = matrix(
                1.0 / 7_000_000.0, 0.0, 0.0, 0.0,
                0.0, 1.0 / 7_000_000.0, 0.0, 0.0,
                0.0, 0.0, 0.0, clipZ,
                0.0, 0.0, 0.0, 1.0,
            )
            assertEquals(sdkProject(mvp, viewport, 0.0, 0.0), NativeTileProjectionBatch(mvp, viewport, globe).project(0.0, 0.0))
        }
        for (clipZ in listOf(-1.0001, 1.0001)) {
            val mvp = matrix(
                1.0 / 7_000_000.0, 0.0, 0.0, 0.0,
                0.0, 1.0 / 7_000_000.0, 0.0, 0.0,
                0.0, 0.0, 0.0, clipZ,
                0.0, 0.0, 0.0, 1.0,
            )
            assertNull(NativeTileProjectionBatch(mvp, viewport, globe).project(0.0, 0.0))
        }
    }

    @Test
    fun `negative homogeneous W follows SDK projection behavior`() {
        val viewport = Viewport(0, 0, 400, 300)
        val mvp = matrix(
            1.0 / 7_000_000.0, 0.0, 0.0, 0.0,
            0.0, 1.0 / 7_000_000.0, 0.0, 0.0,
            0.0, 0.0, 0.0, 0.0,
            0.0, 0.0, 0.0, -1.0,
        )
        assertEquals(sdkProject(mvp, viewport, 0.0, 0.0), NativeTileProjectionBatch(mvp, viewport, globe).project(0.0, 0.0))
    }

    @Test
    fun `invalid matrix viewport and coordinates are rejected`() {
        assertThrows(IllegalArgumentException::class.java) {
            NativeTileProjectionBatch(DoubleArray(15), Viewport(0, 0, 1, 1), globe)
        }
        assertThrows(IllegalArgumentException::class.java) {
            NativeTileProjectionBatch(DoubleArray(16) { if (it == 0) Double.NaN else 0.0 }, Viewport(0, 0, 1, 1), globe)
        }
        assertThrows(IllegalArgumentException::class.java) {
            NativeTileProjectionBatch(identity(), Viewport(0, 0, 0, 1), globe)
        }
        val batch = NativeTileProjectionBatch(identity(), Viewport(0, 0, 1, 1), globe)
        assertNull(batch.project(Double.NaN, 0.0))
        assertNull(batch.project(90.01, 0.0))
        assertNull(batch.project(0.0, Double.POSITIVE_INFINITY))
    }

    private fun sdkProject(matrix: DoubleArray, viewport: Viewport, latitude: Double, longitude: Double): TileScreenPoint? {
        val globePoint = Vec3()
        globe.geographicToCartesian(latitude.degrees, longitude.wrapLongitude().degrees, 0.0, globePoint)
        val projected = Vec3()
        if (!Matrix4().apply { matrix.copyInto(m) }.project(globePoint.x, globePoint.y, globePoint.z, viewport, projected)) {
            return null
        }
        val y = viewport.height - projected.y
        return if (projected.x.isFinite() && y.isFinite()) TileScreenPoint(projected.x, y) else null
    }

    private fun matrix(vararg components: Double): DoubleArray = components.also { require(it.size == 16) }

    private fun identity() = doubleArrayOf(
        1.0, 0.0, 0.0, 0.0,
        0.0, 1.0, 0.0, 0.0,
        0.0, 0.0, 1.0, 0.0,
        0.0, 0.0, 0.0, 1.0,
    )

    private fun Double.wrapLongitude() = (((this + 180.0) % 360.0 + 360.0) % 360.0) - 180.0

    private data class ProjectionCase(val matrix: DoubleArray, val viewport: Viewport)
}
