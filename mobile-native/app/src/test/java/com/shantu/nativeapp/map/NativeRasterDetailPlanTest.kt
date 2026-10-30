package com.shantu.nativeapp.map

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeRasterDetailPlanTest {
    @Test fun `tile sector uses angular spans and preserves actual mercator bounds`() {
        for (tile in listOf(
            NativeRasterDetailTile(12, 3231, 1681, 0, 0),
            NativeRasterDetailTile(4, 2, 12, 0, 0),
            NativeRasterDetailTile(0, 0, 0, 0, 0),
        )) {
            val sector = NativeRasterDetailPlan.tileSector(tile)
            val side = 1 shl tile.z
            assertEquals(tile.x.toDouble() / side * 360 - 180, sector.minLongitude.inDegrees, 1e-10)
            assertEquals((tile.x + 1.0) / side * 360 - 180, sector.maxLongitude.inDegrees, 1e-10)
            assertEquals(NativeRasterDetailPlan.latitudeAtTile(tile.y.toDouble(), tile.z), sector.maxLatitude.inDegrees, 1e-10)
            assertEquals(NativeRasterDetailPlan.latitudeAtTile((tile.y + 1).toDouble(), tile.z), sector.minLatitude.inDegrees, 1e-10)
        }
    }
    @Test fun `center fallback is bounded to the original 12 by 12 budget`() {
        val patch=NativeRasterDetailPlan.create(104.06,30.67,19)
        assertEquals(12,patch.width)
        assertEquals(12,patch.height)
        assertEquals(144,patch.tiles.size)
        assertFalse(patch.fullViewport)
        assertTrue(patch.tiles.all { it.z==19 })
        assertTrue(patch.left>=0 && patch.top>=0 && patch.left+patch.width<=(1 shl patch.z))
    }

    @Test fun `small current viewport uses exact fixed zoom tiles`() {
        val z=12;val n=1 shl z
        fun lon(x:Double)=x/n*360.0-180.0
        val bounds=NativeRasterDetailBounds(lon(900.2),NativeRasterDetailPlan.latitudeAtTile(703.8,z),
            lon(903.8),NativeRasterDetailPlan.latitudeAtTile(700.2,z))
        val patch=NativeRasterDetailPlan.create(lon(902.0),NativeRasterDetailPlan.latitudeAtTile(702.0,z),z,bounds)
        assertTrue(patch.fullViewport)
        assertEquals(4,patch.width)
        assertEquals(4,patch.height)
        assertEquals((900..903).toSet(),patch.tiles.map { it.x }.toSet())
        assertEquals((700..703).toSet(),patch.tiles.map { it.y }.toSet())
    }

    @Test fun `oversized viewport and antimeridian crossing fall back to a bounded center`() {
        val z=10;val n=1 shl z
        fun lon(x:Double)=x/n*360.0-180.0
        val wide=NativeRasterDetailBounds(lon(100.0),NativeRasterDetailPlan.latitudeAtTile(200.0,z),
            lon(117.0),NativeRasterDetailPlan.latitudeAtTile(183.0,z))
        val crossing=NativeRasterDetailBounds(179.0,-10.0,-179.0,10.0)
        for(bounds in listOf(wide,crossing)) {
            val patch=NativeRasterDetailPlan.create(179.8,0.0,z,bounds)
            assertFalse(patch.fullViewport)
            assertEquals(144,patch.tiles.size)
            assertTrue(patch.width<=12 && patch.height<=12)
        }
    }

    @Test fun `zoom zero remains a valid single tile plan`() {
        val patch=NativeRasterDetailPlan.create(0.0,0.0,0)
        assertEquals(1,patch.width)
        assertEquals(1,patch.height)
        assertEquals(0,patch.tiles.single().z)
    }

    @Test fun `large texture providers bound composed patch memory by max side`() {
        val patch=NativeRasterDetailPlan.create(104.06,30.67,19,maxSide=4)
        assertTrue(patch.width<=4 && patch.height<=4)
        assertTrue(patch.tiles.size<=16)
    }
}
