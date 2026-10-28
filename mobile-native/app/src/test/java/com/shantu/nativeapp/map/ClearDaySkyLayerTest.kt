package com.shantu.nativeapp.map

import org.junit.Assert.assertEquals
import org.junit.Test

class ClearDaySkyLayerTest {
    @Test
    fun paletteMatchesTheExistingClearDaySky() {
        assertEquals(0x69b9e8, ClearDaySkyPalette.SKY_HEX)
        assertEquals(0xffffff, ClearDaySkyPalette.HORIZON_HEX)
        assertEquals(0xe5eff5, ClearDaySkyPalette.FOG_HEX)
    }

    @Test
    fun paletteBuildsNormalizedRgbShaderLiterals() {
        assertEquals("0.4117647, 0.7254902, 0.9098039", ClearDaySkyPalette.glslRgb(ClearDaySkyPalette.SKY_HEX))
        assertEquals("1.0, 1.0, 1.0", ClearDaySkyPalette.glslRgb(ClearDaySkyPalette.HORIZON_HEX))
        assertEquals("0.8980392, 0.9372549, 0.9607843", ClearDaySkyPalette.glslRgb(ClearDaySkyPalette.FOG_HEX))
    }
}
