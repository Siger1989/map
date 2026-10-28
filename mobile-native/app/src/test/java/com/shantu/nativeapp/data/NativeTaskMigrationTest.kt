package com.shantu.nativeapp.data

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class NativeTaskMigrationTest {
    @Test fun parsesOnlyTaskAllowlistAndConvertsRecordingFixesToTrackSamples() {
        val input = JSONObject().put("format", NativeTaskMigration.FORMAT).put("version", 1).put("createdAt", 100)
            .put("draft", JSONObject().put("id", "draft-1").put("name", "draft").put("createdAt", 50).put("source", "manual")
                .put("segments", JSONArray().put(JSONArray().put(JSONArray().put(10).put(20)))))
            .put("recording", JSONObject().put("id", "record-1").put("phase", "recording").put("startedAt", 60)
                .put("segments", JSONArray().put(JSONArray().put(JSONObject().put("coordinates", JSONArray().put(11).put(21)).put("time", 61).put("accuracy", 5).put("altitude", JSONObject.NULL)))))
            .put("fileReferences", JSONArray().put(JSONObject().put("displayName", "route.gpx").put("purpose", "需重新选择")))
        val migration = NativeTaskMigration.parse(input.toString())
        assertEquals(2, migration.toTracks().size)
        assertEquals("recorded", migration.recording!!.getString("source"))
        assertEquals(61, migration.recording.getJSONArray("samples").getJSONArray(0).getJSONObject(0).getLong("time"))
        assertTrue(migration.fileReferences.getJSONObject(0).getBoolean("reselectRequired"))
    }

    @Test fun rejectsUriGrantsAndUnexpectedCredentialFields() {
        val base = JSONObject().put("format", NativeTaskMigration.FORMAT).put("version", 1)
            .put("draft", JSONObject().put("id", "d").put("segments", JSONArray().put(JSONArray().put(JSONArray().put(10).put(20)))))
        val uri = JSONObject(base.toString()).put("fileReferences", JSONArray().put(JSONObject().put("displayName", "a").put("purpose", "b").put("uri", "content://source")))
        assertNotNull(runCatching { NativeTaskMigration.parse(uri.toString()) }.exceptionOrNull())
        val secret = JSONObject(base.toString()).put("token", "must-not-pass")
        assertNotNull(runCatching { NativeTaskMigration.parse(secret.toString()) }.exceptionOrNull())
    }
}
