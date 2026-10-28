package com.shantu.nativeapp.map

import org.junit.After
import org.junit.Assert.*
import org.junit.Test

class NativeOfflineDisplayPolicyTest {
    @After fun reset() = NativeOfflineDisplayPolicy.reset()

    @Test fun disabledPolicyPreservesExistingNetworkAndCacheBehavior() {
        NativeOfflineDisplayPolicy.reset()
        assertTrue(NativeOfflineDisplayPolicy.permitsCachedRead("https://tiles.example/1/0/0", { _, _ -> false }))
        assertTrue(NativeOfflineDisplayPolicy.permitsNetwork())
    }

    @Test fun selectedPackageOnlyAllowsExactManifestMembersAndNeverNetworkFallback() {
        NativeOfflineDisplayPolicy.update(NativeOfflineDisplayPolicyState(
            enabled = true, packageId = "trip-a", sourceId = "custom:map-a", provider = "imported"))
        val allowed = NativeOfflineDisplayPolicy.permitsCachedRead("https://tiles.example/1/0/0") { id, url ->
            id == "trip-a" && url.endsWith("/1/0/0")
        }
        val otherSource = NativeOfflineDisplayPolicy.permitsCachedRead("https://tiles.example/1/0/1") { id, url ->
            id == "trip-a" && url.endsWith("/1/0/0")
        }
        assertTrue(allowed)
        assertFalse(otherSource)
        assertFalse(NativeOfflineDisplayPolicy.permitsNetwork())
    }

    @Test fun enabledWithoutASelectedPackageFailsClosedAndInvalidStateCannotOpenNetwork() {
        NativeOfflineDisplayPolicy.update(NativeOfflineDisplayPolicyState(enabled = true, provider = "openfreemap"))
        assertFalse(NativeOfflineDisplayPolicy.permitsCachedRead("https://tiles.example/1/0/0") { _, _ -> true })
        assertFalse(NativeOfflineDisplayPolicy.permitsNetwork())

        NativeOfflineDisplayPolicy.update(NativeOfflineDisplayPolicyState(version = 99, enabled = true,
            packageId = "trip-a", provider = "openfreemap"))
        assertTrue(NativeOfflineDisplayPolicy.snapshot().enabled)
        assertFalse(NativeOfflineDisplayPolicy.permitsCachedRead("https://tiles.example/1/0/0") { _, _ -> true })
        assertFalse(NativeOfflineDisplayPolicy.permitsNetwork())
    }

    @Test fun builtInTiandituPackageDoesNotRequireCustomSourceId() {
        NativeOfflineDisplayPolicy.update(NativeOfflineDisplayPolicyState(
            enabled = true, packageId = "trip-tdt", provider = "tianditu"))
        assertTrue(NativeOfflineDisplayPolicy.permitsCachedRead("https://t0.tianditu.gov.cn/vec") { id, _ -> id == "trip-tdt" })
        assertFalse(NativeOfflineDisplayPolicy.permitsNetwork())

        NativeOfflineDisplayPolicy.update(NativeOfflineDisplayPolicyState(
            enabled = true, packageId = "trip-custom", provider = "imported"))
        assertFalse(NativeOfflineDisplayPolicy.permitsCachedRead("https://custom.example/tile") { _, _ -> true })
    }

    @Test fun openFreeMapOfflineTileUsesOnlyTheSelectedPackagesObservedVersionTemplate() {
        NativeOfflineDisplayPolicy.update(NativeOfflineDisplayPolicyState(
            enabled = true, packageId = "ofm-trip", provider = "openfreemap",
            vectorTileTemplates = listOf("https://tiles.openfreemap.org/planet/20261028_001001_pt/{z}/{x}/{y}.pbf")))
        assertEquals("https://tiles.openfreemap.org/planet/20261028_001001_pt/12/2048/1365.pbf",
            NativeOfflineDisplayPolicy.selectedOpenFreeMapTileUrl(12, 2048, 1365))
        NativeOfflineDisplayPolicy.update(NativeOfflineDisplayPolicyState(
            enabled = true, packageId = "ofm-trip", provider = "openfreemap",
            vectorTileTemplates = listOf("https://untrusted.example/planet/latest/{z}/{x}/{y}.pbf")))
        assertNull(NativeOfflineDisplayPolicy.selectedOpenFreeMapTileUrl(12, 2048, 1365))
        assertFalse(NativeOfflineDisplayPolicy.permitsNetwork())
    }
}
