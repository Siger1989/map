package com.shantu.nativeapp.hybrid

import android.view.Choreographer
import java.util.IdentityHashMap

/** Schedules one latest-value callback on the next display frame. */
internal interface NativeDrawingFrameScheduler {
    fun postFrame(task: Runnable)
    fun cancelFrame(task: Runnable)
}

internal class NativeChoreographerFrameScheduler(
    private val choreographer: Choreographer = Choreographer.getInstance(),
) : NativeDrawingFrameScheduler {
    private val callbacks = IdentityHashMap<Runnable, Choreographer.FrameCallback>()

    override fun postFrame(task: Runnable) {
        val callback = Choreographer.FrameCallback {
            callbacks.remove(task)
            task.run()
        }
        callbacks[task] = callback
        choreographer.postFrameCallback(callback)
    }

    override fun cancelFrame(task: Runnable) {
        callbacks.remove(task)?.let(choreographer::removeFrameCallback)
    }
}

/** Coalesces only MOVE samples; callers keep start/end/cancel handling synchronous. */
internal class NativeDrawingInputCoalescer<T>(
    private val scheduler: NativeDrawingFrameScheduler,
    private val consume: (T) -> Unit,
) {
    private var pending: T? = null
    private var hasPending = false
    private var scheduled: Runnable? = null

    fun offer(value: T) {
        pending = value
        hasPending = true
        if (scheduled != null) return
        val task = object : Runnable {
            override fun run() {
                if (scheduled !== this) return
                scheduled = null
                deliverPending()
            }
        }
        scheduled = task
        scheduler.postFrame(task)
    }

    /** Deliver the latest MOVE before a synchronous gesture end. */
    fun flush() {
        scheduled?.let(scheduler::cancelFrame)
        scheduled = null
        deliverPending()
    }

    fun discard() {
        scheduled?.let(scheduler::cancelFrame)
        scheduled = null
        pending = null
        hasPending = false
    }

    private fun deliverPending() {
        if (!hasPending) return
        val value = pending
        pending = null
        hasPending = false
        @Suppress("UNCHECKED_CAST")
        consume(value as T)
    }
}

internal data class NativeDrawingPointer(val id: Int, val x: Double, val y: Double)

/** Immutable copy of MotionEvent fields needed after the touch callback returns. */
internal data class NativeDrawingMove(
    val cssX: Double,
    val cssY: Double,
    val cssScale: Double,
    val pointerCount: Int,
    val pointers: List<NativeDrawingPointer>,
    val eventTime: Long,
    val gestureSequence: Long,
)
