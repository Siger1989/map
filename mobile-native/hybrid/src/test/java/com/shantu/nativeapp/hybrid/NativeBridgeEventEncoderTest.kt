package com.shantu.nativeapp.hybrid

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.concurrent.Executor

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], manifest = Config.NONE)
class NativeBridgeEventEncoderTest {
    @Test fun queuedPayloadsAreLatestWinsPerChannelAndCallbacksKeepTokens() {
        val executor = ManualExecutor()
        val results = mutableListOf<Triple<String, Long, String>>()
        val encoder = NativeBridgeEventEncoder({ channel, token, encoded -> results += Triple(channel, token, encoded) }, executor)

        assertTrue(encoder.submit("snap", 1L, JSONObject().put("v", 1)))
        assertTrue(encoder.submit("snap", 2L, JSONObject().put("v", 2)))
        assertEquals(1, executor.size)
        executor.runNext()

        assertEquals(listOf(Triple("snap", 2L, "{\"v\":2}")), results)
        encoder.close()
    }

    @Test fun supersededRunningResultIsDroppedAndNewestPendingResultFollows() {
        val executor = ManualExecutor()
        val results = mutableListOf<Pair<Long, String>>()
        lateinit var encoder: NativeBridgeEventEncoder
        encoder = NativeBridgeEventEncoder({ _, token, encoded -> results += token to encoded }, executor)
        val superseded = object : JSONObject() {
            override fun toString(): String {
                encoder.submit("snap", 2L, JSONObject().put("v", 2))
                return "{\"v\":1}"
            }
        }
        encoder.submit("snap", 1L, superseded)

        executor.runNext()
        assertTrue(results.isEmpty())
        assertEquals(1, executor.size)
        executor.runNext()
        assertEquals(listOf(2L to "{\"v\":2}"), results)
        encoder.close()
    }

    @Test fun channelsDoNotOverwriteEachOthersPendingPayloads() {
        val executor = ManualExecutor()
        val results = mutableListOf<Pair<String, String>>()
        val encoder = NativeBridgeEventEncoder({ channel, _, encoded -> results += channel to encoded }, executor)

        encoder.submit("camera", 10L, JSONObject().put("map", "main"))
        encoder.submit("dem", 20L, JSONObject().put("revision", 7))
        encoder.submit("camera", 11L, JSONObject().put("map", "compare"))
        assertEquals(2, executor.size)
        executor.runNext()
        executor.runNext()

        assertEquals(listOf("camera" to "{\"map\":\"compare\"}", "dem" to "{\"revision\":7}"), results)
        encoder.close()
    }

    @Test fun closeDropsQueuedWorkAndDoesNotShutDownInjectedExecutor() {
        val executor = ManualExecutor()
        val results = mutableListOf<String>()
        val encoder = NativeBridgeEventEncoder({ _, _, encoded -> results += encoded }, executor)
        encoder.submit("snap", 1L, JSONObject().put("v", 1))
        encoder.close()
        assertFalse(encoder.submit("snap", 2L, JSONObject().put("v", 2)))

        executor.runNext()
        assertTrue(results.isEmpty())
        assertEquals(0, executor.size)
    }

    @Test fun closeDuringEncodingSuppressesTheRunningResult() {
        val executor = ManualExecutor()
        val results = mutableListOf<String>()
        lateinit var encoder: NativeBridgeEventEncoder
        encoder = NativeBridgeEventEncoder({ _, _, encoded -> results += encoded }, executor)
        val closesDuringEncoding = object : JSONObject() {
            override fun toString(): String {
                encoder.close()
                return "{\"v\":1}"
            }
        }
        encoder.submit("snap", 1L, closesDuringEncoding)

        executor.runNext()

        assertTrue(results.isEmpty())
        assertEquals(0, executor.size)
    }

    private class ManualExecutor : Executor {
        private val tasks = ArrayDeque<Runnable>()
        val size: Int get() = tasks.size
        override fun execute(command: Runnable) { tasks.addLast(command) }
        fun runNext() = tasks.removeFirst().run()
    }
}
