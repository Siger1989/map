package com.shantu.nativeapp.ui

import android.app.Activity
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.TextView
import com.shantu.nativeapp.section.NativeSectionSnapshot
import kotlinx.coroutines.CompletableDeferred
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.RuntimeEnvironment
import org.robolectric.Robolectric
import org.robolectric.Shadows.shadowOf
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NativeSectionPanelTest {
    @Test fun `saved ordinary section can be reopened for editing without dropping extension fields`() {
        val context = RuntimeEnvironment.getApplication()
        val chrome = HomeChrome(context) { }
        val savedSettings = settings().put("extension", JSONObject().put("kept", true))
        val section = JSONObject().put("id", "section-1").put("name", "河谷剖面")
            .put("settings", savedSettings).put("customMetadata", "preserve")
        var committed = false
        val panel = NativeSectionPanel(
            context, chrome, JSONArray().put(section), JSONArray(), settings(),
            sample = { value -> NativeSectionSnapshot(value, emptyList(), 1L, 0, 0, 0.0, 0, 0, "partial", emptySet()) },
            onCommit = { _, _ -> committed = true }, onShowSurface = { _, _ -> }, onExport = { _, _ -> }, onClose = {},
        )
        panel.open()
        assertEquals("native-section", chrome.currentPanel())
        val reopen = findText(chrome, "河谷剖面 · 重开") ?: throw AssertionError("saved section row is missing")
        reopen.performClick()
        assertEquals("native-section-edit", chrome.currentPanel())
        val apply = findText(chrome, "应用参数并显示三维剖面") ?: throw AssertionError("parameter editor was not opened")
        assertTrue(apply.isClickable)
        assertTrue(!committed)
    }

    @Test fun `unknown initial terrain altitude stays blank for explicit input`() {
        val context = RuntimeEnvironment.getApplication()
        val chrome = HomeChrome(context) { }
        val panel = NativeSectionPanel(
            context, chrome, JSONArray(), JSONArray(), settings().also { it.remove("altitude") },
            sample = { value -> NativeSectionSnapshot(value, emptyList(), 1L, 0, 0, 0.0, 0, 0, "partial", emptySet()) },
            onCommit = { _, _ -> }, onShowSurface = { _, _ -> }, onExport = { _, _ -> }, onClose = {},
        )
        panel.open()
        findText(chrome, "新建当前视域剖面")!!.performClick()
        val altitude = findInput(chrome, "剖面高度（米）") ?: throw AssertionError("altitude input is missing")
        assertEquals("", altitude.text.toString())
        panel.dispose()
    }

    @Test fun `closing chrome cancels pending sample and does not reopen profile`() {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        val context = activity
        val chrome = HomeChrome(context) { }
        activity.setContentView(chrome)
        val started = CountDownLatch(1)
        val finished = CountDownLatch(1)
        val pending = CompletableDeferred<NativeSectionSnapshot>()
        var closeCount = 0
        val panel = NativeSectionPanel(
            context, chrome, JSONArray(), JSONArray(), settings(),
            sample = {
                started.countDown()
                try { pending.await() } finally { finished.countDown() }
            },
            onCommit = { _, _ -> }, onShowSurface = { _, _ -> }, onExport = { _, _ -> }, onClose = { closeCount++ },
        )
        panel.open()
        findText(chrome, "新建当前视域剖面")!!.performClick()
        findText(chrome, "应用参数并显示三维剖面")!!.performClick()
        assertTrue("sampling did not start", started.await(2, TimeUnit.SECONDS))

        chrome.closePanel() // Same path used by Android Back and other host-driven panel closes.
        shadowOf(android.os.Looper.getMainLooper()).idle()
        pending.complete(NativeSectionSnapshot(settings(), emptyList(), 1L, 0, 0, 0.0, 0, 0, "partial", emptySet()))
        assertTrue("cancelled sampler did not finish", finished.await(2, TimeUnit.SECONDS))
        shadowOf(android.os.Looper.getMainLooper()).idle()

        assertEquals(null, chrome.currentPanel())
        assertEquals(1, closeCount)
        activity.finish()
    }

    @Test fun `leaving profile for the section list cancels pending resampling`() {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        val chrome = HomeChrome(activity) { }
        activity.setContentView(chrome)
        val started = CountDownLatch(1)
        val finished = CountDownLatch(1)
        val pending = CompletableDeferred<NativeSectionSnapshot>()
        var surfaceUpdates = 0
        val panel = NativeSectionPanel(
            activity, chrome, JSONArray(), JSONArray(), settings(),
            sample = {
                started.countDown()
                try { pending.await() } finally { finished.countDown() }
            },
            onCommit = { _, _ -> }, onShowSurface = { _, _ -> surfaceUpdates++ }, onExport = { _, _ -> }, onClose = {},
        )
        panel.open()
        findText(chrome, "新建当前视域剖面")!!.performClick()
        findText(chrome, "应用参数并显示三维剖面")!!.performClick()
        assertTrue("sampling did not start", started.await(2, TimeUnit.SECONDS))
        // Applying the plane intentionally publishes an empty preview before the sampler starts.
        // Capture that baseline so the assertion below specifically detects a late result after
        // leaving the profile.
        val updatesBeforeLeaving = surfaceUpdates
        assertEquals("the applied profile should publish its initial empty surface", 1, updatesBeforeLeaving)

        findText(chrome, "返回剖面列表")!!.performClick()
        assertTrue("leaving the profile should cancel its sampler", finished.await(2, TimeUnit.SECONDS))
        shadowOf(android.os.Looper.getMainLooper()).idle()
        assertEquals("native-section", chrome.currentPanel())
        assertEquals("canceled sampling must not publish another surface", updatesBeforeLeaving, surfaceUpdates)
        panel.dispose()
        activity.finish()
    }

    private fun settings() = JSONObject().put("enabled", true).put("altitude", 100.0).put("color", "#9de8c4")
        .put("plane", JSONObject().put("center", JSONArray().put(104.0).put(30.0))
            .put("width", 2000.0).put("height", 1000.0).put("heading", 30.0).put("tilt", 0.0).put("roll", 0.0))

    private fun findText(root: View, value: String): TextView? {
        if (root is TextView && root.text.toString() == value) return root
        if (root is ViewGroup) for (i in 0 until root.childCount) findText(root.getChildAt(i), value)?.let { return it }
        return null
    }

    private fun findInput(root: View, hint: String): EditText? {
        if (root is EditText && root.hint.toString() == hint) return root
        if (root is ViewGroup) for (i in 0 until root.childCount) findInput(root.getChildAt(i), hint)?.let { return it }
        return null
    }
}
