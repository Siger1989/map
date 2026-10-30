package com.shantu.nativeapp.map

import android.graphics.Color
import earth.worldwind.geom.AltitudeMode
import earth.worldwind.shape.Label
import earth.worldwind.shape.Path
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
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
        val colors = NativeTerrainOverlayMath.renderElevationColors(values, 2, 50, 0.5)
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
    fun `contours build stitched screen width paths and legacy labels instead of raster strokes`() {
        val size = 256
        val values = DoubleArray(size * size) { index -> (index / size) * 50.0 }
        val renderables = NativeContourVectorTileBuilder.build(values, 12, 2048, 1400, 50)
        val paths = renderables.filterIsInstance<Path>()
        val labels = renderables.filterIsInstance<Label>()

        // Every contour level spans one connected horizontal path, rather than
        // creating a separate shape per marching-squares cell edge.
        assertEquals(size - 1, paths.size)
        assertTrue(paths.all { it.positions.size == size && it.altitudeMode == AltitudeMode.CLAMP_TO_GROUND && it.isFollowTerrain })
        assertTrue(paths.any { it.attributes.outlineWidth == NativeContourVectorGeometry.MAJOR_WIDTH })
        assertTrue(paths.any { it.attributes.outlineWidth == NativeContourVectorGeometry.MINOR_WIDTH })
        assertTrue(paths.all { kotlin.math.abs(it.attributes.outlineColor.alpha - 0.8f) < 1e-6f })
        assertTrue(labels.isNotEmpty())
        assertTrue(labels.all { it.text?.endsWith(" m") == true && it.attributes.scale == 1.0 })
        assertTrue(labels.all { it.attributes.outlineWidth == 2.8f && !it.attributes.isDepthTest })
        assertTrue(labels.all { kotlin.math.abs(it.position.latitude.inDegrees) < 90.0 })

        paths.forEach { NativeContourVectorTileBuilder.applyScreenDensity(it, 2f) }
        labels.forEach { NativeContourVectorTileBuilder.applyScreenDensity(it, 2f) }
        assertTrue(paths.any { it.attributes.outlineWidth == 2.1f })
        assertTrue(paths.any { it.attributes.outlineWidth == 0.9f })
        assertTrue(labels.all { it.attributes.scale == 2.0 })
    }

    @Test
    fun `elevation image factory values compare stably for the same overlay tile`() {
        val sampler: suspend (Int, Int, Int) -> DoubleArray? = { _, _, _ -> null }
        val first = TerrainOverlayImageFactory(sampler, "elevation-colors", 50, 0.7, 12, 2, 3)
        val repeated = TerrainOverlayImageFactory(sampler, "elevation-colors", 50, 0.7, 12, 2, 3)
        val changedStyle = TerrainOverlayImageFactory(sampler, "elevation-colors", 100, 0.7, 12, 2, 3)
        assertEquals(first, repeated)
        assertEquals(first.hashCode(), repeated.hashCode())
        assertFalse(first == changedStyle)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `unsupported contour step is rejected explicitly`() {
        NativeTerrainOverlayOptions(contoursEnabled = true, elevationColorsEnabled = false, contourIntervalMeters = 40)
    }

    private fun near(actual: Float, expected: Float) = kotlin.math.abs(actual - expected) < 1e-4f
}
