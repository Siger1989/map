package com.shantu.nativeapp.map

import android.content.Context
import earth.worldwind.render.RenderResourceCache
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Shares one WorldWind render cache across concurrently mounted map windows.
 *
 * The SDK cache is also the EGLContextFactory: WorldWind shares the EGL contexts created by this
 * instance and serializes GL frame draws on the cache monitor. A zero lease count only drops this
 * pool's reference. The old cache remains owned by its WorldWindows until their EGL contexts are
 * destroyed; the SDK then clears resources when its last context goes away. A later acquire gets a
 * new cache instance, so delayed destruction of an old window cannot clear the new generation.
 */
internal object NativeRenderResourceCachePool {
    private val leases = NativeSharedLeasePool<Long, RenderResourceCache>()

    fun acquire(context: Context, capacityBytes: Long): NativeSharedLeasePool.Lease<RenderResourceCache> {
        require(capacityBytes > 0L)
        val appContext = context.applicationContext
        return leases.acquire(capacityBytes) {
            RenderResourceCache(appContext, capacity = capacityBytes)
        }
    }
}

/** Small, synchronized lease state so cache ownership can be tested without Android or EGL. */
internal class NativeSharedLeasePool<K : Any, T : Any> {
    private class Entry<K, T>(val key: K, val value: T, var references: Int = 0)

    private var current: Entry<K, T>? = null

    @Synchronized
    fun acquire(key: K, create: () -> T): Lease<T> {
        val entry = current?.also {
            require(it.key == key) { "Shared resource key changed while leases are active" }
        } ?: Entry(key, create()).also { current = it }
        entry.references++
        return Lease(entry.value) { release(entry) }
    }

    private fun release(entry: Entry<K, T>) = synchronized(this) {
        // Ignore a late release from an older generation; it must never evict a newer resource.
        if (current !== entry) return@synchronized
        check(entry.references > 0) { "Shared resource lease released more than once" }
        entry.references--
        if (entry.references == 0) current = null
    }

    internal class Lease<T : Any>(val resource: T, private val onClose: () -> Unit) : AutoCloseable {
        private val closed = AtomicBoolean(false)
        override fun close() {
            if (closed.compareAndSet(false, true)) onClose()
        }
    }
}
