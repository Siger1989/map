package com.shantu.nativeapp.map

import com.shantu.nativeapp.navigation.NativeCoordinate
import com.shantu.nativeapp.navigation.NativeRouteColorMode
import com.shantu.nativeapp.navigation.NativeRouteDisplay
import org.json.JSONObject

data class NativeRouteMapSegment(val coordinates:List<NativeCoordinate>,val color:Int)

/** Coalesces adjacent colored edges. Never bridges a source break or missing vertex. */
object NativeRouteMapSegments {
    fun build(track:JSONObject,globalMode:String):List<NativeRouteMapSegment>{
        val mode=when(if(globalMode=="original")track.optJSONObject("style")?.optString("colorMode","solid") else globalMode){"elevation"->NativeRouteColorMode.ELEVATION;"speed"->NativeRouteColorMode.SPEED;"slope"->NativeRouteColorMode.SLOPE;else->NativeRouteColorMode.SOLID}
        val display=NativeRouteDisplay.build(track,mode)
        val manual=track.optJSONArray("edgeColors")
        val result=mutableListOf<NativeRouteMapSegment>()
        display.segments.forEachIndexed{segmentIndex,edges->
            var points=mutableListOf<NativeCoordinate>();var color=0
            fun flush(){if(points.size>=2)result+=NativeRouteMapSegment(points.toList(),color);points=mutableListOf()}
            edges.forEachIndexed{edgeIndex,edge->
                val explicit=if(globalMode=="original"&&mode==NativeRouteColorMode.SOLID)manual?.optJSONArray(segmentIndex)?.optString(edgeIndex)?.takeIf{it.matches(Regex("#[0-9A-Fa-f]{6}"))} else null
                val nextColor=explicit?.let{0xff000000.toInt() or it.substring(1).toInt(16)}?:if(mode==NativeRouteColorMode.SOLID)edge.color else {
                    // 32 levels per channel bound renderable count without changing the displayed metric.
                    fun q(shift:Int)=(((edge.color ushr shift)and 255)/8*8) shl shift
                    0xff000000.toInt() or q(16) or q(8) or q(0)
                }
                if(points.isEmpty()){color=nextColor;points.add(edge.from)}
                else if(nextColor!=color||points.last()!=edge.from){flush();color=nextColor;points.add(edge.from)}
                points.add(edge.to)
            };flush()
        }
        return result
    }
}
