package com.shantu.nativeapp.map

import java.util.concurrent.atomic.AtomicBoolean

/** One urgent wake per deferred idle planner, rather than one per incoming tile. */
internal class NativeTilePriorityIdleGate {
    private val deferred = AtomicBoolean(false)

    fun shouldDefer(eligible: Boolean, hasWork: () -> Boolean): Boolean {
        if (!eligible) {
            deferred.set(false)
            return false
        }
        // Arm before checking work: an admission racing this check either consumes the wake
        // or is observed here. There is no check-then-arm gap that can lose the first request.
        deferred.set(true)
        if (!hasWork()) return true
        deferred.set(false)
        return false
    }

    fun consumeWake(): Boolean = deferred.compareAndSet(true, false)
}
