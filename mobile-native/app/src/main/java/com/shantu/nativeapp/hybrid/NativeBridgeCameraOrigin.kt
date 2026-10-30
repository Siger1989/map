package com.shantu.nativeapp.hybrid

import org.json.JSONObject

/** Main-thread camera provenance; snapshots copy the token alongside their actual camera/viewport. */
internal class NativeBridgeCameraOrigin {
    var token: Long? = null
        private set

    fun command(command: String, payload: JSONObject) {
        val camera = payload.optJSONObject("camera") ?: payload
        token = if (command == "applyCamera") readToken(camera.opt("cameraSyncToken")) else null
    }

    fun beginUserGesture() { token = null }

    companion object {
        fun readToken(value: Any?): Long? {
            val number = (value as? Number)?.toDouble() ?: return null
            return number.takeIf { it.isFinite() && it > 0.0 && it <= 9_007_199_254_740_991.0 && it == kotlin.math.floor(it) }?.toLong()
        }

        fun annotate(camera: JSONObject, capturedToken: Long?): JSONObject =
            camera.put("cameraSyncToken", capturedToken ?: JSONObject.NULL)
    }
}
