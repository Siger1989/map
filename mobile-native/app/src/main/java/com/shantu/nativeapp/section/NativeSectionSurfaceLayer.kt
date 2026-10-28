package com.shantu.nativeapp.section

import android.graphics.Color as AndroidColor
import android.os.Looper
import earth.worldwind.WorldWindow
import earth.worldwind.geom.AltitudeMode
import earth.worldwind.geom.Angle.Companion.degrees
import earth.worldwind.geom.Position
import earth.worldwind.layer.RenderableLayer
import earth.worldwind.render.Color
import earth.worldwind.shape.Path
import earth.worldwind.shape.Placemark
import earth.worldwind.shape.PlacemarkAttributes
import earth.worldwind.shape.Polygon
import earth.worldwind.shape.ShapeAttributes
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.PI
import kotlin.math.atan
import kotlin.math.cos
import kotlin.math.ln
import kotlin.math.sinh
import kotlin.math.tan

/**
 * WorldWind 3D representation of the ordinary free-orientation section. It deliberately does
 * not implement the separate destructive terrain-cut mode or the A/B survey-sheet workflow.
 * The layer attaches itself to the WorldWindow; the host must call [close] on teardown.
 */
class NativeSectionSurfaceLayer(private val worldWindow: WorldWindow) : AutoCloseable {
    val layer = RenderableLayer("Section surface")
    private var closed = false
    private var generation = 0L

    init {
        checkMainThread()
        worldWindow.engine.layers.addLayer(layer)
    }

    /** Reserve a revision on the UI thread before sampling off-thread. */
    fun beginRequest(): Long {
        checkMainThread()
        check(!closed) { "Section surface is closed" }
        return ++generation
    }

    /** Replaces all geometry atomically; an async result for an older request is ignored. */
    fun show(snapshot: NativeSectionSnapshot, notes: JSONArray = JSONArray(), expectedRevision: Long? = null): Boolean {
        checkMainThread()
        check(!closed) { "Section surface is closed" }
        if (expectedRevision != null && expectedRevision != generation) return false
        generation++
        layer.clearRenderables()
        val settings = NativeSectionSettings.parse(snapshot.settings)
        layer.isEnabled = settings.enabled
        if (!settings.enabled) {
            worldWindow.requestRedraw()
            return true
        }
        val plane = settings.plane
        val basis = basis(plane.headingDegrees, plane.tiltDegrees, plane.rollDegrees)
        val corners = listOf(
            planePoint(basis, -plane.widthMeters / 2, -plane.heightMeters / 2),
            planePoint(basis, plane.widthMeters / 2, -plane.heightMeters / 2),
            planePoint(basis, plane.widthMeters / 2, plane.heightMeters / 2),
            planePoint(basis, -plane.widthMeters / 2, plane.heightMeters / 2),
        ).map { toPosition(settings, it.x, it.y, it.z) }
        val sectionColor = color(settings.color, 0.2f)
        val surfaceAttributes = ShapeAttributes().apply {
            isDrawInterior = true
            isDrawOutline = false
            isDepthTest = false
            isLightingEnabled = false
            interiorColor = sectionColor
        }
        layer.addRenderable(Polygon(corners, surfaceAttributes).apply { altitudeMode = AltitudeMode.ABSOLUTE })

        val borderAttributes = ShapeAttributes().apply {
            isDrawInterior = false
            isDrawOutline = true
            isDepthTest = false
            isLightingEnabled = false
            outlineColor = color(settings.color, 0.95f)
            outlineWidth = 2f
        }
        layer.addRenderable(Path(corners + corners.first(), borderAttributes).apply { altitudeMode = AltitudeMode.ABSOLUTE })

        snapshot.curves.forEach { curve ->
            if (curve.points.size < 2) return@forEach
            val lineColor = when (curve.source) {
                "terrain" -> color(AndroidColor.rgb(255, 184, 95), 1f)
                "model" -> color(AndroidColor.rgb(255, 234, 88), 1f)
                else -> return@forEach
            }
            val lineAttributes = ShapeAttributes().apply {
                isDrawInterior = false
                isDrawOutline = true
                isDepthTest = false
                isLightingEnabled = false
                outlineColor = lineColor
                outlineWidth = if (curve.source == "model") 2.4f else 1.8f
            }
            val positions = curve.points.map { point ->
                val local = point.local
                toPosition(settings, local[0], local[1], local[2])
            }
            layer.addRenderable(Path(positions, lineAttributes).apply { altitudeMode = AltitudeMode.ABSOLUTE })
        }

        for (i in 0 until notes.length()) {
            val note = notes.optJSONObject(i) ?: continue
            val point = note.optJSONObject("point") ?: continue
            val local = point.optJSONArray("local") ?: continue
            if (local.length() != 3) continue
            val xyz = (0..2).map { local.optDouble(it, Double.NaN) }
            if (xyz.any { !it.isFinite() }) continue
            val noteColor = try { AndroidColor.parseColor(note.optString("color", "#f4a261")) } catch (_: IllegalArgumentException) { AndroidColor.rgb(244, 162, 97) }
            val attributes = PlacemarkAttributes().apply {
                imageScale = 1.8
                imageColor = color(noteColor, 1f)
                isDrawLeader = false
                isDepthTest = false
            }
            val label = note.optString("name").take(60).ifBlank { "剖面测点" }
            layer.addRenderable(Placemark(toPosition(settings, xyz[0], xyz[1], xyz[2]), attributes, label).apply {
                altitudeMode = AltitudeMode.ABSOLUTE
                isAlwaysOnTop = true
            })
        }
        worldWindow.requestRedraw()
        return true
    }

    /** Call after the profile renderer has sampled/saved notes to clear the 3D view. */
    fun clear() {
        checkMainThread()
        if (closed) return
        generation++
        layer.clearRenderables()
        layer.isEnabled = false
        worldWindow.requestRedraw()
    }

    fun revision(): Long = generation

    override fun close() {
        checkMainThread()
        if (closed) return
        clear()
        closed = true
        worldWindow.engine.layers.removeLayer(layer)
        worldWindow.requestRedraw()
    }

    private fun checkMainThread() {
        check(Looper.myLooper() == Looper.getMainLooper()) { "Section renderables must be updated on the Android main thread" }
    }

    private data class Vec3(val x: Double, val y: Double, val z: Double) {
        operator fun plus(other: Vec3) = Vec3(x + other.x, y + other.y, z + other.z)
        operator fun times(value: Double) = Vec3(x * value, y * value, z * value)
    }

    private fun basis(heading: Double, tilt: Double, roll: Double): Triple<Vec3, Vec3, Vec3> {
        val h = heading * PI / 180.0
        val t = tilt * PI / 180.0
        var u = Vec3(cos(h), kotlin.math.sin(h), 0.0)
        var v = Vec3(-kotlin.math.sin(h) * kotlin.math.sin(t), cos(h) * kotlin.math.sin(t), cos(t))
        val n = Vec3(u.y * v.z - u.z * v.y, u.z * v.x - u.x * v.z, u.x * v.y - u.y * v.x)
        val norm = kotlin.math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z).coerceAtLeast(1e-15)
        val normal = n * (1.0 / norm)
        fun rotate(value: Vec3): Vec3 {
            val angle = roll * PI / 180.0; val c = cos(angle); val s = kotlin.math.sin(angle)
            val cross = Vec3(normal.y * value.z - normal.z * value.y, normal.z * value.x - normal.x * value.z, normal.x * value.y - normal.y * value.x)
            val dot = normal.x * value.x + normal.y * value.y + normal.z * value.z
            return value * c + cross * s + normal * (dot * (1.0 - c))
        }
        u = rotate(u); v = rotate(v)
        return Triple(u, v, normal)
    }

    private fun planePoint(basis: Triple<Vec3, Vec3, Vec3>, u: Double, v: Double) = basis.first * u + basis.second * v

    private fun toPosition(settings: NativeSectionSettings, east: Double, south: Double, up: Double): Position {
        val latRad = settings.plane.latitude * PI / 180.0
        val anchorX = (settings.plane.longitude + 180.0) / 360.0
        val anchorY = (1.0 - ln(tan(PI / 4.0 + latRad / 2.0)) / PI) / 2.0
        val anchorUnit = 1.0 / (40_075_016.68557849 * cos(latRad))
        val worldY = anchorY + south * anchorUnit
        val lon = (((anchorX + east * anchorUnit) * 360.0 - 180.0 + 180.0) % 360.0 + 360.0) % 360.0 - 180.0
        val lat = atan(sinh(PI * (1.0 - 2.0 * worldY))) * 180.0 / PI
        val localLat = lat.coerceIn(-85.0, 85.0) * PI / 180.0
        val localUnit = 1.0 / (40_075_016.68557849 * cos(localLat))
        val altitude = (settings.altitudeMeters + up) * anchorUnit / localUnit
        return Position(lat.degrees, lon.degrees, altitude)
    }

    private fun color(argb: Int, alpha: Float) = Color(
        AndroidColor.red(argb) / 255f,
        AndroidColor.green(argb) / 255f,
        AndroidColor.blue(argb) / 255f,
        (AndroidColor.alpha(argb) / 255f * alpha).coerceIn(0f, 1f),
    )
}
