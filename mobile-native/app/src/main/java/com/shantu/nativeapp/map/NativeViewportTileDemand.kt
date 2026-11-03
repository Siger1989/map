package com.shantu.nativeapp.map

/** One WorldWind quadtree request identity; [sdkRow] is south-to-north, unlike slippy source Y. */
internal data class NativeViewportTileKey(val z: Int, val x: Int, val sdkRow: Int) {
    val sourceY: Int get() = (1 shl z) - 1 - sdkRow
}

/** Records exact tile identities visited by the SDK's current frame traversal. */
internal class NativeViewportTileDemand(private val maxZoom: Int) {
    private val frame = LinkedHashSet<NativeViewportTileKey>()
    private var retained = emptySet<NativeViewportTileKey>()

    init { require(maxZoom in 0..29) }

    fun beginFrame() {
        frame.clear()
        retained = emptySet()
    }

    fun mark(z: Int, x: Int, sdkRow: Int) {
        require(z in 0..maxZoom)
        val size = 1 shl z
        require(x in 0 until size && sdkRow in 0 until size)
        frame += NativeViewportTileKey(z, x, sdkRow)
    }

    fun endFrame(): Set<NativeViewportTileKey> = frame.toSet().also { retained = it }

    /** Off-screen projection is uncertain here; keep the key eligible after ordinary finite ranks. */
    fun rankForRetained(key: NativeViewportTileKey, projectedRank: Double?): Double? {
        if (key !in retained) return null
        return projectedRank?.takeIf { it.isFinite() && it >= 0.0 } ?: Double.MAX_VALUE
    }
}
