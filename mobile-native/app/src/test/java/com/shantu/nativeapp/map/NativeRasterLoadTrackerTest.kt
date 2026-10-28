package com.shantu.nativeapp.map

import org.junit.Assert.assertEquals
import org.junit.Test

class NativeRasterLoadTrackerTest {
    @Test
    fun `current source counts queued loads until their terminal callback`() {
        val tracker = NativeRasterLoadTracker()
        val callbacks = tracker.callbacks(0L)

        callbacks.onLoadStarted()
        callbacks.onLoadStarted()
        assertEquals(2, tracker.pendingLoads())
        callbacks.onBitmapDecoded()
        assertEquals(1L, tracker.decodedTiles())
        callbacks.onLoadFinished()
        assertEquals(1, tracker.pendingLoads())
        callbacks.onLoadFinished()
        callbacks.onLoadFinished() // defensive: duplicate finish cannot make the count negative
        assertEquals(0, tracker.pendingLoads())
    }

    @Test
    fun `retired source callbacks cannot change current generation evidence`() {
        val tracker = NativeRasterLoadTracker()
        val old = tracker.callbacks(0L)
        old.onLoadStarted()
        assertEquals(1, tracker.pendingLoads())

        val generation = tracker.reset()
        val current = tracker.callbacks(generation)
        assertEquals(0, tracker.pendingLoads())
        old.onBitmapDecoded()
        old.onLoadFinished()
        assertEquals(0L, tracker.decodedTiles())
        assertEquals(0, tracker.pendingLoads())

        current.onLoadStarted()
        assertEquals(1, tracker.pendingLoads())
        current.onLoadFinished()
        assertEquals(0, tracker.pendingLoads())
    }

    @Test
    fun `callbacks are stable within one generation and distinct after reset`() {
        val tracker = NativeRasterLoadTracker()
        val first = tracker.callbacks(0L)
        assertEquals(first, tracker.callbacks(0L))
        val nextGeneration = tracker.reset()
        val second = tracker.callbacks(nextGeneration)
        org.junit.Assert.assertNotEquals(first, second)
        org.junit.Assert.assertNotEquals(first.onLoadStarted, second.onLoadStarted)
    }
}
