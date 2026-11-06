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
        assertTrue(NativeSnapGeometryDecoder.decodeLines(decoded, bounds, false).complete)
    }

    @Test fun decodedMultilinestringComponentsReachSnapGeometryWithoutFalseConnector() {
        val tile = NativeCachedSnapTile(0, 0, 0, multiLineMvtTile(), Any())
        val features = NativeMvtDecoder.decode(tile.bytes)
        val lines = NativeSnapGeometryDecoder.lines(
            listOf(tile to features), listOf(-180.0, -85.0, 180.0, 85.0), false)

        assertEquals(2, lines.size)
        assertEquals(listOf(2, 3), lines.map { it.coordinates.size }.sorted())
        assertTrue(lines.all { it.name == "Multi trail" })
    }

    @Test fun snapTileSelectionUsesOnlyFinestAvailableSourceZoomBeforeApplyingTileLimit() {
        val fineBounds = tileInteriorBounds(14, 8192, 8192)
        val fine = NativeCachedSnapTile(14, 8192, 8192, byteArrayOf(14), Any())
        val coarse = NativeCachedSnapTile(9, 256, 256, byteArrayOf(9), Any())

        val selected = NativeSnapTileSelector.select(listOf(coarse, fine), fineBounds, maxTiles = 24)

        assertEquals(14, selected.sourceZoom)
        assertEquals(listOf(fine), selected.tiles)
        assertTrue(selected.coverageComplete)
    }

    @Test fun snapTileSelectionRanksFinestTilesBeforeTheTwentyFourTileLimitIndependentOfLruOrder() {
        val bounds = boundsAcrossTileColumns(14, 1000, 1029, row = 8192)
        val fine = (1000..1029).map { NativeCachedSnapTile(14, it, 8192, byteArrayOf(it.toByte()), Any()) }
        val coarse = NativeCachedSnapTile(9, 31, 256, byteArrayOf(9), Any())

        val selected = NativeSnapTileSelector.select(listOf(coarse) + fine.reversed(), bounds, maxTiles = 24)
        val reversed = NativeSnapTileSelector.select(fine + coarse, bounds, maxTiles = 24)

        assertEquals(14, selected.sourceZoom)
        assertEquals(24, selected.tiles.size)
        assertTrue(selected.tiles.all { it.z == 14 })
        assertEquals(selected.tiles.map { it.x }, reversed.tiles.map { it.x })
        assertEquals(1014, selected.tiles.first().x)
        assertFalse(selected.coverageComplete)
    }

    @Test fun snapTileSelectionCentersAndBreaksTiesByStableYThenX() {
        val bounds = boundsAcrossTileColumns(4, 3, 4, row = 7)
        val right = NativeCachedSnapTile(4, 4, 7, byteArrayOf(1), Any())
        val left = NativeCachedSnapTile(4, 3, 7, byteArrayOf(2), Any())

        val selected = NativeSnapTileSelector.select(listOf(right, left, left), bounds, maxTiles = 2)

        assertEquals(listOf(left, right), selected.tiles)
        assertTrue(selected.coverageComplete)
        assertEquals(listOf(left), NativeSnapTileSelector.select(listOf(right, left), bounds, 1).tiles)
    }

    @Test fun snapTileSelectionReportsPartialCoverageAndFallsBackWhenNoFinerCacheExists() {
        val bounds = boundsAcrossTileColumns(4, 3, 4, row = 7)
        val onlyLeft = NativeCachedSnapTile(4, 3, 7, byteArrayOf(1), Any())
        val partial = NativeSnapTileSelector.select(listOf(onlyLeft), bounds, maxTiles = 24)

        assertEquals(4, partial.sourceZoom)
        assertFalse(partial.coverageComplete)

        val coarseBounds = tileInteriorBounds(9, 256, 256)
        val coarse = NativeCachedSnapTile(9, 256, 256, byteArrayOf(9), Any())
        val fallback = NativeSnapTileSelector.select(listOf(coarse), coarseBounds, maxTiles = 24)
        assertEquals(9, fallback.sourceZoom)
        assertEquals(listOf(coarse), fallback.tiles)
        assertTrue(fallback.coverageComplete)
    }

    @Test fun snapTileSelectionPrefersCompleteParentUntilTheChildZoomIsComplete() {
        // This viewport straddles the z=3 column boundary between child tiles 2 and 3,
        // while remaining inside parent z=2 tile 1/1.
        val bounds = boundsAcrossTileColumns(3, 2, 3, row = 3)
        val parent = NativeCachedSnapTile(2, 1, 1, byteArrayOf(2), Any())
        val leftChild = NativeCachedSnapTile(3, 2, 3, byteArrayOf(3), Any())
        val rightChild = NativeCachedSnapTile(3, 3, 3, byteArrayOf(4), Any())

        val whileLoading = NativeSnapTileSelector.select(listOf(parent, leftChild), bounds, maxTiles = 24)
        assertEquals(2, whileLoading.sourceZoom)
        assertEquals(listOf(parent), whileLoading.tiles)
        assertTrue(whileLoading.coverageComplete)

        val upgraded = NativeSnapTileSelector.select(listOf(parent, rightChild, leftChild), bounds, maxTiles = 24)
        assertEquals(3, upgraded.sourceZoom)
        assertEquals(listOf(leftChild, rightChild), upgraded.tiles)
        assertTrue(upgraded.coverageComplete)
    }

    @Test fun snapTileSelectionCapsAllPartialLevelsAndReportsCoverageIncomplete() {
        val bounds = listOf(-179.0, -80.0, 179.0, 80.0)
        val z2 = (0..3).flatMap { y -> (0..3).map { x ->
            NativeCachedSnapTile(2, x, y, byteArrayOf((y * 4 + x).toByte()), Any())
        } }
        val selection = NativeSnapTileSelector.select(z2, bounds, maxTiles = 8)

        assertEquals(2, selection.sourceZoom)
        assertEquals(8, selection.tiles.size)
        assertFalse(selection.coverageComplete)
        assertEquals(selection.tiles.sortedWith(compareBy<NativeCachedSnapTile> {
            val dx = (it.x + .5) / 4.0 - .5
            val dy = (it.y + .5) / 4.0 - .5
            dx * dx + dy * dy
        }.thenBy { it.y }.thenBy { it.x }), selection.tiles)
    }

    @Test fun realDecoderSelectsFineRoadBeforeCoarseFeatureCanExhaustPointBudget() {
        val bounds = tileInteriorBounds(14, 8192, 8192)
        val coarse = NativeCachedSnapTile(9, 256, 256, singleRoadMvtTile("coarse", 6000, 1, 64), Any())
        val fine = NativeCachedSnapTile(14, 8192, 8192, singleRoadMvtTile("fine", 2, 1000, 1000), Any())
        val selected = NativeSnapTileSelector.select(listOf(coarse, fine), bounds, maxTiles = 24)
        val decoded = selected.tiles.map { tile ->
            tile to NativeMvtDecoder.decode(tile.bytes).filter(NativeSnapGeometryDecoder::accepts)
        }
        val lines = NativeSnapGeometryDecoder.lines(decoded, bounds, false)

        assertEquals(listOf("fine"), lines.map { it.name })
        assertEquals(listOf(2), lines.map { it.coordinates.size })
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
        val result = NativeSnapGeometryDecoder.decodeLines(decoded, listOf(-180.0, -85.0, 180.0, 85.0), false)
        assertTrue(lines.sumOf { it.coordinates.size } <= 6000)
        assertEquals(3000, lines.size)
        assertFalse("point-budget truncation must invalidate full coverage", result.complete)
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
        assertEquals("partial", NativeSnapGeometryState.status(enabled = true, layerVisible = true, viewportKnown = true, cacheAvailable = true, lines = 1, coverageComplete = false))
        assertEquals("partial", NativeSnapGeometryState.status(enabled = true, layerVisible = true, viewportKnown = true, cacheAvailable = true, lines = 0, coverageComplete = false))
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

    /** Encodes two line components; the second MoveTo delta is relative to the first line's end. */
    private fun multiLineMvtTile(): ByteArray {
        val keys = listOf("class", "name")
        val values = listOf("path", "Multi trail")
        val tags = listOf(0, 0, 1, 1).flatMap(::varint).toByteArray()
        val geometry = listOf(
            9, zig(10), zig(20),
            18, zig(5), zig(0), zig(0), zig(5),
            9, zig(85), zig(75),
            10, zig(10), zig(0),
        ).flatMap(::varint).toByteArray()
        val feature = bytesField(2, tags) + varint(24) + varint(2) + bytesField(4, geometry)
        var layer = bytesField(1, "transportation".toByteArray()) + bytesField(2, feature)
        keys.forEach { layer += bytesField(3, it.toByteArray()) }
        values.forEach { value -> layer += bytesField(4, bytesField(1, value.toByteArray())) }
        layer += varint(40) + varint(4096)
        layer += varint(120) + varint(2)
        return bytesField(3, layer)
    }

    private fun singleRoadMvtTile(name: String, pointCount: Int, startX: Int, startY: Int): ByteArray {
        val keys = listOf("class", "name")
        val values = listOf("path", name)
        val tags = listOf(0, 0, 1, 1).flatMap(::varint).toByteArray()
        val geometry = buildList {
            add(9); add(zig(startX)); add(zig(startY))
            if (pointCount > 1) {
                add(((pointCount - 1) shl 3) or 2)
                repeat(pointCount - 1) { add(zig(1)); add(zig(0)) }
            }
        }.flatMap(::varint).toByteArray()
        val feature = bytesField(2, tags) + varint(24) + varint(2) + bytesField(4, geometry)
        var layer = bytesField(1, "transportation".toByteArray()) + bytesField(2, feature)
        keys.forEach { layer += bytesField(3, it.toByteArray()) }
        values.forEach { value -> layer += bytesField(4, bytesField(1, value.toByteArray())) }
        layer += varint(40) + varint(4096)
        layer += varint(120) + varint(2)
        return bytesField(3, layer)
    }

    private fun tileInteriorBounds(z: Int, x: Int, y: Int): List<Double> {
        val n = 1 shl z
        fun longitude(tx: Double) = tx / n * 360.0 - 180.0
        fun latitude(ty: Double) = Math.toDegrees(kotlin.math.atan(kotlin.math.sinh(Math.PI * (1.0 - 2.0 * ty / n))))
        return listOf(longitude(x + .2), latitude(y + .8), longitude(x + .8), latitude(y + .2))
    }

    private fun boundsAcrossTileColumns(z: Int, westX: Int, eastX: Int, row: Int): List<Double> {
        val n = 1 shl z
        fun longitude(tx: Double) = tx / n * 360.0 - 180.0
        fun latitude(ty: Double) = Math.toDegrees(kotlin.math.atan(kotlin.math.sinh(Math.PI * (1.0 - 2.0 * ty / n))))
        return listOf(longitude(westX + .2), latitude(row + .8), longitude(eastX + .8), latitude(row + .2))
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
