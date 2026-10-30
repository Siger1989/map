package com.shantu.nativeapp.map

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import earth.worldwind.geom.Angle
import earth.worldwind.geom.Sector
import earth.worldwind.geom.TileMatrix
import earth.worldwind.geom.TileMatrixSet
import earth.worldwind.globe.elevation.ElevationSource
import earth.worldwind.globe.elevation.ElevationSourceFactory
import earth.worldwind.globe.elevation.coverage.ElevationImage
import earth.worldwind.globe.elevation.coverage.TiledElevationCoverage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import org.json.JSONObject
import kotlin.math.PI
import kotlin.math.asinh
import kotlin.math.floor
import kotlin.math.roundToInt
import kotlin.math.tan

/** Explicit cancellation point used by the non-suspending per-pixel DEM loops. */
internal suspend fun ensureTerrainRasterActive() {
    currentCoroutineContext().ensureActive()
}

/**
 * Shantu terrain coverage. Bundled repair tiles override regional FABDEM tiles; all holes and
 * out-of-coverage locations fall back to the public Terrarium raster through the shared bounded
 * map network. Values are quantized to integer meters because WorldWind's elevation array is Short.
 * FABDEM coverage is regional, not global.
 */
internal class NativeTerrariumCoverage(
    context: Context,
    private val network: BoundedTileNetwork,
    private val maxZoom: Int = 12,
    private val tileIdentityFor: ((Int, Int, Int) -> TileRequestIdentity?)? = null,
    private val viewId: (() -> String?)? = null,
    private val demandGeneration: (() -> Long?)? = null,
) : TiledElevationCoverage(
    buildNativeTerrainTileMatrixSet(maxZoom),
    object : ElevationSourceFactory {
        override val contentType = "Shantu native Terrarium DEM"
        override fun createElevationSource(tileMatrix: TileMatrix, row: Int, column: Int): ElevationSource =
            ElevationSource.fromUnrecognized("native-terrain:${tileMatrix.ordinal}:$column:$row")
    },
) {
    private val appContext = context.applicationContext
    private val local = NativeTerrariumAssets(appContext)

    init {
        displayName = "Regional FABDEM + repairs / public Terrarium"
    }

    override fun clone(): NativeTerrariumCoverage = NativeTerrariumCoverage(appContext, network, maxZoom, tileIdentityFor, viewId, demandGeneration)

    /**
     * Samples the same repair -> regional FABDEM -> public Terrarium priority for a Mercator
     * render tile. The overlay renderer uses this path so it cannot drift from the terrain mesh.
     * z=13 is the original web contour overzoom: each requested tile is resampled from its z=12
     * parent. Null means a required public fallback could not be fetched and should be retried;
     * transparent/nodata pixels are represented by NaN in a successfully returned array.
     */
    internal suspend fun sampleMercatorTile(z: Int, x: Int, y: Int, tileSize: Int = 256, outputSize: Int = tileSize): DoubleArray? {
        require(z in 0..13 && tileSize == 256 && outputSize in 64..256 && (outputSize and (outputSize - 1)) == 0)
        require(x in 0 until (1 shl z) && y in 0 until (1 shl z))
        return withContext(Dispatchers.IO) {
            val sourceZ = z.coerceAtMost(maxZoom)
            val scale = 1 shl (z - sourceZ)
            val sourceX = x / scale
            val sourceY = y / scale
            val repair = local.readRepair(sourceZ, sourceX, sourceY, tileSize)
            val fabdem = local.readFabdem(sourceZ, sourceX, sourceY, tileSize)
            var fallback: Bitmap? = null
            var fallbackPixels: IntArray? = null
            try {
                val repairPixels = repair?.let { bitmap ->
                    IntArray(tileSize * tileSize).also { pixels -> bitmap.getPixels(pixels, 0, tileSize, 0, 0, tileSize, tileSize) }
                }
                val fabdemPixels = fabdem?.let { bitmap ->
                    IntArray(tileSize * tileSize).also { pixels -> bitmap.getPixels(pixels, 0, tileSize, 0, 0, tileSize, tileSize) }
                }
                var needsFallback = false
                for (pixelY in 0 until tileSize) {
                    ensureTerrainRasterActive()
                    for (pixelX in 0 until tileSize) {
                        if ((pixelX and 15) == 0) ensureTerrainRasterActive()
                        val index = pixelY * tileSize + pixelX
                        if (readTerrariumPixel(repairPixels, index) == null &&
                            readTerrariumPixel(fabdemPixels, index) == null) {
                            needsFallback = true
                            break
                        }
                    }
                    if (needsFallback) break
                }
                if (needsFallback) {
                    val loadedFallback = fetchPublic(sourceZ, sourceX, sourceY, tileSize) ?: return@withContext null
                    fallback = loadedFallback
                    fallbackPixels = IntArray(tileSize * tileSize).also {
                        loadedFallback.getPixels(it, 0, tileSize, 0, 0, tileSize, tileSize)
                    }
                }
                val values = DoubleArray(outputSize * outputSize) { Double.NaN }
                val subTileX = x % scale
                val subTileY = y % scale
                fun at(px: Int, py: Int): Double? =
                    sampleTerrainPixel(repairPixels, fabdemPixels, fallbackPixels,
                        py.coerceIn(0, tileSize - 1) * tileSize + px.coerceIn(0, tileSize - 1))
                for (pixelY in 0 until outputSize) {
                    ensureTerrainRasterActive()
                    val sy = ((subTileY + (pixelY + 0.5) / outputSize) * (tileSize / scale.toDouble()) - 0.5)
                        .coerceIn(0.0, tileSize - 1.0)
                    val y0 = kotlin.math.floor(sy).toInt().coerceIn(0, tileSize - 1)
                    val y1 = (y0 + 1).coerceIn(0, tileSize - 1)
                    val fy = (sy - kotlin.math.floor(sy)).coerceIn(0.0, 1.0)
                    for (pixelX in 0 until outputSize) {
                        if ((pixelX and 15) == 0) ensureTerrainRasterActive()
                        val sx = ((subTileX + (pixelX + 0.5) / outputSize) * (tileSize / scale.toDouble()) - 0.5)
                            .coerceIn(0.0, tileSize - 1.0)
                        val x0 = kotlin.math.floor(sx).toInt().coerceIn(0, tileSize - 1)
                        val x1 = (x0 + 1).coerceIn(0, tileSize - 1)
                        val fx = (sx - kotlin.math.floor(sx)).coerceIn(0.0, 1.0)
                        values[pixelY * outputSize + pixelX] = bilinearElevation(
                            at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1), fx, fy,
                        )
                    }
                }
                values
            } finally {
                recycleAll(listOf(repair, fabdem, fallback))
            }
        }
    }

    override suspend fun retrieveTileArray(key: Long, tileMatrix: TileMatrix, row: Int, column: Int) {
        try {
            val values = withContext(Dispatchers.IO) {
                val tileSize = tileMatrix.tileWidth
                require(tileSize == tileMatrix.tileHeight) { "Terrain tiles must be square" }
                val targetSector = tileMatrix.tileSector(row, column)
                val output = ShortArray(tileSize * tileSize) { Short.MIN_VALUE }
                val sourceSide = 1 shl tileMatrix.ordinal
                val sourcePixels = sourceSide * tileSize
                val minLatitude = -NativeTerrariumMath.WEB_MERCATOR_MAX_LATITUDE
                val maxLatitude = NativeTerrariumMath.WEB_MERCATOR_MAX_LATITUDE
                val targetDeltaLat = targetSector.deltaLatitude.inDegrees / tileSize
                val worldX = column * tileSize
                val repairTiles = HashMap<Int, Bitmap?>()
                val fabdemTiles = HashMap<Int, Bitmap?>()
                val fallbackCache = NativeLazyFallbackCache<Bitmap>()

                try {
                for (pixelY in 0 until tileSize) {
                    ensureTerrainRasterActive()
                    val latitude = targetSector.maxLatitude.inDegrees - (pixelY + 0.5) * targetDeltaLat
                    if (latitude !in minLatitude..maxLatitude) continue
                    // Convert the projected pixel-edge coordinate to a center-index coordinate
                    // before interpolation (e.g. the equator lies halfway between two rows).
                    val sourceY = (NativeTerrariumMath.mercatorPixelY(latitude, tileMatrix.ordinal, tileSize) - 0.5)
                        .coerceIn(0.0, sourcePixels - 1.0)
                    val y0 = floor(sourceY).toInt().coerceIn(0, sourcePixels - 1)
                    val y1 = (y0 + 1).coerceAtMost(sourcePixels - 1)
                    val sourceTileY0 = y0 / tileSize
                    val sourceTileY1 = y1 / tileSize
                    val repair0 = tileBitmap(repairTiles, sourceTileY0) { local.readRepair(tileMatrix.ordinal, column, sourceTileY0, tileSize) }
                    val repair1 = if (sourceTileY1 == sourceTileY0) repair0 else tileBitmap(repairTiles, sourceTileY1) {
                        local.readRepair(tileMatrix.ordinal, column, sourceTileY1, tileSize)
                    }
                    val fabdem0 = tileBitmap(fabdemTiles, sourceTileY0) { local.readFabdem(tileMatrix.ordinal, column, sourceTileY0, tileSize) }
                    val fabdem1 = if (sourceTileY1 == sourceTileY0) fabdem0 else tileBitmap(fabdemTiles, sourceTileY1) {
                        local.readFabdem(tileMatrix.ordinal, column, sourceTileY1, tileSize)
                    }
                    val needsFallback0 = hasNodata(repair0, fabdem0, y0 % tileSize, tileSize)
                    val fallback0 = fallbackCache.resolve(sourceTileY0, needsFallback0) {
                        fetchPublic(tileMatrix.ordinal, column, sourceTileY0, tileSize)
                    }
                    if (needsFallback0 && fallback0 == null) return@withContext null
                    val needsFallback1 = hasNodata(repair1, fabdem1, y1 % tileSize, tileSize)
                    val fallback1 = fallbackCache.resolve(sourceTileY1, needsFallback1) {
                        fetchPublic(tileMatrix.ordinal, column, sourceTileY1, tileSize)
                    }
                    if (needsFallback1 && fallback1 == null) return@withContext null

                    val fractionY = sourceY - floor(sourceY)
                    for (pixelX in 0 until tileSize) {
                        if ((pixelX and 15) == 0) ensureTerrainRasterActive()
                        val x = (worldX + pixelX).coerceIn(0, sourcePixels - 1)
                        val xTile = x / tileSize
                        // The target and source matrices have identical longitude columns. Keep
                        // this assertion explicit to prevent silent horizontal datum drift.
                        if (xTile != column) continue
                        val localX = x % tileSize
                        val first = sampleElevation(repair0, fabdem0, fallback0, localX, y0 % tileSize)
                        val second = sampleElevation(repair1, fabdem1, fallback1, localX, y1 % tileSize)
                        val elevation = when {
                            first == null && second == null -> null
                            first == null -> second
                            second == null -> first
                            else -> first + (second - first) * fractionY
                        }
                        if (elevation != null && elevation.isFinite()) {
                            output[pixelY * tileSize + pixelX] = elevation.roundToInt()
                                .coerceIn(Short.MIN_VALUE + 1, Short.MAX_VALUE.toInt()).toShort()
                        }
                    }
                }
                output
                } finally {
                    recycleAll(repairTiles.values, fabdemTiles.values, fallbackCache.values())
                }
            }
            if (values == null) retrievalFailed(key) else retrievalSucceeded(key, buildImage(values))
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            // No URL, credentials or source payload is included in logs. WorldWind can retry.
            retrievalFailed(key)
        }
    }

    private fun hasNodata(repair: Bitmap?, fabdem: Bitmap?, pixelY: Int, tileSize: Int): Boolean {
        for (x in 0 until tileSize) {
            if (readTerrarium(repair, x, pixelY) == null && readTerrarium(fabdem, x, pixelY) == null) return true
        }
        return false
    }

    private suspend fun fetchPublic(z: Int, x: Int, y: Int, tileSize: Int): Bitmap? {
        val identity = tileIdentityFor?.invoke(z, x, y)
        val bytes = network.fetch(
            NativeTerrariumMath.publicTileUrl(z, x, y), identity = identity,
            viewId = if (identity == null) null else viewId?.invoke(),
            generation = if (identity == null) null else demandGeneration?.invoke(),
        ) ?: return null
        val bitmap = NativeTileStageTelemetry.measureDecode { BitmapFactory.decodeByteArray(bytes, 0, bytes.size) } ?: return null
        if (bitmap.width != tileSize || bitmap.height != tileSize) {
            bitmap.recycle()
            return null
        }
        return bitmap
    }

    // The SDK geographic-grid conversion still uses its per-row bitmap path.
    private fun sampleElevation(repair: Bitmap?, fabdem: Bitmap?, fallback: Bitmap?, x: Int, y: Int): Double? =
        readTerrarium(repair, x, y) ?: readTerrarium(fabdem, x, y) ?: readTerrarium(fallback, x, y)

    private fun readTerrarium(bitmap: Bitmap?, x: Int, y: Int): Double? {
        if (bitmap == null) return null
        val color = bitmap.getPixel(x, y)
        if ((color ushr 24) == 0) return null
        return NativeTerrariumMath.decodeTerrarium((color ushr 16) and 0xff, (color ushr 8) and 0xff, color and 0xff)
    }

    private fun recycleAll(vararg groups: Collection<Bitmap?>) {
        groups.forEach { group -> group.filterNotNull().distinct().forEach { if (!it.isRecycled) it.recycle() } }
    }

}

/** Reads a copied ARGB tile without crossing the Bitmap/JNI boundary for each sample. */
internal fun sampleTerrainPixel(repair: IntArray?, fabdem: IntArray?, fallback: IntArray?, index: Int): Double? =
    readTerrariumPixel(repair, index) ?: readTerrariumPixel(fabdem, index) ?: readTerrariumPixel(fallback, index)

private fun readTerrariumPixel(pixels: IntArray?, index: Int): Double? {
    if (pixels == null) return null
    val color = pixels[index]
    if ((color ushr 24) == 0) return null
    val red = (color ushr 16) and 0xff
    val green = (color ushr 8) and 0xff
    val blue = color and 0xff
    return NativeTerrariumMath.decodeTerrarium(red, green, blue)
}

/** Bilinear interpolation without per-pixel collections or Pair allocations. */
internal fun bilinearElevation(v00: Double?, v10: Double?, v11: Double?, v01: Double?, fx: Double, fy: Double): Double {
    val w00 = (1.0 - fx) * (1.0 - fy)
    val w10 = fx * (1.0 - fy)
    val w11 = fx * fy
    val w01 = (1.0 - fx) * fy
    var result = 0.0
    if (w00 > 1e-12) { if (v00?.isFinite() != true) return Double.NaN; result += v00 * w00 }
    if (w10 > 1e-12) { if (v10?.isFinite() != true) return Double.NaN; result += v10 * w10 }
    if (w11 > 1e-12) { if (v11?.isFinite() != true) return Double.NaN; result += v11 * w11 }
    if (w01 > 1e-12) { if (v01?.isFinite() != true) return Double.NaN; result += v01 * w01 }
    return result
}

private suspend fun tileBitmap(cache: MutableMap<Int, Bitmap?>, key: Int, load: suspend () -> Bitmap?): Bitmap? {
    if (!cache.containsKey(key)) cache[key] = load()
    return cache[key]
}

internal class NativeLazyFallbackCache<T : Any> {
    private val cached = HashMap<Int, T>()

    suspend fun resolve(key: Int, required: Boolean, load: suspend () -> T?): T? {
        if (!required) return null
        cached[key]?.let { return it }
        return load()?.also { cached[key] = it }
    }

    fun values(): Collection<T> = cached.values
}

private fun buildNativeTerrainTileMatrixSet(zoom: Int): TileMatrixSet {
    require(zoom in 0..20) { "Unsupported terrain maximum zoom" }
    val sector = Sector().setFullSphere()
    // One 360-degree column keeps WorldWind's x indices aligned with XYZ source tiles.
    val finest = Angle.fromDegrees(180.0 / ((1 shl zoom) * 256.0) * 1.001)
    return TileMatrixSet.fromTilePyramid(sector, 1, 1, 256, 256, finest)
}

/** Pure geometry/encoding helpers kept independently testable without real services or assets. */
internal object NativeTerrariumMath {
    const val WEB_MERCATOR_MAX_LATITUDE = 85.0511287798066

    fun mercatorPixelY(latitudeDegrees: Double, zoom: Int, tileSize: Int = 256): Double {
        require(latitudeDegrees.isFinite() && zoom in 0..24 && tileSize > 0)
        val latitude = latitudeDegrees.coerceIn(-WEB_MERCATOR_MAX_LATITUDE, WEB_MERCATOR_MAX_LATITUDE)
        val radians = Math.toRadians(latitude)
        val worldPixelY = (1.0 - asinh(tan(radians)) / PI) * 0.5 * (1 shl zoom) * tileSize
        return worldPixelY.coerceIn(0.0, (1 shl zoom) * tileSize - 1.0)
    }

    fun decodeTerrarium(red: Int, green: Int, blue: Int): Double {
        require(red in 0..255 && green in 0..255 && blue in 0..255)
        return red * 256.0 + green + blue / 256.0 - 32768.0
    }

    fun tileInsideCoverage(z: Int, x: Int, y: Int, bounds: IntArray?): Boolean =
        bounds != null && bounds.size == 4 && x in bounds[0]..bounds[1] && y in bounds[2]..bounds[3]

    fun publicTileUrl(z: Int, x: Int, y: Int): String {
        require(z in 0..24 && x in 0 until (1 shl z) && y in 0 until (1 shl z))
        return "https://elevation-tiles-prod.s3.amazonaws.com/terrarium/$z/$x/$y.png"
    }
}

private class NativeTerrariumAssets(private val context: Context) {
    private val repairIndex by lazy { readRepairIndex() }
    private val fabdemBounds by lazy { readCoverage("native/ground-coverage.json") }

    fun readRepair(z: Int, x: Int, y: Int, expectedSize: Int): Bitmap? {
        if ("$z/$x/$y" !in repairIndex) return null
        return readBitmap("terrain/repairs-v1/$z/$x/$y.png", expectedSize)
    }

    fun readFabdem(z: Int, x: Int, y: Int, expectedSize: Int): Bitmap? {
        if (!NativeTerrariumMath.tileInsideCoverage(z, x, y, fabdemBounds[z])) return null
        return readBitmap("terrain/fabdem-v1-2/$z/$x/$y.png", expectedSize)
    }

    private fun readBitmap(path: String, expectedSize: Int): Bitmap? = runCatching {
        context.assets.open(path).use { BitmapFactory.decodeStream(it) }
    }.getOrNull()?.let { bitmap ->
        if (bitmap.width == expectedSize && bitmap.height == expectedSize) bitmap else {
            bitmap.recycle()
            null
        }
    }

    private fun readRepairIndex(): Set<String> = runCatching {
        val json = context.assets.open("terrain/repairs-v1/coverage.json").bufferedReader().use { it.readText() }
        val root = JSONObject(json)
        buildSet {
            val zooms = root.keys()
            while (zooms.hasNext()) {
                val zoom = zooms.next()
                val rows = root.getJSONArray(zoom)
                for (i in 0 until rows.length()) add("$zoom/${rows.getString(i)}")
            }
        }
    }.getOrDefault(emptySet())

    private fun readCoverage(path: String): Map<Int, IntArray> = runCatching {
        val json = context.assets.open(path).bufferedReader().use { it.readText() }
        val root = JSONObject(json)
        buildMap {
            val keys = root.keys()
            while (keys.hasNext()) {
                val key = keys.next()
                val value = root.getJSONArray(key)
                if (value.length() == 4) put(key.toInt(), IntArray(4) { index -> value.getInt(index) })
            }
        }
    }.getOrDefault(emptyMap())
}
