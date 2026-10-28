package com.shantu.nativeapp.hybrid

import android.view.MotionEvent

/** Transfers an editor-owned stream to the native camera when a second finger arrives. */
internal class NativeMapTouchNavigation {
    var isNavigating = false
        private set

    fun capture(event: MotionEvent, editorOwnsPointer: Boolean, dispatchCamera: (MotionEvent) -> Unit): Boolean {
        if (event.actionMasked == MotionEvent.ACTION_DOWN) isNavigating = false
        if (event.actionMasked == MotionEvent.ACTION_POINTER_DOWN && !isNavigating) {
            isNavigating = true
            if (editorOwnsPointer) {
                val cancel = MotionEvent.obtain(event).apply { action = MotionEvent.ACTION_CANCEL }
                try { dispatchCamera(cancel) } finally { cancel.recycle() }
                // WorldWind did not receive the editor's DOWN. Start its recognizers with
                // the existing finger before normal dispatch delivers POINTER_DOWN.
                val index = if (event.actionIndex == 0) 1 else 0
                val properties = MotionEvent.PointerProperties().also { event.getPointerProperties(index, it) }
                val coordinates = MotionEvent.PointerCoords().also { event.getPointerCoords(index, it) }
                val down = MotionEvent.obtain(event.downTime, event.eventTime, MotionEvent.ACTION_DOWN,
                    1, arrayOf(properties), arrayOf(coordinates), event.metaState, event.buttonState,
                    event.xPrecision, event.yPrecision, event.deviceId, event.edgeFlags, event.source, event.flags)
                try { dispatchCamera(down) } finally { down.recycle() }
            }
        }
        return editorOwnsPointer && !isNavigating && event.pointerCount == 1
    }
}
