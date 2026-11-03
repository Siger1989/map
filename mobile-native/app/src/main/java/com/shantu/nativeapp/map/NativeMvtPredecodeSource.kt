package com.shantu.nativeapp.map

import earth.worldwind.layer.cache.RevalidatingSource
import earth.worldwind.layer.source.TileBlob
import earth.worldwind.layer.source.TileSource

/**
 * Validates viewport demand before raw lookup and after data returns. Cached non-empty blobs wait
 * for center-ranked decode admission. Network returns never wait here: the SDK holds its network
 * permit until fetchTile returns, so waiting would block fresh center downloads behind old bytes.
 */
internal open class NativeMvtPredecodeSource private constructor(
    protected val delegate: TileSource,
    private val checkNeeded: (z: Int, x: Int, sourceY: Int) -> Unit,
    private val beforeCachedDecode: suspend (z: Int, x: Int, sourceY: Int) -> Unit,
) : TileSource {
    override suspend fun tryReadCachedTile(z: Int, x: Int, y: Int): TileBlob? {
        checkNeeded(z, x, y)
        val cached = delegate.tryReadCachedTile(z, x, y) ?: return null
        // A pan/zoom may stale a response while storage was being read. Recheck before occupying
        // the assembly/decode gate, then return the original blob without copying its byte array.
        checkNeeded(z, x, y)
        if (!cached.isEmpty) beforeCachedDecode(z, x, y)
        return cached
    }

    override suspend fun fetchTile(
        z: Int,
        x: Int,
        y: Int,
        previousEtag: String?,
        previousLastModified: String?,
    ): TileBlob? {
        checkNeeded(z, x, y)
        val fetched = delegate.fetchTile(z, x, y, previousEtag, previousLastModified) ?: return null
        // Fetches already in progress may complete after demand changes; do not decode their bytes.
        checkNeeded(z, x, y)
        // Do not retain the SDK's HTTP permit while waiting for cached-decode admission.
        // Its existing assembly semaphore still bounds network-result decode/geometry work.
        return fetched
    }

    override fun close() = delegate.close()

    companion object {
        fun wrap(
            delegate: TileSource,
            checkNeeded: (z: Int, x: Int, sourceY: Int) -> Unit,
            beforeCachedDecode: suspend (z: Int, x: Int, sourceY: Int) -> Unit,
        ): TileSource = if (delegate is RevalidatingSource) {
            Revalidating(delegate, checkNeeded, beforeCachedDecode)
        } else Plain(delegate, checkNeeded, beforeCachedDecode)

        /** Remove this adapter before cloning a layer so callbacks stay owned by the new instance. */
        fun unwrap(source: TileSource): TileSource = (source as? NativeMvtPredecodeSource)?.delegate ?: source
    }

    private class Plain(
        delegate: TileSource,
        checkNeeded: (Int, Int, Int) -> Unit,
        beforeCachedDecode: suspend (Int, Int, Int) -> Unit,
    ) : NativeMvtPredecodeSource(delegate, checkNeeded, beforeCachedDecode)

    private class Revalidating(
        private val revalidatingDelegate: TileSource,
        checkNeeded: (Int, Int, Int) -> Unit,
        beforeCachedDecode: suspend (Int, Int, Int) -> Unit,
    ) : NativeMvtPredecodeSource(revalidatingDelegate, checkNeeded, beforeCachedDecode), RevalidatingSource {
        private val source get() = revalidatingDelegate as RevalidatingSource
        override var onTileRevalidated: ((z: Int, x: Int, y: Int) -> Unit)?
            get() = source.onTileRevalidated
            set(value) { source.onTileRevalidated = value }
    }
}
