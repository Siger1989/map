package com.shantu.nativeapp.floating

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.RuntimeEnvironment

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], manifest = Config.NONE)
class FloatingTerrainOptionPayloadTest {
    private fun positionPayload(value: Any) = JSONObject()
        .put("version", 1)
        .put("kind", "position")
        .put("mode", "north")
        .put("coordinates", JSONArray())
        .put("outdoorContours", value)

    @Test fun legacyOutdoorPayloadAlwaysFallsBackToOrdinaryMap() {
        assertEquals(false, FloatingNavigationService.validatePayload(positionPayload(true)).getBoolean("outdoorContours"))
        assertEquals(false, FloatingNavigationService.validatePayload(positionPayload(false)).getBoolean("outdoorContours"))
        for (invalid in listOf("true", 1, JSONObject.NULL, JSONObject(), emptyList<String>())) {
            assertThrows(IllegalArgumentException::class.java) {
                FloatingNavigationService.validatePayload(positionPayload(invalid))
            }
        }
    }

    @Test fun previouslySavedTruePreferenceIsIgnoredAndPreserved() {
        val context = RuntimeEnvironment.getApplication()
        val prefs = context.getSharedPreferences("floating_navigation_state", 0)
        val hadValue = prefs.contains("outdoorContours")
        val previous = prefs.getBoolean("outdoorContours", false)
        prefs.edit().putBoolean("outdoorContours", true).apply()

        assertEquals(false, FloatingNavigationService.status(context).getBoolean("outdoorContours"))
        assertEquals(true, prefs.getBoolean("outdoorContours", false))
        if (hadValue) prefs.edit().putBoolean("outdoorContours", previous).apply()
        else prefs.edit().remove("outdoorContours").apply()
    }
}
