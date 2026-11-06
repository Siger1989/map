package com.shantu.nativeapp.hybrid

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NativeGeologySettingsTest {
    @Test fun reactToggleAndLegacyProtocolBothControlTheActualLayer() {
        assertTrue(NativeGeologySettings.enabled(JSONObject().put("geology", true).put("geologySource", "geocloud20w")))
        assertFalse(NativeGeologySettings.enabled(JSONObject().put("geology", false).put("geologySource", "geocloud20w")))
        assertTrue(NativeGeologySettings.enabled(JSONObject().put("geologyEnabled", true)))
        assertFalse(NativeGeologySettings.enabled(JSONObject().put("geologyEnabled", false).put("geology", true)))
        assertFalse(NativeGeologySettings.enabled(JSONObject().put("geologySource", "geocloud20w")))
    }
}
