package com.shantu.nativeapp.floating

import kotlin.math.*

internal data class FloatingCoordinate(val longitude: Double, val latitude: Double)
internal data class FloatingPoint(val x: Float, val y: Float)
internal data class FloatingRouteProjection(val segmentIndex: Int, val fraction: Double, val distanceMeters: Double, val remainingMeters: Double, val offRoute: Boolean)
internal data class FloatingWindowSize(val widthDp: Float, val heightDp: Float)
internal data class FloatingTileIndex(val x: Int, val y: Int)
internal data class FloatingPathBudgetCandidate(
    val tile: FloatingTileIndex,
    val vertexCount: Int,
    val roadSkeleton: Boolean,
)
internal data class FloatingPathBudgetAllocation(
    /** Indices into the input candidate list. Each selected path is kept whole. */
    val selected: IntArray,
    val acceptedVertices: Int,
    val skippedPaths: Int,
)

/** Pure, bounded input and Web-Mercator geometry used by the compact overlay. */
internal object FloatingNavigationGeometry {
    const val MAX_TILE_DRAW_VERTICES = 8_000
    const val MAX_TILE_PATH_CANDIDATES = 16_000
    const val MAX_ROUTE_POINTS = 100_000
    const val MAX_RECORDING_POINTS = 6_000
    const val MAX_PAYLOAD_BYTES = 4 * 1024 * 1024
    const val MIN_ZOOM = 14
    const val MAX_ZOOM = 18
    const val DEFAULT_ROUTE_COLOR = -4_522_174 // 0xffbaff42
    private const val EARTH_RADIUS = 6_378_137.0
    private const val MAX_MERCATOR_LAT = 85.0511287798066

    fun validatePayloadBytes(bytes: ByteArray) {
        require(bytes.size <= MAX_PAYLOAD_BYTES) { "路线数据超过4MiB上限" }
    }

    fun validate(mode: String, label: String, points: List<FloatingCoordinate>) {
        require(mode == "north" || mode == "motion" || mode == "compass") { "方向模式无效" }
        require(label.length <= 160) { "路线名称过长" }
        require(points.size in 2..MAX_ROUTE_POINTS) { "路线点数必须为2至100000" }
        require(points.all { it.longitude.isFinite() && it.longitude in -180.0..180.0 && it.latitude.isFinite() && it.latitude in -90.0..90.0 }) { "路线坐标无效" }
    }

    fun validateSession(kind: String, mode: String, label: String, pointCount: Int, zoom: Int? = null) {
        require(kind == "position" || kind == "route") { "悬浮窗会话类型无效" }
        require(mode == "north" || mode == "motion" || mode == "compass") { "方向模式无效" }
        require(label.length <= 160) { "路线名称过长" }
        if (kind == "position") require(pointCount == 0) { "定位小窗不能包含规划路线" }
        else require(pointCount in 2..MAX_ROUTE_POINTS) { "路线点数必须为2至100000" }
        if (zoom != null) require(zoom in MIN_ZOOM..MAX_ZOOM) { "地图缩放级别必须为14至18" }
    }

    fun validateCoordinate(longitude: Double, latitude: Double) {
        require(longitude.isFinite() && longitude in -180.0..180.0 && latitude.isFinite() && latitude in -90.0..90.0) { "路线坐标无效" }
    }

    /** Optional v1 route color; position payloads must never carry route styling. */
    fun parseRouteColor(kind: String, fieldPresent: Boolean, value: String?): Int {
        if (!fieldPresent) return DEFAULT_ROUTE_COLOR
        require(kind == "route") { "定位小地图不接受路线颜色" }
        require(value != null && value.matches(Regex("^#[0-9A-Fa-f]{6}$"))) { "路线颜色必须是#RRGGBB" }
        return (0xff000000L or value.substring(1).toLong(16)).toInt()
    }

    fun formatRouteColor(color: Int): String = "#" + (color and 0x00ffffff).toString(16).padStart(6, '0').uppercase()

    /** Keep the tile containing the current camera center ahead of cached neighbors. */
    fun prioritizeTileIndices(
        candidates: List<FloatingTileIndex>,
        centerWorldX: Double,
        centerWorldY: Double,
        worldTileCount: Int,
        bearingDegrees: Double,
    ): List<FloatingTileIndex> {
        require(centerWorldX.isFinite() && centerWorldY.isFinite() && worldTileCount > 0 && bearingDegrees.isFinite())
        val centerX = floor(centerWorldX).toInt().coerceIn(0, worldTileCount - 1)
        val centerY = floor(centerWorldY).toInt().coerceIn(0, worldTileCount - 1)
        val radians = Math.toRadians(-bearingDegrees)
        val cos = cos(radians); val sin = sin(radians)
        fun distanceSquared(tile: FloatingTileIndex): Double {
            var dx = tile.x + .5 - centerWorldX
            if (dx > worldTileCount / 2.0) dx -= worldTileCount
            if (dx < -worldTileCount / 2.0) dx += worldTileCount
            val dy = tile.y + .5 - centerWorldY
            val rotatedX = dx * cos - dy * sin
            val rotatedY = dx * sin + dy * cos
            return rotatedX * rotatedX + rotatedY * rotatedY
        }
        return candidates.distinct().sortedWith(
            compareBy<FloatingTileIndex> { if (it.x == centerX && it.y == centerY) 0 else 1 }
                .thenBy { distanceSquared(it) }
                .thenBy { it.y }
                .thenBy { it.x },
        )
    }

    /**
     * Fairly allocate a global path-vertex budget. Each visible tile first gets an
     * equal share for major roads, then other complete paths within that same base
     * share. Leftover capacity is filled round-robin across tiles.
     */
    fun allocatePathBudget(
        visibleTiles: List<FloatingTileIndex>,
        candidates: List<FloatingPathBudgetCandidate>,
        budget: Int = MAX_TILE_DRAW_VERTICES,
    ): FloatingPathBudgetAllocation {
        require(budget >= 0)
        // Callers pass a unique tile order, with that tile's candidates contiguous.
        val tiles = visibleTiles
        if (budget == 0 || tiles.isEmpty() || candidates.isEmpty()) {
            return FloatingPathBudgetAllocation(IntArray(0), 0, candidates.count { it.vertexCount > 0 })
        }
        val tileOrdinals = HashMap<FloatingTileIndex, Int>(tiles.size)
        tiles.forEachIndexed { ordinal, tile -> tileOrdinals[tile] = ordinal }
        val starts = IntArray(tiles.size) { -1 }
        val ends = IntArray(tiles.size)
        candidates.forEachIndexed { index, candidate ->
            val ordinal = tileOrdinals[candidate.tile] ?: return@forEachIndexed
            if (starts[ordinal] < 0) starts[ordinal] = index
            ends[ordinal] = index + 1
        }
        val selected = BooleanArray(candidates.size)
        var remaining = budget
        val base = budget / tiles.size
        val extra = budget % tiles.size
        for ((tileOrdinal, tile) in tiles.withIndex()) {
            var tileRemaining = base + if (tileOrdinal < extra) 1 else 0
            if (starts[tileOrdinal] < 0) continue
            for (index in starts[tileOrdinal] until ends[tileOrdinal]) {
                val path = candidates[index]
                if (path.tile != tile) continue
                if (!path.roadSkeleton || path.vertexCount > tileRemaining || path.vertexCount > remaining) continue
                selected[index] = true
                tileRemaining -= path.vertexCount
                remaining -= path.vertexCount
            }
            // A tile with no major roads still receives useful detail before the
            // center tile can spend the shared remainder on one large feature.
            for (index in starts[tileOrdinal] until ends[tileOrdinal]) {
                val path = candidates[index]
                if (path.tile != tile || path.roadSkeleton || selected[index]) continue
                if (path.vertexCount <= 0 || path.vertexCount > tileRemaining || path.vertexCount > remaining) continue
                selected[index] = true
                tileRemaining -= path.vertexCount
                remaining -= path.vertexCount
            }
        }

        // One path per tile per round prevents the center tile from consuming all
        // remaining detail capacity. Over-budget paths are skipped whole.
        val cursors = IntArray(tiles.size)
        while (remaining > 0) {
            var selectedInRound = false
            for ((tileOrdinal, tile) in tiles.withIndex()) {
                if (starts[tileOrdinal] < 0) continue
                while (starts[tileOrdinal] + cursors[tileOrdinal] < ends[tileOrdinal]) {
                    val index = starts[tileOrdinal] + cursors[tileOrdinal]++
                    if (selected[index]) continue
                    val path = candidates[index]
                    if (path.tile != tile) continue
                    if (path.vertexCount > remaining) continue
                    selected[index] = true
                    remaining -= path.vertexCount
                    selectedInRound = true
                    break
                }
            }
            if (!selectedInRound) break
        }
        val selectedIndices = IntArray(selected.count { it })
        var write = 0
        selected.forEachIndexed { index, keep -> if (keep) selectedIndices[write++] = index }
        return FloatingPathBudgetAllocation(
            selectedIndices,
            budget - remaining,
            candidates.indices.count { candidates[it].vertexCount > 0 && !selected[it] },
        )
    }

    /** Per-visible-tile cap whose sum never exceeds the frame-wide candidate bound. */
    fun pathCandidateLimit(tileOrdinal: Int, visibleTileCount: Int): Int {
        require(visibleTileCount > 0 && tileOrdinal in 0 until visibleTileCount)
        val base = MAX_TILE_PATH_CANDIDATES / visibleTileCount
        return base + if (tileOrdinal < MAX_TILE_PATH_CANDIDATES % visibleTileCount) 1 else 0
    }

    /** Conservative AABB test after applying the same clockwise camera bearing as the Canvas. */
    fun intersectsRotatedViewport(
        minX: Double,
        minY: Double,
        maxX: Double,
        maxY: Double,
        centerX: Double,
        centerY: Double,
        viewportWidth: Double,
        viewportHeight: Double,
        bearingDegrees: Double,
    ): Boolean {
        require(listOf(minX, minY, maxX, maxY, centerX, centerY, viewportWidth, viewportHeight, bearingDegrees).all { it.isFinite() })
        require(minX <= maxX && minY <= maxY && viewportWidth >= 0 && viewportHeight >= 0)
        val radians = Math.toRadians(-bearingDegrees)
        val cos = cos(radians); val sin = sin(radians)
        val dx = (minX + maxX) / 2.0 - centerX
        val dy = (minY + maxY) / 2.0 - centerY
        val rotatedX = dx * cos - dy * sin
        val rotatedY = dx * sin + dy * cos
        val halfWidth = (maxX - minX) / 2.0
        val halfHeight = (maxY - minY) / 2.0
        val rotatedHalfWidth = abs(cos) * halfWidth + abs(sin) * halfHeight
        val rotatedHalfHeight = abs(sin) * halfWidth + abs(cos) * halfHeight
        return abs(rotatedX) <= viewportWidth / 2.0 + rotatedHalfWidth &&
            abs(rotatedY) <= viewportHeight / 2.0 + rotatedHalfHeight
    }

    /** Clamp to screen-safe dp limits even when the device is smaller than the nominal minimum. */
    fun windowSize(widthDp: Float, heightDp: Float, screenWidthDp: Float, screenHeightDp: Float): FloatingWindowSize {
        require(widthDp.isFinite() && heightDp.isFinite() && screenWidthDp.isFinite() && screenHeightDp.isFinite())
        val maxWidth = min(320f, (screenWidthDp - 16f).coerceAtLeast(1f))
        val maxHeight = min(400f, (screenHeightDp - 16f).coerceAtLeast(1f))
        val minWidth = min(160f, maxWidth)
        val minHeight = min(180f, maxHeight)
        return FloatingWindowSize(widthDp.coerceIn(minWidth, maxWidth), heightDp.coerceIn(minHeight, maxHeight))
    }

    fun overzoomScale(zoom: Int): Double {
        require(zoom in MIN_ZOOM..MAX_ZOOM)
        return 2.0.pow(zoom - MIN_ZOOM)
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
