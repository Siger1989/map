package com.shantu.nativeapp.floating

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], manifest = Config.NONE)
class FloatingTerrainOptionPayloadTest {
    private fun positionPayload(value: Any) = JSONObject()
        .put("version", 1)
        .put("kind", "position")
        .put("mode", "north")
        .put("coordinates", JSONArray())
        .put("outdoorContours", value)

    @Test fun servicePayloadKeepsOnlyStrictOutdoorBoolean() {
        assertEquals(true, FloatingNavigationService.validatePayload(positionPayload(true)).getBoolean("outdoorContours"))
        assertEquals(false, FloatingNavigationService.validatePayload(positionPayload(false)).getBoolean("outdoorContours"))
        for (invalid in listOf("true", 1, JSONObject.NULL, JSONObject(), emptyList<String>())) {
            assertThrows(IllegalArgumentException::class.java) {
                FloatingNavigationService.validatePayload(positionPayload(invalid))
            }
        }
    }
}
