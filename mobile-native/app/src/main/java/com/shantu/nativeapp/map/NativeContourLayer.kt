package com.shantu.nativeapp.map

import earth.worldwind.geom.Angle
import earth.worldwind.geom.AltitudeMode
import earth.worldwind.geom.Offset
import earth.worldwind.geom.Position
import earth.worldwind.geom.Sector
import earth.worldwind.layer.mercator.MercatorTiledVectorLayer
import earth.worldwind.render.AbstractRenderable
import earth.worldwind.render.Color
import earth.worldwind.render.Font
import earth.worldwind.render.RenderContext
import earth.worldwind.render.Renderable
import earth.worldwind.shape.Label
import earth.worldwind.shape.OrientationMode
import earth.worldwind.shape.Path
import earth.worldwind.shape.PathType
import earth.worldwind.shape.ShapeAttributes
import earth.worldwind.shape.TextAttributes
import kotlinx.coroutines.sync.withPermit
import kotlin.math.PI
import kotlin.math.atan
import kotlin.math.atan2
import kotlin.math.sinh

/** Geographic conversion and vector styling for the legacy XYZ contour tiles. */
internal object NativeContourVectorGeometry {
    const val SOURCE_MAX_ZOOM = 13
    const val SOURCE_TILE_SIZE = 256
    const val TILE_CACHE_SIZE = 40
    const val NETWORK_CONCURRENCY = 4
    const val MINOR_WIDTH = 0.45f
    const val MAJOR_WIDTH = 1.05f
    const val LINE_OPACITY = 0.8f
    const val LABEL_SIZE = 11f
    const val LABEL_HALO_WIDTH = 2.8f
    const val LABEL_SPACING_PIXELS = 210f

    /** Converts local top-left-origin XYZ tile pixels to WGS84 without treating Mercator Y as latitude. */
    fun tilePixelPosition(z: Int, x: Int, y: Int, pixelX: Double, pixelY: Double, tileSize: Int = SOURCE_TILE_SIZE): Position {
        require(z in 0..SOURCE_MAX_ZOOM && tileSize > 0)
        val count = 1 shl z
        require(x in 0 until count && y in 0 until count)
        require(pixelX.isFinite() && pixelY.isFinite())
        // DEM tile values sample pixel centers, including the z=13 parent overzoom.
        val mercatorX = (x + (pixelX + 0.5) / tileSize) / count
        val mercatorY = (y + (pixelY + 0.5) / tileSize) / count
        val longitude = mercatorX * 360.0 - 180.0
        val latitude = Math.toDegrees(atan(sinh(PI * (1.0 - 2.0 * mercatorY))))
        return Position.fromDegrees(latitude, longitude, 0.0)
    }

    fun contourColor(elevationMeters: Int, interval: Int): Color =
        Color(NativeTerrainOverlayMath.elevationColor(elevationMeters.toDouble(), interval)).apply { alpha = LINE_OPACITY }

    fun contourWidth(elevationMeters: Int, interval: Int): Float =
        if (Math.floorMod(elevationMeters / interval, 5) == 0) MAJOR_WIDTH else MINOR_WIDTH
}

/** A WorldWind vector layer using the same bounded DEM sampler as terrain/elevation colors. */
internal class NativeContourLayer(
    intervalMeters: Int,
    private val minimumZoom: Int,
    private val loadSamples: suspend (z: Int, x: Int, y: Int) -> DoubleArray?,
) : MercatorTiledVectorLayer<List<Renderable>>(
    levelOffset = minimumZoom,
    numLevels = NativeContourVectorGeometry.SOURCE_MAX_ZOOM + 1,
    maxLoadedTiles = NativeContourVectorGeometry.TILE_CACHE_SIZE,
    maxConcurrentFetches = NativeContourVectorGeometry.NETWORK_CONCURRENCY,
    displayName = "等高线",
) {
    private val interval = intervalMeters.also { require(it in NativeTerrainOverlayMath.INTERVALS) }
    @Volatile private var closed = false

    init { require(minimumZoom in 0..NativeContourVectorGeometry.SOURCE_MAX_ZOOM) }

    override val coarseAncestorFallback get() = false

    /** Clone configuration only; every copy owns a fresh SDK tile cache, scope and fetch jobs. */
    override fun clone(): NativeContourLayer = NativeContourLayer(interval, minimumZoom, loadSamples).also { copy ->
        copy.displayName = displayName
        copy.isEnabled = isEnabled
        copy.isPickEnabled = isPickEnabled
        copy.isDynamic = isDynamic
        copy.opacity = opacity
        copy.minActiveAltitude = minActiveAltitude
        copy.maxActiveAltitude = maxActiveAltitude
        copy.detailControl = detailControl
    }

    override suspend fun loadTileContent(z: Int, x: Int, y: Int, sector: Sector): List<Renderable>? {
        if (closed || z !in minimumZoom..NativeContourVectorGeometry.SOURCE_MAX_ZOOM) return null
        return semaphore.withPermit {
            if (closed) return@withPermit null
            val samples = loadSamples(z, x, y) ?: return@withPermit null
            if (closed) return@withPermit null
            NativeContourVectorTileBuilder.build(samples, z, x, y, interval)
        }
    }

    override fun renderTileContent(rc: RenderContext, content: List<Renderable>) {
        content.forEach { renderable ->
            NativeContourVectorTileBuilder.applyScreenDensity(renderable, rc.densityFactor)
            renderable.render(rc)
        }
    }

    override fun closeSource() { closed = true }
}

/** AbstractRenderable adapter because the SDK tile layer is a Layer, not a Renderable. */
internal class NativeContourLayerRenderable(private val layer: NativeContourLayer) : AbstractRenderable("等高线") {
    override fun doRender(rc: RenderContext) = layer.render(rc)
    fun close() = layer.close()
}

/** Converts stitched marching-squares paths once per source tile, avoiding one shape per cell edge. */
internal object NativeContourVectorTileBuilder {
    private val baseWidthKey = Any()

    fun applyScreenDensity(renderable: Renderable, densityFactor: Float) {
        if (!densityFactor.isFinite() || densityFactor <= 0f) return
        when (renderable) {
            is Path -> {
                val baseWidth = renderable.getUserProperty<Float>(baseWidthKey) ?: renderable.attributes.outlineWidth
                renderable.putUserProperty(baseWidthKey, baseWidth)
                renderable.attributes.outlineWidth = baseWidth * densityFactor
            }
            is Label -> renderable.attributes.scale = densityFactor.toDouble()
        }
    }

    fun build(values: DoubleArray, z: Int, x: Int, y: Int, interval: Int): List<Renderable> {
        require(values.isNotEmpty())
        val size = kotlin.math.sqrt(values.size.toDouble()).toInt()
        require(size >= 2 && size * size == values.size)
        val segments = NativeTerrainOverlayMath.contourSegments(values, size, interval)
        if (segments.isEmpty()) return emptyList()
        val paths = NativeTerrainOverlayMath.contourPaths(segments)
        val labels = NativeTerrainOverlayMath.contourLabelsForPaths(paths, interval, NativeContourVectorGeometry.LABEL_SPACING_PIXELS)
        val output = ArrayList<Renderable>(paths.size + labels.size)
        val lineAttributes = HashMap<Int, ShapeAttributes>()
        for (contour in paths) {
            if (contour.points.size < 2) continue
            val attributes = lineAttributes.getOrPut(contour.elevationMeters) {
                ShapeAttributes().apply {
                    isDrawInterior = false
                    isDrawOutline = true
                    isDrawVerticals = false
                    isDepthTest = false
                    isPickOutline = false
                    outlineColor = NativeContourVectorGeometry.contourColor(contour.elevationMeters, interval)
                    outlineWidth = NativeContourVectorGeometry.contourWidth(contour.elevationMeters, interval)
                }
            }
            val positions = contour.points.map { point ->
                NativeContourVectorGeometry.tilePixelPosition(z, x, y, point.first.toDouble(), point.second.toDouble(), size)
            }
            output += Path(positions, attributes).apply {
                pathType = PathType.LINEAR
                maximumNumEdgeIntervals = 0
                altitudeMode = AltitudeMode.CLAMP_TO_GROUND
                isFollowTerrain = true
                isPickEnabled = false
                putUserProperty(baseWidthKey, attributes.outlineWidth)
            }
        }
        labels.forEach { point ->
                val attributes = TextAttributes().apply {
                    font = Font(NativeContourVectorGeometry.LABEL_SIZE)
                    textOffset = Offset.center()
                    textColor = Color(0xfffff1c9.toInt())
                    outlineColor = Color(0xff1a3034.toInt())
                    outlineWidth = NativeContourVectorGeometry.LABEL_HALO_WIDTH
                    isOutlineEnabled = true
                    isDepthTest = false
                }
                output += Label(
                    NativeContourVectorGeometry.tilePixelPosition(z, x, y, point.x.toDouble(), point.y.toDouble(), size),
                    "${point.elevationMeters} m",
                    attributes,
                ).apply {
                    altitudeMode = AltitudeMode.CLAMP_TO_GROUND
                    rotation = Angle.fromDegrees(point.rotationDegrees.toDouble())
                    rotationMode = OrientationMode.RELATIVE_TO_GLOBE
                    isAlwaysOnTop = true
                    isPickEnabled = false
                }
            }
        return output
    }
}
