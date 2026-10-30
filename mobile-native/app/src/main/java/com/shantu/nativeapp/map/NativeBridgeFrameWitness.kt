package com.shantu.nativeapp.map

import earth.worldwind.draw.DrawContext
import earth.worldwind.draw.Drawable
import java.util.concurrent.atomic.AtomicReference

/** A render-prepared immutable payload bound to the GL frame that consumes it. */
internal class NativeBridgeFrameWitness<T : Any>(
    val metadata: T,
    private val onDraw: (T, DoubleArray, Int, Int) -> Unit,
) {
    fun draw(modelviewProjection: DoubleArray, width: Int, height: Int) =
        onDraw(metadata, modelviewProjection, width, height)
}

/** Single-slot handoff; once taken, later captures cannot mutate an already-bound frame. */
internal class NativeBridgeFrameWitnessQueue<T : Any> {
    private val pending = AtomicReference<(() -> T?)?>(null)

    fun offer(factory: () -> T?) { pending.set(factory) }
    /** Invoke the one-shot factory at the owning RenderContext preparation point. */
    fun take(): T? = pending.getAndSet(null)?.invoke()
    fun clear() { pending.set(null) }
    fun hasPending(): Boolean = pending.get() != null
}

/** No-op drawable whose callback receives the DrawContext of the frame that owns it. */
internal class NativeBridgeFrameWitnessDrawable(
    private val onDrawFrame: (DrawContext) -> Unit,
) : Drawable {
    override fun draw(dc: DrawContext) = onDrawFrame(dc)
    override fun recycle() = Unit
}
