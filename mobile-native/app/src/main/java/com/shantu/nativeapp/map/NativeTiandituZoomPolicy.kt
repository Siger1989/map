package com.shantu.nativeapp.map

/** Native raster level caps mirrored from modules/cartography/tianditu.ts. */
internal object NativeTiandituZoomPolicy {
    fun sourceMaxZoom(layer: String): Int = when (layer) {
        "vec", "img" -> 18
        "ter" -> 14
        "cva" -> 19
        "cia", "cta", "ibo" -> 18
        else -> throw IllegalArgumentException("Unsupported built-in Tianditu layer")
    }

    /** A fixed-detail request may reduce detail, but cannot request beyond this layer's source data. */
    fun effectiveMaxZoom(layer: String, fixedRasterZoom: Int?): Int {
        val sourceMax = sourceMaxZoom(layer)
        return fixedRasterZoom?.coerceIn(1, sourceMax) ?: sourceMax
    }
}
