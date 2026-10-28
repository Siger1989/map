package com.shantu.nativeapp.map

/** Same raw camera zoom boundaries as modules/annotations/markerScale.ts. */
internal object NativeMarkerPresentation {
    fun mode(zoom: Double, selected: Boolean): String = when {
        selected || !zoom.isFinite() || zoom >= 9.0 -> "label"
        zoom < 8.0 -> "dot"
        else -> "icon"
    }
}
