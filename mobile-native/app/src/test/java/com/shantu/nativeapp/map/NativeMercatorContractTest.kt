package com.shantu.nativeapp.map

import earth.worldwind.layer.mercator.MercatorTileFactory
import earth.worldwind.layer.mercator.MercatorTiledImageLayer
import earth.worldwind.render.image.ImageSource
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Verify the SDK contract: minZoom is a retrieval offset, not the first level number. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NativeMercatorContractTest {
    @Test
    fun `registered imagery keeps zoom nineteen without requesting zoom twenty`() {
        val factory = object : MercatorTileFactory {
            override val contentType = "test-imagery"
            override fun getImageSource(x: Int, y: Int, z: Int) = ImageSource.fromUrl(java.net.URL("https://example.invalid/$z/$x/$y.png"))
        }
        val image = MercatorTiledImageLayer.buildTiledSurfaceImage(factory, false, maxZoom = 19, minZoom = 1)
        assertEquals(0, image.levelSet.firstLevel.levelNumber)
        assertEquals(19, image.levelSet.lastLevel.levelNumber)
        assertEquals(1, image.levelSet.levelOffset)
    }
}
