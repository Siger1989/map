package com.shantu.nativeapp.map

import android.graphics.Bitmap
import earth.worldwind.layer.mercator.MercatorTileFactory
import earth.worldwind.layer.mercator.MercatorTiledImageLayer
import earth.worldwind.layer.mercator.MercatorTiledSurfaceImage
import earth.worldwind.render.Renderable
import earth.worldwind.render.image.ImageSource
import kotlinx.coroutines.CancellationException
import kotlin.math.PI
import kotlin.math.atan
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sinh
import kotlin.math.sqrt
import kotlin.math.roundToInt

/**
 * Opaque native base material for the built-in terrain/offline map modes. The fill is a style
 * background only; shading is added exclusively where the shared DEM returns real elevations.
 */
internal class NativeTerrainBasemap(
    private val coverage: NativeTerrariumCoverage,
    private val onBitmapReady: () -> Unit = {},
    private val onLoadStarted: () -> Unit = {},
    private val onLoadFinished: () -> Unit = {},
) : AutoCloseable {
    @Volatile private var closed = false

    fun renderables(): List<Renderable> {
        val factory = object : MercatorTileFactory {
            override val contentType = "Shantu dark terrain base with DEM hillshade"
            override fun getImageSource(x: Int, y: Int, z: Int): ImageSource = ImageSource.fromImageFactory(
                object : ImageSource.NetworkBoundImageFactory {
                    override suspend fun createCachedBitmap(): Bitmap? = null
                    override suspend fun createBitmap(): Bitmap? {
                        if (closed) return null
                        onLoadStarted()
                        try {
                            val elevations = try { coverage.sampleMercatorTile(z, x, y, TILE_SIZE) }
                            catch (cancelled: CancellationException) { throw cancelled }
                            catch (_: Throwable) { null }
                            if (closed) return null
                            val pixels = NativeTerrainBasemapMath.pixels(elevations, TILE_SIZE, z, x, y)
                            val bitmap = Bitmap.createBitmap(TILE_SIZE, TILE_SIZE, Bitmap.Config.RGB_565).apply {
                                setPixels(pixels, 0, TILE_SIZE, 0, 0, TILE_SIZE, TILE_SIZE)
                            }
                            // A flat fallback-color tile is not evidence that the offline/terrain map rendered.
                            if (elevations?.any { it.isFinite() } == true) onBitmapReady()
                            return bitmap
                        } finally {
                            onLoadFinished()
                        }
                    }
                },
            )
        }
        val surface: MercatorTiledSurfaceImage = MercatorTiledImageLayer.buildTiledSurfaceImage(
            factory, transparent = false, minZoom = 0, maxZoom = MAX_ZOOM, tileSize = TILE_SIZE,
        )
        surface.detailControl = 1.0
        return listOf(surface)
    }

    override fun close() { closed = true }

    companion object {
        const val TILE_SIZE = 256
        const val MAX_ZOOM = 12
        const val BACKGROUND = 0xFF203B3F.toInt()
        const val ATTRIBUTION = NativeTerrainOverlays.ATTRIBUTION
    }
}

/** Pure DEM-to-base tile conversion; NaN pixels retain the background and never invent elevation. */
internal object NativeTerrainBasemapMath {
    private const val RADIUS_METERS = 6_378_137.0
    private val flatLight = 0.70710678118

    fun pixels(elevations: DoubleArray?, size: Int, zoom: Int, tileX: Int, tileY: Int): IntArray {
        require(size >= 3 && zoom in 0..20)
        require(tileX in 0 until (1 shl zoom) && tileY in 0 until (1 shl zoom))
        require(elevations == null || elevations.size == size * size)
        val output = IntArray(size * size) { NativeTerrainBasemap.BACKGROUND }
        if (elevations == null) return output
        val side = 1 shl zoom
        for (py in 1 until size - 1) for (px in 1 until size - 1) {
            val index = py * size + px
            val center = elevations[index]
            val west = elevations[index - 1]; val east = elevations[index + 1]
            val north = elevations[index - size]; val south = elevations[index + size]
            if (!center.isFinite() || !west.isFinite() || !east.isFinite() || !north.isFinite() || !south.isFinite()) continue
            val mercatorY = (tileY + (py + 0.5) / size) / side.toDouble()
            val latitude = atan(sinh(PI * (1.0 - 2.0 * mercatorY)))
            val metersPerPixel = (2.0 * PI * RADIUS_METERS * cos(latitude) / (side * size)).coerceAtLeast(0.05)
            val dzEast = (east - west) / (2.0 * metersPerPixel)
            val dzNorth = (north - south) / (2.0 * metersPerPixel)
            val inverseLength = 1.0 / sqrt(dzEast * dzEast + dzNorth * dzNorth + 1.0)
            // NW light at 45 degrees. A flat surface remains exactly the requested #203b3f.
            val illumination = ((-0.5 * -dzEast) + (0.5 * -dzNorth) + 0.70710678118) * inverseLength
            val factor = (1.0 + (illumination - flatLight) * 0.9).coerceIn(0.48, 1.16)
            output[index] = shade(NativeTerrainBasemap.BACKGROUND, factor)
        }
        return output
    }

    private fun shade(color: Int, factor: Double): Int {
        val red = ((color shr 16 and 0xff) * factor).roundToInt().coerceIn(0, 255)
        val green = ((color shr 8 and 0xff) * factor).roundToInt().coerceIn(0, 255)
        val blue = ((color and 0xff) * factor).roundToInt().coerceIn(0, 255)
        return (0xff shl 24) or (red shl 16) or (green shl 8) or blue
    }
}
