package com.shantu.nativeapp.hybrid

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
class NativeBridgeSectionTerrainTest {
    @Test fun `enabled section forces terrain and ignores saved legacy scale`() {
        val saved = JSONObject().put("terrain", false).put("exaggeration", 3.0).put("roads", true)
            .put("extension", JSONObject().put("retained", 7))
        val effective = NativeBridgeSectionTerrain.effective(saved, JSONObject().put("enabled", true))
        assertTrue(effective.getBoolean("terrain"))
        assertFalse(effective.has("exaggeration"))
        assertTrue(effective.getBoolean("roads"))
        assertFalse(saved.getBoolean("terrain"))
        assertEquals(3.0, saved.getDouble("exaggeration"), 0.0)
        effective.getJSONObject("extension").put("retained", 9)
        assertEquals(7, saved.getJSONObject("extension").getInt("retained"))
    }

    @Test fun `section exit restores terrain preference and keeps ignoring legacy scale`() {
        val saved = JSONObject().put("terrain", false).put("exaggeration", 2.5)
        assertTrue(NativeBridgeSectionTerrain.effective(saved, JSONObject().put("enabled", true)).getBoolean("terrain"))
        saved.put("exaggeration", 4.0)
        val disabled = NativeBridgeSectionTerrain.effective(saved, JSONObject().put("enabled", false))
        assertFalse(disabled.getBoolean("terrain"))
        assertFalse(disabled.has("exaggeration"))
        assertEquals(disabled.toString(), NativeBridgeSectionTerrain.effective(saved, null).toString())
    }

    @Test fun `forced terrain also applies to survey sections and direct mode requests`() {
        val section = JSONObject().put("enabled", true).put("survey", JSONObject())
        val request = JSONObject().put("terrain", false)
        val effective = NativeBridgeSectionTerrain.effective(request, section)
        assertTrue(effective.getBoolean("terrain"))
        assertFalse(effective.has("exaggeration"))
        assertFalse(request.has("exaggeration"))
        val unchanged = NativeBridgeSectionTerrain.effective(request, JSONObject().put("enabled", false))
        assertFalse(unchanged.has("exaggeration"))
    }
}
