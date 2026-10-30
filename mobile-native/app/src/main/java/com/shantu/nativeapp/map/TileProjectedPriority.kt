package com.shantu.nativeapp.map

import kotlin.math.max
import kotlin.math.sqrt

/** A physical-pixel point and an axis-aligned projection of a tile's visible footprint. */
internal data class TileScreenPoint(val x: Double, val y: Double)
internal data class TileScreenBounds(val left: Double, val top: Double, val right: Double, val bottom: Double)

/**
 * Computes stable demand ranks from real engine-projected tile corners. Distances are measured to the
 * projected footprint (rather than its center), so tiles touching the cursor have equal rank zero.
 */
internal object TileProjectedPriority {
    fun bounds(corners: List<TileScreenPoint>): TileScreenBounds? {
        if (corners.isEmpty() || corners.any { !it.x.isFinite() || !it.y.isFinite() }) return null
        return TileScreenBounds(
            corners.minOf { it.x }, corners.minOf { it.y },
            corners.maxOf { it.x }, corners.maxOf { it.y },
        )
    }

    fun distance(cursor: TileScreenPoint, bounds: TileScreenBounds): Double {
        if (!cursor.x.isFinite() || !cursor.y.isFinite() ||
            !bounds.left.isFinite() || !bounds.top.isFinite() ||
            !bounds.right.isFinite() || !bounds.bottom.isFinite() ||
            bounds.left > bounds.right || bounds.top > bounds.bottom
        ) return Double.POSITIVE_INFINITY
        val dx = max(max(bounds.left - cursor.x, 0.0), cursor.x - bounds.right)
        val dy = max(max(bounds.top - cursor.y, 0.0), cursor.y - bounds.bottom)
        return sqrt(dx * dx + dy * dy)
    }

    fun distanceToQuad(cursor: TileScreenPoint, quad: List<TileScreenPoint>): Double {
        if (quad.size < 3 || !cursor.x.isFinite() || !cursor.y.isFinite() || quad.any { !it.x.isFinite() || !it.y.isFinite() }) {
            return Double.POSITIVE_INFINITY
        }
        var inside = false
        var minDistanceSquared = Double.POSITIVE_INFINITY
        for (index in quad.indices) {
            val a = quad[index]
            val b = quad[(index + 1) % quad.size]
            val crosses = (a.y > cursor.y) != (b.y > cursor.y) &&
                cursor.x < (b.x - a.x) * (cursor.y - a.y) / (b.y - a.y) + a.x
            if (crosses) inside = !inside
            val dx = b.x - a.x; val dy = b.y - a.y
            val lengthSquared = dx * dx + dy * dy
            val t = if (lengthSquared == 0.0) 0.0 else (((cursor.x - a.x) * dx + (cursor.y - a.y) * dy) / lengthSquared).coerceIn(0.0, 1.0)
            val ex = cursor.x - (a.x + t * dx); val ey = cursor.y - (a.y + t * dy)
            minDistanceSquared = minOf(minDistanceSquared, ex * ex + ey * ey)
        }
        return if (inside) 0.0 else sqrt(minDistanceSquared)
    }

    fun intersectsViewport(polygon: List<TileScreenPoint>, width: Double, height: Double): Boolean {
        if (polygon.size < 3 || width <= 0.0 || height <= 0.0 || polygon.any { !it.x.isFinite() || !it.y.isFinite() }) return false
        val viewport = listOf(TileScreenPoint(0.0, 0.0), TileScreenPoint(width, 0.0), TileScreenPoint(width, height), TileScreenPoint(0.0, height))
        if (polygon.any { it.x in 0.0..width && it.y in 0.0..height }) return true
        if (viewport.any { pointInPolygon(it, polygon) }) return true
        for (index in polygon.indices) {
            val a = polygon[index]; val b = polygon[(index + 1) % polygon.size]
            for (edge in viewport.indices) if (segmentsIntersect(a, b, viewport[edge], viewport[(edge + 1) % viewport.size])) return true
        }
        return false
    }

    fun mercatorGrid(z: Int, x: Int, y: Int, segmentsPerSide: Int = 4): List<Pair<Double, Double>>? {
        if (z !in 0..24 || segmentsPerSide !in 1..16) return null
        val n = 1 shl z
        if (x !in 0 until n || y !in 0 until n) return null
        fun latitude(row: Double): Double = Math.toDegrees(kotlin.math.atan(kotlin.math.sinh(Math.PI * (1.0 - 2.0 * row / n))))
        fun longitude(column: Double): Double = column / n * 360.0 - 180.0
        return buildList((segmentsPerSide + 1) * (segmentsPerSide + 1)) {
            for (row in 0..segmentsPerSide) for (column in 0..segmentsPerSide) {
                add(longitude(x + column.toDouble() / segmentsPerSide) to latitude(y + row.toDouble() / segmentsPerSide))
            }
        }
    }

    fun convexHull(points: List<TileScreenPoint>): List<TileScreenPoint> {
        val ordered = points.filter { it.x.isFinite() && it.y.isFinite() }.distinct().sortedWith(compareBy<TileScreenPoint> { it.x }.thenBy { it.y })
        if (ordered.size <= 2) return ordered
        fun cross(o: TileScreenPoint, a: TileScreenPoint, b: TileScreenPoint) = (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
        val lower = mutableListOf<TileScreenPoint>()
        for (point in ordered) { while (lower.size >= 2 && cross(lower[lower.size - 2], lower.last(), point) <= 0.0) lower.removeAt(lower.lastIndex); lower += point }
        val upper = mutableListOf<TileScreenPoint>()
        for (point in ordered.asReversed()) { while (upper.size >= 2 && cross(upper[upper.size - 2], upper.last(), point) <= 0.0) upper.removeAt(upper.lastIndex); upper += point }
        return lower.dropLast(1) + upper.dropLast(1)
    }

    private fun pointInPolygon(point: TileScreenPoint, polygon: List<TileScreenPoint>): Boolean {
        var inside = false
        for (index in polygon.indices) {
            val a = polygon[index]; val b = polygon[(index + 1) % polygon.size]
            if ((a.y > point.y) != (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside
        }
        return inside
    }

    private fun segmentsIntersect(a: TileScreenPoint, b: TileScreenPoint, c: TileScreenPoint, d: TileScreenPoint): Boolean {
        fun orient(p: TileScreenPoint, q: TileScreenPoint, r: TileScreenPoint) = (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
        fun onSegment(p: TileScreenPoint, q: TileScreenPoint, r: TileScreenPoint) =
            q.x in minOf(p.x, r.x)..maxOf(p.x, r.x) && q.y in minOf(p.y, r.y)..maxOf(p.y, r.y)
        val o1 = orient(a, b, c); val o2 = orient(a, b, d); val o3 = orient(c, d, a); val o4 = orient(c, d, b)
        if (o1 == 0.0 && onSegment(a, c, b)) return true
        if (o2 == 0.0 && onSegment(a, d, b)) return true
        if (o3 == 0.0 && onSegment(c, a, d)) return true
        if (o4 == 0.0 && onSegment(c, b, d)) return true
        return (o1 > 0.0) != (o2 > 0.0) && (o3 > 0.0) != (o4 > 0.0)
    }

    /** Mercator XYZ corner coordinates for z/x/y; caller projects each coordinate through WorldWind. */
    fun mercatorCorners(z: Int, x: Int, y: Int): List<Pair<Double, Double>>? {
        if (z !in 0..24) return null
        val n = 1 shl z
        if (x !in 0 until n || y !in 0 until n) return null
        fun latitude(row: Int): Double = Math.toDegrees(kotlin.math.atan(kotlin.math.sinh(Math.PI * (1.0 - 2.0 * row / n))))
        fun longitude(column: Int): Double = column.toDouble() / n * 360.0 - 180.0
        val west = longitude(x); val east = longitude(x + 1)
        val north = latitude(y); val south = latitude(y + 1)
        return listOf(west to north, east to north, east to south, west to south)
    }
}
