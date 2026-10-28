package com.shantu.nativeapp.ui

import android.view.MotionEvent
import com.shantu.nativeapp.navigation.NativeCoordinate
import kotlin.math.hypot

/** Collects one deliberate single-finger stroke; only the host can project real map positions. */
internal class NativeFreehandGesture(
    private val spacingPx: Float,
    private val enabled: () -> Boolean,
    private val project: (Float, Float) -> NativeCoordinate?,
    private val commit: (List<NativeCoordinate>) -> Unit,
) {
    private var captured = false
    private var cancelled = false
    private var lastX = 0f
    private var lastY = 0f
    private val points = mutableListOf<NativeCoordinate>()

    fun onTouch(event: MotionEvent): Boolean {
        if (event.actionMasked == MotionEvent.ACTION_DOWN) {
            captured = enabled()
            cancelled = false
            points.clear()
            if (captured) append(event.x, event.y, force = true)
        }
        if (!captured) return false
        if (!enabled() || event.pointerCount != 1) cancelled = true
        when (event.actionMasked) {
            MotionEvent.ACTION_MOVE -> if (!cancelled) {
                for (index in 0 until event.historySize) append(event.getHistoricalX(index), event.getHistoricalY(index))
                append(event.x, event.y)
            }
            MotionEvent.ACTION_POINTER_DOWN, MotionEvent.ACTION_CANCEL -> cancelled = true
            MotionEvent.ACTION_UP -> {
                if (!cancelled) append(event.x, event.y, force = true)
                val completed = if (!cancelled && points.size >= 2) points.toList() else null
                captured = false
                points.clear()
                completed?.let(commit)
            }
        }
        if (event.actionMasked == MotionEvent.ACTION_CANCEL) { captured = false; points.clear() }
        return true
    }

    private fun append(x: Float, y: Float, force: Boolean = false) {
        if (cancelled || !x.isFinite() || !y.isFinite()) { cancelled = true; return }
        if (!force && points.isNotEmpty() && hypot(x - lastX, y - lastY) < spacingPx) return
        val position = project(x, y)
        if (position == null || !position.longitude.isFinite() || !position.latitude.isFinite() ||
            position.longitude !in -180.0..180.0 || position.latitude !in -85.051129..85.051129) {
            cancelled = true
            return
        }
        if (points.lastOrNull() != position) points += position
        if (points.size > 6000) { cancelled = true; points.clear() }
        lastX = x; lastY = y
    }
}
