package com.shantu.nativeapp.hybrid

/** Business snapshot cadence is independent of the native renderer's frame cadence. */
internal object NativeBridgeFramePolicy {
    const val QUIET_MILLIS = 180L
    fun intervalMillis(realtimeTask: Boolean): Long = if (realtimeTask) 33L else 100L
    fun allowGroundWork(realtimeTask: Boolean, nowMillis: Long, lastMotionMillis: Long): Boolean =
        realtimeTask || nowMillis - lastMotionMillis >= QUIET_MILLIS
}
