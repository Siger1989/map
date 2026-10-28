package com.shantu.nativeapp.navigation

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NativePlaceSearchTest {
    private fun response(pois: Any) = JSONObject().put("status", JSONObject().put("infocode", "1000"))
        .put("resultType", 1).put("pois", pois)
    private fun place(name: Any, lonlat: Any) = JSONObject().put("name", name).put("lonlat", lonlat)

    @Test fun pointResultsRetainSpecificAddressAndDeduplicate() {
        val poi = place("公园", "104.1,30.6").put("province", "四川省").put("city", "成都市")
            .put("address", "四川省 成都市 · 某街1号")
        val result = NativePlaceSearch.parse(response(JSONArray().put(poi).put(poi)))
        assertEquals(1, result.size)
        assertEquals("四川省 · 成都市 · 某街1号", result[0].detail)
        assertEquals(104.1, result[0].longitude, 0.000001)
    }
    @Test fun invalidTypesAndCoordinatesAreNotFabricatedPlaces() {
        val pois = JSONArray().put(place(12, "104,30")).put(place("bad", JSONObject.NULL))
            .put(place("bad", "NaN,30")).put(place("bad", "181,30")).put(place("", "104,30"))
            .put(place("valid", "104,30"))
        assertEquals(listOf("valid"), NativePlaceSearch.parse(response(pois)).map { it.name })
    }
    @Test fun administrativeSummaryNeverBecomesPrecisePin() {
        assertTrue(NativePlaceSearch.parse(response(JSONArray().put(place("city", "104,30"))).put("resultType", 3)).isEmpty())
    }
    @Test fun serviceFailureIsNotReportedAsEmptySuccess() {
        assertThrows(IllegalArgumentException::class.java) {
            NativePlaceSearch.parse(response(JSONArray()).put("status", JSONObject().put("infocode", 1003)))
        }
        assertThrows(IllegalArgumentException::class.java) { NativePlaceSearch.parse(response(JSONObject())) }
        assertTrue(NativePlaceSearch.parse(JSONObject().put("status", JSONArray().put(JSONObject().put("infocode", 3001)))).isEmpty())
    }
    @Test fun coordinateParsingUsesLongitudeFirstAndRejectsNonFinite() {
        assertEquals(104.0 to 30.0, NativePlaceSearch.coordinate(" 104，30 "))
        for (bad in listOf("", "104", "104,", ",30", "NaN,30", "104,Infinity", "104,90", "1,2,3"))
            assertNull(bad, NativePlaceSearch.coordinate(bad))
    }
    @Test fun resultsBoundedToTwentyDistinctPlaces() {
        val pois = JSONArray()
        for (i in 0..30) pois.put(place("地点$i", "104,30"))
        assertEquals(20, NativePlaceSearch.parse(response(pois)).size)
    }
}
