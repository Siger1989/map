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
    private val lastVisibleBytes = AtomicLong()
    private val lastVisibleBudgetLevel = AtomicLong()
    private val lastPendingForBudget = AtomicLong()

    fun visibleBudget(bytes: Long, level: Int, pendingForBudget: Int) {
        lastVisibleBytes.set(bytes.coerceAtLeast(0L))
        lastVisibleBudgetLevel.set(level.coerceIn(0, NativeContourVisibleBudgetPolicy.MAX_LEVEL).toLong())
        lastPendingForBudget.set(pendingForBudget.coerceAtLeast(0).toLong())
    }

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
        val preparation = NativeContourPreparationPipeline.process.snapshot()
        return mapOf(
            "completedBatches" to completed.get(),
            "maximumLogicalVertices" to maximumLogicalVertices.get(),
            "maximumVboBytes" to maximumLogicalVertices.get() * NativeContourGeometryBudget.FLOATS_PER_LOGICAL_VERTEX * 4L,
            "budgetRejections" to rejected.get(),
            "refinedTiles" to refined.get(),
            "maxLevelRejections" to maxLevelRejected.get(),
            "refinementDeferred" to refinementDeferred.get(),
            "lastRejectedSourceLevel" to lastRejectedLevel.get(),
            "visibleContentBytes" to lastVisibleBytes.get(),
            "visibleBudgetPressureLevel" to lastVisibleBudgetLevel.get(),
            "pendingForBudgetLastDispatch" to lastPendingForBudget.get(),
            "processAssemblyActiveSlots" to processBudget.activeSlots.toLong(),
            "processAssemblyMaximumActiveSlots" to processBudget.maximumActiveSlots.toLong(),
            "processAssemblyWaits" to processBudget.waits,
            "processAssemblyQueuedRequests" to processBudget.queuedRequests.toLong(),
            "preparationActiveSlots" to preparation.preparationActive.toLong(),
            "preparationMaximumActiveSlots" to preparation.preparationMaximumActive.toLong(),
            "preparationQueuedRequests" to preparation.preparationQueued.toLong(),
            "sourceLoadCount" to preparation.sourceLoadCount,
            "sourceLoadElapsedNanos" to preparation.sourceLoadElapsedNanos,
            "sourceLoadMaximumNanos" to preparation.sourceLoadMaximumNanos,
            "sourceNoDataCount" to preparation.sourceNoDataCount,
            "sourceFailureCount" to preparation.sourceFailureCount,
            "assemblyWaitCount" to preparation.assemblyWaitCount,
            "assemblyWaitElapsedNanos" to preparation.assemblyWaitElapsedNanos,
            "assemblyWaitMaximumNanos" to preparation.assemblyWaitMaximumNanos,
            "assemblyCount" to preparation.assemblyCount,
            "assemblyElapsedNanos" to preparation.assemblyElapsedNanos,
            "assemblyMaximumNanos" to preparation.assemblyMaximumNanos,
            "assemblyFailureCount" to preparation.assemblyFailureCount,
            "preparationCancellationCount" to preparation.cancellationCount,
        )
    }
}
