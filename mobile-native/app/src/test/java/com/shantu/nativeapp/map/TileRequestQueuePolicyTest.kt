package com.shantu.nativeapp.map

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class TileRequestQueuePolicyTest {
    private fun id(x: Int, auth: String = "account-A") = TileRequestIdentity(
        sourceId = "source", layerId = "img", z = 8, x = x, y = 6,
        styleNamespace = "default", authNamespace = auth,
    )

    private fun pending(seq: Long, view: String, x: Int = seq.toInt(), generation: Long = 1) =
        TilePendingRequest(seq, view, generation, seq, id(x))

    @Test fun `pending request order uses latest screen distance demand`() {
        val policy = TileRequestQueuePolicy()
        val near = pending(1, "main", 1)
        val far = pending(2, "main", 2)
        val requests = listOf(near, far)
        val old = mapOf("main" to TileViewDemand("main", 1, true, mapOf(near.identity to 20.0, far.identity to 500.0)))
        assertEquals(near, policy.selectNext(requests, old, nowNanos = 0))

        val moved = mapOf("main" to TileViewDemand("main", 1, true, mapOf(near.identity to 700.0, far.identity to 5.0)))
        assertEquals("queued work re-ranks against the newest view snapshot", far, policy.selectNext(requests, moved, nowNanos = 1))
    }

    @Test fun `stale generation is background work and visible current view wins`() {
        val policy = TileRequestQueuePolicy()
        val stale = pending(1, "main", 1, generation = 2)
        val current = pending(2, "main", 2, generation = 3)
        val demand = mapOf("main" to TileViewDemand("main", 3, true, mapOf(current.identity to 30.0)))
        assertEquals(current, policy.selectNext(listOf(stale, current), demand, nowNanos = 0))
    }

    @Test fun `new viewport promotes an older queued request for a tile it still needs`() {
        val policy = TileRequestQueuePolicy()
        val oldRequest = pending(1, "main", 9, generation = 2)
        val currentView = mapOf("secondary" to TileViewDemand(
            "secondary", 7, true, mapOf(oldRequest.identity to 48.0),
        ))
        assertEquals(oldRequest, policy.selectNext(listOf(oldRequest), currentView, nowNanos = 0))
    }

    @Test fun `inactive owner is suppressed but another visible view can retain same identity`() {
        val policy = TileRequestQueuePolicy()
        val tile = pending(1, "main", 9)
        val inactive = TileViewDemand("main", 2, true, emptyMap(), setOf(tile.identity))
        assertEquals(true, policy.isSuppressed(tile, mapOf("main" to inactive)))

        val otherVisible = TileViewDemand("secondary", 8, true, mapOf(tile.identity to 14.0))
        val demands = mapOf("main" to inactive, "secondary" to otherVisible)
        assertEquals(false, policy.isSuppressed(tile, demands))
        assertEquals("another visible view retains the same canonical tile", "secondary", policy.foregroundView(tile, demands))
    }

    @Test fun `missing rank alone means offscreen background rather than hidden`() {
        val policy = TileRequestQueuePolicy()
        val tile = pending(1, "main", 9)
        val enabledOffscreen = TileViewDemand("main", 2, true, emptyMap())
        assertEquals(false, policy.isSuppressed(tile, mapOf("main" to enabledOffscreen)))
        assertEquals(false, policy.isForeground(tile, mapOf("main" to enabledOffscreen)))
    }

    @Test fun `explicit bulk work ignores layer suppression`() {
        val policy = TileRequestQueuePolicy()
        val tile = pending(1, "main", 9).copy(background = true, respectInactiveLayers = false)
        val inactive = TileViewDemand("main", 2, true, emptyMap(), setOf(tile.identity))
        assertEquals(false, policy.isSuppressed(tile, mapOf("main" to inactive)))
    }

    @Test fun `hidden owner suppresses even identities evicted from its footprint registry`() {
        val policy = TileRequestQueuePolicy()
        val tile = pending(1, "main", 9)
        val hiddenOwner = TileViewDemand("main", 3, false, emptyMap())
        assertEquals(true, policy.isSuppressed(tile, mapOf("main" to hiddenOwner)))
    }

    @Test fun `simultaneously visible views share admission after bounded burst`() {
        val policy = TileRequestQueuePolicy(maxSameViewBurst = 2)
        val a1 = pending(1, "main", 1)
        val a2 = pending(2, "main", 2)
        val a3 = pending(3, "main", 3)
        val secondView = pending(4, "secondary", 4)
        val demands = mapOf(
            "main" to TileViewDemand("main", 1, true, mapOf(a1.identity to 0.0, a2.identity to 0.0, a3.identity to 0.0)),
            "secondary" to TileViewDemand("secondary", 1, true, mapOf(secondView.identity to 10.0)),
        )
        assertEquals(a1, policy.selectNext(listOf(a1, a2, a3, secondView), demands, nowNanos = 0))
        assertEquals(a2, policy.selectNext(listOf(a2, a3, secondView), demands, nowNanos = 1))
        assertEquals("visible main/secondary work shares slots fairly", secondView,
            policy.selectNext(listOf(a3, secondView), demands, nowNanos = 2))
        assertEquals(a3, policy.selectNext(listOf(a3), demands, nowNanos = 3))
    }

    @Test fun `stale request with no current visible rank stays behind visible demand`() {
        val policy = TileRequestQueuePolicy(maxSameViewBurst = 1)
        val visible = pending(1, "main", 1, generation = 3)
        val stale = pending(2, "main", 2, generation = 2)
        val demand = mapOf("main" to TileViewDemand("main", 3, true, mapOf(visible.identity to 100.0)))
        assertEquals(visible, policy.selectNext(listOf(stale, visible), demand, nowNanos = 0))
    }

    @Test fun `stable identity deduplicates URL aliases but isolates auth namespaces`() {
        val first = id(12, "credential-hash-1")
        val alias = id(12, "credential-hash-1")
        val otherAccount = id(12, "credential-hash-2")
        assertEquals(first.cacheKey, alias.cacheKey)
        assertNotEquals(first.cacheKey, otherAccount.cacheKey)
        assertNotEquals(first.cacheKey, id(13, "credential-hash-1").cacheKey)
        assertNotEquals(first.cacheKey, id(12, "credential-hash-1").copy(styleNamespace = "night").cacheKey)
    }
}
