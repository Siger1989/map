package com.shantu.nativeapp.floating

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.RectF
import com.shantu.nativeapp.map.NativeTerrainOverlayMath
import kotlin.math.PI
import kotlin.math.atan
import kotlin.math.sinh
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class FloatingContourTerrainTest {
    @Test
    fun `zoom range clamps camera to requested compact range`() {
        assertEquals(600.0, FloatingTerrainProjectionMath.lookRange(14), 1e-9)
        assertEquals(300.0, FloatingTerrainProjectionMath.lookRange(15), 1e-9)
        assertEquals(80.0, FloatingTerrainProjectionMath.lookRange(18), 1e-9)
        assertEquals(80.0, FloatingTerrainProjectionMath.lookRange(99), 1e-9)
    }

    @Test
    fun `72 degree perspective keeps north up and east right then rotates with map bearing`() {
        val bounds = RectF(0f, 0f, 200f, 200f)
        val center = FloatingCoordinate(0.0, 0.0)
        val northUp = FloatingTerrainProjectionMath.camera(center, 100.0, 600.0, 0.0, bounds)
        val north = northUp.project(0.0, 100.0, 100.0)
        val east = northUp.project(100.0, 0.0, 100.0)
        assertNotNull(north); assertNotNull(east)
        assertTrue(north!!.y < bounds.centerY())
        assertTrue(east!!.x > bounds.centerX())

        val eastUp = FloatingTerrainProjectionMath.camera(center, 100.0, 600.0, 90.0, bounds)
        val rotatedNorth = eastUp.project(0.0, 100.0, 100.0)
        assertNotNull(rotatedNorth)
        assertTrue(rotatedNorth!!.x < bounds.centerX())
        assertNotEquals(north.y, rotatedNorth.y, 1e-4)
    }

    @Test
    fun `sample grid is row major north to south and centered within xyz tile`() {
        val northWest = FloatingTerrainProjectionMath.tileSampleCoordinate(14, 8192, 8192, 33, 0, 0)
        val southEast = FloatingTerrainProjectionMath.tileSampleCoordinate(14, 8192, 8192, 33, 32, 32)
        assertTrue(northWest.longitude < southEast.longitude)
        assertTrue(northWest.latitude > southEast.latitude)
        assertTrue(northWest.longitude > -180.0)
        assertTrue(northWest.latitude < 85.0511287798066)
    }

    @Test
    fun `screen z buffer keeps near terrain and rejects route through a nearer ridge`() {
        val bounds = RectF(0f, 0f, 100f, 100f)
        val depth = FloatingTerrainDepthBuffer(100.0, 100.0)
        depth.rasterizeScreenTriangle(bounds,
            FloatingTerrainScreenPoint(0.0, 0.0, 10.0),
            FloatingTerrainScreenPoint(100.0, 0.0, 10.0),
            FloatingTerrainScreenPoint(0.0, 100.0, 10.0),
        )
        depth.rasterizeScreenTriangle(bounds,
            FloatingTerrainScreenPoint(100.0, 0.0, 10.0),
            FloatingTerrainScreenPoint(100.0, 100.0, 10.0),
            FloatingTerrainScreenPoint(0.0, 100.0, 10.0),
        )
        assertFalse(depth.isVisible(50.0, 50.0, 20.0, bounds, 0.5))
        assertTrue(depth.isVisible(50.0, 50.0, 8.0, bounds, 0.5))
    }

    @Test
    fun `subpixel inverse depth sampling keeps a contour on its terrain triangle visible`() {
        val bounds = RectF(0f, 0f, 100f, 100f)
        val depth = FloatingTerrainDepthBuffer(100.0, 100.0)
        val northwest = FloatingTerrainScreenPoint(0.0, 0.0, 110.0)
        val northeast = FloatingTerrainScreenPoint(100.0, 0.0, 10.0)
        val southeast = FloatingTerrainScreenPoint(100.0, 100.0, 10.0)
        val southwest = FloatingTerrainScreenPoint(0.0, 100.0, 110.0)
        depth.rasterizeScreenTriangle(bounds, northwest, northeast, southeast)
        depth.rasterizeScreenTriangle(bounds, northwest, southeast, southwest)

        val surfaceDepth = 1.0 / ((1.0 - 0.504) / 110.0 + 0.504 / 10.0)
        assertTrue(depth.isVisible(50.4, 40.3, surfaceDepth + 0.02, bounds, 0.05))
        assertFalse(FloatingTerrainDepthBuffer(100.0, 100.0).isVisible(50.4, 40.3, surfaceDepth + 0.02, bounds, 0.05))
    }

    @Test
    fun `screen line depth midpoint interpolates in reciprocal depth space`() {
        val midpoint = FloatingTerrainProjectionMath.perspectiveDepthAtScreenFraction(0.5, 10.0, 100.0)
        assertEquals(1.0 / (0.5 / 10.0 + 0.5 / 100.0), midpoint, 1e-9)
        assertEquals(10.0, FloatingTerrainProjectionMath.perspectiveDepthAtScreenFraction(0.0, 10.0, 100.0), 1e-9)
        assertEquals(100.0, FloatingTerrainProjectionMath.perspectiveDepthAtScreenFraction(1.0, 10.0, 100.0), 1e-9)
    }

    @Test
    fun `no data stays a depth hole and contour math does not fill it`() {
        val bounds = RectF(0f, 0f, 100f, 100f)
        val depth = FloatingTerrainDepthBuffer(100.0, 100.0)
        assertFalse(depth.isVisible(50.0, 50.0, 10.0, bounds, 3.0))
        assertTrue(NativeTerrainOverlayMath.contourSegments(DoubleArray(4) { Double.NaN }, 2, 30).isEmpty())
    }

    @Test
    fun `center elevation lookup does not invent a fallback for nodata`() {
        val tile = FloatingTerrainTile(14, 8192, 8192, 2, DoubleArray(4) { Double.NaN })
        val center = FloatingTerrainProjectionMath.tileSampleCoordinate(14, 8192, 8192, 2, 0, 0)
        assertEquals(null, FloatingTerrainHeightSampler(listOf(tile)).sample(center.longitude, center.latitude))
        assertEquals(null, FloatingTerrainHeightSampler(emptyList()).sample(center.longitude, center.latitude))

        val coarse = FloatingTerrainTile(13, 4096, 4096, 2, DoubleArray(4) { 900.0 })
        assertEquals(null, FloatingTerrainHeightSampler(listOf(coarse, tile)).sample(center.longitude, center.latitude))
    }

    @Test
    fun `renderer reports no terrain instead of drawing with a fabricated center height`() {
        val bitmap = Bitmap.createBitmap(160, 160, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val tile = FloatingTerrainTile(14, 8192, 8192, 2, DoubleArray(4) { Double.NaN })
        val center = FloatingTerrainProjectionMath.tileSampleCoordinate(14, 8192, 8192, 2, 0, 0)
        val renderer = FloatingContourTerrainRenderer()
        renderer.draw(canvas, RectF(0f, 0f, 160f, 160f), FloatingTerrainScene(listOf(tile), 1), center,
            14, 0.0, emptyList(), emptyList(), 0xff00ff00.toInt())
        assertFalse(renderer.lastFrameHasTerrain)

        val finite = FloatingTerrainTile(14, 8192, 8192, 2, DoubleArray(4) { 100.0 })
        renderer.draw(canvas, RectF(0f, 0f, 160f, 160f), FloatingTerrainScene(listOf(finite), 2),
            FloatingCoordinate(Double.NaN, Double.NaN), 14, 0.0, emptyList(), emptyList(), 0xff00ff00.toInt())
        assertFalse(renderer.lastFrameHasTerrain)
        bitmap.recycle()
    }

    @Test
    fun `changed scene revision immediately clears a prepared terrain frame when center becomes nodata`() {
        val bitmap = Bitmap.createBitmap(160, 160, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val center = FloatingTerrainProjectionMath.tileSampleCoordinate(14, 8192, 8192, 2, 0, 0)
        val renderer = FloatingContourTerrainRenderer()
        val bounds = RectF(0f, 0f, 160f, 160f)
        val valid = FloatingTerrainTile(14, 8192, 8192, 2, DoubleArray(4) { 100.0 })
        renderer.draw(canvas, bounds, FloatingTerrainScene(listOf(valid), 1), center,
            14, 0.0, emptyList(), emptyList(), 0xff00ff00.toInt())
        assertTrue(renderer.lastFrameHasTerrain)

        val unavailable = FloatingTerrainTile(14, 8192, 8192, 2, DoubleArray(4) { Double.NaN })
        renderer.draw(canvas, bounds, FloatingTerrainScene(listOf(unavailable), 2), center,
            14, 0.0, emptyList(), emptyList(), 0xff00ff00.toInt())
        assertFalse(renderer.lastFrameHasTerrain)
        bitmap.recycle()
    }

    @Test
    fun `center sampled heights interpolate across adjacent tile seam`() {
        val leftHeights = doubleArrayOf(10.0, 10.0, Double.NaN, Double.NaN)
        val rightHeights = doubleArrayOf(30.0, 30.0, Double.NaN, Double.NaN)
        val left = FloatingTerrainTile(14, 8192, 8192, 2, leftHeights)
        val right = FloatingTerrainTile(14, 8193, 8192, 2, rightHeights)
        val north = FloatingTerrainProjectionMath.tileSampleCoordinate(14, 8192, 8192, 2, 1, 0)
        val longitude = ((8192.0 + 1.0) / (1 shl 14)) * 360.0 - 180.0
        assertEquals(20.0, FloatingTerrainHeightSampler(listOf(left, right)).sample(longitude, north.latitude)!!, 1e-8)
    }

    @Test
    fun `four tile junction contributes its center quad and skips missing or nodata corners`() {
        fun tile(x: Int, y: Int, values: DoubleArray) = FloatingTerrainTile(14, x, y, 2, values)
        val northwest = tile(8192, 8192, doubleArrayOf(0.0, 0.0, 0.0, 0.0))
        val northeast = tile(8193, 8192, doubleArrayOf(0.0, 0.0, 60.0, 0.0))
        val southeast = tile(8193, 8193, doubleArrayOf(60.0, 0.0, 0.0, 0.0))
        val southwest = tile(8192, 8193, doubleArrayOf(0.0, 0.0, 0.0, 0.0))
        val cell = FloatingTerrainJunctionMath.cells(listOf(northwest, northeast, southeast, southwest)).single()

        assertEquals(3, cell.northwestIndex)
        assertEquals(2, cell.northeastIndex)
        assertEquals(0, cell.southeastIndex)
        assertEquals(1, cell.southwestIndex)
        assertTrue(NativeTerrainOverlayMath.contourSegments(cell.heightsOrNull()!!, 2, 30).isNotEmpty())

        val noDataNortheast = northeast.copy(heights = doubleArrayOf(0.0, 0.0, Double.NaN, 0.0))
        val noDataCell = FloatingTerrainJunctionMath.cells(listOf(northwest, noDataNortheast, southeast, southwest)).single()
        assertEquals(null, noDataCell.heightsOrNull())
        assertTrue(FloatingTerrainJunctionMath.cells(listOf(northwest, northeast, southwest)).isEmpty())
    }

    @Test
    fun `height lookup refuses interpolation across a nodata hole`() {
        val tile = FloatingTerrainTile(14, 8192, 8192, 2, doubleArrayOf(10.0, Double.NaN, 30.0, 40.0))
        val between = FloatingTerrainProjectionMath.tileSampleCoordinate(14, 8192, 8192, 2, 0, 0)
        val longitude = ((8192.0 + 1.0 / 2.0) / (1 shl 14)) * 360.0 - 180.0
        assertEquals(null, FloatingTerrainHeightSampler(listOf(tile)).sample(longitude, between.latitude))
    }

    @Test
    fun `contours follow the same northwest southeast triangle split as the depth mesh`() {
        val segments = FloatingTerrainMeshMath.contourSegments(doubleArrayOf(0.0, 60.0, 60.0, 0.0), 2, 30)
            .filter { it.elevationMeters == 30 }
        assertEquals(2, segments.size)
        assertEquals(0.5f, segments[0].x1, 1e-6f)
        assertEquals(0f, segments[0].y1, 1e-6f)
        assertEquals(1f, segments[0].x2, 1e-6f)
        assertEquals(0.5f, segments[0].y2, 1e-6f)
        assertEquals(0.5f, segments[1].x1, 1e-6f)
        assertEquals(1f, segments[1].y1, 1e-6f)
        assertEquals(0f, segments[1].x2, 1e-6f)
        assertEquals(0.5f, segments[1].y2, 1e-6f)
        assertTrue(FloatingTerrainMeshMath.contourSegments(doubleArrayOf(0.0, Double.NaN, 0.0, 60.0), 2, 30).isEmpty())
    }

    @Test
    fun `route terrain sampling is linear on the same depth mesh triangles`() {
        val tile = FloatingTerrainTile(14, 8192, 8192, 2, doubleArrayOf(0.0, 10.0, 30.0, 20.0))
        val n = 1 shl 14
        val worldX = (8192.0 + (0.25 + 0.5) / 2.0) / n
        val worldY = (8192.0 + (0.75 + 0.5) / 2.0) / n
        val longitude = worldX * 360.0 - 180.0
        val latitude = Math.toDegrees(atan(sinh(PI * (1.0 - 2.0 * worldY))))
        assertEquals(20.0, FloatingTerrainHeightSampler(listOf(tile)).sample(longitude, latitude)!!, 1e-6)
    }

    @Test
    fun `depth grid and contour far lod stay bounded`() {
        val grid = FloatingTerrainProjectionMath.depthGridSize(1_200.0, 1_800.0)
        assertEquals(200, grid.width)
        assertEquals(200, grid.height)
        assertTrue(grid.width * grid.height <= 40_000)
        assertEquals(FloatingTerrainContourLod.Band.NEAR_MINOR, FloatingTerrainContourLod.band(500.0, 600.0, false))
        assertEquals(FloatingTerrainContourLod.Band.HIDDEN, FloatingTerrainContourLod.band(1_500.0, 600.0, false))
        assertEquals(FloatingTerrainContourLod.Band.MID_MAJOR, FloatingTerrainContourLod.band(1_500.0, 600.0, true))
        assertEquals(FloatingTerrainContourLod.Band.FAR_MAJOR, FloatingTerrainContourLod.band(3_000.0, 600.0, true))
        assertEquals(FloatingTerrainContourLod.Band.HIDDEN, FloatingTerrainContourLod.band(5_000.0, 600.0, true))
    }
}
