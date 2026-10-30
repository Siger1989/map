package com.shantu.nativeapp.map

import org.json.JSONObject

/** Runtime placement only: saved coordinates, elevations, offsets and absolute edits are retained. */
internal object NativeModelTerrainInput {
    data class Stamp(val elevationRevision: Long, val terrainEnabled: Boolean, val exaggeration: Double)

    fun prepare(saved: JSONObject, terrainEnabled: Boolean, liveGroundMeters: Double?): JSONObject {
        val render = JSONObject(saved.toString())
        // Pins clamp through the SDK; their optional borehole uses the same visible ground.
        if (!terrainEnabled) render.put("groundElevation", 0.0)
        else if (liveGroundMeters != null && liveGroundMeters.isFinite()) render.put("groundElevation", liveGroundMeters)
        // A missing live sample keeps the existing explicitly supplied ground as fallback;
        // a genuinely groundless model retains the renderer's NEEDS_ELEVATION status.
        return render
    }
}
