package com.shantu.nativeapp.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class NativeRouteStopOrderTest {
    @Test fun movesOnlyAdjacentStopsAndKeepsOtherOrder() {
        assertEquals(listOf("b", "a", "c"), NativeRouteStopOrder.move(listOf("a", "b", "c"), 0, 1))
        assertEquals(listOf("a", "c", "b"), NativeRouteStopOrder.move(listOf("a", "b", "c"), 1, 1))
        assertEquals(listOf("a", "b", "c"), NativeRouteStopOrder.move(listOf("a", "b", "c"), 0, -1))
        assertEquals(listOf("a", "b", "c"), NativeRouteStopOrder.move(listOf("a", "b", "c"), 9, 1))
    }

    @Test fun rejectsNonAdjacentMoveRequests() {
        assertThrows(IllegalArgumentException::class.java) {
            NativeRouteStopOrder.move(listOf(1, 2), 0, 2)
        }
    }
}
