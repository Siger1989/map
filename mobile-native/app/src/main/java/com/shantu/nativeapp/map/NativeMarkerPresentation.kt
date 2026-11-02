package com.shantu.nativeapp.map

import kotlin.math.roundToInt

/** Composite native badge sizing uses the generic zoom curve in modules/annotations/markerScale.ts. */
internal object NativeMarkerPresentation {
    @Suppress("UNUSED_PARAMETER")
    fun mode(zoom: Double, selected: Boolean): String = "label"

    /** Keep icon, name box, and text as one badge at every zoom level. */
    @Suppress("UNUSED_PARAMETER")
    fun stableMode(zoom: Double, previousMode: String?): String = "label"

    @Suppress("UNUSED_PARAMETER")
    fun resolvedMode(zoom: Double, override: String?): String = "label"

    /** Number of bitmap pixels per logical canvas pixel, bounded to keep image keys finite. */
    fun densityBucket(cssScale: Double): Int =
        if (cssScale.isFinite()) cssScale.roundToInt().coerceIn(1, 4) else 1

    /** Scale the full 64 px badge from its nominal 40 CSS px size using the generic marker zoom curve. */
    @Suppress("UNUSED_PARAMETER")
    fun imageScale(zoom: Double, cssScale: Double, densityBucket: Int, mode: String): Double {
        val safeCssScale = cssScale.takeIf { it.isFinite() && it > 0.0 } ?: 1.0
        val zoomScale = if (zoom.isFinite()) (0.35 + (zoom - 4.0) * 0.65 / 12.0).coerceIn(0.35, 1.0) else 1.0
        return 40.0 * safeCssScale * zoomScale / (64.0 * densityBucket.coerceIn(1, 4))
    }
}
