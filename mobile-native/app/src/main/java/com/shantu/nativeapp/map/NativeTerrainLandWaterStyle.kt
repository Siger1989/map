package com.shantu.nativeapp.map

import earth.worldwind.layer.mvt.MvtGeometryType
import earth.worldwind.layer.mvt.MvtStyle
import earth.worldwind.render.Color
import earth.worldwind.shape.ShapeAttributes
import earth.worldwind.layer.shadow.ShadowMode

/** Quiet land/water decal palette over the dark DEM-material base, using real OpenFreeMap MVTs. */
internal object NativeTerrainLandWaterStyle : MvtStyle {
    override fun styleFor(layerName: String, geometryType: MvtGeometryType, properties: Map<String, Any?>): ShapeAttributes? {
        if (geometryType == MvtGeometryType.POINT || geometryType == MvtGeometryType.UNKNOWN) return null
        val kind = (properties["class"] ?: properties["kind"] ?: properties["subclass"])?.toString()?.lowercase()
        val linearWater = layerName in setOf("waterway", "water_line", "water_lines")
        val color = when (layerName) {
            "water", "ocean", "water_polygons", "river_polygons" -> Color(0.09f, 0.20f, 0.23f, 0.92f)
            "waterway", "water_line", "water_lines" -> Color(0.16f, 0.35f, 0.39f, 0.90f)
            "landcover", "land" -> when (kind) {
                "wood", "forest" -> Color(0.18f, 0.31f, 0.27f, 0.48f)
                "grass", "meadow", "scrub", "scrubland" -> Color(0.30f, 0.40f, 0.28f, 0.28f)
                "sand", "beach" -> Color(0.55f, 0.47f, 0.31f, 0.26f)
                "rock", "bare_rock", "scree", "shingle" -> Color(0.47f, 0.48f, 0.44f, 0.26f)
                "ice", "glacier", "snow" -> Color(0.67f, 0.74f, 0.72f, 0.40f)
                else -> Color(0.28f, 0.38f, 0.33f, 0.26f)
            }
            "landuse", "sites", "park", "national_park" -> when (kind) {
                "residential", "commercial", "industrial", "retail", "neighbourhood" -> Color(0.30f, 0.38f, 0.35f, 0.25f)
                "park", "garden", "playground", "recreation_ground", "village_green" -> Color(0.22f, 0.37f, 0.28f, 0.42f)
                "wood", "forest" -> Color(0.18f, 0.31f, 0.27f, 0.44f)
                else -> Color(0.28f, 0.38f, 0.33f, 0.24f)
            }
            else -> return null
        }
        return ShapeAttributes().apply {
            if (linearWater) {
                isDrawInterior = false
                outlineColor = color
                outlineWidth = 1.2f
            } else {
                interiorColor = color
                isDrawOutline = false
                isPickInterior = false
                isPickOutline = false
            }
            shadowMode = ShadowMode.DISABLED
        }
    }

    override fun zOrderFor(layerName: String, geometryType: MvtGeometryType, properties: Map<String, Any?>): Int = when (layerName) {
        "water", "ocean", "water_polygons", "river_polygons" -> MvtStyle.Z_WATER
        "landcover", "land" -> MvtStyle.Z_LANDCOVER
        "landuse", "sites", "park", "national_park" -> MvtStyle.Z_LANDUSE
        "waterway", "water_line", "water_lines" -> MvtStyle.Z_WATERWAY
        else -> MvtStyle.Z_BACKGROUND
    }

    override val backgroundColor: Color? = null // The base surface paints #203b3f beneath real MVT polygons.
}
