package com.shantu.nativeapp.map

import kotlinx.coroutines.CompletableDeferred
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Bounded generation admission, before DEM reads or contour construction. SDK tile jobs only
 * register here; the render thread ranks a complete request batch from its actual projection.
 * A permit is retained through generation AND the completed-result channel until GPU admission.
 */
internal class NativeContourPriorityQueue<K>(
    private val capacity: Int = 2,
    private val maximumRequests: Int = 128,
    private val onWorkChanged: () -> Unit = {},
) : AutoCloseable {
    private class Request<K>(val id: Long, val key: K) {
        val ready = CompletableDeferred<Permit?>()
    }

    class Permit internal constructor(private val release: () -> Unit) : AutoCloseable {
        private val released = AtomicBoolean(false)
        override fun close() { if (released.compareAndSet(false, true)) release() }
    }

    private val lock = Any()
    private val pending = linkedMapOf<Long, Request<K>>()
    private val active = linkedMapOf<Long, Request<K>>()
    private var sequence = 0L
    private var closed = false
    val pendingCount: Int get() = synchronized(lock) { pending.size }
    val activeCount: Int get() = synchronized(lock) { active.size }
    val registeredCount: Int get() = synchronized(lock) { pending.size + active.size }

    init { require(capacity > 0 && maximumRequests >= capacity) }

    /** SDK already deduplicates tile jobs. No work starts until [dispatch] selects this request. */
    suspend fun acquire(key: K): Permit? {
        val request = synchronized(lock) {
            if (closed || pending.size + active.size >= maximumRequests) return null
            Request(++sequence, key).also { pending[it.id] = it }
        }
        onWorkChanged()
        try {
            return request.ready.await()
        } catch (error: Throwable) {
            val removed = synchronized(lock) { pending.remove(request.id) != null || active.remove(request.id) != null }
            if (removed) onWorkChanged()
            throw error
        }
    }

    /**
     * Called only with render-thread projection ranks. New arrivals outside this snapshot wait
     * for the next frame; visible foreground wins, then old off-screen requests can finish so
     * they cannot permanently occupy the SDK's bounded 128-job window after a camera change.
     */
    fun dispatch(rank: (K) -> Double?): List<K> {
        val snapshot = synchronized(lock) {
            if (closed || active.size >= capacity) return emptyList() else pending.values.toList()
        }
        val ranked = snapshot.map { request ->
            request to (rank(request.key)?.takeIf { it.isFinite() && it >= 0.0 } ?: Double.POSITIVE_INFINITY)
        }.sortedWith(compareBy<Pair<Request<K>, Double>> { it.second }.thenBy { it.first.id })
        val selected = mutableListOf<Pair<Request<K>, Permit>>()
        synchronized(lock) {
            if (closed) return emptyList()
            for ((request, _) in ranked) {
                if (active.size >= capacity) break
                if (pending.remove(request.id) == null) continue
                active[request.id] = request
                selected += request to Permit { release(request.id) }
            }
        }
        selected.forEach { (request, permit) -> request.ready.complete(permit) }
        return selected.map { it.first.key }
    }

    private fun release(id: Long) {
        val removed = synchronized(lock) { active.remove(id) != null }
        if (removed) onWorkChanged()
    }

    override fun close() {
        val waiting = synchronized(lock) {
            if (closed) return
            closed = true
            pending.values.toList().also { pending.clear(); active.clear() }
        }
        waiting.forEach { it.ready.complete(null) }
    }
}
