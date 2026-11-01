package com.shantu.nativeapp.map

import earth.worldwind.layer.mvt.MvtFeature
import earth.worldwind.layer.mvt.MvtGeometryType
import earth.worldwind.layer.mvt.MvtLayer
import earth.worldwind.layer.mvt.MvtTile
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NativeRoadStyleTest {
    @Test fun `road visibility follows UI zoom even when source tile has street detail`() {
        assertFalse(NativeRoadStyle.visible(NativeRoadStyle.Group.MAIN, 5.99))
        assertTrue(NativeRoadStyle.visible(NativeRoadStyle.Group.MAIN, 6.0))
        assertFalse(NativeRoadStyle.visible(NativeRoadStyle.Group.PRIMARY, 8.0))
        assertFalse(NativeRoadStyle.visible(NativeRoadStyle.Group.PRIMARY_OUTLINE, 9.0))
        assertFalse(NativeRoadStyle.visible(NativeRoadStyle.Group.PRIMARY, 9.5))
        assertTrue(NativeRoadStyle.visible(NativeRoadStyle.Group.PRIMARY, 9.5001))
        assertFalse(NativeRoadStyle.visible(NativeRoadStyle.Group.SECONDARY, 10.5))
        assertTrue(NativeRoadStyle.visible(NativeRoadStyle.Group.SECONDARY, 10.5001))
        assertFalse(NativeRoadStyle.visible(NativeRoadStyle.Group.TERTIARY, 12.0))
        assertTrue(NativeRoadStyle.visible(NativeRoadStyle.Group.TERTIARY, 12.0001))
        assertFalse(NativeRoadStyle.visible(NativeRoadStyle.Group.LOCAL, 13.5))
        assertTrue(NativeRoadStyle.visible(NativeRoadStyle.Group.LOCAL, 13.5001))
        assertFalse(NativeRoadStyle.visible(NativeRoadStyle.Group.RAIL, 8.99))
        assertTrue(NativeRoadStyle.visible(NativeRoadStyle.Group.RAIL, 9.0))
        assertTrue(NativeRoadStyle.visible(NativeRoadStyle.Group.RIVER, 3.0))
        assertFalse(NativeRoadStyle.visible(NativeRoadStyle.Group.RIVER, Double.NaN))
    }

    @Test fun `primary secondary tertiary and local density fades are continuous and monotone`() {
        val groups = listOf(
            NativeRoadStyle.Group.PRIMARY,
            NativeRoadStyle.Group.PRIMARY_OUTLINE,
            NativeRoadStyle.Group.SECONDARY,
            NativeRoadStyle.Group.SECONDARY_OUTLINE,
            NativeRoadStyle.Group.TERTIARY,
            NativeRoadStyle.Group.TERTIARY_OUTLINE,
            NativeRoadStyle.Group.LOCAL,
        )
        for (group in groups) {
            val stops = when (group) {
                NativeRoadStyle.Group.PRIMARY, NativeRoadStyle.Group.PRIMARY_OUTLINE -> listOf(9.5, 10.0, 10.5, 11.0)
                NativeRoadStyle.Group.SECONDARY, NativeRoadStyle.Group.SECONDARY_OUTLINE -> listOf(10.5, 11.0, 11.5, 12.0)
                NativeRoadStyle.Group.TERTIARY, NativeRoadStyle.Group.TERTIARY_OUTLINE -> listOf(12.0, 12.5, 13.0, 13.5)
                else -> listOf(13.5, 14.0, 14.5, 15.0)
            }
            val values = stops.map { NativeRoadStyle.densityFactor(group, it) }
            for (index in 1 until values.size) assertTrue("$group must fade in monotonically", values[index] >= values[index - 1])
            assertEquals(0f, values.first(), .0001f)
            assertEquals(1f, values.last(), .0001f)
            assertEquals(values[1], NativeRoadStyle.densityFactor(group, stops[1]), .0001f)
        }
        assertEquals(NativeRoadStyle.densityFactor(NativeRoadStyle.Group.PRIMARY, 10.5),
            NativeRoadStyle.densityFactor(NativeRoadStyle.Group.PRIMARY_OUTLINE, 10.5), .0001f)
        assertEquals(NativeRoadStyle.densityFactor(NativeRoadStyle.Group.SECONDARY, 11.0),
            NativeRoadStyle.densityFactor(NativeRoadStyle.Group.SECONDARY_OUTLINE, 11.0), .0001f)
        assertEquals(NativeRoadStyle.densityFactor(NativeRoadStyle.Group.TERTIARY, 13.0),
            NativeRoadStyle.densityFactor(NativeRoadStyle.Group.TERTIARY_OUTLINE, 13.0), .0001f)
    }

    @Test fun `density ramp multiplies original alpha without cumulative changes`() {
        val secondaryFactor = NativeRoadStyle.densityFactor(NativeRoadStyle.Group.SECONDARY, 11.25)
        val secondaryOriginalZoomAlpha = .755f // Existing MAIN curve at zoom 11.25.
        assertEquals(.5f, secondaryFactor, .0001f)
        assertEquals(secondaryOriginalZoomAlpha * secondaryFactor,
            NativeRoadStyle.opacityScale(NativeRoadStyle.Group.SECONDARY, 11.25), .0001f)
        assertEquals(.8f, NativeRoadStyle.opacityScale(NativeRoadStyle.Group.SECONDARY, 12.0), .0001f)
        assertEquals(.8375f * .5f, NativeRoadStyle.opacityScale(NativeRoadStyle.Group.TERTIARY, 12.75), .0001f)
        assertEquals(.895f * .5f, NativeRoadStyle.opacityScale(NativeRoadStyle.Group.LOCAL, 14.25), .0001f)
        assertEquals(.94f, NativeRoadStyle.opacityScale(NativeRoadStyle.Group.LOCAL, 15.0), .0001f)
        assertEquals(1f, NativeRoadStyle.opacityScale(NativeRoadStyle.Group.LOCAL, 16.0), .0001f)
    }

    @Test fun `existing backbone rail river widths and opacity rules remain unchanged`() {
        for (group in listOf(NativeRoadStyle.Group.MAIN, NativeRoadStyle.Group.MAIN_OUTLINE,
                NativeRoadStyle.Group.RAIL, NativeRoadStyle.Group.RIVER)) {
            val near = NativeRoadStyle.currentZoomStyle(group, 16.0)
            assertEquals(1f, near.opacityScale, .0001f)
        }
        assertEquals(.42f, NativeRoadStyle.widthCss(NativeRoadStyle.Group.MAIN, 10.0), .0001f)
        assertEquals(.68f, NativeRoadStyle.widthCss(NativeRoadStyle.Group.MAIN_OUTLINE, 10.0), .0001f)
        assertEquals(.68f, NativeRoadStyle.opacityScale(NativeRoadStyle.Group.MAIN, 10.0), .0001f)
        assertEquals(.68f, NativeRoadStyle.opacityScale(NativeRoadStyle.Group.MAIN_OUTLINE, 10.0), .0001f)
        assertEquals(.695f * .5f, NativeRoadStyle.opacityScale(NativeRoadStyle.Group.PRIMARY, 10.25), .0001f)
        assertEquals(.695f * .5f, NativeRoadStyle.opacityScale(NativeRoadStyle.Group.PRIMARY_OUTLINE, 10.25), .0001f)
        assertEquals(.25f, NativeRoadStyle.widthCss(NativeRoadStyle.Group.RAIL, 9.0), .0001f)
        assertEquals(.78f, NativeRoadStyle.opacityScale(NativeRoadStyle.Group.RAIL, 9.0), .0001f)
        assertEquals(1.5f, NativeRoadStyle.widthCss(NativeRoadStyle.Group.RIVER, 13.0), .0001f)
        assertEquals(1f, NativeRoadStyle.opacityScale(NativeRoadStyle.Group.RIVER, 10.0), .0001f)
        assertEquals(.18f, NativeRoadStyle.widthCss(NativeRoadStyle.Group.SECONDARY, 6.0), .0001f)
        assertEquals(.42f, NativeRoadStyle.widthCss(NativeRoadStyle.Group.PRIMARY, 10.0), .0001f)
        assertEquals(.68f, NativeRoadStyle.widthCss(NativeRoadStyle.Group.PRIMARY_OUTLINE, 10.0), .0001f)
        assertEquals(2f, NativeRoadStyle.widthCss(NativeRoadStyle.Group.TERTIARY, 16.0), .0001f)
        assertEquals(1f, NativeRoadStyle.opacityScale(NativeRoadStyle.Group.TERTIARY, 16.0), .0001f)
        assertEquals(.24f, NativeRoadStyle.widthCss(NativeRoadStyle.Group.LOCAL, 12.0), .0001f)
        assertEquals(.94f, NativeRoadStyle.opacityScale(NativeRoadStyle.Group.LOCAL, 15.0), .0001f)
    }

    @Test fun `only highways are yellow and other road groups preserve their colors`() {
        fun road(roadClass: String) = NativeRoadStyle.style.styleFor(
            "transportation", MvtGeometryType.LINESTRING, mapOf("class" to roadClass),
        )!!
        assertEquals(0xef / 255f, road("motorway").outlineColor.red, .0001f)
        assertEquals(0x76 / 255f, road("trunk").outlineColor.blue, .0001f)
        for (roadClass in listOf("primary", "secondary", "tertiary")) {
            assertEquals(0xd1 / 255f, road(roadClass).outlineColor.blue, .0001f)
            assertEquals(.85f, road(roadClass).outlineColor.alpha, .0001f)
        }
        assertEquals(.65f, road("path").outlineColor.alpha, .0001f)
        assertEquals(0xc8 / 255f, road("track").outlineColor.green, .0001f)
        assertNotNull(road("rail").outlineImageSource)
        assertNull(NativeRoadStyle.style.styleFor("place", MvtGeometryType.POINT, emptyMap()))
    }

    @Test fun `each transportation class is grouped once and casings share source geometry`() {
        fun feature(id: Long, classIndex: Int, type: MvtGeometryType = MvtGeometryType.LINESTRING) =
            MvtFeature(id, type, intArrayOf(0, classIndex), intArrayOf(9, 2, 2, 10, 2, 2))
        val motorway = feature(1, 0)
        val trunk = feature(2, 1)
        val primary = feature(3, 2)
        val secondary = feature(4, 3)
        val tertiary = feature(5, 4)
        val local = feature(6, 5)
        val rail = feature(7, 6)
        val polygon = feature(8, 0, MvtGeometryType.POLYGON)
        val layer = MvtLayer("transportation", 2, 4096, listOf("class"),
            listOf("motorway", "trunk", "primary", "secondary", "tertiary", "path", "rail"),
            listOf(motorway, trunk, primary, secondary, tertiary, local, rail, polygon))
        val groups = NativeRoadStyle.groups(MvtTile(listOf(layer))).toMap()
        assertEquals(setOf(
            NativeRoadStyle.Group.MAIN_OUTLINE, NativeRoadStyle.Group.MAIN,
            NativeRoadStyle.Group.PRIMARY_OUTLINE, NativeRoadStyle.Group.PRIMARY,
            NativeRoadStyle.Group.SECONDARY_OUTLINE, NativeRoadStyle.Group.SECONDARY,
            NativeRoadStyle.Group.TERTIARY_OUTLINE, NativeRoadStyle.Group.TERTIARY,
            NativeRoadStyle.Group.LOCAL, NativeRoadStyle.Group.RAIL,
        ), groups.keys)

        fun only(group: NativeRoadStyle.Group) = groups.getValue(group).layers.single().features.single()
        assertEquals(listOf(motorway, trunk), groups.getValue(NativeRoadStyle.Group.MAIN).layers.single().features)
        assertSame(primary, only(NativeRoadStyle.Group.PRIMARY))
        assertSame(secondary, only(NativeRoadStyle.Group.SECONDARY))
        assertSame(tertiary, only(NativeRoadStyle.Group.TERTIARY))
        assertSame(local, only(NativeRoadStyle.Group.LOCAL))
        assertSame(rail, only(NativeRoadStyle.Group.RAIL))
        val mainCasings = groups.getValue(NativeRoadStyle.Group.MAIN_OUTLINE).layers.single().features
        assertEquals(2, mainCasings.size)
        assertSame(motorway.geometry, mainCasings[0].geometry)
        assertSame(trunk.geometry, mainCasings[1].geometry)
        assertSame(primary.geometry, only(NativeRoadStyle.Group.PRIMARY_OUTLINE).geometry)
        assertSame(secondary.geometry, only(NativeRoadStyle.Group.SECONDARY_OUTLINE).geometry)
        assertSame(tertiary.geometry, only(NativeRoadStyle.Group.TERTIARY_OUTLINE).geometry)
        assertNotEquals("transportation", groups.getValue(NativeRoadStyle.Group.SECONDARY_OUTLINE).layers.single().name)
    }

    @Test fun `rendered group count progressively increases by UI zoom without source zoom input`() {
        val groups = listOf(
            NativeRoadStyle.Group.MAIN_OUTLINE, NativeRoadStyle.Group.MAIN,
            NativeRoadStyle.Group.PRIMARY_OUTLINE, NativeRoadStyle.Group.PRIMARY,
            NativeRoadStyle.Group.SECONDARY_OUTLINE, NativeRoadStyle.Group.SECONDARY,
            NativeRoadStyle.Group.TERTIARY_OUTLINE, NativeRoadStyle.Group.TERTIARY,
            NativeRoadStyle.Group.LOCAL, NativeRoadStyle.Group.RAIL,
        )
        val visibleCounts = listOf(8.0, 9.0, 10.0, 11.0, 12.0, 15.0).map { zoom ->
            groups.count { NativeRoadStyle.visible(it, zoom) }
        }
        // Rail retains its existing z9 threshold independently of road density.
        assertEquals(listOf(2, 3, 5, 7, 7, 10), visibleCounts)
        assertEquals(0f, NativeRoadStyle.densityFactor(NativeRoadStyle.Group.PRIMARY, 9.0), .0001f)
        assertTrue(NativeRoadStyle.densityFactor(NativeRoadStyle.Group.PRIMARY, 10.0) > 0f)
        assertTrue(NativeRoadStyle.densityFactor(NativeRoadStyle.Group.PRIMARY, 10.0) < 1f)
        assertTrue(NativeRoadStyle.visible(NativeRoadStyle.Group.PRIMARY, 10.0))
        assertEquals(1f, NativeRoadStyle.densityFactor(NativeRoadStyle.Group.PRIMARY, 11.0), .0001f)

        val sourceZooms = listOf(8, 12, 14)
        val sameUiZoomStyles = sourceZooms.map { _ ->
            groups.map { NativeRoadStyle.currentZoomStyle(it, 11.0).opacityScale }
        }
        assertTrue(sameUiZoomStyles.all { it == sameUiZoomStyles.first() })
    }
}
