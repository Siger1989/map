package com.shantu.nativeapp.hybrid

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeBridgeShareLayerPolicyTest {
    @Test fun builtInTiandituHidesLegacyRasterLabelsWhenCartographyOwnsAnnotations() {
        assertEquals(0.0, NativeBridgeShareLayerPolicy.legacyRasterLabelOpacity(false, true, 0.85), 0.0)
    }

    @Test fun customRasterOverlayUsesTheConfiguredLabelOpacityOnlyWhenEnabled() {
        assertEquals(0.65, NativeBridgeShareLayerPolicy.legacyRasterLabelOpacity(true, true, 0.65), 0.0)
        assertEquals(0.0, NativeBridgeShareLayerPolicy.legacyRasterLabelOpacity(true, false, 0.65), 0.0)
    }

    @Test fun opacityIsClampedToTheNativeLayerRange() {
        assertEquals(1.0, NativeBridgeShareLayerPolicy.legacyRasterLabelOpacity(true, true, 1.5), 0.0)
        assertEquals(0.0, NativeBridgeShareLayerPolicy.legacyRasterLabelOpacity(true, true, -0.5), 0.0)
    }

    @Test fun mercatorLeafWitnessIsRequiredOnlyForInstrumentedBaseLayers() {
        assertTrue(NativeBridgeShareLayerPolicy.requiresMercatorLeafCoverage("tianditu-imagery", null))
        assertTrue(NativeBridgeShareLayerPolicy.requiresMercatorLeafCoverage("custom", "online"))
        assertFalse(NativeBridgeShareLayerPolicy.requiresMercatorLeafCoverage("custom", "mbtiles"))
        assertFalse(NativeBridgeShareLayerPolicy.requiresMercatorLeafCoverage("custom", "geotiff"))
        assertFalse(NativeBridgeShareLayerPolicy.requiresMercatorLeafCoverage("custom", "image"))
        assertFalse(NativeBridgeShareLayerPolicy.requiresMercatorLeafCoverage("sentinel-detail", null))
    }
}
