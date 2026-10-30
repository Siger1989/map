package com.shantu.nativeapp.hybrid

/** Bounds main-thread frame metadata captures while preserving one trailing dirty sample. */
internal class NativeBridgeFrameCaptureGate {
    private var dirtyRevision = 0L
    private var capturedRevision = 0L
    private var lastAttemptAt = Long.MIN_VALUE

    fun markDirty(): Long = ++dirtyRevision

    fun captureIfDue(nowMillis: Long, intervalMillis: Long): Long? {
        if (!isDue(nowMillis, intervalMillis)) return null
        return markCaptured(nowMillis)
    }

    fun isDue(nowMillis: Long, intervalMillis: Long): Boolean = hasPending() &&
        (lastAttemptAt == Long.MIN_VALUE || nowMillis - lastAttemptAt >= intervalMillis)

    /** Throttle failed viewport attempts too, without acknowledging their dirty revision. */
    fun markAttempt(nowMillis: Long) { lastAttemptAt = nowMillis }

    /** Called when the main-thread factory actually snapshots metadata for a RenderContext. */
    fun markCaptured(nowMillis: Long): Long {
        capturedRevision = dirtyRevision
        lastAttemptAt = nowMillis
        return capturedRevision
    }

    fun hasPending(): Boolean = dirtyRevision != capturedRevision

    fun delayUntilDue(nowMillis: Long, intervalMillis: Long): Long =
        if (lastAttemptAt == Long.MIN_VALUE) 0L else (intervalMillis - (nowMillis - lastAttemptAt)).coerceAtLeast(0L)
}
