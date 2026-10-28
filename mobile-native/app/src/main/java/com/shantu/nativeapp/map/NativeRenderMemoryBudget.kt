package com.shantu.nativeapp.map

/** Pure heap-derived limits shared by native render surfaces and vector layers. */
internal object NativeRenderMemoryBudget {
    /** Low-RAM devices keep the original quarter-heap three-surface reservation. */
    fun textureCapacityBytes(maxHeapBytes: Long): Long {
        val heap = maxHeapBytes.coerceAtLeast(0L)
        val divisor = if (heap >= LARGE_HEAP_THRESHOLD_BYTES) 6L else 12L
        val maximum = if (divisor == 6L) LARGE_MAX_TEXTURE_BYTES else MAX_TEXTURE_BYTES
        return (heap / divisor).coerceIn(MIN_TEXTURE_BYTES, maximum)
    }

    /** Per MVT layer loaded-tile limit, bounded for both small and large app heaps. */
    fun vectorTileCount(maxHeapBytes: Long): Int =
        (maxHeapBytes.coerceAtLeast(0L) / BYTES_PER_VECTOR_TILE).coerceIn(MIN_VECTOR_TILES.toLong(), MAX_VECTOR_TILES.toLong()).toInt()

    const val MIN_VECTOR_TILES = 12
    /** Bitmap + warp pixels + GPU upload coexist. Reserve at most 1/32 heap per copy. */
    fun rasterPatchSide(maxHeapBytes: Long, tileSize: Int): Int {
        require(tileSize in setOf(256, 512, 1024, 2048))
        val pixels = (maxHeapBytes.coerceAtLeast(0L) / 32L / 4L).coerceIn(256L * 256L, 2048L * 2048L)
        val side = kotlin.math.sqrt(pixels.toDouble()).toInt() / tileSize
        return side.coerceIn(1, 16)
    }

    const val MAX_VECTOR_TILES = 32
    private const val MIB = 1024L * 1024L
    private const val BYTES_PER_VECTOR_TILE = 8L * MIB
    private const val LARGE_HEAP_THRESHOLD_BYTES = 384L * MIB
    private const val MIN_TEXTURE_BYTES = 8L * MIB
    private const val MAX_TEXTURE_BYTES = 48L * MIB
    private const val LARGE_MAX_TEXTURE_BYTES = 96L * MIB
}
