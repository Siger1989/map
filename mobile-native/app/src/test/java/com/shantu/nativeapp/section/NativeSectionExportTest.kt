package com.shantu.nativeapp.section

import android.os.CancellationSignal
import com.shantu.nativeapp.geometry.GeoPoint
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NativeSectionExportTest {
    @Test fun surveyProjectionUsesOriginalMercatorAxisAndSignedOffset() {
        val line = NativeSurveyLine.parse(JSONObject().put("version", 1)
            .put("a", JSONArray().put(104.0).put(30.0)).put("b", JSONArray().put(104.01).put(30.0))
            .put("stations", JSONArray().put(JSONObject().put("id", "s1").put("label", "C").put("distance", 120.0)))
            .put("interval", 50).put("halfWidth", 40.0))
        val projected = line.project(line.coordinate(80.0, 12.0).first, line.coordinate(80.0, 12.0).second)
        assertEquals(80.0, projected.distanceMeters, 0.05)
        assertEquals(12.0, projected.offsetMeters, 0.05)
        assertEquals(listOf("A", "C", "B"), line.orderedStations().map { it.label })
        assertTrue(NativeSurveySectionEngine.key(line).startsWith("[[104,30],[104.01,30]"))
    }

    @Test fun surveySamplingKeepsNodataAndUsesSame257By49MeasuredGrid() = runBlocking {
        val line = NativeSurveyLine.parse(JSONObject().put("version", 1)
            .put("a", JSONArray().put(104.0).put(30.0)).put("b", JSONArray().put(104.001).put(30.0))
            .put("stations", JSONArray()).put("interval", 10).put("halfWidth", 20.0))
        val dem = NativeSectionElevationSampler { latitude, longitude ->
            if (longitude > 104.0004 && longitude < 104.0006) null
            else NativeSectionElevationSample(100.0 + latitude - 30.0, "fixture DEM")
        }
        val terrain = NativeSurveySectionEngine.sample(line, dem, 10)
        assertEquals(257, terrain.columns); assertEquals(49, terrain.rows)
        assertEquals(257 * 49, terrain.heightsMeters.size)
        assertTrue(terrain.heightsMeters.any { it == null })
        assertTrue(terrain.heightsMeters.filterNotNull().all { it != 0.0 })
        assertNull(terrain.heightAt(terrain.startMeters - 100))
        assertEquals("fixture DEM", terrain.toJson().getString("source"))
        assertEquals(terrain.heightsMeters, NativeSurveyTerrain.parse(line, terrain.toJson()).heightsMeters)
        val png = NativeSurveySheetExporter.pngBytes(line, terrain)
        assertTrue(png.size > 1000)
        assertEquals(1800, NativeSurveySheetExporter.render(line, terrain).width)
    }

    @Test fun measurementProfilePngIsPagedAndCancellationDoesNotConsumeData() {
        val points = listOf(
            GeoPoint(104.0, 30.0, 10.0), GeoPoint(104.001, 30.0, null), GeoPoint(104.002, 30.0, 25.0),
        )
        val page = NativeMeasurementProfileExporter.render(points, "真实高程", 0)
        assertEquals(1, page.count)
        assertTrue(page.pngBytes().size > 1000)
        assertNull("Unknown elevations remain null", points[1].altitude)
        val cancelled = CancellationSignal().apply { cancel() }
        assertTrue(runCatching { NativeMeasurementProfileExporter.render(points, "真实高程", 0, cancelled) }.isFailure)
    }

    @Test fun savedSectionCurveCanExportPngFromOnlyItsActualSamples() {
        val points = listOf(
            NativeSectionPoint(0.0, 0.0, listOf(0.0, 0.0, 0.0), 104.0, 30.0, 100.0, 0.0),
            NativeSectionPoint(10.0, 0.0, listOf(10.0, 0.0, 0.0), 104.0001, 30.0, 112.0, 10.0),
        )
        val curve = NativeSectionCurve("c", "地形", "terrain", points, listOf(0.0, 10.0), 10.0, 100.0, 112.0, false)
        assertTrue(NativeSectionProfilePngExporter.pngBytes(curve, "真实剖面").size > 1000)
    }
}
