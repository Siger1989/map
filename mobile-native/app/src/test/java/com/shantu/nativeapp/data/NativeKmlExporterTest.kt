package com.shantu.nativeapp.data

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[35])
class NativeKmlExporterTest {
    @Test fun pointAndSegmentNamesAreEscapedAndStyleSurvivesRoundTrip() {
        val line=JSONArray().put(JSONArray().put(10).put(20)).put(JSONArray().put(10.01).put(20.01))
        val track=JSONObject().put("id","t").put("name","路线<&").put("segments",JSONArray().put(line))
            .put("style",JSONObject().put("color","#ff0000").put("width",2.5).put("opacity",.8))
        val kml=NativeKmlExporter.export(listOf(track),JSONArray())
        assertTrue(kml.contains("路线&lt;&amp;"))
        val imported=NativeRouteFormats.importFile(kml.byteInputStream(),"route.kml").data.getJSONArray("tracks").getJSONObject(0)
        assertEquals("路线<&",imported.getString("name"))
        assertEquals(2,imported.getJSONArray("segments").getJSONArray(0).length())
        assertEquals("#ff0000",imported.getJSONObject("style").getString("color"))
    }
    @Test fun missingAltitudeSplitsModesAndDoesNotInventZeroHeightsOrJoinBreaks() {
        val line=JSONArray();listOf(10.0,10.01,10.02,10.03).forEach {line.put(JSONArray().put(it).put(20))}
        val samples=JSONArray().put(JSONObject().put("altitude",120)).put(JSONObject().put("altitude",125))
            .put(JSONObject().put("altitude",JSONObject.NULL)).put(JSONObject().put("altitude",140))
        val track=JSONObject().put("name","mix").put("segments",JSONArray().put(line))
            .put("samples",JSONArray().put(samples))
        val kml=NativeKmlExporter.export(listOf(track),JSONArray())
        assertTrue(kml.contains("absolute"));assertTrue(kml.contains("clampToGround"))
        assertTrue(kml.contains("10.0,20.0,120.0 10.01,20.0,125.0"))
        assertFalse(kml.contains("10.02,20.0,0"))
        assertTrue(kml.contains("<Point><altitudeMode>absolute</altitudeMode><coordinates>10.03,20.0,140.0"))
    }
}
