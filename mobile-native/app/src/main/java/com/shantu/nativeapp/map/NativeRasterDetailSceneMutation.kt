package com.shantu.nativeapp.map

/**
 * Serializes fixed-detail scene mutations with WorldWind 2.1.1 frame drawing.
 *
 * Android WorldWindow draws while synchronized on RenderResourceCache, so callers pass that same
 * monitor here. The callbacks stay generic to make the lifecycle path directly testable.
 */
internal class NativeRasterDetailSceneMutation<Renderable : Any, ImageKey : Any>(
    private val renderMonitor: Any,
    private val addRenderable: (Renderable) -> Unit,
    private val removeRenderable: (Renderable) -> Unit,
    private val removeTexture: (ImageKey) -> Unit,
) {
    /** Prepare and attach a renderable atomically with rendering only while work is still current. */
    fun addIfCurrent(renderable: Renderable, isCurrent: () -> Boolean, prepare: () -> Boolean): Boolean =
        synchronized(renderMonitor) {
            if (!isCurrent()) return@synchronized false
            if (!prepare()) return@synchronized false
            addRenderable(renderable)
            true
        }

    /** Remove one fixed-detail shape and its GPU texture without touching other imagery layers. */
    fun retire(renderable: Renderable, imageKey: ImageKey) = synchronized(renderMonitor) {
        removeRenderable(renderable)
        removeTexture(imageKey)
    }

    /** Clear only the explicitly supplied fixed-detail resources in one render-safe transaction. */
    fun retireAll(resources: Iterable<Pair<Renderable, ImageKey>>) = synchronized(renderMonitor) {
        resources.forEach { (renderable, imageKey) ->
            removeRenderable(renderable)
            removeTexture(imageKey)
        }
    }
}
