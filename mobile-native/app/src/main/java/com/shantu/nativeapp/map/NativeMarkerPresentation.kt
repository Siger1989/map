package com.shantu.nativeapp.map

import kotlin.math.roundToInt

/** Same raw camera zoom boundaries as modules/annotations/markerScale.ts. */
internal object NativeMarkerPresentation {
    private val VALID_MODES = setOf("label", "icon", "dot")

    @Suppress("UNUSED_PARAMETER")
    fun mode(zoom: Double, selected: Boolean): String {
        // Selection cannot keep a large label visible at regional scales.
        return when {
            !zoom.isFinite() || zoom >= 9.0 -> "label"
            zoom >= 8.0 -> "icon"
            else -> "dot"
        }
    }

    /** Hysteresis prevents a noisy camera zoom around a boundary from rebuilding frames repeatedly. */
    fun stableMode(zoom: Double, previousMode: String?): String {
        if (!zoom.isFinite()) return previousMode?.takeIf { it in VALID_MODES } ?: mode(zoom, false)
        return when (previousMode) {
            "label" -> when { zoom < 7.85 -> "dot"; zoom < 8.85 -> "icon"; else -> "label" }
            "icon" -> when { zoom >= 9.15 -> "label"; zoom < 7.85 -> "dot"; else -> "icon" }
            "dot" -> when { zoom >= 9.15 -> "label"; zoom >= 8.15 -> "icon"; else -> "dot" }
            else -> mode(zoom, false)
        }
    }

    fun resolvedMode(zoom: Double, override: String?): String =
        override?.takeIf { it in VALID_MODES } ?: mode(zoom, false)

    /** Number of bitmap pixels per logical canvas pixel, bounded to keep image keys finite. */
    fun densityBucket(cssScale: Double): Int =
        if (cssScale.isFinite()) cssScale.roundToInt().coerceIn(1, 4) else 1

    /** Match the previous 40 px label (24 px body + 16 px pointer), 22 px icon and 9 px dot. */
    @Suppress("UNUSED_PARAMETER")
    fun imageScale(zoom: Double, cssScale: Double, densityBucket: Int, mode: String): Double {
        val safeCssScale = cssScale.takeIf { it.isFinite() && it > 0.0 } ?: 1.0
        val pixels = when (mode) { "label" -> 40.0; "icon" -> 22.0; else -> 9.0 }
        val sourceHeight = if (mode == "dot") 9.0 else 64.0
        // The old CSS mode rules override the generic markerScale transform.
        // Multiplying that unused curve here would shrink 12 px text near zoom 9.
        return pixels * safeCssScale / (sourceHeight * densityBucket.coerceIn(1, 4))
    }
}
