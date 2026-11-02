package com.shantu.nativeapp.map

import android.os.Trace
import earth.worldwind.layer.mvt.MvtTile
import earth.worldwind.layer.mvt.MvtStyle
import earth.worldwind.layer.mvt.MvtVectorLayer
import earth.worldwind.layer.source.TileSource
import earth.worldwind.render.RenderContext
import earth.worldwind.render.Renderable
import java.util.concurrent.atomic.AtomicLong

/**
 * Times one background MVT layer's normal WorldWind render call without changing its render policy.
 *
 * The elapsed wall time includes the SDK tile-selection/assembly-result drain, drawable submission,
 * and the MVT endFrame label pass. It is not GPU execution time. Pick passes are delegated without
 * recording; the application does not use background MVT features as pick targets.
 */
internal open class NativeTimedMvtLayer(
    source: TileSource,
    minZoom: Int,
    maxZoom: Int,
    maxLoadedTiles: Int,
    maxConcurrentFetches: Int,
    maxConcurrentAssembly: Int,
    style: MvtStyle,
    displayName: String,
    private val metricPrefix: String,
) : MvtVectorLayer(
    source = source,
    minZoom = minZoom,
    maxZoom = maxZoom,
    maxLoadedTiles = maxLoadedTiles,
    maxConcurrentFetches = maxConcurrentFetches,
    maxConcurrentAssembly = maxConcurrentAssembly,
    style = style,
    displayName = displayName,
) {
    private val renderCount = AtomicLong()
    private val renderTotalNanos = AtomicLong()
    private val renderMaxNanos = AtomicLong()
    private val renderTraceName = "ShantuMvt/$metricPrefix/render"
    private val labelTraceName = "ShantuMvt/$metricPrefix/labels"
    private val assemblyTraceName = "ShantuMvt/$metricPrefix/assemble"

    override fun render(rc: RenderContext) {
        // Preserve SDK pick and visibility gating, while excluding pick/disabled frames from the
        // normal-render metric. LayerList still sees this concrete MVT subclass as currentLayer.
        if (rc.isPickMode || !isEnabled || !isWithinActiveAltitudes(rc)) {
            super.render(rc)
            return
        }

        val startedAt = System.nanoTime()
        Trace.beginSection(renderTraceName)
        try {
            super.render(rc)
        } finally {
            Trace.endSection()
            recordRender(System.nanoTime() - startedAt)
        }
    }

    override fun endFrame(rc: RenderContext) {
        Trace.beginSection(labelTraceName)
        try { super.endFrame(rc) } finally { Trace.endSection() }
    }

    override fun toRenderables(key: TileKey, tile: MvtTile): List<Renderable> {
        Trace.beginSection(assemblyTraceName)
        return try { super.toRenderables(key, tile) } finally { Trace.endSection() }
    }

    /** Called only by an explicit diagnostics snapshot, never from the render loop. */
    fun appendFrameCost(destination: MutableMap<String, Long>) {
        destination["${metricPrefix}Count"] = renderCount.get()
        destination["${metricPrefix}TotalNanos"] = renderTotalNanos.get()
        destination["${metricPrefix}MaxNanos"] = renderMaxNanos.get()
    }

    private fun recordRender(elapsedNanos: Long) {
        val elapsed = elapsedNanos.coerceAtLeast(0L)
        renderCount.incrementAndGet()
        renderTotalNanos.addAndGet(elapsed)
        while (true) {
            val previousMax = renderMaxNanos.get()
            if (elapsed <= previousMax || renderMaxNanos.compareAndSet(previousMax, elapsed)) break
        }
    }
}
