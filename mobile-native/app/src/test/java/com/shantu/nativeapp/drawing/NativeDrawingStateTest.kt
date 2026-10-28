package com.shantu.nativeapp.drawing

import com.shantu.nativeapp.navigation.NativeCoordinate
import com.shantu.nativeapp.navigation.NativePlannedRoute
import com.shantu.nativeapp.navigation.NativeRouteSegment
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NativeDrawingStateTest {
    @Test fun batchDeleteLeavesDisconnectedRunsAndOneUndoStep() {
        val state = NativeDrawingState.continueFrom(lineTrack("batch", listOf(point(1.0, 1.0), point(2.0, 2.0), point(3.0, 3.0), point(4.0, 4.0))))
        val count = state.deleteNodes(setOf(NativeDrawingNodeRef(0, 1), NativeDrawingNodeRef(0, 2)))
        assertEquals(2, count)
        val segments = state.snapshot().getJSONArray("segments")
        assertEquals("Removed consecutive points do not create an invented connector", 2, segments.length())
        assertTrue(state.undo())
        assertEquals(4, state.pointCount())
    }

    @Test fun branchConnectAndMergeRequireExplicitConnectedGeometry() {
        val state = NativeDrawingState.continueFrom(lineTrack("join", listOf(point(1.0, 1.0), point(2.0, 2.0))).apply {
            put("edgeColors", JSONArray().put(JSONArray().put("#112233")))
        })
        state.appendBranch(point(2.0, 2.0), point(3.0, 3.0))
        assertEquals(2, state.segmentCount())
        state.mergeSegments(0, 1)
        assertEquals(1, state.segmentCount())
        assertEquals(2, state.snapshot().getJSONArray("edgeColors").getJSONArray(0).length())
        state.appendStroke(listOf(point(8.0, 8.0), point(9.0, 9.0)))
        val error = runCatching { state.mergeSegments(0, 1) }.exceptionOrNull()
        assertTrue(error is IllegalArgumentException)
        assertEquals("Disconnected lines stay separate", 2, state.segmentCount())
    }
    @Test fun editingIsDeepCopiedAndUndoRedoRestoresGeometry() {
        val state = NativeDrawingState.newTrack()
        state.appendPoint(point(100.0, 30.0))
        state.appendPoint(point(100.001, 30.001))
        val original = state.snapshot()
        state.moveNode(0, 1, point(100.002, 30.002))
        assertTrue(state.canUndo)
        assertEquals(100.001, original.getJSONArray("segments").getJSONArray(0).getJSONArray(1).getDouble(0), 1e-8)
        assertTrue(state.undo())
        assertEquals(100.001, state.snapshot().getJSONArray("segments").getJSONArray(0).getJSONArray(1).getDouble(0), 1e-8)
        assertTrue(state.redo())
        assertEquals(100.002, state.snapshot().getJSONArray("segments").getJSONArray(0).getJSONArray(1).getDouble(0), 1e-8)
        assertFalse(state.canRedo)
    }

    @Test fun insertAndDeletePreserveGapsAndEdgeAnnotations() {
        val track = lineTrack("line", listOf(point(100.0, 30.0), point(100.01, 30.01), point(100.02, 30.02))).apply {
            put("edgeColors", JSONArray().put(JSONArray().put("#112233").put("#445566")))
            put("edgeNotes", JSONArray().put(JSONArray().put("first").put("second")))
        }
        val state = NativeDrawingState.continueFrom(track)
        state.insertNode(0, 1, point(100.005, 30.005))
        val inserted = state.snapshot()
        assertEquals(4, inserted.getJSONArray("segments").getJSONArray(0).length())
        assertEquals(3, inserted.getJSONArray("edgeColors").getJSONArray(0).length())
        assertEquals("#112233", inserted.getJSONArray("edgeColors").getJSONArray(0).getString(0))
        assertEquals("#112233", inserted.getJSONArray("edgeColors").getJSONArray(0).getString(1))
        assertEquals("first", inserted.getJSONArray("edgeNotes").getJSONArray(0).getString(0))
        assertEquals("first", inserted.getJSONArray("edgeNotes").getJSONArray(0).getString(1))

        state.deleteNode(0, 2)
        val cut = state.snapshot().getJSONArray("segments")
        assertEquals("Deleting an interior node leaves a real gap", 2, cut.length())
        assertEquals(2, cut.getJSONArray(0).length())
        assertEquals(1, cut.getJSONArray(1).length())
    }

    @Test fun deletingOneOccurrenceKeepsSharedNodeAndTerminalReferences() {
        val shared = point(100.01, 30.01)
        val track = lineTrack("shared", listOf(point(100.0, 30.0), shared)).apply {
            put("segments", JSONArray()
                .put(JSONArray().put(point(100.0, 30.0).toJson()).put(shared.toJson()))
                .put(JSONArray().put(shared.toJson()).put(point(100.02, 30.02).toJson())))
            put("nodes", JSONArray().put(shared.toJson()))
            put("routeTerminals", JSONObject().put("start", shared.toJson()))
        }
        val state = NativeDrawingState.continueFrom(track)
        state.deleteNode(0, 1)
        val saved = state.snapshot()
        assertEquals(1, saved.getJSONArray("nodes").length())
        assertTrue(saved.getJSONObject("routeTerminals").has("start"))
    }

    @Test fun movingNodeMovesItsPointDetailsAndMergesTargetNote() {
        val from = point(100.01, 30.01)
        val to = point(100.02, 30.02)
        val track = lineTrack("details", listOf(point(100.0, 30.0), from)).apply {
            put("pointDetails", JSONObject()
                .put("100.01,30.01", JSONObject().put("note", "旧备注").put("kind", "water"))
                .put("100.02,30.02", JSONObject().put("note", "目标备注")))
        }
        val state = NativeDrawingState.continueFrom(track)
        state.moveNode(0, 1, to)
        val details = state.snapshot().getJSONObject("pointDetails")
        assertFalse(details.has("100.01,30.01"))
        assertEquals("旧备注；目标备注", details.getJSONObject("100.02,30.02").getString("note"))
        assertEquals("water", details.getJSONObject("100.02,30.02").getString("kind"))
    }

    @Test fun freehandStrokeIsOneUndoRedoOperationAndInvalidStrokeIsAtomic() {
        val state = NativeDrawingState.newTrack()
        state.appendPoint(point(100.0, 30.0))
        val before = state.snapshot().toString()
        assertNotNull(runCatching { state.appendStroke(listOf(point(100.1, 30.1), point(100.2, 90.0))) }.exceptionOrNull())
        assertEquals(before, state.snapshot().toString())

        assertTrue(state.appendStroke(listOf(point(101.0, 31.0), point(101.1, 31.1), point(101.2, 31.2))))
        assertEquals(2, state.segmentCount())
        assertEquals(3, state.snapshot().getJSONArray("segments").getJSONArray(1).length())
        assertTrue(state.undo())
        assertEquals(1, state.segmentCount())
        assertTrue(state.redo())
        assertEquals(3, state.snapshot().getJSONArray("segments").getJSONArray(1).length())
    }

    @Test fun recordedContinuationCreatesManualCopyAndKeepsSourceUntouched() {
        val recorded = lineTrack("gps", listOf(point(100.0, 30.0), point(100.01, 30.01))).apply {
            put("source", "recorded")
            put("samples", JSONArray().put(JSONArray().put(JSONObject().put("time", 1).put("altitude", 10))))
            put("vendorTrack", JSONObject().put("kept", true))
        }
        val state = NativeDrawingState.continueFrom(recorded)
        val clone = state.snapshot()
        assertNotEquals("gps", clone.getString("id"))
        assertEquals("manual", clone.getString("source"))
        assertFalse(clone.has("samples"))
        assertEquals("gps", clone.getJSONArray("sourceTrackIds").getString(0))
        assertTrue(clone.getJSONObject("vendorTrack").getBoolean("kept"))
        assertTrue(recorded.has("samples"))
        assertEquals("recorded", recorded.getString("source"))
    }

    @Test fun reverseReversesSegmentOrderEdgeMetadataAndTerminals() {
        val track = lineTrack("line", listOf(point(100.0, 30.0), point(100.01, 30.01))).apply {
            put("segments", JSONArray().put(JSONArray().put(point(100.0, 30.0).toJson()).put(point(100.01, 30.01).toJson()))
                .put(JSONArray().put(point(101.0, 31.0).toJson()).put(point(101.01, 31.01).toJson())))
            put("edgeColors", JSONArray().put(JSONArray().put("#111111")).put(JSONArray().put("#222222")))
            put("routeTerminals", JSONObject().put("start", point(100.0, 30.0).toJson()).put("end", point(101.01, 31.01).toJson()))
        }
        val state = NativeDrawingState.continueFrom(track)
        state.reverse()
        val value = state.snapshot()
        assertEquals(101.01, value.getJSONArray("segments").getJSONArray(0).getJSONArray(0).getDouble(0), 1e-8)
        assertEquals("#222222", value.getJSONArray("edgeColors").getJSONArray(0).getString(0))
        assertEquals(101.01, value.getJSONObject("routeTerminals").getJSONArray("start").getDouble(0), 1e-8)
        assertEquals(100.0, value.getJSONObject("routeTerminals").getJSONArray("end").getDouble(0), 1e-8)
    }

    @Test fun roadSnapStoresOnlyReturnedRoadGeometryAndModeAndIsUndoable() {
        val state = NativeDrawingState.newTrack()
        state.appendPoint(point(100.0, 30.0))
        val road = listOf(point(100.001, 30.001), point(100.002, 30.002))
        assertTrue(state.appendRoadLeg(planned("bicycle", road)))
        val track = state.toTrack()
        assertEquals("bicycle", track.getString("navigationMode"))
        assertEquals("bicycle", track.getJSONArray("roadLegs").getJSONObject(0).getString("mode"))
        assertEquals(2, track.getJSONArray("segments").length())
        assertEquals(1, track.getJSONArray("segments").getJSONArray(0).length())
        assertEquals(2, track.getJSONArray("segments").getJSONArray(1).length())
        assertTrue(state.undo())
        assertEquals(1, state.segmentCount())
    }

    @Test fun draftRestoreKeepsPauseSnapModeAndUnknownTrackFields() {
        val source = lineTrack("draft", listOf(point(100.0, 30.0))).put("name", "我的线")
            .put("extension", JSONObject().put("kept", true))
        val state = NativeDrawingState.continueFrom(source)
        state.setSnapMode(NativeDrawingSnapMode.ROAD)
        state.setTravelMode("auto")
        state.setPaused(true)
        state.setNote("说明")
        val draft = state.toDraft()
        val restored = NativeDrawingState.restore(draft)
        assertTrue(restored.paused)
        assertEquals(NativeDrawingSnapMode.ROAD, restored.snapMode)
        assertEquals("auto", restored.travelMode)
        assertEquals("说明", restored.snapshot().getString("note"))
        assertTrue(restored.snapshot().getJSONObject("extension").getBoolean("kept"))
        assertEquals(state.snapshot().getString("id"), restored.toTrack().getString("id"))
    }

    @Test fun firstPointSetsDrawingLocationWithoutDroppingUnknownFields() {
        val state = NativeDrawingState.newTrack().apply { appendPoint(point(100.25, 30.5)) }
        val location = state.toTrack().getJSONObject("drawingLocation")
        assertEquals(100.25, location.getJSONArray("coordinate").getDouble(0), 1e-8)
        assertEquals(30.5, location.getJSONArray("coordinate").getDouble(1), 1e-8)
        assertEquals("", location.getString("label"))
    }

    @Test fun restoresLegacyNativeDraftPoints() {
        val legacy = JSONObject().put("id", "legacy-draw").put("points", JSONArray()
            .put(JSONArray().put(100.25).put(30.5)).put(JSONArray().put(100.5).put(30.75)))
        val restored = NativeDrawingState.restore(legacy)
        assertTrue(restored.paused)
        assertEquals("legacy-draw", restored.snapshot().getString("id"))
        assertEquals(100.5, restored.snapshot().getJSONArray("segments").getJSONArray(0).getJSONArray(1).getDouble(0), 1e-8)
    }

    @Test fun invalidMutationRollsBackAndStyleRetainsUnknownKeys() {
        val track = lineTrack("style", emptyList()).getJSONObject("style").put("vendorStyle", 9)
        val state = NativeDrawingState.continueFrom(lineTrack("style", emptyList()).put("style", track))
        val before = state.snapshot().toString()
        assertNotNull(runCatching { state.setStyleWidth(8.0) }.exceptionOrNull())
        assertEquals(before, state.snapshot().toString())
        state.setStyleColor("#AABBCC")
        assertEquals("#aabbcc", state.snapshot().getJSONObject("style").getString("color"))
        assertEquals(9, state.snapshot().getJSONObject("style").getInt("vendorStyle"))
    }

    @Test fun newTrackUsesValidatedImportedStyleAndMappedTravelMode() {
        val style=JSONObject().put("color","#123456").put("width",4.5).put("pointSize",12).put("opacity",.6)
            .put("colorMode","elevation").put("travelMode","bicycle")
        val state=NativeDrawingState.newTrack("custom",style)
        val saved=state.snapshot().getJSONObject("style")
        assertEquals("#123456",saved.getString("color")); assertEquals(4.5,saved.getDouble("width"),0.0)
        assertEquals(12,saved.getInt("pointSize")); assertEquals(.6,saved.getDouble("opacity"),0.0)
        assertEquals("elevation",saved.getString("colorMode")); assertEquals("bicycle",state.travelMode)
        val fallback=NativeDrawingState.newTrack("safe",JSONObject().put("color","invalid").put("width",90).put("travelMode","car"))
        assertEquals(NativeDrawingState.DEFAULT_COLOR,fallback.snapshot().getJSONObject("style").getString("color"))
        assertEquals(5.0,fallback.snapshot().getJSONObject("style").getDouble("width"),0.0)
        assertEquals("auto",fallback.travelMode)
    }

    private fun planned(mode: String, points: List<NativeCoordinate>) = NativePlannedRoute(
        mode = mode,
        coordinates = points,
        distance = 100.0,
        duration = 60.0,
        steps = emptyList(),
        roadLegs = listOf(points),
        segments = listOf(NativeRouteSegment("road", points)),
        accessDistance = 14.0,
        accessDuration = 5.0,
        snapped = listOf(points.first(), points.last()),
        stops = emptyList(),
        createdAt = 1L,
    )

    private fun lineTrack(id: String, points: List<NativeCoordinate>) = JSONObject()
        .put("id", id).put("name", id).put("createdAt", 1).put("source", "manual")
        .put("segments", if (points.isEmpty()) JSONArray() else JSONArray().put(JSONArray().also { line -> points.forEach { line.put(it.toJson()) } }))
        .put("style", JSONObject().put("color", "#ffb477").put("width", 1.5).put("opacity", 1.0))

    private fun point(lon: Double, lat: Double) = NativeCoordinate(lon, lat)
}
