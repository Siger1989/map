package com.shantu.nativeapp.data

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

@RunWith(RobolectricTestRunner::class)
@org.robolectric.annotation.Config(sdk = [28], manifest = org.robolectric.annotation.Config.NONE)
class NativeImportedSettingsTest {
    private val context: Context get() = RuntimeEnvironment.getApplication()

    @Test fun completeLegacyWorkspaceSettingsBecomeRuntimeValues() {
        val layerSettings = JSONObject().put("version", 1).put("layers", JSONObject()
            .put("terrain", true).put("satellite", true).put("offlineBasemap", true)
            .put("tiandituBoundaries", true).put("contours", true).put("elevationColors", true)
            .put("geology", true).put("roads", true).put("labels", false)
            .put("satelliteProvider", "tianditu").put("tiandituBase", "ter").put("tiandituLabels", "cta")
            .put("geologySource", "geocloud20w").put("imageryMode", "latest")
            .put("contourInterval", 100).put("elevationColorsOpacity", .42).put("geologyOpacity", .63)
            .put("roadsOpacity", .71).put("exaggeration", 2.4).put("rasterLevel", JSONObject.NULL).put("rasterQuality", "high"))
        val routeDisplay = JSONObject().put("mode", "slope").put("legend", false).put("statistics", true)
            .put("profile", true).put("steep", true).put("coordinates", true)
        val trackStyle = JSONObject().put("color", "#12abef").put("width", 3.5).put("pointSize", 12)
            .put("opacity", .55).put("travelMode", "hiking").put("colorMode", "elevation")
        val attrs = JSONObject().put("names", JSONArray().put("岩性").put("产状"))
            .put("recent", JSONArray().put("岩性").put("采样编号"))
        val crs = JSONObject().put("id", "local:test").put("name", "测试坐标")
            .put("definition", "+proj=utm +zone=48 +datum=WGS84 +units=m +no_defs")
        val coordinates = JSONObject().put("custom:survey-1", "gcj02").put("tianditu:ter", "bd09")
        val layout = JSONObject().put("format", "shantu-layout-draft").put("version", 1)
            .put("viewport", JSONObject().put("width", 390).put("height", 857))
            .put("entries", JSONArray().put(JSONObject().put("selector", ".topbar").put("label", "顶部工具栏")
                .put("dx", 12).put("dy", -4).put("width", JSONObject.NULL).put("height", JSONObject.NULL)
                .put("scale", 1).put("fontSize", JSONObject.NULL).put("hidden", false)))
        val lastView = JSONObject().put("center", JSONArray().put(108.2).put(31.3)).put("zoom", 8.5)
            .put("bearing", 12).put("pitch", 35).put("terrain", true)
        val settings = JSONObject()
            .put("shantu.map.layer-preferences.v1", layerSettings.toString())
            .put("shantu-selected-map", "custom:survey-1")
            .put("shantu.routing-mode.v1", "auto")
            .put("shantu.route-display.v1", routeDisplay.toString())
            .put("shantu.appearance.v1", JSONObject().put("mode", "dark").put("dark", JSONObject().put("accent", "#12abef")).toString())
            .put("shantu-map-source-favorites-v1", JSONArray().put("custom:survey-1").toString())
            .put("shantu.map-source-coordinates.v1", coordinates.toString())
            .put("shantu.project-crs.v1", crs.toString())
            .put("shantu.ui-layout.v1", layout.toString())
            .put("shantu.map.last-view.v1", lastView.toString())
            .put("guanyun.track-style.v1", trackStyle.toString())
            .put("shantu.annotation-attributes.v1", attrs.toString())
            .put("shantu-area-display-unit-v1", "acre")
            .put("shantu.contour-interval.v1", "50")
            .put("shantu-map-comparison-source-groups-v1", JSONArray().put("内置").put("我的图源").toString())
            .put("guanyun.recording.max-accuracy.v1", "20")

        NativeImportedSettings.apply(context, settings)
        val runtime = NativeImportedSettings.readRuntime(context)
        val prefs = context.getSharedPreferences(NativeImportedSettings.PREFS, Context.MODE_PRIVATE)

        assertEquals("custom:survey-1", runtime.source)
        assertEquals(-1, runtime.rasterZoom) // null means automatic; zero is a valid fixed zoom.
        assertEquals("high", runtime.rasterQuality)
        assertTrue(runtime.terrainEnabled)
        assertEquals(2.4f, runtime.terrainExaggeration, .001f)
        assertTrue(runtime.contoursEnabled)
        assertEquals(50, runtime.contourInterval)
        assertTrue(runtime.elevationColorsEnabled)
        assertEquals(.42f, runtime.elevationOpacity, .001f)
        assertTrue(runtime.geologyEnabled)
        assertEquals("geocloud20w", runtime.geologySource)
        assertEquals(.63f, runtime.geologyOpacity, .001f)
        assertTrue(runtime.roadsEnabled)
        assertFalse(runtime.labelsEnabled)
        assertEquals(.71f, runtime.roadsOpacity, .001f)
        assertEquals(.71f, runtime.rasterLabelOpacity, .001f)
        assertTrue(runtime.satelliteEnabled && runtime.offlineBasemap && runtime.tiandituBoundaries)
        assertEquals("tianditu", runtime.satelliteProvider)
        assertEquals("latest", runtime.imageryMode)
        assertEquals("ter", runtime.tiandituBase)
        assertEquals("cta", runtime.tiandituLabels)
        assertEquals("offlineFirst", runtime.routingPreference)
        assertEquals("slope", JSONObject(runtime.routeDisplayJson!!).getString("mode"))
        assertEquals("slope", runtime.routeDisplay.mode)
        assertTrue(runtime.routeDisplay.statistics && runtime.routeDisplay.coordinates)
        assertEquals("#12abef", JSONObject(runtime.trackStyleJson!!).getString("color"))
        assertEquals(12, runtime.trackStyle.pointSize)
        assertEquals("elevation", runtime.trackStyle.colorMode)
        assertEquals("岩性", JSONObject(runtime.annotationAttributesJson!!).getJSONArray("names").getString(0))
        assertEquals(listOf("岩性", "产状"), runtime.annotationAttributeNames)
        assertEquals("local:test", JSONObject(runtime.projectCrsJson!!).getString("id"))
        assertEquals("local:test", runtime.projectCrs?.id)
        assertEquals("gcj02", runtime.datumFor("custom:survey-1"))
        assertEquals("bd09", runtime.datumFor("tianditu:ter"))
        assertEquals("wgs84", runtime.datumFor("missing-source"))
        assertEquals("acre", runtime.areaUnit)
        assertEquals(390, JSONObject(runtime.layoutJson!!).getJSONObject("viewport").getInt("width"))
        assertEquals("#home-topbar", runtime.layoutDraft?.entries?.single()?.selector)
        assertEquals("dark", JSONObject(runtime.themeJson!!).getString("mode"))
        assertEquals("custom:survey-1", JSONArray(runtime.favoriteSourceKeysJson).getString(0))
        assertEquals(listOf("custom:survey-1"), runtime.favoriteSourceKeys)
        assertEquals("我的图源", JSONArray(runtime.comparisonOpenGroupsJson).getString(1))
        assertEquals(8.5, JSONObject(runtime.legacyViewJson!!).getDouble("zoom"), .001)
        assertEquals(71, prefs.getInt("label-opacity", -1)) // raster annotation opacity remains distinct from labelsEnabled
        assertEquals(50, prefs.getInt("contour-interval", -1)) // explicit legacy interval overrides envelope fallback
        assertEquals(20, runtime.recordingMaxAccuracyMetres)
        assertTrue(prefs.contains("imported-runtime-v1"))
    }

    @Test fun runtimeSnapshotKeepsDistinctRoadOpacityAndLabelsAndFixedZeroZoom() {
        val settings = JSONObject()
            .put("shantu.map.layer-preferences.v1", JSONObject().put("version", 1).put("layers", JSONObject()
                .put("roads", true).put("labels", false).put("roadsOpacity", .37).put("rasterLevel", 0)).toString())
        NativeImportedSettings.apply(context, settings)
        val runtime = NativeImportedSettings.readRuntime(context)
        assertEquals(0, runtime.rasterZoom)
        assertTrue(runtime.roadsEnabled)
        assertFalse(runtime.labelsEnabled)
        assertEquals(.37f, runtime.roadsOpacity, .001f)
        assertEquals(.37f, context.getSharedPreferences(NativeImportedSettings.PREFS, 0).getInt("road-opacity", -1) / 100f, .001f)
    }

    @Test fun subsequentNativeUiEditsOverrideImportedSnapshotValues() {
        NativeImportedSettings.apply(context, JSONObject().put("shantu.route-display.v1", JSONObject()
            .put("mode", "speed").put("legend", true).put("statistics", false).put("profile", false)
            .put("steep", false).put("coordinates", false).toString()))
        context.getSharedPreferences(NativeImportedSettings.PREFS, 0).edit()
            .putString("route-display", JSONObject().put("mode", "elevation").put("legend", false).toString())
            .putString("area-unit", "mu")
            .apply()
        val runtime = NativeImportedSettings.readRuntime(context)
        assertEquals("elevation", runtime.routeDisplay.mode)
        assertEquals("mu", runtime.areaUnit)
    }
}
