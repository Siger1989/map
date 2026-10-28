package com.shantu.nativeapp.hybrid

/**
 * Uses the result/state after NativeMapTouchNavigation.capture has processed the event.
 * An editor-owned single-finger DOWN must retain its camera anchor; clear only when the
 * event actually begins native camera navigation.
 */
internal object NativeBridgeTouchPolicy {
    fun shouldClearGroundAnchor(
        actionDown: Boolean,
        pointerDown: Boolean,
        pointerCaptured: Boolean,
        navigationStarted: Boolean,
    ): Boolean = actionDown && !pointerCaptured || pointerDown && navigationStarted
}
