package com.shantu.nativeapp.map

import java.util.TreeSet
import kotlin.math.floor

/** Tile address in the source Mercator quadtree. */
internal data class NativeContourTileKey(val z: Int, val x: Int, val y: Int) {
    init {
        require(z in NativeContourVectorGeometry.SOURCE_MIN_ZOOM..NativeContourVectorGeometry.SOURCE_MAX_ZOOM)
        val count = 1 shl z
        require(x in 0 until count && y in 0 until count)
    }
}

/** The four pixel-center edge profiles from an already sampled DEM tile; no extra source reads. */
internal class NativeContourTileEdges private constructor(
    val size: Int,
    val north: DoubleArray,
    val east: DoubleArray,
    val south: DoubleArray,
    val west: DoubleArray,
) {
    val byteSize: Int get() = size * 4 * java.lang.Double.BYTES

    companion object {
        fun fromSamples(samples: DoubleArray, size: Int): NativeContourTileEdges {
            require(size >= 2 && samples.size == size * size)
            return NativeContourTileEdges(
                size,
                DoubleArray(size) { samples[it] },
                DoubleArray(size) { samples[it * size + size - 1] },
                DoubleArray(size) { samples[(size - 1) * size + it] },
                DoubleArray(size) { samples[it * size] },
            )
        }
    }
}

/** A seam-cell contour in global normalized Web-Mercator coordinates. */
internal data class NativeContourSeamSegment(
    val x1: Double,
    val y1: Double,
    val x2: Double,
    val y2: Double,
    val elevationMeters: Int,
)

internal data class NativeContourSeamLine(val elevationMeters: Int, val coordinates: DoubleArray)

/**
 * Builds only the missing cells between already loaded adjacent tiles. Tile centers are kept at
 * their true dyadic positions, including mixed z12/z13 boundaries; endpoints are never rounded
 * or welded. Each output segment is independent, so this cannot join unrelated contour endpoints.
 */
internal object NativeContourSeamGeometry {
    private const val COORDINATE_ZOOM = NativeContourVectorGeometry.SOURCE_MAX_ZOOM
    private const val MAX_SEAM_SEGMENTS = 1_024
    private const val MAX_SEAM_LEVEL_CANDIDATES = 16_384

    private data class Profile(val start: Double, val end: Double, val values: DoubleArray) {
        fun at(position: Double): Double? {
            if (position < start || position > end) return null
            val index = (position - start) / (end - start) * (values.size - 1)
            val low = floor(index).toInt().coerceIn(0, values.lastIndex)
            val fraction = index - low
            if (fraction <= 1e-12) return values[low].takeIf(Double::isFinite)
            val high = (low + 1).coerceAtMost(values.lastIndex)
            val a = values[low]; val b = values[high]
            if (!a.isFinite() || !b.isFinite()) return null
            return a + (b - a) * fraction
        }
    }

    fun areAdjacent(a: NativeContourTileKey, b: NativeContourTileKey): Boolean {
        val scaleA = 1 shl (COORDINATE_ZOOM - a.z)
        val scaleB = 1 shl (COORDINATE_ZOOM - b.z)
        val ax0 = a.x * scaleA; val ax1 = (a.x + 1) * scaleA
        val ay0 = a.y * scaleA; val ay1 = (a.y + 1) * scaleA
        val bx0 = b.x * scaleB; val bx1 = (b.x + 1) * scaleB
        val by0 = b.y * scaleB; val by1 = (b.y + 1) * scaleB
        val vertical = (ax1 == bx0 || bx1 == ax0) && maxOf(ay0, by0) < minOf(ay1, by1)
        val horizontal = (ay1 == by0 || by1 == ay0) && maxOf(ax0, bx0) < minOf(ax1, bx1)
        return vertical.xor(horizontal)
    }

    fun between(
        firstKey: NativeContourTileKey,
        firstEdges: NativeContourTileEdges,
        secondKey: NativeContourTileKey,
        secondEdges: NativeContourTileEdges,
        interval: Int,
    ): List<NativeContourSeamSegment> {
        require(interval in NativeTerrainOverlayMath.INTERVALS)
        require(firstEdges.size == secondEdges.size)
        val firstScale = 1 shl (COORDINATE_ZOOM - firstKey.z)
        val secondScale = 1 shl (COORDINATE_ZOOM - secondKey.z)
        val ax0 = firstKey.x * firstScale
        val ax1 = (firstKey.x + 1) * firstScale
        val ay0 = firstKey.y * firstScale
        val ay1 = (firstKey.y + 1) * firstScale
        val bx0 = secondKey.x * secondScale
        val bx1 = (secondKey.x + 1) * secondScale
        val by0 = secondKey.y * secondScale
        val by1 = (secondKey.y + 1) * secondScale

        val isVertical = (ax1 == bx0 || bx1 == ax0) && maxOf(ay0, by0) < minOf(ay1, by1)
        val isHorizontal = (ay1 == by0 || by1 == ay0) && maxOf(ax0, bx0) < minOf(ax1, bx1)
        if (!isVertical && !isHorizontal) return emptyList()
        // A quadtree pair can share only one edge; reject malformed/ambiguous addresses.
        require(isVertical.xor(isHorizontal))

        val alongStart = if (isVertical) maxOf(ay0, by0).toDouble() else maxOf(ax0, bx0).toDouble()
        val alongEnd = if (isVertical) minOf(ay1, by1).toDouble() else minOf(ax1, bx1).toDouble()
        val firstIsLeading = if (isVertical) ax0 < bx0 else ay0 < by0
        val leadingKey = if (firstIsLeading) firstKey else secondKey
        val leadingEdges = if (firstIsLeading) firstEdges else secondEdges
        val trailingKey = if (firstIsLeading) secondKey else firstKey
        val trailingEdges = if (firstIsLeading) secondEdges else firstEdges
        val leadingScale = 1 shl (COORDINATE_ZOOM - leadingKey.z)
        val trailingScale = 1 shl (COORDINATE_ZOOM - trailingKey.z)
        val leadingOrigin = if (isVertical) leadingKey.y * leadingScale else leadingKey.x * leadingScale
        val trailingOrigin = if (isVertical) trailingKey.y * trailingScale else trailingKey.x * trailingScale
        val leadValues = if (isVertical) leadingEdges.east else leadingEdges.south
        val trailValues = if (isVertical) trailingEdges.west else trailingEdges.north
        val lead = profile(leadingOrigin.toDouble(), leadingScale.toDouble(), leadValues)
        val trail = profile(trailingOrigin.toDouble(), trailingScale.toDouble(), trailValues)
        val commonStart = maxOf(alongStart, lead.start, trail.start)
        val commonEnd = minOf(alongEnd, lead.end, trail.end)
        if (commonStart >= commonEnd) return emptyList()

        // Use the union of the two true sample-center lattices. Dyadic values are exactly
        // representable; exact set membership deduplicates coincident nodes without tolerance.
        val positions = TreeSet<Double>()
        positions += commonStart
        positions += commonEnd
        addProfilePositions(positions, lead, commonStart, commonEnd)
        addProfilePositions(positions, trail, commonStart, commonEnd)
        val along = positions.toList()
        if (along.size < 2) return emptyList()

        // Convert each side's outermost sample center to common global coordinates.
        val trailCross = if (isVertical) (trailingKey.x + 1.0 / (2.0 * trailingEdges.size)) / (1 shl trailingKey.z)
            else (trailingKey.y + 1.0 / (2.0 * trailingEdges.size)) / (1 shl trailingKey.z)
        val crossLeading = if (isVertical) (leadingKey.x + 1.0 - 0.5 / leadingEdges.size) / (1 shl leadingKey.z)
            else (leadingKey.y + 1.0 - 0.5 / leadingEdges.size) / (1 shl leadingKey.z)
        val crossTrailing = trailCross
        val output = ArrayList<NativeContourSeamSegment>()
        var levelCandidates = 0
        for (i in 0 until along.lastIndex) {
            val p0 = along[i]; val p1 = along[i + 1]
            val l0 = lead.at(p0) ?: continue
            val l1 = lead.at(p1) ?: continue
            val t0 = trail.at(p0) ?: continue
            val t1 = trail.at(p1) ?: continue
            val minimum = minOf(l0, l1, t0, t1)
            val maximum = maxOf(l0, l1, t0, t1)
            levelCandidates += (floor(maximum / interval) - floor(minimum / interval) + 1.0).toInt().coerceAtLeast(0)
            if (levelCandidates > MAX_SEAM_LEVEL_CANDIDATES) return emptyList()
            val cell = if (isVertical) doubleArrayOf(l0, t0, t1, l1) else doubleArrayOf(l0, l1, t1, t0)
            val localSegments = NativeTerrainOverlayMath.contourSegments(cell, 2, interval)
            for (segment in localSegments) {
                if (output.size >= MAX_SEAM_SEGMENTS) return emptyList()
                val alongDelta = p1 - p0
                val x1: Double; val y1: Double; val x2: Double; val y2: Double
                if (isVertical) {
                    x1 = crossLeading + (crossTrailing - crossLeading) * segment.x1
                    y1 = (p0 + alongDelta * segment.y1) / (1 shl COORDINATE_ZOOM)
                    x2 = crossLeading + (crossTrailing - crossLeading) * segment.x2
                    y2 = (p0 + alongDelta * segment.y2) / (1 shl COORDINATE_ZOOM)
                } else {
                    x1 = (p0 + alongDelta * segment.x1) / (1 shl COORDINATE_ZOOM)
                    y1 = crossLeading + (crossTrailing - crossLeading) * segment.y1
                    x2 = (p0 + alongDelta * segment.x2) / (1 shl COORDINATE_ZOOM)
                    y2 = crossLeading + (crossTrailing - crossLeading) * segment.y2
                }
                output += NativeContourSeamSegment(x1, y1, x2, y2, segment.elevationMeters)
            }
        }
        return output
    }

    /** One independent two-vertex line; never concatenate separate crossings into a false bridge. */
    fun toIndependentCoordinates(segment: NativeContourSeamSegment): DoubleArray = doubleArrayOf(
        segment.x1 * 360.0 - 180.0,
        Math.toDegrees(kotlin.math.atan(kotlin.math.sinh(Math.PI * (1.0 - 2.0 * segment.y1)))),
        segment.x2 * 360.0 - 180.0,
        Math.toDegrees(kotlin.math.atan(kotlin.math.sinh(Math.PI * (1.0 - 2.0 * segment.y2)))),
    )

    fun independentLines(segments: List<NativeContourSeamSegment>): List<NativeContourSeamLine> =
        segments.map { NativeContourSeamLine(it.elevationMeters, toIndependentCoordinates(it)) }

    private fun profile(origin: Double, span: Double, values: DoubleArray): Profile {
        val step = span / values.size
        return Profile(origin + step * 0.5, origin + span - step * 0.5, values)
    }

    private fun addProfilePositions(target: TreeSet<Double>, profile: Profile, low: Double, high: Double) {
        if (profile.values.size < 2) return
        val step = (profile.end - profile.start) / (profile.values.size - 1)
        for (i in profile.values.indices) {
            val position = profile.start + step * i
            if (position > low && position < high) target += position
        }
    }
}
