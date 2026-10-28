package com.shantu.nativeapp.map

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import earth.worldwind.layer.mercator.MercatorTileFactory
import earth.worldwind.layer.mercator.MercatorTiledImageLayer
import earth.worldwind.layer.mercator.MercatorTiledSurfaceImage
import earth.worldwind.render.Renderable
import earth.worldwind.render.image.ImageSource
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.roundToInt
import java.util.LinkedHashMap

internal data class NativeTerrainOverlayOptions(
    val contoursEnabled: Boolean,
    val elevationColorsEnabled: Boolean,
    val contourIntervalMeters: Int = 30,
    val elevationColorsOpacity: Double = 1.0,
) {
    init {
        require(contourIntervalMeters in NativeTerrainOverlayMath.INTERVALS) { "等高线间隔仅支持30、50、100或200米" }
        require(elevationColorsOpacity.isFinite() && elevationColorsOpacity in 0.0..1.0) { "海拔着色透明度无效" }
    }
}

internal data class NativeContourSegment(
    val x1: Float,
    val y1: Float,
    val x2: Float,
    val y2: Float,
    val elevationMeters: Int,
)

internal data class NativeContourLabel(val x: Float, val y: Float, val elevationMeters: Int)

/** CPU-side DEM overlay renderer. Missing DEM values remain transparent and break contour cells. */
internal object NativeTerrainOverlayMath {
    val INTERVALS = setOf(30, 50, 100, 200)
    private const val MAX_LEVEL_CANDIDATES = 2_000_000
    private val anchors = listOf(
        -500 to rgb(0x07, 0x50, 0x43),
        0 to rgb(0x13, 0x7b, 0x63),
        500 to rgb(0x47, 0xba, 0x42),
        1_000 to rgb(0xb5, 0xdd, 0x2a),
        1_500 to rgb(0xff, 0xe0, 0x2e),
        2_000 to rgb(0xff, 0xa3, 0x26),
        2_500 to rgb(0xec, 0x59, 0x1e),
        3_000 to rgb(0xd5, 0x20, 0x42),
        3_500 to rgb(0xab, 0x28, 0x6e),
        4_000 to rgb(0x7b, 0x45, 0xa1),
        4_500 to rgb(0x4b, 0x57, 0xb1),
        5_000 to rgb(0x87, 0x94, 0xd3),
        6_000 to rgb(0xf4, 0xf6, 0xff),
        9_000 to rgb(0xaf, 0xc5, 0xdb),
    )

    fun contourMinimumZoom(interval: Int): Int {
        require(interval in INTERVALS)
        return when (interval) { 30 -> 11; 50 -> 10; 100 -> 9; else -> 8 }
    }

    fun elevationColor(heightMeters: Double, interval: Int): Int {
        require(heightMeters.isFinite() && interval in INTERVALS)
        val band = floor(heightMeters / interval) * interval
        val next = anchors.indexOfFirst { it.first > band }
        if (next == 0) return anchors.first().second
        if (next < 0) return anchors.last().second
        val (low, from) = anchors[next - 1]
        val (high, to) = anchors[next]
        val t = ((band - low) / (high - low)).coerceIn(0.0, 1.0)
        val red = mix(Color.red(from), Color.red(to), t)
        val green = mix(Color.green(from), Color.green(to), t)
        val blue = mix(Color.blue(from), Color.blue(to), t)
        return Color.rgb(red, green, blue)
    }

    /** Marching squares over one bounded tile; cells touching nodata are deliberately omitted. */
    fun contourSegments(values: DoubleArray, size: Int, interval: Int): List<NativeContourSegment> {
        require(size >= 2 && values.size == size * size && interval in INTERVALS)
        val segments = ArrayList<NativeContourSegment>()
        var candidates = 0
        for (y in 0 until size - 1) for (x in 0 until size - 1) {
            val v0 = values[y * size + x]
            val v1 = values[y * size + x + 1]
            val v2 = values[(y + 1) * size + x + 1]
            val v3 = values[(y + 1) * size + x]
            if (!v0.isFinite() || !v1.isFinite() || !v2.isFinite() || !v3.isFinite()) continue
            val minimum = minOf(v0, v1, v2, v3)
            val maximum = maxOf(v0, v1, v2, v3)
            var level = ceil(minimum / interval) * interval
            val last = floor(maximum / interval) * interval
            while (level <= last) {
                if (++candidates > MAX_LEVEL_CANDIDATES) throw IllegalArgumentException("地形等高线瓦片计算超出单瓦片预算")
                val intersections = ArrayList<Pair<Int, Pair<Float, Float>>>(4)
                edgeIntersection(v0, v1, level)?.let { intersections += 0 to (x + it).toFloat().let { px -> px to y.toFloat() } }
                edgeIntersection(v1, v2, level)?.let { intersections += 1 to (x + 1f to y + it) }
                edgeIntersection(v3, v2, level)?.let { intersections += 2 to (x + it).toFloat().let { px -> px to (y + 1f) } }
                edgeIntersection(v0, v3, level)?.let { intersections += 3 to (x.toFloat() to y + it) }
                if (intersections.size == 2) {
                    val a=intersections[0].second;val b=intersections[1].second
                    if(a!=b)segments += segment(a,b,level.toInt())
                } else if (intersections.size == 4) {
                    // Bilinear asymptotic decider. The arithmetic center average is not enough for
                    // asymmetric saddles; Q selects which diagonal phase reaches the saddle.
                    val cornerZeroHigh = v0 >= level
                    val f0 = v0 - level
                    val f1 = v1 - level
                    val f2 = v2 - level
                    val f3 = v3 - level
                    val determinant = f0 * f2 - f1 * f3
                    val centerHigh = when {
                        determinant == 0.0 -> true // deterministic tie, matching the legacy high-center rule
                        cornerZeroHigh -> determinant > 0.0
                        else -> determinant < 0.0
                    }
                    val edges = intersections.associate { it.first to it.second }
                    val pairs = if (centerHigh == cornerZeroHigh) listOf(0 to 1, 2 to 3) else listOf(0 to 3, 1 to 2)
                    pairs.forEach { (a, b) ->
                        val from=edges.getValue(a);val to=edges.getValue(b)
                        if(from!=to)segments += segment(from,to,level.toInt())
                    }
                }
                level += interval
            }
        }
        return segments
    }

    /** Joins adjacent cell fragments and places sparse labels along actual major contour paths. */
    fun contourLabels(segments: List<NativeContourSegment>, interval: Int, spacingPixels: Float = 210f): List<NativeContourLabel> {
        require(interval in INTERVALS && spacingPixels.isFinite() && spacingPixels > 0f)
        val labels = mutableListOf<NativeContourLabel>()
        for ((elevation, lines) in segments.filter { isMajor(it.elevationMeters, interval) }.groupBy { it.elevationMeters }) {
            val components = stitchLevel(lines)
            for (path in components) {
                val cumulative = DoubleArray(path.size)
                for (index in 1 until path.size) {
                    cumulative[index] = cumulative[index - 1] + kotlin.math.hypot(
                        (path[index].first - path[index - 1].first).toDouble(),
                        (path[index].second - path[index - 1].second).toDouble(),
                    )
                }
                val length = cumulative.lastOrNull() ?: 0.0
                var distance = spacingPixels * 0.5
                while (distance < length - 18.0) {
                    val index = cumulative.indexOfFirst { it >= distance }.coerceAtLeast(1)
                    val fraction = ((distance - cumulative[index - 1]) / (cumulative[index] - cumulative[index - 1]).coerceAtLeast(1e-9)).toFloat()
                    labels += NativeContourLabel(
                        path[index - 1].first + (path[index].first - path[index - 1].first) * fraction,
                        path[index - 1].second + (path[index].second - path[index - 1].second) * fraction,
                        elevation,
                    )
                    distance += spacingPixels
                }
            }
        }
        return labels
    }

    fun renderElevationColors(values: DoubleArray, size: Int, interval: Int, opacity: Double = 1.0): Bitmap {
        require(size > 0 && values.size == size * size && interval in INTERVALS && opacity.isFinite() && opacity in 0.0..1.0)
        val pixels = IntArray(values.size) { index ->
            val elevation = values[index]
            if (!elevation.isFinite() || opacity <= 0.0) Color.TRANSPARENT
            else {
                val color = elevationColor(elevation, interval)
                Color.argb((255.0 * opacity).toInt(), Color.red(color), Color.green(color), Color.blue(color))
            }
        }
        return Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888).apply { setPixels(pixels, 0, size, 0, 0, size, size) }
    }

    fun renderContours(values: DoubleArray, size: Int, interval: Int): Bitmap {
        val segments = contourSegments(values, size, interval)
        val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val line = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
        }
        segments.forEach { segment ->
            val contourColor = elevationColor(segment.elevationMeters.toDouble(), interval)
            line.color = Color.argb(204, Color.red(contourColor), Color.green(contourColor), Color.blue(contourColor))
            line.strokeWidth = if (isMajor(segment.elevationMeters, interval)) 2f else 1f
            canvas.drawLine(segment.x1, segment.y1, segment.x2, segment.y2, line)
        }
        val halo = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeJoin = Paint.Join.ROUND
            textSize = 11f
            strokeWidth = 2.8f
            color = Color.rgb(0x1a, 0x30, 0x34)
        }
        val text = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.FILL
            textSize = 11f
            color = Color.rgb(0xff, 0xf1, 0xc9)
        }
        contourLabels(segments, interval).forEach { labelPoint ->
            val label = "${labelPoint.elevationMeters} m"
            val left = labelPoint.x - text.measureText(label) * 0.5f
            canvas.drawText(label, left, labelPoint.y, halo)
            canvas.drawText(label, left, labelPoint.y, text)
        }
        return bitmap
    }

    private fun stitchLevel(lines: List<NativeContourSegment>): List<List<Pair<Float, Float>>> {
        fun key(x: Float, y: Float) = (x.roundToInt().toLong() shl 32) xor (y.roundToInt().toLong() and 0xffffffffL)
        val adjacency = HashMap<Long, MutableList<Int>>()
        lines.forEachIndexed { index, line ->
            adjacency.getOrPut(key(line.x1, line.y1)) { mutableListOf() } += index
            adjacency.getOrPut(key(line.x2, line.y2)) { mutableListOf() } += index
        }
        val used = BooleanArray(lines.size)
        val paths = mutableListOf<List<Pair<Float, Float>>>()
        fun trace(start: Long, initial: Int) {
            val points = mutableListOf<Pair<Float, Float>>()
            var point = start
            var edge = initial
            while (!used[edge]) {
                used[edge] = true
                val line = lines[edge]
                val a = key(line.x1, line.y1)
                if (points.isEmpty()) points += if (point == a) line.x1 to line.y1 else line.x2 to line.y2
                val next = if (point == a) line.x2 to line.y2 else line.x1 to line.y1
                points += next
                point = key(next.first, next.second)
                edge = adjacency[point].orEmpty().firstOrNull { !used[it] } ?: break
            }
            if (points.size > 1) paths += points
        }
        adjacency.filterValues { it.size != 2 }.forEach { (point, edges) -> edges.filter { !used[it] }.forEach { trace(point, it) } }
        lines.indices.filter { !used[it] }.forEach { trace(key(lines[it].x1, lines[it].y1), it) }
        return paths
    }

    private fun isMajor(elevation: Int, interval: Int) = Math.floorMod(elevation / interval, 5) == 0

    private fun edgeIntersection(a: Double, b: Double, level: Double): Float? {
        val crosses = (a < level && b >= level) || (b < level && a >= level)
        if (!crosses || a == b) return null
        return ((level - a) / (b - a)).toFloat().coerceIn(0f, 1f)
    }

    private fun segment(a: Pair<Float, Float>, b: Pair<Float, Float>, level: Int) =
        NativeContourSegment(a.first, a.second, b.first, b.second, level)

    private fun mix(a: Int, b: Int, t: Double) = (a * (1.0 - t) + b * t).roundToInt().coerceIn(0, 255)
    private fun rgb(red: Int, green: Int, blue: Int) = Color.rgb(red, green, blue)
}

/** Resolve explicit contour spacing or the zoom-adaptive native auto mode. */
internal object NativeContourIntervalPolicy {
    fun resolve(value: Any?, zoom: Double): Int {
        val text = value?.toString()?.lowercase()
        val explicit = (value as? Number)?.toInt()?.takeIf { it in NativeTerrainOverlayMath.INTERVALS } ?: when (text) {
            "30" -> 30
            "50" -> 50
            "100" -> 100
            "200" -> 200
            else -> null
        }
        if (explicit != null) return explicit
        if (text != "auto") return 30
        return when {
            !zoom.isFinite() -> 200
            zoom >= 11.0 -> 30
            zoom >= 10.0 -> 50
            zoom >= 9.0 -> 100
            else -> 200
        }
    }
}

/**
 * Produces true overlays from the same DEM source as the WorldWind terrain coverage. The terrain
 * source owns all networking, fallbacks and disk caching; this class only renders bounded 256px
 * surface tiles from its sampled elevations.
 */
internal class NativeTerrainOverlays(private val coverage: NativeTerrariumCoverage) {
    private data class TileKey(val z: Int, val x: Int, val y: Int)
    private val sampledTiles = object : LinkedHashMap<TileKey, DoubleArray>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<TileKey, DoubleArray>?): Boolean = size > 16
    }
    @Volatile private var closed = false

    private suspend fun sampleTile(z: Int, x: Int, y: Int): DoubleArray? {
        if (closed) return null
        val key = TileKey(z, x, y)
        synchronized(sampledTiles) { sampledTiles[key]?.let { return it } }
        val values = coverage.sampleMercatorTile(z, x, y, TILE_SIZE) ?: return null
        if (closed) return null
        synchronized(sampledTiles) { sampledTiles[key] = values }
        return values
    }

    fun close() {
        closed = true
        synchronized(sampledTiles) { sampledTiles.clear() }
    }

    fun renderables(options: NativeTerrainOverlayOptions): List<Renderable> = buildList {
        if (options.elevationColorsEnabled && options.elevationColorsOpacity > 0.0) {
            add(createSurfaceImage("elevation-colors-${options.contourIntervalMeters}-${options.elevationColorsOpacity}", 0, 13) { samples ->
                NativeTerrainOverlayMath.renderElevationColors(samples, TILE_SIZE, options.contourIntervalMeters, options.elevationColorsOpacity)
            })
        }
        if (options.contoursEnabled) {
            add(createSurfaceImage("contours-${options.contourIntervalMeters}", NativeTerrainOverlayMath.contourMinimumZoom(options.contourIntervalMeters), 13) { samples ->
                NativeTerrainOverlayMath.renderContours(samples, TILE_SIZE, options.contourIntervalMeters)
            })
        }
    }

    private fun createSurfaceImage(
        styleKey: String,
        minZoom: Int,
        maxZoom: Int,
        render: (DoubleArray) -> Bitmap,
    ): MercatorTiledSurfaceImage {
        val factory = object : MercatorTileFactory {
            override val contentType = "Shantu terrain overlay $styleKey"
            override fun getImageSource(x: Int, y: Int, z: Int): ImageSource = ImageSource.fromImageFactory(
                TerrainOverlayImageFactory(::sampleTile, x, y, z, render),
            )
        }
        return MercatorTiledImageLayer.buildTiledSurfaceImage(
            factory, true, tileSize = TILE_SIZE, maxZoom = maxZoom, minZoom = minZoom,
        ).apply { detailControl = 1.0 }
    }

    companion object {
        const val TILE_SIZE = 256
        const val ATTRIBUTION = "成都局部 FABDEM V1-2（Hawker / Neal，CC BY-NC-SA 4.0）；其余区域使用 Mapzen / SRTM Terrarium 回退。FABDEM 仅覆盖其真实范围。"
    }
}

private class TerrainOverlayImageFactory(
    private val sample: suspend (z: Int, x: Int, y: Int) -> DoubleArray?,
    private val x: Int,
    private val y: Int,
    private val z: Int,
    private val render: (DoubleArray) -> Bitmap,
) : ImageSource.NetworkBoundImageFactory {
    override suspend fun createCachedBitmap(): Bitmap? = null

    override suspend fun createBitmap(): Bitmap? {
        val samples = sample(z, x, y) ?: return null
        return render(samples)
    }
}
