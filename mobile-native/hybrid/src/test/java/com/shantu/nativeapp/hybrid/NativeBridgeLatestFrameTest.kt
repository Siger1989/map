package com.shantu.nativeapp.hybrid

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class NativeBridgeLatestFrameTest {
    @Test fun consecutiveOffersKeepOnlyTheNewestValue() {
        val mailbox = NativeBridgeLatestFrame<Int>()
        mailbox.offer(1)
        mailbox.offer(2)
        mailbox.offer(3)

        assertTrue(mailbox.hasPending())
        assertEquals(3, mailbox.takeLatest())
        assertFalse(mailbox.hasPending())
        assertNull(mailbox.takeLatest())
    }

    @Test fun offerAfterUiTakeRemainsPendingForTheNextTake() {
        val mailbox = NativeBridgeLatestFrame<String>()
        val consumed = CountDownLatch(1)
        val offered = CountDownLatch(1)
        mailbox.offer("frame-1")
        val producer = Thread {
            assertTrue(consumed.await(2, TimeUnit.SECONDS))
            mailbox.offer("frame-2")
            offered.countDown()
        }
        producer.start()

        assertEquals("frame-1", mailbox.takeLatest())
        consumed.countDown()
        assertTrue(offered.await(2, TimeUnit.SECONDS))
        producer.join(2_000)
        assertFalse(producer.isAlive)
        assertEquals("frame-2", mailbox.takeLatest())
        assertFalse(mailbox.hasPending())
    }

    @Test fun multipleProducersCanFinishBeforeFinalSentinelIsTakenAndMailboxDrains() {
        val mailbox = NativeBridgeLatestFrame<Int>()
        val start = CountDownLatch(1)
        val producers = (0 until 4).map { producerId ->
            Thread {
                start.await()
                repeat(500) { sequence -> mailbox.offer(producerId * 1_000 + sequence) }
            }.also(Thread::start)
        }
        start.countDown()
        producers.forEach { it.join(2_000); assertFalse(it.isAlive) }

        mailbox.offer(Int.MIN_VALUE)
        assertTrue(mailbox.hasPending())
        assertEquals(Int.MIN_VALUE, mailbox.takeLatest())
        assertFalse(mailbox.hasPending())
        assertNull(mailbox.takeLatest())
    }
}
