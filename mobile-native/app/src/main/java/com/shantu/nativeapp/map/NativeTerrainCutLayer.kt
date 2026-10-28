package com.shantu.nativeapp.map

import earth.worldwind.draw.Drawable
import earth.worldwind.draw.GROUND_COVERED_BIT
import earth.worldwind.geom.Angle.Companion.degrees
import earth.worldwind.geom.Matrix4
import earth.worldwind.geom.Position
import earth.worldwind.geom.Sector
import earth.worldwind.geom.Vec3
import earth.worldwind.layer.AbstractLayer
import earth.worldwind.render.RenderContext
import earth.worldwind.render.buffer.BufferObject
import earth.worldwind.render.program.AbstractShaderProgram
import earth.worldwind.util.NumericArray
import earth.worldwind.util.kgl.*
import kotlin.math.max
import kotlin.math.min

/** A triangulated, DEM-conforming mask. Vertices are ordered in GL_TRIANGLES triples. */
data class NativeTerrainCutMesh(val id:String,val triangles:List<Position>,val sector:Sector,val extraSectors:List<Sector> = emptyList()) {
    init { require(id.isNotBlank() && id.length<=100 && triangles.size%3==0 && (triangles.isEmpty()||triangles.size>=3)) }
    val coverageSectors get()=listOf(sector)+extraSectors
}

/** Renderer-to-WorldWind bridge. Upsert replaces one object's prior terrain mask; remove/clear
 *  must be called when annotations are deleted, hidden, or their cut flag is turned off. */
interface NativeTerrainCutSink {
    fun upsert(mesh:NativeTerrainCutMesh)
    fun remove(id:String)
    fun clear()
}

/** Creates a fine, terrain-conforming triangle mask over a model footprint. Cells are only
 *  emitted where the DEM lies inside the model's vertical interval (or above a buried model). */
object NativeTerrainCutMeshBuilder {
    fun build(id:String,boundary:List<Position>,sampler:NativeTerrainSampler,lowerMeters:Double,upperMeters:Double,underground:Boolean,samples:Int=24):NativeTerrainCutMesh? {
        if(boundary.size<3||samples !in 2..128||!lowerMeters.isFinite()||!upperMeters.isFinite()||lowerMeters>upperMeters)return null
        val minLat=boundary.minOf{it.latitude.inDegrees};val maxLat=boundary.maxOf{it.latitude.inDegrees}
        val longitudes=unwrap(boundary.map{it.longitude.inDegrees})
        val minLon=longitudes.minOrNull()?:return null;val maxLon=longitudes.maxOrNull()?:return null
        if(maxLat-minLat<=1e-12||maxLon-minLon<=1e-12)return null
        val poly=boundary.indices.map{boundary[it].latitude.inDegrees to longitudes[it]}
        val triangles=mutableListOf<Position>()
        for(y in 0 until samples)for(x in 0 until samples){
            val lat0=minLat+(maxLat-minLat)*y/samples;val lat1=minLat+(maxLat-minLat)*(y+1)/samples
            val lon0=minLon+(maxLon-minLon)*x/samples;val lon1=minLon+(maxLon-minLon)*(x+1)/samples
            val center=((lat0+lat1)/2) to ((lon0+lon1)/2)
            if(!contains(center,poly))continue
            val corners=listOf(lat0 to lon0,lat0 to lon1,lat1 to lon1,lat1 to lon0)
            if(!contains(corners[0],poly)||!contains(corners[1],poly)||!contains(corners[2],poly)||!contains(corners[3],poly))continue
            val heights=corners.map{sampler.elevationMeters(it.first,wrap(it.second))?.takeIf{h->h.isFinite()}?:return null}
            val h=heights.average()
            if(!(h>lowerMeters && (underground||h<=upperMeters)))continue
            val p=corners.mapIndexed{i,(lat,lon)->Position(lat.degrees,wrap(lon).degrees,heights[i])}
            triangles+=listOf(p[0],p[1],p[2],p[0],p[2],p[3])
        }
        val sectors=when {
            maxLon>180.0 -> listOf(Sector(minLat.degrees,maxLat.degrees,minLon.degrees,180.0.degrees),Sector(minLat.degrees,maxLat.degrees,(-180.0).degrees,(maxLon-360.0).degrees))
            minLon < -180.0 -> listOf(Sector(minLat.degrees,maxLat.degrees,(-180.0).degrees,(maxLon+360.0).degrees),Sector(minLat.degrees,maxLat.degrees,(minLon+360.0).degrees,180.0.degrees))
            else -> listOf(Sector(minLat.degrees,maxLat.degrees,minLon.degrees,maxLon.degrees))
        }
        return NativeTerrainCutMesh(id,triangles,sectors.first(),sectors.drop(1))
    }

    private fun unwrap(values:List<Double>):List<Double>{
        if(values.isEmpty())return values
        val out=mutableListOf(values.first());for(v in values.drop(1)){var n=v;while(n-out.first()>180)n-=360;while(n-out.first() < -180)n+=360;out+=n};return out
    }
    private fun contains(p:Pair<Double,Double>,poly:List<Pair<Double,Double>>):Boolean{
        var inside=false;var j=poly.lastIndex
        for(i in poly.indices){val a=poly[i];val b=poly[j]
            val cross=(p.first-a.first)*(b.second-a.second)-(p.second-a.second)*(b.first-a.first)
            if(kotlin.math.abs(cross)<1e-12&&p.first>=min(a.first,b.first)-1e-12&&p.first<=max(a.first,b.first)+1e-12&&p.second>=min(a.second,b.second)-1e-12&&p.second<=max(a.second,b.second)+1e-12)return true
            if((a.first>p.first)!=(b.first>p.first)&&p.second<(b.second-a.second)*(p.first-a.first)/(b.first-a.first)+a.second)inside=!inside;j=i}
        return inside
    }
    private fun wrap(lon:Double)=((lon+180)%360+360)%360-180
}

/** WorldWind layer that writes the engine's GROUND_COVERED_BIT stencil before terrain draws.
 *  BasicDrawableTerrain then skips those exact rasterized ground pixels. The model renderables
 *  themselves remain normal depth-tested shapes above the excavation. */
class NativeTerrainCutLayer:AbstractLayer("模型地形裁切"),NativeTerrainCutSink {
    private data class Entry(val mesh:NativeTerrainCutMesh,val version:Int)
    private val entries=linkedMapOf<String,Entry>()
    private val keyPrefix=Any()
    private val versions=mutableMapOf<String,Int>()

    @Synchronized override fun upsert(mesh:NativeTerrainCutMesh){
        if(mesh.triangles.isEmpty()){remove(mesh.id);return}
        val version=(versions[mesh.id]?:0)+1;versions[mesh.id]=version;entries[mesh.id]=Entry(mesh,version);earth.worldwind.WorldWind.requestRedraw()
    }
    @Synchronized override fun remove(id:String){if(entries.remove(id)!=null)earth.worldwind.WorldWind.requestRedraw()}
    @Synchronized override fun clear(){if(entries.isNotEmpty()){entries.clear();earth.worldwind.WorldWind.requestRedraw()}}

    override fun doRender(rc:RenderContext){
        val snapshot=synchronized(this){entries.values.toList()}
        for(entry in snapshot){
            val points=entry.mesh.triangles
            if(points.isEmpty())continue
            rc.groundCoverageRegions.addAll(entry.mesh.coverageSectors);rc.hasGroundCoverageMask=true
            val origin=Vec3();val cartesian=Vec3();val coords=FloatArray(points.size*3);var k=0
            for(i in points.indices){val p=points[i];rc.globe.geographicToCartesian(p.latitude,p.longitude,p.altitude,cartesian);if(i==0)origin.copy(cartesian);coords[k++]=(cartesian.x-origin.x).toFloat();coords[k++]=(cartesian.y-origin.y).toFloat();coords[k++]=(cartesian.z-origin.z).toFloat()}
            val key=MaskBufferKey(keyPrefix,entry.mesh.id)
            val buffer=rc.getBufferObject(key){BufferObject(GL_ARRAY_BUFFER,0)}
            rc.offerGLBufferUpload(key,entry.version){NumericArray.Floats(coords)}
            rc.offerSurfaceDrawable(NativeTerrainMaskDrawable(origin,buffer,coords.size/3,rc.getShaderProgram{NativeTerrainMaskProgram()}),Double.NEGATIVE_INFINITY)
        }
    }

    private data class MaskBufferKey(val owner:Any,val id:String)
}

private class NativeTerrainMaskProgram:AbstractShaderProgram(){
    override var programSources=arrayOf(
        "uniform mat4 mvpMatrix; attribute vec4 vertexPoint; void main(){ gl_Position=mvpMatrix*vec4(vertexPoint.xyz,1.0); }",
        "#ifdef GL_ES\nprecision mediump float;\n#endif\nvoid main(){ gl_FragColor=vec4(0.0); }",
    )
    override val attribBindings=arrayOf("vertexPoint")
    private var mvpId=KglUniformLocation.NONE
    private val matrix=FloatArray(16)
    override fun initProgram(dc:earth.worldwind.draw.DrawContext){super.initProgram(dc);mvpId=gl.getUniformLocation(program,"mvpMatrix")}
    fun loadMvp(value:Matrix4){value.transposeToArray(matrix,0);gl.uniformMatrix4fv(mvpId,1,false,matrix,0)}
}

private class NativeTerrainMaskDrawable(private val origin:Vec3,private val vertices:BufferObject,private val count:Int,private val shader:NativeTerrainMaskProgram):Drawable{
    private val mvp=Matrix4()
    override fun recycle(){}
    override fun draw(dc:earth.worldwind.draw.DrawContext){
        if(count<3||!shader.useProgram(dc)||!vertices.bindBuffer(dc))return
        mvp.copy(dc.modelviewProjection).multiplyByTranslation(origin.x,origin.y,origin.z);shader.loadMvp(mvp)
        dc.gl.enable(GL_STENCIL_TEST);dc.gl.stencilFunc(GL_ALWAYS,GROUND_COVERED_BIT,GROUND_COVERED_BIT);dc.gl.stencilOp(GL_KEEP,GL_KEEP,GL_REPLACE);dc.gl.stencilMask(GROUND_COVERED_BIT)
        dc.gl.colorMask(false,false,false,false);dc.gl.depthMask(false);dc.gl.enableVertexAttribArray(0);dc.gl.vertexAttribPointer(0,3,GL_FLOAT,false,0,0)
        try{dc.gl.drawArrays(GL_TRIANGLES,0,count)}finally{
            dc.gl.disableVertexAttribArray(0);dc.gl.colorMask(true,true,true,true);dc.gl.depthMask(true)
            dc.gl.disable(GL_STENCIL_TEST);dc.gl.stencilFunc(GL_ALWAYS,0,0xFF);dc.gl.stencilOp(GL_KEEP,GL_KEEP,GL_KEEP);dc.gl.stencilMask(0xFF)
        }
    }
}
