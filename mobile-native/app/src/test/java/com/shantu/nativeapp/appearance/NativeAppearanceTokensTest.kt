package com.shantu.nativeapp.appearance

import android.graphics.Color
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
class NativeAppearanceTokensTest {
    @Test fun defaultsAndSystemModeResolveSemanticTokens() {
        val defaults = NativeAppearanceTokens.defaultAppearance()
        assertEquals("dark", defaults.getString("mode"))
        assertEquals("dark", NativeAppearanceTokens.resolvedScheme(defaults, false))
        assertEquals(Color.rgb(24, 32, 31), NativeAppearanceTokens.tokens(defaults, false).surface)

        val system = NativeAppearanceTokens.updateMode(defaults, "system")
        assertEquals("light", NativeAppearanceTokens.resolvedScheme(system, false))
        assertEquals("dark", NativeAppearanceTokens.resolvedScheme(system, true))
        assertEquals(Color.WHITE, NativeAppearanceTokens.tokens(system, false).surface)
    }

    @Test fun presetAndResetChangeKnownValuesButRetainUnknownMetadata() {
        val value = NativeAppearanceTokens.defaultAppearance()
        value.put("customRoot", JSONObject().put("keep", 7))
        value.getJSONObject("dark").put("customPalette", "retained")

        val preset = NativeAppearanceTokens.applyPreset(value, "湖蓝")
        assertEquals("#7cc7ff", preset.getJSONObject("dark").getString("accent"))
        assertEquals("retained", preset.getJSONObject("dark").getString("customPalette"))
        assertEquals(7, preset.getJSONObject("customRoot").getInt("keep"))

        val reset = NativeAppearanceTokens.resetKnownDefaults(preset)
        assertEquals("#d0f76b", reset.getJSONObject("dark").getString("accent"))
        assertEquals("retained", reset.getJSONObject("dark").getString("customPalette"))
        assertEquals(7, reset.getJSONObject("customRoot").getInt("keep"))
    }

    @Test fun invalidKnownValuesNormalizeAndColorsMaintainContrast() {
        val malformed = JSONObject()
            .put("mode", "night")
            .put("light", JSONObject().put("accent", "#xyz"))
        val normalized = NativeAppearanceTokens.normalize(malformed)
        assertEquals("dark", normalized.getString("mode"))
        assertEquals("#15572b", normalized.getJSONObject("light").getString("accent"))
        assertTrue(NativeAppearanceTokens.isHex("#aBc123"))
        assertFalse(NativeAppearanceTokens.isHex("#abc"))

        val tokens = NativeAppearanceTokens.tokens(normalized, true)
        assertTrue(NativeAppearanceTokens.contrastRatio("#18201f", "#f2f5ed") >= 4.5)
        assertEquals("#d0f76b", tokens.asHexMap()["--ui-accent"])
    }

    @Test fun editsCopyObjectsAndDoNotMutateOriginal() {
        val original = NativeAppearanceTokens.defaultAppearance()
        val updated = NativeAppearanceTokens.updatePalette(original, "dark", "accent", "#123456")
        assertEquals("#d0f76b", original.getJSONObject("dark").getString("accent"))
        assertEquals("#123456", updated.getJSONObject("dark").getString("accent"))
        assertEquals(18, NativeAppearanceTokens.tokens(original, true).glassBlurDp)
    }
}
