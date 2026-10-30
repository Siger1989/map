package com.shantu.nativeapp.map

import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TileRequestPermitSchedulerTest {
    private fun ticket(sequence: Long, view: String? = null, generation: Long? = null, background: Boolean = false) =
        TilePendingRequest(sequence, view, generation, sequence, TileRequestIdentity("s", "l", 4, sequence.toInt(), 3, "style", "auth"), background)

    @Test fun `one total gate admits exactly twenty active io requests`() = runBlocking {
        val scheduler = TileRequestPermitScheduler(demands = { emptyMap() })
        val active = (1L..20L).map { scheduler.acquire(ticket(it))!! }
        assertEquals(20, scheduler.activeCount())
        val twentyFirst = async { scheduler.acquire(ticket(21)) }
        yield()
        assertTrue(!twentyFirst.isCompleted)
        scheduler.release(active.first())
        assertNotNull(twentyFirst.await())
        assertEquals(20, scheduler.activeCount())
        scheduler.close()
    }

    @Test fun `background is capped at two and latest foreground demand wakes ahead of it`() = runBlocking {
        var currentDemands = emptyMap<String, TileViewDemand>()
        val scheduler = TileRequestPermitScheduler(demands = { currentDemands })
        val firstBackground = scheduler.acquire(ticket(1, background = true))!!
        val secondBackground = scheduler.acquire(ticket(2, background = true))!!
        val thirdBackground = async { scheduler.acquire(ticket(3, background = true)) }
        yield()
        assertTrue(!thirdBackground.isCompleted)

        val foreground = ticket(4, view = "main", generation = 9)
        currentDemands = mapOf("main" to TileViewDemand("main", 9, true, mapOf(foreground.identity to 0.0)))
        scheduler.onDemandChanged()
        val foregroundPermit = async { scheduler.acquire(foreground) }.await()
        assertNotNull(foregroundPermit)
        assertEquals("foreground can use reserved capacity while background work remains in flight", 3, scheduler.activeCount())

        scheduler.release(firstBackground)
        assertNotNull(thirdBackground.await())
        scheduler.release(secondBackground)
        scheduler.release(foregroundPermit!!)
        scheduler.close()
    }

    @Test fun `same visible tile queued under stale generation is promoted by another view`() = runBlocking {
        var currentDemands = emptyMap<String, TileViewDemand>()
        val scheduler = TileRequestPermitScheduler(capacity = 1, demands = { currentDemands })
        val active = scheduler.acquire(ticket(1))!!
        val stale = ticket(2, view = "main", generation = 2)
        val queued = async { scheduler.acquire(stale) }
        yield()
        assertTrue(!queued.isCompleted)

        currentDemands = mapOf("secondary" to TileViewDemand(
            "secondary", 8, true, mapOf(stale.identity to 40.0),
        ))
        scheduler.onDemandChanged()
        scheduler.release(active)
        val promoted = queued.await()
        assertNotNull(promoted)
        assertTrue("current canonical demand upgrades the old generation's queued work", !promoted!!.background)
        scheduler.release(promoted)
        scheduler.close()
    }

    @Test fun `layer deactivation immediately completes queued request without starting it`() = runBlocking {
        var currentDemands = emptyMap<String, TileViewDemand>()
        val scheduler = TileRequestPermitScheduler(capacity = 1, demands = { currentDemands })
        val active = scheduler.acquire(ticket(1))!!
        val hidden = ticket(2, view = "main", generation = 4)
        val queued = async { scheduler.acquire(hidden) }
        yield()
        assertTrue(!queued.isCompleted)

        currentDemands = mapOf("main" to TileViewDemand("main", 5, true, emptyMap(), setOf(hidden.identity)))
        scheduler.onDemandChanged()
        assertNull(queued.await())
        assertEquals(1, scheduler.activeCount())
        assertEquals(0, scheduler.queuedCount())
        scheduler.release(active)
        scheduler.close()
    }

    @Test fun `alternate visible view keeps an inactive owners same tile queued`() = runBlocking {
        var currentDemands = emptyMap<String, TileViewDemand>()
        val scheduler = TileRequestPermitScheduler(capacity = 1, demands = { currentDemands })
        val active = scheduler.acquire(ticket(1))!!
        val sameTile = ticket(2, view = "main", generation = 4)
        val queued = async { scheduler.acquire(sameTile) }
        yield()
        currentDemands = mapOf(
            "main" to TileViewDemand("main", 5, true, emptyMap(), setOf(sameTile.identity)),
            "secondary" to TileViewDemand("secondary", 9, true, mapOf(sameTile.identity to 30.0)),
        )
        scheduler.onDemandChanged()
        assertTrue("visible demand in another view keeps the ticket pending", !queued.isCompleted)
        scheduler.release(active)
        val promoted = queued.await()
        assertNotNull(promoted)
        assertTrue(!promoted!!.background)
        scheduler.release(promoted)
        scheduler.close()
    }

    @Test fun `removed view tombstone suppresses queued work while another live view can still need it`() = runBlocking {
        var currentDemands = emptyMap<String, TileViewDemand>()
        val removedViews = mutableSetOf<String>()
        val scheduler = TileRequestPermitScheduler(
            capacity = 1,
            demands = { currentDemands },
            removedViewIds = { removedViews.toSet() },
        )
        val active = scheduler.acquire(ticket(1))!!
        val closingView = ticket(2, view = "closing-view", generation = 4)
        val queued = async { scheduler.acquire(closingView) }
        yield()
        removedViews += "closing-view"
        scheduler.onDemandChanged()
        assertNull("closed view's request is removed immediately", queued.await())

        val retained = ticket(3, view = "closing-view", generation = 4).copy(identity = closingView.identity)
        val liveDemand = TileViewDemand("live-view", 9, true, mapOf(closingView.identity to 12.0))
        currentDemands = mapOf("live-view" to liveDemand)
        val retainedWaiter = async { scheduler.acquire(retained) }
        yield()
        assertTrue(!retainedWaiter.isCompleted)
        scheduler.release(active)
        val promoted = retainedWaiter.await()
        assertNotNull(promoted)
        assertTrue("another live view can promote the same identity past its closed owner", !promoted!!.background)
        scheduler.release(promoted)
        scheduler.close()
    }

    @Test fun `closed gate wakes a queued request without leaking a permit`() = runBlocking {
        val scheduler = TileRequestPermitScheduler(capacity = 1, demands = { emptyMap() })
        val active = scheduler.acquire(ticket(1))!!
        val queued = async { scheduler.acquire(ticket(2)) }
        yield()
        scheduler.close()
        assertNull(queued.await())
        scheduler.release(active)
        assertEquals(0, scheduler.activeCount())
    }
}
