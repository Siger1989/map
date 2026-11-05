package com.shantu.nativeapp.map

import org.junit.Assert.*
import org.junit.Test

class NativeEditingWorldWindowControllerTest {
    @Test fun editorThresholdUsesPhysicalPixelsAtEachDensityWithoutRemovingMovementFiltering() {
        for (density in listOf(1f, 2f, 3f, 4f)) {
            assertEquals(4f * density, editingInterpretDistancePx(density, 8f * density), 0.001f)
            assertEquals(2f * density, editingInterpretDistancePx(density, density), 0.001f)
        }
    }

    @Test fun allRealPreRecognitionMovementIsAppliedOnceInsteadOfLosingTheSdkStartDistance() {
        val start = NativeEditorPanStart()
        start.down(100.0, 200.0)
        start.move(102.0, 204.0)
        start.move(106.0, 211.0)
        assertEquals(6.0 to 11.0, start.consume())
        start.move(110.0, 220.0)
        assertNull(start.consume())
    }

    @Test fun cancellationAndNewDownCannotReuseAnOldDisplacement() {
        val start = NativeEditorPanStart()
        start.down(0.0, 0.0)
        start.move(12.0, 15.0)
        start.reset()
        assertNull(start.consume())
        start.down(100.0, 100.0)
        start.move(101.0, 99.0)
        assertEquals(1.0 to -1.0, start.consume())
    }
}
