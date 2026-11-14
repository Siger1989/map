package com.shantu.nativeapp.hybrid

import com.shantu.nativeapp.map.NativeCameraSnapshot
import com.shantu.nativeapp.navigation.NativeCoordinate
import com.shantu.nativeapp.navigation.NativeRouteViewport

/** CSS padding is local to the selected map pane, not the full device window. */
internal object NativeCollectionViewport {
    data class VisibleRect(val left: Double, val top: Double, val right: Double, val bottom: Double) {
        val width get() = right - left
        val height get() = bottom - top
        val centerX get() = (left + right) / 2.0
        val centerY get() = (top + bottom) / 2.0
    }

    fun visibleRect(width: Int, height: Int, cssScale: Double, top: Double, right: Double, bottom: Double, left: Double): VisibleRect {
        require(width > 0 && height > 0)
        val scale = cssScale.takeIf { it.isFinite() && it > 0 } ?: 1.0
        fun inset(value: Double, extent: Int) = if (value.isFinite()) value.coerceIn(0.0, extent / scale) * scale else 0.0
        var l = inset(left, width); var r = inset(right, width)
        var t = inset(top, height); var b = inset(bottom, height)
        // Invalid/oversized callers may not produce zero or negative fitting dimensions.
        if (l + r > width - 1.0) { val factor = (width - 1.0) / (l + r); l *= factor; r *= factor }
        if (t + b > height - 1.0) { val factor = (height - 1.0) / (t + b); t *= factor; b *= factor }
        return VisibleRect(l, t, width - r, height - b)
    }

    fun fit(coordinates: List<NativeCoordinate>, current: NativeCameraSnapshot, width: Int, height: Int, visible: VisibleRect): NativeCameraSnapshot {
        require(width > 0 && height > 0 && visible.width > 0 && visible.height > 0)
        val target = NativeRouteViewport.fit(coordinates, current, visible.width.toInt().coerceAtLeast(1), visible.height.toInt().coerceAtLeast(1))
        // The camera still uses the full pane's vertical FOV: a fit made with the
        // available aspect alone would leave vertical routes underneath the panel.
        return target.copy(rangeMeters = (target.rangeMeters * height / visible.height).coerceIn(500.0, 25_000_000.0))
    }
}
