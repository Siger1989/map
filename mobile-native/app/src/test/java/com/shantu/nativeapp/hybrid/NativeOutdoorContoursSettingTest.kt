package com.shantu.nativeapp.hybrid

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], manifest = Config.NONE)
class NativeOutdoorContoursSettingTest {
    @Test fun omittedLegacySettingDefaultsToStandardTerrainMode() {
        assertEquals(false, NativeOutdoorContoursSetting.parse(null))
        assertEquals(false, NativeOutdoorContoursSetting.parse(JSONObject()))
    }

    @Test fun acceptsOnlyJsonBooleans() {
        assertEquals(true, NativeOutdoorContoursSetting.parse(JSONObject().put("outdoorContours", true)))
        assertEquals(false, NativeOutdoorContoursSetting.parse(JSONObject().put("outdoorContours", false)))
        for (invalid in listOf("true", "false", 1, 0, JSONObject.NULL, JSONObject(), emptyList<String>())) {
            assertThrows(IllegalArgumentException::class.java) {
                NativeOutdoorContoursSetting.parse(JSONObject().put("outdoorContours", invalid))
            }
        }
    }
}
