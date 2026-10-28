package com.shantu.nativeapp.section

import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NativeSectionEngineTest {
    @Test fun `flat real DEM creates a terrain section curve with preserved WGS84 settings`() = runBlocking {
        var requests = 0
        val rawSettings = settings()
        rawSettings.getJSONObject("plane").put("tilt", 30.0)
        val settings = NativeSectionSettings.parse(rawSettings)
        val result = NativeSectionEngine.sample(settings, emptyList()) { lat, lon ->
            requests++
            assertTrue(lat in -1.0..1.0 && lon in -1.0..1.0)
            NativeSectionElevationSample(100.0, "fixture DEM")
        }
        assertEquals(NativeSectionEngine.MAX_GRID_SAMPLES, requests)
        assertEquals(NativeSectionEngine.MAX_GRID_SAMPLES, result.validTerrainSamples)
        assertEquals("ready", result.phase)
        assertEquals(setOf("fixture DEM"), result.terrainSources)
        assertTrue(result.curves.any { it.source == "terrain" && it.points.size > 1 })
        val point = result.curves.first { it.source == "terrain" }.points.first()
        assertTrue(point.latitude.isFinite())
        assertTrue(point.longitude.isFinite())
        assertTrue(point.altitudeMeters in 98.0..102.0)
        assertEquals("retained-extension", result.settings.optString("futureField"))
        val exported = result.toProfileJson()
        assertTrue(exported.has("settings") && exported.has("curves") && exported.has("createdAt"))
        val curve = exported.getJSONArray("curves").getJSONObject(0)
        assertTrue(curve.has("id") && curve.has("source") && curve.has("distances") && curve.has("closed"))
        val savedPoint = curve.getJSONArray("points").getJSONObject(0)
        assertEquals(2, savedPoint.getJSONArray("coordinates").length())
        assertEquals(3, savedPoint.getJSONArray("local").length())
    }

    @Test fun `terrain curve follows DEM height when the section plane is tilted`() = runBlocking {
        val raw = settings().put("altitude", 300.0)
        raw.getJSONObject("plane").put("tilt", 30.0)
        val settings = NativeSectionSettings.parse(raw)
        val result = NativeSectionEngine.sample(settings, emptyList()) { _, _ -> NativeSectionElevationSample(100.0, "fixture DEM") }
        val terrain = result.curves.firstOrNull { it.source == "terrain" }
            ?: throw AssertionError("flat DEM should intersect the tilted section plane")
        assertTrue(terrain.points.size >= 2)
        assertTrue(terrain.points.all { kotlin.math.abs(it.altitudeMeters - 100.0) < 0.1 })
    }

    @Test fun `missing terrain remains nodata and does not create a false zero contour`() = runBlocking {
        val settings = NativeSectionSettings.parse(settings().put("altitude", 0.0))
        val missing = NativeSectionEngine.sample(settings, emptyList()) { _, _ -> null }
        assertEquals(0, missing.validTerrainSamples)
        assertEquals("partial", missing.phase)
        assertTrue(missing.curves.isEmpty())

        val partial = NativeSectionEngine.sample(settings, emptyList()) { _, lon ->
            if (lon < 0.0) NativeSectionElevationSample(250.0) else null
        }
        assertEquals("partial", partial.phase)
        assertTrue(partial.validTerrainSamples in 1 until NativeSectionEngine.MAX_GRID_SAMPLES)
        assertFalse(partial.curves.any { it.points.any { p -> p.altitudeMeters == 0.0 } })
    }

    @Test fun `sampler failure propagates instead of being exported as partial nodata`() = runBlocking {
        val error = runCatching {
            NativeSectionEngine.sample(NativeSectionSettings.parse(settings()), emptyList()) { _, _ ->
                throw IllegalStateException("fixture tile load failure")
            }
        }.exceptionOrNull()
        assertTrue(error is IllegalStateException)
        assertEquals("fixture tile load failure", error?.message)
    }

    @Test fun `terrain contours stop at a nodata strip instead of bridging it`() = runBlocking {
        val settings = NativeSectionSettings.parse(settings().put("altitude", 0.0))
        val result = NativeSectionEngine.sample(settings, emptyList()) { _, lon ->
            if (kotlin.math.abs(lon) < 0.002) null else NativeSectionElevationSample(250.0)
        }
        val terrain = result.curves.filter { it.source == "terrain" }
        assertEquals("partial", result.phase)
        assertTrue("the DEM gap should split the contour into disjoint paths", terrain.size >= 2)
        assertFalse(terrain.any { curve ->
            val west = curve.points.any { it.longitude < -0.002 }
            val east = curve.points.any { it.longitude > 0.002 }
            west && east
        })
    }

    @Test fun `model intersections use the shared rendered geometry and retain model source`() = runBlocking {
        val settings = NativeSectionSettings.parse(settings().put("altitude", 0.0))
        val model = JSONObject()
            .put("id", "box-1").put("kind", "box").put("name", "测试箱体")
            .put("coordinates", JSONArray().put(0.0).put(0.0))
            .put("groundElevation", 0.0).put("placement", "surface").put("offset", 0.0)
            .put("width", 120.0).put("length", 80.0).put("height", 100.0)
            .put("heading", 0.0).put("pitch", 0.0).put("roll", 0.0)
            .put("opacity", 0.8).put("color", "#ff0000").put("visible", true)
        val result = NativeSectionEngine.sample(settings, listOf(model)) { _, _ -> NativeSectionElevationSample(-500.0) }
        assertEquals(1, result.intersectingModels)
        assertTrue(result.curves.any { it.source == "model" && it.points.size >= 2 })
        val groundless = NativeSectionEngine.sample(settings, listOf(model.put("groundElevation", JSONObject.NULL))) { _, _ -> null }
        assertEquals(1, groundless.skippedGroundlessModels)
        assertFalse(groundless.curves.any { it.source == "model" })
    }

    @Test fun `survey schema is rejected explicitly instead of being treated as a free section plane`() {
        val error = runCatching { NativeSectionSettings.parse(settings().put("survey", JSONObject())) }.exceptionOrNull()
        assertTrue(error is IllegalArgumentException)
        assertTrue(error?.message.orEmpty().contains("独立测线"))
    }

    private fun settings() = JSONObject()
        .put("enabled", true)
        .put("altitude", 100.0)
        .put("color", "#9de8c4")
        .put("futureField", "retained-extension")
        .put("plane", JSONObject()
            .put("center", JSONArray().put(0.0).put(0.0))
            .put("width", 2000.0).put("height", 1000.0)
            .put("heading", 0.0).put("tilt", 0.0).put("roll", 0.0))
}
