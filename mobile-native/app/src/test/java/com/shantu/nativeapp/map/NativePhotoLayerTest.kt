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
import org.junit.Assert.assertSame
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
    @Test fun `photo frame follows shared pin mode sizes at common device scales`() {
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
            val density = NativeMarkerPresentation.densityBucket(cssScale)
            val original = placemark(photoLayer)
            for ((mode, symbolSize) in listOf("label" to 40.0, "icon" to 22.0, "dot" to 9.0)) {
                photoLayer.setMarkerMode(mode)
                val photo = placemark(photoLayer)
                val actualPhotoFrameCss = 56.0 * density * photo.attributes.imageScale / cssScale
                val actualLogoCss = symbolSize * 1.1
                assertEquals("photo follows $mode marker frame at scale $cssScale", actualLogoCss, actualPhotoFrameCss, 0.01)
                assertEquals("logo reference remains $mode symbol size", symbolSize, NativeMarkerPresentation.symbolSize(mode), 0.0)
                assertSame("mode changes preserve the pickable placemark", original, photo)
            }
            photoLayer.setMarkerMode("label")
            val photo = placemark(photoLayer)
            assertEquals(44.0 / 56.0 * cssScale / density, photo.attributes.imageScale, 0.0001)
            assertFalse("screen-sized photo must not shrink again with eye distance", photo.isEyeDistanceScaling)
            assertTrue("photo remains terrain-depth tested", photo.attributes.isDepthTest)
            assertEquals(AltitudeMode.CLAMP_TO_GROUND, photo.altitudeMode)
            assertFalse(photo.isAlwaysOnTop)
            assertEquals("shantu-photo:photo-42", photo.pickDelegate)
            assertEquals("营地照片", photo.displayName)
        }
    }

    @Test fun `zoom mode updates existing placemark scale without rebuilding its photo texture`() {
        val photos = JSONArray().put(JSONObject()
            .put("id", "photo-mode")
            .put("name", "模式照片")
            .put("coordinates", JSONArray().put(104.1).put(30.2))
            .put("previewBase64", jpegFixture()))
        val photoLayer = NativePhotoLayer()
        photoLayer.setCssScale(2.8)
        photoLayer.replace(photos)
        val pin = placemark(photoLayer)
        val source = pin.attributes.imageSource
        assertTrue(photoLayer.setMarkerMode("dot"))
        for ((mode, frameCss) in listOf("label" to 44.0, "icon" to 24.2, "dot" to 9.9)) {
            assertTrue(photoLayer.setMarkerMode(mode))
            val current = placemark(photoLayer)
            assertSame("mode updates the same pickable placemark", pin, current)
            assertSame("mode does not rebuild the decoded photo texture", source, current.attributes.imageSource)
            val density = NativeMarkerPresentation.densityBucket(2.8)
            assertEquals(frameCss, 56.0 * density * current.attributes.imageScale / 2.8, 0.01)
            assertEquals("shantu-photo:photo-mode", current.pickDelegate)
            assertEquals("模式照片", current.displayName)
            assertTrue(current.attributes.isDepthTest)
        }
        assertFalse("setting the resolved mode again is a no-op", photoLayer.setMarkerMode("dot"))
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
        assertEquals(44.0, 56.0 * NativeMarkerPresentation.densityBucket(2.8) * updated.attributes.imageScale / 2.8, 0.0001)
        assertFalse("same CSS scale does not discard or rebuild photo info", photoLayer.setCssScale(2.8))
        assertEquals(1, photoLayer.layer.count)
    }

    @Test fun `ordinary pin and photo placemarks use the same eye distance scaling policy`() {
        val marker = NativeModelRenderer.render(JSONObject()
            .put("id", "ordinary-pin")
            .put("kind", "pin")
            .put("coordinates", JSONArray().put(104.1).put(30.2))
            .put("name", "普通标记")
            .put("icon", "pin")
            .put("color", "#176b68")).renderables.single() as Placemark
        val photoLayer = NativePhotoLayer()
        photoLayer.replace(JSONArray().put(JSONObject()
            .put("id", "photo-eye")
            .put("name", "照片")
            .put("coordinates", JSONArray().put(104.1).put(30.2))
            .put("previewBase64", jpegFixture())))
        assertEquals("photo screen scaling must match the ordinary map pin policy", marker.isEyeDistanceScaling, placemark(photoLayer).isEyeDistanceScaling)
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
