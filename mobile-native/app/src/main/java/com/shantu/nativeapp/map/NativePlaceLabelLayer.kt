package com.shantu.nativeapp.map

import android.os.Trace
import earth.worldwind.geom.AltitudeMode
import earth.worldwind.geom.Vec3
import earth.worldwind.layer.mvt.MvtGeometry
import earth.worldwind.layer.mvt.MvtGeometryType
import earth.worldwind.layer.mvt.MvtLabelGroup
import earth.worldwind.layer.mvt.MvtTile
import earth.worldwind.layer.source.TileSource
import earth.worldwind.render.RenderContext
import earth.worldwind.render.Renderable
import earth.worldwind.shape.Label
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.log2

/** Foreground filtering for background place names only; the SDK still owns collision and drawing. */
internal class NativePlaceLabelLayer(source: TileSource, tileBudget: Int) : NativeTimedMvtLayer(
    source, minZoom = 2, maxZoom = 14, maxLoadedTiles = tileBudget,
    maxConcurrentFetches = 2, maxConcurrentAssembly = 1,
    style = NativeCartographyLayers.placeLabelStyle, displayName = "Place labels", metricPrefix = "placeLabels",
) {
    private class Candidate(val label: Label, val text: String, val minZoom: Int) {
        var kept = false
    }

    private val candidatesKey = Any()
    private val cartesian = Vec3()
    private val targetCartesian = Vec3()
    private var targetDistance = Double.NaN

    override fun beginFrame(rc: RenderContext) {
        super.beginFrame(rc)
        targetDistance = rc.lookAtPosition?.let {
            rc.geographicToCartesian(it.latitude, it.longitude, it.altitude, AltitudeMode.ABSOLUTE, targetCartesian)
            rc.cameraPoint.distanceTo(targetCartesian).takeIf { distance -> distance.isFinite() && distance >= 1.0 }
        } ?: Double.NaN
    }

    override fun toRenderables(key: TileKey, tile: MvtTile): List<Renderable> {
        Trace.beginSection("ShantuMvt/placeLabels/assemble")
        try {
            // Build the same public SDK Label/LabelGroup objects while retaining our own references.
            // No reflection into SDK-internal group arrays and no global SDK policy mutation.
            val candidates = ArrayList<Candidate>()
            val priorities = ArrayList<Int>()
            val sizes = ArrayList<Int>()
            val widths = ArrayList<Float>()
            val ids = ArrayList<Long>()
            val props = LinkedHashMap<String, Any?>()
            val scratch = MvtGeometry.Scratch()
            for (layer in tile.layers) {
                if (layer.name != "place" && layer.name != "water_name" && layer.name != "mountain_peak") continue
                for (feature in layer.features) {
                    if (feature.type != MvtGeometryType.POINT) continue
                    props.clear()
                    var i = 0
                    while (i + 1 < feature.tags.size) {
                        val name = feature.tags[i]
                        val value = feature.tags[i + 1]
                        if (name in layer.keys.indices && value in layer.values.indices) props[layer.keys[name]] = layer.values[value]
                        i += 2
                    }
                    val rule = NativeCartographyLayers.placeLabelStyle.firstMatching(layer.name, feature.type, key.z, props) ?: continue
                    val spec = rule.paint.buildText(key.z, props, geometryType = feature.type) ?: continue
                    val minZoom = NativePlaceLabelPolicy.minimumZoom(props)
                    val priority = NativePlaceLabelPolicy.priority(props)
                    for (position in MvtGeometry.decodePoints(feature, key.z, key.x, key.y, layer.extent, scratch)) {
                        val label = Label(position, spec.text, spec.attributes).apply {
                            altitudeMode = AltitudeMode.CLAMP_TO_GROUND
                            zOrder = rule.zOrder.toDouble()
                        }
                        candidates += Candidate(label, spec.text, minZoom)
                        priorities += priority
                        sizes += spec.pixelSize
                        widths += spec.width
                        ids += feature.id
                    }
                }
            }
            if (candidates.isEmpty()) return emptyList()
            return listOf(MvtLabelGroup(
                labels = candidates.map { it.label }, priorities = priorities.toIntArray(),
                pixelSizes = sizes.toIntArray(), widths = widths.toFloatArray(),
                minZooms = candidates.map { it.minZoom }.toIntArray(), featureIds = ids.toLongArray(),
                displayName = "mvt-labels-${key.z}-${key.x}-${key.y}",
            ).apply { putUserProperty(candidatesKey, candidates) })
        } finally {
            Trace.endSection()
        }
    }

    override fun renderTileContent(rc: RenderContext, content: List<Renderable>) {
        val circumference = 2.0 * PI * rc.globe.equatorialRadius
        for (renderable in content) {
            val candidates = renderable.getUserProperty<List<Candidate>>(candidatesKey) ?: continue
            for (candidate in candidates) {
                val position = candidate.label.position
                rc.geographicToCartesian(position.latitude, position.longitude, 0.0, AltitudeMode.ABSOLUTE, cartesian)
                val distance = rc.cameraPoint.distanceTo(cartesian)
                val mpp = rc.pixelSizeAtDistance(distance)
                val effectiveZoom = if (mpp > 0.0) log2(circumference * cos(position.latitude.inRadians) / (256.0 * mpp)) else Double.NaN
                candidate.kept = NativePlaceLabelPolicy.keep(candidate.minZoom, effectiveZoom, distance / targetDistance, candidate.kept)
                // Empty candidates are culled BEFORE SDK sorting/collision acceptance, so far names
                // cannot reserve collision space or consume the budget needed by the foreground.
                candidate.label.text = if (candidate.kept) candidate.text else null
            }
        }
        super.renderTileContent(rc, content)
    }
}
