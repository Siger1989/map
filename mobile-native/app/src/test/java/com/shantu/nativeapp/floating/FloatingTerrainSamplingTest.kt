package com.shantu.nativeapp.floating

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FloatingTerrainSamplingTest {
    @Test fun resamplingAlignsSampleCentersAndPreservesNodata() {
        val source = DoubleArray(16) { index -> (index % 4) + 10.0 * (index / 4) }
        val sampled = FloatingTerrainSampling.resampleCenters(source, 4, 2)
        assertEquals(5.5, sampled[0], 1e-9)
        assertEquals(7.5, sampled[1], 1e-9)
        assertEquals(25.5, sampled[2], 1e-9)
        assertEquals(27.5, sampled[3], 1e-9)

        val missing = FloatingTerrainSampling.resampleCenters(DoubleArray(16) { Double.NaN }, 4, 2)
        assertTrue(missing.all { it.isNaN() })
    }

    @Test fun childCropUsesCenterSamplesWithinItsParentAndDoesNotInventMissingHeight() {
        val parent = DoubleArray(256 * 256) { index -> (index % 256) + (index / 256) * 256.0 }
        val child = FloatingTerrainSampling.cropParentCenters(parent, parentX = 1, parentY = 0, scale = 2)
        val firstX = (1 + .5 / 33.0) * 128.0 - .5
        val firstY = (.5 / 33.0) * 128.0 - .5
        assertEquals(firstX + firstY * 256.0, child.first(), 1e-6)
        assertTrue(child.last() < 256.0 + 126.0 * 256.0)

        val nodata = DoubleArray(256 * 256) { Double.NaN }
        val missing = FloatingTerrainSampling.cropParentCenters(nodata, 0, 0, 2)
        assertTrue(missing.all { it.isNaN() })
    }

    @Test fun visibleNeighborsWrapLongitudeClampMercatorEdgesAndPrioritizeCenter() {
        val n = 1 shl 13
        val middle = FloatingTerrainSampling.visibleTileIds(13, 200, 300)
        assertEquals(9, middle.size)
        assertEquals(9, middle.distinct().size)
        assertEquals(200 to 300, middle.first())

        val edge = FloatingTerrainSampling.visibleTileIds(13, 0, 0)
        assertEquals(6, edge.size)
        assertTrue(edge.any { it.first == n - 1 })
        assertFalse(edge.any { it.second < 0 })
        assertFalse(edge.any { it.second >= n })
    }
}
