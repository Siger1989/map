package com.shantu.nativeapp.hybrid

import org.junit.Assert.*
import org.junit.Test

class NativeReactGlassPolicyTest {
    @Test fun captureKeepsAspectAndNeverAllocatesAFullPhoneFrame() {
        assertEquals(175 to 384, NativeReactGlassPolicy.captureSize(1256, 2760))
        assertEquals(384 to 192, NativeReactGlassPolicy.captureSize(3000, 1500))
        assertEquals(100 to 200, NativeReactGlassPolicy.captureSize(100, 200))
        assertNull(NativeReactGlassPolicy.captureSize(0, 200))
        assertEquals(384 to 384, NativeReactGlassPolicy.captureSize(Int.MAX_VALUE, Int.MAX_VALUE))
        assertEquals(384 to 1, NativeReactGlassPolicy.captureSize(Int.MAX_VALUE, 1))
        assertNull(NativeReactGlassPolicy.captureSize(-1, Int.MAX_VALUE))
    }

    @Test fun cssBlurMapsToTheSamePixelRadiusAtDifferentDeviceDensities() {
        assertEquals(4, NativeReactGlassPolicy.bitmapRadius(10f, 1f, 175, 390))
        assertEquals(4, NativeReactGlassPolicy.bitmapRadius(10f, 3f, 175, 1170))
        assertEquals(0, NativeReactGlassPolicy.bitmapRadius(Float.NaN, 3f, 175, 1170))
    }

    @Test fun blurPreservesUniformMapColorAndDoesNotMutateTheCapture() {
        val pixels = IntArray(35) { 0xff91ac47.toInt() }
        assertArrayEquals(pixels, NativeReactGlassPolicy.blur(pixels, 7, 5, 3))
        assertArrayEquals(IntArray(35) { 0xff91ac47.toInt() }, pixels)
        val transparent = IntArray(35)
        assertArrayEquals(transparent, NativeReactGlassPolicy.blur(transparent, 7, 5, 3))
    }

    @Test fun blurSoftensARealMapEdgeWithoutBlackeningItsConstantAlpha() {
        val pixels = IntArray(81) { index -> if (index % 9 < 4) 0xffffffff.toInt() else 0xff000000.toInt() }
        val blurred = NativeReactGlassPolicy.blur(pixels, 9, 9, 1)
        assertTrue(blurred.all { it ushr 24 == 255 })
        val left = blurred[4 * 9 + 3] and 255
        val right = blurred[4 * 9 + 4] and 255
        assertTrue(left in 1..254 && right in 1..254 && left > right)
        assertEquals(0xffffffff.toInt(), pixels[0])
    }

    @Test fun transparentPixelsDoNotIntroduceBlackColorFringes() {
        val pixels = intArrayOf(0xffff0000.toInt(), 0xffff0000.toInt(), 0, 0, 0)
        val blurred = NativeReactGlassPolicy.blur(pixels, 5, 1, 1)
        assertTrue(blurred.any { it ushr 24 in 1..254 })
        assertTrue(blurred.filter { it ushr 24 > 0 }.all { ((it ushr 16) and 255) == 255 && (it and 65535) == 0 })
    }

    @Test fun lifecycleBoundsOnePendingCaptureAndRejectsLatePages() {
        val gate = NativeGlassCaptureGate()
        assertNull(gate.begin(true))
        gate.foreground(true)
        assertNull(gate.begin(false))
        val first = gate.begin(true)!!
        assertTrue(gate.accepts(first)); assertNull(gate.begin(true))
        gate.foreground(false)
        assertFalse(gate.accepts(first)); gate.finish()
        assertNull(gate.begin(true))
        gate.foreground(true)
        val next = gate.begin(true)!!
        gate.invalidate()
        assertFalse(gate.accepts(next)); gate.finish()
        val last = gate.begin(true)!!
        gate.close(); gate.finish()
        assertFalse(gate.accepts(last)); assertNull(gate.begin(true))
    }

    @Test fun staticFramesReuseGlassButDrawsBlurChangesAndResizesInvalidateIt() {
        val captured = NativeGlassFrameKey(12L, 1256, 2760, listOf(4))
        assertFalse(captured.copy().needsCapture(captured))
        assertTrue(captured.copy(sequence = 13L).needsCapture(captured)) // Includes tile-only draws.
        assertTrue(captured.copy(width = 1260).needsCapture(captured))
        assertTrue(captured.copy(height = 2700).needsCapture(captured))
        assertTrue(captured.copy(radii = listOf(4, 8)).needsCapture(captured))
        assertTrue(captured.needsCapture(null)) // Resume, page replacement and new SurfaceView clear the cache.
        assertTrue(captured.copy(sequence = null).needsCapture(captured.copy(sequence = null)))
    }

    @Test fun copyInFlightCannotAcknowledgeAnUncapturedLaterFrameOrTheOtherMap() {
        val request = NativeGlassFrameKey(100L, 1256, 1380, listOf(4))
        // PixelCopy/blur finishes after GL drew 101. Store the request key, not the late GL value.
        val published = request
        assertTrue(request.copy(sequence = 101L).needsCapture(published))
        val secondMap = NativeGlassFrameKey(7L, 1256, 1380, listOf(4))
        assertFalse(secondMap.copy().needsCapture(secondMap))
        assertTrue(request.copy(sequence = 101L).needsCapture(published))
    }

    @Test fun boundedDesktopBlurTimingEvidenceIsNotADevicePerformanceGate() {
        val width = 175; val height = 384
        val pixels = IntArray(width * height) { index -> 0xff000000.toInt() or ((index * 71) and 0x00ffffff) }
        repeat(3) { NativeReactGlassPolicy.blur(pixels, width, height, 4) }
        for (variants in listOf(1, 8)) {
            val start = System.nanoTime()
            repeat(variants) { radius -> NativeReactGlassPolicy.blur(pixels, width, height, radius + 1) }
            println("GLASS_DESKTOP_BLUR size=${width}x${height} variants=$variants elapsedMs=${(System.nanoTime() - start) / 1_000_000.0}")
        }
    }
}
