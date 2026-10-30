package com.shantu.nativeapp.map

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeTileStageTelemetryTest {
    @Test fun `decode timing is aggregated into fixed buckets without tile identities`() {
        val before = NativeTileStageTelemetry.snapshot()
        NativeTileStageTelemetry.recordDecode(4_000_000)
        NativeTileStageTelemetry.recordDecode(200_000_000, failed = true)
        val after = NativeTileStageTelemetry.snapshot()
        assertEquals(before.decodedImages + 2, after.decodedImages)
        assertEquals(before.decodeFailures + 1, after.decodeFailures)
        assertEquals(6, after.decodeDurationBuckets.size)
        assertTrue(after.decodeDurationBuckets.sum() >= before.decodeDurationBuckets.sum() + 2)
        assertNull("WorldWind exposes no per-tile drawn callback", after.perTileDrawCount)
    }

    @Test fun `frame completion is reported separately from per-tile drawing`() {
        val before = NativeTileStageTelemetry.snapshot()
        NativeTileStageTelemetry.recordRenderedFrame()
        NativeTileStageTelemetry.recordRenderedFrame()
        val after = NativeTileStageTelemetry.snapshot()
        assertEquals(before.renderedFrames + 2, after.renderedFrames)
        assertNull(after.perTileDrawCount)
    }
}
