package com.shantu.nativeapp.map

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.annotation.SQLiteMode
import java.net.UnknownHostException
import java.nio.file.Files
import java.util.concurrent.atomic.AtomicInteger

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@SQLiteMode(SQLiteMode.Mode.NATIVE)
class NativeMapSourceProbeTest {
    @Test fun `probe uses valid camera zoom capped at 24 and returns safe metadata`() = runBlocking {
        val source = NativeMapSourceCatalog.fromJson(org.json.JSONObject("""
            {"maps":[{"id":"zoom-check","name":"safe source","format":"XYZ","tiles":["https://tiles.fixture/{z}/{x}/{y}.png?key=secret"],"minzoom":0,"maxzoom":24}]}
        """)).sources.single()
        val urls = mutableListOf<String>()
        val network = BoundedTileNetwork(Files.createTempDirectory("source-health-zoom-").toFile(), {},
            TileHttpClient { url -> urls += url; TileHttpResponse(200, null, byteArrayOf(1, 2, 3)) }, isValidImage = { true })
        try {
            val result = probeNativeMapSource(network, source, 37.0 to 127.0, 30.0)
            assertEquals(24, result.testedZoom)
            assertEquals("safe source", result.sourceName)
            assertTrue(result.elapsedMs >= 0)
            assertEquals(3, urls.size)
            assertTrue(urls.all { it.contains("/24/") })
            assertTrue(!result.message.contains("secret") && !result.sourceName.contains("secret"))
        } finally { network.close() }
    }

    @Test fun `probe classifies exact no data bytes but leaves ordinary 202 image valid`() = runBlocking {
        val noData = listOf(java.io.File("../../tests/fixtures/jilin-no-data-placeholder.png"), java.io.File("tests/fixtures/jilin-no-data-placeholder.png"))
            .firstOrNull { it.isFile }!!.readBytes()
        val calls = AtomicInteger()
        val network = BoundedTileNetwork(Files.createTempDirectory("source-health-").toFile(), {},
            TileHttpClient { calls.incrementAndGet(); TileHttpResponse(202, null, noData) }, isValidImage = { true })
        try {
            assertEquals(NativeTileProbeOutcome.MISSING, network.probeTile("https://fixture.example/0/0/0.png"))
            assertEquals(1, calls.get())
            assertEquals(0, network.snapshot().completedCacheWrites)
        } finally { network.close() }

        val ordinary = BoundedTileNetwork(Files.createTempDirectory("source-health-ordinary-").toFile(), {},
            TileHttpClient { TileHttpResponse(202, null, byteArrayOf(1, 2, 3)) }, isValidImage = { true })
        try {
            assertEquals(NativeTileProbeOutcome.OK, ordinary.probeTile("https://fixture.example/0/0/0.png"))
            assertEquals(0, ordinary.snapshot().completedCacheWrites)
        } finally { ordinary.close() }
    }

    @Test fun `probe preserves native DNS classification without exposing exception text`() = runBlocking {
        val network = BoundedTileNetwork(Files.createTempDirectory("source-health-dns-").toFile(), {},
            TileHttpClient { throw UnknownHostException("must not surface host or token") }, isValidImage = { true })
        try {
            assertEquals(NativeTileProbeOutcome.DNS, network.probeTile("https://fixture.example/0/0/0.png"))
            assertEquals(0, network.snapshot().completedCacheWrites)
        } finally { network.close() }
    }
}
