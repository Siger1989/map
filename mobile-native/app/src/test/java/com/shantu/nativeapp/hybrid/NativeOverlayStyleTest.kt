package com.shantu.nativeapp.hybrid

import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NativeOverlayStyleTest {
    @Test fun cssWidthIsConvertedFromCssPixelsToNativePhysicalPixels() {
        assertEquals(8f, NativeOverlayStyle.widthInPixels(2.0, 4.0), 0.001f)
        assertEquals(0.5f, NativeOverlayStyle.widthInPixels(0.5, 1.0), 0.001f)
    }

    @Test fun rgbaAlphaAndFeatureOpacityAreMultiplied() {
        val color = NativeOverlayStyle.color("rgba(255, 64, 0, 0.5)", 0.4)
        assertEquals(1f, color.red, 0.001f)
        assertEquals(64f / 255f, color.green, 0.001f)
        assertEquals(0f, color.blue, 0.001f)
        assertEquals(0.2f, color.alpha, 0.001f)
    }

    @Test fun cssEightDigitHexAndPercentageChannelsAreSupported() {
        assertEquals(0.25f, NativeOverlayStyle.color("#ff000040", 1.0).alpha, 0.01f)
        assertEquals(0.5f, NativeOverlayStyle.color("rgb(50% 25% 0%)", 1.0).red, 0.001f)
        assertEquals(1f, NativeOverlayStyle.color("#f00", 1.0).red, 0.001f)
        assertEquals(0x88 / 255f, NativeOverlayStyle.color("#f008", 1.0).alpha, 0.01f)
    }

    @Test fun malformedColorsAndNonFiniteWidthsFallBackWithoutThrowing() {
        val color = NativeOverlayStyle.color("rgba(garbage)", Double.NaN)
        assertEquals(208f / 255f, color.red, 0.001f)
        assertEquals(247f / 255f, color.green, 0.001f)
        assertEquals(2f, NativeOverlayStyle.widthInPixels(Double.NaN, Double.POSITIVE_INFINITY), 0.001f)
    }

    @Test fun dashArrayIsSerializedAsARepeatingStippleRatherThanIgnoredOrSolid() {
        val even = NativeOverlayStyle.dashStyle(JSONArray("[2,2]"), 4.0, 3.0)
        assertEquals(0xff00.toShort(), even?.pattern)
        assertEquals(3, even?.factor)
        assertNotNull(NativeOverlayStyle.dashStyle(JSONArray("[3,2]"), 5.0, 3.0))
        assertEquals(null, NativeOverlayStyle.dashStyle(JSONArray("[0,2]"), 2.0, 3.0))
    }
}
