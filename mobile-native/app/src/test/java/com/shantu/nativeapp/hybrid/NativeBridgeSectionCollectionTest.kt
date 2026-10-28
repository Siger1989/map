package com.shantu.nativeapp.hybrid

import com.shantu.nativeapp.section.NativeSectionSettings
import com.shantu.nativeapp.section.NativeSectionSnapshot
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
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
class NativeBridgeSectionCollectionTest {
    private class FakeSurface : NativeBridgeSectionCollection.Surface {
        var closed = false
        val shown = mutableListOf<NativeSectionSnapshot>()
        override fun show(snapshot: NativeSectionSnapshot, notes: JSONArray) { shown += snapshot }
        override fun close() { closed = true }
    }

    @Test fun `only enabled nonselected ordinary saved planes own collection layers`() {
        val survey = item("survey").also { it.getJSONObject("settings").put("survey", JSONObject()) }
        val state = state(item("active"), item("saved"), item("hidden", false), survey, item("saved"))
            .put("selectedSectionId", "active")
        val visible = NativeBridgeSectionCollection.visibleItems(state)
        assertEquals(listOf("saved"), visible.map { it.getString("id") })
        visible[0].getJSONObject("settings").put("altitude", 999)
        assertEquals(100, state.getJSONArray("sectionItems").getJSONObject(1).getJSONObject("settings").getInt("altitude"))
    }

    @Test fun `saved plane is resampled for DEM update then released on selected and close`() {
        val surfaces = mutableListOf<FakeSurface>()
        var samples = 0
        val collection = NativeBridgeSectionCollection(
            { FakeSurface().also(surfaces::add) },
            { settings, _ -> samples++; snapshot(settings) },
            CoroutineScope(SupervisorJob() + Dispatchers.Unconfined),
        )
        val state = state(item("saved"))
        collection.sync(state)
        collection.sync(state)
        assertEquals(1, samples)
        assertEquals(1, surfaces.single().shown.size)
        assertEquals(0, surfaces.single().shown.single().validTerrainSamples)
        assertTrue(surfaces.single().shown.single().curves.isEmpty())
        collection.afterDemUpdate()
        assertEquals(2, samples)
        collection.sync(state.put("selectedSectionId", "saved"))
        assertTrue(surfaces.single().closed)
        collection.close()
        collection.afterDemUpdate()
        assertEquals(2, samples)
    }

    @Test fun `new settings cancel stale sampling and never publish older geometry`() = runBlocking {
        val started = CompletableDeferred<Unit>()
        val pending = CompletableDeferred<Unit>()
        val surfaces = mutableListOf<FakeSurface>()
        val collection = NativeBridgeSectionCollection(
            { FakeSurface().also(surfaces::add) },
            { settings, _ ->
                if (settings.altitudeMeters == 100.0) { started.complete(Unit); pending.await() }
                snapshot(settings)
            },
            CoroutineScope(SupervisorJob() + Dispatchers.Unconfined),
        )
        collection.sync(state(item("saved")))
        started.await()
        val changed = item("saved").also { it.getJSONObject("settings").put("altitude", 200) }
        collection.sync(state(changed))
        pending.complete(Unit)
        assertEquals(1, surfaces.single().shown.size)
        assertEquals(200.0, surfaces.single().shown.single().settings.getDouble("altitude"), 0.0)
        assertFalse(surfaces.single().closed)
        collection.close()
        assertTrue(surfaces.single().closed)
    }

    @Test fun `one failed plane cannot hide another and model inputs preserve real ground`() {
        val surfaces = mutableListOf<FakeSurface>()
        val failures = mutableListOf<String>()
        val collection = NativeBridgeSectionCollection(
            { FakeSurface().also(surfaces::add) },
            { settings, models ->
                assertEquals(1, models.size)
                assertEquals(432.0, models.single().getDouble("groundElevation"), 0.0)
                if (settings.json.optBoolean("testFailure")) error("missing DEM")
                snapshot(settings)
            },
            CoroutineScope(SupervisorJob() + Dispatchers.Unconfined), failures::add,
        )
        val broken = item("broken").also { it.getJSONObject("settings").put("testFailure", true) }
        val annotations = JSONArray().put(JSONObject().put("kind", "box").put("groundElevation", 432))
            .put(JSONObject().put("kind", "pin"))
            .put(JSONObject().put("kind", "sphere").put("visible", false))
        collection.sync(state(broken, item("good")), annotations)
        assertEquals(1, failures.size)
        assertTrue(surfaces.first().closed)
        assertEquals(1, surfaces.last().shown.size)
        collection.close()
    }

    private fun item(id: String, enabled: Boolean = true) = JSONObject().put("id", id).put("settings", JSONObject()
        .put("enabled", enabled).put("altitude", 100).put("color", "#9de8c4")
        .put("plane", JSONObject().put("center", JSONArray().put(0).put(0)).put("width", 1000).put("height", 500)
            .put("heading", 0).put("tilt", 30).put("roll", 0)))
    private fun state(vararg items: JSONObject) = JSONObject().put("sectionItems", JSONArray(items.toList()))
    private fun snapshot(settings: NativeSectionSettings) = NativeSectionSnapshot(
        settings.json, emptyList(), 0, 0, 0, 100.0, 0, 0, "partial", emptySet(),
    )
}
