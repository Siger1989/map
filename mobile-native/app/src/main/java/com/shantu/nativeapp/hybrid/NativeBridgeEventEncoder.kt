package com.shantu.nativeapp.hybrid

import org.json.JSONObject
import java.util.concurrent.Executor
import java.util.concurrent.Executors

/** Encodes immutable bridge-event snapshots off the UI thread with one latest-only slot per channel. */
internal class NativeBridgeEventEncoder(
    private val onEncoded: (channel: String, token: Long, encoded: String) -> Unit,
    private val executor: Executor = sharedExecutor,
) : AutoCloseable {
    private data class Work(val token: Long, val message: JSONObject)
    private class ChannelState {
        var latestToken = Long.MIN_VALUE
        var pending: Work? = null
        var scheduled = false
    }

    private val lock = Any()
    private val channels = LinkedHashMap<String, ChannelState>()
    private var closed = false

    /** The caller must not mutate [message] after submission. Replaces queued work for this channel. */
    fun submit(channel: String, token: Long, message: JSONObject): Boolean {
        require(channel.isNotBlank())
        val state: ChannelState
        val shouldSchedule: Boolean
        synchronized(lock) {
            if (closed) return false
            state = channels.getOrPut(channel) { ChannelState() }
            state.latestToken = token
            state.pending = Work(token, message)
            shouldSchedule = !state.scheduled
            if (shouldSchedule) state.scheduled = true
        }
        return !shouldSchedule || schedule(channel, state)
    }

    private fun schedule(channel: String, state: ChannelState): Boolean = try {
        executor.execute { encodeOne(channel, state) }
        true
    } catch (_: RuntimeException) {
        synchronized(lock) {
            if (channels[channel] === state) {
                state.pending = null
                state.scheduled = false
            }
        }
        false
    }

    private fun encodeOne(channel: String, state: ChannelState) {
        val work = synchronized(lock) {
            if (closed || channels[channel] !== state) {
                state.pending = null
                state.scheduled = false
                null
            } else state.pending.also { state.pending = null }
        } ?: return

        val encoded = try { work.message.toString() } catch (_: RuntimeException) { null }
        var reschedule = false
        synchronized(lock) {
            if (!closed && channels[channel] === state && state.latestToken == work.token && encoded != null) {
                // The callback is expected to enqueue onto the owner thread; holding the lock makes
                // token validation atomic with delivery, so a concurrent newer submit cannot race it.
                runCatching { onEncoded(channel, work.token, encoded) }
            }
            if (closed || channels[channel] !== state) {
                state.pending = null
                state.scheduled = false
            } else if (state.pending != null) {
                reschedule = true // Keep scheduled=true while the next bounded item is enqueued.
            } else state.scheduled = false
        }
        if (reschedule) schedule(channel, state)
    }

    override fun close() {
        synchronized(lock) {
            closed = true
            channels.values.forEach { it.pending = null; it.scheduled = false }
            channels.clear()
        }
    }

    companion object {
        private val sharedExecutor: Executor = Executors.newSingleThreadExecutor { runnable ->
            Thread(runnable, "native-bridge-event-encoder").apply { isDaemon = true }
        }
    }
}
