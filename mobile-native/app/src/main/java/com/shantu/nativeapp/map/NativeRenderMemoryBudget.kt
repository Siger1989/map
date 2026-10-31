package com.shantu.nativeapp.map

/** Pure heap-derived limits shared by native render surfaces and vector layers. */
internal object NativeRenderMemoryBudget {
    /**
     * Dense 30 m contour tiles measured about 4-5 MiB each; 32 MiB retained only
     * six of a 24-tile view and continuously rebuilt the same visible geometry.
     * Bound CPU geometry by a quarter of the heap, independently of the GPU cache.
     */
    fun contourCapacityBytes(maxHeapBytes: Long): Long =
        (maxHeapBytes.coerceAtLeast(0L) / 4L).coerceIn(8L * MIB, 128L * MIB)

    /**
     * A ceiling, not a preallocation. The high-detail oblique viewport can use over 160 MiB
     * of live textures at 390x857. Dividing the heap by 6/12 evicted visible tiles on every
     * frame, causing an unending decode/upload loop and larger transient bitmap peaks.
     * Each surface remains bounded; smaller secondary/share viewports use only what they need.
     */
    fun textureCapacityBytes(maxHeapBytes: Long, physicalMemoryBytes: Long = 0L, lowRamDevice: Boolean = false): Long {
        val heap = maxHeapBytes.coerceAtLeast(0L)
        val fallback = (heap / 2L).coerceIn(MIN_TEXTURE_BYTES, MAX_TEXTURE_BYTES)
        // GPU textures/buffers are not the Java heap. A fixed 192 MiB ceiling can
        // evict the visible imagery cut on high resolution phones even while idle.
        // Use a conservative physical-memory share, without preallocating it.
        if (physicalMemoryBytes <= 0L || lowRamDevice) return fallback
        return maxOf(fallback, physicalMemoryBytes / 16L).coerceAtMost(512L * MIB)
    }

    /**
     * Resident styled tiles, not unfiltered 8 MiB source tiles. A 24/32-entry cache was
     * smaller than the visible oblique cut, continuously discarding and rebuilding geometry.
     * Keep the SDK's bounded 256-tile working set on large heaps, scale down on small heaps.
     */
    fun vectorTileCount(maxHeapBytes: Long): Int =
        (maxHeapBytes.coerceAtLeast(0L) / BYTES_PER_VECTOR_TILE).coerceIn(MIN_VECTOR_TILES.toLong(), MAX_VECTOR_TILES.toLong()).toInt()

    const val MIN_VECTOR_TILES = 32
    /** Bitmap + warp pixels + GPU upload coexist. Reserve at most 1/32 heap per copy. */
    fun rasterPatchSide(maxHeapBytes: Long, tileSize: Int): Int {
        require(tileSize in setOf(256, 512, 1024, 2048))
        val pixels = (maxHeapBytes.coerceAtLeast(0L) / 32L / 4L).coerceIn(256L * 256L, 2048L * 2048L)
        val side = kotlin.math.sqrt(pixels.toDouble()).toInt() / tileSize
        return side.coerceIn(1, 16)
    }

    const val MAX_VECTOR_TILES = 256
    private const val MIB = 1024L * 1024L
    private const val BYTES_PER_VECTOR_TILE = 2L * MIB
    private const val MIN_TEXTURE_BYTES = 8L * MIB
    private const val MAX_TEXTURE_BYTES = 192L * MIB
}
