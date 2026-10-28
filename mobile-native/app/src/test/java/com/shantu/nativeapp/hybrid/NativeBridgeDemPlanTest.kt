package com.shantu.nativeapp.hybrid

import org.junit.Assert.*
import org.junit.Test
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.tan
import kotlin.math.PI

class NativeBridgeDemPlanTest {
    @Test fun localFootprintGetsOneTileMarginAndCenterNearestOrdering() {
        val center = NativeBridgeDemPlan.GroundPoint(0.0, 0.0)
        val plan = requireNotNull(NativeBridgeDemPlan.plan(12.8, center, listOf(center)))
        assertEquals(12, plan.zoom)
        assertEquals(9, plan.tiles.size)
        assertEquals(plan.center, plan.tiles.first())
        assertTrue(plan.tiles.all { it.z == 12 })
        assertEquals(setOf(2047, 2048, 2049), plan.tiles.map { it.x }.toSet())
        assertEquals(setOf(2047, 2048, 2049), plan.tiles.map { it.y }.toSet())
    }

    @Test fun largeObliqueFootprintReducesZoomToStayWithinBudgetAndContainsEveryHit() {
        val footprint = listOf(
            NativeBridgeDemPlan.GroundPoint(-42.0, -22.0),
            NativeBridgeDemPlan.GroundPoint(42.0, -22.0),
            NativeBridgeDemPlan.GroundPoint(42.0, 22.0),
            NativeBridgeDemPlan.GroundPoint(-42.0, 22.0),
            NativeBridgeDemPlan.GroundPoint(0.0, 0.0),
        )
        val plan = requireNotNull(NativeBridgeDemPlan.plan(12.0, NativeBridgeDemPlan.GroundPoint(0.0, 0.0), footprint))
        assertTrue(plan.zoom < 12)
        assertTrue(plan.tiles.size <= NativeBridgeDemPlan.MAX_TILES)
        val planned = plan.tiles.map { it.x to it.y }.toSet()
        footprint.forEach { hit -> assertTrue("footprint ground hit must be covered at z=${plan.zoom}", tile(hit, plan.zoom) in planned) }
    }

    @Test fun antimeridianFootprintUsesWrappedShortArcRatherThanWorldwideRectangle() {
        val center = NativeBridgeDemPlan.GroundPoint(180.0, 5.0)
        val footprint = listOf(
            NativeBridgeDemPlan.GroundPoint(179.4, 4.8),
            NativeBridgeDemPlan.GroundPoint(-179.5, 5.2),
        )
        val plan = requireNotNull(NativeBridgeDemPlan.plan(8.0, center, footprint))
        assertEquals(8, plan.zoom)
        assertTrue(plan.tiles.size <= 25)
        assertTrue(plan.tiles.any { it.x == 0 })
        assertTrue(plan.tiles.any { it.x == 255 })
        val circularXSpan = plan.tiles.map { it.x }.toSet().let { xs ->
            val gaps = xs.sorted().zipWithNext().map { (a, b) -> b - a - 1 } + listOf(xs.min() + 256 - xs.max() - 1)
            256 - (gaps.maxOrNull() ?: 0)
        }
        assertTrue("dateline plan should contain only nearby wrapped columns", circularXSpan <= 5)
    }

    @Test fun polarFootprintClampsRowsAndStillCoversTheRealHits() {
        val footprint = listOf(
            NativeBridgeDemPlan.GroundPoint(20.0, 89.9),
            NativeBridgeDemPlan.GroundPoint(21.0, 89.8),
        )
        val plan = requireNotNull(NativeBridgeDemPlan.plan(12.0, NativeBridgeDemPlan.GroundPoint(20.5, 89.85), footprint))
        assertTrue(plan.tiles.all { it.y in 0 until (1 shl plan.zoom) })
        footprint.forEach { assertTrue(tile(it, plan.zoom) in plan.tiles.map { t -> t.x to t.y }.toSet()) }
    }

    @Test fun missingOrInvalidGroundFootprintDoesNotInventAPlan() {
        val center = NativeBridgeDemPlan.GroundPoint(0.0, 0.0)
        assertNull(NativeBridgeDemPlan.plan(12.0, center, emptyList()))
        assertNull(NativeBridgeDemPlan.plan(12.0, center, listOf(NativeBridgeDemPlan.GroundPoint(Double.NaN, 0.0))))
        assertNull(NativeBridgeDemPlan.plan(Double.NaN, center, listOf(center)))
        assertNull(NativeBridgeDemPlan.plan(12.0, NativeBridgeDemPlan.GroundPoint(0.0, 91.0), listOf(center)))
    }

    private fun tile(point: NativeBridgeDemPlan.GroundPoint, z: Int): Pair<Int, Int> {
        val side = 1 shl z
        val wrappedLon = ((point.longitude + 180.0) % 360.0 + 360.0) % 360.0 - 180.0
        val x = floor((wrappedLon + 180.0) / 360.0 * side).toInt().coerceIn(0, side - 1)
        val lat = Math.toRadians(point.latitude.coerceIn(-85.05112878, 85.05112878))
        val y = floor((1.0 - ln(tan(PI / 4 + lat / 2)) / PI) / 2 * side).toInt().coerceIn(0, side - 1)
        return x to y
    }
}
