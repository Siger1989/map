package com.shantu.nativeapp.data

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class NativeCollectionTransformTest {
    @Test fun batchTransformsAllSavedCollectionGeometryAndPreservesOpaqueMetadata() {
        val spec=NativeCollectionTransformSpec(eastMeters=100.0,northMeters=50.0,upMeters=5.0,rotationDegrees=90.0,scale=2.0)
        val route=JSONObject().put("id","r").put("route",JSONObject().put("coordinates",line()).put("trackNetwork",JSONArray().put(line())).put("distance",100.0).put("vendor",JSONObject().put("keep",true)))
        val track=JSONObject().put("id","t").put("segments",JSONArray().put(line()).put(line(11.0,21.0))).put("samples",JSONArray().put(JSONArray().put(JSONObject().put("altitude",30).put("time",1))).put(JSONArray().put(JSONObject().put("altitude",40).put("time",2)))).put("style",JSONObject().put("color","#aabbcc").put("width",2.5)).put("attributes",JSONArray().put(JSONObject().put("name","node note")))
        val model=JSONObject().put("id","m").put("kind","box").put("coordinates",point()).put("footprint",JSONArray().put(JSONArray().put(10.0).put(20.0)).put(JSONArray().put(10.001).put(20.0))).put("sectionAnchor",JSONObject().put("sectionId","profile-1").put("distance",12)).put("groundElevation",100).put("centerAltitude",120).put("width",10).put("length",20).put("height",30).put("heading",15).put("offset",4).put("attributes",JSONArray().put(JSONObject().put("value","keep")))
        val area=JSONObject().put("id","a").put("color","#445566").put("boundary",JSONArray().put(JSONArray().put(10).put(20)).put(JSONArray().put(10.001).put(20)).put(JSONArray().put(10.001).put(20.001)).put(JSONArray().put(10).put(20.001)).put(JSONArray().put(10).put(20)))
        val survey = JSONObject()
            .put("a", point())
            .put("b", JSONArray().put(10.1).put(20.1))
            .put("halfWidth", 5)
            .put("stations", JSONArray()
                .put(JSONObject().put("id", "st-1").put("distance", 20).put("label", "preserve"))
                .put(JSONObject().put("id", "st-2").put("distance", 80).put("label", "branch")))
            .put("pointData", JSONObject().put("st-1", JSONObject().put("name", "branch note")))
        val sectionSettings = JSONObject()
            .put("altitude", 10)
            .put("plane", JSONObject().put("center", point()).put("width", 100).put("height", 40).put("heading", 20).put("tilt", 0))
            .put("survey", survey)
            .put("surveyTerrain", JSONObject().put("start", 0).put("end", 100).put("halfWidth", 5).put("heights", JSONArray().put(10).put(JSONObject.NULL).put(20)))
        val section = JSONObject().put("id", "s").put("settings", sectionSettings)
        val measurement=JSONObject().put("id","q").put("updatedAt",1).put("points",JSONArray().put(JSONObject().put("id","p1").put("coordinates",point()).put("altitude",50).put("heightSource","manual")).put(JSONObject().put("id","p2").put("coordinates",JSONArray().put(10.1).put(20)).put("altitude",JSONObject.NULL).put("heightSource","unknown"))))
        val records=listOf("favorites" to route,"tracks" to track,"annotations" to model,"areas" to area,"sections" to section,"measurements" to measurement).map{(container,item)->CollectionRecordRef(container,item.getString("id")) to item}
        val changed=NativeCollectionTransform.transformBatch(records,spec)
        val changedTrack=changed.getValue(CollectionRecordRef("tracks","t"))
        assertEquals(2,changedTrack.getJSONArray("segments").length());assertEquals("node note",changedTrack.getJSONArray("attributes").getJSONObject(0).getString("name"));assertEquals("#aabbcc",changedTrack.getJSONObject("style").getString("color"));assertNotEquals(11.0,changedTrack.getJSONArray("segments").getJSONArray(1).getJSONArray(0).getDouble(0),1e-9);assertEquals(45.0,changedTrack.getJSONArray("samples").getJSONArray(1).getJSONObject(0).getDouble("altitude"),0.0)
        val modelOut=changed.getValue(CollectionRecordRef("annotations","m"));assertEquals(20.0,modelOut.getDouble("width"),0.0);assertEquals(105.0,modelOut.getDouble("heading"),0.0);assertNotEquals(10.0,modelOut.getJSONArray("footprint").getJSONArray(0).getDouble(0),1e-9);assertEquals(24.0,modelOut.getJSONObject("sectionAnchor").getDouble("distance"),0.0);assertEquals(100.0,modelOut.getDouble("groundElevation"),0.0);assertEquals(125.0,modelOut.getDouble("centerAltitude"),0.0);assertEquals(13.0,modelOut.getDouble("offset"),0.0);assertEquals("keep",modelOut.getJSONArray("attributes").getJSONObject(0).getString("value"))
        val areaObj=changed.getValue(CollectionRecordRef("areas","a"));val areaOut=areaObj.getJSONArray("boundary");assertEquals(areaOut.getJSONArray(0).toString(),areaOut.getJSONArray(4).toString());assertEquals("#445566",areaObj.getString("color"))
        val sectionOut=changed.getValue(CollectionRecordRef("sections","s")).getJSONObject("settings");val survey=sectionOut.getJSONObject("survey");assertEquals(40.0,survey.getJSONArray("stations").getJSONObject(0).getDouble("distance"),0.0);assertEquals("branch",survey.getJSONArray("stations").getJSONObject(1).getString("label"));assertEquals("branch note",survey.getJSONObject("pointData").getJSONObject("st-1").getString("name"));assertEquals(105.0,sectionOut.getDouble("altitude"),0.0);assertEquals(110.0,sectionOut.getJSONObject("plane").getDouble("heading"),0.0);assertEquals(200.0,sectionOut.getJSONObject("plane").getDouble("width"),0.0);assertNotEquals(10.0,survey.getJSONArray("a").getDouble(0),0.0);assertEquals(15.0,sectionOut.getJSONObject("surveyTerrain").getJSONArray("heights").getDouble(0),0.0);assertTrue(sectionOut.getJSONObject("surveyTerrain").getJSONArray("heights").isNull(1))
        val measureOut=changed.getValue(CollectionRecordRef("measurements","q")).getJSONArray("points").getJSONObject(0);assertEquals(55.0,measureOut.getDouble("altitude"),0.0);assertEquals("p1",measureOut.getString("id"))
        val routeOut=changed.getValue(CollectionRecordRef("favorites","r")).getJSONObject("route");assertEquals(200.0,routeOut.getDouble("distance"),0.0);assertTrue(routeOut.getJSONObject("vendor").getBoolean("keep"))
        assertEquals(10.0,route.getJSONObject("route").getJSONArray("coordinates").getJSONArray(0).getDouble(0),0.0)
    }

    @Test fun extremeResultRejectsWholeBatchAndInvalidScaleIsRejected() {
        val record=JSONObject().put("id","pin").put("coordinates",JSONArray().put(10).put(84.9))
        val ref=CollectionRecordRef("annotations","pin")
        assertNotNull(runCatching{NativeCollectionTransform.transformBatch(listOf(ref to record),NativeCollectionTransformSpec(northMeters=100_000.0))}.exceptionOrNull())
        assertNotNull(runCatching{NativeCollectionTransform.transformBatch(listOf(ref to record),NativeCollectionTransformSpec(scale=0.0))}.exceptionOrNull())
        assertEquals(10.0,record.getJSONArray("coordinates").getDouble(0),0.0)
    }

    private fun point()=JSONArray().put(10.0).put(20.0).put(100.0)
    private fun line(lon:Double=10.0,lat:Double=20.0)=JSONArray().put(JSONArray().put(lon).put(lat).put(10.0)).put(JSONArray().put(lon+.001).put(lat+.001).put(20.0))
}
