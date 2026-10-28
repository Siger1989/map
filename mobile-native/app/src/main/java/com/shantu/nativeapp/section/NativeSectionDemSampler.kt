package com.shantu.nativeapp.section

import com.shantu.nativeapp.map.NativeTerrariumCoverage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import java.util.LinkedHashMap
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.tan

/** A single section run is bounded to 80 unique Mercator tiles and a small resident LRU. */
internal class NativeSectionDemSampler internal constructor(
    private val tileLoader: suspend (zoom: Int, x: Int, y: Int) -> DoubleArray?,
    private val maxUniqueTiles: Int = MAX_UNIQUE_TILES,
    private val residentTiles: Int = RESIDENT_TILES,
) : NativeSectionElevationSampler, AutoCloseable {
    constructor(coverage: NativeTerrariumCoverage) : this(
        { z, x, y -> coverage.sampleMercatorTile(z, x, y, TILE_SIZE) },
    )

    init {
        require(maxUniqueTiles in 1..MAX_UNIQUE_TILES)
        require(residentTiles in 1..RESIDENT_TILES)
    }

    private val tiles = object : LinkedHashMap<TileKey, DoubleArray>(residentTiles, .75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<TileKey, DoubleArray>?): Boolean = size > residentTiles
    }
    private val requested = HashSet<TileKey>()
    private var closed = false
    var selectedZoom: Int? = null
        private set
    val requestedTileCount: Int get() = requested.size
    val residentTileCount: Int get() = tiles.size

    override suspend fun sample(latitude: Double, longitude: Double): NativeSectionElevationSample? {
        check(!closed) { "剖面高程采样器已关闭" }
        currentCoroutineContext().ensureActive()
        if (!latitude.isFinite() || latitude !in -85.05112878..85.05112878 || !longitude.isFinite()) return null
        val z = selectedZoom ?: chooseZoom(latitude, NativeSectionEngine.DEFAULT_SPACING_METERS).also { selectedZoom = it }
        return bilinear(z, longitude, latitude)?.let { NativeSectionElevationSample(it, SOURCE_LABEL) }
    }

    /** Select zoom from the actual plane footprint and sampling interval before calling Engine. */
    fun prepare(settings: NativeSectionSettings): Int {
        check(!closed) { "剖面高程采样器已关闭" }
        val p = settings.plane
        val spacing = maxOf(p.widthMeters / NativeSectionEngine.GRID_COLUMNS, p.heightMeters / NativeSectionEngine.GRID_ROWS)
        return chooseZoom(p.latitude, spacing).also { selectedZoom = it }
    }

    /** Match the original survey corridor's single shared DEM zoom for its 257x49 grid. */
    fun prepareSurvey(line: NativeSurveyLine): Int {
        check(!closed) { "剖面高程采样器已关闭" }
        val range = line.range()
        val spacing = maxOf((range.second - range.first) / (NativeSurveySectionEngine.COLUMNS - 1),
            (line.halfWidthMeters * 2) / (NativeSurveySectionEngine.ROWS - 1))
        return chooseZoom(line.a.second, spacing).also { selectedZoom = it }
    }

    suspend fun sampleSurvey(line: NativeSurveyLine): NativeSurveyTerrain {
        val zoom = prepareSurvey(line)
        return NativeSurveySectionEngine.sample(line, this, zoom)
    }

    suspend fun sample(
        settings: NativeSectionSettings,
        models: List<org.json.JSONObject> = emptyList(),
    ): NativeSectionSnapshot {
        prepare(settings)
        return NativeSectionEngine.sample(settings, models, this)
    }

    private suspend fun bilinear(z: Int, lon: Double, lat: Double): Double? {
        val n = 1 shl z
        val worldX = ((lon + 180.0) / 360.0 * n)
        val rad = lat * PI / 180.0
        val worldY = ((1.0 - ln(tan(PI / 4.0 + rad / 2.0)) / PI) / 2.0 * n).coerceIn(0.0, n.toDouble())
        val px = worldX * TILE_SIZE - .5
        val py = worldY * TILE_SIZE - .5
        val x0 = floor(px).toInt(); val y0 = floor(py).toInt()
        val fx = px - floor(px); val fy = py - floor(py)
        val samples = listOf(
            Pixel(x0, y0, (1.0 - fx) * (1.0 - fy)), Pixel(x0 + 1, y0, fx * (1.0 - fy)),
            Pixel(x0 + 1, y0 + 1, fx * fy), Pixel(x0, y0 + 1, (1.0 - fx) * fy),
        ).filter { it.weight > 1e-12 }
        var total = 0.0
        for (pixel in samples) {
            currentCoroutineContext().ensureActive()
            val tileX = Math.floorDiv(pixel.x, TILE_SIZE)
            val wrappedX = ((tileX % n) + n) % n
            val tileY = Math.floorDiv(pixel.y, TILE_SIZE).coerceIn(0, n - 1)
            val key = TileKey(z, wrappedX, tileY)
            val bitmap = tile(key) ?: return null
            val ix = pixel.x - tileX * TILE_SIZE
            val clampedPixelY = pixel.y.coerceIn(0, n * TILE_SIZE - 1)
            val iy = clampedPixelY - Math.floorDiv(clampedPixelY, TILE_SIZE) * TILE_SIZE
            val value = bitmap[iy * TILE_SIZE + ix]
            if (!value.isFinite()) return null
            total += value * pixel.weight
        }
        return total.takeIf(Double::isFinite)
    }

    private suspend fun tile(key: TileKey): DoubleArray? {
        tiles[key]?.let { return it }
        currentCoroutineContext().ensureActive()
        if (requested.add(key)) {
            if (requested.size > maxUniqueTiles) {
                requested.remove(key)
                throw NativeSectionTileBudgetExceededException(maxUniqueTiles)
            }
        }
        val loaded = try {
            tileLoader(key.z, key.x, key.y)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Exception) {
            throw NativeSectionTileLoadException(error)
        }
        if (loaded == null || loaded.size != TILE_SIZE * TILE_SIZE) throw NativeSectionTileLoadException()
        tiles[key] = loaded
        return loaded
    }

    override fun close() {
        closed = true
        tiles.clear()
        requested.clear()
    }

    private fun chooseZoom(latitude: Double, spacingMeters: Double): Int {
        val groundMetersPerPixelAtZoomZero = 40_075_016.68557849 * cos(latitude.coerceIn(-85.0, 85.0) * PI / 180.0) / TILE_SIZE
        val target = (groundMetersPerPixelAtZoomZero / spacingMeters.coerceAtLeast(.1)).let { kotlin.math.log2(it) }
        return floor(target).toInt().coerceIn(MIN_ZOOM, MAX_ZOOM)
    }

    private data class TileKey(val z: Int, val x: Int, val y: Int)
    private data class Pixel(val x: Int, val y: Int, val weight: Double)

    companion object {
        const val MIN_ZOOM = 6
        const val MAX_ZOOM = 12
        const val MAX_UNIQUE_TILES = 80
        const val RESIDENT_TILES = 12
        const val TILE_SIZE = 256
        private const val SOURCE_LABEL = "repair → FABDEM → Terrarium"
    }
}

internal class NativeSectionTileBudgetExceededException(val maximumTiles: Int) :
    IllegalStateException("剖面范围超过单次采样瓦片上限（$maximumTiles）")

/** A required DEM tile could not be loaded; this is a service/data-access failure, not nodata. */
internal class NativeSectionTileLoadException(cause: Throwable? = null) :
    IllegalStateException("无法加载剖面所需的高程瓦片", cause)
