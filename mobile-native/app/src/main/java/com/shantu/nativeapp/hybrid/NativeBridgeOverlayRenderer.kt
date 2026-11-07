package com.shantu.nativeapp.hybrid

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.Shader
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
    private data class RouteStroke(
        val path: Path,
        val baseWidthPixels: Float,
        val baseWidthCss: Double,
        val baseColor: String,
        val baseOpacity: Double,
        val role: String,
        val dash: JSONArray?,
        var dashFactor: Int? = null,
    )

    @Volatile private var cssScale = window.context.resources.displayMetrics.density.toDouble()
    private var routeWidthScale = 1.0
    private var routeOpacityScale = 1.0
    val layer = RenderableLayer("React track and navigation geometry")
    private val groups = linkedMapOf<String, List<Renderable>>()
    private val routeStrokes = linkedMapOf<String, List<RouteStroke>>()
    private val fingerprints = linkedMapOf<String, String>()
    private val minZooms = linkedMapOf<String, Double>()
    private val routePointImages = mutableMapOf<String, ImageSource>()
    private val routePointImageSize = 32
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
                routeStrokes.remove(id)
                val role = feature.optJSONObject("properties")?.optString("role")
                val rendered = if (suppressShareTrackPaths && role in setOf("track", "shareTrackHalo")) emptyList() else build(feature)
                groups[id] = rendered
                fingerprints[id] = fingerprint
                minZooms[id] = feature.optJSONObject("properties")?.optDouble("minZoom", 0.0) ?: 0.0
                if (NativeOverlayStyle.scalesRouteAppearance(role.orEmpty())) {
                    val properties = feature.optJSONObject("properties") ?: JSONObject()
                    val baseWidthCss = properties.optDouble("width", 2.0)
                    val baseColor = properties.optString("color", "#d0f76b")
                    val baseOpacity = properties.optDouble("opacity", 1.0)
                    val dash = properties.optJSONArray("dash")?.let { JSONArray(it.toString()) }
                    routeStrokes[id] = rendered.filterIsInstance<Path>().map { path ->
                        RouteStroke(path, path.attributes.outlineWidth, baseWidthCss, baseColor, baseOpacity, role.orEmpty(), dash)
                    }
                    applyRouteAppearance(routeWidthScale, routeOpacityScale, routeStrokes[id].orEmpty())
                }
                rendered.forEach(layer::addRenderable)
            }
        }
        (groups.keys - next).forEach { id ->
            groups.remove(id)?.forEach(layer::removeRenderable); fingerprints.remove(id); minZooms.remove(id); routeStrokes.remove(id)
        }
        window.requestRedraw()
    }

    fun setZoom(zoom: Double) {
        groups.forEach { (id, renderables) -> renderables.forEach { it.isEnabled = zoom >= (minZooms[id] ?: 0.0) } }
        val nextWidthScale = NativeOverlayStyle.routeWidthScale(zoom)
        val nextOpacityScale = NativeOverlayStyle.routeOpacityScale(zoom)
        if (kotlin.math.abs(nextWidthScale - routeWidthScale) > 0.0001 ||
            kotlin.math.abs(nextOpacityScale - routeOpacityScale) > 0.0001) {
            routeWidthScale = nextWidthScale
            routeOpacityScale = nextOpacityScale
            routeStrokes.values.forEach { applyRouteAppearance(nextWidthScale, nextOpacityScale, it) }
        }
    }

    private fun applyRouteAppearance(widthScale: Double, opacityScale: Double, strokes: List<RouteStroke>) {
        strokes.forEach { stroke ->
            stroke.path.attributes.outlineWidth = stroke.baseWidthPixels * widthScale.toFloat()
            stroke.path.attributes.outlineColor = NativeOverlayStyle.color(stroke.baseColor,
                NativeOverlayStyle.routeStrokeOpacity(stroke.baseOpacity, opacityScale, stroke.role))
            stroke.dash?.let { dash ->
                NativeOverlayStyle.dashStyle(dash, stroke.baseWidthCss * widthScale, cssScale)?.let {
                    if (stroke.dashFactor != it.factor) {
                        stroke.path.attributes.outlineImageSource = ImageSource.fromLineStipple(it.factor, it.pattern)
                        stroke.dashFactor = it.factor
                    }
                }
            }
        }
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
            val boxSelected = isTrackNode && properties.optBoolean("boxSelected")
            val active = isTrackNode && properties.optBoolean("active")
            val nodeCssSize = NativeOverlayStyle.emphasizedPointCssSize(
                properties.optDouble("pointSize", 8.0), selected, active,
            )
            val routePointPresentation = NativeOverlayStyle.routePointPresentation(cssScale, routePointImageSize)
            val placemark = Placemark(position, PlacemarkAttributes().apply {
                imageScale = when {
                    role == "routePoint" -> routePointPresentation.imageScale
                    isTrackNode -> NativeOverlayStyle.imageScaleForCssSize(nodeCssSize, cssScale, trackNodeImageSize)
                    properties.optBoolean("arrow") -> NativeOverlayStyle.imageScaleForCssSize(
                        properties.optDouble("pointSize", 16.0), cssScale, 64,
                    )
                    else -> properties.optDouble("pointSize", 8.0)
                }
                if (role == "routePoint") {
                    imageSource = routePointImage(properties.optString("color", "#e34f4f"))
                    imageColor = Color(1f, 1f, 1f, 1f)
                    labelAttributes.font = Font(routePointPresentation.labelSizePixels)
                    labelAttributes.scale = 1.0
                    labelAttributes.textColor = NativeOverlayStyle.color(properties.optString("labelColor", "#ffffff"), 1.0)
                    labelAttributes.outlineColor = NativeOverlayStyle.color(properties.optString("labelHaloColor", "#14392e"), 1.0)
                    labelAttributes.outlineWidth = routePointPresentation.haloWidthPixels
                    labelAttributes.textOffset = Offset.topCenter()
                } else if (isTrackNode) {
                    imageSource = trackNodeImage(properties.optString("color", "#d0f76b"), selected, active, boxSelected)
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
                if (role == "routePoint") isEyeDistanceScaling = false
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
        ImageSource.fromBitmap(Bitmap.createBitmap(routePointImageSize, routePointImageSize, Bitmap.Config.ARGB_8888).also { bitmap ->
            val canvas = Canvas(bitmap)
            val paint = Paint(Paint.ANTI_ALIAS_FLAG)
            paint.color = runCatching { android.graphics.Color.parseColor(color) }.getOrDefault(android.graphics.Color.RED)
            canvas.drawCircle(routePointImageSize / 2f, routePointImageSize / 2f, 10f, paint)
            paint.color = android.graphics.Color.rgb(18, 49, 60); paint.style = Paint.Style.STROKE; paint.strokeWidth = 2f
            canvas.drawCircle(routePointImageSize / 2f, routePointImageSize / 2f, 10f, paint)
        })
    }

    private fun trackNodeImage(color: String, selected: Boolean, active: Boolean, boxSelected: Boolean): ImageSource {
        val key = "$color|selected=$selected|active=$active|boxSelected=$boxSelected"
        trackNodeImages[key]?.let { return it }
        val source = ImageSource.fromBitmap(Bitmap.createBitmap(trackNodeImageSize, trackNodeImageSize, Bitmap.Config.ARGB_8888).also { bitmap ->
            val canvas = Canvas(bitmap)
            val center = trackNodeImageSize / 2f
            val paint = Paint(Paint.ANTI_ALIAS_FLAG)
            if (boxSelected || active) {
                val green = NativeOverlayStyle.androidColor("#20b978")
                paint.shader = RadialGradient(center, center, 31f, intArrayOf(
                    android.graphics.Color.argb(42, android.graphics.Color.red(green), android.graphics.Color.green(green), android.graphics.Color.blue(green)),
                    android.graphics.Color.argb(if (active) 112 else 88, android.graphics.Color.red(green), android.graphics.Color.green(green), android.graphics.Color.blue(green)),
                    android.graphics.Color.argb(34, android.graphics.Color.red(green), android.graphics.Color.green(green), android.graphics.Color.blue(green)),
                    android.graphics.Color.TRANSPARENT,
                ), floatArrayOf(0f, 0.34f, 0.7f, 1f), Shader.TileMode.CLAMP)
                canvas.drawCircle(center, center, 31f, paint)
                paint.shader = null
                paint.style = Paint.Style.STROKE
                paint.strokeWidth = 1.4f
                paint.color = android.graphics.Color.argb(174, android.graphics.Color.red(green), android.graphics.Color.green(green), android.graphics.Color.blue(green))
                canvas.drawCircle(center, center, 14f, paint)
                paint.style = Paint.Style.FILL
                paint.color = NativeOverlayStyle.androidColor("#14392e")
                canvas.drawCircle(center, center, 9.5f, paint)
                paint.color = NativeOverlayStyle.androidColor(color)
                canvas.drawCircle(center, center, 6.5f, paint)
                if (active) {
                    paint.color = android.graphics.Color.WHITE
                    canvas.drawCircle(center, center, 2f, paint)
                }
            } else if (selected) {
                paint.color = NativeOverlayStyle.androidColor(if (active) "#fff3a0" else "#ffffff")
                canvas.drawCircle(center, center, 29f, paint)
            }
            if (!boxSelected && !active) {
                paint.color = NativeOverlayStyle.androidColor("#14392e")
                canvas.drawCircle(center, center, 23f, paint)
                paint.color = NativeOverlayStyle.androidColor(color)
                canvas.drawCircle(center, center, 18f, paint)
            }
        })
        trackNodeImages[key] = source
        while (trackNodeImages.size > 128) trackNodeImages.remove(trackNodeImages.keys.first())
        return source
    }

    fun clear() { layer.clearRenderables(); groups.clear(); routeStrokes.clear(); fingerprints.clear(); minZooms.clear(); routePointImages.clear(); trackNodeImages.clear(); window.requestRedraw() }
    override fun close() { clear() }
    private fun position(value: JSONArray): Position? {
        val lon = value.optDouble(0, Double.NaN); val lat = value.optDouble(1, Double.NaN)
        if (!lon.isFinite() || !lat.isFinite() || lat !in -90.0..90.0) return null
        return Position(lat.degrees, lon.degrees, 0.0)
    }
}
