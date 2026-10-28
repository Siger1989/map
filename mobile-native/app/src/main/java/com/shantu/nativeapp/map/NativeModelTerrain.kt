package com.shantu.nativeapp.map

import earth.worldwind.geom.Position
import earth.worldwind.geom.Angle.Companion.degrees

/** Host supplies a real DEM sampler. Null means terrain is unavailable at that point. */
fun interface NativeTerrainSampler { fun elevationMeters(latitude:Double,longitude:Double):Double? }
data class NativeTerrainMesh(val vertices:List<Position>,val indices:IntArray,val intersections:List<Pair<Position,Position>>)

/** Clips model triangles against sampled terrain and returns true terrain/model intersection segments. */
internal object NativeTerrainMeshProcessor {
    fun process(vertices:List<Position>,indices:IntArray,sampler:NativeTerrainSampler,cut:Boolean):NativeTerrainMesh? {
        if(indices.size%3!=0||indices.any{it !in vertices.indices})return null
        val ground=vertices.map{sampler.elevationMeters(it.latitude.inDegrees,it.longitude.inDegrees)?.takeIf(Double::isFinite)?:return null}
        val out=mutableListOf<Position>();val outIndices=mutableListOf<Int>();val intersections=mutableListOf<Pair<Position,Position>>()
        for(t in indices.indices step 3){
            val original=listOf(indices[t],indices[t+1],indices[t+2]).map{vertices[it] to ground[it]}
            val cross=mutableListOf<Position>()
            for(i in original.indices){val a=original[i];val b=original[(i+1)%original.size];val da=a.first.altitude-a.second;val db=b.first.altitude-b.second
                if((da<0&&db>0)||(da>0&&db<0)){val f=da/(da-db);cross+=interpolate(a.first,b.first,a.second,b.second,f)}
                else if(da==0.0)cross+=Position(a.first.latitude,a.first.longitude,a.second)
            }
            if(cross.size>=2)intersections+=cross[0] to cross[1]
            val polygon=if(cut)clipAboveTerrain(original)else original.map{Position(it.first.latitude,it.first.longitude,it.first.altitude)}
            if(polygon.size<3)continue
            val base=out.size;out+=polygon
            for(i in 1 until polygon.lastIndex)outIndices+=listOf(base,base+i,base+i+1)
        }
        return NativeTerrainMesh(out,outIndices.toIntArray(),intersections)
    }
    private fun clipAboveTerrain(input:List<Pair<Position,Double>>):List<Position>{
        val out=mutableListOf<Position>()
        for(i in input.indices){val a=input[i];val b=input[(i+1)%input.size];val da=a.first.altitude-a.second;val db=b.first.altitude-b.second;val ina=da>=0;val inb=db>=0
            if(ina&&inb)out+=Position(b.first.latitude,b.first.longitude,b.first.altitude)
            else if(ina&&!inb)out+=interpolate(a.first,b.first,a.second,b.second,da/(da-db))
            else if(!ina&&inb){out+=interpolate(a.first,b.first,a.second,b.second,da/(da-db));out+=Position(b.first.latitude,b.first.longitude,b.first.altitude)}
        }
        return out
    }
    private fun interpolate(a:Position,b:Position,ga:Double,gb:Double,f:Double):Position=Position(
        (a.latitude.inDegrees+(b.latitude.inDegrees-a.latitude.inDegrees)*f).degrees,
        (a.longitude.inDegrees+(b.longitude.inDegrees-a.longitude.inDegrees)*f).degrees,
        ga+(gb-ga)*f,
    )
}
