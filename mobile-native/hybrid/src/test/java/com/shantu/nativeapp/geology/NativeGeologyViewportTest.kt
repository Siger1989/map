package com.shantu.nativeapp.geology

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeGeologyViewportTest {
    @Test fun `world overview plan is one tile at broad zoom and bounded to nine nearby tiles`() {
        val broad = nativeGeologyViewportPlan(10_000_000.0, 45.0, 390, 857, 0.0, 0.0)
        assertEquals(0, broad.zoom)
        assertEquals(setOf("0/0/0"), broad.tileKeys)

        val close = nativeGeologyViewportPlan(100.0, 45.0, 390, 857, 35.0, 179.9)
        assertEquals(5, close.zoom)
        assertEquals(9, close.tileKeys.size)
        assertTrue("x wraps at the antimeridian", close.tileKeys.any { it.split('/')[1] == "0" })
        assertTrue(close.tileKeys.all { key ->
            val (z, x, y) = key.split('/').map(String::toInt)
            z == close.zoom && x in 0 until (1 shl z) && y in 0 until (1 shl z)
        })
    }

    @Test fun `invalid camera inputs produce finite bounded tile keys`() {
        val plan = nativeGeologyViewportPlan(Double.NaN, Double.POSITIVE_INFINITY, 0, 0, Double.NaN, Double.NaN)
        assertTrue(plan.zoom in 0..5)
        assertTrue(plan.tileKeys.isNotEmpty())
        assertTrue(plan.tileKeys.size <= 9)
    }
}
