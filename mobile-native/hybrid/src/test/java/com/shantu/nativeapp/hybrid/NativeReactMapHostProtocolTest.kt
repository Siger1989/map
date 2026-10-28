package com.shantu.nativeapp.hybrid

import android.widget.FrameLayout
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], manifest = Config.NONE)
class NativeReactMapHostProtocolTest {
    @Test fun trustedSessionForwardsGlobalRegionsWithoutRequiringAMountedMap() {
        val output = mutableListOf<JSONObject>(); val forwarded = mutableListOf<String>()
        val context = RuntimeEnvironment.getApplication()
        val host = NativeReactMapHost(context, FrameLayout(context), { output += JSONObject(it) }, { true }, { command, _ -> forwarded += command; true })
        try {
            host.handleMessage(request("hello", "hello").toString())
            assertEquals(1, output.size)
            assertEquals("main", output.single().getString("mapId"))
            val session = output.single().getString("sessionId")
            host.handleMessage(request("regions", "uiRegions", session).toString())
            assertEquals(listOf("uiRegions"), forwarded)
            assertEquals("regions", output.last().getString("requestId"))
            assertTrue(output.last().getJSONObject("payload").getBoolean("applied"))
        } finally { host.close() }
    }

    @Test fun staleSessionAndBackgroundPageCannotForwardInputRegions() {
        val context = RuntimeEnvironment.getApplication(); val output = mutableListOf<JSONObject>(); var trusted = true; var forwards = 0
        val host = NativeReactMapHost(context, FrameLayout(context), { output += JSONObject(it) }, { trusted }, { _, _ -> forwards++; true })
        try {
            host.handleMessage(request("hello", "hello").toString())
            val session = output.single().getString("sessionId")
            host.handleMessage(request("stale", "viewport", "not-current").toString())
            assertEquals(0, forwards)
            assertEquals("error", output.last().getString("type"))
            trusted = false
            host.handleMessage(request("hidden", "uiRegions", session).toString())
            assertEquals(0, forwards)
            trusted = true
            host.invalidateSession()
            host.handleMessage(request("reloaded", "uiRegions", session).toString())
            assertEquals(0, forwards)
        } finally { host.close() }
    }

    private fun request(id: String, command: String, session: String? = null) = JSONObject()
        .put("version", 1).put("requestId", id).put("mapId", "main").put("command", command)
        .put("payload", JSONObject()).apply { if (session != null) put("sessionId", session) }
}
