package com.shantu.nativeapp.map

import earth.worldwind.render.image.ImageSource
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NativePrintRasterFrameCoverageTest {
    @Test fun drawTimeTextureAvailabilityCannotUpgradeARenderTimeAncestorFallback() {
        val coverage = NativePrintRasterFrameCoverage()
        val source = ImageSource.fromUrlString("https://example.test/leaf.png")
        coverage.beginFrame()
        coverage.recordVisibleLeaf(16, 10, 11, hasOwnTexture = false, imageSource = source)
        val candidate = coverage.freezeFrame()

        val drawn = coverage.publishDrawnFrame(candidate, isTextureAvailable = { true })
        assertEquals(setOf("16/10/11"), drawn.visibleLeafKeys)
        assertTrue(drawn.texturedLeafKeys.isEmpty())
        assertFalse(drawn.complete)
    }

    @Test fun drawTimeCacheEvictionCanDowngradeARenderTimeLeafHit() {
        val coverage = NativePrintRasterFrameCoverage()
        val source = ImageSource.fromUrlString("https://example.test/leaf.png")
        coverage.beginFrame()
        coverage.recordVisibleLeaf(16, 10, 11, hasOwnTexture = true, imageSource = source)
        val candidate = coverage.freezeFrame()

        val drawn = coverage.publishDrawnFrame(candidate, isTextureAvailable = { false })
        assertTrue(drawn.texturedLeafKeys.isEmpty())
        assertEquals(1, drawn.missingLeafCount)
        assertFalse(drawn.complete)
    }

    @Test fun interleavedPreparedFramesPublishTheCoverageOfTheFrameActuallyDrawn() {
        val coverage = NativePrintRasterFrameCoverage()
        coverage.beginFrame()
        coverage.recordVisibleLeaf(16, 10, 11, hasOwnTexture = true) // Frame A
        val frameA = coverage.freezeFrame()

        coverage.beginFrame()
        coverage.recordVisibleLeaf(17, 20, 21, hasOwnTexture = false) // Frame B is prepared before A draws.
        val frameB = coverage.freezeFrame()

        val drawnA = coverage.publishDrawnFrame(frameA)
        assertEquals(1, drawnA.sequence)
        assertEquals(setOf("16/10/11"), coverage.snapshot().visibleLeafKeys)
        assertEquals(setOf("16/10/11"), coverage.snapshot().texturedLeafKeys)
        assertEquals(drawnA, coverage.publishDrawnFrame(frameA)) // A repeated GL draw is not a new prepared frame.
        assertEquals(1, coverage.snapshot().sequence)

        val drawnB = coverage.publishDrawnFrame(frameB)
        assertEquals(2, drawnB.sequence)
        assertEquals(setOf("17/20/21"), coverage.snapshot().visibleLeafKeys)
        assertTrue(coverage.snapshot().texturedLeafKeys.isEmpty())
    }

    @Test fun ancestorFallbackCannotSatisfyVisibleLeafCoverage() {
        val coverage = NativePrintRasterFrameCoverage()
        coverage.beginFrame()
        coverage.recordVisibleLeaf(16, 24, 33, hasOwnTexture = true)
        coverage.recordVisibleLeaf(16, 24, 34, hasOwnTexture = false)
        val first = coverage.endFrame()
        assertEquals(1, first.sequence.toInt())
        assertEquals(2, first.visibleLeafCount)
        assertEquals(1, first.texturedLeafCount)
        assertEquals(1, first.missingLeafCount)
        assertEquals(mapOf(16 to 2), first.visibleLeafLevels)
        assertEquals(mapOf(16 to 1), first.texturedLeafLevels)
        assertFalse(first.complete)

        coverage.beginFrame()
        coverage.recordVisibleLeaf(16, 24, 33, hasOwnTexture = true)
        coverage.recordVisibleLeaf(16, 24, 34, hasOwnTexture = true)
        val second = coverage.endFrame()
        assertEquals(2, second.sequence.toInt())
        assertTrue(second.complete)
        assertEquals(first.visibleLeafKeys, second.visibleLeafKeys)
        assertEquals(second.visibleMaxLevel, second.texturedMaxLevel)
    }

    @Test fun frameSnapshotDoesNotCarryLeavesFromPreviousFrame() {
        val coverage = NativePrintRasterFrameCoverage()
        coverage.beginFrame()
        coverage.recordVisibleLeaf(15, 10, 11, hasOwnTexture = true)
        coverage.endFrame()
        coverage.beginFrame()
        coverage.recordVisibleLeaf(16, 20, 22, hasOwnTexture = true)
        val next = coverage.endFrame()
        assertEquals(setOf("16/20/22"), next.visibleLeafKeys)
        assertEquals(next.visibleLeafKeys, next.texturedLeafKeys)
    }
}
