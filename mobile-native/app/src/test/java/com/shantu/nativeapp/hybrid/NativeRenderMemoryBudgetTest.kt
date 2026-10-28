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

    private companion object { const val MIB = 1024L * 1024L }
}
