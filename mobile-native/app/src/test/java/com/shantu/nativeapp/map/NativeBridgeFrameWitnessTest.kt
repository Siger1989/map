package com.shantu.nativeapp.map

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NativeBridgeFrameWitnessTest {
    private data class Metadata(val camera: String, val viewport: String)

    @Test fun delayedDrawKeepsItsCapturedMetadataWhenANewerCaptureArrives() {
        val queue = NativeBridgeFrameWitnessQueue<NativeBridgeFrameWitness<Metadata>>()
        val draws = mutableListOf<Triple<Metadata, DoubleArray, Pair<Int, Int>>>()
        queue.offer { NativeBridgeFrameWitness(Metadata("camera-old", "viewport-old")) { metadata, matrix, width, height ->
            draws += Triple(metadata, matrix, width to height)
        } }

        // endRendering binds the old ticket to its draw queue before a newer main-thread capture.
        val boundToOldFrame = queue.take()!!
        queue.offer { NativeBridgeFrameWitness(Metadata("camera-new", "viewport-new")) { metadata, matrix, width, height ->
            draws += Triple(metadata, matrix, width to height)
        } }

        val oldMatrix = doubleArrayOf(1.0, 2.0)
        boundToOldFrame.draw(oldMatrix, 400, 800)
        queue.take()!!.draw(doubleArrayOf(3.0, 4.0), 600, 900)

        assertEquals("camera-old", draws[0].first.camera)
        assertEquals("viewport-old", draws[0].first.viewport)
        assertArrayEquals(oldMatrix, draws[0].second, 0.0)
        assertEquals(400 to 800, draws[0].third)
        assertEquals("camera-new", draws[1].first.camera)
        assertEquals("viewport-new", draws[1].first.viewport)
        assertEquals(600 to 900, draws[1].third)
    }

    @Test fun factoryReadsCameraAndViewportAtRenderContextPreparationTime() {
        val queue = NativeBridgeFrameWitnessQueue<NativeBridgeFrameWitness<Metadata>>()
        var camera = "before"
        var viewport = "small"
        queue.offer {
            val captured = Metadata(camera, viewport)
            NativeBridgeFrameWitness(captured) { _, _, _, _ -> }
        }

        // Camera and viewport may change after scheduling, before endRendering takes the factory.
        camera = "at-render-preparation"
        viewport = "resized"
        val witness = queue.take()!!
        assertEquals("at-render-preparation", witness.metadata.camera)
        assertEquals("resized", witness.metadata.viewport)
        assertNull(queue.take()) // One-shot factory.
    }
}
