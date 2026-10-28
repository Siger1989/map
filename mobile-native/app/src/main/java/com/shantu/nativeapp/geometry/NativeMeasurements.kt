package com.shantu.nativeapp.geometry

import kotlin.math.*

/** WGS84 longitude/latitude, matching existing saved objects. Heights are never invented. */
data class GeoPoint(val longitude: Double, val latitude: Double, val altitude: Double? = null) {
    init {
        require(longitude.isFinite() && longitude in -180.0..180.0 && latitude.isFinite() && latitude in -85.0..85.0) { "坐标超出范围" }
        require(altitude == null || altitude.isFinite() && altitude in -12000.0..100000.0) { "高程超出范围" }
    }
}
data class SegmentMeasurement(val horizontal: Double, val bearing: Double?, val rise: Double?, val inclination: Double?, val spatial: Double?)
data class AreaMeasurement(val area: Double, val perimeter: Double)

/** Port of measurement/data.ts and areas/data.ts with the same mean Earth radius. */
object NativeMeasurements {
    private const val RADIUS = 6371008.8
    private const val RAD = Math.PI / 180
    fun segment(a: GeoPoint, b: GeoPoint): SegmentMeasurement {
        val lat1 = a.latitude * RAD; val lat2 = b.latitude * RAD
        val dl = (b.longitude - a.longitude) * RAD; val dp = lat2 - lat1
        val h = sin(dp / 2).pow(2) + cos(lat1) * cos(lat2) * sin(dl / 2).pow(2)
        val horizontal = 2 * RADIUS * asin(sqrt(h.coerceIn(0.0, 1.0)))
        val bearing = if (horizontal < .001 || abs(Math.PI - horizontal / RADIUS) < 1e-8) null else
            (atan2(sin(dl) * cos(lat2), cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(dl)) / RAD + 360) % 360
        val rise = if (a.altitude == null || b.altitude == null) null else b.altitude - a.altitude
        val inclination = if (rise == null || horizontal < .001 && abs(rise) < .001) null else atan2(abs(rise), horizontal) / RAD
        return SegmentMeasurement(horizontal, bearing, rise, inclination, rise?.let { hypot(horizontal, it) })
    }
    fun distance(points: List<GeoPoint>) = points.zipWithNext().sumOf { (a, b) -> segment(a, b).horizontal }
    fun area(closed: List<GeoPoint>): AreaMeasurement {
        var sum = 0.0; var perimeter = 0.0
        closed.zipWithNext().forEach { (a, b) ->
            sum += wrap(b.longitude - a.longitude) * RAD * (2 + sin(a.latitude * RAD) + sin(b.latitude * RAD))
            perimeter += segment(a, b).horizontal
        }
        return AreaMeasurement(abs(sum) * RADIUS * RADIUS / 2, perimeter)
    }
    fun closeBoundary(input: List<GeoPoint>): List<GeoPoint> {
        require(input.size <= 6001) { "区域超过6000个边界点" }
        val points = input.filterIndexed { index, p -> index == 0 || !same(p, input[index - 1]) }.toMutableList()
        if (points.size > 1 && same(points.first(), points.last())) points.removeAt(points.lastIndex)
        require(points.size >= 3) { "至少需要三个不同边界点" }
        val xy = points.map { wrap(it.longitude - points[0].longitude) to it.latitude }
        fun cross(a: Pair<Double, Double>, b: Pair<Double, Double>, c: Pair<Double, Double>) =
            (b.first - a.first) * (c.second - a.second) - (b.second - a.second) * (c.first - a.first)
        for (i in xy.indices) {
            val a = xy[(i + xy.size - 1) % xy.size]; val b = xy[i]; val c = xy[(i + 1) % xy.size]
            require(cross(a, b, c) != 0.0 || (a.first - b.first) * (c.first - b.first) + (a.second - b.second) * (c.second - b.second) <= 0) { "边界相交或重叠" }
        }
        data class Edge(val a: Pair<Double, Double>, val b: Pair<Double, Double>, val index: Int) {
            val minX = min(a.first, b.first); val maxX = max(a.first, b.first)
        }
        val edges = xy.mapIndexed { i, p -> Edge(p, xy[(i + 1) % xy.size], i) }.sortedBy { it.minX }
        for (i in edges.indices) {
            val a = edges[i]
            for (j in i + 1 until edges.size) {
                val b = edges[j]
                if (b.minX > a.maxX) break
                if (abs(a.index - b.index) == 1 || abs(a.index - b.index) == edges.size - 1) continue
                if (max(a.a.second, a.b.second) < min(b.a.second, b.b.second) || max(b.a.second, b.b.second) < min(a.a.second, a.b.second)) continue
                require(!(cross(a.a, a.b, b.a) * cross(a.a, a.b, b.b) <= 0 && cross(b.a, b.b, a.a) * cross(b.a, b.b, a.b) <= 0)) { "边界相交或重叠" }
            }
        }
        points.add(points.first())
        require(area(points).area >= .01) { "边界点不能全部在同一直线上" }
        return points
    }
    private fun same(a: GeoPoint, b: GeoPoint) = a.longitude == b.longitude && a.latitude == b.latitude
    private fun wrap(value: Double) = ((value + 180) % 360 + 360) % 360 - 180
}
