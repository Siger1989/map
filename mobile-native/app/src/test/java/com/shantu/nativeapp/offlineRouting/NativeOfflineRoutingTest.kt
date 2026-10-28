package com.shantu.nativeapp.offlineRouting

import android.os.CancellationSignal
import com.shantu.nativeapp.navigation.NativeCoordinate
import com.shantu.nativeapp.navigation.NativePlace
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

@RunWith(RobolectricTestRunner::class)
@org.robolectric.annotation.Config(sdk=[28],manifest=org.robolectric.annotation.Config.NONE)
class NativeOfflineRoutingTest {
 private lateinit var store:NativeOfflineRouting
 @Before fun setup(){val c=RuntimeEnvironment.getApplication();c.filesDir.resolve("offline-routing").deleteRecursively();store=NativeOfflineRouting(c)}
 @Test fun astarUsesKnownRoadGeometryAndShortestPath(){val g=graph(false);store.save(g);val p=NativeOfflineRouteProvider(store).route(listOf(place(.001,0.0),place(.009,0.0)),CancellationSignal())!!;assertEquals(3,p.roadLegs.single().size);assertEquals(2,p.steps.size);assertTrue(p.distance<1500);assertEquals(.001,p.snapped.first().longitude,.00001);assertEquals("A",p.steps.first().instruction.substringAfter("沿 ").substringBefore(" "))}
 @Test fun disconnectedGraphNeverReturnsStraightLineSuccess(){store.save(graph(true));val error=runCatching{NativeOfflineRouteProvider(store).route(listOf(place(.001,0.0),place(.009,0.0)),CancellationSignal())}.exceptionOrNull();assertNotNull(error);assertTrue(error!!.message!!.contains("不连通"))}
 @Test fun rejectsInvalidCoordinatesAndEdgeLength(){val bad=graph(false).json().put("nodes",org.json.JSONArray().put(JSONObject().put("id",1).put("point",org.json.JSONArray().put(181).put(0))));assertNotNull(runCatching{store.validate(bad)}.exceptionOrNull());val short=graph(false).json();short.getJSONArray("edges").getJSONObject(0).put("metres",1);assertNotNull(runCatching{store.validate(short)}.exceptionOrNull())}
 @Test fun integrityHashAndPackageLimitsAreEnforced(){val manifest=store.save(graph(false));assertEquals(manifest.digest,store.verify(manifest).let{store.list().first().digest});assertNotNull(runCatching{store.verify(manifest.copy(digest="00"))}.exceptionOrNull());assertNotNull(runCatching{store.import(ByteArray(NativeOfflineRouting.MAX_BYTES+1))}.exceptionOrNull())}
 @Test fun jsonExportImportAndDeleteRoundTripAndEightPackageLimit(){val first=store.save(graph(false));val bytes=store.export(first.id);store.delete(first.id);assertTrue(store.list().isEmpty());assertEquals(first.id,store.import(bytes).id);for(i in 1..7)store.save(graph(false).copy(id="pkg$i"));assertEquals(8,store.list().size);assertNotNull(runCatching{store.save(graph(false).copy(id="ninth"))}.exceptionOrNull())}
 @Test fun packageSidecarDetectsOnDiskJsonTampering(){store.save(graph(false));val file=RuntimeEnvironment.getApplication().filesDir.resolve("offline-routing/known.json");file.appendText(" ");assertTrue(store.list().isEmpty());assertNotNull(runCatching{store.load("known")}.exceptionOrNull())}
 @Test fun cancellationStopsOfflinePlanning(){store.save(graph(false));val signal=CancellationSignal().apply{cancel()};assertNotNull(runCatching{NativeOfflineRouteProvider(store).route(listOf(place(.001,0.0),place(.009,0.0)),signal)}.exceptionOrNull())}
 private fun graph(disconnected:Boolean):NativeOfflineGraph {val a=NativeCoordinate(0.0,0.0);val b=NativeCoordinate(.005,0.0);val c=NativeCoordinate(.01,0.0);val n=listOf(NativeRoutingNode(1,a),NativeRoutingNode(2,b),NativeRoutingNode(3,c));val edges=if(disconnected)listOf(NativeRoutingEdge(1,2,NativeOfflineRouting.distance(a,b),"A"),NativeRoutingEdge(3,2,NativeOfflineRouting.distance(c,b),"B")) else listOf(NativeRoutingEdge(1,2,NativeOfflineRouting.distance(a,b),"A"),NativeRoutingEdge(2,3,NativeOfflineRouting.distance(b,c),"B"));return NativeOfflineGraph(if(disconnected)"disconnected" else "known", "test",listOf(-.01,-.01,.02,.01),1,n,edges)}
 private fun place(lon:Double,lat:Double)=NativePlace("p",lon,lat)
}
