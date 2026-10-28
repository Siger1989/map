package com.shantu.nativeapp.section

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.json.JSONArray
import org.json.JSONObject

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NativeSectionDemSamplerTest {
    @Test fun `bilinear reads actual mercator tiles and caches requests within run`() = runBlocking {
        val calls = mutableListOf<Triple<Int, Int, Int>>()
        val sampler = NativeSectionDemSampler({ z, x, y ->
            calls += Triple(z, x, y)
            DoubleArray(NativeSectionDemSampler.TILE_SIZE * NativeSectionDemSampler.TILE_SIZE) { 321.0 }
        })
        val settings = settings(width = 200_000.0, height = 200_000.0)
        val zoom = sampler.prepare(NativeSectionSettings.parse(settings))
        assertEquals(6, zoom)
        val first = sampler.sample(0.0, 0.0)
        val again = sampler.sample(0.0, 0.0)
        assertEquals(321.0, first?.elevationMeters ?: Double.NaN, 1e-8)
        assertEquals(first, again)
        assertTrue(calls.all { it.first == zoom })
        assertTrue(calls.size <= 4)
        assertTrue(sampler.requestedTileCount <= 4)
        sampler.close()
        assertEquals(0, sampler.residentTileCount)
    }

    @Test fun `unavailable tile fails explicitly while valid tile nodata stays absent`() = runBlocking {
        val missing = NativeSectionDemSampler({ _, _, _ -> null })
        missing.prepare(NativeSectionSettings.parse(settings(200_000.0, 200_000.0)))
        val loadFailure = runCatching { missing.sample(0.0, 0.0) }.exceptionOrNull()
        assertTrue(loadFailure is NativeSectionTileLoadException)

        val nodata = NativeSectionDemSampler({ _, _, _ -> DoubleArray(256 * 256) { Double.NaN } })
        nodata.prepare(NativeSectionSettings.parse(settings(200_000.0, 200_000.0)))
        assertNull(nodata.sample(0.0, 0.0))
    }

    @Test fun `tile cap and cancellation are propagated to caller`() = runBlocking {
        val capped = NativeSectionDemSampler({ _, _, _ -> DoubleArray(256 * 256) { 20.0 } }, maxUniqueTiles = 1)
        capped.prepare(NativeSectionSettings.parse(settings(200_000.0, 200_000.0)))
        try {
            capped.sample(0.0, 0.0)
            throw AssertionError("expected tile budget to stop sampling")
        } catch (expected: NativeSectionTileBudgetExceededException) {
            assertEquals(1, expected.maximumTiles)
        }

        val cancelled = NativeSectionDemSampler({ _, _, _ -> throw CancellationException("fixture") })
        cancelled.prepare(NativeSectionSettings.parse(settings(200_000.0, 200_000.0)))
        try {
            cancelled.sample(0.0, 0.0)
            throw AssertionError("expected cancellation to propagate")
        } catch (expected: CancellationException) {
            assertEquals("fixture", expected.message)
        }
    }

    private fun settings(width: Double, height: Double) = JSONObject()
        .put("enabled", true).put("altitude", 0.0).put("color", "#9de8c4")
        .put("plane", JSONObject().put("center", JSONArray().put(0.0).put(0.0))
            .put("width", width).put("height", height).put("heading", 0.0).put("tilt", 0.0))
}
