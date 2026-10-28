package com.shantu.nativeapp.navigation

import android.os.CancellationSignal
import android.os.OperationCanceledException
import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.io.ByteArrayInputStream
import com.shantu.nativeapp.data.WorkspaceStore

@RunWith(RobolectricTestRunner::class)
@org.robolectric.annotation.Config(sdk = [28], manifest = org.robolectric.annotation.Config.NONE)
class NativeRoutePlannerTest {
    private val start = NativePlace("起点", 104.0, 30.0)
    private val via = NativePlace("途经", 104.01, 30.01)
    private val end = NativePlace("终点", 104.02, 30.02)

    @Test fun usesExistingValhallaLocateThenOsrmCompatibleRouteProtocolForAllModes() {
        for (mode in listOf("auto", "bicycle", "pedestrian")) {
            val transport = FixtureTransport()
            NativeRoutePlanner(transport).plan(start, end, mode, listOf(via))
            assertEquals(2, transport.urls.size)
            assertTrue(transport.urls[0].startsWith(NativeRoutePlanner.LOCATE_ENDPOINT + "?json="))
            assertTrue(transport.urls[1].startsWith(NativeRoutePlanner.ROUTE_ENDPOINT + "?json="))
            val locate = query(transport.urls[0])
            assertEquals(mode, locate.getString("costing"))
            assertEquals(3, locate.getJSONArray("locations").length())
            assertEquals(104.0, locate.getJSONArray("locations").getJSONObject(0).getDouble("lon"), 0.0)
            assertEquals(30.0, locate.getJSONArray("locations").getJSONObject(0).getDouble("lat"), 0.0)
            val route = query(transport.urls[1])
            assertEquals(mode, route.getString("costing"))
            assertEquals("osrm", route.getString("format"))
            assertEquals("geojson", route.getString("shape_format"))
            assertEquals(3, route.getJSONArray("locations").length())
            assertEquals("break", route.getJSONArray("locations").getJSONObject(1).getString("type"))
            assertTrue("Valhalla /locate response is a top-level array", transport.responses[0] is JSONArray)
            assertTrue("Valhalla /route response is a top-level object", transport.responses[1] is JSONObject)
        }
    }

    @Test fun keepsServerRoadGeometryLegsStepsMetersSecondsAndViaArrival() {
        val route = NativeRoutePlanner(FixtureTransport()).plan(start, end, "auto", listOf(via))
        assertTrue(route.distance > 4200.0) // Includes the two explicitly marked straight access connectors at the via.
        assertTrue(route.duration > 720.0)
        assertEquals(7, route.coordinates.size)
        assertEquals(2, route.roadLegs.size)
        assertEquals(3, route.roadLegs[0].size)
        assertEquals(3, route.roadLegs[1].size)
        assertEquals(6, route.steps.size)
        assertEquals("左转 · 山路", route.steps[0].instruction)
        assertEquals("到达途经点 1", route.steps[1].instruction)
        assertEquals("access", route.steps[2].kind)
        assertTrue(route.steps[4].elapsedSeconds > 360.0)
        assertEquals(104.0101, route.snapped[1].longitude, 1e-9)
        assertEquals(30.0101, route.snapped[1].latitude, 1e-9)
    }

    @Test fun routeJsonMatchesWorkspaceFavoriteSchemaForSaving() {
        val route = NativeRoutePlanner(FixtureTransport()).plan(start, end, "bicycle", listOf(via)).toJson()
        val favorite = JSONObject().put("id", "fav-1").put("name", "测试线路").put("savedAt", 1)
            .put("start", JSONObject().put("name", start.name).put("coordinates", JSONArray().put(start.longitude).put(start.latitude)))
            .put("end", JSONObject().put("name", end.name).put("coordinates", JSONArray().put(end.longitude).put(end.latitude)))
            .put("route", route)
        assertEquals("bicycle", favorite.getJSONObject("route").getString("mode"))
        assertEquals(3, favorite.getJSONObject("route").getJSONArray("stops").length())
        assertEquals(3, favorite.getJSONObject("route").getJSONArray("snapped").length())

        val context: Context = RuntimeEnvironment.getApplication()
        context.filesDir.resolve("workspace-v2.json").delete()
        context.filesDir.resolve("workspace-v2.json.bak").delete()
        val core = JSONObject().put("format", "guanyun-backup").put("version", 1)
            .put("tracks", JSONArray()).put("annotations", JSONArray()).put("favorites", JSONArray().put(favorite))
        val workspace = JSONObject().put("format", "shantu-workspace").put("version", 2).put("core", core)
            .put("photos", JSONArray()).put("settings", JSONObject()).put("mapSources", JSONArray())
            .put("cadDocuments", JSONArray()).put("industryProjects", JSONArray()).put("limitations", JSONArray())
        WorkspaceStore(context).importWorkspace(ByteArrayInputStream(workspace.toString().toByteArray()))
    }

    @Test fun rejectsInvalidModeTooManyStopsNearbyStopsAndBadCoordinatesBeforeNetwork() {
        val transport = FixtureTransport()
        val planner = NativeRoutePlanner(transport)
        assertNotNull(runCatching { planner.plan(start, end, "motorcycle") }.exceptionOrNull())
        assertNotNull(runCatching { planner.plan(start, end, "auto", List(9) { via }) }.exceptionOrNull())
        assertNotNull(runCatching { planner.plan(start, start, "auto") }.exceptionOrNull())
        assertNotNull(runCatching { planner.plan(NativePlace("bad", 200.0, 30.0), end, "auto") }.exceptionOrNull())
        assertTrue(transport.urls.isEmpty())
    }

    @Test fun rejectsNoRouteMalformedStepsAndBadSnapsWithoutReturningDirectLine() {
        val noRoute = JSONObject().put("code", "NoRoute").put("routes", JSONArray())
        assertNotNull(runCatching { NativeRoutePlanner.normalizeResponse(noRoute, "auto", listOf(start, end)) }.exceptionOrNull())

        val badTransport = object : NativeRouteTransport {
            var count = 0
            override fun get(url: String, cancellationSignal: CancellationSignal?): Any {
                count++
                return if (url.startsWith(NativeRoutePlanner.LOCATE_ENDPOINT)) locate(listOf(start, end))
                else routeResponse(listOf(start, end), malformedStep = true)
            }
        }
        assertNotNull(runCatching { NativeRoutePlanner(badTransport).plan(start, end, "auto") }.exceptionOrNull())

        val badLocate = object : NativeRouteTransport {
            override fun get(url: String, cancellationSignal: CancellationSignal?): Any = JSONObject().put("locations", JSONArray())
        }
        assertNotNull(runCatching { NativeRoutePlanner(badLocate).plan(start, end, "auto") }.exceptionOrNull())
    }

    @Test fun honorsCancellationBeforeNetworkAndBetweenProviderRequests() {
        val alreadyCancelled = CancellationSignal().apply { cancel() }
        val untouched = FixtureTransport()
        assertTrue(runCatching { NativeRoutePlanner(untouched).plan(start, end, "auto", cancellationSignal = alreadyCancelled) }.exceptionOrNull() is OperationCanceledException)
        assertTrue(untouched.urls.isEmpty())

        val cancelAfterLocate = CancellationSignal()
        val transport = object : NativeRouteTransport {
            var calls = 0
            override fun get(url: String, cancellationSignal: CancellationSignal?): Any {
                calls++
                cancelAfterLocate.cancel()
                return locate(listOf(start, end))
            }
        }
        assertTrue(runCatching { NativeRoutePlanner(transport).plan(start, end, "auto", cancellationSignal = cancelAfterLocate) }.exceptionOrNull() is OperationCanceledException)
        assertEquals(1, transport.calls)
    }

    private class FixtureTransport : NativeRouteTransport {
        val urls = mutableListOf<String>()
        val responses = mutableListOf<Any>()
        override fun get(url: String, cancellationSignal: CancellationSignal?): Any {
            cancellationSignal?.throwIfCanceled()
            urls += url
            val places = when {
                url.startsWith(NativeRoutePlanner.LOCATE_ENDPOINT) -> {
                    val payload = query(url).getJSONArray("locations")
                    (0 until payload.length()).map { i -> NativePlace("p$i", payload.getJSONObject(i).getDouble("lon"), payload.getJSONObject(i).getDouble("lat")) }
                }
                else -> {
                    val payload = query(url).getJSONArray("locations")
                    (0 until payload.length()).map { i -> NativePlace("p$i", payload.getJSONObject(i).getDouble("lon"), payload.getJSONObject(i).getDouble("lat")) }
                }
            }
            val response = if (url.startsWith(NativeRoutePlanner.LOCATE_ENDPOINT)) locate(places) else routeResponse(places)
            responses += response
            return response
        }
    }

    companion object {
        private fun query(url: String): JSONObject {
            val encoded = url.substringAfter("?json=")
            return JSONObject(URLDecoder.decode(encoded, StandardCharsets.UTF_8.name()))
        }

        private fun locate(stops: List<NativePlace>): JSONArray = JSONArray().also { locations ->
            stops.forEachIndexed { index, stop ->
                val shift = if (index == 1 && stops.size == 3) .0001 else 0.0
                locations.put(JSONObject().put("edges", JSONArray().put(JSONObject()
                    .put("correlated_lon", stop.longitude + shift).put("correlated_lat", stop.latitude + shift))))
            }
        }

        private fun routeResponse(stops: List<NativePlace>, malformedStep: Boolean = false): JSONObject {
            val snapped = stops.map { NativeCoordinate(it.longitude, it.latitude) }
            val routeCoordinates = mutableListOf<NativeCoordinate>()
            val legs = JSONArray()
            for (leg in 0 until stops.size - 1) {
                val a = snapped[leg]; val b = snapped[leg + 1]
                val middle = NativeCoordinate((a.longitude + b.longitude) / 2 + .001, (a.latitude + b.latitude) / 2)
                if (routeCoordinates.isEmpty()) routeCoordinates += a
                routeCoordinates += middle; routeCoordinates += b
                val firstStep = JSONObject().put("distance", 2100).put("duration", 360).put("name", "山路")
                    .put("geometry", JSONObject().put("coordinates", coords(listOf(a, middle))))
                    .put("maneuver", JSONObject().put("type", "turn").put("modifier", "left"))
                val arrivalStep = JSONObject().put("distance", 0).put("duration", 0)
                    .put("geometry", JSONObject().put("coordinates", coords(listOf(b))))
                    .put("maneuver", JSONObject().put("type", "arrive"))
                val steps = if (malformedStep) JSONArray().put(JSONObject().put("distance", -1).put("duration", 1)) else JSONArray().put(firstStep).put(arrivalStep)
                legs.put(JSONObject().put("steps", steps))
            }
            val route = JSONObject().put("distance", 4200).put("duration", 720)
                .put("geometry", JSONObject().put("type", "LineString").put("coordinates", coords(routeCoordinates)))
                .put("legs", legs)
            return JSONObject().put("code", "Ok").put("routes", JSONArray().put(route))
                .put("waypoints", JSONArray().also { out -> snapped.forEach { p -> out.put(JSONObject().put("location", JSONArray().put(p.longitude).put(p.latitude))) } })
        }

        private fun coords(points: List<NativeCoordinate>) = JSONArray().also { out -> points.forEach { out.put(it.toJson()) } }
    }
}
