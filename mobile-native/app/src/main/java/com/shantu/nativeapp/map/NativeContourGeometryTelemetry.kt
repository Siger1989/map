package com.shantu.nativeapp.map

import java.util.concurrent.atomic.AtomicLong

/** Numeric-only QA counters: no source URLs, credentials, or geographic coordinates. */
internal object NativeContourGeometryTelemetry {
    private val completed = AtomicLong()
    private val maximumLogicalVertices = AtomicLong()
    private val rejected = AtomicLong()
    private val refined = AtomicLong()
    private val maxLevelRejected = AtomicLong()
    private val refinementDeferred = AtomicLong()
    private val lastRejectedLevel = AtomicLong(-1)

    fun accepted(logicalVertices: Long) {
        completed.incrementAndGet()
        maximumLogicalVertices.updateAndGet { maxOf(it, logicalVertices) }
    }

    fun rejected(z: Int, didRefine: Boolean, atMaximumLevel: Boolean) {
        rejected.incrementAndGet()
        lastRejectedLevel.set(z.toLong())
        when {
            didRefine -> refined.incrementAndGet()
            atMaximumLevel -> maxLevelRejected.incrementAndGet()
            else -> refinementDeferred.incrementAndGet()
        }
    }

    fun snapshot(): Map<String, Long> {
        val processBudget = NativeContourProcessBudget.process.snapshot()
        return mapOf(
            "completedBatches" to completed.get(),
            "maximumLogicalVertices" to maximumLogicalVertices.get(),
            "maximumVboBytes" to maximumLogicalVertices.get() * NativeContourGeometryBudget.FLOATS_PER_LOGICAL_VERTEX * 4L,
            "budgetRejections" to rejected.get(),
            "refinedTiles" to refined.get(),
            "maxLevelRejections" to maxLevelRejected.get(),
            "refinementDeferred" to refinementDeferred.get(),
            "lastRejectedSourceLevel" to lastRejectedLevel.get(),
            "processAssemblyActiveSlots" to processBudget.activeSlots.toLong(),
            "processAssemblyMaximumActiveSlots" to processBudget.maximumActiveSlots.toLong(),
            "processAssemblyWaits" to processBudget.waits,
            "processAssemblyQueuedRequests" to processBudget.queuedRequests.toLong(),
        )
    }
}
