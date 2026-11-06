package com.shantu.nativeapp.hybrid

import com.shantu.nativeapp.geology.NativeMvtDecoder
import com.shantu.nativeapp.geology.NativeMvtFeature
import com.shantu.nativeapp.map.NativeCartographyLayers
import com.shantu.nativeapp.map.NativeCachedSnapTile
import earth.worldwind.WorldWindow
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.PI
import kotlin.math.atan
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.sinh
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Supplies only real OpenFreeMap line geometry already present in the cartography tile cache.
 * snapshot() is synchronous and never initiates a network request; call it from the bridge's
 * snap-geometry request/event path with bounds derived from the same WorldWindow viewport.
 */
class NativeBridgeSnapGeometry(
    private val window: WorldWindow,
    private val cartography: NativeCartographyLayers,
) : AutoCloseable {
    private data class CachedDecode(val token: Any, val features: List<NativeMvtFeature>)
    private data class SnapshotRequest(
        val key: String,
        val revision: Long,
        val bounds: List<Double>,
        val enabledRoad: Boolean,
        val enabledRiver: Boolean,
        val sourceLayerVisible: Boolean,
    )
    private data class SnapshotResult(val payload: JSONObject)

    private val decoded = linkedMapOf<String, CachedDecode>()
    private val observations = CopyOnWriteArraySet<AutoCloseable>()
    private val tileListeners = CopyOnWriteArraySet<(z: Int, x: Int, y: Int) -> Unit>()
    private val snapshotReady = NativeSnapGeometryReadySignal()
    private val stateLock = Any()
    private val worker = NativeSnapGeometryWorkQueue<SnapshotResult>(NativeSnapGeometryExecutors.shared,
        onResult = ::onComputed, onError = ::onComputeFailed, shutdownExecutorOnClose = false)
    private var latestRevision = Long.MIN_VALUE
    private var tileGeneration = 0L
    private var latestKey: String? = null
    private var scheduledKey: String? = null
    private var completedKey: String? = null
    private var completedPayload: JSONObject? = null
    private var latestRequest: SnapshotRequest? = null
    @Volatile private var closed = false

    fun snapshot(
        cameraRevision: Long,
        viewportBoundsWgs84: List<Double>?,
        enabledRoad: Boolean,
        enabledRiver: Boolean,
    ): JSONObject {
        if (closed) return response(cameraRevision, Status.BLOCKED, emptyList(), Status.BLOCKED, emptyList(), "closed")
        synchronized(stateLock) {
            if (cameraRevision < latestRevision) return response(cameraRevision, Status.BLOCKED, emptyList(), Status.BLOCKED, emptyList(), "stale_camera_revision")
            latestRevision = cameraRevision
        }
        if (!enabledRoad && !enabledRiver)
            return response(cameraRevision, Status.HIDDEN, emptyList(), Status.HIDDEN, emptyList())
        val bounds = viewportBoundsWgs84
        if (!validBounds(bounds) || window.engine.viewport.width <= 0 || window.engine.viewport.height <= 0)
            return response(cameraRevision, if (enabledRoad) Status.LOADING else Status.HIDDEN, emptyList(), if (enabledRiver) Status.LOADING else Status.HIDDEN, emptyList(), "viewport_unavailable")
        val copiedBounds = bounds!!.toList()
        val sourceVisible = cartography.snapSourceVisible()
        val request: SnapshotRequest
        val alreadyCompleted: JSONObject?
        val enqueue: Boolean
        synchronized(stateLock) {
            val key = buildString {
                append(cameraRevision).append('|').append(copiedBounds.joinToString(","))
                append('|').append(enabledRoad).append('|').append(enabledRiver).append('|').append(sourceVisible)
                append('|').append(tileGeneration)
            }
            request = SnapshotRequest(key, cameraRevision, copiedBounds, enabledRoad, enabledRiver, sourceVisible)
            latestKey = key
            latestRequest = request
            alreadyCompleted = if (completedKey == key) completedPayload else null
            enqueue = alreadyCompleted == null && scheduledKey != key
            if (enqueue) scheduledKey = key
        }
        if (alreadyCompleted != null) return alreadyCompleted
        if (enqueue) {
            val accepted = worker.submit(request.key) { computeSnapshot(request) }
            if (!accepted) synchronized(stateLock) { if (scheduledKey == request.key) scheduledKey = null }
        }
        return response(cameraRevision,
            if (enabledRoad && sourceVisible) Status.LOADING else Status.HIDDEN,
            emptyList(), if (enabledRiver && sourceVisible) Status.LOADING else Status.HIDDEN, emptyList(), "geometry_processing")
    }

    /** Notify the host that a real vector tile arrived; it may request a fresh revision snapshot. */
    fun observeTileLoads(onLoaded: (z: Int, x: Int, y: Int) -> Unit): AutoCloseable? {
        if (closed) return null
        val handle = cartography.observeSnapTileFetches { tile ->
            if (closed) return@observeSnapTileFetches
            synchronized(stateLock) { tileGeneration++ }
            runCatching { onLoaded(tile.z, tile.x, tile.y) }
        } ?: return null
        tileListeners += onLoaded
        observations += handle
        return AutoCloseable {
            tileListeners -= onLoaded
            observations.remove(handle)
            runCatching { handle.close() }
        }
    }

    /** Completion signal for every current snapshot result, including empty/blocked/error states. */
    fun observeSnapshotsReady(onReady: () -> Unit): AutoCloseable? =
        if (closed) null else snapshotReady.observe(onReady)

    private fun computeSnapshot(request: SnapshotRequest): SnapshotResult {
        if (closed) return SnapshotResult(response(request.revision, Status.BLOCKED, emptyList(), Status.BLOCKED, emptyList(), "closed"))
        val tiles = try { cartography.cachedSnapTiles(request.bounds) }
            catch (_: Exception) { null }
            ?: return SnapshotResult(response(request.revision,
                if (request.enabledRoad && request.sourceLayerVisible) Status.MISSING else Status.HIDDEN, emptyList(),
                if (request.enabledRiver && request.sourceLayerVisible) Status.MISSING else Status.HIDDEN, emptyList(), "geometry_cache_unavailable"))
        if (tiles.isEmpty()) return SnapshotResult(response(request.revision,
            if (request.enabledRoad && request.sourceLayerVisible) Status.LOADING else Status.HIDDEN, emptyList(),
            if (request.enabledRiver && request.sourceLayerVisible) Status.LOADING else Status.HIDDEN, emptyList(), "visible_tiles_not_loaded"))
        val selection = NativeSnapTileSelector.select(tiles, request.bounds, MAX_DECODED_TILES)
        val decodedTiles = decodeCached(selection.tiles)
        val roadResult = if (request.enabledRoad) NativeSnapGeometryDecoder.decodeLines(decodedTiles, request.bounds, false)
            else NativeSnapGeometryDecodeResult(emptyList(), complete = true)
        val riverResult = if (request.enabledRiver) NativeSnapGeometryDecoder.decodeLines(decodedTiles, request.bounds, true)
            else NativeSnapGeometryDecodeResult(emptyList(), complete = true)
        val roads = roadResult.lines
        val rivers = riverResult.lines
        val roadCoverageComplete = selection.coverageComplete && roadResult.complete
        val riverCoverageComplete = selection.coverageComplete && riverResult.complete
        val roadStatus = Status.valueOf(NativeSnapGeometryState.status(
            request.enabledRoad, request.sourceLayerVisible, true, tiles.isNotEmpty(), roads.size,
            roadCoverageComplete).uppercase())
        // River snapping consumes the same real tile cache independently of the road overlay toggle.
        val riverStatus = Status.valueOf(NativeSnapGeometryState.status(
            request.enabledRiver, request.sourceLayerVisible, true, tiles.isNotEmpty(), rivers.size,
            riverCoverageComplete).uppercase())
        return SnapshotResult(response(request.revision, roadStatus, roads, riverStatus, rivers,
            selection = selection, roadCoverageComplete = roadCoverageComplete, riverCoverageComplete = riverCoverageComplete))
    }

    private fun decodeCached(tiles: List<NativeCachedSnapTile>): List<Pair<NativeCachedSnapTile, List<NativeMvtFeature>>> {
        val active = tiles.map { "${it.z}/${it.x}/${it.y}" }.toSet()
        decoded.keys.filter { it !in active }.toList().forEach(decoded::remove)
        return tiles.mapNotNull { tile ->
            val key = "${tile.z}/${tile.x}/${tile.y}"
            val cached = decoded[key]
            val features = if (cached?.token === tile.cacheToken) cached.features else
                runCatching { NativeMvtDecoder.decode(tile.bytes).filter(NativeSnapGeometryDecoder::accepts) }
                    .getOrNull()?.also { decoded[key] = CachedDecode(tile.cacheToken, it) }
                    ?: return@mapNotNull null
            while (decoded.size > MAX_DECODED_TILES) decoded.remove(decoded.keys.first())
            tile to features
        }
    }

    private fun onComputed(key: String, result: SnapshotResult) {
        if (closed) return
        val current = synchronized(stateLock) {
            if (latestKey != key || closed) return
            completedKey = key
            completedPayload = result.payload
            scheduledKey = null
            true
        }
        if (current) snapshotReady.signal()
    }

    private fun onComputeFailed(key: String, _error: Exception) {
        if (closed) return
        val current = synchronized(stateLock) {
            if (latestKey != key) return
            val request = latestRequest?.takeIf { it.key == key } ?: return
            completedKey = key
            completedPayload = response(request.revision,
                if (request.enabledRoad && request.sourceLayerVisible) Status.MISSING else Status.HIDDEN, emptyList(),
                if (request.enabledRiver && request.sourceLayerVisible) Status.MISSING else Status.HIDDEN, emptyList(), "geometry_processing_failed")
            scheduledKey = null
            true
        }
        if (current) snapshotReady.signal()
    }

    private fun validBounds(b: List<Double>?): Boolean = b != null && b.size == 4 && b.all(Double::isFinite) &&
        b[0] >= -180 && b[2] <= 180 && b[1] >= -85.051129 && b[3] <= 85.051129 && b[0] <= b[2] && b[1] <= b[3]

    private fun response(revision: Long, roadStatus: Status, roads: List<NativeSnapLine>, riverStatus: Status,
        rivers: List<NativeSnapLine>, reason: String? = null, selection: NativeSnapTileSelection? = null,
        roadCoverageComplete: Boolean? = null, riverCoverageComplete: Boolean? = null) = JSONObject().put("cameraRevision", revision)
        .put("road", geometryJson(roadStatus, roads, selection, roadCoverageComplete))
        .put("river", geometryJson(riverStatus, rivers, selection, riverCoverageComplete))
        .apply {
            if (reason != null) put("reason", reason)
            if (selection != null) {
                // Keep the existing top-level diagnostics while making coverage local to
                // each geometry state for consumers that process road and river separately.
                put("sourceZoom", selection.sourceZoom ?: JSONObject.NULL)
                put("selectedTileCount", selection.tiles.size)
                put("coverageComplete", (roadCoverageComplete ?: selection.coverageComplete) &&
                    (riverCoverageComplete ?: selection.coverageComplete))
            }
        }

    private fun geometryJson(status: Status, lines: List<NativeSnapLine>, selection: NativeSnapTileSelection?, coverageComplete: Boolean?) =
        JSONObject().put("status", status.value).put("lines", linesJson(lines))
            .put("coverageComplete", coverageComplete ?: selection?.coverageComplete ?: JSONObject.NULL)
            .put("sourceZoom", selection?.sourceZoom ?: JSONObject.NULL)
            .put("selectedTileCount", selection?.tiles?.size ?: 0)

    private fun linesJson(lines: List<NativeSnapLine>) = JSONArray().also { array -> lines.forEach { line ->
        array.put(JSONObject().put("id", line.id).put("name", line.name).put("level", line.level)
            .put("coordinates", JSONArray().also { coords -> line.coordinates.forEach { p -> coords.put(JSONArray().put(p.first).put(p.second)) } }))
    } }

    override fun close() {
        if (closed) return
        closed = true
        worker.close()
        observations.toList().forEach { runCatching { it.close() } }
        observations.clear()
        tileListeners.clear()
        snapshotReady.close()
        // The worker owns decoded; avoid blocking lifecycle/main thread waiting for its decode.
    }

    private enum class Status(val value: String) {
        READY("ready"), PARTIAL("partial"), LOADING("loading"), HIDDEN("hidden"), MISSING("missing"), BLOCKED("blocked")
    }

    private companion object { const val MAX_DECODED_TILES = 24 }
}

/** Selects one source resolution so cached parent/child road copies are never emitted together. */
internal data class NativeSnapTileSelection(
    val sourceZoom: Int?,
    val tiles: List<NativeCachedSnapTile>,
    val coverageComplete: Boolean,
)

internal object NativeSnapTileSelector {
    private const val MAX_SOURCE_ZOOM = 14
    private const val MAX_MERCATOR_LATITUDE = 85.051129

    /** Highest available source level first, then tiles nearest the viewport center, then stable XYZ order. */
    fun select(tiles: List<NativeCachedSnapTile>, bounds: List<Double>, maxTiles: Int): NativeSnapTileSelection {
        require(bounds.size == 4 && bounds.all(Double::isFinite) && bounds[0] <= bounds[2] && bounds[1] <= bounds[3])
        require(maxTiles > 0)
        val candidates = tiles.asSequence()
            .filter { it.z in 0..MAX_SOURCE_ZOOM && it.x in 0 until (1 shl it.z) && it.y in 0 until (1 shl it.z) }
            .filter { intersectsBounds(it, bounds) }
            .distinctBy { "${it.z}/${it.x}/${it.y}" }
            .toList()
        if (candidates.isEmpty()) return NativeSnapTileSelection(null, emptyList(), false)
        val centerX = ((bounds[0] + bounds[2]) / 2.0 + 180.0) / 360.0
        val centerY = (mercatorY(bounds[1]) + mercatorY(bounds[3])) / 2.0
        val centerOrder = compareBy<NativeCachedSnapTile> {
                val n = 1 shl it.z
                val dx = (it.x + 0.5) / n - centerX
                val dy = (it.y + 0.5) / n - centerY
                dx * dx + dy * dy
            }.thenBy { it.y }.thenBy { it.x }
        val byZoom = candidates.groupBy { it.z }

        // Prefer the finest cached level that completely covers the viewport. This avoids
        // discarding usable parent coverage when only a few child tiles have arrived.
        for (zoom in byZoom.keys.sortedDescending()) {
            val expected = expectedTileKeys(bounds, zoom, maxTiles) ?: continue
            val tilesAtZoom = byZoom.getValue(zoom)
            val byKey = tilesAtZoom.associateBy { "${it.z}/${it.x}/${it.y}" }
            if (expected.all(byKey::containsKey)) {
                val complete = expected.mapNotNull(byKey::get).sortedWith(centerOrder)
                return NativeSnapTileSelection(zoom, complete, true)
            }
        }

        // No cached resolution is complete: expose only the nearest bounded set from the
        // finest available level, and preserve the incomplete-coverage fact for the UI.
        val highestZoom = byZoom.keys.maxOrNull() ?: return NativeSnapTileSelection(null, emptyList(), false)
        val selected = byZoom.getValue(highestZoom).sortedWith(centerOrder).take(maxTiles)
        val expected = expectedTileKeys(bounds, highestZoom, maxTiles)
        val selectedKeys = selected.mapTo(mutableSetOf()) { "${it.z}/${it.x}/${it.y}" }
        return NativeSnapTileSelection(highestZoom, selected, expected != null && selectedKeys == expected)
    }

    /** Null means more tiles intersect the viewport than the bounded selection can prove complete. */
    private fun expectedTileKeys(bounds: List<Double>, zoom: Int, maxTiles: Int): Set<String>? {
        val n = 1 shl zoom
        val minX = ceil((bounds[0] + 180.0) / 360.0 * n - 1.0).toInt().coerceIn(0, n - 1)
        val maxX = floor((bounds[2] + 180.0) / 360.0 * n).toInt().coerceIn(0, n - 1)
        val minY = ceil(mercatorY(bounds[3]) * n - 1.0).toInt().coerceIn(0, n - 1)
        val maxY = floor(mercatorY(bounds[1]) * n).toInt().coerceIn(0, n - 1)
        val width = (maxX - minX + 1).coerceAtLeast(0)
        val height = (maxY - minY + 1).coerceAtLeast(0)
        if (width.toLong() * height > maxTiles) return null
        return buildSet(width * height) {
            for (y in minY..maxY) for (x in minX..maxX) add("$zoom/$x/$y")
        }
    }

    private fun intersectsBounds(tile: NativeCachedSnapTile, bounds: List<Double>): Boolean {
        val n = 1 shl tile.z
        val west = tile.x.toDouble() / n * 360.0 - 180.0
        val east = (tile.x + 1.0) / n * 360.0 - 180.0
        fun latitude(row: Double) = Math.toDegrees(atan(sinh(PI * (1.0 - 2.0 * row / n))))
        val north = latitude(tile.y.toDouble())
        val south = latitude(tile.y + 1.0)
        return !(east < bounds[0] || west > bounds[2] || north < bounds[1] || south > bounds[3])
    }

    private fun mercatorY(latitude: Double): Double {
        val radians = Math.toRadians(latitude.coerceIn(-MAX_MERCATOR_LATITUDE, MAX_MERCATOR_LATITUDE))
        return 0.5 - ln((1.0 + kotlin.math.sin(radians)) / (1.0 - kotlin.math.sin(radians))) / (4.0 * PI)
    }
}

internal data class NativeSnapLine(val id: String, val name: String, val level: Int, val coordinates: List<Pair<Double, Double>>)
internal data class NativeSnapGeometryDecodeResult(val lines: List<NativeSnapLine>, val complete: Boolean)

/** Callback-only completion signal; it carries no fabricated tile identity or geometry payload. */
internal class NativeSnapGeometryReadySignal : AutoCloseable {
    private val listeners = CopyOnWriteArraySet<() -> Unit>()
    @Volatile private var closed = false

    fun observe(listener: () -> Unit): AutoCloseable? {
        if (closed) return null
        listeners += listener
        if (closed) {
            listeners -= listener
            return null
        }
        return AutoCloseable { listeners -= listener }
    }

    fun signal() {
        if (closed) return
        listeners.forEach { listener -> if (!closed) runCatching(listener) }
    }

    override fun close() {
        closed = true
        listeners.clear()
    }
}

/** Single-worker latest-only queue: expensive cache enumeration/decoding never runs on the caller. */
internal class NativeSnapGeometryWorkQueue<T>(
    private val executor: ExecutorService,
    private val onResult: (key: String, result: T) -> Unit,
    private val onError: (key: String, error: Exception) -> Unit = { _, _ -> },
    private val shutdownExecutorOnClose: Boolean = true,
) : AutoCloseable {
    private data class Work<T>(val key: String, val task: () -> T)
    private val lock = Any()
    private var pending: Work<T>? = null
    private var draining = false
    private var closed = false

    /** Replaces any queued-but-not-started request with the most recent viewport snapshot. */
    fun submit(key: String, task: () -> T): Boolean {
        val shouldStart = synchronized(lock) {
            if (closed) return false
            pending = Work(key, task)
            if (draining) false else { draining = true; true }
        }
        if (shouldStart) try {
            executor.execute(::drain)
        } catch (_: Exception) {
            synchronized(lock) { draining = false; pending = null }
            return false
        }
        return true
    }

    private fun drain() {
        while (true) {
            val work = synchronized(lock) {
                if (closed) { pending = null; draining = false; null }
                else pending.also { pending = null; if (it == null) draining = false }
            } ?: return
            val result = try { work.task() } catch (error: Exception) {
                runCatching { onError(work.key, error) }
                continue
            }
            runCatching { onResult(work.key, result) }
        }
    }

    override fun close() {
        synchronized(lock) { closed = true; pending = null }
        if (shutdownExecutorOnClose) executor.shutdownNow()
    }
}

/** A single process worker bounds aggregate decode concurrency across primary and comparison maps. */
internal object NativeSnapGeometryExecutors {
    val shared: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "native-snap-geometry").apply { isDaemon = true }
    }
}

internal object NativeSnapGeometryState {
    fun status(
        enabled: Boolean,
        layerVisible: Boolean,
        viewportKnown: Boolean,
        cacheAvailable: Boolean,
        lines: Int,
        coverageComplete: Boolean = true,
    ): String = when {
        !enabled || !layerVisible -> "hidden"
        !viewportKnown || !cacheAvailable -> "loading"
        !coverageComplete -> "partial"
        lines <= 0 -> "missing"
        else -> "ready"
    }
}

/** MVT decoding and conversion helpers are pure so fixtures can exercise the real bridge contract. */
internal object NativeSnapGeometryDecoder {
    private val roadClasses = setOf("motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service", "track", "path", "steps", "pedestrian")
    private val riverClasses = setOf("river", "stream", "canal")
    private const val MAX_POINTS = 6000
    internal const val MAX_FEATURES_SCANNED = 12_000
    internal const val MAX_PATHS_SCANNED = 12_000

    fun accepts(feature: NativeMvtFeature): Boolean {
        if (feature.type != 2) return false
        return when (feature.layer) {
            "transportation" -> feature.properties["class"].orEmpty() in roadClasses
            "waterway" -> feature.properties["class"].orEmpty() in riverClasses
            else -> false
        }
    }

    fun lines(tiles: List<Pair<NativeCachedSnapTile, List<NativeMvtFeature>>>, bounds: List<Double>, river: Boolean): List<NativeSnapLine> =
        decodeLines(tiles, bounds, river).lines

    fun decodeLines(tiles: List<Pair<NativeCachedSnapTile, List<NativeMvtFeature>>>, bounds: List<Double>, river: Boolean): NativeSnapGeometryDecodeResult {
        val output = linkedMapOf<String, NativeSnapLine>(); var count = 0; var featuresScanned = 0; var pathsScanned = 0
        var complete = true
        tileLoop@ for ((tile, features) in tiles) {
            val n = 1 shl tile.z
            for (feature in features) {
                if (++featuresScanned > MAX_FEATURES_SCANNED || count >= MAX_POINTS) {
                    complete = false
                    break@tileLoop
                }
                val acceptedLayer = if (river) feature.layer == "waterway" else feature.layer == "transportation"
                if (!acceptedLayer || feature.type != 2) continue
                val clazz = feature.properties["class"].orEmpty()
                if (!(if (river) clazz in riverClasses else clazz in roadClasses)) continue
                val level = feature.properties["layer"]?.toIntOrNull() ?: 0
                val rawName = feature.properties["name:zh"]?.takeIf(String::isNotBlank) ?: feature.properties["name"].orEmpty()
                for (path in feature.paths) {
                    if (++pathsScanned > MAX_PATHS_SCANNED || count >= MAX_POINTS) {
                        complete = false
                        break@tileLoop
                    }
                    if (path.size < 2) continue
                    if (count + path.size > MAX_POINTS) {
                        complete = false
                        continue
                    }
                    val coords = path.map { (x, y) ->
                        val gx = tile.x + x.toDouble() / feature.extent
                        val gy = tile.y + y.toDouble() / feature.extent
                        val lon = gx / n * 360.0 - 180.0
                        val lat = Math.toDegrees(atan(sinh(PI * (1.0 - 2.0 * gy / n))))
                        lon to lat
                    }
                    if (!coords.all { it.first.isFinite() && it.second.isFinite() }) continue
                    // MVT lines may extend beyond the viewport tile edge; retain their actual
                    // vertices when any part intersects the requested viewport.
                    if (coords.maxOf { it.first } < bounds[0] || coords.minOf { it.first } > bounds[2] ||
                        coords.maxOf { it.second } < bounds[1] || coords.minOf { it.second } > bounds[3]) continue
                    val namespace = if (river) "waterway:" else ""
                    val id = namespace + "$level:" + coords.joinToString(";") { "${it.first},${it.second}" }
                    if (id in output) continue
                    output[id] = NativeSnapLine(id, rawName.take(60), level, coords)
                    count += coords.size
                }
            }
        }
        return NativeSnapGeometryDecodeResult(output.values.toList(), complete)
    }
}
