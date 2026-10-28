package com.shantu.nativeapp.hybrid

/** Rules for legacy overlay layers that the interactive host also applies before cartography. */
internal object NativeBridgeShareLayerPolicy {
    fun legacyRasterLabelOpacity(customSource: Boolean, labelsEnabled: Boolean, roadsOpacity: Double): Double {
        require(roadsOpacity.isFinite())
        return if (customSource && labelsEnabled) roadsOpacity.coerceIn(0.0, 1.0) else 0.0
    }

    /**
     * The print Mercator subclass only observes these base layers. Other sources have their own
     * readiness contracts and must not wait forever for a leaf snapshot it cannot produce.
     */
    fun requiresMercatorLeafCoverage(sourceId: String, customSourceKind: String?): Boolean =
        sourceId.startsWith("tianditu-") || (sourceId == "custom" && customSourceKind == "online")
}
