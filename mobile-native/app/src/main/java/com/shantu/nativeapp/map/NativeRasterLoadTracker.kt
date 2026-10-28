package com.shantu.nativeapp.map

import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

/** Stable callbacks plus per-source-generation counters for this controller's raster loads. */
internal data class NativeRasterLoadCallbacks(
    val onBitmapDecoded: () -> Unit,
    val onLoadStarted: () -> Unit,
    val onLoadFinished: () -> Unit,
)

/**
 * Tracks work owned by one map/source generation. Callbacks captured by retired layers are
 * ignored after reset, so an old request can neither satisfy nor block the newly selected source.
 */
internal class NativeRasterLoadTracker {
    private class Generation(val id: Long) {
        val decodedTiles = AtomicLong()
        val pendingLoads = AtomicInteger()
        lateinit var callbacks: NativeRasterLoadCallbacks
    }

    private val current = AtomicReference(createGeneration(0L))

    fun reset(): Long {
        val next = synchronized(this) {
            Generation(current.get().id + 1L).also { generation ->
                generation.callbacks = callbacksFor(generation)
                current.set(generation)
            }
        }
        return next.id
    }

    fun callbacks(generationId: Long): NativeRasterLoadCallbacks {
        val generation = current.get()
        check(generation.id == generationId) { "Raster source generation is no longer current" }
        return generation.callbacks
    }

    fun decodedTiles(): Long = current.get().decodedTiles.get()

    fun pendingLoads(): Int = current.get().pendingLoads.get().coerceAtLeast(0)

    private fun createGeneration(id: Long): Generation = Generation(id).also { generation ->
        generation.callbacks = callbacksFor(generation)
    }

    private fun callbacksFor(generation: Generation) = NativeRasterLoadCallbacks(
        onBitmapDecoded = {
            if (current.get() === generation) generation.decodedTiles.incrementAndGet()
        },
        onLoadStarted = {
            if (current.get() === generation) generation.pendingLoads.incrementAndGet()
        },
        onLoadFinished = {
            if (current.get() === generation) decrementIfPositive(generation.pendingLoads)
        },
    )

    private fun decrementIfPositive(value: AtomicInteger) {
        while (true) {
            val currentValue = value.get()
            if (currentValue <= 0) return
            if (value.compareAndSet(currentValue, currentValue - 1)) return
        }
    }
}
