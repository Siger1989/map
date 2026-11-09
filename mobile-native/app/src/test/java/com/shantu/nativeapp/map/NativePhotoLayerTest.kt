package com.shantu.nativeapp.map

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import earth.worldwind.geom.AltitudeMode
import earth.worldwind.shape.Placemark
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.ByteArrayOutputStream
import java.util.Base64

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class NativePhotoLayerTest {
    @Test fun `photo placemark stays a 56 CSS pixel photo above the 40 CSS pixel logo at common device scales`() {
        val encoded = jpegFixture()
        val photoLayer = NativePhotoLayer()
        val photos = JSONArray().put(JSONObject()
            .put("id", "photo-42")
            .put("name", "营地照片")
            .put("coordinates", JSONArray().put(104.1).put(30.2))
            .put("previewBase64", encoded)
            .put("visible", true))

        for (cssScale in listOf(1.0, 2.8, 3.22)) {
            photoLayer.setCssScale(cssScale)
            photoLayer.replace(photos)
            val placemark = placemark(photoLayer)
            val density = NativeMarkerPresentation.densityBucket(cssScale)
            val actualPhotoFrameCss = 56.0 * density * placemark.attributes.imageScale / cssScale
            val actualLogoCss = 64.0 * density * NativeMarkerPresentation.imageScale(12.0, cssScale, density, "label") / cssScale

            assertEquals("photo frame must stay at 56 CSS px for scale $cssScale", 56.0, actualPhotoFrameCss, 0.01)
            assertEquals("marker logo reference stays at 40 CSS px for scale $cssScale", 40.0, actualLogoCss, 0.01)
            assertTrue("photo preview remains larger than its map logo", actualPhotoFrameCss > actualLogoCss)
            assertEquals(cssScale / density, placemark.attributes.imageScale, 0.0001)
            assertFalse("screen-sized photo must not shrink again with eye distance", placemark.isEyeDistanceScaling)
            assertTrue("photo remains terrain-depth tested", placemark.attributes.isDepthTest)
            assertEquals(AltitudeMode.CLAMP_TO_GROUND, placemark.altitudeMode)
            assertFalse(placemark.isAlwaysOnTop)
            assertEquals("shantu-photo:photo-42", placemark.pickDelegate)
            assertEquals("营地照片", placemark.displayName)
        }
    }

    @Test fun `density buckets create real high resolution bitmaps with a 56 pixel frame and 52 pixel photo crop`() = runBlocking {
        val encoded = jpegFixture()
        for (cssScale in listOf(1.0, 2.8, 3.22)) {
            val density = NativeMarkerPresentation.densityBucket(cssScale)
            val bitmap = assertNotNullBitmap(PhotoImageFactory(encoded, density = density).createBitmap())
            try {
                assertEquals(64 * density, bitmap.width)
                assertEquals(64 * density, bitmap.height)
                assertEquals(56 * density, nonTransparentBounds(bitmap).width())
                assertEquals(56 * density, nonTransparentBounds(bitmap).height())
                val photoPixel = bitmap.getPixel(20 * density, 20 * density)
                assertTrue("bitmap retains actual photo detail in its crop", kotlin.math.abs(Color.red(photoPixel) - 255) <= 30)
                assertTrue(Color.red(photoPixel) > Color.green(photoPixel) * 2)
                assertEquals(Color.TRANSPARENT, bitmap.getPixel(0, 0))
            } finally {
                bitmap.recycle()
            }
        }
    }

    @Test fun `group count and annotation badges are drawn in the generated photo bitmap`() = runBlocking {
        val encoded = jpegFixture()
        val density = NativeMarkerPresentation.densityBucket(3.22)
        val grouped = assertNotNullBitmap(PhotoImageFactory(encoded, count = 3, density = density).createBitmap())
        val annotated = assertNotNullBitmap(PhotoImageFactory(encoded, mapIcon = "star", mapColor = "#d03030", density = density).createBitmap())
        try {
            val countBadge = grouped.getPixel(58 * density, 12 * density)
            assertTrue("group badge background is painted", Color.red(countBadge) < 80 && Color.green(countBadge) < 110 && Color.blue(countBadge) < 120)
            val annotationBadge = annotated.getPixel(62 * density, 58 * density)
            assertTrue("annotation logo badge is white and visible", Color.red(annotationBadge) > 220 && Color.green(annotationBadge) > 220 && Color.blue(annotationBadge) > 220)
        } finally {
            grouped.recycle()
            annotated.recycle()
        }
    }

    @Test fun `css scale rebuild keeps the same photo pick and terrain metadata`() {
        val photos = JSONArray().put(JSONObject()
            .put("id", "photo-stable")
            .put("name", "稳定照片")
            .put("coordinates", JSONArray().put(104.1).put(30.2))
            .put("previewBase64", jpegFixture()))
        val photoLayer = NativePhotoLayer()
        photoLayer.replace(photos)
        val first = placemark(photoLayer)
        val firstImage = first.attributes.imageSource

        assertTrue(photoLayer.setCssScale(2.8))
        val updated = placemark(photoLayer)
        assertNotSame(firstImage, updated.attributes.imageSource)
        assertEquals("photo-stable", updated.pickDelegate.toString().removePrefix("shantu-photo:"))
        assertEquals("稳定照片", updated.displayName)
        assertEquals(AltitudeMode.CLAMP_TO_GROUND, updated.altitudeMode)
        assertFalse(updated.isEyeDistanceScaling)
        assertTrue(updated.attributes.isDepthTest)
        assertEquals(2.8 / NativeMarkerPresentation.densityBucket(2.8), updated.attributes.imageScale, 0.0001)
        assertFalse("same CSS scale does not discard or rebuild photo info", photoLayer.setCssScale(2.8))
        assertEquals(1, photoLayer.layer.count)
    }

    private fun placemark(photoLayer: NativePhotoLayer): Placemark {
        assertEquals(1, photoLayer.layer.count)
        return photoLayer.layer.getRenderable(0) as Placemark
    }

    private fun jpegFixture(): String {
        val source = Bitmap.createBitmap(128, 128, Bitmap.Config.ARGB_8888)
        try {
            Canvas(source).apply {
                drawColor(Color.RED)
                val paint = Paint()
                paint.color = Color.GREEN
                drawRect(RectF(64f, 0f, 128f, 64f), paint)
                paint.color = Color.BLUE
                drawRect(RectF(0f, 64f, 64f, 128f), paint)
                paint.color = Color.YELLOW
                drawRect(RectF(64f, 64f, 128f, 128f), paint)
            }
            val output = ByteArrayOutputStream()
            assertTrue(source.compress(Bitmap.CompressFormat.JPEG, 100, output))
            return Base64.getEncoder().encodeToString(output.toByteArray())
        } finally {
            source.recycle()
        }
    }

    private fun assertNotNullBitmap(bitmap: Bitmap?): Bitmap {
        assertNotNull(bitmap)
        return bitmap!!
    }

    private fun nonTransparentBounds(bitmap: Bitmap): Rect {
        val bounds = Rect(bitmap.width, bitmap.height, -1, -1)
        for (y in 0 until bitmap.height) for (x in 0 until bitmap.width) {
            if (Color.alpha(bitmap.getPixel(x, y)) > 0) {
                if (x < bounds.left) bounds.left = x
                if (y < bounds.top) bounds.top = y
                if (x > bounds.right) bounds.right = x
                if (y > bounds.bottom) bounds.bottom = y
            }
        }
        if (bounds.right >= bounds.left) bounds.right++
        if (bounds.bottom >= bounds.top) bounds.bottom++
        return bounds
    }
}
