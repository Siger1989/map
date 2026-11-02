package com.shantu.nativeapp.map

import earth.worldwind.layer.mvt.MvtBatchedLineTile
import earth.worldwind.layer.mvt.MvtFilter
import earth.worldwind.layer.mvt.MvtGeometryType
import earth.worldwind.layer.mvt.MvtFeature
import earth.worldwind.layer.mvt.MvtLayer
import earth.worldwind.layer.mvt.MvtRuleBasedStyle
import earth.worldwind.layer.mvt.MvtTile
import earth.worldwind.layer.mvt.MvtVectorLayer
import earth.worldwind.layer.mvt.mvtStyle
import earth.worldwind.layer.source.TileSource
import earth.worldwind.render.Color
import earth.worldwind.render.RenderContext
import earth.worldwind.render.Renderable
import earth.worldwind.shape.Path

/** Native road presentation in the UI's CSS/512 zoom convention; route styling is separate. */
internal object NativeRoadStyle {
    enum class Group {
        RIVER,
        MAIN_OUTLINE, MAIN,
        PRIMARY_OUTLINE, PRIMARY,
        SECONDARY_OUTLINE, SECONDARY,
        TERTIARY_OUTLINE, TERTIARY,
        LOCAL, RAIL,
    }
    data class CurrentZoomStyle(val widthCss: Float, val opacityScale: Float)
    data class GroupPresentation(val visible: Boolean, val physicalWidth: Float, val opacityScale: Float)
    private val backbone = setOf("motorway", "trunk")
    private val local = setOf("minor", "service", "track", "path")
    private const val CASING_LAYER = "shantu-main-road-outline"

    /** Source z is deliberately absent: a tilted view contains multiple source levels. */
    fun visible(group: Group, uiZoom: Double): Boolean = uiZoom.isFinite() && when (group) {
        Group.RIVER -> true
        Group.MAIN_OUTLINE, Group.MAIN -> uiZoom >= 6.0
        Group.PRIMARY_OUTLINE, Group.PRIMARY,
        Group.SECONDARY_OUTLINE, Group.SECONDARY,
        Group.TERTIARY_OUTLINE, Group.TERTIARY,
        Group.LOCAL -> densityFactor(group, uiZoom) > 0f
        Group.RAIL -> uiZoom >= 9.0
    }

    /** Smooth density ramp, keyed only to UI zoom and applied at draw time to cached groups. */
    fun densityFactor(group: Group, uiZoom: Double): Float = when (group) {
        Group.PRIMARY_OUTLINE, Group.PRIMARY -> smoothstep(uiZoom, 9.5, 11.0)
        Group.SECONDARY_OUTLINE, Group.SECONDARY -> smoothstep(uiZoom, 10.5, 12.0)
        Group.TERTIARY_OUTLINE, Group.TERTIARY -> smoothstep(uiZoom, 12.0, 13.5)
        Group.LOCAL -> smoothstep(uiZoom, 13.5, 15.0)
        else -> 1f
    }

    fun widthCss(group: Group, uiZoom: Double): Float = when (group) {
        Group.RIVER -> interpolate(uiZoom, 7.0 to .5f, 13.0 to 1.5f, 16.0 to 3f)
        // Draped strokes can occupy more screen space on near terrain. Keep the
        // casing narrow as well as the fill, especially in a distant overview.
        // At close zooms preserve the previous widths and retain continuous interpolation.
        Group.MAIN_OUTLINE -> interpolate(uiZoom, 6.0 to .4f, 10.0 to .68f, 12.0 to 1.05f, 16.0 to 3f)
        Group.PRIMARY_OUTLINE -> interpolate(uiZoom, 6.0 to .4f, 10.0 to .68f, 12.0 to 1.05f, 16.0 to 3f)
        Group.SECONDARY_OUTLINE, Group.TERTIARY_OUTLINE ->
            interpolate(uiZoom, 6.0 to .4f, 10.0 to .68f, 12.0 to 1.05f, 16.0 to 3f)
        Group.MAIN -> interpolate(uiZoom, 6.0 to .18f, 10.0 to .42f, 12.0 to .66f, 16.0 to 2f)
        Group.PRIMARY -> interpolate(uiZoom, 6.0 to .18f, 10.0 to .42f, 12.0 to .66f, 16.0 to 2f)
        Group.SECONDARY, Group.TERTIARY ->
            interpolate(uiZoom, 6.0 to .18f, 10.0 to .42f, 12.0 to .66f, 16.0 to 2f)
        Group.LOCAL -> interpolate(uiZoom, 12.0 to .24f, 16.0 to 1f)
        Group.RAIL -> interpolate(uiZoom, 9.0 to .25f, 12.0 to .4f, 16.0 to .9f)
    }

    /** Fade only controllable vector strokes at distant zooms; river color/strength stays intact. */
    fun opacityScale(group: Group, uiZoom: Double): Float = when (group) {
        Group.RIVER -> 1f
        Group.MAIN, Group.MAIN_OUTLINE,
        Group.PRIMARY_OUTLINE, Group.PRIMARY,
        Group.SECONDARY_OUTLINE, Group.SECONDARY,
        Group.TERTIARY_OUTLINE, Group.TERTIARY ->
            interpolate(uiZoom, 6.0 to .56f, 10.0 to .68f, 12.0 to .8f, 16.0 to 1f) * densityFactor(group, uiZoom)
        Group.LOCAL -> interpolate(uiZoom, 12.0 to .76f, 16.0 to 1f) * densityFactor(group, uiZoom)
        Group.RAIL -> interpolate(uiZoom, 9.0 to .78f, 12.0 to .84f, 16.0 to 1f)
    }

    fun currentZoomStyle(group: Group, uiZoom: Double): CurrentZoomStyle =
        CurrentZoomStyle(widthCss(group, uiZoom), opacityScale(group, uiZoom))

    /** Build the immutable per-view style table outside the per-tile render loop. */
    fun presentationSnapshot(uiZoom: Double, cssScale: Float): List<GroupPresentation> {
        require(uiZoom.isFinite() && cssScale.isFinite() && cssScale > 0f)
        return Group.entries.map { group ->
            val zoomStyle = currentZoomStyle(group, uiZoom)
            GroupPresentation(
                visible = visible(group, uiZoom),
                physicalWidth = zoomStyle.widthCss * cssScale,
                opacityScale = zoomStyle.opacityScale,
            )
        }
    }

    private fun interpolate(zoom: Double, vararg stops: Pair<Double, Float>): Float {
        if (!zoom.isFinite() || zoom <= stops.first().first) return stops.first().second
        for (i in 1 until stops.size) {
            val (end, value) = stops[i]
            val (start, previous) = stops[i - 1]
            if (zoom <= end) return previous + (value - previous) * ((zoom - start) / (end - start)).toFloat()
        }
        return stops.last().second
    }

    private fun smoothstep(zoom: Double, start: Double, end: Double): Float {
        if (!zoom.isFinite() || zoom <= start) return 0f
        if (zoom >= end) return 1f
        val t = ((zoom - start) / (end - start)).toFloat()
        return t * t * (3f - 2f * t)
    }

    // Unit-width strokes are baked once. The render hook applies the actual CSS width and density.
    val style: MvtRuleBasedStyle = mvtStyle {
        rule("waterway") {
            geometryType = MvtGeometryType.LINESTRING
            paint { line(Color(0x77 / 255f, 0xc6 / 255f, 0xdc / 255f, .75f), 1f) }
        }
        rule(CASING_LAYER) {
            geometryType = MvtGeometryType.LINESTRING
            paint { line(Color(0x1b / 255f, 0x30 / 255f, 0x34 / 255f, .85f), 1f) }
        }
        rule("transportation") {
            geometryType = MvtGeometryType.LINESTRING
            filter = MvtFilter.`in`("class", "motorway", "trunk")
            paint { line(Color(0xef / 255f, 0xc1 / 255f, 0x76 / 255f, .85f), 1f) }
        }
        rule("transportation") {
            geometryType = MvtGeometryType.LINESTRING
            filter = MvtFilter.eq("class", "primary")
            paint { line(Color(0xe3 / 255f, 0xde / 255f, 0xd1 / 255f, .85f), 1f) }
        }
        rule("transportation") {
            geometryType = MvtGeometryType.LINESTRING
            filter = MvtFilter.eq("class", "secondary")
            paint { line(Color(0xe3 / 255f, 0xde / 255f, 0xd1 / 255f, .85f), 1f) }
        }
        rule("transportation") {
            geometryType = MvtGeometryType.LINESTRING
            filter = MvtFilter.eq("class", "tertiary")
            paint { line(Color(0xe3 / 255f, 0xde / 255f, 0xd1 / 255f, .85f), 1f) }
        }
        rule("transportation") {
            geometryType = MvtGeometryType.LINESTRING
            filter = MvtFilter.`in`("class", "minor", "service", "track", "path")
            paint { line(Color(0xbb / 255f, 0xc8 / 255f, 0xbd / 255f, .65f), 1f) }
        }
        rule("transportation") {
            geometryType = MvtGeometryType.LINESTRING
            filter = MvtFilter.eq("class", "rail")
            paint { line(Color(0xb7 / 255f, 0xa5 / 255f, 0xc9 / 255f), 1f); dasharray(3f, 3f) }
        }
    }

    /** Lightweight views of the same decoded tile, not additional fetches or resident tile entries. */
    fun groups(tile: MvtTile): List<Pair<Group, MvtTile>> {
        val grouped = Group.entries.associateWith { mutableListOf<MvtLayer>() }
        for (layer in tile.layers) {
            if (layer.name == "waterway") {
                val lines = layer.features.filter { it.type == MvtGeometryType.LINESTRING }
                if (lines.isNotEmpty()) grouped.getValue(Group.RIVER) += layer.copy(features = lines)
                continue
            }
            if (layer.name != "transportation") continue
            val mainLines = mutableListOf<MvtFeature>()
            val primaryLines = mutableListOf<MvtFeature>()
            val secondaryLines = mutableListOf<MvtFeature>()
            val tertiaryLines = mutableListOf<MvtFeature>()
            val localLines = mutableListOf<MvtFeature>()
            val railLines = mutableListOf<MvtFeature>()
            for (feature in layer.features) {
                if (feature.type != MvtGeometryType.LINESTRING) continue
                when (feature.toProperties(layer)["class"] as? String) {
                    in backbone -> mainLines += feature
                    "primary" -> primaryLines += feature
                    "secondary" -> secondaryLines += feature
                    "tertiary" -> tertiaryLines += feature
                    in local -> localLines += feature
                    "rail" -> railLines += feature
                }
            }
            if (mainLines.isNotEmpty()) {
                grouped.getValue(Group.MAIN_OUTLINE) += layer.copy(name = CASING_LAYER, features = mainLines)
                grouped.getValue(Group.MAIN) += layer.copy(features = mainLines)
            }
            if (primaryLines.isNotEmpty()) {
                grouped.getValue(Group.PRIMARY_OUTLINE) += layer.copy(name = CASING_LAYER, features = primaryLines)
                grouped.getValue(Group.PRIMARY) += layer.copy(features = primaryLines)
            }
            if (secondaryLines.isNotEmpty()) {
                grouped.getValue(Group.SECONDARY_OUTLINE) += layer.copy(name = CASING_LAYER, features = secondaryLines)
                grouped.getValue(Group.SECONDARY) += layer.copy(features = secondaryLines)
            }
            if (tertiaryLines.isNotEmpty()) {
                grouped.getValue(Group.TERTIARY_OUTLINE) += layer.copy(name = CASING_LAYER, features = tertiaryLines)
                grouped.getValue(Group.TERTIARY) += layer.copy(features = tertiaryLines)
            }
            if (localLines.isNotEmpty()) grouped.getValue(Group.LOCAL) += layer.copy(features = localLines)
            if (railLines.isNotEmpty()) grouped.getValue(Group.RAIL) += layer.copy(features = railLines)
        }
        return grouped.mapNotNull { (group, layers) -> if (layers.isEmpty()) null else group to MvtTile(layers) }
    }
}

/** One SDK tile cache/source; its cached content contains independently drawable style groups. */
internal class NativeRoadVectorLayer(source: TileSource, tileBudget: Int) : MvtVectorLayer(
    source, minZoom = 0, maxZoom = 14, maxLoadedTiles = tileBudget,
    maxConcurrentFetches = 2, maxConcurrentAssembly = 1,
    style = NativeRoadStyle.style, displayName = "Roads and waterways",
) {
    // Keep coarse coverage until every selected child is ready; stop progressive parent/child overlap.
    override val progressiveRefinement get() = false

    private data class ViewStyle(
        val zoom: Double,
        val cssScale: Float,
        val groups: List<NativeRoadStyle.GroupPresentation>,
    )
    @Volatile private var viewStyle = ViewStyle(Double.NaN, 1f, emptyList())
    private val groupKey = Any()

    /** Called with the same native-frame camera zoom and CSS scale used by the retained React UI. */
    fun setViewportStyle(uiZoom: Double, cssScale: Float): Boolean {
        if (!uiZoom.isFinite() || !cssScale.isFinite() || cssScale <= 0f) return false
        val previous = viewStyle
        if (previous.zoom.isFinite() && kotlin.math.abs(previous.zoom - uiZoom) < .001 &&
            kotlin.math.abs(previous.cssScale - cssScale) < .0001f &&
            NativeRoadStyle.Group.entries.all {
                NativeRoadStyle.visible(it, previous.zoom) == NativeRoadStyle.visible(it, uiZoom)
            }) return false
        viewStyle = ViewStyle(uiZoom, cssScale, NativeRoadStyle.presentationSnapshot(uiZoom, cssScale))
        return true
    }

    override fun toRenderables(key: TileKey, tile: MvtTile): List<Renderable> =
        NativeRoadStyle.groups(tile).flatMap { (group, groupedTile) ->
            super.toRenderables(key, groupedTile).onEach { it.putUserProperty(groupKey, group) }
        }

    override fun renderTileContent(rc: RenderContext, content: List<Renderable>) {
        val current = viewStyle
        for (renderable in content) {
            val group = renderable.getUserProperty<NativeRoadStyle.Group>(groupKey) ?: continue
            val style = current.groups.getOrNull(group.ordinal) ?: continue
            if (!style.visible) continue
            val baseOpacity = opacity
            try {
                // MvtBatchedLineTile and Path multiply the active layer opacity at draw time.
                // Apply a temporary per-group factor so roads can fade independently of names,
                // which live in separate cartography layers and share the user's base opacity.
                opacity = baseOpacity * style.opacityScale
                when (renderable) {
                    is MvtBatchedLineTile -> renderable.widthScale = style.physicalWidth
                    is Path -> renderable.attributes.outlineWidth = style.physicalWidth
                }
                renderable.render(rc)
            } finally {
                opacity = baseOpacity
            }
        }
    }
}
