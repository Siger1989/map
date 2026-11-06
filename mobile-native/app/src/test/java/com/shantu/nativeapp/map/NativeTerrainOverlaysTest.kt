package com.shantu.nativeapp.map

import android.graphics.Color
import earth.worldwind.geom.AltitudeMode
import earth.worldwind.geom.Angle
import earth.worldwind.geom.Camera
import earth.worldwind.geom.Line
import earth.worldwind.geom.Sector
import earth.worldwind.geom.Vec3
import earth.worldwind.globe.Globe
import earth.worldwind.globe.projection.EquirectangularProjection
import earth.worldwind.globe.terrain.Terrain
import earth.worldwind.layer.mercator.MercatorSector
import earth.worldwind.layer.mercator.SlippyTiles
import earth.worldwind.layer.TiledVectorLayer
import earth.worldwind.layer.mvt.MvtBatchedLineTile
import earth.worldwind.render.RenderContext
import earth.worldwind.shape.Label
import earth.worldwind.shape.Path
import earth.worldwind.util.Tile
import earth.worldwind.util.LruMemoryCache
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeout
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.TimeUnit
import java.util.concurrent.CancellationException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.assertSame
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class NativeTerrainOverlaysTest {
    @Test
    fun `contour intervals and minimum zoom match web terrain settings`() {
        assertEquals(11, NativeTerrainOverlayMath.contourMinimumZoom(30))
        assertEquals(10, NativeTerrainOverlayMath.contourMinimumZoom(50))
        assertEquals(9, NativeTerrainOverlayMath.contourMinimumZoom(100))
        assertEquals(8, NativeTerrainOverlayMath.contourMinimumZoom(200))
    }

    @Test
    fun `auto contour spacing adapts at effective zoom while explicit spacing stays fixed`() {
        assertEquals(30, NativeContourIntervalPolicy.resolve("auto", 11.0))
        assertEquals(50, NativeContourIntervalPolicy.resolve("auto", 10.0))
        assertEquals(100, NativeContourIntervalPolicy.resolve("auto", 9.0))
        assertEquals(200, NativeContourIntervalPolicy.resolve("auto", 8.0))
        assertEquals(200, NativeContourIntervalPolicy.resolve("auto", Double.NaN))
        assertEquals(100, NativeContourIntervalPolicy.resolve(100, 13.0))
    }

    @Test
    fun `hypsometric palette follows interval floor bands and original anchors`() {
        val zero = Color.rgb(0x13, 0x7b, 0x63)
        val fiveHundred = Color.rgb(0x47, 0xba, 0x42)
        assertEquals(zero, NativeTerrainOverlayMath.elevationColor(49.99, 50))
        assertEquals(NativeTerrainOverlayMath.elevationColor(-50.0, 50), NativeTerrainOverlayMath.elevationColor(-0.01, 50))
        assertEquals(fiveHundred, NativeTerrainOverlayMath.elevationColor(500.0, 50))
        assertEquals(Color.rgb(0xaf, 0xc5, 0xdb), NativeTerrainOverlayMath.elevationColor(9_000.0, 30))
    }

    @Test
    fun `elevation fill uses fixed 25 meter absolute bands with rich low elevation steps`() {
        assertEquals(25, NativeTerrainOverlayMath.ELEVATION_FILL_STEP_METERS)
        assertEquals(NativeTerrainOverlayMath.elevationFillColor(0.0), NativeTerrainOverlayMath.elevationFillColor(24.99))
        assertEquals(NativeTerrainOverlayMath.elevationFillColor(-25.0), NativeTerrainOverlayMath.elevationFillColor(-0.01))
        assertFalse(NativeTerrainOverlayMath.elevationFillColor(24.99) == NativeTerrainOverlayMath.elevationFillColor(25.0))
        assertEquals(Color.rgb(0x07, 0x50, 0x43), NativeTerrainOverlayMath.elevationFillColor(-500.0))
        assertEquals(Color.rgb(0xaf, 0xc5, 0xdb), NativeTerrainOverlayMath.elevationFillColor(9_000.0))
        val lowAltitudeColors = (0..1_000 step NativeTerrainOverlayMath.ELEVATION_FILL_STEP_METERS)
            .map { NativeTerrainOverlayMath.elevationFillColor(it.toDouble()) }.toSet()
        assertEquals(41, lowAltitudeColors.size)
        // At 500m the legacy contour palette changes with interval, while fill remains tied to
        // its fixed absolute 25m bands and therefore independent of contour spacing.
        assertFalse(
            NativeTerrainOverlayMath.elevationColor(500.0, 30) == NativeTerrainOverlayMath.elevationColor(500.0, 50),
        )
        assertEquals(Color.rgb(0x47, 0xba, 0x42), NativeTerrainOverlayMath.elevationFillColor(500.0))
    }

    @Test
    fun `render time contour color transform chooses black or white and preserves source opacity`() {
        assertEquals(Color.WHITE, NativeTerrainOverlayMath.contrastContourColor(-500.0))
        assertEquals(Color.BLACK, NativeTerrainOverlayMath.contrastContourColor(1_500.0))
        val darkArgb = Color.rgb(0x13, 0x7b, 0x63)
        val brightArgb = Color.rgb(0xff, 0xe0, 0x2e)
        val darkRange = earth.worldwind.render.Color(
            Color.red(darkArgb) / 255f, Color.green(darkArgb) / 255f, Color.blue(darkArgb) / 255f, 0.8f,
        )
        val brightRange = earth.worldwind.render.Color(
            Color.red(brightArgb) / 255f, Color.green(brightArgb) / 255f, Color.blue(brightArgb) / 255f, 0.8f,
        )
        NativeContourVectorGeometry.applyContrastColor(darkRange)
        NativeContourVectorGeometry.applyContrastColor(brightRange)
        assertEquals(1f, darkRange.red, 1e-6f)
        assertEquals(1f, darkRange.green, 1e-6f)
        assertEquals(1f, darkRange.blue, 1e-6f)
        assertEquals(0.8f, darkRange.alpha, 1e-6f)
        assertEquals(0f, brightRange.red, 1e-6f)
        assertEquals(0f, brightRange.green, 1e-6f)
        assertEquals(0f, brightRange.blue, 1e-6f)
        assertEquals(0.8f, brightRange.alpha, 1e-6f)
    }

    @Test
    fun `marching squares creates real 50 meter contours and skips nodata cells`() {
        val size = 8
        val ramp = DoubleArray(size * size) { index -> (index / size) * 50.0 }
        val lines = NativeTerrainOverlayMath.contourSegments(ramp, size, 50)
        assertTrue(lines.any { it.elevationMeters == 50 })
        assertTrue(lines.all { it.x1 in 0f..(size - 1).toFloat() && it.y1 in 0f..(size - 1).toFloat() })

        val withNodata = ramp.copyOf()
        for (y in 0 until size) withNodata[y * size + size / 2] = Double.NaN
        val separated = NativeTerrainOverlayMath.contourSegments(withNodata, size, 50)
        assertTrue(separated.isNotEmpty())
        assertFalse(separated.any { it.x1 < size / 2 && it.x2 > size / 2 || it.x2 < size / 2 && it.x1 > size / 2 })

        val noData = DoubleArray(size * size) { Double.NaN }
        assertTrue(NativeTerrainOverlayMath.contourSegments(noData, size, 30).isEmpty())
    }

    @Test
    fun `exact contour endpoint identity keeps nearby separate segments apart`() {
        val segments = listOf(
            NativeContourSegment(0f, 0f, 1.1f, 0f, 30),
            NativeContourSegment(1.4f, 0f, 2f, 0f, 30),
        )

        val paths = NativeTerrainOverlayMath.contourPaths(segments)

        assertEquals(2, paths.size)
        assertTrue(paths.all { it.points.size == 2 })
        assertSegmentMultisetExactlyOnce(segments, paths)
    }

    @Test
    fun `exact shared endpoints stitch once and closed loops consume every edge`() {
        val sharedEndpoint = listOf(
            NativeContourSegment(0f, 0f, 1f, 1f, 30),
            NativeContourSegment(1f, 1f, 2f, 0f, 30),
        )
        val sharedPaths = NativeTerrainOverlayMath.contourPaths(sharedEndpoint)
        assertEquals(1, sharedPaths.size)
        assertEquals(3, sharedPaths.single().points.size)
        assertSegmentMultisetExactlyOnce(sharedEndpoint, sharedPaths)

        val closedLoop = listOf(
            NativeContourSegment(0f, 0f, 1f, 0f, 30),
            NativeContourSegment(1f, 0f, 1f, 1f, 30),
            NativeContourSegment(1f, 1f, 0f, 1f, 30),
            NativeContourSegment(0f, 1f, 0f, 0f, 30),
        )
        val loopPaths = NativeTerrainOverlayMath.contourPaths(closedLoop)
        assertEquals(1, loopPaths.size)
        assertEquals(loopPaths.single().points.first(), loopPaths.single().points.last())
        assertSegmentMultisetExactlyOnce(closedLoop, loopPaths)
    }

    @Test
    fun `neighboring marching cells produce bit-identical shared crossings and preserve every segment`() {
        val samples = doubleArrayOf(
            0.0, 0.0, 0.0,
            100.0, 100.0, 100.0,
            100.0, 100.0, 100.0,
        )
        val segments = NativeTerrainOverlayMath.contourSegments(samples, 3, 30)

        assertEquals(6, segments.size)
        val paths = NativeTerrainOverlayMath.contourPaths(segments)
        assertEquals(3, paths.size)
        assertTrue(paths.all { it.points.size == 3 })
        assertSegmentMultisetExactlyOnce(segments, paths)
    }

    private data class ExactPointBits(val x: Int, val y: Int)
    private data class ExactSegmentBits(val elevation: Int, val first: ExactPointBits, val second: ExactPointBits)

    private fun exactPointBits(x: Float, y: Float): ExactPointBits = ExactPointBits(
        java.lang.Float.floatToRawIntBits(if (x == 0f) 0f else x),
        java.lang.Float.floatToRawIntBits(if (y == 0f) 0f else y),
    )

    private fun compareExactPoints(a: ExactPointBits, b: ExactPointBits): Int {
        val xOrder = Integer.compareUnsigned(a.x, b.x)
        return if (xOrder != 0) xOrder else Integer.compareUnsigned(a.y, b.y)
    }

    private fun exactSegmentBits(elevation: Int, a: ExactPointBits, b: ExactPointBits): ExactSegmentBits =
        if (compareExactPoints(a, b) <= 0) ExactSegmentBits(elevation, a, b) else ExactSegmentBits(elevation, b, a)

    private fun assertSegmentMultisetExactlyOnce(
        input: List<NativeContourSegment>,
        output: List<NativeContourPath>,
    ) {
        val expected = mutableMapOf<ExactSegmentBits, Int>()
        input.forEach { segment ->
            val key = exactSegmentBits(segment.elevationMeters,
                exactPointBits(segment.x1, segment.y1), exactPointBits(segment.x2, segment.y2))
            expected[key] = expected.getOrDefault(key, 0) + 1
        }
        val actual = mutableMapOf<ExactSegmentBits, Int>()
        output.forEach { path ->
            path.points.zipWithNext().forEach { (a, b) ->
                val key = exactSegmentBits(path.elevationMeters,
                    exactPointBits(a.first, a.second), exactPointBits(b.first, b.second))
                actual[key] = actual.getOrDefault(key, 0) + 1
            }
        }
        assertEquals("stitching must preserve every input segment exactly once without adding edges", expected, actual)
    }

    @Test
    fun `segment budget reports the first over-limit request`() {
        val error = try {
            val height = 30.0 * (NativeContourGeometryBudget.MAX_SEGMENTS + 1)
            NativeTerrainOverlayMath.contourSegments(doubleArrayOf(0.0, 0.0, height, height), 2, 30)
            null
        } catch (failure: NativeContourGeometryBudgetExceeded) {
            failure
        }
        assertTrue("expected a typed geometry budget exception", error != null)
        val segmentFailure = requireNotNull(error)
        assertEquals("segments", segmentFailure.resource)
        assertEquals(65_536L, segmentFailure.limit)
        assertEquals(65_537L, segmentFailure.requested)

        val size = 16
        val ramp = DoubleArray(size * size) { index -> (index / size) * 50.0 }
        val ordinarySegments = NativeTerrainOverlayMath.contourSegments(ramp, size, 50)
        val paths = NativeTerrainOverlayMath.contourPaths(ordinarySegments)
        assertEquals(225, ordinarySegments.size)
        assertEquals(15, paths.size)
        assertTrue(paths.all { it.points.size == size })
        assertEquals(285L, NativeContourGeometryBudget.preflight(paths))
        assertEquals(5_242_880L,
            NativeContourGeometryBudget.MAX_LOGICAL_VERTICES.toLong() *
                NativeContourGeometryBudget.FLOATS_PER_LOGICAL_VERTEX * 4L)
    }

    @Test
    fun `geometry preflight bounds SDK vertices without allocating a large point list`() {
        val points = object : AbstractList<Pair<Float, Float>>() {
            override val size = NativeContourGeometryBudget.MAX_LOGICAL_VERTICES - 2
            override fun get(index: Int): Pair<Float, Float> = error("preflight must use only path size")
        }
        val error = try {
            NativeContourGeometryBudget.preflight(listOf(NativeContourPath(50, points)))
            null
        } catch (failure: NativeContourGeometryBudgetExceeded) {
            failure
        }
        assertTrue("expected a typed geometry budget exception", error != null)
        val preflightFailure = requireNotNull(error)
        assertEquals("logical vertices", preflightFailure.resource)
        assertEquals(65_537L, preflightFailure.requested)
    }

    @Test
    fun `contour row and path loops check cancellation`() {
        val values = DoubleArray(16 * 16) { Double.NaN }
        val cancellation = CancellationException("cancel contour rows")
        var rowsChecked = 0
        val rowFailure = try {
            NativeTerrainOverlayMath.contourSegments(values, 16, 50) {
                if (++rowsChecked == 3) throw cancellation
            }
            null
        } catch (failure: CancellationException) {
            failure
        }
        assertSame(cancellation, rowFailure)
        assertEquals(3, rowsChecked)

        val paths = listOf(
            NativeContourPath(50, listOf(0f to 0f, 1f to 0f)),
            NativeContourPath(100, listOf(0f to 1f, 1f to 1f)),
        )
        var pathsChecked = 0
        val pathFailure = try {
            NativeContourGeometryBudget.preflight(paths) {
                if (++pathsChecked == 2) throw cancellation
            }
            null
        } catch (failure: CancellationException) {
            failure
        }
        assertSame(cancellation, pathFailure)
        assertEquals(2, pathsChecked)
    }

    @Test
    fun `major contour labels follow connected line fragments`() {
        val size = 256
        val ramp = DoubleArray(size * size) { index -> (index / size) * 50.0 }
        val lines = NativeTerrainOverlayMath.contourSegments(ramp, size, 50)
        val labels = NativeTerrainOverlayMath.contourLabels(lines, 50)
        assertTrue(labels.any { it.elevationMeters == 250 })
        assertTrue(labels.all { it.x in 0f..(size - 1).toFloat() })
    }

    @Test
    fun `ambiguous checkerboard cells use complementary center-decided pairings`() {
        // Row-major storage is [topLeft, topRight, bottomLeft, bottomRight].
        val lowCorners = doubleArrayOf(25.0, 75.0, 75.0, 25.0)
        val highCorners = doubleArrayOf(75.0, 25.0, 25.0, 75.0)
        val lowLines = NativeTerrainOverlayMath.contourSegments(lowCorners, 2, 50)
        val highLines = NativeTerrainOverlayMath.contourSegments(highCorners, 2, 50)
        assertEquals(2, lowLines.size)
        assertEquals(2, highLines.size)
        // Low diagonal corners with a high center isolate the two low corners (left/top, right/bottom).
        assertTrue(lowLines.any { it.x1 == 0.5f && it.y1 == 0f && it.x2 == 0f && it.y2 == 0.5f })
        assertTrue(lowLines.any { it.x1 == 1f && it.y1 == 0.5f && it.x2 == 0.5f && it.y2 == 1f })
        // Complementary input must pair around the other diagonal corners.
        assertTrue(highLines.any { it.x1 == 0.5f && it.y1 == 0f && it.x2 == 1f && it.y2 == 0.5f })
        assertTrue(highLines.any { it.x1 == 0.5f && it.y1 == 1f && it.x2 == 0f && it.y2 == 0.5f })
    }

    @Test
    fun `asymmetric complementary saddles use bilinear decider instead of corner average`() {
        // Row-major [top-left, top-right, bottom-left, bottom-right]. Both determinants are
        // positive. Complementing elevations about 50 must preserve the same contour geometry:
        // f(x,y)=0 and -f(x,y)=0 are identical away from an exact saddle tie.
        val lowDiagonal = NativeTerrainOverlayMath.contourSegments(
            doubleArrayOf(0.0, 60.0, 60.0, 10.0), 2, 50,
        )
        val highDiagonal = NativeTerrainOverlayMath.contourSegments(
            doubleArrayOf(100.0, 40.0, 40.0, 90.0), 2, 50,
        )
        assertEquals(2, lowDiagonal.size)
        assertEquals(2, highDiagonal.size)
        assertTrue(lowDiagonal.any { near(it.x1, 5f / 6f) && near(it.y1, 0f) && near(it.x2, 1f) && near(it.y2, .2f) })
        assertTrue(lowDiagonal.any { near(it.x1, .2f) && near(it.y1, 1f) && near(it.x2, 0f) && near(it.y2, 5f / 6f) })
        assertTrue(highDiagonal.any { near(it.x1, 5f / 6f) && near(it.y1, 0f) && near(it.x2, 1f) && near(it.y2, .2f) })
        assertTrue(highDiagonal.any { near(it.x1, .2f) && near(it.y1, 1f) && near(it.x2, 0f) && near(it.y2, 5f / 6f) })
        assertTrue((lowDiagonal+highDiagonal).none { it.x1==it.x2 && it.y1==it.y2 })
    }

    @Test
    fun `raster overlays preserve opacity and make missing elevations transparent`() {
        val values = doubleArrayOf(0.0, Double.NaN, 500.0, 1_000.0)
        val colors = NativeTerrainOverlayMath.renderElevationColors(values, 2, 0.5)
        try {
            assertEquals(127, Color.alpha(colors.getPixel(0, 0)))
            assertEquals(0, Color.alpha(colors.getPixel(1, 0)))
            // Native ARGB bitmaps premultiply then unpremultiply alpha; each RGB channel
            // can round by one at half opacity while the band color must remain the same.
            val pixel=colors.getPixel(0,1)
            assertTrue(kotlin.math.abs(Color.red(pixel)-0x47)<=1)
            assertTrue(kotlin.math.abs(Color.green(pixel)-0xba)<=1)
            assertTrue(kotlin.math.abs(Color.blue(pixel)-0x42)<=1)
        } finally {
            colors.recycle()
        }

        val size = 32
        val ramp = DoubleArray(size * size) { index -> (index / size) * 50.0 }
        val contours = NativeTerrainOverlayMath.renderContours(ramp, size, 50)
        try {
            assertTrue((0 until size).any { y -> (0 until size).any { x -> Color.alpha(contours.getPixel(x, y)) > 0 } })
        } finally {
            contours.recycle()
        }
    }

    @Test
    fun `contour XYZ pixels invert Web Mercator into the correct WGS84 positions`() {
        val northwest = NativeContourVectorGeometry.tilePixelPosition(1, 1, 0, 0.0, 0.0)
        assertEquals(0.3515625, northwest.longitude.inDegrees, 1e-8)
        assertEquals(85.02070774312594, northwest.latitude.inDegrees, 1e-8)

        val center = NativeContourVectorGeometry.tilePixelPosition(1, 1, 0, 128.0, 128.0)
        assertEquals(90.3515625, center.longitude.inDegrees, 1e-8)
        assertEquals(66.37275500247456, center.latitude.inDegrees, 1e-8)
        assertEquals(0.0, center.altitude, 0.0)

        val z = 12
        val x = 2048
        val y = 1400
        val pixelX = 127.25
        val pixelY = 33.75
        val sampledPosition = NativeContourVectorGeometry.tilePixelPosition(z, x, y, pixelX, pixelY)
        assertEquals(x * 256.0 + pixelX + 0.5,
            (sampledPosition.longitude.inDegrees + 180.0) / 360.0 * (1 shl z) * 256.0, 1e-6)
        assertEquals(y * 256.0 + pixelY + 0.5,
            NativeTerrariumMath.mercatorPixelY(sampledPosition.latitude.inDegrees, z), 1e-6)
    }

    @Test
    fun `SDK northern and southern contour cells request their true XYZ rows through actual render`() {
        for ((x, y) in listOf(20 to 20, 230 to 20, 20 to 230, 230 to 230)) {
            val sampled = java.util.concurrent.ConcurrentLinkedQueue<Triple<Int, Int, Int>>()
            val layer = NativeContourLayer(50, 10) { z, sourceX, sourceY ->
                sampled += Triple(z, sourceX, sourceY)
                DoubleArray(16) { 0.0 }
            }
            try {
                layer.setViewportStyle(12.0, 1f)
                awaitCachedTiles(layer, selectionContext(8, insideTile(8, x, y)), 1)
                assertEquals(listOf(Triple(8, x, y)), sampled.toList())
                val loaded = NativeContourVectorTileBuilder.build(DoubleArray(16) { (it / 4) * 50.0 }, 8, x, y, 50)
                val tile = SlippyTiles.tileToSector(8, x, y)
                assertTrue(loaded.sourcePointCount > 0)
                assertTrue(loaded.geometryBounds.minLatitude.inDegrees > tile.minLatitude.inDegrees)
                assertTrue(loaded.geometryBounds.maxLatitude.inDegrees < tile.maxLatitude.inDegrees)
                assertTrue(loaded.geometryBounds.minLongitude.inDegrees > tile.minLongitude.inDegrees)
                assertTrue(loaded.geometryBounds.maxLongitude.inDegrees < tile.maxLongitude.inDegrees)
            } finally { layer.close() }
        }
    }

    @Test
    fun `two panes lease one identical assembled contour tile and close independently`() {
        val x = 120
        val y = 76
        val samples = DoubleArray(16) { (it / 4) * 50.0 }
        val before = NativeContourSharedGeometryStore.process.snapshot()
        val first = NativeContourLayer(50, 10) { _, _, _ -> samples.copyOf() }
        val second = NativeContourLayer(50, 10) { _, _, _ -> samples.copyOf() }
        val context = selectionContext(8, insideTile(8, x, y))
        try {
            first.setViewportStyle(12.0, 1f)
            second.setViewportStyle(12.0, 1f)
            awaitCachedTiles(first, context, 1)
            val firstContent = cachedContourContent(first)
            awaitCachedTiles(second, context, 1)
            val secondContent = cachedContourContent(second)

            assertSame(firstContent.geometry, secondContent.geometry)
            assertEquals(NativeContourGeometryStore.Snapshot(before.activeGeometryEntries + 1,
                before.activeLeases + 2), NativeContourSharedGeometryStore.process.snapshot())

            // The SDK skips eviction callbacks if a layer never stored a latest RenderContext.
            clearLatestRenderContext(first)
            clearLatestRenderContext(second)
            first.close()
            assertEquals(NativeContourGeometryStore.Snapshot(before.activeGeometryEntries + 1,
                before.activeLeases + 1), NativeContourSharedGeometryStore.process.snapshot())

            second.close()
            assertEquals(before, NativeContourSharedGeometryStore.process.snapshot())
        } finally {
            first.close()
            second.close()
        }
    }

    @Test
    fun `30 meter contours request the SDK center leaf z10 at UI zoom 11 point 9`() {
        val requested = java.util.concurrent.ConcurrentLinkedQueue<Triple<Int, Int, Int>>()
        val layer = NativeContourLayer(30, 11) { z, x, y ->
            requested += Triple(z, x, y)
            DoubleArray(16) { 0.0 }
        }
        val x = SlippyTiles.lonToTileX(102.89, 10)
        val y = SlippyTiles.latToTileY(31.0085, 10)
        val context = selectionContext(10, insideTile(10, x, y))
        try {
            layer.setViewportStyle(11.9, 3.2f)
            awaitCachedTiles(layer, context, 1)
            assertEquals(listOf(Triple(10, x, y)), requested.toList())
        } finally { layer.close() }
    }

    @Test
    fun `30 meter contours below UI zoom 11 hide the entire layer without issuing source requests`() {
        val requested = java.util.concurrent.ConcurrentLinkedQueue<Triple<Int, Int, Int>>()
        val layer = NativeContourLayer(30, 11) { z, x, y ->
            requested += Triple(z, x, y)
            DoubleArray(16) { 0.0 }
        }
        val context = selectionContext(10, insideTile(10, 800, 410))
        try {
            layer.setViewportStyle(10.9, 3.2f)
            repeat(3) { layer.render(context) }
            assertTrue(requested.isEmpty())
            assertEquals(0, layer.pendingTileCount)
            assertEquals(0, layer.loadedTileCount)
        } finally { layer.close() }
    }

    @Test
    fun `contour label CSS size uses bridge scale independently from SDK LOD density`() {
        val label = NativeContourCurvedLabel(
            earth.worldwind.geom.Position.fromDegrees(0.0, 0.0, 0.0),
            doubleArrayOf(0.0, 0.0, 0.01, 0.0), "4350 m", FloatArray(6) { 1f }, 6f,
        )
        label.setCssScale(3.2f)
        assertEquals(3.2f, label.cssScale, 1e-6f)
        assertEquals(1, label.delegateCacheCount)
        label.setCssScale(3.2f)
        assertEquals("same-pane redraw must reuse its curved label delegate", 1, label.delegateCacheCount)
        label.setCssScale(2.0f)
        label.setCssScale(3.2f)
        assertEquals("main/dual pane scales must coexist without per-frame reconstruction", 2, label.delegateCacheCount)
        assertEquals(7.5f, NativeContourVectorGeometry.LABEL_SIZE, 0f)
        assertEquals(0.8f, NativeContourVectorGeometry.LABEL_HALO_WIDTH, 0f)
    }

    @Test
    fun `contour source floor forces refinement to z7 when visible UI permits an ideal z6 leaf`() {
        val requested = java.util.concurrent.ConcurrentLinkedQueue<Triple<Int, Int, Int>>()
        val layer = NativeContourLayer(200, 8) { z, x, y ->
            requested += Triple(z, x, y)
            DoubleArray(16) { 0.0 }
        }
        val context = selectionContext(6, insideTile(7, 100, 52))
        try {
            layer.setViewportStyle(8.0, 1f)
            awaitCachedTiles(layer, context, 1)
            assertEquals(listOf(Triple(7, 100, 52)), requested.toList())
        } finally { layer.close() }
    }

    @Test
    fun `maximum source z13 leaf is observed without creating a z14 request`() {
        val requested = java.util.concurrent.ConcurrentLinkedQueue<Int>()
        val layer = NativeContourLayer(30, 11) { z, _, _ ->
            requested += z
            DoubleArray(16) { 0.0 }
        }
        val x = SlippyTiles.lonToTileX(102.89, NativeContourVectorGeometry.SOURCE_MAX_ZOOM)
        val y = SlippyTiles.latToTileY(31.0085, NativeContourVectorGeometry.SOURCE_MAX_ZOOM)
        val context = selectionContext(NativeContourVectorGeometry.SOURCE_MAX_ZOOM,
            insideTile(NativeContourVectorGeometry.SOURCE_MAX_ZOOM, x, y))
        try {
            layer.setViewportStyle(12.0, 1f)
            assertEquals(NativeContourVectorGeometry.SOURCE_MAX_ZOOM + 2,
                NativeContourVectorGeometry.levelSet().numLevels)
            awaitCachedTiles(layer, context, 1)
            assertEquals(listOf(NativeContourVectorGeometry.SOURCE_MAX_ZOOM), requested.toList())
            val visited = NativeContourLayer::class.java.getDeclaredField("visitedThisFrame")
                .apply { isAccessible = true }.get(layer) as Set<*>
            val visitedLevels = visited.mapNotNull { request -> request?.let { tileRequest ->
                tileRequest.javaClass.getDeclaredField("z").apply { isAccessible = true }.getInt(tileRequest)
            } }
            assertTrue(NativeContourVectorGeometry.SOURCE_MAX_ZOOM in visitedLevels)
        } finally { layer.close() }
    }

    @Test
    fun `actual render drains sixteen source requests through priority admission until every selected tile is cached`() {
        val requested = java.util.concurrent.ConcurrentLinkedQueue<Triple<Int, Int, Int>>()
        val layer = NativeContourLayer(30, 11) { z, x, y ->
            requested += Triple(z, x, y)
            DoubleArray(16) { 0.0 }
        }
        val northwest = SlippyTiles.tileToSector(8, 128, 80)
        val southeast = SlippyTiles.tileToSector(8, 131, 83)
        val region = Sector.fromDegrees(southeast.minLatitude.inDegrees + 1e-7,
            northwest.minLongitude.inDegrees + 1e-7,
            northwest.maxLatitude.inDegrees - southeast.minLatitude.inDegrees - 2e-7,
            southeast.maxLongitude.inDegrees - northwest.minLongitude.inDegrees - 2e-7)
        val context = selectionContext(8, region)
        try {
            layer.setViewportStyle(12.0, 1f)
            awaitCachedTiles(layer, context, 16)
            assertEquals(16, requested.size)
            assertEquals(16, requested.toSet().size)
            assertTrue(requested.all { it.first == 8 && it.second in 128..131 && it.third in 80..83 })
        } finally { layer.close() }
    }

    @Test
    fun `contour quadtree retains cached child sectors and source bounds through its deepest source level`() {
        val levels = NativeContourVectorGeometry.levelSet()
        val factory = NativeContourVectorGeometry.tileFactory
        val roots = mutableListOf<Tile>()
        Tile.assembleTilesForLevel(levels.firstLevel, factory, roots)
        val cache = LruMemoryCache<String, Array<Tile>>(128)
        val latitude = Angle.fromDegrees(31.0085)
        val longitude = Angle.fromDegrees(102.89)
        var tile = roots.single()
        for (z in 1..NativeContourVectorGeometry.SOURCE_MAX_ZOOM) {
            val children = tile.subdivideToCache(factory, cache, 4)
            assertSame(children, tile.subdivideToCache(factory, cache, 4))
            tile = children.single { child -> child.sector.contains(latitude, longitude) }
            assertTrue(tile.sector is MercatorSector)
            assertEquals(z, tile.level.levelNumber)
            assertEquals(SlippyTiles.lonToTileX(longitude.inDegrees, z), tile.column)
            val xyzY = SlippyTiles.latToTileY(latitude.inDegrees, z)
            assertEquals((1 shl z) - 1 - xyzY, tile.row)
            val sourceSector = SlippyTiles.tileToSector(z, tile.column, xyzY)
            assertEquals(sourceSector.minLatitude.inDegrees, tile.sector.minLatitude.inDegrees, 1e-9)
            assertEquals(sourceSector.maxLatitude.inDegrees, tile.sector.maxLatitude.inDegrees, 1e-9)
            assertEquals(sourceSector.minLongitude.inDegrees, tile.sector.minLongitude.inDegrees, 1e-9)
            assertEquals(sourceSector.maxLongitude.inDegrees, tile.sector.maxLongitude.inDegrees, 1e-9)
        }
        assertEquals(NativeContourVectorGeometry.SOURCE_MAX_ZOOM, tile.level.levelNumber)
        assertFalse(tile.level.isLastLevel) // A sentinel level lets the real source leaf be observed.
        assertEquals(NativeContourVectorGeometry.SOURCE_MAX_ZOOM + 1, levels.lastLevel.levelNumber)
    }

    @Test
    fun `contour world roots and descendants cover every legal XYZ cell exactly once without phantom rows`() {
        val levels = NativeContourVectorGeometry.levelSet()
        assertEquals(7, levels.levelOffset)
        val factory = NativeContourVectorGeometry.tileFactory
        var tiles = mutableListOf<Tile>()
        Tile.assembleTilesForLevel(levels.firstLevel, factory, tiles)
        assertEquals(1, tiles.size)
        for (z in 0..4) {
            val side = 1 shl z
            assertEquals(side * side, tiles.size)
            val cells = HashSet<Pair<Int, Int>>()
            for (tile in tiles) {
                assertEquals(z, tile.level.levelNumber)
                assertTrue("illegal SDK row at z=$z: ${tile.row}", tile.row in 0 until side)
                assertTrue("illegal column at z=$z: ${tile.column}", tile.column in 0 until side)
                val sourceY = SlippyTiles.latToTileY(tile.sector.centroidLatitude.inDegrees, z)
                assertEquals(side - 1 - sourceY, tile.row)
                assertTrue("duplicate XYZ cell", cells.add(tile.column to sourceY))
                val source = SlippyTiles.tileToSector(z, tile.column, sourceY)
                assertEquals(source.minLatitude.inDegrees, tile.sector.minLatitude.inDegrees, 1e-9)
                assertEquals(source.maxLatitude.inDegrees, tile.sector.maxLatitude.inDegrees, 1e-9)
                assertEquals(source.minLongitude.inDegrees, tile.sector.minLongitude.inDegrees, 1e-9)
                assertEquals(source.maxLongitude.inDegrees, tile.sector.maxLongitude.inDegrees, 1e-9)
            }
            for (x in 0 until side) for (y in 0 until side) assertTrue(cells.contains(x to y))
            if (z < 4) tiles = tiles.flatMap { it.subdivide(factory).toList() }.toMutableList()
        }
    }

    @Test
    fun `contours batch every stitched vertex with legacy color width and labels without per path objects`() {
        val size = 256
        // Preserve a dense full-width fixture while remaining below the expanded-vertex
        // budget (endpoint padding counts too, so 255 x 256 points would exceed it).
        val values = DoubleArray(size * size) { index -> (index / size) * 40.0 }
        val renderables = NativeContourVectorTileBuilder.build(values, 12, 2048, 1400, 50)
        val batches = renderables.filterIsInstance<MvtBatchedLineTile>()
        val labels = renderables.filterIsInstance<NativeContourCurvedLabel>()
        val originalPaths = NativeTerrainOverlayMath.contourPaths(NativeTerrainOverlayMath.contourSegments(values, size, 50))

        // Every contour level spans one connected horizontal path, rather than
        // creating a separate shape per marching-squares cell edge.
        assertEquals(1, batches.size)
        assertTrue(renderables.none { it is Path })
        assertEquals(originalPaths.size, renderables.sourcePathCount)
        assertEquals(originalPaths.sumOf { it.points.size }, renderables.sourcePointCount)
        @Suppress("UNCHECKED_CAST")
        val features = MvtBatchedLineTile::class.java.getDeclaredField("features").apply { isAccessible = true }
            .get(batches.single()) as List<MvtBatchedLineTile.BatchLineFeature>
        assertTrue(features.any { it.attributes.outlineWidth == NativeContourVectorGeometry.MAJOR_WIDTH })
        assertTrue(features.any { it.attributes.outlineWidth == NativeContourVectorGeometry.MINOR_WIDTH })
        assertTrue(features.all { kotlin.math.abs(it.attributes.outlineColor.alpha - 0.8f) < 1e-6f })
        assertTrue(features.all { it.coords.isEmpty() }) // Pre-assembled coordinates are released, not duplicated.
        assertTrue(renderables.byteWeight >= batches.single().gpuByteEstimate)
        assertTrue(labels.isNotEmpty())
        assertTrue(labels.all { it.text.endsWith(" m") && it.cssScale.isNaN() })
        assertEquals(7.5f, NativeContourVectorGeometry.LABEL_SIZE, 0f)
        assertEquals(0.8f, NativeContourVectorGeometry.LABEL_HALO_WIDTH, 0f)
        assertTrue(labels.all { kotlin.math.abs(it.anchor.latitude.inDegrees) < 90.0 })

        batches.forEach { NativeContourVectorTileBuilder.applyScreenDensity(it, 2f) }
        labels.forEach { it.setCssScale(2f) }
        assertEquals(2f, batches.single().widthScale, 0.0f)
        assertTrue(labels.all { it.cssScale == 2f && it.delegateCacheCount == 1 })
        // Repeated density application is idempotent and does not mutate shared base styles.
        batches.forEach { NativeContourVectorTileBuilder.applyScreenDensity(it, 2f) }
        labels.forEach { it.setCssScale(2f) }
        assertEquals(2f, batches.single().widthScale, 0.0f)
        assertTrue(features.any { it.attributes.outlineWidth == 1.05f })
        assertTrue(features.any { it.attributes.outlineWidth == 0.45f })
        assertTrue(labels.all { it.cssScale == 2f })
    }

    @Test
    fun `contour generation prioritizes center and keeps bounded permits through content admission`() = runBlocking {
        val queue = NativeContourPriorityQueue<String>(capacity = 2, maximumRequests = 4)
        val ranks = mapOf("far" to 100.0, "center" to 0.0, "near" to 4.0)
        val far = async(start = CoroutineStart.UNDISPATCHED) { queue.acquire("far") }
        val center = async(start = CoroutineStart.UNDISPATCHED) { queue.acquire("center") }
        val near = async(start = CoroutineStart.UNDISPATCHED) { queue.acquire("near") }
        val outside = async(start = CoroutineStart.UNDISPATCHED) { queue.acquire("outside") }
        try {
            assertEquals(4, queue.registeredCount)
            assertEquals(null, queue.acquire("overflow"))
            assertEquals(listOf("center", "near"), queue.dispatch { ranks[it] })
            val centerPermit = withTimeout(1_000) { requireNotNull(center.await()) }
            val nearPermit = withTimeout(1_000) { requireNotNull(near.await()) }
            assertEquals(2, queue.activeCount)
            assertFalse(far.isCompleted)
            assertFalse(outside.isCompleted)
            val geometry = NativeContourVectorTileBuilder.build(DoubleArray(16) { 0.0 }, 8, 128, 90, 50)
            val store = NativeContourGeometryStore<NativeContourGeometryKey, NativeContourSharedGeometry>()
            val key = NativeContourGeometryKey.fromSamples(8, 128, 90, 50, DoubleArray(16) { 0.0 })
            val content = NativeContourTileContent(store.acquireOrCreate(key) { geometry }) { centerPermit.close() }
            assertEquals(2, queue.activeCount) // Finished geometry still owns its admission slot.
            content.admitted()
            content.admitted()
            content.discard(null)
            assertEquals(1, queue.activeCount)
            assertEquals(listOf("far"), queue.dispatch { ranks[it] })
            val farPermit = withTimeout(1_000) { requireNotNull(far.await()) }
            assertEquals(2, queue.activeCount)
            assertEquals(3, queue.registeredCount)
            queue.close()
            assertEquals(null, withTimeout(1_000) { outside.await() })
            assertEquals(0, queue.registeredCount)
            nearPermit.close()
            farPermit.close()
            assertEquals(0, queue.activeCount)
        } finally { queue.close() }
    }

    @Test
    fun `canceled contour queue requests release their slot and allow later foreground work`() = runBlocking {
        val queue = NativeContourPriorityQueue<String>(capacity = 1, maximumRequests = 2)
        val canceled = async(start = CoroutineStart.UNDISPATCHED) { queue.acquire("old") }
        try {
            canceled.cancel()
            canceled.join()
            assertEquals(0, queue.registeredCount)
            val next = async(start = CoroutineStart.UNDISPATCHED) { queue.acquire("current") }
            assertEquals(listOf("current"), queue.dispatch { 0.0 })
            withTimeout(1_000) { requireNotNull(next.await()) }.close()
            assertEquals(0, queue.registeredCount)
        } finally { queue.close() }
    }

    @Test
    fun `contour queue prunes only unvisited pending misses before dispatch and leaves active work alone`() = runBlocking {
        val queue = NativeContourPriorityQueue<String>(capacity = 1, maximumRequests = 4)
        val active = async(start = CoroutineStart.UNDISPATCHED) { queue.acquire("active-io") }
        val stale = async(start = CoroutineStart.UNDISPATCHED) { queue.acquire("old-offscreen") }
        val visible = async(start = CoroutineStart.UNDISPATCHED) { queue.acquire("current-visible") }
        val invalidated = mutableListOf<String>()
        try {
            assertEquals(listOf("active-io"), queue.dispatch { 0.0 })
            val activePermit = withTimeout(1_000) { requireNotNull(active.await()) }
            assertEquals(1, queue.activeCount)
            assertEquals(2, queue.pendingCount)

            // A null rank is not permission to do background work. The SDK traversal has only
            // retained current-visible, so remove old-offscreen before ranking/dispatch.
            assertEquals(listOf("old-offscreen"),
                queue.removePendingNotIn(setOf("current-visible"), invalidated::add))
            assertEquals(listOf("old-offscreen"), invalidated)
            assertEquals(null, withTimeout(1_000) { stale.await() })
            assertEquals(1, queue.activeCount) // active IO is neither canceled nor released
            assertEquals(1, queue.pendingCount)
            assertTrue(queue.dispatch { null }.isEmpty()) // Unknown projection rank cannot start work.
            activePermit.close()
            assertTrue(queue.dispatch { null }.isEmpty()) // Null ranks remain pending, even with a free permit.
            assertEquals(listOf("current-visible"), queue.dispatch { 0.0 })
            val visiblePermit = withTimeout(1_000) { requireNotNull(visible.await()) }
            assertEquals(1, queue.activeCount)
            visiblePermit.close()
            assertEquals(0, queue.registeredCount)
        } finally { queue.close() }
    }

    @Test
    fun `camera change prunes queued offscreen work while active loads and cached visible content survive`() = runBlocking {
        val holdNonresidentWork = AtomicBoolean(false)
        val releaseActiveLoads = CompletableDeferred<Unit>()
        val layer = NativeContourLayer(50, 10) { _, _, _ ->
            if (holdNonresidentWork.get()) releaseActiveLoads.await()
            DoubleArray(16) { (it / 4) * 50.0 }
        }
        val visibleX = 120
        val visibleY = 76
        val visibleContext = selectionContext(8, insideTile(8, visibleX, visibleY))
        val priorityQueue = contourQueue(layer)
        try {
            layer.setViewportStyle(12.0, 1f)
            awaitCachedTiles(layer, visibleContext, 1)
            val resident = cachedContourContent(layer)

            holdNonresidentWork.set(true)
            val northwest = SlippyTiles.tileToSector(8, 128, 80)
            val southeast = SlippyTiles.tileToSector(8, 131, 83)
            val region = Sector.fromDegrees(southeast.minLatitude.inDegrees + 1e-7,
                northwest.minLongitude.inDegrees + 1e-7,
                northwest.maxLatitude.inDegrees - southeast.minLatitude.inDegrees - 2e-7,
                southeast.maxLongitude.inDegrees - northwest.minLongitude.inDegrees - 2e-7)
            val offscreenContext = selectionContext(8, region)
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
            do {
                layer.render(offscreenContext)
                if (priorityQueue.activeCount == 2 && priorityQueue.pendingCount > 0) break
                Thread.sleep(10)
            } while (System.nanoTime() < deadline)
            assertEquals(2, priorityQueue.activeCount)
            assertTrue(priorityQueue.pendingCount > 0)

            // Return to the previously loaded tile. Only queued, no-permit misses outside this
            // actual SDK cut should be invalidated; the two active jobs remain untouched.
            layer.render(visibleContext)
            assertEquals(0, priorityQueue.pendingCount)
            assertEquals(2, priorityQueue.activeCount)
            layer.render(visibleContext) // SDK drains invalidations before the next selection.
            assertEquals(2, layer.pendingTileCount) // Only the two active loads remain in the SDK map.
            assertEquals(1, layer.loadedTileCount)
            assertSame(resident, cachedContourContent(layer))
            releaseActiveLoads.complete(Unit)
        } finally { layer.close() }
        Unit
    }

    @Test
    fun `contour label collisions suppress overlap and cap drawing while a new frame resets the budget`() {
        val collision = NativeContourLabelCollision(2)
        collision.beginFrame()
        assertTrue(collision.accept(100f, 100f, 60f, 22f))
        assertFalse(collision.accept(105f, 105f, 60f, 22f))
        assertTrue(collision.accept(200f, 100f, 60f, 22f))
        assertFalse(collision.accept(300f, 100f, 60f, 22f))
        collision.beginFrame()
        assertTrue(collision.accept(100f, 100f, 60f, 22f))
    }

    @Test
    fun `elevation image factory values compare stably for the same overlay tile`() {
        val sampler: suspend (Int, Int, Int) -> DoubleArray? = { _, _, _ -> null }
        val first = TerrainOverlayImageFactory(sampler, "elevation-colors", 0.7, 12, 2, 3)
        val repeated = TerrainOverlayImageFactory(sampler, "elevation-colors", 0.7, 12, 2, 3)
        val changedStyle = TerrainOverlayImageFactory(sampler, "elevation-colors", 0.8, 12, 2, 3)
        assertEquals(first, repeated)
        assertEquals(first.hashCode(), repeated.hashCode())
        assertFalse(first == changedStyle)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `unsupported contour step is rejected explicitly`() {
        NativeTerrainOverlayOptions(contoursEnabled = true, elevationColorsEnabled = false, contourIntervalMeters = 40)
    }

    private fun insideTile(z: Int, x: Int, y: Int): Sector {
        val tile = SlippyTiles.tileToSector(z, x, y)
        val latMargin = tile.deltaLatitude.inDegrees * 1e-5
        val lonMargin = tile.deltaLongitude.inDegrees * 1e-5
        return Sector.fromDegrees(tile.minLatitude.inDegrees + latMargin, tile.minLongitude.inDegrees + lonMargin,
            tile.deltaLatitude.inDegrees - 2 * latMargin, tile.deltaLongitude.inDegrees - 2 * lonMargin)
    }

    private fun cachedContourContent(layer: NativeContourLayer): NativeContourTileContent {
        val field = TiledVectorLayer::class.java.getDeclaredField("liveContent").apply { isAccessible = true }
        val contents = field.get(layer) as Map<*, *>
        return contents.values.single() as NativeContourTileContent
    }

    private fun contourQueue(layer: NativeContourLayer): NativeContourPriorityQueue<*> =
        NativeContourLayer::class.java.getDeclaredField("generationQueue").apply { isAccessible = true }
            .get(layer) as NativeContourPriorityQueue<*>

    private fun clearLatestRenderContext(layer: NativeContourLayer) {
        TiledVectorLayer::class.java.getDeclaredField("latestRc").apply {
            isAccessible = true
            set(layer, null)
        }
    }

    private fun selectionContext(idealSourceZoom: Int, visibleSector: Sector): RenderContext {
        val testGlobe = Globe(projection = EquirectangularProjection())
        return RenderContext().apply {
            globe = testGlobe
            globeState = testGlobe.state
            camera = Camera()
            terrain = object : Terrain {
                override val sector = visibleSector
                override fun intersect(line: Line, result: Vec3) = false
                override fun surfacePoint(latitude: Angle, longitude: Angle, result: Vec3) = false
                override fun heightLimits(levelNumberDepth: Int, result: FloatArray) { result.fill(0f) }
            }
            pixelSize = NativeContourVectorGeometry.levelSet().firstLevel.texelSize * testGlobe.equatorialRadius *
                1.5 / (1 shl idealSourceZoom)
            densityFactor = 1f
            viewport.set(0, 0, 390, 857)
            projection.setToScale(1e-8, 1e-8, 1e-8)
            modelviewProjection.copy(projection)
            frustum.setToModelviewProjection(projection, modelview, viewport)
        }
    }

    private fun awaitCachedTiles(layer: NativeContourLayer, context: RenderContext, count: Int) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
        do {
            layer.render(context)
            if (layer.loadedTileCount == count && layer.pendingTileCount == 0) break
            Thread.sleep(10)
        } while (System.nanoTime() < deadline)
        assertEquals("real SDK render must admit every selected tile", count, layer.loadedTileCount)
        assertEquals(0, layer.pendingTileCount)
    }

    private fun near(actual: Float, expected: Float) = kotlin.math.abs(actual - expected) < 1e-4f
}
