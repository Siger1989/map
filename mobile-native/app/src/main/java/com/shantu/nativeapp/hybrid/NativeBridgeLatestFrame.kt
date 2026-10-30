package com.shantu.nativeapp.hybrid

import java.util.concurrent.atomic.AtomicReference

/** Single-slot latest-wins handoff for frame snapshots; offers never queue or retain history. */
internal class NativeBridgeLatestFrame<T : Any> {
    private val pending = AtomicReference<T?>(null)

    /** Replaces any not-yet-consumed snapshot. */
    fun offer(value: T) {
        pending.set(value)
    }

    /** Atomically takes and clears the newest pending snapshot. */
    fun takeLatest(): T? = pending.getAndSet(null)

    fun hasPending(): Boolean = pending.get() != null
}
