package com.shantu.nativeapp.map

/** A complete contour tile exceeded a CPU-geometry bound and must be subdivided or rejected. */
internal class NativeContourGeometryBudgetExceeded(
    val resource: String,
    val limit: Long,
    val requested: Long,
) : IllegalArgumentException("Contour $resource budget exceeded: $requested > $limit")

/** Conservative preflight limits for marching-squares output and WorldWind line assembly. */
internal object NativeContourGeometryBudget {
    const val MAX_SEGMENTS = 65_536
    const val MAX_LOGICAL_VERTICES = 65_536
    const val FLOATS_PER_LOGICAL_VERTEX = 20

    fun ensureSegmentCapacity(current: Int, additional: Int = 1) {
        require(current >= 0 && additional >= 0)
        val requested = current.toLong() + additional.toLong()
        if (requested > MAX_SEGMENTS) {
            throw NativeContourGeometryBudgetExceeded("segments", MAX_SEGMENTS.toLong(), requested)
        }
    }

    /**
     * WorldWind emits one logical vertex for each source point plus three endpoint duplicates
     * per path; each logical vertex occupies twenty float slots in its expanded line batch.
     */
    fun preflight(
        paths: List<NativeContourPath>,
        ensureActive: () -> Unit = {},
    ): Long {
        var logicalVertices = 0L
        for (path in paths) {
            ensureActive()
            val pathVertices = path.points.size.toLong() + 3L
            val requested = logicalVertices + pathVertices
            if (requested < logicalVertices || requested > MAX_LOGICAL_VERTICES) {
                throw NativeContourGeometryBudgetExceeded(
                    "logical vertices", MAX_LOGICAL_VERTICES.toLong(),
                    if (requested < logicalVertices) Long.MAX_VALUE else requested,
                )
            }
            logicalVertices = requested
        }
        return logicalVertices
    }
}
