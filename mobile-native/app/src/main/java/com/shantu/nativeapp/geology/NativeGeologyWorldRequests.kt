package com.shantu.nativeapp.geology

/** Identity-based request token. Equality intentionally remains referential for stale-finally guards. */
internal class NativeGeologyWorldTileRequest(val key: String)

internal data class NativeGeologyWorldWork(
    val cancel: List<NativeGeologyWorldTileRequest>,
    val start: List<NativeGeologyWorldTileRequest>,
)

internal fun nativeGeologyWorldTilesToRequest(
    wanted: Set<String>,
    pending: Set<String>,
    failedUntil: Map<String, Long>,
    nowMs: Long,
): Set<String> = wanted.filterTo(linkedSetOf()) { key ->
    key !in pending && nowMs >= (failedUntil[key] ?: 0L)
}

internal fun <T : Any> nativeGeologySceneMatchesByIdentity(
    displayed: Map<String, T>,
    candidate: Map<String, T>,
    wanted: Set<String>,
): Boolean = displayed.keys == wanted && wanted.all { key -> displayed[key] === candidate[key] }

/** Main-thread coordinator for the current wanted set with a hard active-request ceiling. */
internal class NativeGeologyWorldRequests(private val maxActive: Int = 2) {
    init { require(maxActive > 0) }

    private var wanted = emptySet<String>()
    private val requests = linkedMapOf<String, NativeGeologyWorldTileRequest>()
    private val queued = mutableListOf<NativeGeologyWorldTileRequest>()
    private val active = linkedSetOf<NativeGeologyWorldTileRequest>()

    val activeCount: Int get() = active.size
    val trackedCount: Int get() = requests.size

    fun reconcile(nextWanted: Set<String>, eligibleKeys: Set<String> = nextWanted): NativeGeologyWorldWork {
        wanted = nextWanted.toCollection(linkedSetOf())
        val cancel = requests.values.filter { it.key !in wanted && it in active }
        requests.entries.removeAll { it.key !in wanted }
        queued.removeAll { it.key !in wanted || requests[it.key] !== it }
        wanted.forEach { key ->
            if (key in eligibleKeys && requests[key] == null) {
                val request = NativeGeologyWorldTileRequest(key)
                requests[key] = request
                queued += request
            }
        }
        return NativeGeologyWorldWork(cancel, startAvailable())
    }

    fun isCurrent(request: NativeGeologyWorldTileRequest): Boolean =
        request.key in wanted && requests[request.key] === request

    /** Called in every job's finally; old tokens cannot remove a replacement for the same tile key. */
    fun finish(request: NativeGeologyWorldTileRequest): NativeGeologyWorldWork {
        active.remove(request)
        if (requests[request.key] === request) requests.remove(request.key)
        return NativeGeologyWorldWork(emptyList(), startAvailable())
    }

    /** Active tokens remain counted until their cancelled coroutine reaches finally. */
    fun cancelAll(): List<NativeGeologyWorldTileRequest> {
        requests.clear()
        queued.clear()
        wanted = emptySet()
        return active.toList()
    }

    private fun startAvailable(): List<NativeGeologyWorldTileRequest> {
        val start = mutableListOf<NativeGeologyWorldTileRequest>()
        while (active.size < maxActive && queued.isNotEmpty()) {
            val request = queued.removeAt(0)
            if (requests[request.key] !== request || request.key !in wanted) continue
            active += request
            start += request
        }
        return start
    }
}
