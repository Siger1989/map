package com.shantu.nativeapp.map

import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicLongArray

/** Fixed-size wall-time counters for bridge entry and WorldWind frame stages. */
internal class NativeMapFrameCostTelemetry {
    enum class HostCommand(val fieldPrefix: String, private val index: Int) {
        CREATE("create", 0),
        MAP_VIEWPORT("mapViewport", 1),
        RENDER_STATE("renderState", 2);

        internal val counterIndex: Int get() = index
    }

    private val hostCommandCounters = AtomicLongArray(HostCommand.values().size * COUNTERS_PER_STAGE)
    private val sdkRenderPreparation = StageCounters()
    private val sdkDrawSubmission = StageCounters()
    private val firstActualDrawAfterCreate = AtomicLong(UNRECORDED)

    fun recordHostCommand(command: HostCommand, elapsedNanos: Long) {
        val start = command.counterIndex * COUNTERS_PER_STAGE
        record(hostCommandCounters, start, elapsedNanos)
    }

    fun recordSdkRenderPreparation(elapsedNanos: Long) = sdkRenderPreparation.record(elapsedNanos)

    fun recordSdkDrawSubmission(elapsedNanos: Long) = sdkDrawSubmission.record(elapsedNanos)

    fun recordFirstActualDrawAfterCreate(elapsedNanos: Long) {
        firstActualDrawAfterCreate.compareAndSet(UNRECORDED, elapsedNanos.coerceAtLeast(0L))
    }

    /** Numeric fields only; constructed on the explicit diagnostics path, never per frame. */
    fun hostCommandSnapshot(): Map<String, Long> = buildMap<String, Long> {
        HostCommand.values().forEach { command ->
            val start = command.counterIndex * COUNTERS_PER_STAGE
            put("${command.fieldPrefix}Count", hostCommandCounters.get(start + COUNT_OFFSET))
            put("${command.fieldPrefix}TotalNanos", hostCommandCounters.get(start + TOTAL_OFFSET))
            put("${command.fieldPrefix}MaxNanos", hostCommandCounters.get(start + MAX_OFFSET))
        }
    }

    /** Numeric fields only; constructed on the explicit diagnostics path, never per frame. */
    fun frameSnapshot(): Map<String, Long?> = buildMap<String, Long?> {
        put("sdkRenderPreparationCount", sdkRenderPreparation.count.get())
        put("sdkRenderPreparationTotalNanos", sdkRenderPreparation.totalNanos.get())
        put("sdkRenderPreparationMaxNanos", sdkRenderPreparation.maxNanos.get())
        put("sdkDrawSubmissionCount", sdkDrawSubmission.count.get())
        put("sdkDrawSubmissionTotalNanos", sdkDrawSubmission.totalNanos.get())
        put("sdkDrawSubmissionMaxNanos", sdkDrawSubmission.maxNanos.get())
        put("firstActualDrawAfterCreateNanos", firstActualDrawAfterCreate.get().takeUnless { it == UNRECORDED })
    }

    private class StageCounters {
        val count = AtomicLong(0L)
        val totalNanos = AtomicLong(0L)
        val maxNanos = AtomicLong(0L)

        fun record(elapsedNanos: Long) {
            val value = elapsedNanos.coerceAtLeast(0L)
            count.incrementAndGet()
            totalNanos.addAndGet(value)
            updateMax(maxNanos, value)
        }
    }

    private companion object {
        const val COUNTERS_PER_STAGE = 3
        const val COUNT_OFFSET = 0
        const val TOTAL_OFFSET = 1
        const val MAX_OFFSET = 2
        const val UNRECORDED = -1L

        fun record(counters: AtomicLongArray, start: Int, elapsedNanos: Long) {
            val value = elapsedNanos.coerceAtLeast(0L)
            counters.incrementAndGet(start + COUNT_OFFSET)
            counters.addAndGet(start + TOTAL_OFFSET, value)
            updateMax(counters, start + MAX_OFFSET, value)
        }

        fun updateMax(counter: AtomicLongArray, index: Int, value: Long) {
            while (true) {
                val previous = counter.get(index)
                if (value <= previous || counter.compareAndSet(index, previous, value)) return
            }
        }

        fun updateMax(counter: AtomicLong, value: Long) {
            while (true) {
                val previous = counter.get()
                if (value <= previous || counter.compareAndSet(previous, value)) return
            }
        }
    }
}
