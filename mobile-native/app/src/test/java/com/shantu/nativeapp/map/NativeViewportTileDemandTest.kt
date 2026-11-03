package com.shantu.nativeapp.map

import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeViewportTileDemandTest {
    @Test fun sourceMaxZoomTileIsRetainedAsAnActualSdkVisitedTile() {
        val demand = NativeViewportTileDemand(maxZoom = 14)
        demand.beginFrame()
        demand.mark(z = 14, x = 7, sdkRow = 4)

        assertEquals(setOf(NativeViewportTileKey(14, 7, 4)), demand.endFrame())
    }

    @Test fun sdkLastLevelAtOriginalMaximumIsVisitedAndNoSentinelKeyIsInvented() {
        val originalMaxZoom = 14
        val demand = NativeViewportTileDemand(maxZoom = originalMaxZoom)
        demand.beginFrame()
        demand.mark(z = originalMaxZoom, x = 15, sdkRow = 9)
        val current = demand.endFrame()

        assertEquals(setOf(NativeViewportTileKey(14, 15, 9)), current)
        assertEquals(16374, current.single().sourceY)
        assertTrue(current.none { it.z > originalMaxZoom })
    }

    @Test fun parentOnlyFrameDoesNotInventOrRetainPendingLeafChildren() {
        val demand = NativeViewportTileDemand(maxZoom = 14)
        demand.beginFrame()
        demand.mark(z = 13, x = 7, sdkRow = 4)
        val parentOnly = demand.endFrame()

        assertEquals(setOf(NativeViewportTileKey(13, 7, 4)), parentOnly)
        assertTrue(parentOnly.none { it.z == 14 })
    }

    @Test fun minimumSourceZoomZeroIsSupported() {
        val demand = NativeViewportTileDemand(maxZoom = 0)
        demand.beginFrame()
        demand.mark(z = 0, x = 0, sdkRow = 0)
        assertEquals(setOf(NativeViewportTileKey(0, 0, 0)), demand.endFrame())
    }

    @Test fun nextZoomOutDemandDropsOldFineKeysAndRanksUnprojectableRetainedKeysLast() {
        val demand = NativeViewportTileDemand(maxZoom = 14)
        demand.beginFrame()
        demand.mark(z = 14, x = 7, sdkRow = 4)
        demand.mark(z = 14, x = 8, sdkRow = 4)
        val oldFineDemand = demand.endFrame().filter { it.z == 14 }.toSet()
        assertEquals(2, oldFineDemand.size)

        demand.beginFrame()
        demand.mark(z = 10, x = 4, sdkRow = 3)
        val zoomOutDemand = demand.endFrame()
        assertTrue(oldFineDemand.intersect(zoomOutDemand).isEmpty())

        val retainedKey = NativeViewportTileKey(10, 4, 3)
        assertEquals(12.0, demand.rankForRetained(retainedKey, 12.0)!!, 0.0)
        assertEquals(Double.MAX_VALUE, demand.rankForRetained(retainedKey, null)!!, 0.0)
        assertEquals(Double.MAX_VALUE, demand.rankForRetained(retainedKey, Double.POSITIVE_INFINITY)!!, 0.0)
        assertNull(demand.rankForRetained(NativeViewportTileKey(10, 5, 3), 1.0))
    }

    @Test fun incompleteTraversalKeepsLastCompleteDemandForBackgroundDecodeChecks() {
        val demand = NativeViewportTileDemand(maxZoom = 14)
        val old = NativeViewportTileKey(12, 7, 4)
        val current = NativeViewportTileKey(10, 4, 3)
        demand.beginFrame()
        demand.mark(old.z, old.x, old.sdkRow)
        demand.endFrame()
        assertTrue(demand.isRetained(old))

        demand.beginFrame()
        demand.mark(current.z, current.x, current.sdkRow)
        assertTrue("a partial frame must not cancel still-needed background work", demand.isRetained(old))
        assertTrue(!demand.isRetained(current))
        demand.endFrame()
        assertTrue(demand.isRetained(current))
        assertTrue(!demand.isRetained(old))
    }

    @Test fun retainedProjectionFallbackWaitsBehindProjectedCenterThenStillGetsAdmitted() = runBlocking {
        val demand = NativeViewportTileDemand(maxZoom = 14)
        val center = NativeViewportTileKey(10, 1, 1)
        val edge = NativeViewportTileKey(10, 2, 2)
        demand.beginFrame()
        demand.mark(center.z, center.x, center.sdkRow)
        demand.mark(edge.z, edge.x, edge.sdkRow)
        demand.endFrame()

        val queue = NativeViewportTileQueue<NativeViewportTileKey>(capacity = 1, maximumRequests = 2)
        val centerWaiter = async { queue.acquire(center) }
        val edgeWaiter = async { queue.acquire(edge) }
        yield()
        val rank: (NativeViewportTileKey) -> Double? = { key -> demand.rankForRetained(key, if (key == center) 2.0 else null) }
        assertEquals(listOf(center), queue.dispatch(rank))
        centerWaiter.await()!!.close()
        assertEquals(listOf(edge), queue.dispatch(rank))
        edgeWaiter.await()!!.close()
    }
}
