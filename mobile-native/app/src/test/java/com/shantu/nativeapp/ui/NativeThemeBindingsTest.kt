package com.shantu.nativeapp.ui

import android.graphics.Color
import android.widget.TextView
import com.shantu.nativeapp.appearance.NativeAppearanceTokens
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NativeThemeBindingsTest {
    @Test fun appliesSemanticRolesAndLeavesUnboundUserColorsUntouched() {
        val context = RuntimeEnvironment.getApplication()
        val bindings = NativeThemeBindings()
        val semantic = TextView(context)
        val userColor = TextView(context).apply { setTextColor(Color.MAGENTA) }
        bindings.bindText(semantic, NativeThemeRole.ACCENT)

        val dark = NativeAppearanceTokens.tokens(NativeAppearanceTokens.defaultAppearance(), systemDark = true)
        val lightAppearance = NativeAppearanceTokens.updateMode(NativeAppearanceTokens.defaultAppearance(), "light")
        val light = NativeAppearanceTokens.tokens(lightAppearance, systemDark = true)
        bindings.apply(dark)
        assertEquals(dark.accent, semantic.currentTextColor)
        bindings.apply(light)
        assertEquals(light.accent, semantic.currentTextColor)
        assertEquals(Color.MAGENTA, userColor.currentTextColor)
    }
}
