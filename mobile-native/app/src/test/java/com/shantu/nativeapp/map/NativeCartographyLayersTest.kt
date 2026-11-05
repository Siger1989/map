package com.shantu.nativeapp.map

import earth.worldwind.layer.mvt.MvtGeometryType
import earth.worldwind.layer.mvt.MvtExpression
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeCartographyLayersTest {
    @Test fun `raster annotation and basemap share the selected refinement threshold`() {
        val standard = NativeCartographyRasterQuality.detailControl(NativeMapQuality.STANDARD)
        val high = NativeCartographyRasterQuality.detailControl(NativeMapQuality.HIGH)
        assertTrue(high > 0.0 && high < standard)
        assertEquals(0.5, high, 0.0)
        assertEquals(1.0, standard, 0.0)
    }
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

    @Test fun `built in TDT raster datum honors only explicit overrides without changing source identity`() {
        assertEquals(NativeRasterDatum.WGS84, NativeRasterDatumOverride.resolve(null))
        assertEquals(NativeRasterDatum.WGS84, NativeRasterDatumOverride.resolve("auto"))
        assertEquals(NativeRasterDatum.WGS84, NativeRasterDatumOverride.resolve("unknown"))
        assertEquals(NativeRasterDatum.GCJ02, NativeRasterDatumOverride.resolve("GCJ02"))
        assertEquals(NativeRasterDatum.BD09, NativeRasterDatumOverride.resolve("bd09"))

        val settings = NativeCartographySettings(
            sourceId = "tianditu-imagery", satelliteProvider = "tianditu", tiandituBase = "img",
            tiandituRasterDatum = NativeRasterDatum.GCJ02,
        )
        val plan = NativeCartographyPlan.resolve(settings)
        assertEquals("tianditu-imagery", settings.sourceId)
        assertEquals("tianditu:img", plan.effectiveBase)
        assertEquals(NativeRasterDatum.GCJ02, settings.tiandituRasterDatum)
        assertEquals("tianditu:vec", NativeCartographySelection.rasterDatumKey(null, false, false, "tianditu", "detail", "vec"))
        assertEquals("tianditu:img", NativeCartographySelection.rasterDatumKey(null, false, false, "tianditu", "detail", "img"))
        assertEquals("tianditu:ter", NativeCartographySelection.rasterDatumKey(null, false, false, "tianditu", "detail", "ter"))
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
        assertEquals(11.5f * .84f, roadName.paint.textSize!!.evaluate(MvtExpression.EvalContext(14.0, emptyMap()))!!, .0001f)
        val roadRef = NativeCartographyLayers.roadNameStyle.firstMatching("transportation_name", MvtGeometryType.LINESTRING, 8, mapOf("ref" to "G318"))
        assertNotNull(roadRef)
        assertEquals(9f * .84f, roadRef!!.paint.textSize!!.evaluate(MvtExpression.EvalContext(8.0, emptyMap()))!!, .0001f)
        val placeName = NativeCartographyLayers.placeLabelStyle.firstMatching("place", MvtGeometryType.POINT, 8, mapOf("name:nonlatin" to "Mountain"))
        assertNotNull(placeName)
        assertEquals("name:nonlatin", placeName!!.paint.textField)
        assertEquals(11f * .84f, placeName.paint.textSize!!.evaluate(MvtExpression.EvalContext(8.0, emptyMap()))!!, .0001f)
        assertNull("Preserve the existing z3 floor; category hierarchy must not expose extra global labels",
            NativeCartographyLayers.placeLabelStyle.firstMatching("place", MvtGeometryType.POINT, 2, mapOf("name:zh" to "村落")))
    }

    @Test fun `combined label style modes preserve separate road and place switches`() {
        val both = NativeCartographyLayers.labelStyleFor(roadNames = true, placeLabels = true)
        val roadsOnly = NativeCartographyLayers.labelStyleFor(roadNames = true, placeLabels = false)
        val placesOnly = NativeCartographyLayers.labelStyleFor(roadNames = false, placeLabels = true)
        val neither = NativeCartographyLayers.labelStyleFor(roadNames = false, placeLabels = false)
        val road = Triple("transportation_name", MvtGeometryType.LINESTRING, mapOf("ref" to "G318"))
        val place = Triple("place", MvtGeometryType.POINT, mapOf("name:zh" to "城镇"))

        assertEquals(NativeCartographyLayers.roadNameStyle.rules + NativeCartographyLayers.placeLabelStyle.rules, both.rules)
        assertNotNull(both.firstMatching(road.first, road.second, 8, road.third))
        assertNotNull(both.firstMatching(place.first, place.second, 8, place.third))
        assertNotNull(roadsOnly.firstMatching(road.first, road.second, 8, road.third))
        assertNull(roadsOnly.firstMatching(place.first, place.second, 8, place.third))
        assertNull(placesOnly.firstMatching(road.first, road.second, 8, road.third))
        assertNotNull(placesOnly.firstMatching(place.first, place.second, 8, place.third))
        assertTrue(neither.rules.isEmpty())
    }

    @Test fun `place label sizes follow class tiers and retain kind and subclass fallbacks`() {
        val rule = NativeCartographyLayers.placeLabelStyle.firstMatching(
            "place", MvtGeometryType.POINT, 8, mapOf("name:zh" to "城市"),
        )!!
        val size = rule.paint.textSize!!
        fun at(properties: Map<String, Any?>) = size.evaluate(MvtExpression.EvalContext(8.0, properties))!!

        val country = at(mapOf("class" to "country"))
        val province = at(mapOf("class" to "province"))
        val city = at(mapOf("class" to "city"))
        val town = at(mapOf("class" to "town"))
        val village = at(mapOf("class" to "village"))
        assertTrue(country > province && province > city && city > town && town > village)
        assertEquals(12f * .84f, at(mapOf("kind" to "town")), .0001f)
        assertEquals(10.5f * .84f, at(mapOf("subclass" to "village")), .0001f)
    }
}
