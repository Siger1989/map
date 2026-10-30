package com.shantu.nativeapp.map

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class NativeImageSourceIdentityTest {
    @Test fun `dynamic view generation suppliers do not churn WorldWind image cache identity`() {
        val network = Any()
        val source = Any()
        val decoded: () -> Unit = {}
        val started: () -> Unit = {}
        val finished: () -> Unit = {}
        val tile = TileRequestIdentity("source-hash", "img", 8, 12, 22, "style-hash", "auth-hash")
        val first = NativeImageSourceIdentity(network, source, tile, "unused", decoded, started, finished, { 1L })
        val second = NativeImageSourceIdentity(network, source, tile, "unused", decoded, started, finished, { 7L })
        assertEquals(first, second)
        assertEquals(first.hashCode(), second.hashCode())
        assertEquals(first, NativeImageSourceIdentity(network, Any(), tile, "unused", decoded, started, finished, { 9L }))
        assertNotEquals(first, NativeImageSourceIdentity(network, source, tile.copy(x = 13), "unused", decoded, started, finished, { 7L }))
    }

    @Test fun `raw provider tile identities share the same parent key and isolate adjacent raw tiles`() {
        val parentA = NativeRasterSourceTileKey.from(8, 12, 22)!!
        val sameParentA = NativeRasterSourceTileKey.from(8, 12, 22)!!
        val adjacent = NativeRasterSourceTileKey.from(8, 13, 22)!!
        val wrappedAlias = NativeRasterSourceTileKey.from(8, 268, 22)!!
        assertEquals(parentA, sameParentA)
        assertNotEquals(parentA, adjacent)
        assertEquals(parentA, wrappedAlias)
    }

    @Test fun `explicit OVMAP subdivision siblings share actual z minus one parent`() {
        val parentPattern = NativeMapRasterLayer(
            tiles = listOf("https://tiles.example/{\$z-1}/{\$x/2}/{\$y/2}.png"),
            minZoom = 1, maxZoom = 18, tileSize = 512, scheme = NativeTileScheme.XYZ,
            subdivide = true, ovmapTemplate = true,
        )
        val first = NativeRasterSourceTileKey.requestKey(parentPattern, 8, 12, 22)!!
        val sibling = NativeRasterSourceTileKey.requestKey(parentPattern, 8, 13, 23)!!
        val adjacentParent = NativeRasterSourceTileKey.requestKey(parentPattern, 8, 14, 22)!!
        assertEquals(NativeRasterSourceTileKey(7, 6, 11), first)
        assertEquals(first, sibling)
        assertNotEquals(first, adjacentParent)

        val genericSubdivide = parentPattern.copy(tiles = listOf("https://tiles.example/{z}/{x}/{y}.png"))
        assertEquals(NativeRasterSourceTileKey(8, 12, 22), NativeRasterSourceTileKey.requestKey(genericSubdivide, 8, 12, 22))
    }

    @Test fun `custom source request config hash is stable across source recreation and isolates endpoint changes`() {
        val configA = listOf("format=png", "matrixSet=web", "template=https://tiles.example/{z}/{x}/{y}.png?tk=inlineA")
        val recreatedConfigA = listOf("format=png", "matrixSet=web", "template=https://tiles.example/{z}/{x}/{y}.png?tk=inlineA")
        val changedEndpoint = listOf("format=png", "matrixSet=web", "template=https://other.example/{z}/{x}/{y}.png?tk=inlineB")
        assertEquals(NativeRasterStyleFingerprint.create(configA), NativeRasterStyleFingerprint.create(recreatedConfigA))
        assertNotEquals(NativeRasterStyleFingerprint.create(configA), NativeRasterStyleFingerprint.create(changedEndpoint))
        val source = Any(); val network = Any(); val callback: () -> Unit = {}
        val firstStyle = NativeRasterStyleFingerprint.create(configA)
        val sameConfigNewSource = NativeRasterStyleFingerprint.create(recreatedConfigA)
        val changedStyle = NativeRasterStyleFingerprint.create(changedEndpoint)
        fun identity(style: String) = NativeImageSourceIdentity(network, source,
            TileRequestIdentity("user-source-hash", "raster-0", 8, 12, 22, style, "auth-hash"), "unused", callback, callback, callback, { 1L })
        assertEquals(identity(firstStyle), identity(sameConfigNewSource))
        assertNotEquals(identity(firstStyle), identity(changedStyle))
    }
}
