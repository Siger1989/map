package com.shantu.nativeapp.map

import android.view.MotionEvent
import android.view.ViewConfiguration
import earth.worldwind.BasicWorldWindowController
import earth.worldwind.WorldWindow
import earth.worldwind.gesture.GestureRecognizer
import earth.worldwind.gesture.GestureState
import earth.worldwind.gesture.PanRecognizer
import earth.worldwind.gesture.PinchRecognizer
import earth.worldwind.gesture.RotationRecognizer

/** Only editor-owned two-finger navigation uses this profile; ordinary browsing keeps SDK defaults. */
internal class NativeEditingWorldWindowController(worldWindow: WorldWindow) : BasicWorldWindowController(worldWindow) {
    private val pan = panRecognizer as PanRecognizer
    private val pinch = pinchRecognizer as PinchRecognizer
    private val rotation = rotationRecognizer as RotationRecognizer
    private val ordinaryPanDistance = pan.interpretDistance
    private val ordinaryPinchDistance = pinch.interpretDistance
    private val ordinaryRotationAngle = rotation.interpretAngle
    private val editorDistance = editingInterpretDistancePx(
        worldWindow.resources.displayMetrics.density,
        ViewConfiguration.get(worldWindow.context).scaledTouchSlop.toFloat(),
    )
    private var editingNavigation = false
    private val panStart = NativeEditorPanStart()

    fun setEditingGestureNavigation(enabled: Boolean) {
        if (editingNavigation == enabled) return
        editingNavigation = enabled
        panStart.reset()
        pan.interpretDistance = if (enabled) editorDistance else ordinaryPanDistance
        pinch.interpretDistance = if (enabled) editorDistance else ordinaryPinchDistance
        rotation.interpretAngle = if (enabled) 4f else ordinaryRotationAngle
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (editingNavigation) {
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> panStart.down(event.x.toDouble(), event.y.toDouble())
                MotionEvent.ACTION_MOVE -> if (event.pointerCount == 1) panStart.move(event.x.toDouble(), event.y.toDouble())
                MotionEvent.ACTION_POINTER_DOWN -> panStart.reset()
            }
        }
        return try { super.onTouchEvent(event) } finally {
            if (event.actionMasked == MotionEvent.ACTION_UP || event.actionMasked == MotionEvent.ACTION_CANCEL) panStart.reset()
        }
    }

    override fun handlePan(recognizer: GestureRecognizer) {
        super.handlePan(recognizer)
        if (!editingNavigation || recognizer.state != GestureState.BEGAN) return
        // PanRecognizer zeros translation at BEGAN. Restore only the actual input displacement
        // since its DOWN, once, rather than inventing a large synthetic move to cross its slop.
        val delta = panStart.consume() ?: return
        if (engine.globe.is2D) {
            applyPanDelta2D(delta.first, delta.second)
            // The SDK's later 2D CHANGED events are absolute from beginLookAtPoint.
            beginLookAt.copy(lookAt)
            captureBeginLookAtPoint()
        } else applyPanDelta3D(delta.first, delta.second)
    }
}

internal fun editingInterpretDistancePx(density: Float, touchSlopPx: Float): Float {
    val scale = density.takeIf { it.isFinite() && it > 0f } ?: 1f
    val slop = touchSlopPx.takeIf { it.isFinite() && it > 0f } ?: 8f * scale
    return slop.coerceIn(2f * scale, 4f * scale)
}

/** Numeric part is independently tested; coordinates are real MotionEvent pixels. */
internal class NativeEditorPanStart {
    private var origin: Pair<Double, Double>? = null
    private var latest: Pair<Double, Double>? = null

    fun down(x: Double, y: Double) {
        reset()
        if (x.isFinite() && y.isFinite()) { origin = x to y; latest = origin }
    }

    fun move(x: Double, y: Double) {
        if (origin != null && x.isFinite() && y.isFinite()) latest = x to y
    }

    fun consume(): Pair<Double, Double>? {
        val start = origin ?: return null
        val end = latest ?: return null
        reset()
        return (end.first - start.first) to (end.second - start.second)
    }

    fun reset() { origin = null; latest = null }
}
