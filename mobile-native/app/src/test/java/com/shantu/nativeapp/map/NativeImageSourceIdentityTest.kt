package com.shantu.nativeapp.map

import earth.worldwind.render.image.ImageSource
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.nio.file.Files

/** Exercise the WorldWind ImageSource cache-key contract with real factory-backed sources. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NativeImageSourceIdentityTest {
    @Test
    fun `same Tianditu tile and source generation share ImageSource identity`() {
        val network = newNetwork()
        try {
            val callback: () -> Unit = {}
            val url = "https://t0.example.invalid/tiles/4/7/8?tk=FAKE_PRIVATE_KEY_CANARY"
            val first = ImageSource.fromImageFactory(TiandituImageFactory(network, url, callback))
            val recreated = ImageSource.fromImageFactory(TiandituImageFactory(network, url, callback))
            val nextGeneration = ImageSource.fromImageFactory(TiandituImageFactory(network, url, {}))
            val otherTile = ImageSource.fromImageFactory(TiandituImageFactory(network, "$url&tile=other", callback))

            assertEquals(first, recreated)
            assertEquals(first.hashCode(), recreated.hashCode())
            assertNotEquals(first, nextGeneration)
            assertNotEquals(first, otherTile)
            assertFalse(TiandituImageFactory(network, url, callback).toString().contains("FAKE_PRIVATE_KEY_CANARY"))
        } finally {
            network.close()
        }
    }

    @Test
    fun `custom raster identity includes tile coordinates layer and generation`() {
        val network = newNetwork()
        try {
            val source = testSource()
            val callback: () -> Unit = {}
            fun image(layer: Int, x: Int, y: Int, z: Int, decoded: () -> Unit = callback) =
                ImageSource.fromImageFactory(NativeRasterImageFactory(network, source, layer, x, y, z, decoded))

            val first = image(0, 7, 8, 4)
            val recreated = image(0, 7, 8, 4)
            assertEquals(first, recreated)
            assertEquals(first.hashCode(), recreated.hashCode())
            assertNotEquals(first, image(0, 8, 8, 4))
            assertNotEquals(first, image(0, 7, 9, 4))
            assertNotEquals(first, image(0, 7, 8, 5))
            assertNotEquals(first, image(1, 7, 8, 4))
            assertNotEquals(first, image(0, 7, 8, 4, {}))

            val factoryText = NativeRasterImageFactory(network, source, 0, 7, 8, 4, callback).toString()
            assertFalse(factoryText.contains("FAKE_PRIVATE_KEY_CANARY"))
            assertFalse(factoryText.contains("example.invalid"))
        } finally {
            network.close()
        }
    }

    private fun newNetwork() = BoundedTileNetwork(
        Files.createTempDirectory("shantu-image-source-identity-").toFile(),
        {},
        TileHttpClient { TileHttpResponse(503, null, null) },
        { true },
    )

    private fun testSource(): NativeMapSource {
        val layer = NativeMapRasterLayer(
            tiles = listOf("https://tiles.example.invalid/{z}/{x}/{y}.png?token=FAKE_PRIVATE_KEY_CANARY"),
            minZoom = 0,
            maxZoom = 18,
            tileSize = 256,
            scheme = NativeTileScheme.XYZ,
            subdivide = false,
            ovmapTemplate = false,
        )
        return NativeMapSource(
            id = "fixture",
            name = "fixture",
            layers = listOf(layer, layer.copy()),
            datum = NativeRasterDatum.WGS84,
            tileSize = 256,
            attribution = "test",
            subdomains = listOf("a"),
            token = "FAKE_PRIVATE_KEY_CANARY",
            tileMatrixSet = null,
            format = "XYZ",
            limitations = emptyList(),
        )
    }
}
