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
    @Test fun `photo frame follows requested mode at common device scales`() {
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
            for ((mode, frameCss) in listOf("label" to 32.0, "icon" to 24.2, "dot" to 9.9)) {
                photoLayer.setMarkerMode(mode, 16.0)
                val photo = placemark(photoLayer)
                val actualPhotoFrameCss = 56.0 * density * photo.attributes.imageScale / cssScale
                assertEquals("photo follows $mode frame at scale $cssScale", frameCss, actualPhotoFrameCss, 0.01)
                assertSame("mode changes preserve the pickable placemark", original, photo)
            }
            photoLayer.setMarkerMode("label")
            val photo = placemark(photoLayer)
            assertEquals(32.0 * cssScale / (56.0 * density), photo.attributes.imageScale, 0.0001)
            assertFalse("screen-sized photo must not shrink again with eye distance", photo.isEyeDistanceScaling)
            assertTrue("photo remains terrain-depth tested", photo.attributes.isDepthTest)
            assertEquals(AltitudeMode.CLAMP_TO_GROUND, photo.altitudeMode)
            assertFalse(photo.isAlwaysOnTop)
            assertEquals("shantu-photo:photo-42", photo.pickDelegate)
            assertEquals("营地照片", photo.displayName)
        }
    }

    @Test fun `every zoom updates photo scale in place and preserves the texture source`() {
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
        for ((zoom, zoomScale) in listOf(4.0 to 0.35, 8.0 to 0.5666666666666667, 16.0 to 1.0)) {
            assertTrue(photoLayer.setMarkerMode("label", zoom))
            val current = placemark(photoLayer)
            assertSame("mode updates the same pickable placemark", pin, current)
            assertSame("mode does not rebuild the decoded photo texture", source, current.attributes.imageSource)
            val density = NativeMarkerPresentation.densityBucket(2.8)
            assertEquals(32.0 * zoomScale, 56.0 * density * current.attributes.imageScale / 2.8, 0.01)
            assertEquals("shantu-photo:photo-mode", current.pickDelegate)
            assertEquals("模式照片", current.displayName)
            assertTrue(current.attributes.isDepthTest)
        }
        assertFalse("same zoom and resolved mode are a no-op", photoLayer.setMarkerMode("label", 16.0))
    }

    @Test fun `replace incrementally preserves retained photos and removes only deleted ids`() {
        val photoLayer = NativePhotoLayer()
        val a = JSONObject().put("id", "photo-a").put("name", "A")
            .put("coordinates", JSONArray().put(104.1).put(30.2)).put("previewBase64", jpegFixture())
        val b = JSONObject().put("id", "photo-b").put("name", "B")
            .put("coordinates", JSONArray().put(105.1).put(31.2)).put("previewBase64", jpegFixture())
        photoLayer.replace(JSONArray().put(a).put(b))
        val firstA = photoLayer.layer.getRenderable(0)
        val firstB = photoLayer.layer.getRenderable(1)
        val sourceA = (firstA as Placemark).attributes.imageSource

        photoLayer.replace(JSONArray().put(a).put(b))
        assertSame("unchanged source photo keeps placemark identity", firstA, photoLayer.layer.getRenderable(0))
        assertSame("unchanged source photo keeps its image source", sourceA, (firstA as Placemark).attributes.imageSource)

        photoLayer.replace(JSONArray().put(b).put(a))
        assertEquals(2, photoLayer.layer.count)
        assertSame("reordering preserves the second photo object", firstB, photoLayer.layer.getRenderable(0))
        assertSame("reordering preserves the first photo object", firstA, photoLayer.layer.getRenderable(1))

        photoLayer.replace(JSONArray().put(a))
        assertEquals(1, photoLayer.layer.count)
        assertSame("remaining ID keeps its existing pickable", firstA, photoLayer.layer.getRenderable(0))
    }

    @Test fun `image changes keep old source as fallback until replacement is ready`() {
        val photoLayer = NativePhotoLayer()
        val before = JSONObject().put("id", "photo-update").put("name", "old")
            .put("coordinates", JSONArray().put(104.1).put(30.2)).put("previewBase64", jpegFixture())
        photoLayer.replace(JSONArray().put(before))
        val placemark = placemark(photoLayer) as NativePhotoPlacemark
        val oldSource = placemark.attributes.imageSource

        val after = JSONObject(before.toString()).put("name", "new").put("previewBase64", jpegFixture(Color.BLUE))
        photoLayer.replace(JSONArray().put(after))

        assertSame("same ID retains the pickable object", placemark, photoLayer.layer.getRenderable(0))
        assertSame("pending update retains the previously displayed source", oldSource, placemark.fallbackImageSourceForTest())
        assertEquals("new metadata is applied immediately", "new", placemark.displayName)
        assertTrue(placemark.attributes.isDepthTest)
        assertFalse(placemark.isAlwaysOnTop)

        val displayedFallback = placemark.selectActiveAttributesForTest(currentTextureReady = false, fallbackTextureReady = true)
        assertSame("ready old texture selects fallback attributes while new texture loads", oldSource, displayedFallback.imageSource)
        val displayedReplacement = placemark.selectActiveAttributesForTest(currentTextureReady = true, fallbackTextureReady = true)
        assertSame("ready replacement selects current attributes", placemark.attributes, displayedReplacement)
        assertEquals("fallback is released after replacement readiness", null, placemark.fallbackImageSourceForTest())
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

    @Test fun `css scale keeps the pick and only changes source when density bucket changes`() {
        val photos = JSONArray().put(JSONObject()
            .put("id", "photo-stable")
            .put("name", "稳定照片")
            .put("coordinates", JSONArray().put(104.1).put(30.2))
            .put("previewBase64", jpegFixture()))
        val photoLayer = NativePhotoLayer()
        photoLayer.setCssScale(2.8)
        photoLayer.replace(photos)
        val first = placemark(photoLayer)
        val firstImage = first.attributes.imageSource

        assertTrue(photoLayer.setCssScale(2.9))
        val updated = placemark(photoLayer)
        assertSame("same density bucket does not replace photo source", firstImage, updated.attributes.imageSource)
        assertEquals("photo-stable", updated.pickDelegate.toString().removePrefix("shantu-photo:"))
        assertEquals("稳定照片", updated.displayName)
        assertEquals(AltitudeMode.CLAMP_TO_GROUND, updated.altitudeMode)
        assertFalse(updated.isEyeDistanceScaling)
        assertTrue(updated.attributes.isDepthTest)
        assertEquals(32.0, 56.0 * NativeMarkerPresentation.densityBucket(2.9) * updated.attributes.imageScale / 2.9, 0.0001)
        assertFalse("same CSS scale does not discard or rebuild photo info", photoLayer.setCssScale(2.9))
        val oldSource = updated.attributes.imageSource
        photoLayer.setCssScale(3.6)
        assertSame("density re-render preserves the same pick", updated, placemark(photoLayer))
        assertSame("density update keeps old source as a loading fallback", oldSource, updated.fallbackImageSourceForTest())
        val oldDensity = NativeMarkerPresentation.densityBucket(2.9)
        val newDensity = NativeMarkerPresentation.densityBucket(3.6)
        assertEquals("old bitmap keeps the same CSS frame while replacement loads", 32.0,
            56.0 * oldDensity * updated.fallbackImageScaleForTest()!! / 3.6, 0.0001)
        assertEquals("new bitmap keeps the requested CSS frame", 32.0,
            56.0 * newDensity * updated.attributes.imageScale / 3.6, 0.0001)
        photoLayer.setMarkerMode("label", 4.0)
        assertEquals("old density fallback follows the same zoom curve", 11.2,
            56.0 * oldDensity * updated.fallbackImageScaleForTest()!! / 3.6, 0.0001)
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

    private fun placemark(photoLayer: NativePhotoLayer): NativePhotoPlacemark {
        assertEquals(1, photoLayer.layer.count)
        return photoLayer.layer.getRenderable(0) as NativePhotoPlacemark
    }

    private fun jpegFixture(color: Int = Color.RED): String {
        val source = Bitmap.createBitmap(128, 128, Bitmap.Config.ARGB_8888)
        try {
            Canvas(source).apply {
                drawColor(color)
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
