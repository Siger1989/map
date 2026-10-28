package com.shantu.nativeapp.navigation

import android.os.CancellationSignal
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NativeRiverSnapServiceTest {
    @Test fun returnsActualWaterwayGeometryAndNeverSynthesizesConnectors() {
        var requested = ""
        val transport = NativeRiverTransport { url, _ ->
            requested = url
            """{"elements":[{"type":"way","tags":{"waterway":"river"},"geometry":[{"lon":104.0,"lat":30.0},{"lon":104.005,"lat":30.0},{"lon":104.01,"lat":30.0}]},{"type":"way","tags":{"waterway":"riverbank"},"geometry":[{"lon":104.0,"lat":30.0},{"lon":104.01,"lat":30.0}]}]}"""
        }
        val points = NativeRiverSnapService(transport).snap(NativeCoordinate(104.0, 30.0), NativeCoordinate(104.01, 30.0))
        assertTrue(requested.contains("interpreter?data="))
        assertEquals(listOf(NativeCoordinate(104.0, 30.0), NativeCoordinate(104.005, 30.0), NativeCoordinate(104.01, 30.0)), points)
    }

    @Test fun cancellationIsPassedThroughToRiverTransport() {
        val signal = CancellationSignal().apply { cancel() }
        var called = false
        val transport = NativeRiverTransport { _, _ -> called = true; "{\"elements\":[]}" }
        assertTrue(runCatching { NativeRiverSnapService(transport).snap(NativeCoordinate(104.0, 30.0), NativeCoordinate(104.01, 30.0), signal) }.isFailure)
        assertFalse(called)
    }
}
