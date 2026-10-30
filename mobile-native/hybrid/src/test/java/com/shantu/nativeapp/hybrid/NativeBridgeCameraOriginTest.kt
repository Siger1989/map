package com.shantu.nativeapp.hybrid

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NativeBridgeCameraOriginTest {
    @Test fun commandOriginIsCapturedAndGestureClearsOnlyFutureFrames() {
        val origin = NativeBridgeCameraOrigin()
        origin.command("applyCamera", JSONObject().put("cameraSyncToken", 7))
        val captured = origin.token
        origin.beginUserGesture()
        assertNull(origin.token)
        assertEquals(7L, NativeBridgeCameraOrigin.annotate(JSONObject(), captured).getLong("cameraSyncToken"))
        assertTrue(NativeBridgeCameraOrigin.annotate(JSONObject(), origin.token).isNull("cameraSyncToken"))
    }

    @Test fun independentCameraCommandsDoNotInheritPeerOrigin() {
        val origin = NativeBridgeCameraOrigin()
        origin.command("applyCamera", JSONObject().put("camera", JSONObject().put("cameraSyncToken", 3)))
        assertEquals(3L, origin.token)
        origin.command("followPosition", JSONObject())
        assertNull(origin.token)
    }

    @Test fun onlyPositiveSafeIntegerTokensAreAccepted() {
        for (value in listOf<Any>(0, -1, 1.5, Double.NaN, Double.POSITIVE_INFINITY, 9_007_199_254_740_992.0, "7", JSONObject.NULL)) {
            assertNull(NativeBridgeCameraOrigin.readToken(value))
        }
        assertEquals(1L, NativeBridgeCameraOrigin.readToken(1))
        assertEquals(9_007_199_254_740_991L, NativeBridgeCameraOrigin.readToken(9_007_199_254_740_991L))
    }
}
