package com.shantu.nativeapp.map

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeRenderMemoryBudgetTest {
    @Test fun renderBudgetUsesDeviceMemoryWithoutPreallocatingOrChangingLowRamFallback() {
        assertEquals(256L * MIB, NativeRenderMemoryBudget.textureCapacityBytes(512L * MIB, 4096L * MIB))
        assertEquals(512L * MIB, NativeRenderMemoryBudget.textureCapacityBytes(512L * MIB, 16384L * MIB))
        assertEquals(192L * MIB, NativeRenderMemoryBudget.textureCapacityBytes(512L * MIB, 16384L * MIB, true))
        assertEquals(512L * MIB, NativeRenderMemoryBudget.textureCapacityBytes(Long.MAX_VALUE, Long.MAX_VALUE))
    }
    @Test
    fun `contour geometry holds the measured working set within a bounded heap share`() {
        assertEquals(128L * MIB, NativeRenderMemoryBudget.contourCapacityBytes(512L * MIB))
        assertEquals(64L * MIB, NativeRenderMemoryBudget.contourCapacityBytes(256L * MIB))
        assertEquals(8L * MIB, NativeRenderMemoryBudget.contourCapacityBytes(Long.MIN_VALUE))
        assertEquals(128L * MIB, NativeRenderMemoryBudget.contourCapacityBytes(Long.MAX_VALUE))
    }

    @Test fun highDetailObliqueWorkingSetFitsWithoutUnboundedGrowth() {
        // Two real 390x857/high/pitch55 views used 113,876,992 and 170,078,208 bytes.
        // Fitting only the first view regressed into an endless decode cycle in the second.
        val measuredWorkingSet = 170_078_208L
        val allowance = NativeRenderMemoryBudget.textureCapacityBytes(512L * MIB)
        assertTrue(allowance > measuredWorkingSet)
        assertTrue(allowance <= 192L * MIB)
        assertEquals(192L * MIB, NativeRenderMemoryBudget.textureCapacityBytes(2_048L * MIB))
        assertEquals(192L * MIB, NativeRenderMemoryBudget.textureCapacityBytes(Long.MAX_VALUE))
        assertEquals(8L * MIB, NativeRenderMemoryBudget.textureCapacityBytes(Long.MIN_VALUE))
    }

    @Test fun perSurfaceCapacityStaysWithinHalfHeapAndAllSurfacesRemainBounded() {
        for (heapMib in listOf(64L, 96L, 128L, 192L, 256L, 383L, 384L, 512L, 576L, 2_048L)) {
            val heap = heapMib * MIB
            val capacity = NativeRenderMemoryBudget.textureCapacityBytes(heap)
            assertTrue(capacity <= heap / 2L)
            assertTrue(capacity * 3L <= 576L * MIB)
        }
    }

    @Test fun vectorWorkingSetGrowsWithHeapButNeverExceedsSdkBound() {
        assertEquals(32, NativeRenderMemoryBudget.vectorTileCount(64L * MIB))
        assertEquals(48, NativeRenderMemoryBudget.vectorTileCount(96L * MIB))
        assertEquals(96, NativeRenderMemoryBudget.vectorTileCount(192L * MIB))
        assertEquals(256, NativeRenderMemoryBudget.vectorTileCount(512L * MIB))
        assertEquals(256, NativeRenderMemoryBudget.vectorTileCount(Long.MAX_VALUE))
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
