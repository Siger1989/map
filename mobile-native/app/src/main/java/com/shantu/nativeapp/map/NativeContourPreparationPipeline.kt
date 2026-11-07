package com.shantu.nativeapp.map

import java.util.concurrent.atomic.AtomicLong

/**
 * Bounds live contour sample arrays separately from CPU geometry assembly. DEM sampling may suspend
 * on local/network I/O, so it must not occupy the process-wide CPU assembly lane while waiting.
 * A preparation permit remains held through assembly, limiting retained source arrays to capacity.
 */
internal class NativeContourPreparationPipeline(
    private val preparationBudget: NativeContourProcessBudget = NativeContourProcessBudget(capacity = 2),
    private val assemblyBudget: NativeContourProcessBudget = NativeContourProcessBudget.process,
) {
    internal data class Snapshot(
        val preparationActive: Int,
        val preparationMaximumActive: Int,
        val preparationQueued: Int,
        val sourceLoadCount: Long,
        val sourceLoadElapsedNanos: Long,
        val sourceLoadMaximumNanos: Long,
        val sourceNoDataCount: Long,
        val sourceFailureCount: Long,
        val assemblyWaitCount: Long,
        val assemblyWaitElapsedNanos: Long,
        val assemblyWaitMaximumNanos: Long,
        val assemblyCount: Long,
        val assemblyElapsedNanos: Long,
        val assemblyMaximumNanos: Long,
        val assemblyFailureCount: Long,
        val cancellationCount: Long,
    )

    private val sourceLoadCount = AtomicLong()
    private val sourceLoadElapsedNanos = AtomicLong()
    private val sourceLoadMaximumNanos = AtomicLong()
    private val sourceNoDataCount = AtomicLong()
    private val sourceFailureCount = AtomicLong()
    private val assemblyWaitCount = AtomicLong()
    private val assemblyWaitElapsedNanos = AtomicLong()
    private val assemblyWaitMaximumNanos = AtomicLong()
    private val assemblyCount = AtomicLong()
    private val assemblyElapsedNanos = AtomicLong()
    private val assemblyMaximumNanos = AtomicLong()
    private val assemblyFailureCount = AtomicLong()
    private val cancellationCount = AtomicLong()

    /** Returns null when sampling has no usable tile; cancellation and failures propagate. */
    suspend fun <S : Any, T : Any> prepare(
        loadSamples: suspend () -> S?,
        assemble: suspend (S) -> T?,
    ): T? {
        try {
            return preparationBudget.withAssemblyPermit {
                val sourceStarted = System.nanoTime()
                val samples = try {
                    loadSamples().also { if (it == null) sourceNoDataCount.incrementAndGet() }
                } catch (failure: Throwable) {
                    if (failure !is kotlinx.coroutines.CancellationException) sourceFailureCount.incrementAndGet()
                    throw failure
                } finally {
                    record(sourceLoadCount, sourceLoadElapsedNanos, sourceLoadMaximumNanos, System.nanoTime() - sourceStarted)
                } ?: return@withAssemblyPermit null

                val waitStarted = System.nanoTime()
                val assemblyPermit = try {
                    assemblyBudget.acquire()
                } finally {
                    // Counts each acquire attempt, including cancellation while queued.
                    record(assemblyWaitCount, assemblyWaitElapsedNanos, assemblyWaitMaximumNanos, System.nanoTime() - waitStarted)
                }
                try {
                    val assemblyStarted = System.nanoTime()
                    try {
                        assemble(samples)
                    } catch (failure: Throwable) {
                        if (failure !is kotlinx.coroutines.CancellationException) assemblyFailureCount.incrementAndGet()
                        throw failure
                    } finally {
                        record(assemblyCount, assemblyElapsedNanos, assemblyMaximumNanos, System.nanoTime() - assemblyStarted)
                    }
                } finally {
                    assemblyPermit.close()
                }
            }
        } catch (cancelled: kotlinx.coroutines.CancellationException) {
            cancellationCount.incrementAndGet()
            throw cancelled
        }
    }

    internal fun snapshot(): Snapshot {
        val preparation = preparationBudget.snapshot()
        return Snapshot(
            preparation.activeSlots, preparation.maximumActiveSlots, preparation.queuedRequests,
            sourceLoadCount.get(), sourceLoadElapsedNanos.get(), sourceLoadMaximumNanos.get(), sourceNoDataCount.get(), sourceFailureCount.get(),
            assemblyWaitCount.get(), assemblyWaitElapsedNanos.get(), assemblyWaitMaximumNanos.get(),
            assemblyCount.get(), assemblyElapsedNanos.get(), assemblyMaximumNanos.get(), assemblyFailureCount.get(), cancellationCount.get(),
        )
    }

    private fun record(count: AtomicLong, total: AtomicLong, maximum: AtomicLong, elapsedNanos: Long) {
        val elapsed = elapsedNanos.coerceAtLeast(0L)
        count.incrementAndGet()
        total.addAndGet(elapsed)
        maximum.updateAndGet { maxOf(it, elapsed) }
    }

    companion object {
        /** Shared by every contour layer/pane in this process. */
        val process = NativeContourPreparationPipeline(
            preparationBudget = NativeContourProcessBudget(capacity = 2),
            assemblyBudget = NativeContourProcessBudget.process,
        )
    }
}
