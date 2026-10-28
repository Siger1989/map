package com.shantu.nativeapp.section

import com.shantu.nativeapp.map.NativeModelRenderer
import kotlinx.coroutines.ensureActive
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sinh
import kotlin.math.sqrt

/** Parsed view of the existing Web SectionSettings JSON. The untouched object is retained for save-back. */
data class NativeSectionSettings(
    val json: JSONObject,
    val enabled: Boolean,
    val altitudeMeters: Double,
    val color: Int,
    val plane: NativeSectionPlane,
) {
    companion object {
        fun parse(value: JSONObject): NativeSectionSettings {
            require(!value.has("survey")) { "勘探线剖面由独立测线模块处理" }
            val p = value.optJSONObject("plane") ?: throw IllegalArgumentException("剖面平面无效")
            val center = p.optJSONArray("center") ?: throw IllegalArgumentException("剖面中心无效")
            require(center.length() == 2)
            val lon = center.optDouble(0, Double.NaN)
            val lat = center.optDouble(1, Double.NaN)
            val width = p.optDouble("width", Double.NaN)
            val height = p.optDouble("height", Double.NaN)
            val heading = p.optDouble("heading", Double.NaN)
            val tilt = p.optDouble("tilt", Double.NaN)
            val roll = p.optDouble("roll", 0.0)
            val altitude = value.optDouble("altitude", Double.NaN)
            require(value.has("enabled") && value.opt("enabled") is Boolean)
            require(lon.isFinite() && lon in -180.0..180.0 && lat.isFinite() && lat in -85.0..85.0)
            require(width.isFinite() && width in 0.1..200_000.0 && height.isFinite() && height in 0.1..200_000.0)
            require(listOf(heading, tilt, roll, altitude).all(Double::isFinite) && altitude in -12_000.0..30_000.0)
            val colorText = value.optString("color", "#9de8c4")
            require(Regex("^#[0-9a-fA-F]{6}$").matches(colorText))
            val color = android.graphics.Color.parseColor(colorText)
            return NativeSectionSettings(
                JSONObject(value.toString()), value.optBoolean("enabled", false), altitude, color,
                NativeSectionPlane(lon, lat, width, height, heading, tilt, roll),
            )
        }
    }
}

data class NativeSectionPlane(
    val longitude: Double,
    val latitude: Double,
    val widthMeters: Double,
    val heightMeters: Double,
    val headingDegrees: Double,
    val tiltDegrees: Double,
    val rollDegrees: Double,
)

data class NativeSectionElevationSample(val elevationMeters: Double, val source: String? = null)

/** Implementations should tile-cache requests and return null for nodata/unavailable cells. */
fun interface NativeSectionElevationSampler {
    suspend fun sample(latitude: Double, longitude: Double): NativeSectionElevationSample?
}

data class NativeSectionPoint(
    val uMeters: Double,
    val vMeters: Double,
    /** Plane-local east/south/up coordinates, matching the persisted `point.local` array. */
    val local: List<Double>,
    val longitude: Double,
    val latitude: Double,
    val altitudeMeters: Double,
    val distanceMeters: Double = 0.0,
) {
    /** Web ProfilePoint-compatible value used inside both profile snapshots and saved notes. */
    fun toJson(includeDistance: Boolean = false): JSONObject {
        val value = JSONObject()
            .put("u", uMeters).put("v", vMeters)
            .put("local", JSONArray().put(local[0]).put(local[1]).put(local[2]))
            .put("coordinates", JSONArray().put(longitude).put(latitude))
            .put("altitude", altitudeMeters)
        if (includeDistance) value.put("distance", distanceMeters)
        return value
    }
}

data class NativeSectionCurve(
    val id: String,
    val name: String,
    val source: String,
    val points: List<NativeSectionPoint>,
    val distancesMeters: List<Double>,
    val lengthMeters: Double,
    val minAltitudeMeters: Double,
    val maxAltitudeMeters: Double,
    val closed: Boolean,
) {
    fun toJson() = JSONObject()
        .put("id", id).put("name", name).put("source", source)
        .put("points", JSONArray().also { array -> points.forEach { array.put(it.toJson()) } })
        .put("distances", JSONArray().also { array -> distancesMeters.forEach { array.put(it) } })
        .put("length", lengthMeters).put("min", minAltitudeMeters)
        .put("max", maxAltitudeMeters).put("closed", closed)
}

data class NativeSectionSnapshot(
    val settings: JSONObject,
    val curves: List<NativeSectionCurve>,
    val createdAtEpochMs: Long,
    val samples: Int,
    val validTerrainSamples: Int,
    val spacingMeters: Double,
    val intersectingModels: Int,
    val skippedGroundlessModels: Int,
    val phase: String,
    val terrainSources: Set<String>,
) {
    /** Exact field names consumed by the existing section profile/chart component. */
    fun toProfileJson() = JSONObject()
        .put("settings", JSONObject(settings.toString()))
        .put("curves", JSONArray().also { array -> curves.forEach { array.put(it.toJson()) } })
        .put("createdAt", createdAtEpochMs).put("valid", validTerrainSamples)
        .put("samples", samples).put("spacing", spacingMeters).put("phase", phase)
}

/** CPU section sampling that mirrors modules/section/contours.ts; absent terrain never becomes zero. */
object NativeSectionEngine {
    const val GRID_COLUMNS = 80
    const val GRID_ROWS = 40
    const val MAX_GRID_SAMPLES = (GRID_COLUMNS + 1) * (GRID_ROWS + 1)
    const val DEFAULT_SPACING_METERS = 100.0
    private const val WORLD_CIRCUMFERENCE = 40_075_016.68557849
    private const val MAX_MODEL_TRIANGLES = 1_000_000

    suspend fun sample(
        settings: NativeSectionSettings,
        models: List<JSONObject>,
        elevation: NativeSectionElevationSampler,
    ): NativeSectionSnapshot {
        val coroutineContext = kotlinx.coroutines.currentCoroutineContext()
        val p = settings.plane
        val basis = basis(p.headingDegrees, p.tiltDegrees, p.rollDegrees)
        val anchor = mercator(p.longitude, p.latitude)
        val vertices = ArrayList<LocalPoint>(MAX_GRID_SAMPLES)
        val heights = DoubleArray(MAX_GRID_SAMPLES) { Double.NaN }
        val sources = linkedSetOf<String>()
        var valid = 0
        var index = 0
        for (row in 0..GRID_ROWS) {
            coroutineContext.ensureActive()
            for (column in 0..GRID_COLUMNS) {
                val u = (column.toDouble() / GRID_COLUMNS - 0.5) * p.widthMeters
                val v = (row.toDouble() / GRID_ROWS - 0.5) * p.heightMeters
                val local = basis.u * u + basis.v * v
                vertices += local
                val lonLat = toCoordinate(anchor, local.x, local.y)
                val sample = if (lonLat.second !in -85.0..85.0) null else try {
                    elevation.sample(lonLat.second, lonLat.first)
                } catch (error: kotlinx.coroutines.CancellationException) {
                    throw error
                } catch (error: NativeSectionTileBudgetExceededException) {
                    throw error
                } catch (error: NativeSectionTileLoadException) {
                    throw error
                }
                val meters = sample?.elevationMeters
                if (meters != null && meters.isFinite() && meters in -12_000.0..10_000.0) {
                    heights[index] = meters
                    valid++
                    sample.source?.takeIf(String::isNotBlank)?.let(sources::add)
                }
                index++
            }
        }
        val terrainSegments = mutableListOf<Pair<LocalPoint, LocalPoint>>()
        fun node(x: Int, y: Int) = y * (GRID_COLUMNS + 1) + x
        for (y in 0 until GRID_ROWS) for (x in 0 until GRID_COLUMNS) {
            val ids = intArrayOf(node(x, y), node(x + 1, y), node(x + 1, y + 1), node(x, y + 1))
            val cellHeights = ids.map { heights[it] }
            if (cellHeights.any { !it.isFinite() }) continue
            val cell = ids.mapIndexed { i, id ->
                val ll = toCoordinate(anchor, vertices[id].x, vertices[id].y)
                val scale = mercator(ll.first, ll.second).unit / anchor.unit
                // Compare the section plane's absolute height with real DEM altitude,
                // matching the existing web sampler. Returned points stay on the plane.
                TerrainVertex(vertices[id], settings.altitudeMeters + vertices[id].z - cellHeights[i] * scale)
            }
            // Match the web grid's diagonal: (a,b,c) and (b,d,c).
            terrainSegments += terrainTriangleCrossing(cell[0], cell[1], cell[3])
            terrainSegments += terrainTriangleCrossing(cell[1], cell[2], cell[3])
        }
        val curves = mutableListOf<NativeSectionCurve>()
        curves += stitch(terrainSegments, settings, anchor, basis, "terrain", "地形", "terrain")
        var intersectingModels = 0
        var skippedGroundless = 0
        for (model in models) {
            coroutineContext.ensureActive()
            val mesh = NativeModelRenderer.sectionMesh(model)
            if (mesh == null) {
                if (model.optBoolean("visible", true) && model.optString("kind") in setOf("box", "sphere", "cylinder", "prism") && !hasGround(model)) skippedGroundless++
                continue
            }
            if (mesh.triangles.size / 3 > MAX_MODEL_TRIANGLES) continue
            val transformed = mesh.vertices.map { vertex ->
                val point = mercator(vertex.longitude, vertex.latitude)
                val dxWorld = point.x - anchor.x
                val wrapped = dxWorld - kotlin.math.round(dxWorld)
                LocalPoint(wrapped / anchor.unit, (anchor.y - point.y) / anchor.unit,
                    vertex.altitudeMeters * point.unit / anchor.unit - settings.altitudeMeters)
            }
            val modelSegments = mutableListOf<Pair<LocalPoint, LocalPoint>>()
            for (i in mesh.triangles.indices step 3) {
                if (i and 0x3fff == 0) coroutineContext.ensureActive()
                val a = transformed[mesh.triangles[i]]
                val b = transformed[mesh.triangles[i + 1]]
                val c = transformed[mesh.triangles[i + 2]]
                val segment = triangleCrossing(a, b, c, basis.normal) ?: continue
                clipToPlane(segment.first, segment.second, basis, p)?.let(modelSegments::add)
            }
            val modelCurves = stitch(modelSegments, settings, anchor, basis, "model", model.optString("name", "模型"), "model:${mesh.id}")
            if (modelCurves.isNotEmpty()) intersectingModels++
            curves += modelCurves
        }
        val phase = if (valid == MAX_GRID_SAMPLES) "ready" else "partial"
        return NativeSectionSnapshot(
            JSONObject(settings.json.toString()), curves, System.currentTimeMillis(),
            MAX_GRID_SAMPLES, valid, max(p.widthMeters / GRID_COLUMNS, p.heightMeters / GRID_ROWS),
            intersectingModels, skippedGroundless, phase, sources.toSet(),
        )
    }

    private data class LocalPoint(val x: Double, val y: Double, val z: Double) {
        operator fun plus(other: LocalPoint) = LocalPoint(x + other.x, y + other.y, z + other.z)
        operator fun times(scale: Double) = LocalPoint(x * scale, y * scale, z * scale)
        fun dot(other: LocalPoint) = x * other.x + y * other.y + z * other.z
        fun lerp(other: LocalPoint, t: Double) = this * (1.0 - t) + other * t
        fun distance(other: LocalPoint) = sqrt((x - other.x) * (x - other.x) + (y - other.y) * (y - other.y) + (z - other.z) * (z - other.z))
    }
    private data class TerrainVertex(val point: LocalPoint, val distance: Double)
    private data class Basis(val u: LocalPoint, val v: LocalPoint, val normal: LocalPoint)
    private data class Mercator(val x: Double, val y: Double, val unit: Double)

    private fun basis(heading: Double, tilt: Double, roll: Double): Basis {
        val h = heading * PI / 180.0
        val t = tilt * PI / 180.0
        var u = LocalPoint(cos(h), sin(h), 0.0)
        var v = LocalPoint(-sin(h) * sin(t), cos(h) * sin(t), cos(t))
        val n0 = LocalPoint(u.y * v.z - u.z * v.y, u.z * v.x - u.x * v.z, u.x * v.y - u.y * v.x)
        val norm = sqrt(n0.dot(n0)).coerceAtLeast(1e-15)
        val n = n0 * (1.0 / norm)
        fun rotateAxis(value: LocalPoint): LocalPoint {
            val angle = roll * PI / 180.0
            val c = cos(angle); val s = sin(angle)
            return value * c + cross(n, value) * s + n * (n.dot(value) * (1.0 - c))
        }
        u = rotateAxis(u); v = rotateAxis(v)
        return Basis(u, v, n)
    }

    private fun cross(a: LocalPoint, b: LocalPoint) = LocalPoint(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)
    private fun mercator(lon: Double, lat: Double): Mercator {
        val clamped = lat.coerceIn(-85.0, 85.0) * PI / 180.0
        return Mercator((lon + 180.0) / 360.0, (1.0 - ln(kotlin.math.tan(PI / 4.0 + clamped / 2.0)) / PI) / 2.0,
            1.0 / (WORLD_CIRCUMFERENCE * cos(clamped)))
    }
    private fun toCoordinate(anchor: Mercator, x: Double, y: Double): Pair<Double, Double> {
        val worldX = anchor.x + x * anchor.unit
        val worldY = anchor.y + y * anchor.unit
        val lon = (((worldX * 360.0 - 180.0 + 180.0) % 360.0 + 360.0) % 360.0) - 180.0
        return lon to (atan(sinh(PI * (1.0 - 2.0 * worldY))) * 180.0 / PI)
    }
    private fun terrainTriangleCrossing(a: TerrainVertex, b: TerrainVertex, c: TerrainVertex): List<Pair<LocalPoint, LocalPoint>> {
        val points = listOf(a, b, c)
        val hits = mutableListOf<LocalPoint>()
        for (i in 0..2) {
            val first = points[i]; val second = points[(i + 1) % 3]
            val da = first.distance; val db = second.distance
            if (abs(da) <= 1e-7 && hits.none { it.distance(first.point) <= 1e-7 }) hits += first.point
            if ((da < -1e-7 && db > 1e-7) || (da > 1e-7 && db < -1e-7)) {
                val hit = first.point.lerp(second.point, da / (da - db))
                if (hits.none { it.distance(hit) <= 1e-7 }) hits += hit
            }
        }
        return if (hits.size == 2 && hits[0].distance(hits[1]) > 1e-7) listOf(hits[0] to hits[1]) else emptyList()
    }
    private fun triangleCrossing(a: LocalPoint, b: LocalPoint, c: LocalPoint, normal: LocalPoint): Pair<LocalPoint, LocalPoint>? {
        val points = listOf(a, b, c)
        val distances = points.map { it.dot(normal) }
        val hits = mutableListOf<LocalPoint>()
        for (i in 0..2) {
            val j = (i + 1) % 3; val da = distances[i]; val db = distances[j]
            if (abs(da) <= 1e-7 && hits.none { it.distance(points[i]) <= 1e-7 }) hits += points[i]
            if ((da < -1e-7 && db > 1e-7) || (da > 1e-7 && db < -1e-7)) {
                val hit = points[i].lerp(points[j], da / (da - db))
                if (hits.none { it.distance(hit) <= 1e-7 }) hits += hit
            }
        }
        return if (hits.size == 2 && hits[0].distance(hits[1]) > 1e-7) hits[0] to hits[1] else null
    }

    private fun clipToPlane(a: LocalPoint, b: LocalPoint, basis: Basis, plane: NativeSectionPlane): Pair<LocalPoint, LocalPoint>? {
        var lo = 0.0; var hi = 1.0
        for ((axis, half) in listOf(basis.u to plane.widthMeters / 2.0, basis.v to plane.heightMeters / 2.0)) {
            val start = a.dot(axis); val delta = b.dot(axis) - start
            if (abs(delta) < 1e-12) { if (abs(start) > half + 1e-7) return null }
            else {
                val t0 = (-half - start) / delta; val t1 = (half - start) / delta
                lo = max(lo, min(t0, t1)); hi = min(hi, max(t0, t1))
                if (hi <= lo) return null
            }
        }
        return a.lerp(b, lo) to a.lerp(b, hi)
    }

    private fun stitch(
        raw: List<Pair<LocalPoint, LocalPoint>>, settings: NativeSectionSettings, anchor: Mercator,
        basis: Basis, source: String, name: String, id: String,
    ): List<NativeSectionCurve> {
        if (raw.isEmpty()) return emptyList()
        val key = { p: LocalPoint -> "${(p.x * 1e5).toLong()},${(p.y * 1e5).toLong()},${(p.z * 1e5).toLong()}" }
        val links = mutableMapOf<String, MutableList<Int>>()
        val segments = mutableListOf<Pair<LocalPoint, LocalPoint>>()
        val seen = mutableSetOf<String>()
        for ((a, b) in raw) {
            val ka = key(a); val kb = key(b)
            if (ka == kb) continue
            val segmentKey = if (ka < kb) "$ka|$kb" else "$kb|$ka"
            if (!seen.add(segmentKey)) continue
            val i = segments.size; segments += a to b
            links.getOrPut(ka) { mutableListOf() } += i
            links.getOrPut(kb) { mutableListOf() } += i
        }
        val used = BooleanArray(segments.size)
        val paths = mutableListOf<List<LocalPoint>>()
        fun walk(startKey: String, first: Int) {
            val startPoint = segments[first].let { if (key(it.first) == startKey) it.first else it.second }
            val path = mutableListOf(startPoint)
            var at = startKey; var edge = first
            while (!used[edge]) {
                used[edge] = true
                val pair = segments[edge]
                val nextPoint = if (key(pair.first) == at) pair.second else pair.first
                path += nextPoint
                at = key(nextPoint)
                edge = links[at]?.firstOrNull { !used[it] } ?: break
            }
            if (path.size >= 2) paths += path
        }
        links.forEach { (vertex, edges) -> if (edges.size != 2) edges.forEach { if (!used[it]) walk(vertex, it) } }
        segments.indices.forEach { if (!used[it]) walk(key(segments[it].first), it) }
        return paths.mapIndexedNotNull { index, path ->
            val points = path.map { local ->
                val ll = toCoordinate(anchor, local.x, local.y)
                val ratio = anchor.unit / mercator(ll.first, ll.second).unit
                NativeSectionPoint(
                    local.dot(basis.u), local.dot(basis.v), listOf(local.x, local.y, local.z),
                    ll.first, ll.second, (settings.altitudeMeters + local.z) * ratio,
                )
            }
            val distances = mutableListOf(0.0)
            for (i in 1 until points.size) {
                val p0 = points[i - 1]; val p1 = points[i]
                distances += distances.last() + sqrt((p1.local[0] - p0.local[0]).let { it * it } +
                    (p1.local[1] - p0.local[1]).let { it * it } + (p1.local[2] - p0.local[2]).let { it * it })
            }
            val contourPoints = points.mapIndexed { i, point -> point.copy(distanceMeters = distances[i]) }
            NativeSectionCurve(
                "$id:$index", "$name · ${index + 1}", source, contourPoints, distances,
                distances.last(), contourPoints.minOf { it.altitudeMeters }, contourPoints.maxOf { it.altitudeMeters },
                contourPoints.first().let { first -> val last = contourPoints.last(); hypot(first.longitude - last.longitude, first.latitude - last.latitude) < 1e-7 &&
                    hypot(first.local[0] - last.local[0], first.local[1] - last.local[1]) < 1e-3 },
            )
        }
    }

    private fun hasGround(model: JSONObject): Boolean =
        (model.has("groundElevation") && !model.isNull("groundElevation") && model.optDouble("groundElevation", Double.NaN).isFinite()) ||
            (model.has("centerAltitude") && !model.isNull("centerAltitude") && model.optDouble("centerAltitude", Double.NaN).isFinite())
}
