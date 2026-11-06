package com.shantu.nativeapp.map

import android.util.LongSparseArray
import earth.worldwind.geom.Sector
import earth.worldwind.globe.Globe
import earth.worldwind.render.RenderContext
import earth.worldwind.render.Texture
import earth.worldwind.render.image.ImageSource
import earth.worldwind.render.image.ImageTile
import java.lang.ref.WeakReference
import java.util.ArrayDeque

/** Per-map, per-prepared-frame cached ancestors. Does not request or retain a RenderContext. */
internal class NativeRasterFeatherBackingStore {
    val diagnostics = NativeRasterFeatherDiagnostics()
    internal class Backing {
        var source: ImageSource? = null
        var texture: Texture? = null
        var key = 0L
        var epoch = -1L
        val sector = Sector()
        fun clear() { source = null; texture = null }
    }
    private val index = LongSparseArray<Backing>()
    private var active = ArrayList<Backing>()
    private var previous = ArrayList<Backing>()
    private val pool = ArrayDeque<Backing>()
    private var epoch = 0L
    private var queue: WeakReference<Any>? = null
    private var cache: WeakReference<Any>? = null
    private var globeOffset = Globe.Offset.Center

    fun begin(rc: RenderContext) {
        diagnostics.beginFrame()
        val old = previous; previous = active; active = old; active.clear(); epoch++
        val frameQueue = rc.drawableQueue ?: return clear()
        queue = WeakReference(frameQueue); cache = WeakReference(rc.renderResourceCache)
        globeOffset = rc.globe.offset
    }

    fun remember(tile: ImageTile, texture: Texture) {
        val source = tile.imageSource ?: return
        val key = NativeRasterFeatherPolicy.key(tile.level.levelNumber, tile.row, tile.column)
        var record = index[key]
        if (record == null) {
            if (index.size() >= NativeRasterFeatherPolicy.MAX_LEAVES * 2) return
            record = pool.pollFirst() ?: Backing()
            record.key = key; index.put(key, record)
        }
        if (record.epoch != epoch) { record.epoch = epoch; active.add(record) }
        record.source = source; record.texture = texture; record.sector.copy(tile.sector)
    }

    fun end() {
        // Stable frames reuse their entries. Only tiles no longer visited release backing references.
        for (record in previous) if (record.epoch != epoch) {
            index.remove(record.key); record.clear(); pool.addLast(record)
        }
        previous.clear()
    }

    fun find(rc: RenderContext, level: Int, x: Int, xyzY: Int): Backing? {
        if (level !in 1..24 || queue?.get() !== rc.drawableQueue || cache?.get() !== rc.renderResourceCache ||
            globeOffset != rc.globe.offset) return null
        val row = (1 shl level) - 1 - xyzY
        for (parent in level - 1 downTo 0) {
            val shift = level - parent
            val result = index[NativeRasterFeatherPolicy.key(parent, row shr shift, x shr shift)] ?: continue
            if (result.epoch != epoch) continue
            val source = result.source ?: continue
            if (result.texture != null && rc.renderResourceCache[source] === result.texture) return result
        }
        return null
    }

    fun clear() {
        val monitor = cache?.get()
        if (monitor == null) clearState() else synchronized(monitor) { clearState() }
    }
    private fun clearState() {
        for (i in 0 until index.size()) index.valueAt(i).clear()
        index.clear(); active.clear(); previous.clear(); pool.clear()
        queue = null; cache = null
        diagnostics.clearCurrent()
    }
    fun snapshotCounters(): Map<String, Long> = diagnostics.snapshotCounters()
}
