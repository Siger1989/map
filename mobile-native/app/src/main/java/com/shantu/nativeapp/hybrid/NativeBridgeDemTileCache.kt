package com.shantu.nativeapp.hybrid

/** Reuse immutable bridge grids across overlapping viewports without retaining an unbounded pan. */
internal class NativeBridgeDemTileCache<T : Any>(
    private val capacity: Int = 64,
    private val lifetimeMillis: Long = 30_000L,
) {
    private data class Entry<T>(val value: T, val savedAt: Long)
    private val entries = LinkedHashMap<String, Entry<T>>(16, .75f, true)
    init { require(capacity > 0 && lifetimeMillis > 0) }

    @Synchronized fun get(key: String, nowMillis: Long): T? {
        val entry = entries[key] ?: return null
        val age = nowMillis - entry.savedAt
        if (age < 0 || age >= lifetimeMillis) { entries.remove(key); return null }
        return entry.value
    }

    @Synchronized fun put(key: String, value: T, nowMillis: Long) {
        entries[key] = Entry(value, nowMillis)
        while (entries.size > capacity) entries.remove(entries.keys.first())
    }
}
