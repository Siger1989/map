package com.shantu.nativeapp.map

import org.junit.Assert.*
import org.junit.Test

class NativePlaceLabelPolicyTest {
    @Test fun `near band leaves every existing label tier to SDK eligibility`() {
        for (minimum in listOf(3, 4, 7, 9, 11, 12, 99)) {
            assertTrue(NativePlaceLabelPolicy.keep(minimum, 3.0, 1.0, false))
            assertTrue(NativePlaceLabelPolicy.keep(minimum, 18.0, 1.5, false))
        }
    }

    @Test fun `small far names leave while useful larger settlements remain`() {
        assertFalse(NativePlaceLabelPolicy.keep(12, 19.0, 3.0, false))
        assertTrue(NativePlaceLabelPolicy.keep(9, 19.0, 3.0, false))
        assertTrue(NativePlaceLabelPolicy.keep(7, 19.0, 5.0, false))
        assertFalse(NativePlaceLabelPolicy.keep(7, 19.0, 7.0, false))
        assertTrue(NativePlaceLabelPolicy.keep(4, 19.0, 7.0, false))
        assertFalse(NativePlaceLabelPolicy.keep(4, 19.0, 13.0, false))
    }

    @Test fun `same distance becomes eligible with local zoom rather than global camera zoom`() {
        assertFalse(NativePlaceLabelPolicy.keep(9, 13.5, 2.0, false))
        assertTrue(NativePlaceLabelPolicy.keep(9, 15.0, 2.0, false))
        assertFalse(NativePlaceLabelPolicy.keep(7, 7.5, 3.0, false))
        assertTrue(NativePlaceLabelPolicy.keep(7, 10.0, 3.0, false))
    }

    @Test fun `boundary hysteresis holds a survivor briefly without keeping it forever`() {
        assertFalse(NativePlaceLabelPolicy.keep(12, 20.0, 2.6, false))
        assertTrue(NativePlaceLabelPolicy.keep(12, 20.0, 2.6, true))
        assertFalse(NativePlaceLabelPolicy.keep(12, 20.0, 2.8, true))
        assertFalse(NativePlaceLabelPolicy.keep(7, 7.7, 2.0, false))
        assertTrue(NativePlaceLabelPolicy.keep(7, 7.7, 2.0, true))
    }

    @Test fun `missing frame measurements preserve SDK handling`() {
        assertTrue(NativePlaceLabelPolicy.keep(12, 18.0, Double.NaN, false))
        assertTrue(NativePlaceLabelPolicy.keep(12, Double.NaN, 3.0, false))
        assertTrue(NativePlaceLabelPolicy.keep(12, 18.0, 0.0, false))
    }

    @Test fun `population and place hierarchy retain near field tiers`() {
        for ((kind, expected) in mapOf("country" to 4, "capital" to 4, "state_capital" to 6, "city" to 7, "town" to 9,
            "village" to 11, "suburb" to 11, "neighbourhood" to 12, "hamlet" to 12)) {
            assertEquals(kind, expected, NativePlaceLabelPolicy.minimumZoom(mapOf("class" to kind)))
        }
        assertEquals(3, NativePlaceLabelPolicy.minimumZoom(mapOf("class" to "city", "population" to 6_000_000)))
        assertEquals(4, NativePlaceLabelPolicy.minimumZoom(mapOf("kind" to "capital", "admin_level" to 4)))
        assertEquals(99, NativePlaceLabelPolicy.minimumZoom(mapOf("class" to "state", "admin_level" to 4)))
        assertEquals(8, NativePlaceLabelPolicy.minimumZoom(mapOf("rank" to 9)))
    }

    @Test fun `collision hierarchy and large populations cannot overflow`() {
        assertTrue(NativePlaceLabelPolicy.priority(mapOf("class" to "city")) > NativePlaceLabelPolicy.priority(mapOf("class" to "village")))
        assertTrue(NativePlaceLabelPolicy.priority(mapOf("rank" to 1)) > NativePlaceLabelPolicy.priority(mapOf("rank" to 5)))
        assertEquals(Int.MAX_VALUE, NativePlaceLabelPolicy.priority(mapOf("population" to Long.MAX_VALUE - 1_000_000)))
    }

    @Test fun `placeholder population tags preserve SDK near field behavior`() {
        for (population in listOf(0.0, -1.0, Double.NaN)) {
            assertEquals(12, NativePlaceLabelPolicy.minimumZoom(mapOf("class" to "city", "population" to population)))
        }
        assertEquals(3, NativePlaceLabelPolicy.minimumZoom(mapOf("population" to Double.POSITIVE_INFINITY)))
        assertEquals(14, NativePlaceLabelPolicy.minimumZoom(mapOf("housenumber" to "5", "class" to "city")))
    }

    @Test fun `moving away never reintroduces a name at fixed local detail`() {
        for (minimum in listOf(3, 4, 7, 9, 11, 12)) for (zoom in listOf(8.0, 12.0, 16.0, 20.0)) {
            var hidden = false
            for (step in 10..140) {
                val keep = NativePlaceLabelPolicy.keep(minimum, zoom, step / 10.0, false)
                if (hidden) assertFalse("min=$minimum zoom=$zoom distance=${step / 10.0}", keep)
                if (!keep) hidden = true
            }
        }
    }
}
