package com.shantu.nativeapp.map

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.BufferedReader
import java.io.Closeable
import java.io.InputStreamReader
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URI
import java.nio.charset.StandardCharsets
import java.io.ByteArrayInputStream
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NativeTileHttpClientTest {
    @Test fun followsRelative301303307AndKeepsOneRequestDeadlinePath() {
        LocalHttpServer { request ->
            when (request) {
                "/start?source=fixture" -> Response(301, location = "next/one")
                "/next/one" -> Response(303, location = "../next/two?from=location")
                "/next/two?from=location" -> Response(307, location = "/tile?final=1")
                "/tile?final=1" -> Response(200, body = TILE_BYTES)
                else -> Response(404)
            }
        }.use { server ->
            val response = NativeTileHttpClient().execute(server.url("/start?source=fixture"))
            assertEquals(200, response.statusCode)
            assertArrayEquals(TILE_BYTES, response.body)
            assertEquals(
                listOf("/start?source=fixture", "/next/one", "/next/two?from=location", "/tile?final=1"),
                server.requests,
            )
        }
    }

    @Test fun crossOriginRedirectUsesOnlyTheLocationQuery() {
        LocalHttpServer { request -> if (request == "/target?issued=location") Response(200, body = TILE_BYTES) else Response(404) }.use { target ->
            LocalHttpServer { request ->
                if (request == "/start?source=fixture") {
                    Response(302, location = target.url("/target?issued=location"))
                } else Response(404)
            }.use { source ->
                val response = NativeTileHttpClient().execute(source.url("/start?source=fixture"))
                assertEquals(200, response.statusCode)
                assertArrayEquals(TILE_BYTES, response.body)
                assertEquals(listOf("/target?issued=location"), target.requests)
            }
        }
    }

    @Test fun stopsAfterThreeRedirectsAndDoesNotTreatRedirectAsTile() {
        LocalHttpServer { request ->
            val index = request.substringAfter('/').substringBefore('?').toInt()
            Response(302, location = "/${index + 1}")
        }.use { server ->
            val response = NativeTileHttpClient().execute(server.url("/0"))
            assertEquals(302, response.statusCode)
            assertNull(response.body)
            assertEquals(listOf("/0", "/1", "/2", "/3"), server.requests)
        }
    }

    @Test fun redirectLoopIsNotRequestedTwice() {
        LocalHttpServer { Response(301, location = "/loop") }.use { server ->
            val response = NativeTileHttpClient().execute(server.url("/loop"))
            assertEquals(301, response.statusCode)
            assertNull(response.body)
            assertEquals(listOf("/loop"), server.requests)
        }
    }

    @Test fun rejectsDowngradeNonHttpUserinfoFragmentAndMalformedLocations() {
        val secure = URI("https://example.invalid/base/path?keep=local")
        assertEquals(
            URI("https://example.invalid/secure?issued=location"),
            resolveTileRedirect(URI("http://example.invalid/base?source=fixture"), "https://example.invalid/secure?issued=location"),
        )
        assertNull(resolveTileRedirect(secure, "http://example.invalid/tile"))
        assertNull(resolveTileRedirect(URI("http://example.invalid/path"), "file:///tmp/tile"))
        assertNull(resolveTileRedirect(URI("http://example.invalid/path"), "//user@example.invalid/tile"))
        assertNull(resolveTileRedirect(URI("http://example.invalid/path"), "/tile#fragment"))
        assertNull(resolveTileRedirect(URI("http://example.invalid/path"), "http://["))
    }

    @Test fun retainsPreviouslyAcceptedUnderscoreHostsForInitialAndRelativeUrls() {
        val initial = parseTileHttpUri("http://tiles_sub.example.invalid/base/one")
        assertEquals("tiles_sub.example.invalid", java.net.URL(initial!!.toASCIIString()).host)
        val redirected = resolveTileRedirect(initial, "../tile?part=2")
        assertEquals("http://tiles_sub.example.invalid/tile?part=2", redirected?.toASCIIString())
        assertEquals("http://tiles_sub.example.invalid:8080/path", parseTileHttpUri("http://tiles_sub.example.invalid:8080/path")?.toASCIIString())
        assertNull(parseTileHttpUri("http://tiles_sub.example.invalid:bad/path"))
        assertNull(parseTileHttpUri("http://tiles_sub.example.invalid:65536/path"))
        assertNull(parseTileHttpUri("http://user:pass@tiles_sub.example.invalid/tile"))
        assertNull(resolveTileRedirect(initial, "http://user:pass@tiles_sub.example.invalid/redirected"))
    }

    @Test fun readsAtMostFourKiBOfProviderErrorAndRejectsOversizedBodies() {
        val oversized = ByteArrayInputStream(ByteArray(8192) { 'x'.code.toByte() })
        assertNull(readBoundedTileErrorBody(oversized, 4096))
        assertEquals("the reader never consumes a byte beyond the cap", 4096, oversized.available())

        val declaredOversize = ByteArrayInputStream(ByteArray(20))
        assertNull(readBoundedTileErrorBody(declaredOversize, 4096, declaredLength = 4097))
        assertEquals("declared oversize is rejected without reading", 20, declaredOversize.available())

        val small = "{\"code\":301012}".toByteArray(StandardCharsets.UTF_8)
        assertArrayEquals(small, readBoundedTileErrorBody(ByteArrayInputStream(small), 4096))
    }

    @Test fun parsesOnlyStrictOfficialTiandituIntegerCodesAndReturnsSafeMessages() {
        val browserOnly = "{\"code\":301012,\"msg\":\"must-not-escape\",\"token\":\"fixture-only\"}"
            .toByteArray(StandardCharsets.UTF_8)
        assertEquals(301012, parseOfficialTiandituErrorCode("t0.tianditu.gov.cn", 403, browserOnly))
        assertEquals(301007, parseOfficialTiandituErrorCode(
            "T7.TIANDITU.GOV.CN", 401, "{\"code\":301007}".toByteArray(StandardCharsets.UTF_8),
        ))
        assertNull(parseOfficialTiandituErrorCode("t0.tianditu.gov.cn.evil.invalid", 403, browserOnly))
        assertNull(parseOfficialTiandituErrorCode("attacker-tianditu.gov.cn", 403, browserOnly))
        assertNull(parseOfficialTiandituErrorCode("t8.tianditu.gov.cn", 403, browserOnly))
        assertNull(parseOfficialTiandituErrorCode("t0.tianditu.gov.cn", 404, browserOnly))
        assertNull(parseOfficialTiandituErrorCode("t0.tianditu.gov.cn", 403, "{\"code\":\"301012\"}".toByteArray()))
        assertNull(parseOfficialTiandituErrorCode("t0.tianditu.gov.cn", 403, "{\"code\":301012.0}".toByteArray()))
        assertNull(parseOfficialTiandituErrorCode("t0.tianditu.gov.cn", 403, browserOnly + ByteArray(4096)))

        assertEquals("天地图授权域名不匹配（HTTP 403）", tileHttpFailureMessage("t0.tianditu.gov.cn", 403, 301007))
        assertEquals("天地图授权类型仅允许浏览器访问（HTTP 403）", tileHttpFailureMessage("t0.tianditu.gov.cn", 403, 301012))
        assertEquals("天地图瓦片加载失败（HTTP 403）；可点重试", tileHttpFailureMessage("t0.tianditu.gov.cn", 403, null))
        val safeMessage = tileHttpFailureMessage("t0.tianditu.gov.cn", 403, 301012)
        assertTrue(safeMessage.contains("仅允许浏览器访问"))
        assertTrue(!safeMessage.contains("must-not-escape") && !safeMessage.contains("fixture-only"))
        val unknownHostMessage = tileHttpFailureMessage("t0.tianditu.gov.cn.evil.invalid", 403, 301012)
        assertEquals("图源瓦片加载失败（HTTP 403）；可点重试", unknownHostMessage)
    }

    @Test fun unknownHostsCannotInjectProviderCodesThroughHttpResponses() {
        LocalHttpServer {
            Response(403, body = "{\"code\":301012}".toByteArray(StandardCharsets.UTF_8))
        }.use { server ->
            val response = NativeTileHttpClient().execute(server.url("/forbidden"))
            assertEquals(403, response.statusCode)
            assertNull(response.providerErrorCode)
        }
    }

    @Test fun oldTileHttpResponseConstructorCallsRemainValid() {
        assertNull(TileHttpResponse(403, null, null).providerErrorCode)
        assertNull(TileHttpResponse(403, null, null, "fixture-info").providerErrorCode)
    }

    @Test fun preservesFinalResponseMetadataAndAccepts202ForExistingCallerPolicy() {
        LocalHttpServer {
            Response(202, body = TILE_BYTES, headers = mapOf("Retry-After" to "17", "X-VE-Tile-Info" to "fixture-info"))
        }.use { server ->
            val response = NativeTileHttpClient().execute(server.url("/accepted"))
            assertEquals(202, response.statusCode)
            assertEquals("17", response.retryAfter)
            assertEquals("fixture-info", response.bingTileInfo)
            assertArrayEquals(TILE_BYTES, response.body)
        }
    }

    @Test fun cancellationDisconnectsAnActiveRedirectOrBodyRequest() {
        val started = CountDownLatch(1)
        val releaseResponse = CountDownLatch(1)
        LocalHttpServer({
            started.countDown()
            Response(200, body = TILE_BYTES, waitBeforeReply = releaseResponse)
        }).use { server ->
            val cancellation = TileRequestCancellation()
            val executor = Executors.newSingleThreadExecutor()
            try {
                val result = executor.submit<TileHttpResponse> {
                    NativeTileHttpClient().execute(server.url("/slow"), cancellation)
                }
                assertTrue("request reached the local server", started.await(2, TimeUnit.SECONDS))
                cancellation.cancel()
                try {
                    result.get(2, TimeUnit.SECONDS)
                    throw AssertionError("cancelled request unexpectedly succeeded")
                } catch (_: java.util.concurrent.ExecutionException) {
                    assertTrue(cancellation.isCancelled)
                }
            } finally {
                releaseResponse.countDown()
                cancellation.cancel()
                executor.shutdownNow()
            }
        }
    }

    @Test fun allRedirectHopsAndBodyShareOneTotalDeadline() {
        val started = CountDownLatch(1)
        val releaseResponse = CountDownLatch(1)
        LocalHttpServer({
            started.countDown()
            Response(200, body = TILE_BYTES, waitBeforeReply = releaseResponse)
        }).use { server ->
            val executor = Executors.newSingleThreadExecutor()
            val start = System.nanoTime()
            try {
                val result = executor.submit<TileHttpResponse> {
                    NativeTileHttpClient(requestDeadlineMs = 250).execute(server.url("/deadline"))
                }
                assertTrue("request reached the local server", started.await(2, TimeUnit.SECONDS))
                try {
                    result.get(2, TimeUnit.SECONDS)
                    throw AssertionError("deadline-expired request unexpectedly succeeded")
                } catch (_: java.util.concurrent.ExecutionException) {
                    assertTrue("deadline disconnects the stalled response", TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start) < 2000)
                }
            } finally {
                releaseResponse.countDown()
                executor.shutdownNow()
            }
        }
    }

    private data class Response(
        val status: Int,
        val location: String? = null,
        val body: ByteArray = byteArrayOf(),
        val headers: Map<String, String> = emptyMap(),
        val waitBeforeReply: CountDownLatch? = null,
    )

    private class LocalHttpServer(private val respond: (String) -> Response) : Closeable {
        private val running = AtomicBoolean(true)
        private val socket = ServerSocket().apply {
            reuseAddress = true
            bind(InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0))
        }
        private val workers = CopyOnWriteArrayList<Thread>()
        val requests = CopyOnWriteArrayList<String>()

        init {
            Thread({
                while (running.get()) {
                    val client = try { socket.accept() } catch (_: Exception) { break }
                    Thread({ serve(client) }, "native-tile-test-client").apply {
                        isDaemon = true
                        workers += this
                        start()
                    }
                }
            }, "native-tile-test-server").apply { isDaemon = true; start() }
        }

        fun url(path: String): String = "http://127.0.0.1:${socket.localPort}$path"

        private fun serve(client: Socket) {
            client.use { connection ->
                try {
                    connection.soTimeout = 5000
                    val input = BufferedReader(InputStreamReader(connection.getInputStream(), StandardCharsets.ISO_8859_1))
                    val requestLine = input.readLine() ?: return
                    val requestTarget = requestLine.split(' ').getOrNull(1) ?: return
                    while (input.readLine()?.isNotEmpty() == true) { /* consume request headers */ }
                    requests += requestTarget
                    val response = respond(requestTarget)
                    response.waitBeforeReply?.await(5, TimeUnit.SECONDS)
                    val reason = when (response.status) {
                        200 -> "OK"; 202 -> "Accepted"; 301 -> "Moved Permanently"; 302 -> "Found"
                        303 -> "See Other"; 307 -> "Temporary Redirect"; 404 -> "Not Found"; else -> "Response"
                    }
                    val headers = linkedMapOf(
                        "Content-Length" to response.body.size.toString(),
                        "Connection" to "close",
                    ).apply {
                        response.location?.let { put("Location", it) }
                        putAll(response.headers)
                    }
                    val head = buildString {
                        append("HTTP/1.1 ${response.status} $reason\r\n")
                        headers.forEach { (name, value) -> append("$name: $value\r\n") }
                        append("\r\n")
                    }.toByteArray(StandardCharsets.ISO_8859_1)
                    connection.getOutputStream().apply { write(head); write(response.body); flush() }
                } catch (_: Exception) {
                    // Disconnect/cancellation is an expected test path.
                }
            }
        }

        override fun close() {
            running.set(false)
            runCatching { socket.close() }
            workers.forEach { it.join(100) }
        }
    }

    private companion object {
        val TILE_BYTES = "synthetic-tile".toByteArray(StandardCharsets.UTF_8)
    }
}
