package com.shantu.nativeapp.map

import android.util.Base64
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.security.MessageDigest

@RunWith(RobolectricTestRunner::class)
class NativeBrowserCacheFallbackTest {
    @After fun reset() {
        NativeOfflineDisplayPolicy.reset()
        NativeTileNetworkPool.installBrowserCacheReader(null)
    }

    @Test fun browserCacheReadAcceptsOnlyMatchingSessionMapPackageAndBodyDigest() = runBlocking {
        NativeOfflineDisplayPolicy.update(NativeOfflineDisplayPolicyState(
            enabled = true, packageId = "trip-a", provider = "tianditu"))
        val url = "https://t0.tianditu.gov.cn/img_w/wmts?tile=1"
        var request: JSONObject? = null
        val events = mutableListOf<Pair<String, JSONObject>>()
        val fallback = NativeBrowserCacheFallback({ "session-a" }, { "main" }, { _, name, payload ->
            events += name to JSONObject(payload.toString())
            if (name == "cachedTileRequest") request = JSONObject(payload.toString())
        })
        val result = async { fallback.read("trip-a", url) }
        withTimeout(1_000) { while (request == null) delay(5) }
        val item = requireNotNull(request)
        val bytes = byteArrayOf(1, 2, 3, 4)
        val response = JSONObject().put("requestId", item.getString("requestId"))
            .put("packageId", "trip-a").put("urlHash", item.getString("urlHash"))
            .put("found", true).put("bytesBase64", Base64.encodeToString(bytes, Base64.NO_WRAP))
            .put("bodySha256", sha256(bytes))
        assertFalse(fallback.acceptResponse("session-b", "main", response))
        assertFalse(fallback.acceptResponse("session-a", "aux-1", response))
        assertFalse(fallback.acceptResponse("session-a", "main", JSONObject(response.toString()).put("packageId", "trip-b")))
        assertFalse(fallback.acceptResponse("session-a", "main", JSONObject(response.toString()).put("urlHash", "0".repeat(64))))
        assertTrue(fallback.acceptResponse("session-a", "main", response))
        assertArrayEquals(bytes, result.await())
        fallback.close()
    }

    @Test fun invalidBodyDigestIsRejectedAndTimeoutEmitsCancellation() = runBlocking {
        NativeOfflineDisplayPolicy.update(NativeOfflineDisplayPolicyState(
            enabled = true, packageId = "trip-a", provider = "tianditu"))
        val url = "https://t0.tianditu.gov.cn/img_w/wmts?tile=2"
        val events = mutableListOf<Pair<String, JSONObject>>()
        var request: JSONObject? = null
        val fallback = NativeBrowserCacheFallback({ "session-a" }, { "main" }, { _, name, payload ->
            events += name to JSONObject(payload.toString())
            if (name == "cachedTileRequest") request = JSONObject(payload.toString())
        }, timeoutMillis = 60)
        val bytes = byteArrayOf(9, 8, 7)
        val result = async { fallback.read("trip-a", url) }
        withTimeout(1_000) { while (request == null) delay(5) }
        val item = requireNotNull(request)
        val invalid = JSONObject().put("requestId", item.getString("requestId"))
            .put("packageId", "trip-a").put("urlHash", item.getString("urlHash"))
            .put("found", true).put("bytesBase64", Base64.encodeToString(bytes, Base64.NO_WRAP))
            .put("bodySha256", "0".repeat(64))
        assertFalse(fallback.acceptResponse("session-a", "main", invalid))
        assertNull(result.await())
        assertTrue(events.any { it.first == "cachedTileCancel" && it.second.getString("requestId") == item.getString("requestId") })
        fallback.close()
    }

    @Test fun closeCompletesPendingReadsWithoutBlockingOrTouchingNetwork() = runBlocking {
        NativeOfflineDisplayPolicy.update(NativeOfflineDisplayPolicyState(
            enabled = true, packageId = "trip-a", provider = "tianditu"))
        val url = "https://t0.tianditu.gov.cn/img_w/wmts?tile=3"
        var request: JSONObject? = null
        val fallback = NativeBrowserCacheFallback({ "session-a" }, { "main" }, { _, name, payload ->
            if (name == "cachedTileRequest") request = JSONObject(payload.toString())
        })
        val result = async { fallback.read("trip-a", url) }
        withTimeout(1_000) { while (request == null) delay(5) }
        fallback.close()
        assertNull(result.await())
        assertFalse(fallback.acceptResponse("session-a", "main", JSONObject().put("requestId", request!!.getString("requestId"))))
    }

    private fun sha256(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes)
        .joinToString("") { "%02x".format(it) }
}
