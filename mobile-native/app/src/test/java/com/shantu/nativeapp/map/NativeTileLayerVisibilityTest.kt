package com.shantu.nativeapp.map

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeTileLayerVisibilityTest {
    private val tdt = "tdt-hash"

    private fun identity(source: String, layer: String, style: String = "style") =
        TileRequestIdentity(source, layer, 8, 4, 3, style, "auth")

    private fun state(
        selectedTdtBase: String? = null,
        legacyVisible: Boolean = false,
        legacyBaseEnabled: Boolean = false,
        cartographyLabel: String? = null,
        cartographyLabelEnabled: Boolean = false,
        cartographyLabelOpacity: Float = 0f,
        boundaryEnabled: Boolean = false,
        customNamespace: String? = null,
        customStyles: Map<String, String> = emptyMap(),
        customEnabled: Map<String, Boolean> = emptyMap(),
    ) = NativeTileLayerVisibilityState(
        tiandituSourceNamespace = tdt,
        selectedTiandituBaseLayer = selectedTdtBase,
        legacyRasterVisible = legacyVisible,
        legacyBaseLayerEnabled = legacyBaseEnabled,
        tiandituKeyConfigured = true,
        cartographyLabelLayer = cartographyLabel,
        cartographyLabelEnabled = cartographyLabelEnabled,
        cartographyLabelOpacity = cartographyLabelOpacity,
        boundaryEnabled = boundaryEnabled,
        currentCustomSourceNamespace = customNamespace,
        customLayerStyles = customStyles,
        customLayerEnabled = customEnabled,
        sentinelDetailSourceNamespace = "sentinel-hash",
        gibsSourceNamespace = "gibs-hash",
        gibsProbeSourceNamespace = "probe-hash",
        terrainDemSourceNamespace = "terrain-hash",
        sentinelDetailVisible = false,
        sentinelLatestVisible = false,
        terrainDemVisible = false,
    )

    @Test fun `cartography annotation stays active when retired legacy labels are disabled`() {
        val actualRenderState = state(cartographyLabel = "cva", cartographyLabelEnabled = true, cartographyLabelOpacity = 0.8f)
        assertTrue(NativeTileLayerVisibility.isActive(identity(tdt, "cva"), actualRenderState))
        assertFalse(NativeTileLayerVisibility.isActive(identity(tdt, "cia"), actualRenderState))
    }

    @Test fun `boundary visibility is independent of selected custom base and legacy stack`() {
        val actualRenderState = state(boundaryEnabled = true, customNamespace = "custom-hash")
        assertTrue(NativeTileLayerVisibility.isActive(identity(tdt, "ibo"), actualRenderState))
        assertFalse(NativeTileLayerVisibility.isActive(identity(tdt, "img"), actualRenderState))
    }

    @Test fun `switched away custom source and stale style are inactive`() {
        val oldCustom = identity("old-custom-hash", "raster-0", "old-style")
        val currentCustomState = state(customNamespace = "new-custom-hash", customStyles = mapOf("raster-0" to "new-style"),
            customEnabled = mapOf("raster-0" to true), legacyVisible = true)
        assertFalse(NativeTileLayerVisibility.isActive(oldCustom, currentCustomState))
        assertFalse(NativeTileLayerVisibility.isActive(identity("new-custom-hash", "raster-0", "old-style"), currentCustomState))
        assertTrue(NativeTileLayerVisibility.isActive(identity("new-custom-hash", "raster-0", "new-style"), currentCustomState))
    }

    @Test fun `unregistered source is inactive`() {
        assertFalse(NativeTileLayerVisibility.isActive(identity("retired", "tile"), state()))
    }
}
