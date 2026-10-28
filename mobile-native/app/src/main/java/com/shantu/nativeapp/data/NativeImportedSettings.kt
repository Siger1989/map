package com.shantu.nativeapp.data

import android.content.Context
import android.content.SharedPreferences
import com.shantu.nativeapp.layout.NativeLayoutDraft
import com.shantu.nativeapp.recording.RecordingFacade
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import kotlin.math.roundToInt

data class NativeRouteDisplaySettings(
    val mode: String = "original", val legend: Boolean = true, val statistics: Boolean = false,
    val profile: Boolean = false, val steep: Boolean = false, val coordinates: Boolean = false,
)

data class NativeTrackStyleSettings(
    val color: String = "#ffb477", val width: Double = 1.5, val pointSize: Int = 8,
    val opacity: Double = 1.0, val travelMode: String? = null, val colorMode: String = "solid",
)

data class NativeProjectCrsSettings(
    val id: String, val name: String, val definition: String?, val datumParameters: List<Double>,
)

/** Runtime-facing equivalent of the original workspace settings. */
data class NativeRuntimeSettings(
    val source: String = "tianditu-imagery",
    val rasterZoom: Int = -1,
    val rasterQuality: String = "standard",
    val terrainEnabled: Boolean = false,
    val terrainExaggeration: Float = 1f,
    val contoursEnabled: Boolean = false,
    val contourInterval: Int = 30,
    val elevationColorsEnabled: Boolean = false,
    val elevationOpacity: Float = 1f,
    val geologyEnabled: Boolean = false,
    val geologySource: String = "world",
    val geologyOpacity: Float = .85f,
    val roadsEnabled: Boolean = false,
    val labelsEnabled: Boolean = true,
    val roadsOpacity: Float = 1f,
    val rasterLabelOpacity: Float = 1f,
    val satelliteEnabled: Boolean = false,
    val satelliteProvider: String = "sentinel",
    val imageryMode: String = "detail",
    val tiandituBase: String = "img",
    val tiandituLabels: String = "auto",
    val offlineBasemap: Boolean = false,
    val tiandituBoundaries: Boolean = false,
    val routeDisplayJson: String? = null,
    val routingPreference: String = "offlineFirst",
    val trackStyleJson: String? = null,
    val annotationAttributesJson: String? = null,
    val projectCrsJson: String? = null,
    val sourceCoordinateSystemsJson: String = "{}",
    val areaUnit: String = "m2",
    val layoutJson: String? = null,
    val themeJson: String? = null,
    val favoriteSourceKeysJson: String = "[]",
    val comparisonOpenGroupsJson: String = "[]",
    val legacyViewJson: String? = null,
    val recordingMaxAccuracyMetres: Int? = null,
) {
    /** Coordinate datum override keyed exactly as the legacy provider identity (`custom:<id>`, etc.). */
    fun datumFor(sourceIdentity: String): String = try {
        JSONObject(sourceCoordinateSystemsJson).optString(sourceIdentity).takeIf { it in DATUMS } ?: "wgs84"
    } catch (_: JSONException) { "wgs84" }

    /** Parsed values mirror the old route-display preference contract and native panel defaults. */
    val routeDisplay: NativeRouteDisplaySettings get() = runCatching {
        val o = JSONObject(routeDisplayJson ?: "{}")
        val mode = o.optString("mode", "original").takeIf { it in setOf("original", "solid", "elevation", "speed", "slope") } ?: "original"
        NativeRouteDisplaySettings(mode, o.optBoolean("legend", true), o.optBoolean("statistics"), o.optBoolean("profile"), o.optBoolean("steep"), o.optBoolean("coordinates"))
    }.getOrDefault(NativeRouteDisplaySettings())

    /** Validated old default track style, suitable for both saved-route and new-record renderers. */
    val trackStyle: NativeTrackStyleSettings get() = runCatching {
        val o = JSONObject(trackStyleJson ?: "{}")
        val color = o.optString("color", "#ffb477").takeIf { Regex("^#[a-fA-F0-9]{6}$").matches(it) } ?: "#ffb477"
        val width = o.optDouble("width", 1.5).takeIf { it.isFinite() }?.coerceIn(.5, 5.0) ?: 1.5
        val pointSize = o.optInt("pointSize", 8).coerceIn(4, 16)
        val opacity = o.optDouble("opacity", 1.0).takeIf { it.isFinite() }?.coerceIn(.1, 1.0) ?: 1.0
        val colorMode = o.optString("colorMode", "solid").takeIf { it in setOf("solid", "speed", "slope", "elevation") } ?: "solid"
        NativeTrackStyleSettings(color, width, pointSize, opacity, o.optString("travelMode").takeIf { it.isNotBlank() }, colorMode)
    }.getOrDefault(NativeTrackStyleSettings())

    val annotationAttributeNames: List<String> get() = runCatching {
        val names = JSONObject(annotationAttributesJson ?: "{}").optJSONArray("names") ?: JSONArray()
        (0 until names.length()).map { names.optString(it) }.filter { it.isNotBlank() }.take(100)
    }.getOrDefault(emptyList())

    val projectCrs: NativeProjectCrsSettings? get() = runCatching {
        val o = JSONObject(projectCrsJson ?: return@runCatching null)
        val params = o.optJSONArray("datumParameters")?.let { a -> (0 until a.length()).map { a.optDouble(it) } }.orEmpty()
        NativeProjectCrsSettings(o.optString("id"), o.optString("name"), o.optString("definition").takeIf { it.isNotBlank() }, params)
    }.getOrNull()

    /** UI-layout drafts are normalized by the same parser the native editor uses. */
    val layoutDraft: NativeLayoutDraft? get() = layoutJson?.let { runCatching { NativeLayoutDraft.parse(it) }.getOrNull() }

    val favoriteSourceKeys: List<String> get() = parseStringArray(favoriteSourceKeysJson)
    val comparisonOpenGroups: List<String> get() = parseStringArray(comparisonOpenGroupsJson)

    companion object {
        private val DATUMS = setOf("wgs84", "gcj02", "bd09")
        private fun parseStringArray(raw: String): List<String> = runCatching {
            val array = JSONArray(raw); (0 until array.length()).map { array.optString(it) }.filter { it.isNotBlank() }
        }.getOrDefault(emptyList())
    }
}

/**
 * Converts the allow-listed workspaceBackup.SETTINGS_KEYS payload into values the native host can
 * actually consume. It stores both existing UI preference keys and one stable runtime snapshot;
 * callers must use [readRuntime] for settings that have no existing native control yet.
 */
object NativeImportedSettings {
    const val PREFS = "native-ui-v1"
    const val RUNTIME_SNAPSHOT = "imported-runtime-v1"

    private const val LAYERS = "shantu.map.layer-preferences.v1"
    private const val SELECTED = "shantu-selected-map"
    private const val ROUTING = "shantu.routing-mode.v1"
    private const val ROUTE_DISPLAY = "shantu.route-display.v1"
    private const val TRACK_STYLE = "guanyun.track-style.v1"
    private const val SOURCE_COORDS = "shantu.map-source-coordinates.v1"
    private const val PROJECT_CRS = "shantu.project-crs.v1"
    private const val AREA_UNIT = "shantu-area-display-unit-v1"
    private const val CONTOUR = "shantu.contour-interval.v1"
    private const val LAYOUT = "shantu.ui-layout.v1"
    private const val LAST_VIEW = "shantu.map.last-view.v1"
    private const val ATTRIBUTES = "shantu.annotation-attributes.v1"
    private const val THEME = "shantu.appearance.v1"
    private const val FAVORITES = "shantu-map-source-favorites-v1"
    private const val COMPARISON_GROUPS = "shantu-map-comparison-source-groups-v1"
    private const val RECORDING_ACCURACY = "guanyun.recording.max-accuracy.v1"

    /** Pure translation for import previews and deterministic tests; no credentials are accepted. */
    fun translate(settings: JSONObject, base: NativeRuntimeSettings = NativeRuntimeSettings()): NativeRuntimeSettings {
        var out = base
        val envelope = settings.jsonObject(LAYERS)?.optJSONObject("layers")
        envelope?.let { layers ->
            out = out.copy(
                terrainEnabled = layers.optBooleanIfPresent("terrain", out.terrainEnabled),
                contoursEnabled = layers.optBooleanIfPresent("contours", out.contoursEnabled),
                elevationColorsEnabled = layers.optBooleanIfPresent("elevationColors", out.elevationColorsEnabled),
                geologyEnabled = layers.optBooleanIfPresent("geology", out.geologyEnabled),
                roadsEnabled = layers.optBooleanIfPresent("roads", out.roadsEnabled),
                labelsEnabled = layers.optBooleanIfPresent("labels", out.labelsEnabled),
                satelliteEnabled = layers.optBooleanIfPresent("satellite", out.satelliteEnabled),
                offlineBasemap = layers.optBooleanIfPresent("offlineBasemap", out.offlineBasemap),
                tiandituBoundaries = layers.optBooleanIfPresent("tiandituBoundaries", out.tiandituBoundaries),
                terrainExaggeration = layers.optFloat("exaggeration", out.terrainExaggeration).coerceIn(.1f, 5f),
                elevationOpacity = layers.optFloat("elevationColorsOpacity", out.elevationOpacity).coerceIn(0f, 1f),
                geologyOpacity = layers.optFloat("geologyOpacity", out.geologyOpacity).coerceIn(0f, 1f),
                roadsOpacity = layers.optFloat("roadsOpacity", out.roadsOpacity).coerceIn(0f, 1f),
                rasterLabelOpacity = layers.optFloat("roadsOpacity", out.rasterLabelOpacity).coerceIn(0f, 1f),
                rasterQuality = layers.optString("rasterQuality", out.rasterQuality).takeIf { it in setOf("standard", "high") } ?: out.rasterQuality,
                rasterZoom = if (layers.has("rasterLevel")) {
                    if (layers.isNull("rasterLevel")) -1 else layers.optInt("rasterLevel", out.rasterZoom).coerceIn(0, 24)
                } else out.rasterZoom,
                geologySource = layers.optString("geologySource", out.geologySource).takeIf { it in setOf("world", "geocloud20w") } ?: out.geologySource,
                contourInterval = layers.optInt("contourInterval", out.contourInterval).takeIf { it in setOf(30, 50, 100, 200) } ?: out.contourInterval,
                satelliteProvider = layers.optString("satelliteProvider", out.satelliteProvider).takeIf { it in setOf("sentinel", "tianditu") } ?: out.satelliteProvider,
                imageryMode = layers.optString("imageryMode", out.imageryMode).takeIf { it in setOf("detail", "latest") } ?: out.imageryMode,
                tiandituBase = layers.optString("tiandituBase", out.tiandituBase).takeIf { it in setOf("vec", "img", "ter") } ?: out.tiandituBase,
                tiandituLabels = layers.optString("tiandituLabels", out.tiandituLabels).takeIf { it in setOf("auto", "cva", "cia", "cta", "vector", "none") } ?: out.tiandituLabels,
            )
        }
        settings.optString(SELECTED).takeIf { it.isNotBlank() }?.let { out = out.copy(source = normalizeSource(it)) }
        if (settings.optString(SELECTED).isBlank() && envelope?.has("tiandituBase") == true) {
            out = out.copy(source = when (out.tiandituBase) { "vec" -> "tianditu-vector"; "ter" -> "tianditu-terrain"; else -> "tianditu-imagery" })
        }
        settings.optString(ROUTING).takeIf { it in setOf("auto", "online", "offline") }?.let {
            out = out.copy(routingPreference = when (it) { "offline" -> "offlineOnly"; "auto" -> "offlineFirst"; else -> "online" })
        }
        out = out.copy(
            routeDisplayJson = settings.optStringOrNull(ROUTE_DISPLAY) ?: out.routeDisplayJson,
            trackStyleJson = settings.optStringOrNull(TRACK_STYLE) ?: out.trackStyleJson,
            annotationAttributesJson = settings.optStringOrNull(ATTRIBUTES) ?: out.annotationAttributesJson,
            projectCrsJson = settings.optStringOrNull(PROJECT_CRS) ?: out.projectCrsJson,
            sourceCoordinateSystemsJson = settings.optStringOrNull(SOURCE_COORDS) ?: out.sourceCoordinateSystemsJson,
            areaUnit = settings.optString(AREA_UNIT).takeIf { it in AREA_UNITS } ?: out.areaUnit,
            layoutJson = settings.optStringOrNull(LAYOUT) ?: out.layoutJson,
            themeJson = settings.optStringOrNull(THEME) ?: out.themeJson,
            favoriteSourceKeysJson = settings.optStringOrNull(FAVORITES) ?: out.favoriteSourceKeysJson,
            comparisonOpenGroupsJson = settings.optStringOrNull(COMPARISON_GROUPS) ?: out.comparisonOpenGroupsJson,
            legacyViewJson = settings.optStringOrNull(LAST_VIEW) ?: out.legacyViewJson,
            recordingMaxAccuracyMetres = settings.optString(RECORDING_ACCURACY).toIntOrNull()?.takeIf { it in 5..80 }
                ?: out.recordingMaxAccuracyMetres,
        )
        settings.optString(CONTOUR).toIntOrNull()?.takeIf { it in setOf(30, 50, 100, 200) }?.let { out = out.copy(contourInterval = it) }
        return out
    }

    fun readRuntime(context: Context): NativeRuntimeSettings = readRuntime(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE))
        .copy(recordingMaxAccuracyMetres = RecordingFacade.accuracy(context))

    fun readRuntime(preferences: SharedPreferences): NativeRuntimeSettings {
        val stored = runCatching { JSONObject(preferences.getString(RUNTIME_SNAPSHOT, "{}") ?: "{}") }.getOrDefault(JSONObject())
        val base = NativeRuntimeSettings(
            source = preferences.getString("source", "tianditu-imagery") ?: "tianditu-imagery",
            rasterZoom = preferences.getInt("raster-z", -1),
            rasterQuality = preferences.getString("quality", "standard") ?: "standard",
            terrainEnabled = preferences.getBoolean("terrain", false),
            terrainExaggeration = preferences.getFloat("terrain-exaggeration", 1f),
            contoursEnabled = preferences.getBoolean("contours", false),
            contourInterval = preferences.getInt("contour-interval", 30),
            elevationColorsEnabled = preferences.getBoolean("elevation-colors", false),
            elevationOpacity = preferences.getFloat("elevation-opacity", 1f),
            geologyEnabled = preferences.getBoolean("geology", false),
            geologySource = preferences.getString("geology-source", "world") ?: "world",
            geologyOpacity = preferences.getFloat("geology-opacity", .85f),
            roadsEnabled = preferences.getBoolean("roads", false),
            labelsEnabled = preferences.getBoolean("labels", true),
            roadsOpacity = preferences.getInt("road-opacity", 100).coerceIn(0, 100) / 100f,
            rasterLabelOpacity = preferences.getInt("label-opacity", 100).coerceIn(0, 100) / 100f,
            satelliteEnabled = preferences.getBoolean("satellite", false),
            satelliteProvider = preferences.getString("satellite-provider", "sentinel") ?: "sentinel",
            imageryMode = preferences.getString("imagery-mode", "detail") ?: "detail",
            tiandituBase = preferences.getString("tianditu-base", "img") ?: "img",
            tiandituLabels = preferences.getString("tianditu-labels", "auto") ?: "auto",
            offlineBasemap = preferences.getBoolean("offline-basemap", false),
            tiandituBoundaries = preferences.getBoolean("tianditu-boundaries", false),
        )
        return snapshotFromStored(stored, base).copy(
            routingPreference = preferences.getString("routing-preference", stored.optString("routingPreference", base.routingPreference)) ?: base.routingPreference,
            routeDisplayJson = preferences.getString("route-display", stored.optString("routeDisplayJson").takeIf { it.isNotBlank() }) ?: base.routeDisplayJson,
            trackStyleJson = preferences.getString("track-style", stored.optString("trackStyleJson").takeIf { it.isNotBlank() }) ?: base.trackStyleJson,
            annotationAttributesJson = preferences.getString("annotation-attributes", stored.optString("annotationAttributesJson").takeIf { it.isNotBlank() }) ?: base.annotationAttributesJson,
            projectCrsJson = preferences.getString("project-crs", stored.optString("projectCrsJson").takeIf { it.isNotBlank() }) ?: base.projectCrsJson,
            sourceCoordinateSystemsJson = preferences.getString("source-coordinates", stored.optString("sourceCoordinateSystemsJson", base.sourceCoordinateSystemsJson)) ?: base.sourceCoordinateSystemsJson,
            areaUnit = preferences.getString("area-unit", stored.optString("areaUnit", base.areaUnit)) ?: base.areaUnit,
            layoutJson = preferences.getString("layout", stored.optString("layoutJson").takeIf { it.isNotBlank() }) ?: base.layoutJson,
            themeJson = preferences.getString("appearance", stored.optString("themeJson").takeIf { it.isNotBlank() }) ?: base.themeJson,
            favoriteSourceKeysJson = preferences.getString("source-favorites-json", stored.optString("favoriteSourceKeysJson", base.favoriteSourceKeysJson)) ?: base.favoriteSourceKeysJson,
            comparisonOpenGroupsJson = preferences.getString("comparison-open-groups", stored.optString("comparisonOpenGroupsJson", base.comparisonOpenGroupsJson)) ?: base.comparisonOpenGroupsJson,
            legacyViewJson = preferences.getString("legacy-view", stored.optString("legacyViewJson").takeIf { it.isNotBlank() }) ?: base.legacyViewJson,
        )
    }

    /** Apply translated values to keys consumed by the current native UI plus the stable runtime API. */
    fun apply(context: Context, settings: JSONObject) {
        val preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val runtime = translate(settings, readRuntime(preferences))
        val editor = preferences.edit()
            .putString("source", runtime.source)
            .putInt("raster-z", runtime.rasterZoom)
            .putString("quality", runtime.rasterQuality)
            .putBoolean("terrain", runtime.terrainEnabled)
            .putFloat("terrain-exaggeration", runtime.terrainExaggeration)
            .putBoolean("contours", runtime.contoursEnabled)
            .putInt("contour-interval", runtime.contourInterval)
            .putBoolean("elevation-colors", runtime.elevationColorsEnabled)
            .putFloat("elevation-opacity", runtime.elevationOpacity)
            .putBoolean("geology", runtime.geologyEnabled)
            .putString("geology-source", runtime.geologySource)
            .putFloat("geology-opacity", runtime.geologyOpacity)
            .putBoolean("roads", runtime.roadsEnabled)
            .putBoolean("labels", runtime.labelsEnabled)
            .putInt("road-opacity", (runtime.roadsOpacity * 100).roundToInt())
            .putInt("label-opacity", (runtime.rasterLabelOpacity * 100).roundToInt())
            .putBoolean("satellite", runtime.satelliteEnabled)
            .putString("satellite-provider", runtime.satelliteProvider)
            .putString("imagery-mode", runtime.imageryMode)
            .putString("tianditu-base", runtime.tiandituBase)
            .putString("tianditu-labels", runtime.tiandituLabels)
            .putBoolean("offline-basemap", runtime.offlineBasemap)
            .putBoolean("tianditu-boundaries", runtime.tiandituBoundaries)
            .putString(RUNTIME_SNAPSHOT, runtime.toJson().toString())
        runtime.routeDisplayJson?.let { editor.putString("route-display", it) }
        runtime.trackStyleJson?.let { editor.putString("track-style", it) }
        runtime.annotationAttributesJson?.let { editor.putString("annotation-attributes", it) }
        runtime.projectCrsJson?.let { editor.putString("project-crs", it) }
        runtime.sourceCoordinateSystemsJson.let { editor.putString("source-coordinates", it) }
        runtime.areaUnit.let { editor.putString("area-unit", it) }
        runtime.layoutJson?.let { editor.putString("layout", it) }
        runtime.themeJson?.let { editor.putString("appearance", it) }
        runtime.favoriteSourceKeysJson.let { editor.putString("source-favorites-json", it) }
        runtime.comparisonOpenGroupsJson.let { editor.putString("comparison-open-groups", it) }
        runtime.legacyViewJson?.let { editor.putString("legacy-view", it); editor.remove("camera") }
        require(editor.commit()) { "运行设置保存失败；导入工程仍保留，可重试应用" }
        runtime.recordingMaxAccuracyMetres?.let {
            require(RecordingFacade.saveAccuracy(context, it)) { "记录精度设置未应用" }
        }
    }

    private fun snapshotFromStored(o: JSONObject, base: NativeRuntimeSettings) = base.copy(
        routingPreference = o.optString("routingPreference", base.routingPreference),
        routeDisplayJson = o.optStringOrNull("routeDisplayJson") ?: base.routeDisplayJson,
        trackStyleJson = o.optStringOrNull("trackStyleJson") ?: base.trackStyleJson,
        annotationAttributesJson = o.optStringOrNull("annotationAttributesJson") ?: base.annotationAttributesJson,
        projectCrsJson = o.optStringOrNull("projectCrsJson") ?: base.projectCrsJson,
        sourceCoordinateSystemsJson = o.optString("sourceCoordinateSystemsJson", base.sourceCoordinateSystemsJson),
        areaUnit = o.optString("areaUnit", base.areaUnit), layoutJson = o.optStringOrNull("layoutJson") ?: base.layoutJson,
        themeJson = o.optStringOrNull("themeJson") ?: base.themeJson,
        favoriteSourceKeysJson = o.optString("favoriteSourceKeysJson", base.favoriteSourceKeysJson),
        comparisonOpenGroupsJson = o.optString("comparisonOpenGroupsJson", base.comparisonOpenGroupsJson),
        legacyViewJson = o.optStringOrNull("legacyViewJson") ?: base.legacyViewJson,
        recordingMaxAccuracyMetres = if (!o.has("recordingMaxAccuracyMetres") || o.isNull("recordingMaxAccuracyMetres")) base.recordingMaxAccuracyMetres else o.optInt("recordingMaxAccuracyMetres"),
    )

    private fun NativeRuntimeSettings.toJson() = JSONObject().apply {
        put("routingPreference", routingPreference)
        putNullable("routeDisplayJson", routeDisplayJson); putNullable("trackStyleJson", trackStyleJson)
        putNullable("annotationAttributesJson", annotationAttributesJson); putNullable("projectCrsJson", projectCrsJson)
        put("sourceCoordinateSystemsJson", sourceCoordinateSystemsJson); put("areaUnit", areaUnit)
        putNullable("layoutJson", layoutJson); putNullable("themeJson", themeJson)
        put("favoriteSourceKeysJson", favoriteSourceKeysJson); put("comparisonOpenGroupsJson", comparisonOpenGroupsJson)
        putNullable("legacyViewJson", legacyViewJson)
        recordingMaxAccuracyMetres?.let { put("recordingMaxAccuracyMetres", it) }
    }

    private fun normalizeSource(source: String) = when (source) {
        "tianditu", "tianditu-img", "tianditu_img" -> "tianditu-imagery"
        "tianditu-vec", "tianditu_vec" -> "tianditu-vector"
        "tianditu-ter", "tianditu_ter" -> "tianditu-terrain"
        else -> source
    }

    private fun JSONObject.optBooleanIfPresent(key: String, fallback: Boolean) = if (has(key) && opt(key) is Boolean) optBoolean(key) else fallback
    private fun JSONObject.optFloat(key: String, fallback: Float) = if (has(key) && opt(key) is Number) optDouble(key).toFloat() else fallback
    private fun JSONObject.jsonObject(key: String): JSONObject? = optStringOrNull(key)?.let { runCatching { JSONObject(it) }.getOrNull() }
    private fun JSONObject.optStringOrNull(key: String): String? = if (has(key) && !isNull(key)) optString(key).takeIf { it.isNotBlank() } else null
    private fun JSONObject.putNullable(key: String, value: String?) { if (value == null) put(key, JSONObject.NULL) else put(key, value) }

    private val AREA_UNITS = setOf("m2", "km2", "ha", "mu", "ft2", "acre", "mi2")
}
