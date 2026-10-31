package com.shantu.nativeapp.map

import android.graphics.Color as AndroidColor
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NativeAreaStyleTest {
    @Test
    fun `saved area fill matches web opacity and preserves its RGB color`() {
        val savedColor = AndroidColor.parseColor("#d0f76b")
        val attributes = NativeAreaStyle.attributes(savedColor, 2f)

        assertEquals(AndroidColor.red(savedColor) / 255f, attributes.interiorColor.red, 0.001f)
        assertEquals(AndroidColor.green(savedColor) / 255f, attributes.interiorColor.green, 0.001f)
        assertEquals(AndroidColor.blue(savedColor) / 255f, attributes.interiorColor.blue, 0.001f)
        assertEquals(0.22f, attributes.interiorColor.alpha, 0.001f)
        assertEquals(1f, attributes.outlineColor.alpha, 0.001f)
        assertEquals(2f, attributes.outlineWidth, 0.001f)
        assertTrue(attributes.isDrawInterior)
        assertTrue(attributes.isDrawOutline)
    }

    @Test
    fun `saved ARGB fill opacity multiplies the existing color alpha`() {
        val savedColor = AndroidColor.parseColor("#80d0f76b")

        assertEquals(128f / 255f * 0.22f, NativeAreaStyle.attributes(savedColor, 3f).interiorColor.alpha, 0.001f)
    }
}
