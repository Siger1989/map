package com.shantu.nativeapp.hybrid

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
@LooperMode(LooperMode.Mode.PAUSED)
class NativeBridgeFollowCameraTest {
    @Test fun `ordinary follow uses original 650ms duration and keeps current zoom and user angles`() {
        val camera = camera()
        val original = camera.toString()
        val target = NativeBridgeFollowCamera.target(camera, JSONObject().put("coordinate", JSONArray().put(104.0).put(32.0)))
        assertEquals(650L, target.getLong("duration"))
        assertEquals(12.25, target.getDouble("zoom"), 0.0)
        assertEquals(61.0, target.getDouble("pitch"), 0.0)
        assertEquals(137.0, target.getDouble("bearing"), 0.0)
        assertEquals(104.0, target.getJSONArray("center").getDouble(0), 0.0)
        assertEquals(32.0, target.getJSONArray("center").getDouble(1), 0.0)
        assertFalse(target.has("rangeMeters"))
        assertFalse(target.has("offset"))
        assertEquals(original, camera.toString())
    }

    @Test fun `nonanimated follow updates immediately without restoring an earlier orientation`() {
        val current = camera().put("pitch", 42.0).put("bearing", -25.0)
        val target = NativeBridgeFollowCamera.target(current, JSONObject().put("animate", false)
            .put("coordinate", JSONArray().put(-170.0).put(-30.0)))
        assertEquals(0L, target.getLong("duration"))
        assertEquals(42.0, target.getDouble("pitch"), 0.0)
        assertEquals(-25.0, target.getDouble("bearing"), 0.0)
        assertEquals(12.25, target.getDouble("zoom"), 0.0)
    }

    @Test fun `gesture interrupt detaches the old animator before synchronous cancel and end callbacks`() {
        var owned: ValueAnimator? = ValueAnimator.ofFloat(0f, 1f).apply { duration = 1000L }
        val animator = owned!!
        val callbacks = mutableListOf<String>()
        animator.addListener(object : AnimatorListenerAdapter() {
            override fun onAnimationCancel(animation: Animator) { assertNull(owned); callbacks += "cancel" }
            override fun onAnimationEnd(animation: Animator) { assertNull(owned); callbacks += "end" }
        })
        animator.start()
        assertTrue(animator.isStarted)
        NativeBridgeFollowCamera.cancel(owned) { owned = null }
        assertFalse(animator.isStarted)
        assertEquals(listOf("cancel", "end"), callbacks)
        // A second native stop/DOWN is idempotent and does not emit another old completion.
        NativeBridgeFollowCamera.cancel(owned) { owned = null }
        assertEquals(2, callbacks.size)
    }

    @Test fun `invalid follow coordinate fails without modifying live camera`() {
        val current = camera()
        val previous = current.toString()
        val failure = runCatching { NativeBridgeFollowCamera.target(current,
            JSONObject().put("coordinate", JSONArray().put(190.0).put(30.0))) }.exceptionOrNull()
        assertTrue(failure is IllegalArgumentException)
        assertEquals(previous, current.toString())
    }

    private fun camera() = JSONObject().put("center", JSONArray().put(103.0).put(30.0))
        .put("zoom", 12.25).put("pitch", 61.0).put("bearing", 137.0)
        .put("rangeMeters", 4567.0).put("offset", JSONArray().put(0).put(170))
}
