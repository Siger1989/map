package com.shantu.nativeapp.map

import earth.worldwind.layer.mvt.MvtGeometryType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeCartographyLayersTest {
    @Test fun `roads labels domestic labels and boundaries remain independent`() {
        val plan = NativeCartographyPlan.resolve(NativeCartographySettings(
            roads = true, labels = false, roadsOpacity = .42f, rasterLabelOpacity = .17f, satellite = true,
            satelliteProvider = "tianditu", imageryMode = "latest", tiandituBase = "img",
            tiandituLabels = "auto", tiandituBoundaries = true,
        ))
        assertTrue(plan.roads)
        assertFalse(plan.roadNames)
        assertFalse(plan.placeLabels)
        assertNull(plan.tiandituLabels)
        assertTrue(plan.tiandituBoundaries)
        assertEquals(.42f, plan.roadsOpacity, .001f)
        assertEquals(.17f, plan.rasterLabelOpacity, .001f)
        assertEquals("tianditu:img", plan.effectiveBase)
        assertTrue(plan.satelliteUnderlay)
    }

    @Test fun `runtime settings preserve independent vector road and raster label opacity`() {
        val settings = NativeCartographySettings.fromRuntime(com.shantu.nativeapp.data.NativeRuntimeSettings(
            roadsEnabled = true, labelsEnabled = true, roadsOpacity = .35f, rasterLabelOpacity = .72f,
            satelliteProvider = "tianditu", tiandituLabels = "auto",
        ))
        val plan = NativeCartographyPlan.resolve(settings)
        assertEquals(.35f, plan.roadsOpacity, .001f)
        assertEquals(.72f, plan.rasterLabelOpacity, .001f)
    }

    @Test fun `React defaults to terrain and only selects registered providers explicitly`() {
        val defaultSource = NativeCartographySelection.sourceId(
            hasCustomSource = false, offlineBasemap = false, satellite = false,
            satelliteProvider = "sentinel", imageryMode = "detail", tiandituBase = "vec",
            tiandituConfigured = true,
        )
        assertEquals("terrain", defaultSource)
        assertEquals("terrain", NativeCartographyPlan.resolve(NativeCartographySettings(sourceId = defaultSource)).effectiveBase)

        assertEquals("tianditu-vector", NativeCartographySelection.sourceId(
            false, false, false, "tianditu", "detail", "vec", true,
        ))
        assertEquals("terrain", NativeCartographySelection.sourceId(
            false, false, false, "tianditu", "detail", "vec", false,
        ))
        assertEquals("sentinel-detail", NativeCartographySelection.sourceId(
            false, false, true, "sentinel", "detail", "img", true,
        ))
        assertEquals("sentinel-latest", NativeCartographySelection.sourceId(
            false, false, true, "sentinel", "latest", "img", true,
        ))
        assertEquals("offline", NativeCartographySelection.sourceId(
            false, true, true, "tianditu", "detail", "img", true,
        ))
        assertEquals("custom", NativeCartographySelection.sourceId(
            true, false, true, "sentinel", "detail", "img", true,
        ))
        assertEquals("custom:west", NativeCartographySelection.rasterDatumKey("west", true, false, "sentinel", "detail", "img"))
        assertEquals("sentinel", NativeCartographySelection.rasterDatumKey(null, true, false, "sentinel", "detail", "img"))
        assertEquals("tianditu:vec", NativeCartographySelection.rasterDatumKey(null, false, false, "tianditu", "detail", "vec"))
        assertEquals("terrain", NativeCartographySelection.rasterDatumKey(null, false, false, "sentinel", "detail", "vec"))

        val sentinel = NativeCartographyPlan.resolve(NativeCartographySettings(sourceId = "sentinel-2025"))
        assertEquals("sentinel-detail", sentinel.effectiveBase)
        assertTrue(sentinel.satelliteUnderlay)

        val custom = NativeCartographyPlan.resolve(NativeCartographySettings(sourceId = "custom", offlineBasemap = true))
        assertEquals("custom", custom.effectiveBase)
        assertTrue(custom.satelliteUnderlay)
    }

    @Test fun `fixed raster zoom preserves auto sentinel and clamps offline caps`() {
        assertNull(NativeRasterZoomPolicy.resolve(-1, null, 0, 24))
        assertEquals(18, NativeRasterZoomPolicy.resolve(20, 18, 0, 24))
        assertEquals(1, NativeRasterZoomPolicy.resolve(0, null, 1, 19))
        assertEquals(19, NativeRasterZoomPolicy.resolve(24, null, 1, 19))
        assertEquals(9, NativeRasterZoomPolicy.resolve(-1, 9, 0, 14))
    }

    @Test fun `vector label mode enables separate OSM names while suppressing TDT annotation raster`() {
        val plan = NativeCartographyPlan.resolve(NativeCartographySettings(
            roads = true, labels = true, satelliteProvider = "tianditu", tiandituBase = "ter",
            tiandituLabels = "vector", tiandituBoundaries = false,
        ))
        assertTrue(plan.roads && plan.roadNames && plan.placeLabels)
        assertNull(plan.tiandituLabels)
        assertFalse(plan.tiandituBoundaries)
    }

    @Test fun `auto TDT annotation follows selected base and off mode does not request tiles`() {
        for ((base, expected) in listOf("vec" to "cva", "img" to "cia", "ter" to "cta")) {
            val plan = NativeCartographyPlan.resolve(NativeCartographySettings(
                labels = true, satelliteProvider = "tianditu", tiandituBase = base, tiandituLabels = "auto",
            ))
            assertEquals(expected, plan.tiandituLabels)
        }
        val none = NativeCartographyPlan.resolve(NativeCartographySettings(
            labels = true, satelliteProvider = "tianditu", tiandituBase = "img", tiandituLabels = "none",
        ))
        assertNull(none.tiandituLabels)
    }

    @Test fun `offline basemap prevents domestic imagery labels and underlay`() {
        val plan = NativeCartographyPlan.resolve(NativeCartographySettings(
            roads = true, labels = true, satellite = true, satelliteProvider = "tianditu",
            tiandituLabels = "auto", tiandituBoundaries = true, offlineBasemap = true,
        ))
        assertEquals("offline", plan.effectiveBase)
        assertNull(plan.tiandituLabels)
        assertFalse(plan.tiandituBoundaries)
        assertFalse(plan.satelliteUnderlay)
        assertTrue(plan.roads && plan.roadNames && plan.placeLabels)
    }

    @Test fun `MVT styles draw only road geometry and supply real independent name rules`() {
        assertNotNull(NativeCartographyLayers.roadStyle.styleFor("transportation", MvtGeometryType.LINESTRING, mapOf("class" to "primary")))
        assertNotNull(NativeCartographyLayers.roadStyle.styleFor("waterway", MvtGeometryType.LINESTRING, emptyMap()))
        assertNull(NativeCartographyLayers.roadStyle.styleFor("place", MvtGeometryType.POINT, mapOf("name" to "Town")))
        val roadName = NativeCartographyLayers.roadNameStyle.firstMatching("transportation_name", MvtGeometryType.LINESTRING, 14, mapOf("name:zh" to "公路"))
        assertNotNull(roadName)
        assertEquals("name:zh", roadName!!.paint.textField)
        val placeName = NativeCartographyLayers.placeLabelStyle.firstMatching("place", MvtGeometryType.POINT, 8, mapOf("name:nonlatin" to "Mountain"))
        assertNotNull(placeName)
        assertEquals("name:nonlatin", placeName!!.paint.textField)
    }
}
