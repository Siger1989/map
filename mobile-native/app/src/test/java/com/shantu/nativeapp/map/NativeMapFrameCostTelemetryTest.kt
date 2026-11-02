package com.shantu.nativeapp.map

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeMapFrameCostTelemetryTest {
    @Test fun `host command spans remain separate fixed counters`() {
        val telemetry = NativeMapFrameCostTelemetry()
        telemetry.recordHostCommand(NativeMapFrameCostTelemetry.HostCommand.CREATE, 12L)
        telemetry.recordHostCommand(NativeMapFrameCostTelemetry.HostCommand.CREATE, 19L)
        telemetry.recordHostCommand(NativeMapFrameCostTelemetry.HostCommand.MAP_VIEWPORT, 7L)
        telemetry.recordHostCommand(NativeMapFrameCostTelemetry.HostCommand.RENDER_STATE, -5L)

        assertEquals(mapOf(
            "createCount" to 2L, "createTotalNanos" to 31L, "createMaxNanos" to 19L,
            "mapViewportCount" to 1L, "mapViewportTotalNanos" to 7L, "mapViewportMaxNanos" to 7L,
            "renderStateCount" to 1L, "renderStateTotalNanos" to 0L, "renderStateMaxNanos" to 0L,
        ), telemetry.hostCommandSnapshot())
    }

    @Test fun `frame wall timings and first actual draw are independent`() {
        val telemetry = NativeMapFrameCostTelemetry()
        assertNull(telemetry.frameSnapshot()["firstActualDrawAfterCreateNanos"])
        telemetry.recordSdkRenderPreparation(3_000_000L)
        telemetry.recordSdkRenderPreparation(8_000_000L)
        telemetry.recordSdkDrawSubmission(5_000_000L)
        telemetry.recordFirstActualDrawAfterCreate(42_000_000L)
        telemetry.recordFirstActualDrawAfterCreate(90_000_000L)

        val snapshot = telemetry.frameSnapshot()
        assertEquals(2L, snapshot["sdkRenderPreparationCount"])
        assertEquals(11_000_000L, snapshot["sdkRenderPreparationTotalNanos"])
        assertEquals(8_000_000L, snapshot["sdkRenderPreparationMaxNanos"])
        assertEquals(1L, snapshot["sdkDrawSubmissionCount"])
        assertEquals(5_000_000L, snapshot["sdkDrawSubmissionMaxNanos"])
        assertEquals(42_000_000L, snapshot["firstActualDrawAfterCreateNanos"])
    }

    @Test fun `concurrent frame timing updates retain all durations`() {
        val telemetry = NativeMapFrameCostTelemetry()
        val workers = List(4) {
            Thread { repeat(500) { telemetry.recordSdkDrawSubmission(2L) } }.apply { start() }
        }
        workers.forEach(Thread::join)

        val snapshot = telemetry.frameSnapshot()
        assertEquals(2_000L, snapshot["sdkDrawSubmissionCount"])
        assertEquals(4_000L, snapshot["sdkDrawSubmissionTotalNanos"])
        assertEquals(2L, snapshot["sdkDrawSubmissionMaxNanos"])
        assertTrue(snapshot["sdkRenderPreparationCount"] == 0L)
    }
}
