package com.shantu.nativeapp.data

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream

@RunWith(RobolectricTestRunner::class)
@org.robolectric.annotation.Config(sdk = [28], manifest = org.robolectric.annotation.Config.NONE)
class WorkspaceStoreTest {
    private lateinit var context: Context
    private lateinit var store: WorkspaceStore

    @Before fun setUp() {
        context = RuntimeEnvironment.getApplication()
        context.filesDir.resolve("workspace-v2.json").delete()
        context.filesDir.resolve("workspace-v2.json.bak").delete()
        context.filesDir.resolve("native-offline-maps").deleteRecursively()
        store = WorkspaceStore(context)
    }

    @Test fun importsByIdPreservingLocalOnlyAndUnknownRecordFields() {
        store.upsert("tracks", track("same", "local").put("deviceOnly", JSONObject().put("keep", true)))
        store.upsert("tracks", track("local-only", "receiver"))
        val incoming = workspace(
            JSONArray()
                .put(track("same", "incoming").put("extension", JSONObject().put("n", 7)))
                .put(track("new", "added")),
        ).put("vendorTopLevel", JSONObject().put("opaque", JSONArray().put(1).put(2)))

        val summary = store.importWorkspace(ByteArrayInputStream(incoming.toString().toByteArray()))
        val tracks = store.load().getJSONObject("core").getJSONArray("tracks")
        assertEquals(3, tracks.length())
        val same = find(tracks, "same")
        assertEquals("incoming", same.getString("name"))
        assertTrue(same.getJSONObject("extension").getInt("n") == 7)
        assertFalse(same.has("deviceOnly"))
        assertEquals("receiver", find(tracks, "local-only").getString("name"))
        assertEquals(1, summary.added["tracks"])
        assertEquals(1, summary.overwritten["tracks"])
        assertEquals(2, store.load().getJSONObject("vendorTopLevel").getJSONArray("opaque").length())
    }

    @Test fun importsPausedTaskMigrationAsSavedTracksAndCopiesIdCollisions() {
        store.upsert("tracks", track("draft", "本地同ID轨迹"))
        val payload = JSONObject().put("format", NativeTaskMigration.FORMAT).put("version", NativeTaskMigration.VERSION).put("createdAt", 99)
            .put("draft", JSONObject().put("id", "draft").put("name", "待迁画线").put("createdAt", 10).put("source", "manual").put("segments", JSONArray().put(JSONArray().put(JSONArray().put(10).put(20)))))
            .put("recording", JSONObject().put("id", "recording-1").put("phase", "recording").put("startedAt", 20)
                .put("segments", JSONArray().put(JSONArray().put(JSONObject().put("coordinates", JSONArray().put(11).put(21)).put("time", 21).put("accuracy", 4.0).put("altitude", JSONObject.NULL)))))
            .put("fileReferences", JSONArray().put(JSONObject().put("displayName", "survey.gpx").put("purpose", "需重新选择")))
        val result = store.importTaskMigration(ByteArrayInputStream(payload.toString().toByteArray()))
        assertEquals(2, result.tracks.size)
        assertEquals(1, result.fileReferences.size)
        val records = store.load().getJSONObject("core").getJSONArray("tracks")
        assertEquals(3, records.length())
        assertEquals("本地同ID轨迹", find(records, "draft").getString("name"))
        assertEquals("draft-migrated-1", result.tracks[0].getString("id"))
        assertEquals("draft", result.tracks[0].getString("migrationSourceId"))
        assertEquals("recorded", result.tracks[1].getString("source"))
        assertEquals("paused", result.tracks[1].getJSONObject("migrationCheckpoint").getString("phase"))
    }

    @Test fun invalidTaskMigrationAndCrossAppUrisDoNotModifyWorkspace() {
        store.upsert("tracks", track("keep", "本地轨迹"))
        val before = store.load().toString()
        val invalid = JSONObject().put("format", NativeTaskMigration.FORMAT).put("version", NativeTaskMigration.VERSION)
            .put("draft", JSONObject().put("id", "bad").put("segments", JSONArray().put(JSONArray().put(JSONArray().put(500).put(90)))))
        assertNotNull(runCatching { store.importTaskMigration(ByteArrayInputStream(invalid.toString().toByteArray())) }.exceptionOrNull())
        val uri = JSONObject().put("format", NativeTaskMigration.FORMAT).put("version", NativeTaskMigration.VERSION)
            .put("draft", JSONObject().put("id", "draft").put("segments", JSONArray().put(JSONArray().put(JSONArray().put(10).put(20)))))
            .put("fileReferences", JSONArray().put(JSONObject().put("displayName", "x.gpx").put("purpose", "route").put("uri", "content://private")))
        assertNotNull(runCatching { store.importTaskMigration(ByteArrayInputStream(uri.toString().toByteArray())) }.exceptionOrNull())
        assertEquals(before, store.load().toString())
    }

    @Test fun fullWorkspaceExportEmbedsMaterializedCalibratedImageBytesAndCrs() {
        val bitmap = android.graphics.Bitmap.createBitmap(intArrayOf(android.graphics.Color.RED, android.graphics.Color.BLUE, android.graphics.Color.GREEN, android.graphics.Color.WHITE), 2, 2, android.graphics.Bitmap.Config.ARGB_8888)
        val png = ByteArrayOutputStream().also { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }.toByteArray(); bitmap.recycle()
        val offlineMaps = com.shantu.nativeapp.offlineMaps.NativeOfflineMapStore(context)
        val map = offlineMaps.importGeoreferencedImage("calibrated.png", ByteArrayInputStream(png), "image/png", "0.5\n0\n0\n-0.5\n0.25\n0.75", "EPSG:4326")
        val bytes = ByteArrayOutputStream()
        store.exportWorkspace(bytes)
        val exported = JSONObject(bytes.toString("UTF-8")).getJSONArray("mapSources").getJSONObject(0)
        assertEquals(map.id, exported.getString("id"))
        assertEquals("image", exported.getString("kind"))
        assertEquals("EPSG:4326", exported.getJSONObject("imageGeoref").getString("sourceCrs"))
        assertEquals(png.size, java.util.Base64.getDecoder().decode(exported.getString("blobBase64")).size)
    }

    @Test fun collectionsKeepReceiverAssignmentsForLocalOnlyAndReplaceImportedOnes() {
        val localLayout = JSONObject()
            .put("version", 1)
            .put("groups", JSONArray().put(group("local", "Local")))
            .put("assignments", JSONObject().put("track:old", "local").put("track:local-only", "local"))
            .put("order", JSONArray().put("track:old").put("track:local-only"))
        val initialCore = workspace(JSONArray().put(track("old", "old")).put(track("local-only", "receiver"))).getJSONObject("core")
        initialCore.put("collections", localLayout)
        store.importWorkspace(ByteArrayInputStream(workspace(JSONArray().put(track("old", "old")).put(track("local-only", "receiver"))).put("core", initialCore).toString().toByteArray()))

        val core = workspace(JSONArray().put(track("old", "replacement")).put(track("incoming", "incoming"))).getJSONObject("core")
        core.put("collections", JSONObject()
            .put("version", 1)
            .put("groups", JSONArray().put(group("incoming-group", "Incoming")))
            .put("assignments", JSONObject().put("track:old", "incoming-group").put("track:incoming", "incoming-group"))
            .put("order", JSONArray().put("track:old").put("track:incoming")))
        store.importWorkspace(ByteArrayInputStream(workspace(JSONArray().put(track("old", "replacement")).put(track("incoming", "incoming"))).put("core", core).toString().toByteArray()))

        val layout = store.load().getJSONObject("core").getJSONObject("collections")
        assertEquals("incoming-group", layout.getJSONObject("assignments").getString("track:old"))
        assertEquals("local", layout.getJSONObject("assignments").getString("track:local-only"))
        assertEquals("incoming-group", layout.getJSONObject("assignments").getString("track:incoming"))
    }

    @Test fun sectionNotesMergeByObjectAndNoteId() {
        val settings = sectionSettings("s1")
        val old = savedNotes(settings, "n1", "local")
        val add = savedNotes(settings, "n2", "incoming")
        val core = JSONObject().put("format", "guanyun-backup").put("version", 1)
            .put("tracks", JSONArray()).put("annotations", JSONArray()).put("favorites", JSONArray())
            .put("sectionNotes", JSONArray().put(old))
        store.importWorkspace(ByteArrayInputStream(workspace(JSONArray()).put("core", core).toString().toByteArray()))
        val nextCore = workspace(JSONArray()).getJSONObject("core")
        nextCore.put("sectionNotes", JSONArray().put(savedNotes(settings, "n1", "updated")).put(add))
        store.importWorkspace(ByteArrayInputStream(workspace(JSONArray()).put("core", nextCore).toString().toByteArray()))
        val notes = store.load().getJSONObject("core").getJSONArray("sectionNotes").getJSONObject(0).getJSONArray("notes")
        assertEquals(2, notes.length())
        assertEquals("updated", find(notes, "n1").getString("note"))
    }

    @Test fun importsLegacyV1IntoWorkspaceAndKeepsReceiverOnlyObjects() {
        store.upsert("tracks", track("receiver-only", "receiver"))
        val v1 = JSONObject().put("format", "guanyun-backup").put("version", 1)
            .put("tracks", JSONArray().put(track("legacy", "old backup")))
            .put("annotations", JSONArray()).put("favorites", JSONArray())
        val summary = store.importWorkspace(ByteArrayInputStream(v1.toString().toByteArray()))
        val result = store.load().getJSONObject("core").getJSONArray("tracks")
        assertEquals("old backup", find(result, "legacy").getString("name"))
        assertEquals("receiver", find(result, "receiver-only").getString("name"))
        assertEquals(1, summary.added["tracks"])
    }

    @Test fun legacyV1CollisionCopiesTrackAndRemapsCrossTrackReferences() {
        store.upsert("tracks", track("legacy", "receiver version"))
        val source = track("legacy", "backup version")
        val derived = track("derived", "derived").put("sourceTrackIds", JSONArray().put("legacy"))
        val v1 = JSONObject().put("format", "guanyun-backup").put("version", 1)
            .put("tracks", JSONArray().put(source).put(derived)).put("annotations", JSONArray()).put("favorites", JSONArray())
        store.importWorkspace(ByteArrayInputStream(v1.toString().toByteArray()))
        val tracks = store.load().getJSONObject("core").getJSONArray("tracks")
        assertEquals("receiver version", find(tracks, "legacy").getString("name"))
        val copied = (0 until tracks.length()).map { tracks.getJSONObject(it) }.first { it.optString("name") == "backup version" }
        assertTrue(copied.getString("id") != "legacy")
        assertEquals(copied.getString("id"), find(tracks, "derived").getJSONArray("sourceTrackIds").getString(0))
    }

    @Test fun v2WorkspaceSameIdStillOverwritesRatherThanCopies() {
        store.upsert("tracks", track("stable", "receiver"))
        importValue(workspace(JSONArray().put(track("stable", "sender"))))
        val tracks = store.load().getJSONObject("core").getJSONArray("tracks")
        assertEquals(1, (0 until tracks.length()).count { tracks.getJSONObject(it).optString("id") == "stable" })
        assertEquals("sender", find(tracks, "stable").getString("name"))
    }

    @Test fun legacyV1CopiesUnchangedAnnotationWhenItsParentSectionChanged() {
        val originalSection = section("section-a", 100)
        val pin = annotation("pin-a").put("sectionAnchor", JSONObject().put("sectionId", "section-a").put("distance", 4))
        val first = legacy(JSONArray(), JSONArray().put(pin), JSONArray(), JSONArray().put(originalSection))
        store.importWorkspace(ByteArrayInputStream(first.toString().toByteArray()))
        val changedSection = section("section-a", 200)
        val second = legacy(JSONArray(), JSONArray().put(annotation("pin-a").put("sectionAnchor", JSONObject().put("sectionId", "section-a").put("distance", 4))), JSONArray(), JSONArray().put(changedSection))
        store.importWorkspace(ByteArrayInputStream(second.toString().toByteArray()))
        val core = store.load().getJSONObject("core")
        assertEquals(2, core.getJSONArray("sections").length())
        assertEquals(2, core.getJSONArray("annotations").length())
        val copiedSection = (0 until core.getJSONArray("sections").length()).map { core.getJSONArray("sections").getJSONObject(it) }.first { it.optInt("marker") == 200 }
        val copiedPin = (0 until core.getJSONArray("annotations").length()).map { core.getJSONArray("annotations").getJSONObject(it) }.first { it.getString("id") != "pin-a" }
        assertEquals(copiedSection.getString("id"), copiedPin.getJSONObject("sectionAnchor").getString("sectionId"))
    }

    @Test fun legacyV1GroupCollisionPreservesLocalGroupAndRemapsAssignmentsAndTree() {
        val core = workspace(JSONArray().put(track("collision-track", "local"))).getJSONObject("core")
        core.put("collections", JSONObject().put("version", 1).put("groups", JSONArray().put(group("group-a", "Local")))
            .put("assignments", JSONObject().put("track:collision-track", "group-a")).put("order", JSONArray().put("track:collision-track")).put("treeOrder", JSONArray().put("folder:group-a").put("track:collision-track")))
        importValue(workspace(JSONArray().put(track("collision-track", "local"))).put("core", core))
        val incomingCore = JSONObject().put("format", "guanyun-backup").put("version", 1)
            .put("tracks", JSONArray().put(track("collision-track", "copy"))).put("annotations", JSONArray()).put("favorites", JSONArray())
            .put("collections", JSONObject().put("version", 1).put("groups", JSONArray().put(group("group-a", "Incoming")))
                .put("assignments", JSONObject().put("track:collision-track", "group-a")).put("order", JSONArray().put("track:collision-track")).put("treeOrder", JSONArray().put("folder:group-a").put("track:collision-track")))
        store.importWorkspace(ByteArrayInputStream(incomingCore.toString().toByteArray()))
        val result = store.load().getJSONObject("core"); val layout=result.getJSONObject("collections")
        val copy=(0 until result.getJSONArray("tracks").length()).map{result.getJSONArray("tracks").getJSONObject(it)}.first{it.getString("name")=="copy"}
        val assigned=layout.getJSONObject("assignments").getString("track:${copy.getString("id")}")
        assertEquals("Local", (0 until layout.getJSONArray("groups").length()).map{layout.getJSONArray("groups").getJSONObject(it)}.first{it.getString("id")=="group-a"}.getString("name"))
        assertTrue(assigned!="group-a")
        assertTrue((0 until layout.getJSONArray("groups").length()).map{layout.getJSONArray("groups").getJSONObject(it).getString("id")}.contains(assigned))
        assertTrue((0 until layout.getJSONArray("treeOrder").length()).map{layout.getJSONArray("treeOrder").getString(it)}.contains("folder:$assigned"))
    }

    @Test fun legacyV1DoesNotReplaceAssignmentForAnIdenticalLocalRecord() {
        val stable=track("stable","same payload")
        store.upsert("tracks",stable)
        val localGroup=NativeCollections.createFolder(NativeCollections.defaultLayout(),"Keep locally",id="local-group")
        store.updateCollections(NativeCollections.moveItem(localGroup,"track:stable","local-group",items=listOf(NativeCollections.ItemRef("track:stable","unfiled"))))
        val incomingGroup=JSONObject().put("version",1).put("groups",JSONArray().put(group("local-group","Incoming name")))
            .put("assignments",JSONObject().put("track:stable","local-group")).put("order",JSONArray().put("track:stable")).put("treeOrder",JSONArray().put("folder:local-group").put("track:stable"))
        importValue(legacy(JSONArray().put(JSONObject(stable.toString())),JSONArray(),JSONArray(),JSONArray()).put("collections",incomingGroup))
        val layout=store.load().getJSONObject("core").getJSONObject("collections")
        assertEquals("local-group",layout.getJSONObject("assignments").getString("track:stable"))
        assertEquals("Keep locally",(0 until layout.getJSONArray("groups").length()).map{layout.getJSONArray("groups").getJSONObject(it)}.first{it.getString("id")=="local-group"}.getString("name"))
    }

    @Test fun v1UnknownExtensionsSurviveNormalizationAndImport() {
        val v1 = JSONObject().put("format", "guanyun-backup").put("version", 1)
            .put("tracks", JSONArray()).put("annotations", JSONArray()).put("favorites", JSONArray())
            .put("vendorExtension", JSONObject().put("vendor", JSONArray().put("opaque")))
        store.importWorkspace(ByteArrayInputStream(v1.toString().toByteArray()))
        assertEquals("opaque", store.load().getJSONObject("core").getJSONObject("vendorExtension").getJSONArray("vendor").getString(0))
    }

    @Test fun rejectsMalformedBase64WithoutChangingStoredSnapshot() {
        store.upsert("tracks", track("stable", "keep"))
        val before = store.load().toString()
        val invalidPhoto = JSONObject().put("id", "p").put("name", "Photo").put("trackId", "t").put("trackName", "Track")
            .put("time", 1).put("coordinates", JSONArray().put(1).put(2)).put("kind", "point")
            .put("mime", "image/jpeg").put("previewBase64", "!!!!")
        val error = runCatching { store.importWorkspace(ByteArrayInputStream(workspace(JSONArray()).put("photos", JSONArray().put(invalidPhoto)).toString().toByteArray())) }.exceptionOrNull()
        assertNotNull(error)
        assertEquals(before, store.load().toString())
    }

    @Test fun removesOnlyRequestedEntityAndDoesNotCascadeToAnchorsOrFavorites() {
        val pin = JSONObject().put("id", "pin-a").put("kind", "pin").put("name", "Pin").put("note", "")
            .put("color", "#112233").put("coordinates", JSONArray().put(10).put(20)).put("groundElevation", JSONObject.NULL)
            .put("placement", "surface").put("offset", 0).put("width", 1).put("length", 1).put("height", 1)
            .put("heading", 0).put("pitch", 0).put("roll", 0).put("opacity", .85).put("visible", true).put("trackAnchor", JSONObject().put("trackId", "track-a").put("distance", 10))
        val core = workspace(JSONArray().put(track("track-a", "route"))).getJSONObject("core")
            .put("annotations", JSONArray().put(pin))
        importValue(workspace(JSONArray()).put("core", core))
        store.remove("tracks", "track-a")
        val after = store.load().getJSONObject("core")
        assertEquals(0, after.getJSONArray("tracks").length())
        assertEquals("track-a", after.getJSONArray("annotations").getJSONObject(0).getJSONObject("trackAnchor").getString("trackId"))
        assertEquals(0, after.getJSONArray("favorites").length())
    }

    @Test fun rejectsStringFractionalAndOverflowIntegersWithoutChangingStoredSnapshot() {
        store.upsert("tracks", track("stable", "keep"))
        val before = store.load().toString()
        val wrongVersions = listOf("2", 2.5, 4_294_967_298L)
        for (version in wrongVersions) {
            val value = workspace(JSONArray()).put("version", version)
            assertNotNull(runCatching { importValue(value) }.exceptionOrNull())
            assertEquals(before, store.load().toString())
        }
        val wrongCoreVersion = workspace(JSONArray())
        wrongCoreVersion.getJSONObject("core").put("version", "1")
        assertNotNull(runCatching { importValue(wrongCoreVersion) }.exceptionOrNull())
        assertEquals(before, store.load().toString())

        val fractionalSetting = workspace(JSONArray())
        fractionalSetting.getJSONObject("settings").put(
            "guanyun.track-style.v1",
            JSONObject().put("color", "#123456").put("width", 2).put("pointSize", 4.5).toString(),
        )
        assertNotNull(runCatching { importValue(fractionalSetting) }.exceptionOrNull())
        assertEquals(before, store.load().toString())

        val overflowMap = JSONObject().put("id", "map").put("name", "Map").put("kind", "online")
            .put("format", "png").put("attribution", "").put("minzoom", 4_294_967_297L)
            .put("maxzoom", 4_294_967_297L).put("tileSize", 256).put("bytes", 0)
            .put("tiles", JSONArray().put("https://tiles.example/{z}/{x}/{y}.png"))
        val invalidMap = workspace(JSONArray()).put("mapSources", JSONArray().put(overflowMap))
        assertNotNull(runCatching { importValue(invalidMap) }.exceptionOrNull())
        assertEquals(before, store.load().toString())
    }

    @Test fun exportAndUpsertPersistAndExportRecognizedEnvelope() {
        store.upsert("tracks", track("t", "name"))
        val output = ByteArrayOutputStream()
        store.exportWorkspace(output)
        val exported = JSONObject(output.toString(Charsets.UTF_8.name()))
        assertEquals("shantu-workspace", exported.getString("format"))
        assertEquals(2, exported.getInt("version"))
        assertEquals("name", find(exported.getJSONObject("core").getJSONArray("tracks"), "t").getString("name"))
    }

    @Test fun collectionBatchUndoRestoresOnlyAffectedObjectsAndMetadata() {
        store.upsert("tracks", track("bulk-a", "A").put("vendor", JSONObject().put("keep", 7)))
        store.upsert("tracks", track("bulk-b", "B"))
        val workspaceBefore = store.load()
        workspaceBefore.getJSONObject("core").put("regions", JSONObject().put("track:bulk-b", region("四川", "成都")))
        importValue(workspaceBefore)
        val layout = NativeCollections.defaultLayout()
            .put("assignments", JSONObject().put("track:bulk-a", "manual").put("track:bulk-b", "manual"))
            .put("order", JSONArray().put("track:bulk-a").put("track:bulk-b"))
            .put("treeOrder", JSONArray().put("folder:manual").put("track:bulk-a").put("track:bulk-b"))
            .put("vendorLayout", JSONObject().put("unknown", true))
        store.updateCollections(layout)
        val expected = store.load().getJSONObject("core").getJSONObject("collections")
        val next = NativeCollections.removeItems(expected, listOf("track:bulk-b"))
        val token = store.applyCollectionBatch(
            mapOf(CollectionRecordRef("tracks", "bulk-a") to false),
            listOf(CollectionRecordRef("tracks", "bulk-b")),
            expected,
            next,
        )
        store.upsert("tracks", track("unrelated", "Added later"))

        assertTrue(store.undoCollectionBatch(token))
        val core = store.load().getJSONObject("core")
        val tracks = core.getJSONArray("tracks")
        assertEquals(3, tracks.length())
        assertEquals("A", find(tracks, "bulk-a").getString("name"))
        // The fixture had no hidden field. Undo restores that original shape instead of
        // manufacturing an explicit hidden=false value.
        assertFalse(find(tracks, "bulk-a").has("hidden"))
        assertEquals(7, find(tracks, "bulk-a").getJSONObject("vendor").getInt("keep"))
        assertEquals("B", find(tracks, "bulk-b").getString("name"))
        assertEquals("Added later", find(tracks, "unrelated").getString("name"))
        val restored = core.getJSONObject("collections")
        assertEquals("track:bulk-b", restored.getJSONArray("order").getString(1))
        assertTrue(restored.getJSONObject("vendorLayout").getBoolean("unknown"))
        assertEquals("成都", core.getJSONObject("regions").getJSONObject("track:bulk-b").getString("city"))
    }

    @Test fun collectionBatchRejectsStaleMetadataWithoutChangingRecords() {
        store.upsert("tracks", track("t", "Keep"))
        // Collection metadata is lazily initialized; a new workspace has no persisted
        // collections key until its first organization change.
        val stale = store.load().getJSONObject("core").optJSONObject("collections")
            ?: NativeCollections.defaultLayout()
        val changed = NativeCollections.createFolder(stale, "Concurrent", id = "concurrent")
        store.updateCollections(changed)
        val before = store.load().toString()
        val error = runCatching {
            store.applyCollectionBatch(mapOf(CollectionRecordRef("tracks", "t") to false), emptyList(), stale, stale)
        }.exceptionOrNull()
        assertNotNull(error)
        assertEquals(before, store.load().toString())
    }

    @Test fun collectionTransformAndManualRegionChangeCommitAndUndoAtomically() {
        val record=track("move-me","route").put("segments",JSONArray().put(JSONArray().put(JSONArray().put(10).put(20).put(5)).put(JSONArray().put(10.001).put(20).put(6)))).put("vendor",JSONObject().put("branch","keep"))
        store.upsert("tracks",record)
        val ref=CollectionRecordRef("tracks","move-me");val expected=NativeCollections.defaultLayout();val before=store.load().getJSONObject("core").getJSONArray("tracks").getJSONObject(0).toString()
        val updated=NativeCollectionTransform.transformBatch(listOf(ref to record),NativeCollectionTransformSpec(eastMeters=100.0,upMeters=3.0)).getValue(ref)
        val key="track:move-me";val region=JSONObject().put("coordinateKey","10.000000,20.000000").put("country","中国").put("province","四川").put("city","成都").put("source","manual").put("checkedAt",7)
        val token=store.applyCollectionBatch(emptyMap(),emptyList(),expected,expected,updates=mapOf(ref to updated),regionChanges=mapOf(key to region),expectedRecords=mapOf(ref to record),expectedRegionValues=mapOf(key to null))
        val saved=store.load().getJSONObject("core");val savedTrack=saved.getJSONArray("tracks").getJSONObject(0)
        assertNotEquals(10.0,savedTrack.getJSONArray("segments").getJSONArray(0).getJSONArray(0).getDouble(0),0.0);assertEquals(8.0,savedTrack.getJSONArray("segments").getJSONArray(0).getJSONArray(0).getDouble(2),0.0);assertEquals("keep",savedTrack.getJSONObject("vendor").getString("branch"));assertEquals("成都",saved.getJSONObject("regions").getJSONObject(key).getString("city"))
        assertTrue(store.undoCollectionBatch(token));val restored=store.load().getJSONObject("core");assertEquals(before,restored.getJSONArray("tracks").getJSONObject(0).toString());assertFalse(restored.has("regions"))
    }

    @Test fun invalidTransformUpdateAndRegionNeverPartiallyCommit() {
        val record=track("stable","before");store.upsert("tracks",record);val before=store.load().toString();val ref=CollectionRecordRef("tracks","stable");val invalid=JSONObject(record.toString()).put("segments",JSONArray().put(JSONArray().put(JSONArray().put(999).put(20))))
        val region=JSONObject().put("coordinateKey","10.000000,20.000000").put("country","").put("province","X").put("city","").put("source","manual").put("checkedAt",1)
        assertNotNull(runCatching{store.applyCollectionBatch(emptyMap(),emptyList(),NativeCollections.defaultLayout(),NativeCollections.defaultLayout(),updates=mapOf(ref to invalid),regionChanges=mapOf("track:stable" to region),expectedRecords=mapOf(ref to record),expectedRegionValues=mapOf("track:stable" to null))}.exceptionOrNull())
        assertEquals(before,store.load().toString())
    }

    @Test fun recoversAtomicFileBackupWhenBaseFileIsMissing() {
        store.upsert("tracks", track("saved", "from-backup"))
        val base = context.filesDir.resolve("workspace-v2.json")
        val backup = context.filesDir.resolve("workspace-v2.json.bak")
        assertTrue(base.renameTo(backup))
        assertFalse(base.exists())

        val recovered = WorkspaceStore(context).load()
        assertEquals("from-backup", find(recovered.getJSONObject("core").getJSONArray("tracks"), "saved").getString("name"))
        assertTrue("AtomicFile.openRead should restore the backup as the base file", base.exists())
    }

    private fun workspace(tracks: JSONArray) = JSONObject()
        .put("format", "shantu-workspace").put("version", 2)
        .put("core", JSONObject().put("format", "guanyun-backup").put("version", 1)
            .put("tracks", tracks).put("annotations", JSONArray()).put("favorites", JSONArray()))
        .put("photos", JSONArray()).put("settings", JSONObject()).put("mapSources", JSONArray())
        .put("cadDocuments", JSONArray()).put("industryProjects", JSONArray()).put("limitations", JSONArray())

    private fun legacy(tracks: JSONArray, annotations: JSONArray, favorites: JSONArray, sections: JSONArray) = JSONObject()
        .put("format", "guanyun-backup").put("version", 1).put("tracks", tracks).put("annotations", annotations).put("favorites", favorites).put("sections", sections)

    private fun section(id: String, marker: Int) = JSONObject().put("id", id).put("name", "Section $marker")
        .put("settings", sectionSettings(id).put("marker", marker))

    private fun annotation(id: String) = JSONObject().put("id", id).put("kind", "pin").put("name", "Pin").put("note", "")
        .put("color", "#112233").put("coordinates", JSONArray().put(10).put(20)).put("groundElevation", JSONObject.NULL)
        .put("placement", "surface").put("offset", 0).put("width", 1).put("length", 1).put("height", 1)
        .put("heading", 0).put("pitch", 0).put("roll", 0).put("opacity", .85).put("visible", true)

    private fun importValue(value: JSONObject) = store.importWorkspace(ByteArrayInputStream(value.toString().toByteArray()))

    private fun track(id: String, name: String) = JSONObject()
        .put("id", id).put("name", name).put("createdAt", 1)
        .put("segments", JSONArray().put(JSONArray().put(JSONArray().put(10).put(20))))

    private fun region(province: String, city: String) = JSONObject()
        .put("coordinateKey", "10.000000,20.000000").put("country", "中国").put("province", province).put("city", city)
        .put("source", "manual").put("checkedAt", 1)

    private fun group(id: String, name: String) = JSONObject().put("id", id).put("name", name).put("color", "#112233")

    private fun sectionSettings(id: String) = JSONObject().put("enabled", true).put("objectId", id).put("altitude", 0)
        .put("color", "#112233").put("plane", JSONObject().put("center", JSONArray().put(10).put(20)).put("width", 100).put("height", 100).put("heading", 0).put("tilt", 0))

    private fun savedNotes(settings: JSONObject, id: String, content: String) = JSONObject().put("settings", JSONObject(settings.toString())).put("savedAt", 1)
        .put("notes", JSONArray().put(JSONObject().put("id", id).put("name", "note").put("note", content).put("fields", JSONArray())
            .put("curveName", "terrain").put("source", "terrain").put("sampledAt", 1)
            .put("point", JSONObject().put("u", 0).put("v", 0).put("altitude", 1).put("distance", 1)
                .put("coordinates", JSONArray().put(10).put(20)).put("local", JSONArray().put(0).put(0).put(0)))))

    private fun find(array: JSONArray, id: String): JSONObject = (0 until array.length()).map { array.getJSONObject(it) }.first { it.optString("id") == id }
}
