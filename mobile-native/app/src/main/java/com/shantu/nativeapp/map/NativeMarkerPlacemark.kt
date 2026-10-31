package com.shantu.nativeapp.map

import earth.worldwind.geom.AltitudeMode
import earth.worldwind.geom.Vec3
import earth.worldwind.render.RenderContext
import earth.worldwind.render.image.ImageSource
import earth.worldwind.shape.Placemark
import earth.worldwind.shape.PlacemarkAttributes

internal data class NativeMarkerFallbackPresentation(
    val attributes: PlacemarkAttributes,
    val mode: String,
    val density: Int,
)

/**
 * Keeps the last ready marker image active while a replacement ImageSource is
 * retrieved by WorldWind's asynchronous local-image lane.
 */
internal class NativeMarkerPlacemark(
    position: earth.worldwind.geom.Position,
    attributes: PlacemarkAttributes,
    mode: String,
    density: Int,
    fallback: NativeMarkerFallbackPresentation? = null,
) : Placemark(position, attributes, "") {
    private val textureAnchor = Vec3()
    private var preflightContext: RenderContext? = null
    private var preflightInView = false
    private var activeTextureReady = false
    private var fallbackAttributes: PlacemarkAttributes? = fallback?.attributes
    private var fallbackMode: String? = fallback?.mode
    private var fallbackDensity: Int? = fallback?.density
    private var mode = mode
    private var density = density

    @Synchronized
    fun updateImagePresentation(
        next: PlacemarkAttributes,
        nextMode: String,
        nextDensity: Int,
        fallbackScale: Double,
    ) {
        if (fallbackAttributes == null) {
            fallbackAttributes = attributes
            fallbackMode = mode
            fallbackDensity = density
            fallbackAttributes?.imageScale = fallbackScale
        }
        attributes = next
        mode = nextMode
        density = nextDensity
    }

    @Synchronized
    fun updateImageScale(zoom: Double, cssScale: Double, imageScale: Double) {
        attributes.imageScale = imageScale
        fallbackAttributes?.imageScale = NativeMarkerPresentation.imageScale(
            zoom, cssScale, fallbackDensity ?: density, fallbackMode ?: mode,
        )
    }

    @Synchronized
    override fun doRender(rc: RenderContext) {
        if (rc.globe.projectionLimits?.contains(position) == false) return
        pointMemo.geographicToCartesian(
            rc,
            position,
            if (rc.globe.is2D) AltitudeMode.CLAMP_TO_GROUND else altitudeMode,
            textureAnchor,
        )
        preflightContext = rc
        preflightInView = rc.frustum.containsPoint(textureAnchor)
        try {
            determineActiveAttributes(rc)
            if (shouldSkipForMissingTexture(activeAttributes.imageSource, activeTextureReady)) return
            super.doRender(rc)
        } finally {
            preflightContext = null
        }
    }

    @Synchronized
    override fun determineActiveAttributes(rc: RenderContext) {
        super.determineActiveAttributes(rc)
        val current = activeAttributes
        val source = current.imageSource
        val inView = if (preflightContext === rc) preflightInView else {
            pointMemo.geographicToCartesian(
                rc,
                position,
                if (rc.globe.is2D) AltitudeMode.CLAMP_TO_GROUND else altitudeMode,
                textureAnchor,
            )
            rc.frustum.containsPoint(textureAnchor)
        }
        val currentTexture = source?.let { rc.getTexture(it, null, inView) }
        if (currentTexture != null) {
            fallbackAttributes = null
            fallbackMode = null
            fallbackDensity = null
            activeAttributes = current
            activeTextureReady = true
            return
        }

        val fallback = fallbackAttributes
        val fallbackTexture = fallback?.imageSource?.let { rc.getTexture(it, null, inView) }
        activeAttributes = selectActiveAttributes(currentTexture != null, fallbackTexture != null, current)
        activeTextureReady = when {
            activeAttributes.imageSource == null -> true
            activeAttributes === current -> currentTexture != null
            fallback != null && activeAttributes === fallback -> fallbackTexture != null
            else -> false
        }
    }

    /** Kept small and explicit so the async-ready/fallback rule has a direct unit test. */
    @Synchronized
    internal fun selectActiveAttributes(
        currentTextureReady: Boolean,
        fallbackTextureReady: Boolean,
        candidate: PlacemarkAttributes = attributes,
    ): PlacemarkAttributes {
        if (currentTextureReady) {
            fallbackAttributes = null
            fallbackMode = null
            fallbackDensity = null
            return candidate
        }
        return fallbackAttributes?.takeIf { fallbackTextureReady } ?: candidate
    }

    @Synchronized
    internal fun fallbackImageSourceForTest(): ImageSource? = fallbackAttributes?.imageSource

    internal fun shouldSkipForMissingTexture(imageSource: ImageSource?, textureReady: Boolean): Boolean =
        imageSource != null && !textureReady

    @Synchronized
    internal fun snapshotForReplacement(): NativeMarkerFallbackPresentation =
        NativeMarkerFallbackPresentation(
            fallbackAttributes ?: attributes,
            fallbackMode ?: mode,
            fallbackDensity ?: density,
        )

}
