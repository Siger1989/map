package com.shantu.nativeapp.map

/** Pure bounded working-set policy for fixed-level raster tiles. */
internal class NativeRasterDetailTileState(private val maxResidentBytes: Long) {
    data class Entry(val key: String, val bytes: Long, val stamp: Long)
    data class Diff(val request: List<String>, val retire: List<String>, val keep: List<String>)

    private val resident = LinkedHashMap<String, Entry>(16, .75f, true)
    private val pending = mutableSetOf<String>()
    private var visible = emptySet<String>()
    private var clock = 0L
    private var residentBytes = 0L

    fun reconcile(visible: Set<String>, fetchAllowed: Boolean): Diff {
        this.visible = visible
        pending.retainAll(visible)
        val keep = visible.mapNotNull { resident[it]?.key }
        if (!fetchAllowed) return Diff(emptyList(), emptyList(), keep)
        val request = visible.filter { it !in resident && pending.add(it) }
        return Diff(request, emptyList(), keep)
    }

    fun ready(key: String, bytes: Long): List<String> {
        pending.remove(key)
        require(bytes >= 0)
        if (bytes > maxResidentBytes) return listOf(key)
        resident.remove(key)?.let { residentBytes -= it.bytes }
        resident[key] = Entry(key, bytes, ++clock)
        residentBytes += bytes
        val evicted = mutableListOf<String>()
        while (residentBytes > maxResidentBytes && resident.isNotEmpty()) {
            val oldest = resident.values.firstOrNull { it.key !in visible } ?: resident.values.first()
            remove(oldest.key); evicted += oldest.key
        }
        return evicted
    }

    fun failed(key: String) { pending.remove(key) }
    fun cancelPending() { pending.clear() }
    fun clear() { resident.clear();pending.clear();visible=emptySet();residentBytes=0L }
    fun contains(key: String) = resident.containsKey(key)
    fun residentBytes() = residentBytes
    fun pendingKeys() = pending.toSet()

    private fun remove(key: String) { resident.remove(key)?.let { residentBytes -= it.bytes } }
}
