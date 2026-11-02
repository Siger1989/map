package com.shantu.nativeapp.map

import earth.worldwind.layer.source.TileBlob
import earth.worldwind.layer.source.TileSource

/**
 * Non-owning decode view of our shared raw MVT source. The original cache and snapping observers
 * keep the full bytes. Each render layer receives only the feature payload its fixed style uses.
 * Layer headers remain so WorldWind's schema detection and label defaults are unchanged.
 * Only NativeCartographyLayers' shared, non-revalidating source is wrapped by the caller.
 */
internal class NativeMvtLayerSource(
    private val source: TileSource,
    retainedLayerNames: Set<String>,
) : TileSource {
    private val names = retainedLayerNames.toSet()

    override suspend fun tryReadCachedTile(z: Int, x: Int, y: Int): TileBlob? =
        select(source.tryReadCachedTile(z, x, y))

    override suspend fun fetchTile(z: Int, x: Int, y: Int, previousEtag: String?, previousLastModified: String?): TileBlob? =
        select(source.fetchTile(z, x, y, previousEtag, previousLastModified))

    private fun select(blob: TileBlob?): TileBlob? {
        if (blob == null || blob.isEmpty) return blob
        val bytes = NativeMvtLayerPayload.filter(blob.bytes, names)
        return if (bytes === blob.bytes) blob else blob.copy(bytes = bytes)
    }

    // NativeCartographyLayers owns and releases the shared source after all its render layers close.
    override fun close() = Unit
}
