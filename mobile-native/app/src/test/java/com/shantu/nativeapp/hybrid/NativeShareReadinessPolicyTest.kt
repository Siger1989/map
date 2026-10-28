package com.shantu.nativeapp.hybrid

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeShareReadinessPolicyTest {
    @Test fun onlyActuallyEnabledVisibleCartographyMvtLayersAreRequired() {
        fun plan(source: String, labels: Boolean, roads: Boolean, tdtLabels: String = "auto") =
            com.shantu.nativeapp.map.NativeCartographyPlan.resolve(
                com.shantu.nativeapp.map.NativeCartographySettings(
                    roads = roads,
                    labels = labels,
                    sourceId = source,
                    satelliteProvider = if (source.startsWith("tianditu-")) "tianditu" else "sentinel",
                    tiandituLabels = tdtLabels,
                ),
            )

        assertFalse(NativeShareReadinessPolicy.requiresVisibleMvt(plan("tianditu-imagery", true, false, "auto")))
        assertFalse(NativeShareReadinessPolicy.requiresVisibleMvt(plan("tianditu-imagery", true, false, "cia")))
        assertTrue(NativeShareReadinessPolicy.requiresVisibleMvt(plan("tianditu-imagery", true, false, "vector")))
        assertTrue(NativeShareReadinessPolicy.requiresVisibleMvt(plan("tianditu-imagery", true, true, "auto")))
        assertTrue(NativeShareReadinessPolicy.requiresVisibleMvt(plan("terrain", false, false)))
        assertFalse(NativeShareReadinessPolicy.requiresVisibleMvt(plan("custom", false, false)))
        assertTrue(NativeShareReadinessPolicy.requiresVisibleMvt(plan("custom", true, false)))
    }

    @Test fun sentinelRequiresActualRenderedImageTile() {
        assertFalse(NativeShareReadinessPolicy.isReady("sentinel-latest", true, 0, 0, false, true))
        assertTrue(NativeShareReadinessPolicy.isReady("sentinel-latest", true, 1, 0, false, true))
        assertFalse(NativeShareReadinessPolicy.isReady("sentinel-detail", false, 1, 0, false, true))
        assertTrue(NativeShareReadinessPolicy.isReady("sentinel-detail", true, 1, 0, false, true))
    }

    @Test fun sharedPoolTrafficCannotPretendThePrintSurfaceLoadedRaster() {
        assertFalse(NativeShareReadinessPolicy.isReady("tianditu-imagery", false, 0, 0, false, true, 0))
        assertTrue(NativeShareReadinessPolicy.isReady("tianditu-imagery", false, 0, 0, false, true, 1))
        assertFalse(NativeShareReadinessPolicy.isReady("custom", false, 0, 0, false, true, 0))
        assertTrue(NativeShareReadinessPolicy.isReady("custom", false, 0, 0, false, true, 1))
    }

    @Test fun sharedNetworkIdleIsNotRequiredButSourceLoadsMustFinish() {
        assertFalse(NativeShareReadinessPolicy.isReady("custom", false, 0, 0, false, true, 1, 2))
        assertTrue(NativeShareReadinessPolicy.isReady("custom", false, 0, 0, false, true, 1, 0))
    }

    @Test fun aFreshFrameIsRequiredAndSharedErrorsDoNotInvalidateOwnSuccessfulRaster() {
        assertFalse(NativeShareReadinessPolicy.isReady("custom", false, 0, 0, false, false, 1))
        // A main-map request can fail concurrently; only the print controller's decoded raster count is relevant.
        assertTrue(NativeShareReadinessPolicy.isReady("custom", false, 0, 0, false, true, 1))
    }

    @Test fun offlineAndLocalRasterSourcesNeedTheirOwnDecodedSurfaceEvidence() {
        assertFalse(NativeShareReadinessPolicy.isReady("offline", false, 0, 0, false, true, 0))
        assertTrue(NativeShareReadinessPolicy.isReady("offline", false, 0, 0, false, true, 1))
        assertFalse(NativeShareReadinessPolicy.isReady("custom", false, 0, 0, false, true, 0))
        assertTrue(NativeShareReadinessPolicy.isReady("custom", false, 0, 0, false, true, 1))
    }

    @Test fun enabledRoadsNeedVisibleDecodedVectorTiles() {
        assertFalse(NativeShareReadinessPolicy.isReady("terrain", false, 0, 0, true, true, 0))
        assertTrue(NativeShareReadinessPolicy.isReady("terrain", false, 0, 1, true, true, 1))
        assertFalse(NativeShareReadinessPolicy.isReady("terrain", false, 0, 0, false, true, 0))
    }
}
