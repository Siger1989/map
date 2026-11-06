package com.shantu.nativeapp.map

import java.util.concurrent.atomic.AtomicLong

/** Per-map numeric proof only; no controller, frame, context, tile address or source URL. */
internal class NativeRasterFeatherDiagnostics {
    private val preparedFrames = AtomicLong()
    private val drawnFrames = AtomicLong()
    private val drawnSequence = AtomicLong()
    private val leaves = AtomicLong()
    private val lodBoundaries = AtomicLong()
    private val lodFeatherChildren = AtomicLong()
    private val fixedFeatherChildren = AtomicLong()
    private val noParentChildren = AtomicLong()
    private val queuedPairs = AtomicLong()
    private val drawnPairs = AtomicLong()
    private val totalQueuedPairs = AtomicLong()
    private val totalDrawnPairs = AtomicLong()

    fun beginFrame(): Long {
        leaves.set(0); lodBoundaries.set(0); lodFeatherChildren.set(0); fixedFeatherChildren.set(0)
        noParentChildren.set(0); queuedPairs.set(0)
        return preparedFrames.incrementAndGet()
    }

    fun sequence(): Long = preparedFrames.get()
    fun recordLeaves(count: Int, boundaryCount: Int, featherCount: Int, noParentCount: Int) {
        leaves.set(count.toLong()); lodBoundaries.set(boundaryCount.toLong())
        lodFeatherChildren.set(featherCount.toLong()); noParentChildren.addAndGet(noParentCount.toLong())
    }
    fun recordFixedChild(hasParent: Boolean) {
        if (hasParent) fixedFeatherChildren.incrementAndGet() else noParentChildren.incrementAndGet()
    }
    fun queuedPair() { queuedPairs.incrementAndGet(); totalQueuedPairs.incrementAndGet() }
    fun submitted(sequence: Long, pair: Boolean) {
        while (true) {
            val previous = drawnSequence.get()
            if (sequence <= previous) break
            if (drawnSequence.compareAndSet(previous, sequence)) {
                drawnFrames.incrementAndGet(); drawnPairs.set(0); break
            }
        }
        if (pair) {
            totalDrawnPairs.incrementAndGet()
            if (drawnSequence.get() == sequence) drawnPairs.incrementAndGet()
        }
    }
    fun clearCurrent() {
        leaves.set(0); lodBoundaries.set(0); lodFeatherChildren.set(0); fixedFeatherChildren.set(0)
        noParentChildren.set(0); queuedPairs.set(0)
    }
    fun snapshotCounters(): Map<String, Long> = linkedMapOf(
        "preparedFrames" to preparedFrames.get(), "drawnFrames" to drawnFrames.get(),
        "preparedSequence" to preparedFrames.get(), "drawnSequence" to drawnSequence.get(),
        "visibleLeaves" to leaves.get(), "lodBoundaryChildren" to lodBoundaries.get(),
        "lodFeatherChildren" to lodFeatherChildren.get(), "fixedFeatherChildren" to fixedFeatherChildren.get(),
        "missingParentChildren" to noParentChildren.get(), "queuedPairs" to queuedPairs.get(),
        "drawnPairs" to drawnPairs.get(), "totalQueuedPairs" to totalQueuedPairs.get(),
        "totalDrawnPairs" to totalDrawnPairs.get(),
    )
}
