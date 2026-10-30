package com.shantu.nativeapp.map

/** Snapshot of the real render-layer/source state used to suppress explicitly hidden tile requests. */
internal data class NativeTileLayerVisibilityState(
    val tiandituSourceNamespace: String,
    val selectedTiandituBaseLayer: String?,
    val legacyRasterVisible: Boolean,
    val legacyBaseLayerEnabled: Boolean,
    val tiandituKeyConfigured: Boolean,
    val cartographyLabelLayer: String?,
    val cartographyLabelEnabled: Boolean,
    val cartographyLabelOpacity: Float,
    val boundaryEnabled: Boolean,
    val currentCustomSourceNamespace: String?,
    val customLayerStyles: Map<String, String>,
    val customLayerEnabled: Map<String, Boolean>,
    val sentinelDetailSourceNamespace: String,
    val gibsSourceNamespace: String,
    val gibsProbeSourceNamespace: String,
    val terrainDemSourceNamespace: String,
    val sentinelDetailVisible: Boolean,
    val sentinelLatestVisible: Boolean,
    val terrainDemVisible: Boolean,
)

/** Production visibility policy. Unknown/retired sources are inactive until explicitly wired. */
internal object NativeTileLayerVisibility {
    fun isActive(identity: TileRequestIdentity, state: NativeTileLayerVisibilityState): Boolean {
        if (identity.sourceId == state.tiandituSourceNamespace) {
            return when (identity.layerId) {
                "img", "vec", "ter" -> state.tiandituKeyConfigured && state.legacyRasterVisible &&
                    state.currentCustomSourceNamespace == null && state.legacyBaseLayerEnabled &&
                    state.selectedTiandituBaseLayer == identity.layerId
                "cia", "cva", "cta" -> state.tiandituKeyConfigured &&
                    state.cartographyLabelLayer == identity.layerId && state.cartographyLabelEnabled &&
                    state.cartographyLabelOpacity > 0f
                "ibo" -> state.tiandituKeyConfigured && state.boundaryEnabled
                else -> false
            }
        }
        if (state.currentCustomSourceNamespace != null && identity.sourceId == state.currentCustomSourceNamespace) {
            val layerEnabled = state.customLayerEnabled[identity.layerId] == true
            val styleMatches = state.customLayerStyles[identity.layerId] == identity.styleNamespace
            return state.legacyRasterVisible && layerEnabled && styleMatches
        }
        return when (identity.sourceId) {
            state.sentinelDetailSourceNamespace -> state.sentinelDetailVisible
            state.gibsSourceNamespace -> state.sentinelLatestVisible
            state.gibsProbeSourceNamespace -> state.sentinelLatestVisible
            state.terrainDemSourceNamespace -> state.terrainDemVisible
            else -> false
        }
    }
}
