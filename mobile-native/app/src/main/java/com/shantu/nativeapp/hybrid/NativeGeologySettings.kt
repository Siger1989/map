package com.shantu.nativeapp.hybrid

import org.json.JSONObject

/** React uses geology; the earlier standalone native protocol used geologyEnabled. */
internal object NativeGeologySettings {
    fun enabled(settings: JSONObject): Boolean =
        if (settings.has("geologyEnabled")) settings.optBoolean("geologyEnabled", false)
        else settings.optBoolean("geology", false)
}
