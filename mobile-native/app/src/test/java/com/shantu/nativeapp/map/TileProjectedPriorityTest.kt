package com.shantu.nativeapp.map

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TileProjectedPriorityTest {
    @Test fun `cursor inside neighboring projected tile footprints ties at zero`() {
        val cursor = TileScreenPoint(100.0, 50.0)
        val left = TileProjectedPriority.bounds(listOf(TileScreenPoint(0.0, 0.0), TileScreenPoint(100.0, 0.0), TileScreenPoint(100.0, 100.0), TileScreenPoint(0.0, 100.0)))!!
        val right = TileProjectedPriority.bounds(listOf(TileScreenPoint(100.0, 0.0), TileScreenPoint(200.0, 0.0), TileScreenPoint(200.0, 100.0), TileScreenPoint(100.0, 100.0)))!!
        assertEquals(0.0, TileProjectedPriority.distance(cursor, left), 0.0)
        assertEquals(0.0, TileProjectedPriority.distance(cursor, right), 0.0)
    }

    @Test fun `offscreen rank measures distance to projected bounds`() {
        val bounds = TileProjectedPriority.bounds(listOf(TileScreenPoint(10.0, 10.0), TileScreenPoint(30.0, 10.0), TileScreenPoint(30.0, 20.0), TileScreenPoint(10.0, 20.0)))!!
        assertEquals(5.0, TileProjectedPriority.distance(TileScreenPoint(35.0, 15.0), bounds), 0.0)
        assertEquals(kotlin.math.sqrt(50.0), TileProjectedPriority.distance(TileScreenPoint(35.0, 25.0), bounds), 1e-12)
    }

    @Test fun `projected quad uses its edges and equal shared edge priority`() {
        val cursor = TileScreenPoint(100.0, 50.0)
        val a = listOf(TileScreenPoint(0.0, 0.0), TileScreenPoint(100.0, 0.0), TileScreenPoint(100.0, 100.0), TileScreenPoint(0.0, 100.0))
        val b = listOf(TileScreenPoint(100.0, 0.0), TileScreenPoint(200.0, 0.0), TileScreenPoint(200.0, 100.0), TileScreenPoint(100.0, 100.0))
        assertEquals(0.0, TileProjectedPriority.distanceToQuad(cursor, a), 0.0)
        assertEquals(0.0, TileProjectedPriority.distanceToQuad(cursor, b), 0.0)
        assertEquals(10.0, TileProjectedPriority.distanceToQuad(TileScreenPoint(210.0, 50.0), b), 0.0)
    }

    @Test fun `invalid projected corners and tile coordinates are rejected`() {
        assertNull(TileProjectedPriority.bounds(listOf(TileScreenPoint(Double.NaN, 0.0))))
        assertNull(TileProjectedPriority.mercatorCorners(2, 4, 0))
        assertNotNull(TileProjectedPriority.mercatorCorners(2, 3, 0))
    }

    @Test fun `projected footprint intersecting viewport is visible even if every vertex is outside`() {
        val stripe = listOf(TileScreenPoint(-20.0, 20.0), TileScreenPoint(120.0, 20.0), TileScreenPoint(120.0, 30.0), TileScreenPoint(-20.0, 30.0))
        assertEquals(true, TileProjectedPriority.intersectsViewport(stripe, 100.0, 100.0))
        val offscreen = listOf(TileScreenPoint(120.0, 120.0), TileScreenPoint(140.0, 120.0), TileScreenPoint(140.0, 140.0), TileScreenPoint(120.0, 140.0))
        assertEquals(false, TileProjectedPriority.intersectsViewport(offscreen, 100.0, 100.0))
        val disjointCollinear = listOf(TileScreenPoint(120.0, 10.0), TileScreenPoint(140.0, 10.0), TileScreenPoint(140.0, 15.0), TileScreenPoint(120.0, 15.0))
        assertEquals(false, TileProjectedPriority.intersectsViewport(disjointCollinear, 100.0, 100.0))
    }

    @Test fun `mercator grid samples interior and edges for perspective footprint`() {
        val samples = TileProjectedPriority.mercatorGrid(3, 2, 4, segmentsPerSide = 3)!!
        assertEquals(16, samples.size)
        assertTrue(samples.any { it.first == samples[0].first && it.second != samples[0].second })
        assertEquals(null, TileProjectedPriority.convexHull(emptyList()).takeIf { it.isNotEmpty() })
    }
}
