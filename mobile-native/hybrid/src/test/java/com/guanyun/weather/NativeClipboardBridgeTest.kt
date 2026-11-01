package com.guanyun.weather

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Bundle
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], manifest = Config.NONE)
class NativeClipboardBridgeTest {
    private class FakeMainActivity : MainActivity() {
        var foreground = true

        override fun trustedForeground(): Boolean = foreground

        // Exercise the bridge without constructing the full WebView/application UI.
        override fun onCreate(savedInstanceState: Bundle?) = Unit
    }

    @Test fun trustedForegroundWritesTheExactCoordinateAndElevationTextToSystemClipboard() {
        val activity = Robolectric.buildActivity(FakeMainActivity::class.java).setup().get()
        try {
            val bridge = NativeBridge(activity, null)
            val text = "-33.868800, 0.000000\n海拔: -0.0 m"

            assertTrue(bridge.clipboardWrite(text))

            val clipboard = activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            val clip = clipboard.primaryClip
            assertEquals(1, clip!!.itemCount)
            assertEquals("山兔", clip.description.label.toString())
            assertEquals(text, clip.getItemAt(0).text.toString())
        } finally {
            activity.finish()
        }
    }

    @Test fun nonForegroundWriteIsRejectedWithoutChangingExistingClipboard() {
        val activity = Robolectric.buildActivity(FakeMainActivity::class.java).setup().get()
        try {
            val clipboard = activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            clipboard.setPrimaryClip(ClipData.newPlainText("existing", "keep this text"))
            activity.foreground = false
            val bridge = NativeBridge(activity, null)

            assertFalse(bridge.clipboardWrite("-12, 0, 0"))

            assertEquals("existing", clipboard.primaryClip!!.description.label.toString())
            assertEquals("keep this text", clipboard.primaryClip!!.getItemAt(0).text.toString())
        } finally {
            activity.finish()
        }
    }

    @Test fun oversizedWriteIsRejectedWithoutChangingExistingClipboard() {
        val activity = Robolectric.buildActivity(FakeMainActivity::class.java).setup().get()
        try {
            val clipboard = activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            clipboard.setPrimaryClip(ClipData.newPlainText("existing", "keep this text"))
            val bridge = NativeBridge(activity, null)
            val oversized = "x".repeat(1024 * 1024 + 1)

            assertFalse(bridge.clipboardWrite(oversized))

            assertEquals("existing", clipboard.primaryClip!!.description.label.toString())
            assertEquals("keep this text", clipboard.primaryClip!!.getItemAt(0).text.toString())
        } finally {
            activity.finish()
        }
    }
}
