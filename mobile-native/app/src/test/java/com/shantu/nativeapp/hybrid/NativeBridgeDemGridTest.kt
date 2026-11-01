package com.shantu.nativeapp.hybrid

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Base64

class NativeBridgeDemGridTest {
    @Test fun `mercator raster becomes a regular lon lat grid without changing real height`(){
        val pixels=DoubleArray(256*256){ 412.5 }
        val grid=NativeBridgeDemGrid.fromMercatorPixels(2,1,1,pixels,8)!!
        assertEquals(8,grid.width);assertEquals(8,grid.height)
        assertEquals(-89.82421875,grid.west,1e-9)
        assertEquals(-0.0,grid.south,1.0)
        assertTrue(grid.north>grid.south)
        assertTrue(grid.heights.all { it==412.5 })
    }

    @Test fun `nodata remains null and invalid raster metadata is rejected`(){
        val pixels=DoubleArray(256*256){ 10.0 };pixels[0]=Double.NaN
        val grid=NativeBridgeDemGrid.fromMercatorPixels(1,0,0,pixels,4)!!
        assertNull(grid.heights.first())
        assertNull(NativeBridgeDemGrid.fromMercatorPixels(14,0,0,pixels))
        assertNull(NativeBridgeDemGrid.fromMercatorPixels(2,4,0,pixels))
    }

    @Test fun `direct 64 pixel mercator tile preserves WGS84 bounds and north west row orientation`(){
        val size=64
        val pixels=DoubleArray(size*size){index -> (index/size)*100.0+(index%size)}
        val grid=NativeBridgeDemGrid.fromMercatorPixels(3,4,3,pixels,8)!!
        assertEquals(0.3515625,grid.west,1e-9)
        assertEquals(44.6484375,grid.east,1e-9)
        assertTrue(grid.north>grid.south)
        assertTrue(grid.north<85.05112878 && grid.south>-85.05112878)
        assertTrue(grid.heights.first()!! < grid.heights[7]!!)
        assertTrue(grid.heights.first()!! < grid.heights[7*8]!!)
        assertNull(NativeBridgeDemGrid.fromMercatorPixels(3,4,3,DoubleArray(63*64),8))
    }

    @Test fun `geoid offset codec shares grid order and writes signed centimeters little endian`(){
        val grid=NativeBridgeDemGrid.fromMercatorPixels(2,1,1,DoubleArray(256*256){ 123.0 },2)!!
        val sampled=mutableListOf<Pair<Double,Double>>()
        val encoded=NativeBridgeDemGrid.encodeGeoidOffsetsCm(grid) { latitude,longitude ->
            sampled += latitude to longitude
            when(sampled.size){ 1 -> -12.34; 2 -> 56.78; 3 -> 0.0; else -> -0.01 }
        }!!
        val expected=listOf(grid.north to grid.west,grid.north to grid.east,grid.south to grid.west,grid.south to grid.east)
        assertEquals(expected.size,sampled.size)
        expected.indices.forEach { index ->
            assertEquals(expected[index].first,sampled[index].first,1e-12)
            assertEquals(expected[index].second,sampled[index].second,1e-12)
        }
        val bytes=Base64.getDecoder().decode(encoded)
        assertEquals(8,bytes.size)
        val values=ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
        assertEquals(-1234,values.get(0).toInt())
        assertEquals(5678,values.get(1).toInt())
        assertEquals(0,values.get(2).toInt())
        assertEquals(-1,values.get(3).toInt())
        assertNull(NativeBridgeDemGrid.encodeGeoidOffsetsCm(grid) { _,_ -> Double.NaN })
        assertNull(NativeBridgeDemGrid.encodeGeoidOffsetsCm(grid) { _,_ -> 120.01 })
    }

    @Test fun `EGM96 load probe matches only the bound standard north pole cell`(){
        assertTrue(NativeBridgeEgm96Readiness.isLoadedByNorthPoleOffset(13.61f))
        assertTrue(NativeBridgeEgm96Readiness.isLoadedByNorthPoleOffset(13.605f))
        assertTrue(!NativeBridgeEgm96Readiness.isLoadedByNorthPoleOffset(0f))
        assertTrue(!NativeBridgeEgm96Readiness.isLoadedByNorthPoleOffset(Float.NaN))
    }
}
