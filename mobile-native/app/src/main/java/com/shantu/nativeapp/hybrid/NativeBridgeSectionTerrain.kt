package com.shantu.nativeapp.hybrid

import org.json.JSONObject

/** Rendering override only: the React settings object remains the user's saved preference. */
internal object NativeBridgeSectionTerrain {
    fun effective(settings: JSONObject, section: JSONObject?): JSONObject = JSONObject(settings.toString()).apply {
        if (section?.optBoolean("enabled") == true) {
            put("terrain", true)
            put("exaggeration", 1.0)
        }
    }
}
