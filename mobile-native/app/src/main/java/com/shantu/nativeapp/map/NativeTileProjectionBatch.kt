package com.shantu.nativeapp.map

import earth.worldwind.geom.Angle.Companion.degrees
import earth.worldwind.geom.Matrix4
import earth.worldwind.geom.Vec3
import earth.worldwind.geom.Viewport
import earth.worldwind.globe.Globe

/**
 * Reuses one render-frame MVP and scratch vectors to project tile-ranking coordinates.
 * The geographic conversion and clip-to-screen mapping deliberately use WorldWind's SDK
 * operations so globe projection, viewport origin, clipping and Y orientation stay aligned.
 */
internal class NativeTileProjectionBatch(
    matrix: DoubleArray,
    viewport: Viewport,
    private val globe: Globe,
) {
    private val mvp = Matrix4()
    private val frameViewport = Viewport(viewport)
    private val cartesian = Vec3()
    private val projected = Vec3()

    init {
        require(matrix.size == MATRIX_COMPONENT_COUNT) { "MVP must contain 16 row-major components" }
        require(matrix.all { it.isFinite() }) { "MVP components must be finite" }
        require(!viewport.isEmpty) { "Viewport must have positive width and height" }
        matrix.copyInto(mvp.m)
    }

    /** Projects a ground coordinate using the same altitude-zero path as WorldWind's screen projection. */
    fun project(latitude: Double, longitude: Double): TileScreenPoint? {
        if (!latitude.isFinite() || latitude !in -90.0..90.0 || !longitude.isFinite()) return null

        globe.geographicToCartesian(latitude.degrees, longitude.wrapLongitude().degrees, 0.0, cartesian)
        if (!mvp.project(cartesian.x, cartesian.y, cartesian.z, frameViewport, projected)) return null

        // WorldWind.cartesianToScreenPoint flips Y by viewport.height (not viewport.y + height).
        val x = projected.x
        val y = frameViewport.height - projected.y
        if (!x.isFinite() || !y.isFinite()) return null
        return TileScreenPoint(x, y)
    }

    private fun Double.wrapLongitude() = (((this + 180.0) % 360.0 + 360.0) % 360.0) - 180.0

    private companion object {
        const val MATRIX_COMPONENT_COUNT = 16
    }
}
