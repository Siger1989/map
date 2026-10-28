package com.shantu.nativeapp.hybrid

/** Source-specific evidence required before a print map can be reported as rendered. */
internal object NativeShareReadinessPolicy {
    /** Whether the selected cartography plan actually enables a visible MVT layer. */
    fun requiresVisibleMvt(plan: com.shantu.nativeapp.map.NativeCartographyPlan): Boolean =
        plan.roads || plan.roadNames || plan.placeLabels || plan.effectiveBase in setOf("terrain", "offline")

    fun isReady(
        sourceId: String,
        satelliteReady: Boolean,
        imageryTileDelta: Long,
        visibleMvtTiles: Int,
        roadsRequired: Boolean,
        firstFrameRendered: Boolean,
        sourceRasterTileDelta: Long = 0,
        pendingSourceLoads: Int = 0,
    ): Boolean {
        if (!firstFrameRendered || pendingSourceLoads > 0) return false
        val sourceReady = when {
            sourceId == "sentinel-latest" -> satelliteReady && imageryTileDelta > 0
            sourceId == "sentinel-detail" -> satelliteReady && imageryTileDelta > 0
            // These counters belong to the process-wide pool and may be advanced by the visible map.
            // Offline sources without a controller-local decoded raster tile fail closed here.
            else -> sourceRasterTileDelta > 0
        }
        return sourceReady && (!roadsRequired || visibleMvtTiles > 0)
    }
}
