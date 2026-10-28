package com.shantu.nativeapp.data

import org.json.JSONArray
import org.json.JSONObject

/** Standard KML point/line export with the same altitude-gap and style rules as xmlExport.ts. */
internal object NativeKmlExporter {
    fun export(tracks:List<JSONObject>,pins:JSONArray):String=buildString {
        append("<?xml version=\"1.0\" encoding=\"UTF-8\"?><kml xmlns=\"http://www.opengis.net/kml/2.2\"><Document>")
        for(i in 0 until pins.length()) {
            val pin=pins.getJSONObject(i);val coordinate=pin.getJSONArray("coordinates")
            append("<Placemark><name>${xml(pin.optString("name"))}</name><description>${xml(pin.optString("note"))}</description><Point><coordinates>${xy(coordinate)}</coordinates></Point></Placemark>")
        }
        for(track in tracks) {
            val style=JSONObject().put("style",track.optJSONObject("style") ?: JSONObject().put("color","#38a8d8").put("width",2))
            for(key in listOf("edgeColors","colorConditions","kmlTime"))if(track.has(key))style.put(key,track.get(key))
            append("<Placemark><name>${xml(track.optString("name"))}</name><ExtendedData><Data name=\"shantu-route-style\"><value>${xml(style.toString())}</value></Data></ExtendedData><MultiGeometry>")
            val segments=track.optJSONArray("segments") ?: JSONArray()
            for(index in 0 until segments.length())append(geometries(segments.getJSONArray(index),track.optJSONArray("samples")?.optJSONArray(index)))
            append("</MultiGeometry></Placemark>")
        }
        append("</Document></kml>")
    }

    private fun geometries(line:JSONArray,samples:JSONArray?):String=buildString {
        if(line.length()==0)return@buildString
        val elevations=(0 until line.length()).map {i->
            (samples?.optJSONObject(i)?.opt("altitude") as? Number)?.toDouble()?.takeIf(Double::isFinite)
        }
        fun point(i:Int)="<Point><altitudeMode>absolute</altitudeMode><coordinates>${xy(line.getJSONArray(i))},${elevations[i]}</coordinates></Point>"
        if(line.length()==1) {
            append(if(elevations[0]!=null)point(0) else "<LineString><tessellate>1</tessellate><coordinates>${xy(line.getJSONArray(0))}</coordinates></LineString>")
            return@buildString
        }
        var absolute:Boolean?=null
        val vertices=mutableListOf<Int>()
        val anchored=mutableSetOf<Int>()
        fun flush() {
            if(vertices.size>=2) {
                val mode=if(absolute==true)"absolute" else "clampToGround"
                append("<LineString><altitudeMode>$mode</altitudeMode><tessellate>1</tessellate><coordinates>")
                append(vertices.joinToString(" ") {i->xy(line.getJSONArray(i))+(if(absolute==true)",${elevations[i]}" else "")})
                append("</coordinates></LineString>")
            }
            vertices.clear()
        }
        for(i in 0 until line.length()-1) {
            val next=elevations[i]!=null && elevations[i+1]!=null
            if(absolute!=next){flush();absolute=next}
            if(vertices.isEmpty())vertices+=i
            vertices+=i+1
            if(next){anchored+=i;anchored+=i+1}
        }
        flush()
        for(i in elevations.indices)if(elevations[i]!=null && i !in anchored)append(point(i))
    }
    private fun xy(value:JSONArray):String {
        val lon=value.getDouble(0);val lat=value.getDouble(1)
        require(lon.isFinite() && lat.isFinite() && lon in -180.0..180.0 && lat in -90.0..90.0){"路线坐标无效"}
        return "$lon,$lat"
    }
    private fun xml(value:String)=value.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;").replace("\"","&quot;").replace("'","&apos;")
}
