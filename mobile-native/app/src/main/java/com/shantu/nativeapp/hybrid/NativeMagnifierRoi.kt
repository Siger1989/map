package com.shantu.nativeapp.hybrid

import kotlin.math.ceil
import kotlin.math.floor

/** PixelCopy source rectangle and its exact map-local CSS mapping. */
internal data class NativeMagnifierRoi(
    val leftPx: Int,
    val topPx: Int,
    val rightPx: Int,
    val bottomPx: Int,
    val xCss: Double,
    val yCss: Double,
    val widthCss: Double,
    val heightCss: Double,
) {
    val widthPx get() = rightPx - leftPx
    val heightPx get() = bottomPx - topPx
}

/** Converts a requested map-local CSS crop to bounded physical Surface pixels. */
internal object NativeMagnifierRoiPolicy {
    fun clamp(
        surfaceWidthPx: Int,
        surfaceHeightPx: Int,
        cssScale: Double,
        xCss: Double,
        yCss: Double,
        widthCss: Double,
        heightCss: Double,
    ): NativeMagnifierRoi? {
        if (surfaceWidthPx <= 0 || surfaceHeightPx <= 0 || !cssScale.isFinite() || cssScale <= 0.0 ||
            !xCss.isFinite() || !yCss.isFinite() || !widthCss.isFinite() || !heightCss.isFinite() ||
            widthCss <= 0.0 || heightCss <= 0.0) return null
        val left = floor(xCss * cssScale).toInt().coerceIn(0, surfaceWidthPx)
        val top = floor(yCss * cssScale).toInt().coerceIn(0, surfaceHeightPx)
        val right = ceil((xCss + widthCss) * cssScale).toInt().coerceIn(0, surfaceWidthPx)
        val bottom = ceil((yCss + heightCss) * cssScale).toInt().coerceIn(0, surfaceHeightPx)
        if (right <= left || bottom <= top) return null
        return NativeMagnifierRoi(
            left, top, right, bottom,
            left / cssScale, top / cssScale,
            (right - left) / cssScale, (bottom - top) / cssScale,
        )
    }
}
