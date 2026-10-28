package com.shantu.nativeapp.hybrid

import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.tan
import kotlin.math.PI

/** Bounded Web-Mercator tile coverage for real viewport ground-ray intersections. */
internal object NativeBridgeDemPlan {
    data class GroundPoint(val longitude: Double, val latitude: Double)
    data class Tile(val z: Int, val x: Int, val y: Int)
    data class Plan(val zoom: Int, val center: Tile, val tiles: List<Tile>)

    /**
     * Plans the smallest same-zoom rectangle containing every supplied real ground hit plus
     * a one-tile margin. If it would exceed [MAX_TILES], the zoom is reduced until bounded.
     * Returns null when there are no usable footprint hits; center alone is never treated as DEM.
     */
    fun plan(
        cameraZoom: Double,
        centerLonLat: GroundPoint,
        viewportGroundFootprint: List<GroundPoint>,
    ): Plan? {
        if (!cameraZoom.isFinite() || !validPoint(centerLonLat) || viewportGroundFootprint.isEmpty()) return null
        val footprint = viewportGroundFootprint.filter(::validPoint)
        if (footprint.isEmpty()) return null

        val requestedZoom = floor(cameraZoom).toInt().coerceIn(0, MAX_ZOOM)
        for (z in requestedZoom downTo 0) {
            val side = 1 shl z
            val center = tileFor(centerLonLat, z)
            val footprintTiles = footprint.map { tileFor(it, z) }
            val yMin = (footprintTiles.minOf { it.y } - 1).coerceAtLeast(0)
            val yMax = (footprintTiles.maxOf { it.y } + 1).coerceAtMost(side - 1)
            val (arcStart, arcEnd, arcWidth) = smallestCircularArc(footprintTiles.map { it.x }.distinct().sorted(), side)
            val xWidth = (arcWidth + 2).coerceAtMost(side)
            val xStart = if (xWidth == side) 0 else wrapTileX(arcStart - 1, side)
            val rows = yMax - yMin + 1
            if (xWidth.toLong() * rows.toLong() > MAX_TILES) continue

            val tiles = ArrayList<Tile>(xWidth * rows)
            for (dy in yMin..yMax) for (dx in 0 until xWidth) {
                val x = if (xWidth == side) dx else wrapTileX(xStart + dx, side)
                tiles += Tile(z, x, dy)
            }
            val ordered = tiles.distinct().sortedWith(
                compareBy<Tile> { tileDistanceSquared(it, center, side) }
                    .thenBy { it.y }.thenBy { it.x },
            )
            if (ordered.size <= MAX_TILES) return Plan(z, center, ordered)
        }
        return null
    }

    private fun validPoint(point: GroundPoint): Boolean =
        point.longitude.isFinite() && point.latitude.isFinite() && point.latitude in -90.0..90.0

    private fun tileFor(point: GroundPoint, z: Int): Tile {
        val side = 1 shl z
        val longitude = normalizeLongitude(point.longitude)
        val x = floor((longitude + 180.0) / 360.0 * side).toInt().coerceIn(0, side - 1)
        val latitude = point.latitude.coerceIn(-MAX_MERCATOR_LATITUDE, MAX_MERCATOR_LATITUDE)
        val radians = Math.toRadians(latitude)
        val mercatorY = (1.0 - ln(tan(PI / 4.0 + radians / 2.0)) / PI) / 2.0
        val y = floor(mercatorY * side).toInt().coerceIn(0, side - 1)
        return Tile(z, x, y)
    }

    /** Returns the shortest circular x interval containing tileXs; endpoints are inclusive. */
    private fun smallestCircularArc(tileXs: List<Int>, side: Int): Triple<Int, Int, Int> {
        if (tileXs.size <= 1) {
            val x = tileXs.firstOrNull() ?: 0
            return Triple(x, x, 1)
        }
        var largestStep = -1
        var gapAfterIndex = 0
        for (i in tileXs.indices) {
            val next = tileXs[(i + 1) % tileXs.size]
            val step = (next - tileXs[i] + side) % side
            if (step > largestStep) {
                largestStep = step
                gapAfterIndex = i
            }
        }
        val start = tileXs[(gapAfterIndex + 1) % tileXs.size]
        val end = tileXs[gapAfterIndex]
        val width = (end - start + side) % side + 1
        return Triple(start, end, width)
    }

    private fun tileDistanceSquared(tile: Tile, center: Tile, side: Int): Long {
        val direct = kotlin.math.abs(tile.x - center.x)
        val dx = minOf(direct, side - direct)
        val dy = tile.y - center.y
        return dx.toLong() * dx + dy.toLong() * dy
    }

    private fun wrapTileX(x: Int, side: Int): Int = ((x % side) + side) % side

    private fun normalizeLongitude(longitude: Double): Double {
        val wrapped = ((longitude + 180.0) % 360.0 + 360.0) % 360.0 - 180.0
        return if (wrapped == -180.0 && longitude > 0.0) 180.0 - 1e-12 else wrapped
    }

    const val MAX_ZOOM = 12
    const val MAX_TILES = 25
    private const val MAX_MERCATOR_LATITUDE = 85.05112878
}
