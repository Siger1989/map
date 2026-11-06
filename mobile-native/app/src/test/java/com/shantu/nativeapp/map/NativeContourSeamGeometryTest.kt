package com.shantu.nativeapp.map

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], manifest = Config.NONE)
class NativeContourSeamGeometryTest {
    @Test
    fun `separate seam crossings remain independent two point features`() {
        val crossings = listOf(
            NativeContourSeamSegment(0.1, 0.2, 0.11, 0.2, 900),
            NativeContourSeamSegment(0.12, 0.3, 0.13, 0.3, 900),
        )
        val features = NativeContourSeamGeometry.independentLines(crossings)
        assertEquals(2, features.size)
        assertTrue(features.all { it.elevationMeters == 900 && it.coordinates.size == 4 })
        assertEquals(0.1 * 360.0 - 180.0, features[0].coordinates[0], 1e-12)
        assertEquals(0.11 * 360.0 - 180.0, features[0].coordinates[2], 1e-12)
        assertEquals(0.12 * 360.0 - 180.0, features[1].coordinates[0], 1e-12)
        assertEquals(0.13 * 360.0 - 180.0, features[1].coordinates[2], 1e-12)
    }

    @Test
    fun `same lod vertical edge uses actual pixel center profiles and is order independent`() {
        val west = NativeContourTileKey(12, 1000, 1000)
        val east = NativeContourTileKey(12, 1001, 1000)
        val targetY = (1000.5) / (1 shl 12)
        val westEdges = edges(west, targetY, yGradient = true)
        val eastEdges = edges(east, targetY, yGradient = true)

        val forward = NativeContourSeamGeometry.between(west, westEdges, east, eastEdges, 30)
        val reverse = NativeContourSeamGeometry.between(east, eastEdges, west, westEdges, 30)
        assertTrue("expected contour segments across the missing inter-tile cells", forward.isNotEmpty())
        assertEquals(forward, reverse)
        assertTrue(forward.all { it.x1.isFinite() && it.y1.isFinite() && it.x2.isFinite() && it.y2.isFinite() })
        assertTrue(forward.all { it.x1 != it.x2 || it.y1 != it.y2 })
    }

    @Test
    fun `same lod horizontal edge emits contours across the north south sample gap`() {
        val north = NativeContourTileKey(12, 1000, 1000)
        val south = NativeContourTileKey(12, 1000, 1001)
        val targetX = 1000.5 / (1 shl 12)
        val northEdges = edges(north, targetX, yGradient = false)
        val southEdges = edges(south, targetX, yGradient = false)
        val seam = NativeContourSeamGeometry.between(north, northEdges, south, southEdges, 30)
        assertTrue(seam.isNotEmpty())
        val northCenter = (1001.0 - 0.5 / 256.0) / 4096.0
        val southCenter = (1001.0 + 0.5 / 256.0) / 4096.0
        assertTrue(seam.all { minOf(it.y1, it.y2) >= northCenter - 1e-10 })
        assertTrue(seam.all { maxOf(it.y1, it.y2) <= southCenter + 1e-10 })
    }

    @Test
    fun `mixed z12 to z13 edge uses the common dyadic overlap without coordinate rounding`() {
        val coarse = NativeContourTileKey(12, 1000, 1000)
        val fine = NativeContourTileKey(13, 2002, 2000)
        val targetY = 2001.0 / (1 shl 13)
        val coarseEdges = edges(coarse, targetY, yGradient = true)
        val fineEdges = edges(fine, targetY, yGradient = true)

        val seam = NativeContourSeamGeometry.between(coarse, coarseEdges, fine, fineEdges, 30)
        assertTrue("expected z12/z13 seam cells from the shared source field", seam.isNotEmpty())
        assertTrue(seam.all { it.x1.isFinite() && it.y1.isFinite() && it.x2.isFinite() && it.y2.isFinite() })
        // This is the exact pixel-center gap between the coarse east edge and fine west edge.
        val coarseCenter = (1001.0 - 0.5 / 256.0) / 4096.0
        val fineCenter = (2002.0 + 0.5 / 256.0) / 8192.0
        assertTrue(seam.all { minOf(it.x1, it.x2) >= coarseCenter - 1e-10 })
        assertTrue(seam.all { maxOf(it.x1, it.x2) <= fineCenter + 1e-10 })
        assertFalse(seam.any { it.x1 == it.x2 && it.y1 == it.y2 })
    }

    @Test
    fun `diagonal or separated tiles do not generate seam geometry`() {
        val base = NativeContourTileKey(12, 1000, 1000)
        val samples = edges(base, 0.25, yGradient = true)
        assertTrue(NativeContourSeamGeometry.between(
            base, samples, NativeContourTileKey(12, 1001, 1001), samples, 30,
        ).isEmpty())
        assertTrue(NativeContourSeamGeometry.between(
            base, samples, NativeContourTileKey(12, 1003, 1000), samples, 30,
        ).isEmpty())
    }

    private fun edges(key: NativeContourTileKey, target: Double, yGradient: Boolean): NativeContourTileEdges {
        val size = 256
        val values = DoubleArray(size * size) { index ->
            val x = index % size
            val y = index / size
            val worldX = (key.x + (x + 0.5) / size) / (1 shl key.z)
            val worldY = (key.y + (y + 0.5) / size) / (1 shl key.z)
            if (yGradient) 1000.0 + (worldY - target) * 1_000_000.0
            else 1000.0 + (worldX - target) * 1_000_000.0
        }
        return NativeContourTileEdges.fromSamples(values, size)
    }
}
