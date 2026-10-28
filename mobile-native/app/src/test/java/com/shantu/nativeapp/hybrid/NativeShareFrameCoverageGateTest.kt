package com.shantu.nativeapp.hybrid

import com.shantu.nativeapp.map.NativePrintRasterFrameSnapshot
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeShareFrameCoverageGateTest {
    @Test fun needsTwoDistinctCompleteFramesWithStableVisibleTiles() {
        val gate = NativeShareFrameCoverageGate()
        val first = NativePrintRasterFrameSnapshot(1, setOf("16/1/2", "16/1/3"), setOf("16/1/2", "16/1/3"), 16, 16)
        assertEquals(1, gate.observe(first, supplementalSignature = "roads/16/1/2"))
        assertFalse(gate.isReady())
        assertEquals(1, gate.observe(first, supplementalSignature = "roads/16/1/2")) // Re-reading a frame cannot satisfy the second-frame requirement.
        assertEquals(2, gate.observe(first.copy(sequence = 2), supplementalSignature = "roads/16/1/2"))
        assertTrue(gate.isReady())
    }

    @Test fun incompleteOrChangingCoverageResetsConvergence() {
        val gate = NativeShareFrameCoverageGate()
        val complete = NativePrintRasterFrameSnapshot(1, setOf("16/1/2"), setOf("16/1/2"), 16, 16)
        assertEquals(1, gate.observe(complete))
        val missing = complete.copy(sequence = 2, texturedLeafKeys = emptySet())
        assertEquals(0, gate.observe(missing))
        assertEquals(1, gate.observe(complete.copy(sequence = 3)))
        assertEquals(1, gate.observe(complete.copy(sequence = 4, visibleLeafKeys = setOf("16/1/2", "16/1/3"), texturedLeafKeys = setOf("16/1/2", "16/1/3"))))
        assertFalse(gate.isReady())
    }

    @Test fun changedVisibleVectorTileCountResetsFrameConvergence() {
        val gate = NativeShareFrameCoverageGate()
        val frame = NativePrintRasterFrameSnapshot(1, setOf("16/1/2"), setOf("16/1/2"), 16, 16)
        assertEquals(1, gate.observe(frame, supplementalSignature = "16/1/2"))
        assertEquals(1, gate.observe(frame.copy(sequence = 2), supplementalSignature = "16/1/2|16/1/3"))
        assertFalse(gate.isReady())
        assertEquals(2, gate.observe(frame.copy(sequence = 3), supplementalSignature = "16/1/2|16/1/3"))
        assertTrue(gate.isReady())
    }

    @Test fun skippedFrameCannotMasqueradeAsConsecutiveCoverage() {
        val gate = NativeShareFrameCoverageGate()
        val frame = NativePrintRasterFrameSnapshot(1, setOf("16/1/2"), setOf("16/1/2"), 16, 16)
        assertEquals(1, gate.observe(frame))
        assertEquals(1, gate.observe(frame.copy(sequence = 3)))
        assertFalse(gate.isReady())
        assertEquals(2, gate.observe(frame.copy(sequence = 4)))
        assertTrue(gate.isReady())
    }
}
