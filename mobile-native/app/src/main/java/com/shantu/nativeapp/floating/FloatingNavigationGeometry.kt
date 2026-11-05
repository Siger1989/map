package com.shantu.nativeapp.floating

import kotlin.math.*

internal data class FloatingCoordinate(val longitude: Double, val latitude: Double)
internal data class FloatingPoint(val x: Float, val y: Float)
internal data class FloatingRouteProjection(val segmentIndex: Int, val fraction: Double, val distanceMeters: Double, val remainingMeters: Double, val offRoute: Boolean)

/** Pure, bounded input and Web-Mercator geometry used by the compact overlay. */
internal object FloatingNavigationGeometry {
    const val MAX_ROUTE_POINTS = 100_000
    const val MAX_PAYLOAD_BYTES = 4 * 1024 * 1024
    private const val EARTH_RADIUS = 6_378_137.0
    private const val MAX_MERCATOR_LAT = 85.0511287798066

    fun validatePayloadBytes(bytes: ByteArray) {
        require(bytes.size <= MAX_PAYLOAD_BYTES) { "路线数据超过4MiB上限" }
    }

    fun validate(mode: String, label: String, points: List<FloatingCoordinate>) {
        require(mode == "north" || mode == "motion") { "方向模式无效" }
        require(label.length <= 160) { "路线名称过长" }
        require(points.size in 2..MAX_ROUTE_POINTS) { "路线点数必须为2至100000" }
        require(points.all { it.longitude.isFinite() && it.longitude in -180.0..180.0 && it.latitude.isFinite() && it.latitude in -90.0..90.0 }) { "路线坐标无效" }
    }

    /** Projects local east/north metres to pixels. Motion bearing (clockwise from north) points to screen-up. */
    fun project(center: FloatingCoordinate, point: FloatingCoordinate, bearingDegrees: Double?, mode: String, width: Float, height: Float, pixelsPerMeter: Double): FloatingPoint {
        require(width.isFinite() && height.isFinite() && width >= 0 && height >= 0 && pixelsPerMeter.isFinite() && pixelsPerMeter > 0)
        val lat0 = Math.toRadians(center.latitude.coerceIn(-MAX_MERCATOR_LAT, MAX_MERCATOR_LAT))
        val north = Math.toRadians(point.latitude.coerceIn(-MAX_MERCATOR_LAT, MAX_MERCATOR_LAT) - center.latitude.coerceIn(-MAX_MERCATOR_LAT, MAX_MERCATOR_LAT)) * EARTH_RADIUS
        val east = Math.toRadians(point.longitude - center.longitude) * EARTH_RADIUS * cos(lat0)
        val bearing = if (mode == "motion") Math.toRadians(bearingDegrees?.takeIf { it.isFinite() } ?: 0.0) else 0.0
        val x = east * cos(bearing) - north * sin(bearing)
        val yUp = east * sin(bearing) + north * cos(bearing)
        return FloatingPoint((width / 2.0 + x * pixelsPerMeter).toFloat(), (height / 2.0 - yUp * pixelsPerMeter).toFloat())
    }

    /** Exact z/x/y Web-Mercator world-pixel projection shared with the visible MVT tile canvas. */
    fun projectTileAligned(center: FloatingCoordinate, point: FloatingCoordinate, zoom: Int, centerX: Float, centerY: Float, tileSizePx: Float = 256f): FloatingPoint {
        require(zoom in 0..22 && centerX.isFinite() && centerY.isFinite() && tileSizePx.isFinite() && tileSizePx > 0)
        val n = 1 shl zoom
        fun worldX(lon: Double) = (lon + 180.0) / 360.0 * n
        fun worldY(lat: Double): Double {
            val r = Math.toRadians(lat.coerceIn(-MAX_MERCATOR_LAT, MAX_MERCATOR_LAT))
            return (1.0 - ln(tan(r) + 1.0 / cos(r)) / Math.PI) / 2.0 * n
        }
        var dx = worldX(point.longitude) - worldX(center.longitude)
        if (dx > n / 2.0) dx -= n
        if (dx < -n / 2.0) dx += n
        val dy = worldY(point.latitude) - worldY(center.latitude)
        return FloatingPoint((centerX + dx * tileSizePx).toFloat(), (centerY + dy * tileSizePx).toFloat())
    }

    fun routeLengthMeters(points: List<FloatingCoordinate>): Double = points.zipWithNext().sumOf { (a, b) -> distance(a, b) }

    fun routeProjection(position: FloatingCoordinate, route: List<FloatingCoordinate>, offRouteThresholdMeters: Double = 35.0): FloatingRouteProjection? {
        if (route.size < 2 || !offRouteThresholdMeters.isFinite() || offRouteThresholdMeters < 0) return null
        var bestDistance = Double.POSITIVE_INFINITY
        var bestSegment = 0
        var bestFraction = 0.0
        var priorLength = 0.0
        var bestAlong = 0.0
        for (i in 0 until route.lastIndex) {
            val a = route[i]; val b = route[i + 1]
            val latRef = Math.toRadians((a.latitude + b.latitude + position.latitude) / 3.0)
            fun xy(p: FloatingCoordinate) = (Math.toRadians(p.longitude - position.longitude) * EARTH_RADIUS * cos(latRef)) to (Math.toRadians(p.latitude - position.latitude) * EARTH_RADIUS)
            val (ax, ay) = xy(a); val (bx, by) = xy(b)
            val dx = bx - ax; val dy = by - ay
            val denom = dx * dx + dy * dy
            val t = if (denom <= 1e-12) 0.0 else ((-ax * dx - ay * dy) / denom).coerceIn(0.0, 1.0)
            val d = hypot(ax + dx * t, ay + dy * t)
            val length = distance(a, b)
            if (d < bestDistance) { bestDistance = d; bestSegment = i; bestFraction = t; bestAlong = priorLength + length * t }
            priorLength += length
        }
        val total = routeLengthMeters(route)
        return FloatingRouteProjection(bestSegment, bestFraction, bestDistance, (total - bestAlong).coerceAtLeast(0.0), bestDistance > offRouteThresholdMeters)
    }

    private fun distance(a: FloatingCoordinate, b: FloatingCoordinate): Double {
        val p1 = Math.toRadians(a.latitude); val p2 = Math.toRadians(b.latitude)
        val dp = p2 - p1; val dl = Math.toRadians(b.longitude - a.longitude)
        val h = sin(dp / 2).pow(2) + cos(p1) * cos(p2) * sin(dl / 2).pow(2)
        return 2 * EARTH_RADIUS * asin(sqrt(h.coerceIn(0.0, 1.0)))
    }
}
