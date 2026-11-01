package com.shantu.nativeapp.map

import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Semaphore
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/**
 * Process-scoped admission for contour DEM sampling and CPU geometry assembly only.
 * The permit releases before SDK content admission; per-layer prepared-result caps remain separate.
 * Semaphore.acquire is suspending and FIFO; a waiting pane never blocks the render thread.
 */
internal class NativeContourProcessBudget(private val capacity: Int = 1) {
    internal data class Snapshot(
        val activeSlots: Int,
        val maximumActiveSlots: Int,
        val waits: Long,
        val queuedRequests: Int,
    )

    internal class Permit internal constructor(private val release: () -> Unit) : AutoCloseable {
        private val closed = AtomicBoolean(false)
        override fun close() {
            if (closed.compareAndSet(false, true)) release()
        }
    }

    private val semaphore = Semaphore(capacity)
    private val active = AtomicInteger()
    private val maximumActive = AtomicInteger()
    private val waitCount = AtomicLong()
    private val queued = AtomicInteger()

    init { require(capacity > 0) }

    suspend fun acquire(): Permit {
        currentCoroutineContext().ensureActive()
        if (!semaphore.tryAcquire()) {
            waitCount.incrementAndGet()
            queued.incrementAndGet()
            try {
                semaphore.acquire()
            } finally {
                queued.decrementAndGet()
            }
        }
        val nowActive = active.incrementAndGet()
        maximumActive.updateAndGet { maxOf(it, nowActive) }
        return Permit {
            active.decrementAndGet()
            semaphore.release()
        }
    }

    /** Owns only DEM sampling and CPU geometry construction, not the returned SDK result. */
    suspend fun <T> withAssemblyPermit(block: suspend () -> T): T {
        val permit = acquire()
        return try { block() } finally { permit.close() }
    }

    fun snapshot() = Snapshot(active.get(), maximumActive.get(), waitCount.get(), queued.get())

    companion object {
        /** All contour layers in all map panes share this one process-wide generation lane. */
        val process = NativeContourProcessBudget(capacity = 1)
    }
}
