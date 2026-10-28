package com.shantu.nativeapp.hybrid

import com.shantu.nativeapp.section.NativeSectionDemSampler
import com.shantu.nativeapp.section.NativeSectionSettings
import com.shantu.nativeapp.section.NativeSectionSnapshot
import com.shantu.nativeapp.section.NativeSectionSurfaceLayer
import earth.worldwind.WorldWindow
import earth.worldwind.geom.AltitudeMode
import earth.worldwind.geom.Angle.Companion.degrees
import earth.worldwind.geom.Position
import earth.worldwind.layer.RenderableLayer
import earth.worldwind.render.Color
import earth.worldwind.shape.Placemark
import earth.worldwind.shape.PlacemarkAttributes
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/** Saved free-orientation planes use the same real DEM/model sampler as the active plane.
 * All entry points and render callbacks are called on Main; sampling is sequential and cancellable.
 */
internal class NativeBridgeSectionCollection internal constructor(
    private val createSurface: (String) -> Surface,
    private val sample: suspend (NativeSectionSettings, List<JSONObject>) -> NativeSectionSnapshot,
    private val scope: CoroutineScope,
    private val onFailure: (String) -> Unit = {},
) : AutoCloseable {
    internal interface Surface : AutoCloseable {
        fun show(snapshot: NativeSectionSnapshot, notes: JSONArray)
    }
    constructor(
        window: WorldWindow,
        createSampler: () -> NativeSectionDemSampler,
        onFailure: (String) -> Unit = {},
    ) : this(
        createSurface = { id ->
            val surface = NativeSectionSurfaceLayer(window)
            object : Surface {
                override fun show(snapshot: NativeSectionSnapshot, notes: JSONArray) {
                    surface.show(snapshot, notes)
                    tagLayer(surface.layer, id)
                }
                override fun close() = surface.close()
            }
        },
        sample = { settings, models ->
            // The controller creates DEM coverage on Main. Only sampling leaves Main.
            val sampler = createSampler()
            try { withContext(Dispatchers.IO) { sampler.sample(settings, models) } }
            finally { sampler.close() }
        },
        scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate),
        onFailure = onFailure,
    ) { cursorWindow = window }

    private data class Entry(val surface: Surface, var signature: String? = null)
    private val entries = linkedMapOf<String, Entry>()
    private var latestState = JSONObject()
    private var latestAnnotations = JSONArray()
    private var inputSignature: String? = null
    private var job: Job? = null
    private var generation = 0L
    private var closed = false
    private var cursorWindow: WorldWindow? = null
    private var cursorLayer: RenderableLayer? = null
    private var cursorSignature: String? = null

    fun sync(state: JSONObject, annotations: JSONArray = state.optJSONArray("annotations") ?: JSONArray()) {
        if (closed) return
        val items = visibleItems(state)
        val signature = JSONArray(items).toString() + "|" + annotations.toString()
        latestState = JSONObject(state.toString())
        latestAnnotations = JSONArray(annotations.toString())
        if (signature == inputSignature) return
        inputSignature = signature
        resample(items)
    }

    /** A new native DEM revision invalidates completed and in-flight samples, never fills nodata. */
    fun afterDemUpdate() {
        if (closed || entries.isEmpty()) return
        entries.values.forEach { it.signature = null }
        resample(visibleItems(latestState))
    }

    private fun resample(items: List<JSONObject>) {
        val revision = ++generation
        job?.cancel()
        val ids = items.map { it.getString("id") }.toSet()
        (entries.keys - ids).forEach { entries.remove(it)?.surface?.close() }
        val models = (0 until latestAnnotations.length()).mapNotNull { latestAnnotations.optJSONObject(it) }
            .filter { it.optBoolean("visible", true) && it.optString("kind") != "pin" }
            .map { JSONObject(it.toString()) }
        val modelSignature = JSONArray(models).toString()
        job = scope.launch {
            for (item in items) {
                val id = item.getString("id")
                val settings = item.getJSONObject("settings")
                val signature = settings.toString() + "|" + modelSignature
                val entry = entries.getOrPut(id) { Entry(createSurface(id)) }
                if (entry.signature == signature) continue
                try {
                    val snapshot = sample(NativeSectionSettings.parse(settings), models)
                    if (closed || revision != generation || entries[id] !== entry) return@launch
                    entry.surface.show(snapshot, settings.optJSONArray("notes") ?: JSONArray())
                    entry.signature = signature
                } catch (error: CancellationException) {
                    throw error
                } catch (_: Exception) {
                    if (closed || revision != generation) return@launch
                    // Never leave the previous geometry after the same object's settings changed.
                    entries.remove(id)?.surface?.close()
                    onFailure("已保存剖面采样失败：$id")
                }
            }
        }
    }

    /** ProfilePoint coordinates/altitude are real sampled values, not a replacement ground height. */
    fun setCursor(settings: JSONObject?, point: JSONObject?) {
        if (closed) return
        val window = cursorWindow ?: return
        val coordinates = point?.optJSONArray("coordinates")
        val lon = coordinates?.optDouble(0, Double.NaN) ?: Double.NaN
        val lat = coordinates?.optDouble(1, Double.NaN) ?: Double.NaN
        val altitude = point?.optDouble("altitude", Double.NaN) ?: Double.NaN
        val visible = settings?.optBoolean("enabled") == true && lon.isFinite() && lon in -180.0..180.0 &&
            lat.isFinite() && lat in -85.0..85.0 && altitude.isFinite()
        val signature = if (visible) "$lon|$lat|$altitude" else "hidden"
        if (signature == cursorSignature) return
        cursorSignature = signature
        if (!visible) { cursorLayer?.clearRenderables(); window.requestRedraw(); return }
        val layer = cursorLayer ?: RenderableLayer("Section profile cursor").also {
            cursorLayer = it; window.engine.layers.addLayer(it)
        }
        layer.clearRenderables()
        layer.addRenderable(Placemark(Position(lat.degrees, lon.degrees, altitude), PlacemarkAttributes().apply {
            imageScale = 2.5; imageColor = Color(1f, 0.91f, 0.3f, 1f)
            isDrawLeader = false; isDepthTest = false
        }).apply { altitudeMode = AltitudeMode.ABSOLUTE; isAlwaysOnTop = true })
        window.requestRedraw()
    }

    override fun close() {
        if (closed) return
        closed = true; generation++; job?.cancel(); scope.cancel()
        entries.values.forEach { it.surface.close() }; entries.clear()
        cursorLayer?.let { cursorWindow?.engine?.layers?.removeLayer(it) }
        cursorLayer = null; cursorWindow?.requestRedraw(); cursorWindow = null
    }

    companion object {
        /** Mirrors SectionCollectionLayer: selected planes are owned exclusively by active layer. */
        internal fun visibleItems(state: JSONObject): List<JSONObject> {
            val selected = state.optString("selectedSectionId")
            val items = state.optJSONArray("sectionItems") ?: return emptyList()
            val seen = mutableSetOf<String>()
            return (0 until items.length()).mapNotNull { items.optJSONObject(it) }.filter {
                val id = it.optString("id")
                val settings = it.optJSONObject("settings")
                id.isNotBlank() && id != selected && settings?.optBoolean("enabled") == true &&
                    !settings.has("survey") && seen.add(id)
            }.map { JSONObject(it.toString()) }
        }

        fun tagLayer(layer: RenderableLayer, id: String = "__active") {
            layer.forEach { it.pickDelegate = "shantu-section:$id" }
        }
    }
}
