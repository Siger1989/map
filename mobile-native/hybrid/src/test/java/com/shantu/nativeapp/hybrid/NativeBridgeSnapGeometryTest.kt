package com.shantu.nativeapp.hybrid

import com.shantu.nativeapp.geology.NativeMvtDecoder
import com.shantu.nativeapp.map.NativeSnapDataLayerPolicy
import com.shantu.nativeapp.map.NativeCachedSnapTile
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class NativeBridgeSnapGeometryTest {
    @Test fun decodesActualMvtTransportationAndWaterwayCenterlinesToWgs84() {
        val tile = NativeCachedSnapTile(0, 0, 0, mvtTile(), Any())
        val features = NativeMvtDecoder.decode(tile.bytes)
        val decoded = listOf(tile to features)
        val bounds = listOf(-180.0, -85.0, 180.0, 85.0)
        val roads = NativeSnapGeometryDecoder.lines(decoded, bounds, false)
        val rivers = NativeSnapGeometryDecoder.lines(decoded, bounds, true)
        assertEquals(1, roads.size)
        assertEquals("Test trail", roads.single().name)
        assertEquals(1, roads.single().level)
        assertEquals(-90.0, roads.single().coordinates.first().first, 1e-9)
        assertTrue(roads.single().coordinates.first().second > 60.0)
        assertEquals(1, rivers.size)
        assertTrue(rivers.single().id.startsWith("waterway:"))
        assertEquals("Creek", rivers.single().name)
    }

    @Test fun rejectsWrongSourceLayersClassesPolygonsAndLinesOutsideViewport() {
        val tile = NativeCachedSnapTile(0, 0, 0, byteArrayOf(1), Any())
        val decoded = listOf(tile to listOf(
            feature("transportation", "rail", "Rail", listOf(100 to 100, 200 to 200)),
            feature("waterway", "river", "River", listOf(100 to 100, 200 to 200), type = 3),
            feature("waterway", "river", "Outside", listOf(100 to 100, 200 to 200)),
        ))
        assertTrue(NativeSnapGeometryDecoder.lines(decoded, listOf(100.0, 40.0, 120.0, 60.0), false).isEmpty())
        assertTrue(NativeSnapGeometryDecoder.lines(decoded, listOf(100.0, 40.0, 120.0, 60.0), true).isEmpty())
    }

    @Test fun capsExportedGeometryAtRoadSnapContractPointBudget() {
        val paths = (0 until 3501).map { listOf((100 + it) to 100, (102 + it) to 102) }
        val tile = NativeCachedSnapTile(0, 0, 0, byteArrayOf(1), Any())
        val decoded = listOf(tile to listOf(com.shantu.nativeapp.geology.NativeMvtFeature("transportation", 2, 4096,
            mapOf("class" to "path", "name" to "Fixture"), paths)))
        val lines = NativeSnapGeometryDecoder.lines(decoded, listOf(-180.0, -85.0, 180.0, 85.0), false)
        assertTrue(lines.sumOf { it.coordinates.size } <= 6000)
        assertEquals(3000, lines.size)
    }

    @Test fun hugeFeaturePathListStopsAtAnExplicitScanBudget() {
        val reads = AtomicInteger()
        val oversizedPath = List(6001) { it to it }
        val paths = object : AbstractList<List<Pair<Int, Int>>>() {
            override val size: Int = 1_000_000
            override fun get(index: Int): List<Pair<Int, Int>> { reads.incrementAndGet(); return oversizedPath }
        }
        val tile = NativeCachedSnapTile(0, 0, 0, byteArrayOf(1), Any())
        val feature = com.shantu.nativeapp.geology.NativeMvtFeature(
            "transportation", 2, 4096, mapOf("class" to "path"), paths)
        val lines = NativeSnapGeometryDecoder.lines(listOf(tile to listOf(feature)), listOf(-180.0, -85.0, 180.0, 85.0), false)
        assertTrue(lines.isEmpty())
        assertTrue(reads.get() <= NativeSnapGeometryDecoder.MAX_PATHS_SCANNED + 1)
    }

    @Test fun workerRunsOffCallerAndCoalescesQueuedViewportsToLatestRequest() {
        val executor = Executors.newSingleThreadExecutor { runnable -> Thread(runnable, "snap-test-worker") }
        val firstStarted = CountDownLatch(1)
        val releaseFirst = CountDownLatch(1)
        val completed = CountDownLatch(2)
        val results = CopyOnWriteArrayList<Pair<String, Pair<String, String>>>()
        val queue = NativeSnapGeometryWorkQueue<Pair<String, String>>(executor, { key, result ->
            results += key to result
            completed.countDown()
        })
        val caller = Thread.currentThread().name
        try {
            assertTrue(queue.submit("first") {
                firstStarted.countDown()
                check(releaseFirst.await(2, TimeUnit.SECONDS))
                Thread.currentThread().name to "computed-first"
            })
            assertTrue(firstStarted.await(1, TimeUnit.SECONDS))
            assertTrue(queue.submit("stale-queued") { "unused" to "should-be-coalesced" })
            assertTrue(queue.submit("latest") { Thread.currentThread().name to "computed-latest" })
            releaseFirst.countDown()
            assertTrue(completed.await(2, TimeUnit.SECONDS))
            assertEquals(listOf("first", "latest"), results.map { it.first })
            assertTrue(results.all { it.second.first != caller })
        } finally {
            releaseFirst.countDown()
            queue.close()
        }
    }

    @Test fun snapshotReadySignalCoversReadyEmptyBlockedAndWorkerErrorCompletions() {
        val executor = Executors.newSingleThreadExecutor { runnable -> Thread(runnable, "snap-ready-test-worker") }
        val signal = NativeSnapGeometryReadySignal()
        var pulse = CountDownLatch(1)
        val notifications = AtomicInteger()
        val observation = requireNotNull(signal.observe { notifications.incrementAndGet(); pulse.countDown() })
        val queue = NativeSnapGeometryWorkQueue<String>(executor,
            onResult = { _, _ -> signal.signal() },
            onError = { _, _ -> signal.signal() })
        try {
            val outcomes = listOf<() -> String>(
                { "ready" }, { "visible_tiles_not_loaded" }, { "geometry_cache_unavailable" },
                { error("decoder failure") },
            )
            outcomes.forEachIndexed { index, task ->
                pulse = CountDownLatch(1)
                assertTrue(queue.submit("result-$index", task))
                assertTrue("each completion, including empty/blocked/error, signals ready observers", pulse.await(1, TimeUnit.SECONDS))
            }
        } finally {
            observation.close()
            queue.close()
            signal.close()
        }
        assertEquals(4, notifications.get())
        assertNull(signal.observe {})
    }

    @Test fun reportsDisabledLoadingMissingAndReadyGeometrySeparately() {
        assertEquals("hidden", NativeSnapGeometryState.status(enabled = false, layerVisible = true, viewportKnown = true, cacheAvailable = true, lines = 4))
        assertEquals("hidden", NativeSnapGeometryState.status(enabled = true, layerVisible = false, viewportKnown = true, cacheAvailable = true, lines = 4))
        assertEquals("ready", NativeSnapGeometryState.status(enabled = true, layerVisible = true, viewportKnown = true, cacheAvailable = true, lines = 1))
        assertEquals("loading", NativeSnapGeometryState.status(enabled = true, layerVisible = true, viewportKnown = false, cacheAvailable = true, lines = 4))
        assertEquals("loading", NativeSnapGeometryState.status(enabled = true, layerVisible = true, viewportKnown = true, cacheAvailable = false, lines = 0))
        assertEquals("missing", NativeSnapGeometryState.status(enabled = true, layerVisible = true, viewportKnown = true, cacheAvailable = true, lines = 0))
        assertEquals("ready", NativeSnapGeometryState.status(enabled = true, layerVisible = true, viewportKnown = true, cacheAvailable = true, lines = 1))
    }

    @Test fun roadAndRiverSnappingShareBoundedMvtLayerWithoutDuplicatingVisibleRoadLayers() {
        assertTrue(NativeSnapDataLayerPolicy.shouldEnable(roadSnapping = true, riverSnapping = false, anotherMvtLayerFetching = false))
        assertTrue(NativeSnapDataLayerPolicy.shouldEnable(roadSnapping = false, riverSnapping = true, anotherMvtLayerFetching = false))
        assertTrue(NativeSnapDataLayerPolicy.shouldEnable(roadSnapping = true, riverSnapping = true, anotherMvtLayerFetching = false))
        assertFalse(NativeSnapDataLayerPolicy.shouldEnable(roadSnapping = false, riverSnapping = false, anotherMvtLayerFetching = false))
        assertFalse(NativeSnapDataLayerPolicy.shouldEnable(roadSnapping = true, riverSnapping = false, anotherMvtLayerFetching = true))
    }

    private fun feature(layer: String, clazz: String, name: String, path: List<Pair<Int, Int>>, type: Int = 2) =
        com.shantu.nativeapp.geology.NativeMvtFeature(layer, type, 4096, mapOf("class" to clazz, "name" to name), listOf(path))

    /** A small standards-shaped Mapbox Vector Tile protobuf with road, river, and ignored railway. */
    private fun mvtTile(): ByteArray {
        val road = layer("transportation", listOf("path" to "Test trail" to "1", "rail" to "Ignored" to "0"))
        val river = layer("waterway", listOf("river" to "Creek" to "0"))
        return bytesField(3, road) + bytesField(3, river)
    }

    private fun layer(name: String, rows: List<Pair<Pair<String, String>, String>>): ByteArray {
        val keys = listOf("class", "name", "layer")
        val values = rows.flatMap { listOf(it.first.first, it.first.second, it.second) }.distinct()
        var out = bytesField(1, name.toByteArray())
        val featureFields = rows.map { (tag, level) ->
            val tags = listOf(keys.indexOf("class"), values.indexOf(tag.first), keys.indexOf("name"), values.indexOf(tag.second), keys.indexOf("layer"), values.indexOf(level))
            val geometry = listOf(9, zig(1024), zig(1024), 10, zig(2048), zig(2048)).flatMap(::varint).toByteArray()
            val encodedFeature = bytesField(2, tags.flatMap(::varint).toByteArray()) + varint(24).toByteArray() + varint(2).toByteArray() + bytesField(4, geometry)
            bytesField(2, encodedFeature)
        }
        featureFields.forEach { out += it }
        keys.forEach { out += bytesField(3, it.toByteArray()) }
        values.forEach { out += bytesField(4, bytesField(1, it.toByteArray())) }
        out += varint(40) + varint(4096)
        out += varint(120) + varint(2)
        return out
    }

    private fun zig(value: Int) = (value shl 1) xor (value shr 31)
    private fun varint(value: Int): List<Byte> {
        var n = value.toLong(); val out = mutableListOf<Byte>()
        while (n >= 128) { out += ((n.toInt() and 127) or 128).toByte(); n = n ushr 7 }
        out += n.toByte(); return out
    }
    private fun bytesField(field: Int, bytes: ByteArray) = varint((field shl 3) or 2).toByteArray() + varint(bytes.size).toByteArray() + bytes
}
