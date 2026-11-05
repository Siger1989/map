package com.shantu.nativeapp.map

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeRasterFeatherPolicyTest {
    private val p = NativeRasterFeatherPolicy
    private fun key(z: Int, r: Int, c: Int) = p.key(z, r, c)

    @Test fun `equal-resolution neighbors retain an opaque interior without a tile grid`() {
        val leaves = mapOf(key(5, 10, 9) to 5, key(5, 9, 10) to 5,
            key(5, 10, 11) to 5, key(5, 11, 10) to 5)
        assertEquals(0, p.lodEdges(5, 10, 10, 5, true, leaves))
    }

    @Test fun `only the known fine to coarse side receives a feather band`() {
        val leaves = mapOf(key(5, 10, 9) to 3, key(5, 9, 10) to 5,
            key(5, 10, 11) to 5, key(5, 11, 10) to 5)
        assertEquals(p.WEST, p.lodEdges(5, 10, 10, 5, true, leaves))
    }

    @Test fun `a larger neighboring leaf can back a smaller adjacent child`() {
        assertEquals(p.EAST, p.lodEdges(5, 10, 11, 5, true, mapOf(key(4, 5, 6) to 4)))
    }

    @Test fun `unknown finer and offscreen coverage does not lower opacity`() {
        assertEquals(0, p.lodEdges(5, 10, 10, 5, true, emptyMap()))
        assertEquals(0, p.lodEdges(5, 10, 10, 5, true, mapOf(key(6, 20, 22) to 6)))
        assertEquals(0, p.lodEdges(5, 0, 10, 5, true, emptyMap()))
    }

    @Test fun `missing parent backing never exposes an empty background`() {
        assertEquals(0, p.lodEdges(5, 10, 10, 5, false, mapOf(key(5, 10, 9) to 3)))
    }

    @Test fun `finer desired neighbors with uniformly coarse fallback still form a coarse boundary`() {
        val coarse = mapOf(key(6,20,22) to 3, key(6,21,22) to 4)
        assertEquals(p.EAST, p.lodEdges(5,10,10,5,true,coarse))
        // A half-edge with real same-level data must not be blurred by a full-edge flag.
        assertEquals(0, p.lodEdges(5,10,10,5,true,coarse + (key(6,21,22) to 5)))
    }

    @Test fun `RGBA interpolation retains transparent child pixels and applies opacity once`() {
        val parent = doubleArrayOf(.4, .0, .0, .8)
        val child = doubleArrayOf(.0, .1, .0, .2)
        fun mix(t: Double) = DoubleArray(4) { parent[it]*(1-t) + child[it]*t }
        assertEquals(parent.toList(), mix(0.0).toList())
        assertEquals(child.toList(), mix(1.0).toList())
        assertEquals(.5, mix(.5)[3], 1e-10)
        assertEquals(.25, mix(.5)[3] * .5, 1e-10)
    }

    @Test fun `numeric diagnostics distinguish queued work from actual pair submissions`() {
        val d = NativeRasterFeatherDiagnostics()
        val frame = d.beginFrame()
        d.recordLeaves(12, 3, 2, 1); d.queuedPair(); d.queuedPair()
        var snapshot = d.snapshotCounters()
        assertEquals(2L, snapshot["queuedPairs"])
        assertEquals(0L, snapshot["totalDrawnPairs"])
        d.submitted(frame, true); d.submitted(frame, true)
        snapshot = d.snapshotCounters()
        assertEquals(1L, snapshot["drawnFrames"])
        assertEquals(2L, snapshot["drawnPairs"])
        assertEquals(1L, snapshot["missingParentChildren"])
    }

    @Test fun `source clear releases current counters but retains cumulative proof`() {
        val d = NativeRasterFeatherDiagnostics()
        val first = d.beginFrame(); d.queuedPair(); d.submitted(first, true)
        d.clearCurrent()
        assertEquals(0L, d.snapshotCounters()["queuedPairs"])
        assertEquals(1L, d.snapshotCounters()["totalDrawnPairs"])
        val second = d.beginFrame(); d.submitted(second, false)
        assertEquals(2L, d.snapshotCounters()["drawnFrames"])
        assertEquals(0L, d.snapshotCounters()["drawnPairs"])
    }

    @Test fun `longitude wrapping identifies an actual coarser neighbor`() {
        assertEquals(p.WEST, p.lodEdges(5, 10, 0, 5, true, mapOf(key(5, 10, 31) to 4)))
        assertEquals(p.EAST, p.lodEdges(5, 10, 31, 5, true, mapOf(key(5, 10, 0) to 4)))
    }

    @Test fun `coarse cells next to finer imagery remain fully opaque`() {
        assertEquals(0, p.lodEdges(5, 10, 10, 3, true, mapOf(key(5, 10, 9) to 5)))
    }

    @Test fun `fixed detail only softens its resident coverage frontier`() {
        assertEquals(0, p.fixedEdges(true, true, true, true))
        assertEquals(p.ALL, p.fixedEdges(false, false, false, false))
        assertEquals(p.SOUTH or p.NORTH, p.fixedEdges(true, false, true, false))
    }

    @Test fun `tile addresses remain distinct at all supported source levels`() {
        val keys = mutableSetOf<Long>()
        for (z in 0..24) {
            val n = 1 shl z
            for ((r, c) in setOf(0 to 0, (n-1) to 0, 0 to (n-1), (n-1) to (n-1)))
                assertTrue(keys.add(key(z, r, c)))
        }
    }

    @Test fun `feather is bounded and does not darken a premultiplied composite`() {
        assertEquals(1.0, p.fade(0.0, 0.0), 0.0)
        assertEquals(0.0, p.fade(-1.0, 8.0), 0.0)
        assertEquals(0.0, p.fade(0.0, 8.0), 0.0)
        assertEquals(0.5, p.fade(4.0, 8.0), 0.0)
        assertEquals(1.0, p.fade(8.0, 8.0), 0.0)
        assertEquals(1.0, p.fade(100.0, 8.0), 0.0)
        val a = p.fade(4.0, 8.0)
        val red = a // child's premultiplied red
        val blue = 1.0 * (1.0 - a) // opaque blue ancestor
        assertEquals(1.0, red + blue, 0.0)
    }

    private class Shader : NativeRasterFeatherProgram() { fun fragment() = programSources[1] }

    @Test fun `shader masks premultiplied RGBA while preserving original pick sampling`() {
        val fragment = Shader().fragment()
        for (k in 0..3) assertTrue(fragment.contains(
            "src$k = mix(nativeParent, src$k, nativeRasterFeather("))
        assertTrue(fragment.contains("floor(texture2D(texSampler0, uv).a + 0.5)"))
        assertTrue(fragment.contains("fwidth(p) * 6.0"))
        assertFalse(fragment.contains("gl_FragColor.a *= nativeRasterFeather"))
    }
}
