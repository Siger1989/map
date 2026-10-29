package com.shantu.nativeapp.hybrid

import org.junit.Assert.*
import org.junit.Test

class NativeBridgeDemTileCacheTest {
    @Test fun overlappingViewsReuseGridUntilItsOriginalExpiry() {
        val cache = NativeBridgeDemTileCache<Any>(2, 30_000)
        val grid = Any()
        cache.put("12/100/200/64", grid, 100)
        assertSame(grid, cache.get("12/100/200/64", 10_000))
        assertSame(grid, cache.get("12/100/200/64", 30_099))
        assertNull(cache.get("12/100/200/64", 30_100))
    }

    @Test fun longPanEvictsLeastRecentlyUsedGridAndPreservesRecentOverlap() {
        val cache = NativeBridgeDemTileCache<String>(2)
        cache.put("first", "a", 0); cache.put("second", "b", 1)
        assertEquals("a", cache.get("first", 2))
        cache.put("third", "c", 3)
        assertNull(cache.get("second", 4))
        assertEquals("a", cache.get("first", 4))
        assertEquals("c", cache.get("third", 4))
        assertNull(cache.get("first/other-resolution", 4))
        assertNull(cache.get("first", -1))
    }
}
