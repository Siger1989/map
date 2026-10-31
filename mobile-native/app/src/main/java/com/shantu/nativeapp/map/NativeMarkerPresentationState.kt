package com.shantu.nativeapp.map

import kotlin.math.abs

/** Per-map symbol state: camera noise cannot repeatedly rebuild label/icon/dot textures. */
internal class NativeMarkerPresentationState {
    data class Update(val mode: String, val rebuild: Boolean, val resize: Boolean)
    private var mode: String? = null
    private var density = 0
    private var scale = Double.NaN

    fun update(zoom: Double, cssScale: Double): Update {
        val nextMode = NativeMarkerPresentation.stableMode(zoom, mode)
        val nextDensity = NativeMarkerPresentation.densityBucket(cssScale)
        val nextScale = NativeMarkerPresentation.imageScale(zoom, cssScale, nextDensity, nextMode)
        val rebuild = mode != nextMode || density != nextDensity
        val resize = rebuild || !scale.isFinite() || abs(nextScale - scale) > 0.00001
        mode = nextMode
        density = nextDensity
        scale = nextScale
        return Update(nextMode, rebuild, resize)
    }
}
