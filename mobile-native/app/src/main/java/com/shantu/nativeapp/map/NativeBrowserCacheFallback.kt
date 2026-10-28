package com.shantu.nativeapp.map

import android.util.Base64
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import java.net.URI
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Bounded asynchronous reader for the existing React CacheStorage package. The host supplies a
 * trusted-session event sender; JavaScript performs exact selected-manifest membership and never fetches.
 */
internal class NativeBrowserCacheFallback(
    private val sessionId: () -> String?,
    private val mapId: () -> String?,
    private val sendEvent: (mapId: String, name: String, value: JSONObject) -> Unit,
    private val timeoutMillis: Long = DEFAULT_TIMEOUT_MILLIS,
) : AutoCloseable {
    private data class Pending(
        val sessionId: String,
        val mapId: String,
        val packageId: String,
        val urlHash: String,
        val result: CompletableDeferred<ByteArray?>,
    )

    private val pending = ConcurrentHashMap<String, Pending>()
    private val requests = Semaphore(MAX_CONCURRENT_REQUESTS)
    @Volatile private var closed = false

    suspend fun read(packageId: String, url: String): ByteArray? = requests.withPermit {
        if (closed || !validUrl(url)) return@withPermit null
        val policy = NativeOfflineDisplayPolicy.snapshot()
        if (!policy.enabled || !policy.hasSelectedPackage || policy.packageId != packageId) return@withPermit null
        val activeSession = sessionId()?.takeIf { it.isNotBlank() } ?: return@withPermit null
        val activeMap = mapId()?.takeIf { it.isNotBlank() } ?: return@withPermit null
        val requestId = UUID.randomUUID().toString()
        val urlHash = sha256(url.toByteArray(Charsets.UTF_8))
        val result = CompletableDeferred<ByteArray?>()
        val record = Pending(activeSession, activeMap, packageId, urlHash, result)
        pending[requestId] = record
        try {
            sendEvent(activeMap, "cachedTileRequest", JSONObject()
                .put("requestId", requestId).put("packageId", packageId).put("url", url)
                .put("urlHash", urlHash).put("maxBytes", MAX_TILE_BYTES))
            withTimeoutOrNull(timeoutMillis.coerceIn(250L, MAX_TIMEOUT_MILLIS)) { result.await() }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            null
        } finally {
            if (pending.remove(requestId, record)) {
                if (!result.isCompleted) sendCancel(activeMap, requestId, packageId, urlHash)
            }
        }
    }

    /** Must be called only after Host validates the trusted bridge session and active map id. */
    fun acceptResponse(responseSessionId: String, responseMapId: String, payload: JSONObject): Boolean {
        val requestId = payload.optString("requestId")
        val request = pending[requestId] ?: return false
        if (request.sessionId != responseSessionId || request.mapId != responseMapId ||
            request.packageId != payload.optString("packageId") || request.urlHash != payload.optString("urlHash")) return false
        if (!payload.optBoolean("found")) {
            if (pending.remove(requestId, request)) request.result.complete(null)
            return true
        }
        val encoded = payload.optString("bytesBase64")
        if (encoded.isBlank() || encoded.length > MAX_BASE64_CHARS) return false
        val bytes = runCatching { Base64.decode(encoded, Base64.NO_WRAP) }.getOrNull() ?: return false
        if (bytes.isEmpty() || bytes.size > MAX_TILE_BYTES || sha256(bytes) != payload.optString("bodySha256")) return false
        if (!pending.remove(requestId, request)) return false
        request.result.complete(bytes)
        return true
    }

    private fun sendCancel(mapId: String, requestId: String, packageId: String, urlHash: String) {
        runCatching {
            sendEvent(mapId, "cachedTileCancel", JSONObject()
                .put("requestId", requestId).put("packageId", packageId).put("urlHash", urlHash))
        }
    }

    override fun close() {
        if (closed) return
        closed = true
        pending.entries.toList().forEach { (requestId, request) ->
            if (pending.remove(requestId, request)) {
                request.result.complete(null)
                sendCancel(request.mapId, requestId, request.packageId, request.urlHash)
            }
        }
    }

    private fun validUrl(value: String): Boolean = value.length in 1..MAX_URL_LENGTH && runCatching {
        val uri = URI(value)
        uri.scheme in setOf("http", "https") && !uri.host.isNullOrBlank() && uri.userInfo == null && uri.fragment == null
    }.getOrDefault(false)

    private fun sha256(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes)
        .joinToString("") { "%02x".format(it) }

    companion object {
        const val MAX_TILE_BYTES = 4 * 1024 * 1024
        const val MAX_CONCURRENT_REQUESTS = 4
        const val DEFAULT_TIMEOUT_MILLIS = 2_500L
        const val MAX_TIMEOUT_MILLIS = 5_000L
        private const val MAX_URL_LENGTH = 8_192
        private const val MAX_BASE64_CHARS = ((MAX_TILE_BYTES + 2) / 3) * 4
    }
}
