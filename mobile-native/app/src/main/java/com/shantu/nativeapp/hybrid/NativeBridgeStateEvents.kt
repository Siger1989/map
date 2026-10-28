package com.shantu.nativeapp.hybrid

import com.shantu.nativeapp.geology.NativeGeologyState
import com.shantu.nativeapp.geology.NativeGeologySource
import com.shantu.nativeapp.geology.NativeGeologyUnit
import com.shantu.nativeapp.map.NativeImageryStatus
import com.shantu.nativeapp.section.NativeSectionSnapshot
import org.json.JSONArray
import org.json.JSONObject

/** Exact callback field names consumed by the unchanged React panels. */
object NativeBridgeStateEvents {
    fun satellite(state: NativeImageryStatus) = JSONObject()
        .put("date", state.dateUtc ?: "").put("status", state.message).put("ready", state.ready)

    fun geology(state: NativeGeologyState): JSONObject {
        val units = state.units.map(::unit)
        val selected = state.selected?.let(::unit)
        return JSONObject()
            .put("source", if (state.source == NativeGeologySource.WORLD) "world" else "geocloud20w")
            .put("status", state.status.name.lowercase()).put("message", state.message)
            .put("legend", JSONArray(units))
            .put("sources", JSONArray().also { out ->
                state.units.map { it.source to it.sourceUrl }.distinct().forEach { (name, url) -> out.put(JSONObject().put("name", name).put("url", safeUrl(url))) }
            })
            .put("selection", selected ?: JSONObject.NULL).put("cursorSelection", selected ?: JSONObject.NULL)
            .apply { state.legendImage?.let { put("legendUrl", "data:image/png;base64," + android.util.Base64.encodeToString(it, android.util.Base64.NO_WRAP)) } }
    }

    fun section(snapshot: NativeSectionSnapshot): JSONObject = sectionPhase(snapshot.phase,
        snapshot.samples, snapshot.validTerrainSamples, snapshot.spacingMeters,
        snapshot.curves.minOfOrNull { it.minAltitudeMeters }, snapshot.curves.maxOfOrNull { it.maxAltitudeMeters },
        snapshot.terrainSources.size, snapshot.intersectingModels)

    fun sectionPhase(phase: String, samples: Int = 0, valid: Int = 0, spacing: Double = 0.0,
        min: Double? = null, max: Double? = null, tiles: Int = 0, models: Int = 0): JSONObject = JSONObject()
        .put("phase", when (phase) { "sampling" -> "loading"; "disabled" -> "idle"; else -> phase })
        .put("min", min?.takeIf(Double::isFinite) ?: 0.0).put("max", max?.takeIf(Double::isFinite) ?: 0.0)
        .put("spacing", spacing).put("samples", samples).put("valid", valid).put("tiles", tiles).put("models", models)

    private fun unit(value: NativeGeologyUnit) = JSONObject().put("key", value.key).put("name", value.name)
        .put("age", value.age).put("lithology", value.lithology).put("color", value.color)
        .put("description", value.description).put("source", value.source).put("sourceUrl", safeUrl(value.sourceUrl))

    private fun safeUrl(value: String?): Any {
        if (value.isNullOrBlank()) return JSONObject.NULL
        val uri = runCatching { java.net.URI(value) }.getOrNull() ?: return JSONObject.NULL
        if (uri.scheme !in setOf("http", "https") || uri.userInfo != null ||
            Regex("(?i)(^|&)(token|tk|apikey|api_key|key|authorization)=").containsMatchIn(uri.rawQuery ?: "")) return JSONObject.NULL
        return value
    }
}
