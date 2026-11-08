package com.shantu.nativeapp.map

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.net.SocketTimeoutException
import java.net.URL
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * The bounded tile transport. Redirects are followed manually so every hop shares one deadline,
 * can be cancelled, and is revalidated before opening a connection.
 */
internal class NativeTileHttpClient(
    private val requestDeadlineMs: Long = DEFAULT_REQUEST_DEADLINE_MS,
) : TileHttpClient {
    init { require(requestDeadlineMs in 1..DEFAULT_REQUEST_DEADLINE_MS) }

    override fun execute(url: String): TileHttpResponse = execute(url, TileRequestCancellation())

    override fun execute(url: String, cancellation: TileRequestCancellation): TileHttpResponse {
        var current = parseTileHttpUri(url) ?: throw IOException("Invalid tile URL")
        val deadlineNanos = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(requestDeadlineMs)
        val activeConnection = AtomicReference<HttpURLConnection?>()
        val deadlineDisconnect: ScheduledFuture<*> = DEADLINE_EXECUTOR.schedule(
            { activeConnection.get()?.disconnect() }, requestDeadlineMs, TimeUnit.MILLISECONDS,
        )
        val visited = mutableSetOf(loopKey(current))
        var redirects = 0

        try {
            while (true) {
                if (cancellation.isCancelled) throw InterruptedException("cancelled")
                val timeoutMs = remainingTimeoutMs(deadlineNanos)
                val connection = (current.toURL().openConnection() as HttpURLConnection).apply {
                    connectTimeout = timeoutMs
                    readTimeout = timeoutMs
                    instanceFollowRedirects = false
                    setRequestProperty("Accept", ACCEPT_HEADER)
                    setRequestProperty("User-Agent", USER_AGENT)
                }
                activeConnection.set(connection)
                cancellation.register {
                    activeConnection.compareAndSet(connection, null)
                    connection.disconnect()
                }
                try {
                    if (cancellation.isCancelled) throw InterruptedException("cancelled")
                    val status = connection.responseCode
                    val retryAfter = connection.getHeaderField("Retry-After")
                    val bingTileInfo = connection.getHeaderField("X-VE-Tile-Info")
                    if (isRedirect(status)) {
                        val redirectResponse = TileHttpResponse(status, retryAfter, null, bingTileInfo)
                        if (redirects >= MAX_REDIRECTS) return redirectResponse
                        val location = connection.getHeaderField("Location") ?: return redirectResponse
                        val next = resolveTileRedirect(current, location) ?: return redirectResponse
                        if (!visited.add(loopKey(next))) return redirectResponse
                        redirects++
                        current = next
                        continue
                    }

                    val body = if (status in 200..299) readBody(connection, deadlineNanos) else null
                    val providerErrorCode = if (status == 401 || status == 403) {
                        readOfficialTiandituErrorCode(URL(current.toASCIIString()).host, status, connection, deadlineNanos, cancellation)
                    } else null
                    return TileHttpResponse(status, retryAfter, body, bingTileInfo, providerErrorCode)
                } finally {
                    activeConnection.compareAndSet(connection, null)
                    cancellation.clear()
                    connection.disconnect()
                }
            }
        } finally {
            deadlineDisconnect.cancel(false)
        }
    }

    private fun readBody(connection: HttpURLConnection, deadlineNanos: Long): ByteArray? =
        connection.inputStream.use { input -> readBoundedTileResponseBody(input, MAX_TILE_BYTES) {
            // Refresh the socket timeout on each read so a slow trickle cannot reset the
            // effective total response deadline indefinitely.
            connection.readTimeout = remainingTimeoutMs(deadlineNanos)
        } }

    private fun readOfficialTiandituErrorCode(
        host: String,
        status: Int,
        connection: HttpURLConnection,
        deadlineNanos: Long,
        cancellation: TileRequestCancellation,
    ): Int? {
        if (!isOfficialTiandituHost(host) || status != 401 && status != 403) return null
        val stream = connection.errorStream ?: return null
        return try {
            val contentLength = connection.getHeaderField("Content-Length")?.toLongOrNull() ?: -1L
            val bytes = stream.use {
                readBoundedTileErrorBody(it, MAX_PROVIDER_ERROR_BYTES, contentLength) {
                    connection.readTimeout = remainingTimeoutMs(deadlineNanos)
                }
            } ?: return null
            parseOfficialTiandituErrorCode(host, status, bytes)
        } catch (_: Exception) {
            if (cancellation.isCancelled || Thread.currentThread().isInterrupted) throw InterruptedException("cancelled")
            null
        }
    }

    private fun remainingTimeoutMs(deadlineNanos: Long): Int {
        val nanos = deadlineNanos - System.nanoTime()
        if (nanos <= 0L) throw SocketTimeoutException("Tile request deadline exceeded")
        return TimeUnit.NANOSECONDS.toMillis(nanos).coerceAtLeast(1L).coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
    }

    private fun isRedirect(status: Int): Boolean = status in REDIRECT_STATUSES

    private fun loopKey(uri: URI): String {
        val normalized = uri.normalize()
        val scheme = normalized.scheme.lowercase()
        val parsedUrl = URL(normalized.toASCIIString())
        val defaultPort = if (scheme == "https") 443 else 80
        val port = parsedUrl.port.takeIf { it >= 0 && it != defaultPort }?.let { ":$it" }.orEmpty()
        val path = normalized.rawPath?.ifEmpty { "/" } ?: "/"
        val host = parsedUrl.host.lowercase()
        return "$scheme://$host$port$path" + (normalized.rawQuery?.let { "?$it" } ?: "")
    }

    private companion object {
        const val DEFAULT_REQUEST_DEADLINE_MS = 15_000L
        const val MAX_REDIRECTS = 3
        const val MAX_TILE_BYTES = 4 * 1024 * 1024
        const val MAX_PROVIDER_ERROR_BYTES = 4 * 1024
        const val ACCEPT_HEADER = "image/png,image/*;q=0.9,*/*;q=0.5"
        const val USER_AGENT = "ShantuNativeMap/1"
        val REDIRECT_STATUSES = setOf(301, 302, 303, 307, 308)
        val DEADLINE_EXECUTOR = ScheduledThreadPoolExecutor(1) { task ->
            Thread(task, "native-tile-deadline").apply { isDaemon = true }
        }.apply { removeOnCancelPolicy = true }
    }
}

/** Resolve and validate Location without carrying query parameters from the prior URL. */
internal fun resolveTileRedirect(current: URI, location: String): URI? {
    return try {
        val target = current.resolve(URI(location))
        val validated = parseTileHttpUri(target.toASCIIString()) ?: return null
        if (current.scheme.equals("https", ignoreCase = true) &&
            validated.scheme.equals("http", ignoreCase = true)) return null
        validated
    } catch (_: Exception) {
        null
    }
}

internal fun parseTileHttpUri(raw: String): URI? {
    return try {
        val uri = URI(raw)
        val scheme = uri.scheme ?: return null
        if (!scheme.equals("http", ignoreCase = true) && !scheme.equals("https", ignoreCase = true)) return null
        val parsedUrl = URL(raw)
        if (uri.isOpaque || parsedUrl.host.isNullOrBlank() || uri.rawAuthority.isNullOrBlank() ||
            uri.rawUserInfo != null || parsedUrl.userInfo != null || uri.rawFragment != null) return null
        if (!hasValidExplicitPort(uri.rawAuthority, parsedUrl.port)) return null
        uri
    } catch (_: Exception) {
        null
    }
}

private fun hasValidExplicitPort(authority: String, parsedPort: Int): Boolean {
    val portText = if (authority.startsWith("[")) {
        val closingBracket = authority.indexOf(']')
        if (closingBracket < 0) return false
        val suffix = authority.substring(closingBracket + 1)
        when {
            suffix.isEmpty() -> null
            suffix.startsWith(":") -> suffix.substring(1)
            else -> return false
        }
    } else {
        val firstColon = authority.indexOf(':')
        if (firstColon < 0) null
        else {
            if (firstColon != authority.lastIndexOf(':')) return false
            authority.substring(firstColon + 1)
        }
    } ?: return parsedPort < 0
    if (portText.isEmpty() || portText.any { !it.isDigit() }) return false
    val port = portText.toIntOrNull() ?: return false
    return port in 0..65535 && parsedPort == port
}

/** Limit an error response to the exact byte budget; unknown-length bodies filling the budget are rejected. */
internal fun readBoundedTileErrorBody(
    input: java.io.InputStream,
    maxBytes: Int,
    declaredLength: Long = -1L,
    beforeRead: () -> Unit = {},
): ByteArray? {
    if (maxBytes < 0 || declaredLength > maxBytes) return null
    val output = ByteArrayOutputStream(minOf(maxBytes, 1024))
    val buffer = ByteArray(minOf(1024, maxBytes.coerceAtLeast(1)))
    var total = 0
    while (true) {
        if (total == maxBytes) return if (declaredLength == maxBytes.toLong()) output.toByteArray() else null
        beforeRead()
        val count = input.read(buffer, 0, minOf(buffer.size, maxBytes - total))
        if (count < 0) return output.toByteArray()
        total += count
        output.write(buffer, 0, count)
    }
}

/** Tile body reader retaining the prior 4 MiB cap; the callback refreshes the shared deadline. */
internal fun readBoundedTileResponseBody(
    input: java.io.InputStream,
    maxBytes: Int,
    beforeRead: () -> Unit,
): ByteArray? {
    val output = ByteArrayOutputStream(minOf(maxBytes, 8192))
    val buffer = ByteArray(8192)
    var total = 0
    while (true) {
        beforeRead()
        val count = input.read(buffer)
        if (count < 0) return output.toByteArray()
        total += count
        if (total > maxBytes) return null
        output.write(buffer, 0, count)
    }
}

internal fun isOfficialTiandituHost(host: String): Boolean = OFFICIAL_TIANDITU_HOST.matches(host)

/** Parse only a strict integer `code` from a small official Tianditu 401/403 JSON response. */
internal fun parseOfficialTiandituErrorCode(host: String, status: Int, body: ByteArray?): Int? {
    if (!isOfficialTiandituHost(host) || status != 401 && status != 403 || body == null || body.size > 4 * 1024) return null
    return try {
        val text = StandardCharsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
            .decode(ByteBuffer.wrap(body)).toString()
        val codeMembers = Regex("\"code\"\\s*:").findAll(text).count()
        if (codeMembers != 1) return null
        val value = org.json.JSONObject(text).opt("code")
        when (value) {
            is Int -> value
            is Long -> value.takeIf { it in Int.MIN_VALUE.toLong()..Int.MAX_VALUE.toLong() }?.toInt()
            else -> null
        }
    } catch (_: Exception) {
        null
    }
}

internal fun tileHttpFailureMessage(host: String, status: Int, providerErrorCode: Int?): String {
    if (!isOfficialTiandituHost(host)) return "图源瓦片加载失败（HTTP $status）；可点重试"
    return when (providerErrorCode.takeIf { status == 401 || status == 403 }) {
        301007 -> "天地图授权域名不匹配（HTTP $status）"
        301012 -> "天地图授权类型仅允许浏览器访问（HTTP $status）"
        else -> "天地图瓦片加载失败（HTTP $status）；可点重试"
    }
}

private val OFFICIAL_TIANDITU_HOST = Regex("^t[0-7]\\.tianditu\\.gov\\.cn$", RegexOption.IGNORE_CASE)
