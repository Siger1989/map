package com.guanyun.weather

import android.content.pm.ProviderInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.ExifInterface
import android.net.Uri
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileNotFoundException
import java.security.MessageDigest

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], manifest = Config.NONE)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class PhotoImportCacheTest {
    private val context get() = RuntimeEnvironment.getApplication()

    @Test fun fileUriBecomesBoundedJpegAndProviderKeepsItReadOnlyAndContained() {
        val cache = context.cacheDir
        cache.resolve("photo-import-work").deleteRecursively()
        cache.resolve("photo-imports").deleteRecursively()
        val fixtures = File(context.filesDir, "photo-import-fixtures").apply {
            deleteRecursively()
            mkdirs()
        }
        try {
            // A real 3000x1500 PNG exercises bounds decoding and sampled output under Robolectric's native graphics mode.
            val png = imageBytes(3000, 1500, Bitmap.CompressFormat.PNG)
            val pngSource = File(fixtures, "large.png").apply { writeBytes(png) }
            val sourceHash = sha256(pngSource.readBytes())
            val pngUri = PhotoImportCache.prepare(context, Uri.fromFile(pngSource), "large.png", CancellationSignal())
            assertEquals(sourceHash, sha256(pngSource.readBytes()))
            assertTrue(PhotoShareProvider.importsAvailable(context, arrayOf(pngUri)))

            val provider = provider()
            val pngBytes = read(provider.openFile(pngUri, "r"))
            assertTrue(pngBytes.size > 4)
            assertEquals(0xff, pngBytes[0].toInt() and 0xff)
            assertEquals(0xd8, pngBytes[1].toInt() and 0xff)
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(pngBytes, 0, pngBytes.size, bounds)
            assertTrue("output width=${bounds.outWidth}", bounds.outWidth in 1..2560)
            assertTrue("output height=${bounds.outHeight}", bounds.outHeight in 1..2560)

            // EXIF is read from a real JPEG and copied to the generated JPEG; the source bytes remain untouched.
            val jpegSource = File(fixtures, "metadata.jpg").apply { writeBytes(imageBytes(128, 96, Bitmap.CompressFormat.JPEG)) }
            val expectedDate = "2026:11:07 12:34:56"
            val expectedLatitude = "37/1,48/1,30/1"
            val expectedLongitude = "122/1,24/1,15/1"
            ExifInterface(jpegSource.absolutePath).apply {
                setAttribute(ExifInterface.TAG_DATETIME_ORIGINAL, expectedDate)
                setAttribute(ExifInterface.TAG_GPS_LATITUDE, expectedLatitude)
                setAttribute(ExifInterface.TAG_GPS_LATITUDE_REF, "N")
                setAttribute(ExifInterface.TAG_GPS_LONGITUDE, expectedLongitude)
                setAttribute(ExifInterface.TAG_GPS_LONGITUDE_REF, "W")
                setAttribute("GPSHPositioningError", "4/1")
                setAttribute("GPSMapDatum", "WGS-84")
                saveAttributes()
            }
            val jpegBefore = jpegSource.readBytes()
            val jpegHash = sha256(jpegBefore)
            val jpegUri = PhotoImportCache.prepareGps(context, Uri.fromFile(jpegSource), "metadata.jpg", CancellationSignal())
            assertArrayEquals(jpegBefore, jpegSource.readBytes())
            val jpegTarget = File(cache, "photo-imports/${jpegUri.lastPathSegment}")
            val targetExif = ExifInterface(jpegTarget.absolutePath)
            assertEquals(expectedDate, targetExif.getAttribute(ExifInterface.TAG_DATETIME_ORIGINAL))
            assertEquals(expectedLatitude, targetExif.getAttribute(ExifInterface.TAG_GPS_LATITUDE))
            assertEquals("N", targetExif.getAttribute(ExifInterface.TAG_GPS_LATITUDE_REF))
            assertEquals(expectedLongitude, targetExif.getAttribute(ExifInterface.TAG_GPS_LONGITUDE))
            assertEquals("W", targetExif.getAttribute(ExifInterface.TAG_GPS_LONGITUDE_REF))
            // android.media.ExifInterface does not expose this optional tag on every API.
            assertEquals(ExifInterface(jpegSource.absolutePath).getAttribute("GPSHPositioningError"),
                targetExif.getAttribute("GPSHPositioningError"))
            assertEquals("WGS-84", targetExif.getAttribute("GPSMapDatum"))
            assertEquals(jpegHash, targetExif.getAttribute(ExifInterface.TAG_IMAGE_UNIQUE_ID))
            assertEquals("SHANTU_NATIVE_PHOTO_V1:$jpegHash", targetExif.getAttribute(ExifInterface.TAG_USER_COMMENT))

            assertTrue(read(provider.openFile(jpegUri, "r")).isNotEmpty())
            val writeFailure = runCatching { provider.openFile(jpegUri, "w") }.exceptionOrNull()
            assertTrue(writeFailure is FileNotFoundException)
            val traversal = Uri.parse("content://${context.packageName}.photos/import/../escape.jpg")
            assertTrue(runCatching { provider.openFile(traversal, "r") }.exceptionOrNull() is FileNotFoundException)
            assertFalse(PhotoShareProvider.importsAvailable(context, arrayOf(traversal)))
        } finally {
            fixtures.deleteRecursively()
            cache.resolve("photo-import-work").deleteRecursively()
            cache.resolve("photo-imports").deleteRecursively()
        }
    }

    @Test fun invalidImageAndCanceledRequestAreRejectedWithoutCreatingPreparedFiles() {
        val cache = context.cacheDir
        cache.resolve("photo-import-work").deleteRecursively()
        cache.resolve("photo-imports").deleteRecursively()
        val fixtures = File(context.filesDir, "photo-import-fixtures").apply {
            deleteRecursively()
            mkdirs()
        }
        try {
            val invalid = File(fixtures, "not-an-image.bin").apply { writeText("not an image") }
            val invalidFailure = runCatching {
                PhotoImportCache.prepare(context, Uri.fromFile(invalid), invalid.name, CancellationSignal())
            }.exceptionOrNull()
            assertNotNull("invalid image must fail explicitly", invalidFailure)
            assertTrue(invalidFailure!!.message.orEmpty().contains("无法读取照片尺寸") || invalidFailure.message.orEmpty().contains("无法解码"))
            assertTrue(cache.resolve("photo-imports").listFiles().orEmpty().isEmpty())

            val source = File(fixtures, "cancelled.png").apply { writeBytes(imageBytes(8, 8, Bitmap.CompressFormat.PNG)) }
            val cancel = CancellationSignal().apply { cancel() }
            val cancelFailure = runCatching {
                PhotoImportCache.prepare(context, Uri.fromFile(source), source.name, cancel)
            }.exceptionOrNull()
            assertNotNull("canceled request must fail", cancelFailure)
            assertTrue(cache.resolve("photo-imports").listFiles().orEmpty().isEmpty())
        } finally {
            fixtures.deleteRecursively()
            cache.resolve("photo-import-work").deleteRecursively()
            cache.resolve("photo-imports").deleteRecursively()
        }
    }

    private fun provider() = PhotoShareProvider().apply {
        attachInfo(this@PhotoImportCacheTest.context, ProviderInfo().apply {
            authority = "${this@PhotoImportCacheTest.context.packageName}.photos"
        })
    }

    private fun imageBytes(width: Int, height: Int, format: Bitmap.CompressFormat): ByteArray {
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        return try {
            ByteArrayOutputStream().also { stream ->
                assertTrue(bitmap.compress(format, 92, stream))
            }.toByteArray()
        } finally {
            bitmap.recycle()
        }
    }

    private fun read(descriptor: ParcelFileDescriptor?): ByteArray =
        ParcelFileDescriptor.AutoCloseInputStream(requireNotNull(descriptor)).use { it.readBytes() }

    private fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
        .digest(bytes).joinToString("") { "%02x".format(it) }
}
