package com.shantu.nativeapp.map

import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.suspendCancellableCoroutine
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.resume

/** Bounded admission for viewport work, ranked by the renderer after an SDK traversal. */
internal class NativeViewportTileQueue<K>(
    private val capacity: Int,
    private val maximumRequests: Int = 128,
    private val onWorkChanged: () -> Unit = {},
) : AutoCloseable {
    private class Request<K>(val id: Long, val key: K, val waiter: CancellableContinuation<Permit?>)

    class Permit internal constructor(private val releaseAction: () -> Unit) : AutoCloseable {
        private val released = AtomicBoolean(false)
        override fun close() {
            if (released.compareAndSet(false, true)) releaseAction()
        }
    }

    private val lock = Any()
    private val pending = linkedMapOf<Long, Request<K>>()
    private val active = linkedMapOf<Long, Request<K>>()
    private var nextId = 0L
    private var closed = false

    init { require(capacity > 0 && maximumRequests >= capacity) }

    val pendingCount: Int get() = synchronized(lock) { pending.size }
    val activeCount: Int get() = synchronized(lock) { active.size }
    val registeredCount: Int get() = synchronized(lock) { pending.size + active.size }

    suspend fun acquire(key: K): Permit? = suspendCancellableCoroutine { waiter ->
        val request = synchronized(lock) {
            if (closed || pending.size + active.size >= maximumRequests) return@suspendCancellableCoroutine waiter.resume(null)
            Request(++nextId, key, waiter).also { pending[it.id] = it }
        }
        waiter.invokeOnCancellation { cancel(request.id) }
        onWorkChanged()
    }

    /** Prunes only work not yet admitted; invalidation runs before the canceled waiter resumes. */
    fun removePendingNotIn(visited: Set<K>, onRemoved: (K) -> Unit = {}): List<K> {
        val removed = synchronized(lock) {
            if (closed) return emptyList()
            pending.values.filter { it.key !in visited }.also { stale -> stale.forEach { pending.remove(it.id) } }
        }
        removed.forEach { request ->
            onRemoved(request.key)
            request.waiter.resume(null)
        }
        if (removed.isNotEmpty()) onWorkChanged()
        return removed.map { it.key }
    }

    /** Valid finite nonnegative priorities are eligible; equal priorities retain registration order. */
    fun dispatch(rank: (K) -> Double?): List<K> {
        val snapshot = synchronized(lock) {
            if (closed || active.size >= capacity) return emptyList()
            pending.values.toList()
        }
        val ranked = snapshot.mapNotNull { request ->
            val value = rank(request.key)
            if (value != null && value.isFinite() && value >= 0.0) request to value else null
        }.sortedWith(compareBy<Pair<Request<K>, Double>> { it.second }.thenBy { it.first.id })

        val granted = mutableListOf<Pair<Request<K>, Permit>>()
        synchronized(lock) {
            if (closed) return emptyList()
            for ((request, _) in ranked) {
                if (active.size >= capacity) break
                // Cancellation/pruning may have removed a snapshot entry while rank ran.
                if (pending.remove(request.id) == null) continue
                active[request.id] = request
                granted += request to Permit { release(request.id) }
            }
        }
        granted.forEach { (request, permit) ->
            request.waiter.resume(permit) { _, value, _ -> value.close() }
        }
        if (granted.isNotEmpty()) onWorkChanged()
        return granted.map { it.first.key }
    }

    private fun cancel(id: Long) {
        val changed = synchronized(lock) { pending.remove(id) != null || active.remove(id) != null }
        if (changed) onWorkChanged()
    }

    private fun release(id: Long) {
        val changed = synchronized(lock) { active.remove(id) != null }
        if (changed) onWorkChanged()
    }

    override fun close() {
        val waiting = synchronized(lock) {
            if (closed) return
            closed = true
            val snapshot = pending.values.toList()
            pending.clear()
            active.clear()
            snapshot
        }
        waiting.forEach { it.waiter.resume(null) }
        if (waiting.isNotEmpty()) onWorkChanged()
    }
}
