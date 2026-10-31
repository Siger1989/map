package com.shantu.nativeapp.hybrid

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import earth.worldwind.WorldWindow
import earth.worldwind.geom.AltitudeMode
import earth.worldwind.geom.Angle.Companion.degrees
import earth.worldwind.geom.Position
import earth.worldwind.geom.Offset
import earth.worldwind.layer.RenderableLayer
import earth.worldwind.render.Color
import earth.worldwind.render.Renderable
import earth.worldwind.render.Font
import earth.worldwind.render.image.ImageSource
import earth.worldwind.shape.Path
import earth.worldwind.shape.Polygon
import earth.worldwind.shape.Placemark
import earth.worldwind.shape.PlacemarkAttributes
import earth.worldwind.shape.OrientationMode
import earth.worldwind.shape.ShapeAttributes
import org.json.JSONArray
import org.json.JSONObject

/** Draws geometry from the original React feature factories, without reimplementing route semantics. */
class NativeBridgeOverlayRenderer(
    private val window: WorldWindow,
    private val suppressShareTrackPaths: Boolean = false,
) : AutoCloseable {
    @Volatile private var cssScale = window.context.resources.displayMetrics.density.toDouble()
    val layer = RenderableLayer("React track and navigation geometry")
    private val groups = linkedMapOf<String, List<Renderable>>()
    private val fingerprints = linkedMapOf<String, String>()
    private val minZooms = linkedMapOf<String, Double>()
    private val routePointImages = mutableMapOf<String, ImageSource>()
    private val trackNodeImages = linkedMapOf<String, ImageSource>()
    private val trackNodeImageSize = 64
    private val arrow = ImageSource.fromBitmap(Bitmap.createBitmap(64, 64, Bitmap.Config.ARGB_8888).also { bitmap ->
        Canvas(bitmap).drawPath(android.graphics.Path().apply { moveTo(32f, 5f); lineTo(56f, 52f); lineTo(32f, 40f); lineTo(8f, 52f); close() },
            Paint(Paint.ANTI_ALIAS_FLAG).apply { color = android.graphics.Color.WHITE })
    })

    fun sync(geometry: JSONObject) {
        val next = linkedSetOf<String>()
        for (group in listOf("routes", "tracks", "guidance", "cad", "transient")) {
            val features = geometry.optJSONObject(group)?.optJSONArray("features") ?: JSONArray()
            require(features.length() <= 150_000) { "地图要素超过原生渲染容量" }
            for (index in 0 until features.length()) {
                val feature = features.optJSONObject(index) ?: continue
                val id = "$group:$index"
                next += id
                val fingerprint = "${feature}|cssScale=$cssScale"
                if (fingerprints[id] == fingerprint) continue
                groups.remove(id)?.forEach(layer::removeRenderable)
                val role = feature.optJSONObject("properties")?.optString("role")
                val rendered = if (suppressShareTrackPaths && role in setOf("track", "shareTrackHalo")) emptyList() else build(feature)
                groups[id] = rendered
                fingerprints[id] = fingerprint
                minZooms[id] = feature.optJSONObject("properties")?.optDouble("minZoom", 0.0) ?: 0.0
                rendered.forEach(layer::addRenderable)
            }
        }
        (groups.keys - next).forEach { id ->
            groups.remove(id)?.forEach(layer::removeRenderable); fingerprints.remove(id); minZooms.remove(id)
        }
        window.requestRedraw()
    }

    fun setZoom(zoom: Double) {
        groups.forEach { (id, renderables) -> renderables.forEach { it.isEnabled = zoom >= (minZooms[id] ?: 0.0) } }
    }

    /** Physical native pixels per React CSS pixel; call before sync after viewport scaling changes. */
    fun setCssScale(scale: Double) {
        if (!scale.isFinite() || scale <= 0.0 || kotlin.math.abs(scale - cssScale) < 0.0001) return
        cssScale = scale.coerceIn(0.1, 10.0)
    }

    private fun build(feature: JSONObject): List<Renderable> {
        val geometry = feature.optJSONObject("geometry") ?: return emptyList()
        val properties = feature.optJSONObject("properties") ?: JSONObject()
        val coordinates = geometry.optJSONArray("coordinates") ?: return emptyList()
        val role = properties.optString("role")
        val color = NativeOverlayStyle.color(properties.optString("color", "#d0f76b"), properties.optDouble("opacity", 1.0))
        val delegate = properties.optJSONObject("nativePick")?.let { "shantu-bridge:$it" }
        val label = properties.optString("label").takeIf { it.isNotBlank() && it != "null" }
        val result = mutableListOf<Renderable>()
        fun point(value: JSONArray, text: String? = label) {
            val position = position(value) ?: return
            val isTrackNode = role == "trackNode"
            val selected = isTrackNode && properties.optBoolean("selected")
            val active = isTrackNode && properties.optBoolean("active")
            val nodeCssSize = NativeOverlayStyle.emphasizedPointCssSize(
                properties.optDouble("pointSize", 8.0), selected, active,
            )
            val placemark = Placemark(position, PlacemarkAttributes().apply {
                imageScale = when {
                    role == "routePoint" -> 1.0
                    isTrackNode -> NativeOverlayStyle.imageScaleForCssSize(nodeCssSize, cssScale, trackNodeImageSize)
                    properties.optBoolean("arrow") -> NativeOverlayStyle.imageScaleForCssSize(
                        properties.optDouble("pointSize", 16.0), cssScale, 64,
                    )
                    else -> properties.optDouble("pointSize", 8.0)
                }
                if (role == "routePoint") {
                    imageSource = routePointImage(properties.optString("color", "#e34f4f"))
                    imageColor = Color(1f, 1f, 1f, 1f)
                    labelAttributes.font = Font(12f)
                    labelAttributes.textColor = NativeOverlayStyle.color(properties.optString("labelColor", "#ffffff"), 1.0)
                    labelAttributes.outlineColor = NativeOverlayStyle.color(properties.optString("labelHaloColor", "#14392e"), 1.0)
                    labelAttributes.outlineWidth = NativeOverlayStyle.widthInPixels(2.0, cssScale)
                    labelAttributes.textOffset = Offset.topCenter()
                } else if (isTrackNode) {
                    imageSource = trackNodeImage(properties.optString("color", "#d0f76b"), selected, active)
                    imageColor = Color(1f, 1f, 1f, 1f)
                } else {
                    if (properties.optBoolean("arrow")) imageSource = arrow
                    imageColor = color
                }
                if (isTrackNode) imageOffset = Offset.center()
                isDrawLeader = false
                // Editing handles are controls attached to terrain. Do not let the terrain
                // depth buffer erase them when the clamped placemark and DEM surface differ
                // by a fraction of a rendered depth step.
                isDepthTest = !isTrackNode
            }, text ?: "").apply {
                altitudeMode = AltitudeMode.CLAMP_TO_GROUND; isAlwaysOnTop = false
                pickDelegate = delegate
                if (properties.optBoolean("arrow")) { imageRotation = properties.optDouble("rotation", 0.0).degrees; imageRotationReference = OrientationMode.RELATIVE_TO_GLOBE }
            }
            result += placemark
        }
        fun line(values: JSONArray) {
            val positions = (0 until values.length()).mapNotNull { position(values.optJSONArray(it) ?: return@mapNotNull null) }
            if (positions.size < 2) return
            if (role != "note") result += Path(positions, ShapeAttributes().apply {
                isDrawInterior = false; isDrawOutline = true; isDepthTest = true; outlineColor = color
                outlineWidth = NativeOverlayStyle.widthInPixels(properties.optDouble("width", 2.0), cssScale)
                properties.optJSONArray("dash")?.let { NativeOverlayStyle.dashStyle(it, properties.optDouble("width", 2.0), cssScale) }?.let { dash ->
                    outlineImageSource = ImageSource.fromLineStipple(dash.factor, dash.pattern)
                }
            }).apply { altitudeMode = AltitudeMode.CLAMP_TO_GROUND; pickDelegate = delegate; isFollowTerrain = true }
            if (label != null) point(values.getJSONArray(values.length() / 2))
        }
        when (geometry.optString("type")) {
            "LineString" -> line(coordinates)
            "MultiLineString" -> for (i in 0 until coordinates.length()) coordinates.optJSONArray(i)?.let(::line)
            "Point" -> point(coordinates)
            "MultiPoint" -> for (i in 0 until coordinates.length()) coordinates.optJSONArray(i)?.let { point(it) }
            "Polygon" -> {
                val ring = coordinates.optJSONArray(0) ?: JSONArray()
                val positions = (0 until ring.length()).mapNotNull { position(ring.optJSONArray(it) ?: return@mapNotNull null) }
                if (positions.size >= 3) result += Polygon(positions, ShapeAttributes().apply {
                    isDrawInterior = true; isDrawOutline = true; isDepthTest = true; outlineColor = color
                    interiorColor = NativeOverlayStyle.color(properties.optString("color", "#e3bd54"), properties.optDouble("fillOpacity", 0.12))
                    outlineWidth = NativeOverlayStyle.widthInPixels(properties.optDouble("width", 1.5), cssScale)
                }).apply {
                    for (ringIndex in 1 until coordinates.length()) {
                        val hole=coordinates.optJSONArray(ringIndex) ?: continue
                        val holePoints=(0 until hole.length()).mapNotNull { position(hole.optJSONArray(it) ?: return@mapNotNull null) }
                        if(holePoints.size>=3)addBoundary(holePoints)
                    }
                    altitudeMode = AltitudeMode.CLAMP_TO_GROUND; pickDelegate = delegate
                }
            }
        }
        return result
    }

    private fun routePointImage(color: String): ImageSource = routePointImages.getOrPut(color) {
        ImageSource.fromBitmap(Bitmap.createBitmap(32, 32, Bitmap.Config.ARGB_8888).also { bitmap ->
            val canvas = Canvas(bitmap)
            val paint = Paint(Paint.ANTI_ALIAS_FLAG)
            paint.color = runCatching { android.graphics.Color.parseColor(color) }.getOrDefault(android.graphics.Color.RED)
            canvas.drawCircle(16f, 16f, 10f, paint)
            paint.color = android.graphics.Color.rgb(18, 49, 60); paint.style = Paint.Style.STROKE; paint.strokeWidth = 2f
            canvas.drawCircle(16f, 16f, 10f, paint)
        })
    }

    private fun trackNodeImage(color: String, selected: Boolean, active: Boolean): ImageSource {
        val key = "$color|selected=$selected|active=$active"
        trackNodeImages[key]?.let { return it }
        val source = ImageSource.fromBitmap(Bitmap.createBitmap(trackNodeImageSize, trackNodeImageSize, Bitmap.Config.ARGB_8888).also { bitmap ->
            val canvas = Canvas(bitmap)
            val center = trackNodeImageSize / 2f
            val paint = Paint(Paint.ANTI_ALIAS_FLAG)
            if (selected || active) {
                paint.color = NativeOverlayStyle.androidColor(if (active) "#fff3a0" else "#ffffff")
                canvas.drawCircle(center, center, 29f, paint)
            }
            paint.color = NativeOverlayStyle.androidColor("#14392e")
            canvas.drawCircle(center, center, 23f, paint)
            paint.color = NativeOverlayStyle.androidColor(color)
            canvas.drawCircle(center, center, 18f, paint)
            if (active) {
                paint.color = NativeOverlayStyle.androidColor("#fff3a0")
                paint.style = Paint.Style.STROKE
                paint.strokeWidth = 3f
                canvas.drawCircle(center, center, 12f, paint)
            }
        })
        trackNodeImages[key] = source
        while (trackNodeImages.size > 128) trackNodeImages.remove(trackNodeImages.keys.first())
        return source
    }

    fun clear() { layer.clearRenderables(); groups.clear(); fingerprints.clear(); minZooms.clear(); routePointImages.clear(); trackNodeImages.clear(); window.requestRedraw() }
    override fun close() { clear() }
    private fun position(value: JSONArray): Position? {
        val lon = value.optDouble(0, Double.NaN); val lat = value.optDouble(1, Double.NaN)
        if (!lon.isFinite() || !lat.isFinite() || lat !in -90.0..90.0) return null
        return Position(lat.degrees, lon.degrees, 0.0)
    }
}
