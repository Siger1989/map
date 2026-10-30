package com.shantu.nativeapp.map

import java.util.concurrent.atomic.LongAdder

/** URL/source-free stage counters. Fixed buckets and process-lifetime aggregates keep this bounded. */
internal object NativeTileStageTelemetry {
    private val decodeCount = LongAdder()
    private val decodeNanos = LongAdder()
    private val decodeFailures = LongAdder()
    private val decodeBuckets = LongArray(6)
    private val renderedFrameCount = LongAdder()

    fun <T> measureDecode(block: () -> T): T {
        val started = System.nanoTime()
        var failed = false
        try {
            val result = block()
            failed = result == null
            return result
        } catch (error: Throwable) { failed = true; throw error }
        finally { recordDecode(System.nanoTime() - started, failed) }
    }

    fun recordDecode(elapsedNanos: Long, failed: Boolean = false) {
        val elapsed = elapsedNanos.coerceAtLeast(0L)
        decodeCount.increment(); decodeNanos.add(elapsed)
        if (failed) decodeFailures.increment()
        val ms = elapsed / 1_000_000
        val bucket = when { ms <= 2 -> 0; ms <= 5 -> 1; ms <= 10 -> 2; ms <= 25 -> 3; ms <= 100 -> 4; else -> 5 }
        synchronized(decodeBuckets) { decodeBuckets[bucket]++ }
    }

    /** This observes completed WorldWind frames, not a per-tile draw callback. */
    fun recordRenderedFrame() { renderedFrameCount.increment() }

    fun snapshot() = NativeTileStageSnapshot(
        decodedImages = decodeCount.sum(), decodedNanos = decodeNanos.sum(), decodeFailures = decodeFailures.sum(),
        decodeDurationBuckets = synchronized(decodeBuckets) { decodeBuckets.toList() },
        renderedFrames = renderedFrameCount.sum(),
        perTileDrawCount = null,
    )
}

internal data class NativeTileStageSnapshot(
    val decodedImages: Long,
    val decodedNanos: Long,
    val decodeFailures: Long,
    /** <=2ms, 2-5ms, 5-10ms, 10-25ms, 25-100ms, >100ms */
    val decodeDurationBuckets: List<Long>,
    val renderedFrames: Long,
    /** WorldWind 2.1.1 has no public callback proving a specific tile was drawn. */
    val perTileDrawCount: Long?,
)
