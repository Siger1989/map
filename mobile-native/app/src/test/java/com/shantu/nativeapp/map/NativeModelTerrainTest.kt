package com.shantu.nativeapp.map

import earth.worldwind.geom.Angle.Companion.degrees
import earth.worldwind.geom.Position
import org.junit.Assert.*
import org.junit.Test

class NativeModelTerrainTest {
    @Test fun `terrain clipping preserves above surface triangles and outputs intersection`() {
        val vertices=listOf(Position(0.0.degrees,0.0.degrees,-2.0),Position(0.0.degrees,1.0.degrees,2.0),Position(1.0.degrees,0.0.degrees,2.0))
        val result=NativeTerrainMeshProcessor.process(vertices,intArrayOf(0,1,2),NativeTerrainSampler{_,_->0.0},true)!!
        assertEquals(4,result.vertices.size)
        assertTrue(result.vertices.all{it.altitude>=-1e-9})
        assertEquals(6,result.indices.size)
        assertEquals(1,result.intersections.size)
        assertEquals(0.0,result.intersections.single().first.altitude,1e-9)
        assertEquals(0.0,result.intersections.single().second.altitude,1e-9)
    }
    @Test fun `terrain intersection is absent when geometry does not cross ground`() {
        val vertices=listOf(Position(0.0.degrees,0.0.degrees,5.0),Position(0.0.degrees,1.0.degrees,6.0),Position(1.0.degrees,0.0.degrees,7.0))
        val result=NativeTerrainMeshProcessor.process(vertices,intArrayOf(0,1,2),NativeTerrainSampler{_,_->0.0},false)!!
        assertEquals(3,result.vertices.size)
        assertTrue(result.intersections.isEmpty())
    }
    @Test fun `missing DEM samples reject output instead of inventing zero elevation`() {
        val vertices=listOf(Position(0.0.degrees,0.0.degrees,0.0),Position(0.0.degrees,1.0.degrees,0.0),Position(1.0.degrees,0.0.degrees,0.0))
        assertNull(NativeTerrainMeshProcessor.process(vertices,intArrayOf(0,1,2),NativeTerrainSampler{_,_->null},true))
    }

    @Test fun `terrain cut mask emits DEM-conforming triangles only inside an intersecting footprint`() {
        val boundary=listOf(Position(0.0.degrees,0.0.degrees,0.0),Position(0.0.degrees,1.0.degrees,0.0),Position(1.0.degrees,1.0.degrees,0.0),Position(1.0.degrees,0.0.degrees,0.0))
        val mask=NativeTerrainCutMeshBuilder.build("box",boundary,NativeTerrainSampler{_,_->5.0},0.0,10.0,false,samples=4)!!
        assertTrue(mask.triangles.isNotEmpty())
        assertEquals(0,mask.triangles.size%3)
        assertTrue(mask.triangles.all{it.altitude==5.0})
        assertEquals(96,mask.triangles.size) // 4x4 cells, 2 triangles per cell, 3 vertices each
    }

    @Test fun `terrain cut mask stays empty when DEM does not intersect surface model`() {
        val boundary=listOf(Position(0.0.degrees,0.0.degrees,0.0),Position(0.0.degrees,1.0.degrees,0.0),Position(1.0.degrees,1.0.degrees,0.0),Position(1.0.degrees,0.0.degrees,0.0))
        val mask=NativeTerrainCutMeshBuilder.build("box",boundary,NativeTerrainSampler{_,_->12.0},0.0,10.0,false,samples=4)!!
        assertTrue(mask.triangles.isEmpty())
    }
}
