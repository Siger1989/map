package com.shantu.nativeapp.map

import android.graphics.Bitmap
import android.graphics.Color
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class NativeMissingTileFallbackTest {
    @Test fun `custom factory replaces missing child with nearest same source ancestor`() = runBlocking {
        val parent = Bitmap.createBitmap(8, 8, Bitmap.Config.ARGB_8888)
        parent.eraseColor(Color.GREEN)
        val bytes = NativeMissingTileFallback.bytesForBitmap(parent)!!
        parent.recycle()
        val requests = mutableListOf<String>()
        val identities = mutableListOf<List<Int>>()
        val network = BoundedTileNetwork(java.nio.file.Files.createTempDirectory("ancestor-factory-").toFile(), {}, TileHttpClient { url ->
            requests += java.net.URL(url).path
            if (java.net.URL(url).path.startsWith("/3/")) TileHttpResponse(404, null, null) else TileHttpResponse(200, null, bytes)
        })
        val layer = NativeMapRasterLayer(listOf("https://fixture.test/{z}/{x}/{y}.png"), 1, 18, 8, NativeTileScheme.XYZ, false, false)
        val source = NativeMapSource("fixture", "Fixture", listOf(layer), NativeRasterDatum.WGS84, 8, "", emptyList(), "", null, "XYZ", emptyList())
        try {
            val output = NativeRasterImageFactory(network, source, 0, 3, 2, 3, rawIdentityFor = { x, y, z -> identities += listOf(z, x, y); null }).createBitmap()
            assertNotNull(output)
            assertEquals(Color.GREEN, output!!.getPixel(4, 4))
            assertEquals(listOf("/3/3/2.png", "/2/1/1.png"), requests)
            assertTrue(identities.contains(listOf(2, 1, 1)))
            output.recycle()
        } finally { network.close() }
    }
    @Test fun `only explicit miss statuses and Bing no-tile signal classify missing`() {
        assertTrue(NativeMissingTileFallback.isExplicitMissing(204, null))
        assertTrue(NativeMissingTileFallback.isExplicitMissing(404, null))
        assertTrue(NativeMissingTileFallback.isExplicitMissing(410, null))
        assertTrue(NativeMissingTileFallback.isExplicitMissing(200, "no-tile"))
        assertFalse(NativeMissingTileFallback.isExplicitMissing(403, null))
        assertFalse(NativeMissingTileFallback.isExplicitMissing(403, "no-tile"))
        assertFalse(NativeMissingTileFallback.isExplicitMissing(500, null))
        assertFalse(NativeMissingTileFallback.isExplicitMissing(200, "tile"))
    }

    @Test fun `TDT parent URL preserves layer and credential while replacing only tile coordinates`() {
        val childUrl = "https://t0.tianditu.gov.cn/img_w/wmts?SERVICE=WMTS&LAYER=img&TILEMATRIX=18&TILEROW=102&TILECOL=201&tk=private"
        val child = NativeMissingTileFallback.parseTdt(childUrl)
        assertEquals(NativeMissingTileFallback.TdtTile("img", 201, 102, 18), child)
        val parent = NativeMissingTileFallback.tdtUrl(childUrl, NativeMissingTileFallback.TdtTile("img", 100, 51, 17))
        assertNotNull(parent)
        assertTrue(parent!!.contains("TILEMATRIX=17"))
        assertTrue(parent.contains("TILECOL=100"))
        assertTrue(parent.contains("TILEROW=51"))
        assertTrue(parent.contains("tk=private"))
        assertNull(NativeMissingTileFallback.parseTdt("https://example.test/{z}/{x}/{y}.png"))
    }

    @Test fun `ancestor crop maps requested descendant to one exact quadrant`() {
        val parent = Bitmap.createBitmap(8, 8, Bitmap.Config.ARGB_8888)
        val colors = intArrayOf(Color.RED, Color.GREEN, Color.BLUE, Color.YELLOW)
        for (y in 0 until 8) for (x in 0 until 8) {
            val quadrant = (if (x >= 4) 1 else 0) + (if (y >= 4) 2 else 0)
            parent.setPixel(x, y, colors[quadrant])
        }
        val crop = NativeMissingTileFallback.cropDescendant(parent, 3, 2, 1, 2, 4)
        assertNotNull(crop)
        assertEquals(Color.GREEN, crop!!.getPixel(1, 1))
        crop.recycle()
        parent.recycle()
        val tinyParent = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)
        val deepCrop = NativeMissingTileFallback.cropDescendant(tinyParent, 0, 0, 1, 12, 16)
        assertNotNull("fractional source rectangles stay bounded and can be upscaled without inventing detail", deepCrop)
        deepCrop?.recycle()
        assertNull(NativeMissingTileFallback.cropDescendant(tinyParent, 0, 0, 1, 26, 16))
        tinyParent.recycle()
    }

    @Test fun `placeholder recognition is exact size and digest gated`() {
        val fixture = listOf(java.io.File("../../tests/fixtures/tianditu-no-imagery-placeholder.jpg"), java.io.File("tests/fixtures/tianditu-no-imagery-placeholder.jpg"))
            .firstOrNull { it.isFile } ?: error("Missing provider placeholder fixture")
        assertTrue(NativeMissingTileFallback.isKnownPlaceholder(fixture.readBytes()))
        assertEquals("4b399ee12503d2278b244fcb0f3804d0c6c8bb42391c2621a53937b97acc494a", NativeMissingTileFallback.KNOWN_PLACEHOLDER_SHA256)
        assertFalse(NativeMissingTileFallback.isKnownPlaceholder(ByteArray(4769)))
        assertFalse(NativeMissingTileFallback.isKnownPlaceholder(ByteArray(4768)))
        val snow = Bitmap.createBitmap(8, 8, Bitmap.Config.ARGB_8888)
        snow.eraseColor(Color.WHITE)
        val encoded = java.io.ByteArrayOutputStream().use { output -> snow.compress(Bitmap.CompressFormat.PNG, 100, output); output.toByteArray() }
        assertFalse("white snow imagery must not be rejected by pixel heuristics", NativeMissingTileFallback.isKnownPlaceholder(encoded))
        snow.recycle()
    }
}
