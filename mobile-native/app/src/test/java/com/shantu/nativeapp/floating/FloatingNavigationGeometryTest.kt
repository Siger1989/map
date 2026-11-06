package com.shantu.nativeapp.floating

import org.junit.Assert.*
import org.junit.Test

class FloatingNavigationGeometryTest {
    private val origin = FloatingCoordinate(0.0, 0.0)
    private fun around(east: Double, north: Double) = FloatingCoordinate(Math.toDegrees(east / 6_378_137.0), Math.toDegrees(north / 6_378_137.0))

    @Test fun northUpKeepsEastRightAndNorthUp() {
        val east = FloatingNavigationGeometry.project(origin, around(100.0, 0.0), null, "north", 184f, 216f, 1.0)
        val north = FloatingNavigationGeometry.project(origin, around(0.0, 100.0), null, "north", 184f, 216f, 1.0)
        assertTrue(east.x > 92f); assertEquals(108f, east.y, .1f)
        assertEquals(92f, north.x, .1f); assertTrue(north.y < 108f)
    }

    @Test fun motionBearingRotatesTrueTravelDirectionToTop() {
        val east = FloatingNavigationGeometry.project(origin, around(100.0, 0.0), 90.0, "motion", 184f, 216f, 1.0)
        val west = FloatingNavigationGeometry.project(origin, around(-100.0, 0.0), 90.0, "motion", 184f, 216f, 1.0)
        assertEquals(92f, east.x, .2f); assertTrue(east.y < 108f)
        assertEquals(92f, west.x, .2f); assertTrue(west.y > 108f)
    }

    @Test fun routePointAndMvtWorldPixelUseIdenticalZ14Projection() {
        val center = FloatingCoordinate(12.0, 45.0)
        val point = FloatingCoordinate(12.003, 45.002)
        val n = 1 shl 14
        val centerX = (center.longitude + 180.0) / 360.0 * n
        val pointX = (point.longitude + 180.0) / 360.0 * n
        val centerLat = Math.toRadians(center.latitude)
        val pointLat = Math.toRadians(point.latitude)
        val centerY = (1.0 - kotlin.math.ln(kotlin.math.tan(centerLat) + 1.0 / kotlin.math.cos(centerLat)) / Math.PI) / 2.0 * n
        val pointY = (1.0 - kotlin.math.ln(kotlin.math.tan(pointLat) + 1.0 / kotlin.math.cos(pointLat)) / Math.PI) / 2.0 * n
        val projected = FloatingNavigationGeometry.projectTileAligned(center, point, 14, 92f, 70f)
        assertEquals(92.0 + (pointX - centerX) * 256.0, projected.x.toDouble(), .02)
        assertEquals(70.0 + (pointY - centerY) * 256.0, projected.y.toDouble(), .02)
    }

    @Test fun routeRemainingAndOffRouteUseNearestSegment() {
        val route = listOf(around(0.0, 0.0), around(100.0, 0.0), around(200.0, 0.0))
        val on = FloatingNavigationGeometry.routeProjection(around(75.0, 0.0), route)!!
        assertEquals(125.0, on.remainingMeters, 1.0)
        assertFalse(on.offRoute)
        val away = FloatingNavigationGeometry.routeProjection(around(75.0, 60.0), route)!!
        assertTrue(away.offRoute)
    }

    @Test fun rejectsInvalidRouteOrOversizePayload() {
        assertThrows(IllegalArgumentException::class.java) { FloatingNavigationGeometry.validate("north", "x", listOf(origin)) }
        assertThrows(IllegalArgumentException::class.java) { FloatingNavigationGeometry.validate("south", "x", listOf(origin, origin)) }
        assertThrows(IllegalArgumentException::class.java) { FloatingNavigationGeometry.validate("north", "x", listOf(origin, FloatingCoordinate(181.0, 0.0))) }
        assertThrows(IllegalArgumentException::class.java) { FloatingNavigationGeometry.validatePayloadBytes(ByteArray(FloatingNavigationGeometry.MAX_PAYLOAD_BYTES + 1)) }
    }

    @Test fun positionSessionNeedsNoRouteAndZoomIsBounded() {
        FloatingNavigationGeometry.validateSession("position", "north", "定位小地图", 0, 14)
        FloatingNavigationGeometry.validateSession("route", "motion", "路线", 2, 18)
        FloatingNavigationGeometry.validateSession("route", "compass", "路线", 2, 18)
        assertThrows(IllegalArgumentException::class.java) { FloatingNavigationGeometry.validateSession("position", "north", "定位小地图", 2) }
        assertThrows(IllegalArgumentException::class.java) { FloatingNavigationGeometry.validateSession("route", "north", "路线", 0) }
        assertThrows(IllegalArgumentException::class.java) { FloatingNavigationGeometry.validateSession("position", "north", "定位小地图", 0, 19) }
    }

    @Test fun tinyScreensNeverInvertWindowClampBounds() {
        val size = FloatingNavigationGeometry.windowSize(184f, 216f, 150f, 170f)
        assertEquals(134f, size.widthDp, 0f)
        assertEquals(154f, size.heightDp, 0f)
        val normal = FloatingNavigationGeometry.windowSize(500f, 500f, 390f, 780f)
        assertEquals(320f, normal.widthDp, 0f)
        assertEquals(400f, normal.heightDp, 0f)
    }

    @Test fun overzoomPreservesRouteToMvtPixelScale() {
        for (zoom in 14..18) {
            val tileScale = 256f * FloatingNavigationGeometry.overzoomScale(zoom).toFloat()
            val point = FloatingNavigationGeometry.projectTileAligned(origin, around(100.0, 0.0), 14, 92f, 70f, tileScale)
            val base = FloatingNavigationGeometry.projectTileAligned(origin, around(100.0, 0.0), 14, 92f, 70f, 256f)
            assertEquals(92f + (base.x - 92f) * FloatingNavigationGeometry.overzoomScale(zoom).toFloat(), point.x, .01f)
        }
    }

    @Test fun routeColorIsOptionalStrictHexAndNeverPositionStyle() {
        assertEquals(0xffbaff42.toInt(), FloatingNavigationGeometry.parseRouteColor("route", false, null))
        assertEquals(0xffa1b2c3.toInt(), FloatingNavigationGeometry.parseRouteColor("route", true, "#A1b2C3"))
        assertEquals("#A1B2C3", FloatingNavigationGeometry.formatRouteColor(0xffa1b2c3.toInt()))
        assertThrows(IllegalArgumentException::class.java) { FloatingNavigationGeometry.parseRouteColor("route", true, "red") }
        assertThrows(IllegalArgumentException::class.java) { FloatingNavigationGeometry.parseRouteColor("route", true, "#12345") }
        assertThrows(IllegalArgumentException::class.java) { FloatingNavigationGeometry.parseRouteColor("position", true, "#a1b2c3") }
    }

    @Test fun motionTileBudgetPrioritizesCurrentTileOverOldHighVertexTilesAtAnyBearing() {
        val old = FloatingTileIndex(15, 100)
        val current = FloatingTileIndex(100, 100)
        val oldFeatureVertexCounts = List(40) { 200 }
        val currentFeatureVertexCounts = listOf(300)
        val costs = mapOf(old to oldFeatureVertexCounts, current to currentFeatureVertexCounts)
        for (bearing in listOf(0.0, 45.0, 90.0, 180.0, 270.0)) {
            val order = FloatingNavigationGeometry.prioritizeTileIndices(
                listOf(old, current), 100.5, 100.5, 1 shl 14, bearing,
            )
            assertEquals("current center tile must lead at $bearing degrees", current, order.first())

            var budget = 8_000
            val rendered = mutableListOf<FloatingTileIndex>()
            for (tile in order) {
                for (vertices in costs.getValue(tile)) {
                    if (vertices <= budget) { budget -= vertices; rendered += tile }
                }
            }
            assertTrue("current tile must survive old tile vertex pressure at $bearing degrees", current in rendered)

            val oldCenterX = ((old.x + .5) - 100.5) * 256.0
            val oldCenterY = ((old.y + .5) - 100.5) * 256.0
            assertFalse(FloatingNavigationGeometry.intersectsRotatedViewport(
                oldCenterX - 128, oldCenterY - 128, oldCenterX + 128, oldCenterY + 128,
                0.0, 0.0, 180.0, 200.0, bearing,
            ))
        }
    }

    @Test fun pathBudgetSharesRoadSkeletonAcrossVisibleCenterAndNeighborTiles() {
        val center = FloatingTileIndex(100, 100)
        val north = FloatingTileIndex(100, 99)
        val east = FloatingTileIndex(101, 100)
        val south = FloatingTileIndex(100, 101)
        val west = FloatingTileIndex(99, 100)
        val tiles = listOf(center, north, east, south, west)
        val candidates = buildList {
            // A dense center cannot consume the baseline quota before its neighbors.
            repeat(20) { add(FloatingPathBudgetCandidate(center, 500, roadSkeleton = true)) }
            listOf(north, east, south, west).forEach { add(FloatingPathBudgetCandidate(it, 500, roadSkeleton = true)) }
            repeat(16) { add(FloatingPathBudgetCandidate(center, 400, roadSkeleton = false)) }
            listOf(north, east, south, west).forEach { add(FloatingPathBudgetCandidate(it, 400, roadSkeleton = false)) }
        }

        val allocation = FloatingNavigationGeometry.allocatePathBudget(tiles, candidates, budget = 8_000)
        val selectedIndices = allocation.selected.toSet()
        tiles.forEach { tile ->
            val skeleton = candidates.indexOfFirst { it.tile == tile && it.roadSkeleton }
            assertTrue("$tile keeps its complete major-road path", skeleton in selectedIndices)
        }
        assertTrue("total accepted vertices remain within the hard cap", allocation.acceptedVertices <= 8_000)
        assertEquals(allocation.acceptedVertices, allocation.selected.sumOf { candidates[it].vertexCount })
        assertTrue("dense center detail is skipped instead of cutting paths", allocation.skippedPaths > 0)
    }

    @Test fun nonSkeletonPathsCannotLetOneCenterFeatureStarveNeighborTiles() {
        val center = FloatingTileIndex(100, 100)
        val neighbors = listOf(
            FloatingTileIndex(100, 99), FloatingTileIndex(101, 100),
            FloatingTileIndex(100, 101), FloatingTileIndex(99, 100),
        )
        val tiles = listOf(center) + neighbors
        val candidates = listOf(FloatingPathBudgetCandidate(center, 8_000, roadSkeleton = false)) +
            neighbors.map { FloatingPathBudgetCandidate(it, 100, roadSkeleton = false) }

        val allocation = FloatingNavigationGeometry.allocatePathBudget(tiles, candidates, budget = 8_000)
        val selectedIndices = allocation.selected.toSet()
        assertTrue("each neighboring tile keeps its complete path", (1..4).all { it in selectedIndices })
        assertFalse("the oversized center detail is skipped whole", 0 in selectedIndices)
        assertEquals(400, allocation.acceptedVertices)
        assertEquals(400, allocation.selected.sumOf { candidates[it].vertexCount })
        assertTrue(allocation.acceptedVertices <= 8_000)
    }

    @Test fun pathBudgetNeverTruncatesAnOversizePathOrPolygonRing() {
        val tile = FloatingTileIndex(7, 9)
        val candidates = listOf(
            FloatingPathBudgetCandidate(tile, 8_001, roadSkeleton = true),
            FloatingPathBudgetCandidate(tile, 23_000, roadSkeleton = false),
            FloatingPathBudgetCandidate(tile, 7_999, roadSkeleton = true),
        )
        val allocation = FloatingNavigationGeometry.allocatePathBudget(listOf(tile), candidates, budget = 8_000)
        assertEquals(listOf(2), allocation.selected.toList())
        assertEquals(7_999, allocation.acceptedVertices)
        assertEquals(2, allocation.skippedPaths)
    }

    @Test fun candidateCollectionLimitIsHardAndDistributedAcrossVisibleTiles() {
        for (visibleTiles in listOf(1, 5, 16, 32)) {
            val limits = (0 until visibleTiles).map { FloatingNavigationGeometry.pathCandidateLimit(it, visibleTiles) }
            assertTrue(limits.maxOrNull()!! - limits.minOrNull()!! <= 1)
            assertTrue(limits.sum() <= FloatingNavigationGeometry.MAX_TILE_PATH_CANDIDATES)
            if (visibleTiles <= FloatingNavigationGeometry.MAX_TILE_PATH_CANDIDATES) {
                assertEquals(FloatingNavigationGeometry.MAX_TILE_PATH_CANDIDATES, limits.sum())
            }
        }
    }

    @Test fun rotatedFeatureBoundsAreCulledAgainstTheRotatedViewport() {
        for (bearing in listOf(0.0, 45.0, 90.0, 180.0, 270.0)) {
            assertFalse(FloatingNavigationGeometry.intersectsRotatedViewport(
                700.0, -20.0, 760.0, 20.0, 0.0, 0.0, 180.0, 200.0, bearing,
            ))
            assertTrue(FloatingNavigationGeometry.intersectsRotatedViewport(
                40.0, -10.0, 60.0, 10.0, 0.0, 0.0, 180.0, 200.0, bearing,
            ))
        }
    }

    @Test fun tilePriorityKeepsDatelineCenterTileAtTheRightEdge() {
        val n = 1 shl 14
        val edgeTile = FloatingTileIndex(n - 1, 200)
        val wrappedTile = FloatingTileIndex(0, 200)
        val ordered = FloatingNavigationGeometry.prioritizeTileIndices(
            listOf(wrappedTile, edgeTile), n - .2, 200.5, n, 90.0,
        )
        assertEquals(edgeTile, ordered.first())
    }
}
