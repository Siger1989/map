package com.shantu.nativeapp.map

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.yield
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class NativeContourPreparationPipelineTest {
    @Test fun `ready tile assembles while earlier load is suspended and CPU lane stays single`() = runBlocking {
        val preparations = NativeContourProcessBudget(capacity = 2)
        val assembly = NativeContourProcessBudget(capacity = 1)
        val pipeline = NativeContourPreparationPipeline(preparations, assembly)
        val firstLoadStarted = CompletableDeferred<Unit>()
        val releaseFirstLoad = CompletableDeferred<Unit>()
        val first = async {
            pipeline.prepare(
                loadSamples = { firstLoadStarted.complete(Unit); releaseFirstLoad.await(); "slow" },
                assemble = { "built-$it" },
            )
        }
        withTimeout(1_000) { firstLoadStarted.await() }

        val second = async {
            pipeline.prepare(loadSamples = { "ready" }, assemble = { "built-$it" })
        }
        assertEquals("built-ready", withTimeout(1_000) { second.await() })
        assertEquals(1, preparations.snapshot().activeSlots)
        assertEquals(0, assembly.snapshot().activeSlots)

        releaseFirstLoad.complete(Unit)
        assertEquals("built-slow", withTimeout(1_000) { first.await() })
        assertEquals(2, preparations.snapshot().maximumActiveSlots)
        assertEquals(1, assembly.snapshot().maximumActiveSlots)
        assertEquals(0, preparations.snapshot().activeSlots)
    }

    @Test fun `live samples are bounded to two while extra preparation waits`() = runBlocking {
        val preparations = NativeContourProcessBudget(capacity = 2)
        val pipeline = NativeContourPreparationPipeline(preparations, NativeContourProcessBudget(1))
        val loaded = (0..2).map { CompletableDeferred<Unit>() }
        val release = CompletableDeferred<Unit>()
        val tasks = loaded.mapIndexed { index, gate ->
            async {
                pipeline.prepare(
                    loadSamples = { gate.complete(Unit); release.await(); index },
                    assemble = { it },
                )
            }
        }
        withTimeout(1_000) { loaded[0].await(); loaded[1].await() }
        yield()
        assertEquals(2, preparations.snapshot().activeSlots)
        assertEquals(2, preparations.snapshot().maximumActiveSlots)
        assertEquals(1, preparations.snapshot().queuedRequests)

        release.complete(Unit)
        assertEquals(listOf(0, 1, 2), tasks.map { withTimeout(1_000) { it.await() } })
        assertTrue(preparations.snapshot().maximumActiveSlots <= 2)
        assertEquals(0, preparations.snapshot().activeSlots)
    }

    @Test fun `null load and thrown load release preparation permit`() = runBlocking {
        val preparations = NativeContourProcessBudget(capacity = 2)
        val pipeline = NativeContourPreparationPipeline(preparations, NativeContourProcessBudget(1))

        assertNull(pipeline.prepare<Int, String>(loadSamples = { null }, assemble = { it.toString() }))
        assertEquals(0, preparations.snapshot().activeSlots)
        assertEquals(1L, pipeline.snapshot().sourceNoDataCount)
        assertEquals(1L, pipeline.snapshot().sourceLoadCount)
        var propagated = false
        try {
            pipeline.prepare<Int, String>(loadSamples = { error("sample failure") }, assemble = { it.toString() })
        } catch (expected: IllegalStateException) {
            propagated = true
            assertEquals("sample failure", expected.message)
            assertEquals(1L, pipeline.snapshot().sourceFailureCount)
        }
        if (!propagated) fail("sample exception must propagate")
        assertEquals(0, preparations.snapshot().activeSlots)
        assertEquals(0, preparations.snapshot().queuedRequests)
    }

    @Test fun `null assembly result releases both preparation and CPU permits`() = runBlocking {
        val preparations = NativeContourProcessBudget(capacity = 2)
        val assembly = NativeContourProcessBudget(1)
        val pipeline = NativeContourPreparationPipeline(preparations, assembly)

        assertNull(pipeline.prepare<Int, String>(loadSamples = { 7 }, assemble = { null }))
        assertEquals(0, preparations.snapshot().activeSlots)
        assertEquals(0, assembly.snapshot().activeSlots)
        assertEquals(0, preparations.snapshot().queuedRequests)
        assertEquals(0, assembly.snapshot().queuedRequests)
        assertEquals(1L, pipeline.snapshot().assemblyCount)
    }

    @Test fun `CPU lane serializes active assembly and cancelling its waiter releases preparation`() = runBlocking {
        val preparations = NativeContourProcessBudget(capacity = 2)
        val assembly = NativeContourProcessBudget(1)
        val pipeline = NativeContourPreparationPipeline(preparations, assembly)
        val buildStarted = CompletableDeferred<Unit>()
        val releaseBuild = CompletableDeferred<Unit>()
        val first = async {
            pipeline.prepare(
                loadSamples = { 1 },
                assemble = { buildStarted.complete(Unit); releaseBuild.await(); it },
            )
        }
        withTimeout(1_000) { buildStarted.await() }
        val waiting = async {
            pipeline.prepare(loadSamples = { 2 }, assemble = { it })
        }
        withTimeout(1_000) { while (assembly.snapshot().queuedRequests != 1) yield() }
        assertEquals(1, assembly.snapshot().activeSlots)
        assertEquals(1, assembly.snapshot().maximumActiveSlots)
        assertEquals(2, preparations.snapshot().activeSlots)
        assertEquals(0, preparations.snapshot().queuedRequests)

        waiting.cancelAndJoin()
        assertEquals(1, assembly.snapshot().activeSlots)
        assertEquals(0, assembly.snapshot().queuedRequests)
        assertEquals(1, preparations.snapshot().activeSlots)
        releaseBuild.complete(Unit)
        assertEquals(1, withTimeout(1_000) { first.await() })
        assertEquals(0, preparations.snapshot().activeSlots)
        assertEquals(0, assembly.snapshot().activeSlots)
        assertEquals(1, assembly.snapshot().maximumActiveSlots)
    }

    @Test fun `assembly exception propagates and releases both permits`() = runBlocking {
        val preparations = NativeContourProcessBudget(capacity = 2)
        val assembly = NativeContourProcessBudget(1)
        val pipeline = NativeContourPreparationPipeline(preparations, assembly)
        var propagated = false
        try {
            pipeline.prepare<Int, String>(loadSamples = { 9 }, assemble = { error("assembly failure") })
        } catch (expected: IllegalStateException) {
            propagated = true
            assertEquals("assembly failure", expected.message)
            assertEquals(1L, pipeline.snapshot().assemblyFailureCount)
        }
        if (!propagated) fail("assembly exception must propagate")
        assertEquals(0, preparations.snapshot().activeSlots)
        assertEquals(0, preparations.snapshot().queuedRequests)
        assertEquals(0, assembly.snapshot().activeSlots)
        assertEquals(0, assembly.snapshot().queuedRequests)
    }

    @Test fun `cancellation during load or assembly releases both permits`() = runBlocking {
        val preparations = NativeContourProcessBudget(capacity = 2)
        val assembly = NativeContourProcessBudget(1)
        val pipeline = NativeContourPreparationPipeline(preparations, assembly)
        val loadStarted = CompletableDeferred<Unit>()
        val waitingOnLoad = async {
            pipeline.prepare<Int, String>(
                loadSamples = { loadStarted.complete(Unit); awaitCancellation() },
                assemble = { it.toString() },
            )
        }
        withTimeout(1_000) { loadStarted.await() }
        waitingOnLoad.cancelAndJoin()
        assertEquals(0, preparations.snapshot().activeSlots)
        assertEquals(1L, pipeline.snapshot().cancellationCount)

        val buildStarted = CompletableDeferred<Unit>()
        val waitingOnBuild = async {
            pipeline.prepare(
                loadSamples = { 1 },
                assemble = { buildStarted.complete(Unit); awaitCancellation() },
            )
        }
        withTimeout(1_000) { buildStarted.await() }
        waitingOnBuild.cancelAndJoin()
        assertEquals(0, preparations.snapshot().activeSlots)
        assertEquals(0, assembly.snapshot().activeSlots)
        assertEquals(0, preparations.snapshot().queuedRequests)
        assertEquals(0, assembly.snapshot().queuedRequests)
        assertEquals(2L, pipeline.snapshot().cancellationCount)
    }
}
