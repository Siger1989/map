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
        assertFalse(NativeRoadStyle.visible(NativeRoadStyle.Group.LOCAL, 11.99))
        assertTrue(NativeRoadStyle.visible(NativeRoadStyle.Group.LOCAL, 12.0))
        assertFalse(NativeRoadStyle.visible(NativeRoadStyle.Group.RAIL, 8.99))
        assertTrue(NativeRoadStyle.visible(NativeRoadStyle.Group.RAIL, 9.0))
        assertTrue(NativeRoadStyle.visible(NativeRoadStyle.Group.RIVER, 3.0))
        assertFalse(NativeRoadStyle.visible(NativeRoadStyle.Group.RIVER, Double.NaN))
    }

    @Test fun `roads and casing become fine in overview while retaining continuous interpolation`() {
        for (group in listOf(NativeRoadStyle.Group.MAIN, NativeRoadStyle.Group.MAIN_OUTLINE, NativeRoadStyle.Group.LOCAL, NativeRoadStyle.Group.RAIL)) {
            val farZoom = if (group == NativeRoadStyle.Group.LOCAL) 12.0 else 9.0
            val near = NativeRoadStyle.widthCss(group, 16.0)
            val far = NativeRoadStyle.widthCss(group, farZoom)
            assertTrue("$group must become visibly finer", far < near * .5f)
            assertTrue("$group must remain drawable", far > 0f)
            val below = NativeRoadStyle.widthCss(group, 12.0 - .0001)
            val above = NativeRoadStyle.widthCss(group, 12.0 + .0001)
            assertEquals("$group must not jump at a stop", below, above, .001f)
        }
        for (zoom in listOf(6.0, 7.0, 10.0, 12.0, 14.0, 16.0)) {
            val main = NativeRoadStyle.widthCss(NativeRoadStyle.Group.MAIN, zoom)
            val casing = NativeRoadStyle.widthCss(NativeRoadStyle.Group.MAIN_OUTLINE, zoom)
            assertTrue(casing > main)
            assertTrue("casing must not dominate a distant road", casing < main * 2.5f)
        }
        assertEquals(1.5f, NativeRoadStyle.widthCss(NativeRoadStyle.Group.RIVER, 13.0), .0001f)
    }

    @Test fun `only highways are yellow while other main roads and paths preserve web palette`() {
        fun road(roadClass: String) = NativeRoadStyle.style.styleFor(
            "transportation", MvtGeometryType.LINESTRING, mapOf("class" to roadClass),
        )!!
        assertEquals(0xef / 255f, road("motorway").outlineColor.red, .0001f)
        assertEquals(0x76 / 255f, road("trunk").outlineColor.blue, .0001f)
        assertEquals(0xd1 / 255f, road("secondary").outlineColor.blue, .0001f)
        assertEquals(.85f, road("primary").outlineColor.alpha, .0001f)
        assertEquals(.65f, road("path").outlineColor.alpha, .0001f)
        assertEquals(0xc8 / 255f, road("track").outlineColor.green, .0001f)
        assertNotNull(road("rail").outlineImageSource)
        assertNull(NativeRoadStyle.style.styleFor("place", MvtGeometryType.POINT, emptyMap()))
    }

    @Test fun `grouping shares decoded source geometry and separates casing without additional source tiles`() {
        fun feature(id: Long, classIndex: Int, type: MvtGeometryType = MvtGeometryType.LINESTRING) =
            MvtFeature(id, type, intArrayOf(0, classIndex), intArrayOf(9, 2, 2, 10, 2, 2))
        val motorway = feature(1, 0)
        val local = feature(2, 1)
        val rail = feature(3, 2)
        val polygon = feature(4, 0, MvtGeometryType.POLYGON)
        val layer = MvtLayer("transportation", 2, 4096, listOf("class"), listOf("motorway", "path", "rail"),
            listOf(motorway, local, rail, polygon))
        val groups = NativeRoadStyle.groups(MvtTile(listOf(layer))).toMap()
        assertEquals(setOf(NativeRoadStyle.Group.MAIN_OUTLINE, NativeRoadStyle.Group.MAIN,
            NativeRoadStyle.Group.LOCAL, NativeRoadStyle.Group.RAIL), groups.keys)
        val main = groups.getValue(NativeRoadStyle.Group.MAIN).layers.single().features.single()
        val casing = groups.getValue(NativeRoadStyle.Group.MAIN_OUTLINE).layers.single().features.single()
        assertSame(motorway, main)
        assertSame(main.geometry, casing.geometry)
        assertSame(local, groups.getValue(NativeRoadStyle.Group.LOCAL).layers.single().features.single())
        assertNotEquals("transportation", groups.getValue(NativeRoadStyle.Group.MAIN_OUTLINE).layers.single().name)
        assertFalse(NativeRoadStyle.visible(NativeRoadStyle.Group.LOCAL, 8.0))
    }
}
