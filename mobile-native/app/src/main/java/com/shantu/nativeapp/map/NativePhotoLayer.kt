package com.shantu.nativeapp.map

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import earth.worldwind.geom.AltitudeMode
import earth.worldwind.geom.Angle.Companion.degrees
import earth.worldwind.geom.Position
import earth.worldwind.geom.Vec3
import earth.worldwind.render.RenderContext
import earth.worldwind.render.image.ImageSource
import earth.worldwind.layer.RenderableLayer
import earth.worldwind.shape.Placemark
import earth.worldwind.shape.PlacemarkAttributes
import org.json.JSONArray
import org.json.JSONObject
import java.util.Base64
import kotlin.math.abs

/** Photos are real map pickables with terrain depth testing, shared by both maps. */
class NativePhotoLayer {
    val layer = RenderableLayer("Track photos")
    private val entries = linkedMapOf<String, PhotoEntry>()
    private var cssScale = 1.0
    private var markerMode = "label"
    private var zoom = 16.0

    /** Use the controller's resolved marker mode and current camera zoom. */
    fun setMarkerMode(value: String, zoom: Double = this.zoom): Boolean {
        val mode = value.takeIf { it == "label" || it == "icon" || it == "dot" } ?: "label"
        val safeZoom = zoom.takeIf(Double::isFinite) ?: this.zoom
        val modeChanged = mode != markerMode
        val zoomChanged = differs(this.zoom, safeZoom)
        if (!modeChanged && !zoomChanged) return false
        markerMode = mode
        this.zoom = safeZoom
        val scale = photoImageScale()
        entries.values.forEach { it.placemark.updateImageScale(scale) }
        return true
    }

    /** CSS density changes may need a new bitmap bucket; keep the old image while it loads. */
    fun setCssScale(value: Double): Boolean {
        val safe = value.takeIf { it.isFinite() && it > 0.0 } ?: 1.0
        if (!differs(cssScale, safe)) return false
        val oldDensity = NativeMarkerPresentation.densityBucket(cssScale)
        cssScale = safe
        val density = NativeMarkerPresentation.densityBucket(cssScale)
        if (density != oldDensity) entries.values.forEach { entry ->
            entry.placemark.updateImage(entry.descriptor.imageSource(density), photoImageScale(), density)
        } else entries.values.forEach { it.placemark.updateImageScale(photoImageScale()) }
        return true
    }

    /** Stable IDs are upserted in place; only removed IDs leave the renderable layer. */
    fun replace(photos: JSONArray) {
        val density = NativeMarkerPresentation.densityBucket(cssScale)
        val next = linkedMapOf<String, PhotoDescriptor>()
        for (i in 0 until photos.length()) {
            val photo = photos.optJSONObject(i) ?: continue
            if (photo.optBoolean("hidden") || !photo.optBoolean("visible", true)) continue
            val id = photo.optString("id").takeIf { it.isNotBlank() && it.length <= 200 } ?: continue
            val coordinates = photo.optJSONArray("coordinates") ?: continue
            val lon = coordinates.optDouble(0, Double.NaN)
            val lat = coordinates.optDouble(1, Double.NaN)
            if (!lon.isFinite() || !lat.isFinite() || lon !in -180.0..180.0 || lat !in -90.0..90.0) continue
            val image = photo.optString("previewBase64").takeIf { it.length in 1..1_400_000 } ?: continue
            if (next.containsKey(id)) continue
            next[id] = PhotoDescriptor(
                id = id,
                name = photo.optString("name", "照片"),
                latitude = lat,
                longitude = lon,
                encoded = image,
                count = photo.optJSONArray("groupIds")?.length()?.coerceAtLeast(1) ?: 1,
                mapIcon = if (photo.optString("kind") == "annotation") photo.optString("mapIcon", "pin") else null,
                mapColor = photo.optString("mapColor", "#176b68"),
            )
        }

        (entries.keys - next.keys).toList().forEach { id ->
            val removed = entries.remove(id) ?: return@forEach
            layer.removeRenderable(removed.placemark)
        }

        next.forEach { (id, descriptor) ->
            val existing = entries[id]
            if (existing == null) {
                val attributes = attributes(descriptor, density)
                val placemark = NativePhotoPlacemark(
                    Position(descriptor.latitude.degrees, descriptor.longitude.degrees, 0.0), attributes, density,
                ).apply {
                    altitudeMode = AltitudeMode.CLAMP_TO_GROUND
                    isAlwaysOnTop = false
                    isEyeDistanceScaling = false
                    pickDelegate = "shantu-photo:$id"
                    displayName = descriptor.name
                }
                entries[id] = PhotoEntry(descriptor, placemark)
                layer.addRenderable(placemark)
            } else {
                val old = existing.descriptor
                existing.placemark.position = Position(descriptor.latitude.degrees, descriptor.longitude.degrees, 0.0)
                existing.placemark.displayName = descriptor.name
                if (old.imageKey != descriptor.imageKey) {
                    existing.placemark.updateImage(descriptor.imageSource(density), photoImageScale(), density)
                } else existing.placemark.updateImageScale(photoImageScale())
                existing.descriptor = descriptor
            }
        }
        // Preserve incoming order without replacing any retained photo object.
        next.keys.forEachIndexed { index, id ->
            val placemark = entries[id]?.placemark ?: return@forEachIndexed
            if (index >= layer.count || layer.getRenderable(index) === placemark) return@forEachIndexed
            layer.removeRenderable(placemark)
            if (index < layer.count) layer.addRenderable(index, placemark) else layer.addRenderable(placemark)
        }
    }

    private fun attributes(descriptor: PhotoDescriptor, density: Int) = PlacemarkAttributes().apply {
        imageSource = descriptor.imageSource(density)
        imageScale = photoImageScale()
        isDrawLabel = false
        isDepthTest = true
    }

    private fun photoImageScale(): Double {
        val frameCss = when (markerMode) { "icon" -> 24.2; "dot" -> 9.9; else -> 32.0 }
        val zoomScale = (0.35 + (zoom - 4.0) * 0.65 / 12.0).coerceIn(0.35, 1.0)
        val density = NativeMarkerPresentation.densityBucket(cssScale)
        return (frameCss * zoomScale).coerceAtLeast(20.0) * cssScale / (56.0 * density)
    }

    private fun differs(a: Double, b: Double) = abs(a - b) > 1e-6
}

private data class PhotoEntry(var descriptor: PhotoDescriptor, val placemark: NativePhotoPlacemark)

private data class PhotoDescriptor(
    val id: String,
    val name: String,
    val latitude: Double,
    val longitude: Double,
    val encoded: String,
    val count: Int,
    val mapIcon: String?,
    val mapColor: String,
) {
    val imageKey get() = listOf(encoded, count.toString(), mapIcon.orEmpty(), mapColor)
    fun imageSource(density: Int) = ImageSource.fromImageFactory(PhotoImageFactory(encoded, count, mapIcon, mapColor, density))
}

/** Keeps the previous photo texture visible until WorldWind has the replacement texture ready. */
internal class NativePhotoPlacemark(position: Position, attributes: PlacemarkAttributes, private var currentDensity: Int) : Placemark(position, attributes, "") {
    private var fallbackAttributes: PlacemarkAttributes? = null
    private var fallbackDensity: Int? = null
    private val textureAnchor = Vec3()
    private var preflightContext: RenderContext? = null
    private var preflightTextureReady = false

    @Synchronized
    fun updateImage(nextSource: ImageSource, nextScale: Double, nextDensity: Int) {
        if (attributes.imageSource !== nextSource) {
            if (fallbackAttributes == null) {
                fallbackAttributes = PlacemarkAttributes(attributes)
                fallbackDensity = currentDensity
            }
            attributes = PlacemarkAttributes(attributes).apply {
                imageSource = nextSource
                imageScale = nextScale
            }
            currentDensity = nextDensity
        }
        updateImageScale(nextScale)
    }

    @Synchronized
    fun updateImageScale(scale: Double) {
        attributes.imageScale = scale
        fallbackAttributes?.imageScale = scale * currentDensity / (fallbackDensity ?: currentDensity)
    }

    @Synchronized
    internal fun selectActiveAttributesForTest(currentTextureReady: Boolean, fallbackTextureReady: Boolean): PlacemarkAttributes =
        selectActiveAttributes(currentTextureReady, fallbackTextureReady, attributes)

    @Synchronized
    internal fun fallbackImageSourceForTest(): ImageSource? = fallbackAttributes?.imageSource

    @Synchronized
    internal fun fallbackImageScaleForTest(): Double? = fallbackAttributes?.imageScale

    @Synchronized
    override fun doRender(rc: RenderContext) {
        if (rc.globe.projectionLimits?.contains(position) == false) return
        val effectiveAltitudeMode = if (rc.globe.is2D) AltitudeMode.CLAMP_TO_GROUND else altitudeMode
        pointMemo.geographicToCartesian(rc, position, effectiveAltitudeMode, textureAnchor)
        preflightContext = rc
        preflightTextureReady = false
        try {
            determineActiveAttributes(rc)
            if (activeAttributes.imageSource != null && !preflightTextureReady) return
            super.doRender(rc)
        } finally {
            preflightContext = null
        }
    }

    @Synchronized
    override fun determineActiveAttributes(rc: RenderContext) {
        if (preflightContext === rc && preflightTextureReady) return
        super.determineActiveAttributes(rc)
        val current = activeAttributes
        val source = current.imageSource
        val effectiveAltitudeMode = if (rc.globe.is2D) AltitudeMode.CLAMP_TO_GROUND else altitudeMode
        pointMemo.geographicToCartesian(rc, position, effectiveAltitudeMode, textureAnchor)
        val inView = rc.frustum.containsPoint(textureAnchor)
        val currentTexture = source?.let { rc.getTexture(it, null, inView) }
        val fallback = fallbackAttributes
        val fallbackTexture = fallback?.imageSource?.let { rc.getTexture(it, null, inView) }
        activeAttributes = selectActiveAttributes(currentTexture != null, fallbackTexture != null, current)
        preflightTextureReady = when {
            activeAttributes.imageSource == null -> true
            activeAttributes === current -> currentTexture != null
            fallback != null && activeAttributes === fallback -> fallbackTexture != null
            else -> false
        }
    }

    @Synchronized
    private fun selectActiveAttributes(
        currentTextureReady: Boolean,
        fallbackTextureReady: Boolean,
        candidate: PlacemarkAttributes,
    ): PlacemarkAttributes {
        if (currentTextureReady) {
            fallbackAttributes = null
            fallbackDensity = null
            return candidate
        }
        return fallbackAttributes?.takeIf { fallbackTextureReady } ?: candidate
    }
}

internal data class PhotoImageFactory(val encoded: String, val count: Int = 1, val mapIcon: String? = null, val mapColor: String = "#176b68", val density: Int = 1) : ImageSource.NetworkBoundImageFactory {
    override suspend fun createCachedBitmap(): Bitmap? = createBitmap()
    override suspend fun createBitmap(): Bitmap? = runCatching {
        val bytes = Base64.getDecoder().decode(encoded)
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        require(bounds.outWidth > 0 && bounds.outHeight > 0 && bounds.outWidth.toLong() * bounds.outHeight <= 4_000_000)
        val pixelsPerCss = density.coerceIn(1, 4)
        val original = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply {
            inSampleSize = (maxOf(bounds.outWidth, bounds.outHeight) / (64 * pixelsPerCss)).coerceAtLeast(1)
        }) ?: return@runCatching null
        val result = Bitmap.createBitmap(64 * pixelsPerCss, 64 * pixelsPerCss, Bitmap.Config.ARGB_8888)
        Canvas(result).apply {
            scale(pixelsPerCss.toFloat(), pixelsPerCss.toFloat())
            val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
            paint.color = android.graphics.Color.WHITE
            drawRoundRect(4f, 4f, 60f, 60f, 4f, 4f, paint)
            val side = minOf(original.width, original.height)
            val left = (original.width - side) / 2
            val top = (original.height - side) / 2
            save(); clipRect(6, 6, 58, 58)
            drawBitmap(original, android.graphics.Rect(left, top, left + side, top + side), android.graphics.Rect(6, 6, 58, 58), paint)
            restore()
            if (mapIcon != null) {
                paint.color = android.graphics.Color.WHITE
                drawRoundRect(46f, 46f, 64f, 64f, 4f, 4f, paint)
                val color = runCatching { android.graphics.Color.parseColor(mapColor) }
                    .getOrDefault(android.graphics.Color.rgb(23, 107, 104))
                save(); translate(39f, 43f); scale(.5f, .5f)
                NativeModelRenderer.drawMarkerGlyph(this, mapIcon, color)
                restore()
            }
            if (count > 1) {
                val text = count.toString()
                paint.textSize = 10f
                paint.typeface = android.graphics.Typeface.DEFAULT_BOLD
                val width = paint.measureText(text) + 8f
                paint.color = android.graphics.Color.rgb(22, 56, 57)
                drawRoundRect(64f - width, 0f, 64f, 14f, 4f, 4f, paint)
                paint.color = android.graphics.Color.WHITE
                drawText(text, 64f - width + 4f, 10.5f, paint)
            }
        }
        original.recycle()
        result
    }.getOrNull()
}
