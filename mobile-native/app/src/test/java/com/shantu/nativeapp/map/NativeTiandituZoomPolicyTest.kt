package com.shantu.nativeapp.map

import earth.worldwind.layer.mercator.MercatorTileFactory
import earth.worldwind.layer.mercator.MercatorTiledImageLayer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class NativeTiandituZoomPolicyTest {
    @Test fun `built in layer caps match the React Tianditu catalogue`() {
        val expected = mapOf(
            "vec" to 18,
            "img" to 18,
            "ter" to 14,
            "cva" to 19,
            "cia" to 18,
            "cta" to 18,
            "ibo" to 18,
        )
        expected.forEach { (layer, maxZoom) ->
            assertEquals(maxZoom, NativeTiandituZoomPolicy.sourceMaxZoom(layer))
            assertEquals(maxZoom, NativeTiandituZoomPolicy.effectiveMaxZoom(layer, null))
            assertEquals(maxZoom, NativeTiandituZoomPolicy.effectiveMaxZoom(layer, 24))
            assertEquals(1, NativeTiandituZoomPolicy.effectiveMaxZoom(layer, 0))
        }
        assertEquals(12, NativeTiandituZoomPolicy.effectiveMaxZoom("img", 12))
        assertThrows(IllegalArgumentException::class.java) { NativeTiandituZoomPolicy.sourceMaxZoom("unknown") }
    }

    @Test fun `WorldWind builder max zoom is inclusive and has no level above the source cap`() {
        for (layer in listOf("vec", "img", "ter", "cva", "cia", "cta", "ibo")) {
            val maxZoom = NativeTiandituZoomPolicy.effectiveMaxZoom(layer, 24)
            val image = MercatorTiledImageLayer.buildTiledSurfaceImage(
                object : MercatorTileFactory {
                    override val contentType = "zoom policy test"
                    override fun getImageSource(x: Int, y: Int, z: Int) = null
                },
                maxZoom = maxZoom,
                minZoom = 1,
            )

            assertEquals(maxZoom, image.levelSet.lastLevel.levelNumber)
            assertEquals(maxZoom + 1, image.levelSet.numLevels)
            assertNull(image.levelSet.level(maxZoom + 1))
        }
    }
}
