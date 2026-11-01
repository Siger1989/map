package com.shantu.nativeapp.map

/** Bounded lifetime state for retrying an oversized contour tile at finer source levels. */
internal class NativeContourRefinementState<K>(private val capacity: Int = 1024) {
    private val lock = Any()
    /** Key -> most recent render frame in which this forced parent was visible or requested. */
    private val lastSeenFrame = LinkedHashMap<K, Long>()
    private var frame = 0L

    init { require(capacity > 0) }

    fun advanceFrame() = synchronized(lock) {
        if (frame < Long.MAX_VALUE) frame++
    }

    /** Returns true for a forced parent and pins it for the current frame. */
    fun shouldRefine(key: K): Boolean = synchronized(lock) {
        if (!lastSeenFrame.containsKey(key)) return@synchronized false
        lastSeenFrame[key] = frame
        true
    }

    /**
     * Add a forced parent unless the owning layer has closed. At capacity, only keys that have
     * not been visible for more than two complete frames are safe to evict.
     */
    fun requestRefinement(key: K, allowed: () -> Boolean = { true }): Boolean = synchronized(lock) {
        if (!allowed()) return@synchronized false
        if (lastSeenFrame.containsKey(key)) {
            lastSeenFrame[key] = frame
            return@synchronized true
        }
        if (lastSeenFrame.size >= capacity) {
            val inactiveBefore = frame - 2
            val stale = lastSeenFrame.entries
                .asSequence()
                .filter { it.value < inactiveBefore }
                .minByOrNull { it.value }
                ?: return@synchronized false
            lastSeenFrame.remove(stale.key)
        }
        lastSeenFrame[key] = frame
        true
    }

    fun clear() = synchronized(lock) { lastSeenFrame.clear() }

    val size: Int get() = synchronized(lock) { lastSeenFrame.size }
}
