package com.shantu.nativeapp.data

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
class NativeCollectionsTest {
    @Test
    fun folderEditsPreserveVersionOneFieldsAndNeverMutateInput() {
        val original = NativeCollections.defaultLayout().put("futureField", JSONObject().put("keep", true))
        val root = NativeCollections.createFolder(original, "行程", id = "plans")
        val nested = NativeCollections.createFolder(root, "周末", parentId = "plans", id = "weekend")
        val renamed = NativeCollections.renameFolder(nested, "weekend", "周边", "#aabbcc")
        val moved = NativeCollections.moveFolder(renamed, "weekend", null)

        assertFalse(original.has("treeOrder"))
        assertEquals(6, original.getJSONArray("groups").length())
        assertTrue(moved.getJSONObject("futureField").getBoolean("keep"))
        assertEquals("周边", group(moved, "weekend").getString("name"))
        assertFalse(group(moved, "weekend").has("parentId"))
        assertEquals("#aabbcc", group(moved, "weekend").getString("color"))
        assertTrue((0 until moved.getJSONArray("treeOrder").length()).any { moved.getJSONArray("treeOrder").getString(it) == "folder:weekend" })
    }

    @Test
    fun movingFolderBeforeSiblingInsertsWithoutReplacingExistingGroup() {
        var layout = NativeCollections.defaultLayout()
        layout = NativeCollections.createFolder(layout, "甲", id = "a")
        layout = NativeCollections.createFolder(layout, "乙", id = "b")
        layout = NativeCollections.createFolder(layout, "丙", id = "c")
        val moved = NativeCollections.moveFolder(layout, "c", null, beforeId = "a")
        val ids = (0 until moved.getJSONArray("groups").length()).map { moved.getJSONArray("groups").getJSONObject(it).getString("id") }
        assertEquals(listOf("auto", "bicycle", "pedestrian", "recorded", "imported", "manual", "c", "a", "b"), ids)
    }

    @Test
    fun deletingFolderPromotesFoldersAndMovesAssignmentsWithoutDeletingObjects() {
        val base = NativeCollections.createFolder(NativeCollections.defaultLayout(), "行程", id = "plans")
        val nested = NativeCollections.createFolder(base, "周末", parentId = "plans", id = "weekend")
            .put("assignments", JSONObject().put("track:t1", "plans"))
            .put("order", JSONArray().put("track:t1"))
        val deleted = NativeCollections.deleteFolder(nested, "plans")

        assertEquals("unfiled", deleted.getJSONObject("assignments").getString("track:t1"))
        assertEquals("track:t1", deleted.getJSONArray("order").getString(0))
        assertEquals("weekend", group(deleted, "weekend").getString("id"))
        assertFalse(group(deleted, "weekend").has("parentId"))
        assertFalse((0 until deleted.getJSONArray("treeOrder").length()).any { deleted.getJSONArray("treeOrder").getString(it) == "folder:plans" })
    }

    @Test
    fun itemMovesUpdateAssignmentAndBothOrdersWithoutLosingTabOrder() {
        val base = NativeCollections.createFolder(NativeCollections.defaultLayout(), "收藏", id = "saved")
            .put("assignments", JSONObject().put("track:a", "unfiled").put("track:b", "unfiled"))
            .put("order", JSONArray().put("track:a").put("track:b"))
            .put("treeOrder", JSONArray().put("folder:saved").put("track:a").put("track:b"))
            .put("tabOrder", JSONArray().put("all").put("track"))
        val moved = NativeCollections.moveItem(base, "track:b", "saved", "track:a")

        assertEquals("saved", moved.getJSONObject("assignments").getString("track:b"))
        assertEquals("track:b", moved.getJSONArray("order").getString(0))
        assertEquals("track:b", moved.getJSONArray("treeOrder").getString(1))
        assertEquals("all", moved.getJSONArray("tabOrder").getString(0))
        assertEquals("unfiled", base.getJSONObject("assignments").getString("track:b"))
    }

    @Test
    fun removeItemsClearsOnlySelectedIndexesAndPreservesOpaqueFields() {
        val layout = NativeCollections.defaultLayout()
            .put("assignments", JSONObject().put("track:a", "manual").put("track:b", "manual"))
            .put("order", JSONArray().put("track:a").put("track:b"))
            .put("treeOrder", JSONArray().put("folder:manual").put("track:a").put("track:b"))
            .put("tabOrder", JSONArray().put("all").put("route"))
            .put("vendor", JSONObject().put("keep", "opaque"))
        val result = NativeCollections.removeItems(layout, listOf("track:a"))

        assertFalse(result.getJSONObject("assignments").has("track:a"))
        assertTrue(result.getJSONObject("assignments").has("track:b"))
        assertEquals("track:b", result.getJSONArray("order").getString(0))
        assertEquals(2, result.getJSONArray("treeOrder").length())
        assertEquals("all", result.getJSONArray("tabOrder").getString(0))
        assertEquals("opaque", result.getJSONObject("vendor").getString("keep"))
        assertTrue(layout.getJSONObject("assignments").has("track:a"))
    }

    @Test
    fun bulkMoveAssignsEverySelectedReferenceWithoutTouchingOthers() {
        val base = NativeCollections.createFolder(NativeCollections.defaultLayout(), "稍后", id = "later")
            .put("assignments", JSONObject().put("track:a", "unfiled").put("track:b", "unfiled").put("track:c", "unfiled"))
            .put("order", JSONArray().put("track:a").put("track:b").put("track:c"))
            .put("treeOrder", JSONArray().put("folder:later").put("track:a").put("track:b").put("track:c"))
        val moved = NativeCollections.moveItems(
            base,
            listOf("track:a", "track:c"),
            "later",
            listOf(NativeCollections.ItemRef("track:a", "unfiled"), NativeCollections.ItemRef("track:b", "unfiled"), NativeCollections.ItemRef("track:c", "unfiled")),
        )

        assertEquals("later", moved.getJSONObject("assignments").getString("track:a"))
        assertEquals("unfiled", moved.getJSONObject("assignments").getString("track:b"))
        assertEquals("later", moved.getJSONObject("assignments").getString("track:c"))
        assertEquals(3, moved.getJSONArray("order").length())
        assertTrue(base.getJSONObject("assignments").getString("track:a") == "unfiled")
    }

    @Test
    fun movingVisibleTabDoesNotJumpAcrossHiddenTabSlots() {
        val layout = NativeCollections.defaultLayout().put(
            "tabOrder", JSONArray().put("regions").put("all").put("cache").put("route").put("track")
        )
        val moved = NativeCollections.moveVisibleTab(layout, "route", listOf("all", "route", "track"), -1)
        val order = (0 until moved.getJSONArray("tabOrder").length()).map { moved.getJSONArray("tabOrder").getString(it) }

        assertEquals(listOf("regions", "route", "cache", "all", "track"), order.take(5))
        assertEquals("regions", order[0])
        assertEquals("cache", order[2])
    }

    @Test
    fun validationRejectsCyclesAndDepthBeyondEight() {
        var layout = NativeCollections.defaultLayout()
        for (index in 1..8) layout = NativeCollections.createFolder(layout, "F$index", parentId = if (index == 1) null else "f${index - 1}", id = "f$index")
        var failed = false
        try { NativeCollections.createFolder(layout, "Too deep", parentId = "f8", id = "f9") } catch (_: IllegalArgumentException) { failed = true }
        assertTrue(failed)
        failed = false
        try { NativeCollections.moveFolder(layout, "f1", "f8") } catch (_: IllegalArgumentException) { failed = true }
        assertTrue(failed)
    }

    @Test fun recordKeyAndCoordinateSerializationMatchWorkspaceRegionKeys() {
        val ref=CollectionRecordRef("measurements","measure-1")
        assertEquals("measurement:measure-1",NativeCollections.keyFor(ref))
        assertEquals(ref,NativeCollections.recordForKey("measurement:measure-1"))
        assertEquals("-73.123457,40.765432",NativeCollections.coordinateKey(-73.1234567,40.7654321))
        assertTrue(runCatching{NativeCollections.recordForKey("folder:missing")}.isFailure)
        assertTrue(runCatching{NativeCollections.coordinateKey(181.0,0.0)}.isFailure)
    }

    private fun group(layout: JSONObject, id: String): JSONObject {
        val groups = layout.getJSONArray("groups")
        return (0 until groups.length()).map { groups.getJSONObject(it) }.first { it.getString("id") == id }
    }
}
