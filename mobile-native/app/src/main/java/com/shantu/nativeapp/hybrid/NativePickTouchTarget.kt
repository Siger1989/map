package com.shantu.nativeapp.hybrid

/** Physical-pixel bounds for the native GPU fallback used by small map objects. */
internal object NativePickTouchTarget {
    const val MINIMUM_CSS_SIZE = 44.0

    data class Bounds(val left: Float, val top: Float, val right: Float, val bottom: Float)

    /** Legacy native picks use bare IDs; the React gesture adapter uses typed object delegates. */
    fun normalizeMarkerIds(ids: List<String>, annotationIds: Set<String>): List<String> =
        ids.map { if (it in annotationIds && !it.startsWith("shantu-object:")) "shantu-object:$it" else it }.distinct()

    fun centered(x: Float, y: Float, cssScale: Double): Bounds {
        require(x.isFinite() && y.isFinite() && cssScale.isFinite() && cssScale > 0.0)
        val halfSizePx = (MINIMUM_CSS_SIZE * cssScale / 2.0).toFloat()
        return Bounds(x - halfSizePx, y - halfSizePx, x + halfSizePx, y + halfSizePx)
    }
}
