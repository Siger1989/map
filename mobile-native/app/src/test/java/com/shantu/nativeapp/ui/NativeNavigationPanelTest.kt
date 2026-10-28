package com.shantu.nativeapp.ui

import com.shantu.nativeapp.map.NativeFix
import com.shantu.nativeapp.navigation.NativeCoordinate
import com.shantu.nativeapp.navigation.NativePlace
import com.shantu.nativeapp.navigation.NativePlannedRoute
import com.shantu.nativeapp.navigation.NativeRouteSegment
import com.shantu.nativeapp.navigation.NativeRouteStep
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NativeNavigationPanelTest {
    @Test
    fun connectionGuidanceUsesRoadGeometryAndDropsPlannerAccessConnectors() {
        val road = listOf(NativeCoordinate(104.0001, 30.0), NativeCoordinate(104.001, 30.0))
        val planned = NativePlannedRoute(
            mode = "pedestrian",
            coordinates = listOf(NativeCoordinate(104.0, 30.0), road.first(), road.last(), NativeCoordinate(104.0011, 30.0)),
            distance = 110.0,
            duration = 100.0,
            steps = listOf(
                NativeRouteStep("access", 0, "直线连接提示", 10.0, 8.0, 0.0, listOf(NativeCoordinate(104.0, 30.0), road.first())),
                NativeRouteStep("road", 0, "沿道路前行", 100.0, 90.0, 8.0, road),
                NativeRouteStep("access", 0, "直线终点提示", 10.0, 8.0, 98.0, listOf(road.last(), NativeCoordinate(104.0011, 30.0))),
            ),
            roadLegs = listOf(road),
            segments = listOf(NativeRouteSegment("access", listOf(NativeCoordinate(104.0, 30.0), road.first())), NativeRouteSegment("road", road)),
            accessDistance = 20.0,
            accessDuration = 16.0,
            snapped = road,
            stops = listOf(NativePlace("当前位置", 104.0, 30.0), NativePlace("目标", 104.0011, 30.0)),
            createdAt = 1L,
        )

        val json = NativeNavigationRoad.toGuidanceJson(
            planned,
            NativeFix(104.0, 30.0, 1000L, 5.0),
            104.0011 to 30.0,
        )
        val coords = json.getJSONArray("coordinates")
        assertEquals(road.size, coords.length())
        assertEquals(104.0001, coords.getJSONArray(0).getDouble(0), 1e-8)
        assertEquals(100.0, json.getDouble("distance"), 1e-8)
        assertEquals(1, json.getJSONArray("steps").length())
        assertEquals("road", json.getJSONArray("steps").getJSONObject(0).getString("kind"))
    }

    @Test
    fun connectionPlanFailsWhenTargetIsTooFarFromRoutedRoad() {
        val road = listOf(NativeCoordinate(104.0001, 30.0), NativeCoordinate(104.001, 30.0))
        val planned = NativePlannedRoute(
            "pedestrian", road, 100.0, 90.0,
            listOf(NativeRouteStep("road", 0, "沿道路前行", 100.0, 90.0, 0.0, road)),
            listOf(road), listOf(NativeRouteSegment("road", road)), 0.0, 0.0, road,
            listOf(NativePlace("当前位置", 104.0, 30.0), NativePlace("目标", 104.01, 30.0)), 1L,
        )

        val error = runCatching {
            NativeNavigationRoad.toGuidanceJson(planned, NativeFix(104.0, 30.0, 1000L, 5.0), 104.01 to 30.0)
        }.exceptionOrNull()
        assertTrue(error is IllegalArgumentException)
        assertTrue(error?.message?.contains("离可通行道路过远") == true)
    }
}
