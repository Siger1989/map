package com.shantu.nativeapp.map

import earth.worldwind.layer.mvt.MvtGeometryType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NativeTerrainBasemapTest {
    @Test fun `missing DEM keeps exact dark material and never invents relief`() {
        val missing = NativeTerrainBasemapMath.pixels(null, 5, 4, 3, 7)
        assertTrue(missing.all { it == NativeTerrainBasemap.BACKGROUND })
        val noData = NativeTerrainBasemapMath.pixels(DoubleArray(25) { Double.NaN }, 5, 4, 3, 7)
        assertTrue(noData.all { it == NativeTerrainBasemap.BACKGROUND })
    }

    @Test fun `flat DEM preserves base tone and real slopes create hillshade`() {
        val flat = NativeTerrainBasemapMath.pixels(DoubleArray(25), 5, 12, 1900, 2048)
        assertEquals(NativeTerrainBasemap.BACKGROUND, flat[2 * 5 + 2])
        val slope = DoubleArray(25) { index -> (index % 5) * 10_000.0 }
        val shaded = NativeTerrainBasemapMath.pixels(slope, 5, 12, 1900, 2048)
        assertNotEquals(NativeTerrainBasemap.BACKGROUND, shaded[2 * 5 + 2])
        assertEquals(NativeTerrainBasemap.BACKGROUND, shaded[0])
    }

    @Test fun `terrain style paints real water and land while dropping labels`() {
        val water = NativeTerrainLandWaterStyle.styleFor("water", MvtGeometryType.POLYGON, emptyMap())
        val forest = NativeTerrainLandWaterStyle.styleFor("landcover", MvtGeometryType.POLYGON, mapOf("class" to "forest"))
        assertTrue(water!!.isDrawInterior)
        assertTrue(water.interiorColor.alpha > 0f)
        assertTrue(forest!!.interiorColor.alpha > 0f)
        assertNull(NativeTerrainLandWaterStyle.styleFor("place", MvtGeometryType.POINT, emptyMap()))
        assertNull(NativeTerrainLandWaterStyle.backgroundColor)
    }
}
