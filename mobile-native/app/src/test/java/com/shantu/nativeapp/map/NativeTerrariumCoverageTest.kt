package com.shantu.nativeapp.map

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.assertNull
import org.junit.Test
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.job
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

class NativeTerrariumCoverageTest {
    @Test
    fun `mercator reprojection maps equator and clamps both world edges`() {
        val zoom = 4
        val worldPixels = (1 shl zoom) * 256
        assertEquals(worldPixels / 2.0, NativeTerrariumMath.mercatorPixelY(0.0, zoom), 1e-9)
        assertTrue(NativeTerrariumMath.mercatorPixelY(90.0, zoom) < 1e-6)
        assertEquals(worldPixels - 1.0, NativeTerrariumMath.mercatorPixelY(-90.0, zoom), 1e-9)
        assertTrue(NativeTerrariumMath.mercatorPixelY(45.0, zoom) < worldPixels / 2.0)
    }

    @Test
    fun `terrarium rgb decoding preserves fractional meter source before integer quantization`() {
        assertEquals(0.0, NativeTerrariumMath.decodeTerrarium(128, 0, 0), 0.0)
        assertEquals(-1.0, NativeTerrariumMath.decodeTerrarium(127, 255, 0), 0.0)
        assertEquals(1.5, NativeTerrariumMath.decodeTerrarium(128, 1, 128), 0.0)
        assertEquals(2, NativeTerrariumMath.decodeTerrarium(128, 1, 128).roundToInt())
    }

    @Test
    fun `bilinear elevation ignores missing zero weight neighbors but requires every weighted sample`() {
        assertEquals(12.0, bilinearElevation(12.0, Double.NaN, Double.NaN, Double.NaN, 0.0, 0.0), 0.0)
        assertEquals(15.0, bilinearElevation(10.0, 20.0, 30.0, 40.0, 0.5, 0.0), 0.0)
        assertEquals(25.0, bilinearElevation(10.0, 20.0, 30.0, 40.0, 0.5, 0.5), 0.0)
        assertTrue(bilinearElevation(10.0, null, 30.0, 40.0, 0.5, 0.0).isNaN())
    }

    @Test
    fun `regional coverage bounds do not claim global fabdem availability`() {
        val bounds = intArrayOf(10, 12, 20, 22)
        assertTrue(NativeTerrariumMath.tileInsideCoverage(8, 11, 21, bounds))
        assertFalse(NativeTerrariumMath.tileInsideCoverage(8, 13, 21, bounds))
        assertFalse(NativeTerrariumMath.tileInsideCoverage(8, 11, 23, bounds))
        assertFalse(NativeTerrariumMath.tileInsideCoverage(8, 11, 21, null))
    }

    @Test
    fun `fallback cache skips non-required row without memoizing a missing fallback`() = runBlocking {
        val cache = NativeLazyFallbackCache<String>()
        var loads = 0
        assertNull(cache.resolve(7, required = false) { loads++; "unexpected" })
        assertEquals("fallback-tile", cache.resolve(7, required = true) { loads++; "fallback-tile" })
        assertEquals("fallback-tile", cache.resolve(7, required = true) { loads++; "duplicate" })
        assertEquals(1, loads)
    }

    @Test
    fun `pixel raster work observes cancellation without waiting for a suspension`() = runBlocking {
        val rasterJob = launch(start = CoroutineStart.UNDISPATCHED) {
            currentCoroutineContext().job.cancel()
            ensureTerrainRasterActive()
        }
        rasterJob.join()
        assertTrue(rasterJob.isCancelled)
    }
}
