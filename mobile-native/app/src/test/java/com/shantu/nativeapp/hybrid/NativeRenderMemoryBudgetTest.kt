package com.shantu.nativeapp.map

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeRenderMemoryBudgetTest {
    @Test fun textureAllowanceKeepsLowHeapQuarterAndGrowsLargeHeapToHalfReservation() {
        assertEquals(8L * MIB, NativeRenderMemoryBudget.textureCapacityBytes(64L * MIB))
        assertEquals(8L * MIB, NativeRenderMemoryBudget.textureCapacityBytes(96L * MIB))
        assertEquals(16L * MIB, NativeRenderMemoryBudget.textureCapacityBytes(192L * MIB))
        assertEquals(383L * MIB / 12L, NativeRenderMemoryBudget.textureCapacityBytes(383L * MIB))
        assertEquals(64L * MIB, NativeRenderMemoryBudget.textureCapacityBytes(384L * MIB))
        assertEquals(96L * MIB, NativeRenderMemoryBudget.textureCapacityBytes(576L * MIB))
        assertEquals(96L * MIB, NativeRenderMemoryBudget.textureCapacityBytes(2_048L * MIB))
        assertEquals(96L * MIB, NativeRenderMemoryBudget.textureCapacityBytes(Long.MAX_VALUE))
        assertEquals(8L * MIB, NativeRenderMemoryBudget.textureCapacityBytes(Long.MIN_VALUE))
    }

    @Test fun threeSurfaceTextureReservationIsQuarterLowAndHalfLarge() {
        for (heapMib in listOf(96L, 128L, 192L, 256L, 383L)) {
            val heap = heapMib * MIB
            val reserved = NativeRenderMemoryBudget.textureCapacityBytes(heap) * 3L
            assertTrue("three surfaces must reserve at most one quarter of ${heapMib}MiB", reserved <= heap / 4L)
        }
        for (heapMib in listOf(384L, 512L, 576L, 2_048L)) {
            val heap = heapMib * MIB
            val reserved = NativeRenderMemoryBudget.textureCapacityBytes(heap) * 3L
            assertTrue("three surfaces must reserve at most one half of ${heapMib}MiB", reserved <= heap / 2L)
        }
    }

    @Test fun vectorTileBudgetUsesEightMibPerTileWithTwelveToThirtyTwoClamp() {
        assertEquals(12, NativeRenderMemoryBudget.vectorTileCount(64L * MIB))
        assertEquals(12, NativeRenderMemoryBudget.vectorTileCount(96L * MIB))
        assertEquals(24, NativeRenderMemoryBudget.vectorTileCount(192L * MIB))
        assertEquals(32, NativeRenderMemoryBudget.vectorTileCount(512L * MIB))
        assertEquals(32, NativeRenderMemoryBudget.vectorTileCount(Long.MAX_VALUE))
    }

    @Test fun composedRasterIncludesRoomForWarpAndUpload() {
        for (heap in listOf(64L, 192L, 512L, 2048L)) {
            for (tileSize in listOf(256, 512, 1024, 2048)) {
                val side = NativeRenderMemoryBudget.rasterPatchSide(heap * MIB, tileSize)
                val pixels = side.toLong() * tileSize * side * tileSize
                assertTrue(pixels <= 2048L * 2048L)
                // One source tile is the minimum, even on a small heap.
                assertTrue(pixels * 4 <= maxOf(heap * MIB / 32, tileSize.toLong() * tileSize * 4))
            }
        }
    }

    private companion object { const val MIB = 1024L * 1024L }
}
