package com.shantu.nativeapp.ui

import android.content.Context
import com.shantu.nativeapp.data.NativeImportedSettings
import com.shantu.nativeapp.data.NativeRuntimeSettings
import com.shantu.nativeapp.data.NativeRouteFormats
import com.shantu.nativeapp.geometry.GeoPoint
import com.shantu.nativeapp.geometry.NativeAreaDisplay
import com.shantu.nativeapp.geometry.NativeMeasurements
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

@RunWith(RobolectricTestRunner::class)
@org.robolectric.annotation.Config(sdk = [28], manifest = org.robolectric.annotation.Config.NONE)
class NativeSettingsConsumersTest {
    private val context: Context get() = RuntimeEnvironment.getApplication()

    @Test fun importedAttributeTemplateSeedsEditorFieldsWithoutReplacingSavedValues() {
        val prefs = JSONObject().put("shantu.annotation-attributes.v1", JSONObject()
            .put("names", JSONArray().put("岩性").put("厚度")).put("recent", JSONArray().put("岩性")).toString())
        NativeImportedSettings.apply(context, prefs)
        val template = NativeImportedSettings.readRuntime(context).annotationAttributeNames
        val seeded = NativeObjectEditor.initialAttributes(JSONObject(), template)
        assertEquals("岩性", seeded.getJSONObject(0).getString("name"))
        assertEquals("", seeded.getJSONObject(0).getString("value"))
        val saved = JSONObject().put("attributes", JSONArray().put(JSONObject().put("name", "实测").put("value", "保存值")))
        assertEquals("保存值", NativeObjectEditor.initialAttributes(saved, template).getJSONObject(0).getString("value"))
    }

    @Test fun importedAreaUnitDrivesActualSphericalMeasurementDisplayValue() {
        NativeImportedSettings.apply(context, JSONObject().put("shantu-area-display-unit-v1", "ha"))
        val points = listOf(GeoPoint(0.0, 0.0), GeoPoint(.01, 0.0), GeoPoint(.01, .01), GeoPoint(0.0, .01))
        val squareMetres = NativeMeasurements.area(NativeMeasurements.closeBoundary(points)).area
        val hectares = NativeAreaDisplay.value(squareMetres, NativeImportedSettings.readRuntime(context).areaUnit)
        assertTrue(hectares > 1.2 && hectares < 1.3)
        assertTrue(NativeAreaDisplay.format(squareMetres, "ha").endsWith(" ha"))
        assertEquals("ha", NativeImportedSettings.readRuntime(context).areaUnit)
    }

    @Test fun geoJsonAreaExportCarriesCanonicalAreaAndSelectedDisplayUnit() {
        val area = JSONObject().put("id", "a1").put("name", "小区")
            .put("note", "").put("color", "#d0f76b").put("visible", true).put("createdAt", 1)
            .put("boundary", JSONArray().put(JSONArray().put(0.0).put(0.0)).put(JSONArray().put(.01).put(0.0))
                .put(JSONArray().put(.01).put(.01)).put(JSONArray().put(0.0).put(.01)).put(JSONArray().put(0.0).put(0.0)))
        val workspace = JSONObject().put("core", JSONObject().put("areas", JSONArray().put(area)))
        val exported = JSONObject(String(NativeRouteFormats.exportFile(NativeRouteFormats.Format.GEOJSON, workspace, "ha")))
        val properties = exported.getJSONArray("features").getJSONObject(0).getJSONObject("properties")
        assertEquals("ha", properties.getString("areaUnit"))
        assertEquals(123.6, properties.getString("areaValue").toDouble(), .5)
        assertTrue(properties.getDouble("areaSquareMetres") > 1_230_000)
        assertEquals(5, exported.getJSONArray("features").getJSONObject(0).getJSONObject("geometry")
            .getJSONArray("coordinates").getJSONArray(0).length())
    }

    @Test fun importedProjectCrsPrefillsCadCoordinateChoiceAndDatumValues() {
        val crs = JSONObject().put("id", "EPSG:32648").put("name", "UTM 48N")
            .put("definition", "+proj=utm +zone=48 +datum=WGS84 +units=m +no_defs")
            .put("datumParameters", JSONArray().put(1).put(2).put(3))
        NativeImportedSettings.apply(context, JSONObject().put("shantu.project-crs.v1", crs.toString()))
        val defaults = NativeCadPanel.prefillProjectCrs(NativeImportedSettings.readRuntime(context))
        assertEquals(3, defaults.first)
        assertEquals(crs.getString("definition"), defaults.second)
        assertEquals("1.0,2.0,3.0", defaults.third)
    }

    @Test fun coordinateTransferConsumesSavedProjectCrsAndTransformsRealCoordinates() {
        val runtime = NativeRuntimeSettings(
            projectCrsJson = JSONObject().put("id", "EPSG:3857").put("name", "Web Mercator")
                .put("definition", "+proj=merc +a=6378137 +b=6378137 +units=m +no_defs").toString(),
        )
        val project = runtime.projectCrs!!.let {
            com.shantu.nativeapp.coordinates.NativeProjectCrs(it.id, it.name, it.definition, it.datumParameters)
        }
        val result = NativeCoordinatePanel.convert("12000000,3500000", "EPSG:3857", "EPSG:4326", project) { values -> values.joinToString(", ") }
        val coordinate = result.split(", ").map(String::toDouble)
        assertTrue(coordinate[0] in 107.7..108.0)
        assertTrue(coordinate[1] in 31.0..32.0)
    }
}
