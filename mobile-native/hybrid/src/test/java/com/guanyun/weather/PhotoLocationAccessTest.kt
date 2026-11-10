package com.guanyun.weather

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.CancellationSignal
import android.provider.MediaStore
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [30], manifest = Config.NONE)
class PhotoLocationAccessTest {
    @Test fun runtimePermissionIsScopedToGpsPickerOnAndroid29AndAbove() {
        assertTrue(PhotoLocationAccess.needsPickerPermission(29, true))
        assertTrue(PhotoLocationAccess.needsPickerPermission(35, true))
        assertFalse(PhotoLocationAccess.needsPickerPermission(29, false))
        assertFalse(PhotoLocationAccess.needsPickerPermission(28, true))
        assertTrue(PhotoLocationAccess.hasAcceptType(arrayOf("image/*, application/x-shantu-gps-photo"), PhotoLocationAccess.GPS_PHOTO_ACCEPT))
        assertTrue(PhotoLocationAccess.hasAcceptType(arrayOf("application/x-guanyun-photo-folder, application/x-shantu-gps-photo"), "application/x-guanyun-photo-folder"))
        assertFalse(PhotoLocationAccess.hasAcceptType(arrayOf("image/*"), PhotoLocationAccess.GPS_PHOTO_ACCEPT))
    }

    @Test fun fileAndOrdinarySafUrisAreNeverRewritten() {
        val context = RuntimeEnvironment.getApplication()
        val file = Uri.fromFile(context.filesDir.resolve("selected.jpg"))
        val document = Uri.parse("content://com.example.documents/document/photo%3A9")
        assertEquals(file, PhotoLocationAccess.requireOriginalUri(context, file))
        assertEquals(document, PhotoLocationAccess.requireOriginalUri(context, document))
    }

    @Test fun mediaStoreUriRequiresConsentAndUsesRequireOriginalOnlyAfterGrant() {
        val context = RuntimeEnvironment.getApplication()
        val media = Uri.parse("content://media/external/images/media/42")
        val denied = runCatching { PhotoLocationAccess.requireOriginalUri(context, media) }.exceptionOrNull()
        assertTrue(denied is PhotoLocationAccess.AccessException)
        assertEquals(PhotoLocationAccess.PERMISSION_DENIED, (denied as PhotoLocationAccess.AccessException).reason)

        shadowOf(context).grantPermissions(Manifest.permission.ACCESS_MEDIA_LOCATION)
        val original = PhotoLocationAccess.requireOriginalUri(context, media)
        assertTrue(MediaStore.getRequireOriginal(original))
        assertEquals(media.path, original.path)
    }

    @Test fun deniedGpsPickerReturnsNullAndCloseCancelsLatePermissionCallback() {
        val controller = Robolectric.buildActivity(Activity::class.java).setup()
        val activity = controller.get()
        val appFiles = AppFiles(activity)
        var callbackCount = 0
        var callbackValue: Array<Uri>? = null
        val callback = ValueCallback<Array<Uri>> { value -> callbackCount++; callbackValue = value }
        assertTrue(appFiles.choose(callback, Params(arrayOf("image/*, application/x-shantu-gps-photo"))))
        assertArrayEquals(arrayOf(Manifest.permission.ACCESS_MEDIA_LOCATION), shadowOf(activity).lastRequestedPermission.requestedPermissions)
        val permissionRequestIntent = shadowOf(activity).nextStartedActivity
        assertNotNull(permissionRequestIntent)
        assertFalse(permissionRequestIntent.action == Intent.ACTION_OPEN_DOCUMENT)

        appFiles.photoLocationPermissionResult(PhotoLocationAccess.REQUEST, arrayOf(Manifest.permission.ACCESS_MEDIA_LOCATION), intArrayOf(-1))
        assertEquals(1, callbackCount)
        assertNull(callbackValue)
        assertNull(shadowOf(activity).nextStartedActivity)
        controller.destroy()

        // A manual permission callback does not dismiss Robolectric's framework dialog.
        // Use a fresh Activity to test cancellation independently of that dialog's lifecycle.
        val lateController = Robolectric.buildActivity(Activity::class.java).setup()
        val lateActivity = lateController.get()
        val lateFiles = AppFiles(lateActivity)
        callbackCount = 0
        lateFiles.choose(callback, Params(arrayOf("image/*, application/x-shantu-gps-photo")))
        assertArrayEquals(arrayOf(Manifest.permission.ACCESS_MEDIA_LOCATION), shadowOf(lateActivity).lastRequestedPermission.requestedPermissions)
        val secondPermissionRequestIntent = shadowOf(lateActivity).nextStartedActivity
        assertNotNull(secondPermissionRequestIntent)
        assertFalse(secondPermissionRequestIntent.action == Intent.ACTION_OPEN_DOCUMENT)
        lateFiles.close()
        shadowOf(lateActivity).grantPermissions(Manifest.permission.ACCESS_MEDIA_LOCATION)
        lateFiles.photoLocationPermissionResult(PhotoLocationAccess.REQUEST, arrayOf(Manifest.permission.ACCESS_MEDIA_LOCATION), intArrayOf(0))
        assertEquals(1, callbackCount)
        assertNull(shadowOf(lateActivity).nextStartedActivity)
        lateController.destroy()
    }

    @Test fun grantedPermissionCallbackStartsOnlyThePendingGpsPicker() {
        val controller = Robolectric.buildActivity(Activity::class.java).setup()
        val activity = controller.get()
        val appFiles = AppFiles(activity)
        val callback = ValueCallback<Array<Uri>> { }
        appFiles.choose(callback, Params(arrayOf("image/*, application/x-shantu-gps-photo")))
        shadowOf(activity).grantPermissions(Manifest.permission.ACCESS_MEDIA_LOCATION)
        appFiles.photoLocationPermissionResult(PhotoLocationAccess.REQUEST, arrayOf(Manifest.permission.ACCESS_MEDIA_LOCATION), intArrayOf(0))
        assertEquals(Intent.ACTION_OPEN_DOCUMENT, shadowOf(activity).nextStartedActivity.action)
        appFiles.close()
        controller.destroy()
    }

    @Test fun ordinaryPhotoAndFolderSelectorsDoNotRequestLocationPermission() {
        val controller = Robolectric.buildActivity(Activity::class.java).setup()
        val activity = controller.get()
        val appFiles = AppFiles(activity)
        appFiles.choose(ValueCallback<Array<Uri>> { }, Params(arrayOf("image/*")))
        assertEquals(Intent.ACTION_OPEN_DOCUMENT, shadowOf(activity).nextStartedActivity.action)
        appFiles.close()

        appFiles.choose(ValueCallback<Array<Uri>> { }, Params(arrayOf("application/x-guanyun-photo-folder")))
        assertEquals(Intent.ACTION_OPEN_DOCUMENT_TREE, shadowOf(activity).nextStartedActivity.action)
        appFiles.close()
        controller.destroy()
    }

    @Test fun lateCanceledBatchDoesNotClearNewGpsPickerState() {
        val controller = Robolectric.buildActivity(Activity::class.java).setup()
        val activity = controller.get()
        val appFiles = AppFiles(activity)
        val oldCallback = ValueCallback<Array<Uri>> { }
        val newCallback = ValueCallback<Array<Uri>> { }
        appFiles.choose(oldCallback, Params(arrayOf("image/*, application/x-shantu-gps-photo")))
        appFiles.choose(newCallback, Params(arrayOf("image/*, application/x-shantu-gps-photo")))

        val oldCancel = CancellationSignal().apply { cancel() }
        appFiles.finishPhotoSelection(oldCallback, oldCancel, null, "old cancelled batch")
        val gpsFlag = AppFiles::class.java.getDeclaredField("gpsPhotoImport").apply { isAccessible = true }
        val preparingFlag = AppFiles::class.java.getDeclaredField("preparingPhotos").apply { isAccessible = true }
        assertTrue(gpsFlag.getBoolean(appFiles))
        assertTrue(preparingFlag.getBoolean(appFiles))

        shadowOf(activity).grantPermissions(Manifest.permission.ACCESS_MEDIA_LOCATION)
        appFiles.photoLocationPermissionResult(PhotoLocationAccess.REQUEST, arrayOf(Manifest.permission.ACCESS_MEDIA_LOCATION), intArrayOf(0))
        assertEquals(Intent.ACTION_OPEN_DOCUMENT, shadowOf(activity).nextStartedActivity.action)
        appFiles.close()
        controller.destroy()
    }

    private class Params(private val accepted: Array<String>) : WebChromeClient.FileChooserParams() {
        override fun getMode() = 0
        override fun getAcceptTypes() = accepted
        override fun isCaptureEnabled() = false
        override fun getFilenameHint(): String? = null
        override fun getTitle(): CharSequence? = null
        override fun createIntent() = Intent(Intent.ACTION_OPEN_DOCUMENT)
    }
}
