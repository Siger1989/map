package com.shantu.nativeapp.ui

import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import com.shantu.nativeapp.data.NativeSourceImport

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NativeSourceEditorTest {
    @Test
    fun `editing snapshot retains unknown root source fields and token without exposing them`() {
        var saved: JSONObject? = null
        val initial = JSONObject()
            .put("futureRoot", JSONObject().put("retain", true))
            .put("mapSources", JSONArray().put(JSONObject()
                .put("id", "custom-1")
                .put("name", "Fixture")
                .put("kind", "online")
                .put("format", "XYZ")
                .put("tiles", JSONArray().put("https://tiles.example.invalid/{z}/{x}/{y}?key=fixture-secret"))
                .put("minzoom", 0).put("maxzoom", 18).put("tileSize", 256)
                .put("scheme", "xyz").put("token", "fixture-secret")
                .put("futureField", JSONObject().put("retain", 7))))
        val editor = NativeSourceEditor(RuntimeEnvironment.getApplication(), initial, { saved = it }, {}, {})

        val snapshot = editor.currentConfiguration()
        val source = snapshot.getJSONArray("mapSources").getJSONObject(0)
        assertTrue(snapshot.getJSONObject("futureRoot").getBoolean("retain"))
        assertEquals(7, source.getJSONObject("futureField").getInt("retain"))
        assertEquals("fixture-secret", source.getString("token"))
        assertFalse(editor.toString().contains("fixture-secret"))
        assertEquals(null, saved)
    }

    @Test
    fun `import callback merges by source id and commits complete snapshot`() {
        var saved: JSONObject? = null
        val initial = JSONObject().put("mapSources", JSONArray().put(JSONObject()
            .put("id", "same").put("name", "Before").put("kind", "online").put("format", "XYZ")
            .put("tiles", JSONArray().put("https://old.example.invalid/{z}/{x}/{y}"))
            .put("minzoom", 0).put("maxzoom", 18).put("tileSize", 256).put("scheme", "xyz")
            .put("retainedExtension", "keep")))
        val editor = NativeSourceEditor(RuntimeEnvironment.getApplication(), initial, { saved = it }, {}, {})
        val imported = NativeSourceImport.parseJson("""
            {"mapSources":[{"id":"same","name":"After","kind":"online","format":"TMS","scheme":"tms","tiles":["https://new.example.invalid/{z}/{x}/{y}"],"minzoom":1,"maxzoom":17,"tileSize":256}]}
        """.trimIndent())
        val update = editor.acceptImport(imported)
        assertEquals(0, update.added)
        assertEquals(1, update.replaced)
        val saveControl = findTextControl(editor.view, "保存") ?: error("Save control not found")
        saveControl.performClick()
        assertEquals("After", saved?.getJSONArray("mapSources")?.getJSONObject(0)?.optString("name"))
        assertEquals("keep", saved?.getJSONArray("mapSources")?.getJSONObject(0)?.optString("retainedExtension"))
    }

    @Test fun `editing online sources preserves local blob affine path id and rejects id collision`() {
        val localFile = java.io.File.createTempFile("calibrated", ".png").apply { writeBytes(byteArrayOf(1, 2, 3, 4)) }
        try {
            val georef = JSONObject().put("sourceCrs", "EPSG:4326").put("affine", JSONArray(listOf(.5, 0.0, 10.0, 0.0, -.5, 21.0))).put("width", 2).put("height", 2)
            val local = JSONObject().put("id", "same-local-id").put("name", "Local registered image").put("kind", "image").put("format", "PNG image")
                .put("attribution", "field map").put("bounds", JSONArray(listOf(10.0, 20.0, 11.0, 21.0))).put("minzoom", 0).put("maxzoom", 22)
                .put("tileSize", 256).put("bytes", 4).put("filePath", localFile.absolutePath).put("blobMime", "image/png")
                .put("blobBase64", "AQIDBA==").put("imageGeoref", georef).put("futureOfflineField", JSONObject().put("preserve", true))
            val online = JSONObject().put("id", "online-1").put("name", "Online map").put("kind", "online").put("format", "XYZ")
                .put("tiles", JSONArray().put("https://tiles.example.invalid/{z}/{x}/{y}")).put("minzoom", 0).put("maxzoom", 18)
                .put("tileSize", 256).put("bytes", 0).put("attribution", "source")
            var saved: JSONObject? = null
            val editor = NativeSourceEditor(RuntimeEnvironment.getApplication(), JSONObject().put("mapSources", JSONArray().put(online).put(local)), { saved = it }, {}, {})
            val incoming = NativeSourceImport.parseJson("""{"maps":[{"id":"same-local-id","name":"incoming online","kind":"online","format":"XYZ","tiles":["https://new.example.invalid/{z}/{x}/{y}"],"minzoom":0,"maxzoom":18,"tileSize":256}]}""")
            val update = editor.acceptImport(incoming)
            assertEquals(0, update.added); assertEquals(0, update.replaced); assertEquals(1, update.skippedAtLimit)
            val localRow = editor.currentConfiguration().getJSONArray("mapSources").getJSONObject(1)
            assertEquals(local.getString("id"), localRow.getString("id"))
            assertEquals(local.getString("filePath"), localRow.getString("filePath"))
            assertEquals(local.getString("blobBase64"), localRow.getString("blobBase64"))
            assertEquals(local.getJSONObject("imageGeoref").toString(), localRow.getJSONObject("imageGeoref").toString())
            assertEquals(true, localRow.getJSONObject("futureOfflineField").getBoolean("preserve"))
            val localRowButton = findTextControl(editor.view, "Local registered image\n本地离线文件 · 在离线地图管理中查看/移除")
            assertNotNull(localRowButton); localRowButton!!.performClick()
            findTextControl(editor.view, "保存")!!.performClick()
            val persistedLocal = saved!!.getJSONArray("mapSources").getJSONObject(1)
            assertEquals(local.toString(), persistedLocal.toString())
            assertEquals(1, editor.onlineDefinitions().length())
        } finally { localFile.delete() }
    }

    private fun findTextControl(view: View, text: String): TextView? {
        if (view is TextView && view.text.toString() == text && view.isClickable) return view
        if (view is ViewGroup) for (index in 0 until view.childCount) findTextControl(view.getChildAt(index), text)?.let { return it }
        return null
    }
}
