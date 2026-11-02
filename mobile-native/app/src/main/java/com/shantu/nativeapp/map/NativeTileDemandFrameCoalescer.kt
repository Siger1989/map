package com.shantu.nativeapp.map

/** A single latest rendered frame, with urgent work kept separate from camera-only cadence. */
internal class NativeTileDemandFrameCoalescer<T>(private val minimumCameraIntervalMs: Long = 100L) {
    init { require(minimumCameraIntervalMs >= 0L) }

    internal data class Ready<T>(val frame: T, val forceGeneration: Boolean)

    sealed interface Poll<out T> {
        data class Ready<T>(val value: NativeTileDemandFrameCoalescer.Ready<T>) : Poll<T>
        data class Wait(val delayMs: Long) : Poll<Nothing>
        data object AwaitFrame : Poll<Nothing>
        data object Idle : Poll<Nothing>
    }

    private var latest: T? = null
    private var hasLatest = false
    private var sequence = 0L
    private var consumedSequence = 0L
    private var urgent = false
    private var forceGeneration = false
    private var awaitNextFrame = false
    private var lastProcessedAtMs: Long? = null
    private var disposed = false

    @Synchronized
    fun offer(frame: T) {
        if (disposed) return
        latest = frame
        hasLatest = true
        sequence++
        awaitNextFrame = false
    }

    @Synchronized
    fun requestUrgent(forceGeneration: Boolean = false) {
        if (disposed) return
        urgent = true
        this.forceGeneration = this.forceGeneration || forceGeneration
    }

    @Synchronized
    fun latestFrame(): T? = if (hasLatest && !disposed) latest else null

    @Synchronized
    fun hasUrgentWork(): Boolean = urgent && !disposed

    @Synchronized
    fun poll(nowMs: Long): Poll<T> {
        if (disposed) return Poll.Idle
        if (awaitNextFrame) return Poll.AwaitFrame
        if (!hasLatest) return if (urgent) Poll.AwaitFrame else Poll.Idle
        val frame = latest ?: return if (urgent) Poll.AwaitFrame else Poll.Idle
        val hasUnprocessedFrame = sequence != consumedSequence
        if (!urgent && !hasUnprocessedFrame) return Poll.Idle
        val last = lastProcessedAtMs
        if (!urgent && last != null) {
            val remaining = minimumCameraIntervalMs - (nowMs - last).coerceAtLeast(0L)
            if (remaining > 0L) return Poll.Wait(remaining)
        }
        consumedSequence = sequence
        val result = Ready(frame, forceGeneration)
        urgent = false
        forceGeneration = false
        lastProcessedAtMs = nowMs
        return Poll.Ready(result)
    }

    /** Keep urgent state but wait for a newer frame after viewport validation failed. */
    @Synchronized
    fun deferUntilNextFrame(forceGeneration: Boolean = false) {
        if (disposed) return
        if (hasLatest) consumedSequence = sequence
        urgent = true
        this.forceGeneration = this.forceGeneration || forceGeneration
        awaitNextFrame = true
    }

    /** Invalidates frames captured before hiding or replacing the view. */
    @Synchronized
    fun clearPending() {
        latest = null
        hasLatest = false
        consumedSequence = sequence
        urgent = false
        forceGeneration = false
        awaitNextFrame = false
    }

    @Synchronized
    fun dispose() {
        clearPending()
        disposed = true
    }
}
