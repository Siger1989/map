package com.shantu.nativeapp.map

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.After
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.nio.file.Files
import java.io.RandomAccessFile
import java.net.URL
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class BoundedTileNetworkTest {
    private val imageBytes = byteArrayOf(11, 22, 33, 44)

    @After fun resetOfflineDisplayPolicy() {
        NativeOfflineDisplayPolicy.reset()
        NativeTileNetworkPool.installOfflineReader(null)
        NativeTileNetworkPool.installOfflinePackageMembership(null)
    }

    @Test
    fun `offline display reads only selected manifest members and never falls back to network`() = runBlocking {
        val requests = AtomicInteger()
        val selectedUrl = "https://example.invalid/tiles/4/3/2"
        val (tiles, _) = network("offline-policy") { _, _ ->
            requests.incrementAndGet()
            TileHttpResponse(200, null, imageBytes)
        }
        NativeTileNetworkPool.installOfflinePackageMembership { id, url -> id == "trip-selected" && url == selectedUrl }
        NativeTileNetworkPool.installOfflineReader { url -> if (url == selectedUrl) imageBytes else null }
        tiles.legacyReader = { url -> NativeTileNetworkPool.readSelectedPackageUrl("trip-selected", url) }
        NativeOfflineDisplayPolicy.update(NativeOfflineDisplayPolicyState(
            enabled = true, packageId = "trip-selected", provider = "openfreemap"))

        assertArrayEquals(imageBytes, tiles.fetch(selectedUrl))
        assertNull(tiles.fetch("https://example.invalid/tiles/4/3/3"))
        assertArrayEquals(imageBytes, tiles.fetch("https://example.invalid/download/4/3/3", bulkDownload = true))
        assertEquals(1, requests.get())
        assertEquals(1L, tiles.snapshot().networkRequests)
        tiles.close()
    }

    @Test
    fun `429 honors bounded retry after and retries only once`() = runBlocking {
        val calls = AtomicInteger()
        val (tiles, _) = network("retry") { _, _ ->
            if (calls.incrementAndGet() == 1) TileHttpResponse(429, "0", null)
            else TileHttpResponse(200, null, imageBytes)
        }

        val result = tiles.fetch("https://example.invalid/tile?token=private")

        assertArrayEquals(imageBytes, result)
        assertEquals(2, calls.get())
        val snapshot = tiles.snapshot()
        assertEquals(2L, snapshot.networkRequests)
        assertEquals(1L, snapshot.rateLimits)
        assertEquals(1L, snapshot.successes)
        assertEquals(0L, snapshot.errors)
        assertEquals(imageBytes.size.toLong(), snapshot.receivedBytes)
        assertTrue(snapshot.networkMs >= 0L)
        assertTrue(snapshot.queueWaitMs >= 0L)
        tiles.close()
    }

    @Test
    fun `parallel map misses use four shared foreground slots`() = runBlocking {
        val started = CountDownLatch(BoundedTileNetwork.MAX_MAP_REQUESTS)
        val release = CountDownLatch(1)
        val active = AtomicInteger()
        val maximum = AtomicInteger()
        val network = network("parallel") { _, _ ->
            val now = active.incrementAndGet()
            maximum.updateAndGet { old -> maxOf(old, now) }
            started.countDown()
            check(release.await(5, TimeUnit.SECONDS))
            Thread.sleep(15) // Keep the elapsed-time assertion above the millisecond counter resolution.
            active.decrementAndGet()
            TileHttpResponse(200, null, imageBytes)
        }.first

        val tasks = (0 until 8).map { index ->
            async(Dispatchers.IO) { network.fetch("https://example.invalid/tile/$index") }
        }
        assertTrue("all four foreground map slots should become active", started.await(5, TimeUnit.SECONDS))
        assertEquals(BoundedTileNetwork.MAX_MAP_REQUESTS, maximum.get())
        assertEquals(BoundedTileNetwork.MAX_MAP_REQUESTS, network.snapshot().activeNetworkRequests)
        release.countDown()
        tasks.forEach { assertNotNull(it.await()) }

        assertEquals(8L, network.snapshot().networkRequests)
        assertEquals(8L, network.snapshot().successes)
        assertEquals(0L, network.snapshot().errors)
        assertTrue(network.snapshot().queueWaitMs > 0L)
        assertTrue(network.snapshot().networkMs > 0L)
        network.close()
    }

    @Test
    fun `sixteen bulk workers coexist with four reserved foreground map requests`() = runBlocking {
        val bulkStarted=CountDownLatch(16)
        val mapStarted=CountDownLatch(BoundedTileNetwork.MAX_MAP_REQUESTS)
        val release=CountDownLatch(1)
        val bulkActive=AtomicInteger()
        val mapActive=AtomicInteger()
        val maxBulk=AtomicInteger()
        val maxMap=AtomicInteger()
        val hostActive=java.util.concurrent.ConcurrentHashMap<String,AtomicInteger>()
        val hostMaximum=java.util.concurrent.ConcurrentHashMap<String,AtomicInteger>()
        val network=BoundedTileNetwork(
            Files.createTempDirectory("shantu-bulk-priority-").toFile(),{},TileHttpClient { url ->
                if(url.contains("/bulk/")) {
                    val active=bulkActive.incrementAndGet(); maxBulk.updateAndGet { maxOf(it,active) }; bulkStarted.countDown()
                    val host=URL(url).host
                    val perHost=hostActive.computeIfAbsent(host) { AtomicInteger() }.incrementAndGet()
                    hostMaximum.computeIfAbsent(host) { AtomicInteger() }.updateAndGet { old -> maxOf(old,perHost) }
                    check(release.await(5,TimeUnit.SECONDS)); bulkActive.decrementAndGet()
                    hostActive.getValue(host).decrementAndGet()
                } else {
                    val active=mapActive.incrementAndGet(); maxMap.updateAndGet { maxOf(it,active) }; mapStarted.countDown()
                    check(release.await(5,TimeUnit.SECONDS)); mapActive.decrementAndGet()
                }
                TileHttpResponse(200,null,imageBytes)
            },isValidImage={true})
        val bulk=(0 until 20).map { i -> async(Dispatchers.IO) { network.fetch("https://custom-${i%4}.invalid/bulk/$i",bulkDownload=true) } }
        assertTrue("bulk workers should fill their sixteen-request budget",bulkStarted.await(5,TimeUnit.SECONDS))
        val map=(0 until 4).map { i -> async(Dispatchers.IO) { network.fetch("https://map.invalid/map/$i") } }
        assertTrue("map keeps all four foreground slots",mapStarted.await(5,TimeUnit.SECONDS))
        assertEquals(20,network.snapshot().activeNetworkRequests)
        release.countDown()
        bulk.forEach { assertNotNull(it.await()) }; map.forEach { assertNotNull(it.await()) }
        assertEquals(16,maxBulk.get()); assertEquals(BoundedTileNetwork.MAX_MAP_REQUESTS,maxMap.get())
        assertEquals(4,hostMaximum.size)
        assertTrue(hostMaximum.values.all { it.get() <= 4 })
        network.close()
    }

    @Test fun `custom source bulk lane enforces a per-host four request budget`() = runBlocking {
        val fourStarted=CountDownLatch(4)
        val release=CountDownLatch(1)
        val active=AtomicInteger()
        val maximum=AtomicInteger()
        val network=BoundedTileNetwork(Files.createTempDirectory("shantu-host-budget-").toFile(),{},TileHttpClient {
            val now=active.incrementAndGet()
            maximum.updateAndGet { maxOf(it,now) }
            fourStarted.countDown()
            check(release.await(5,TimeUnit.SECONDS))
            active.decrementAndGet()
            TileHttpResponse(200,null,imageBytes)
        },isValidImage={true})
        val tasks=(0 until 12).map { i -> async(Dispatchers.IO) {
            network.fetch("https://custom-source.invalid/tile/$i",bulkDownload=true)
        } }
        assertTrue("one source host should fill its four request budget",fourStarted.await(5,TimeUnit.SECONDS))
        assertEquals(4,maximum.get())
        release.countDown()
        tasks.forEach { assertNotNull(it.await()) }
        assertTrue(maximum.get()<=BoundedTileNetwork.MAX_CUSTOM_BULK_PER_HOST)
        network.close()
    }

    @Test
    fun `Tianditu subdomains share cooldown`() = runBlocking {
        val calls=AtomicInteger()
        val network=network("shared-tianditu-cooldown") { _, _ ->
            calls.incrementAndGet(); TileHttpResponse(429,"3600",null)
        }.first
        assertNull(network.fetch("https://t0.tianditu.gov.cn/img_w/tile/one"))
        assertNull(network.fetch("https://t7.tianditu.gov.cn/cva_w/tile/two",bulkDownload=true))
        assertEquals("429 on any DataServer subdomain cools down the shared host class",1,calls.get())
        assertTrue(network.cooldownRemainingMillis()>=3_500_000L)
        network.close()

    }

    @Test fun `Tianditu keeps four bounded in flight starts spaced and map slots reserved`() = runBlocking {
        val started=CountDownLatch(4)
        val release=CountDownLatch(1)
        val starts=java.util.Collections.synchronizedList(mutableListOf<Long>())
        val active=AtomicInteger()
        val mapActive=AtomicInteger()
        val bulkActive=AtomicInteger()
        val maxActive=AtomicInteger()
        val maxMap=AtomicInteger()
        val maxBulk=AtomicInteger()
        val network=BoundedTileNetwork(Files.createTempDirectory("shantu-tianditu-budget-").toFile(),{},TileHttpClient { url ->
            val map=!url.contains("/bulk/")
            val now=active.incrementAndGet()
            maxActive.updateAndGet { maxOf(it,now) }
            if(map) { val count=mapActive.incrementAndGet(); maxMap.updateAndGet { maxOf(it,count) } }
            else { val count=bulkActive.incrementAndGet(); maxBulk.updateAndGet { maxOf(it,count) } }
            starts+=System.nanoTime()
            started.countDown()
            check(release.await(8,TimeUnit.SECONDS))
            if(map) mapActive.decrementAndGet() else bulkActive.decrementAndGet()
            active.decrementAndGet()
            TileHttpResponse(200,null,imageBytes)
        },isValidImage={true})
        val bulk=(0 until 8).map { i -> async(Dispatchers.IO) { network.fetch("https://t${i%8}.tianditu.gov.cn/bulk/$i",bulkDownload=true) } }
        val maps=(0 until 8).map { i -> async(Dispatchers.IO) { network.fetch("https://t${i%8}.tianditu.gov.cn/map/$i") } }
        assertTrue("TDT should make progress with four bounded active requests",started.await(6,TimeUnit.SECONDS))
        assertEquals(4,maxActive.get())
        assertTrue("map requests stay within the four foreground slots",maxMap.get()<=BoundedTileNetwork.MAX_MAP_REQUESTS)
        assertTrue("bulk is capped at two TDT slots",maxBulk.get()<=BoundedTileNetwork.MAX_TIANDITU_BULK_REQUESTS)
        val ordered=starts.toList().sorted()
        assertEquals(4,ordered.size)
        for(i in 1 until ordered.size)
            assertTrue("shared TDT request starts preserve 250 ms pacing",TimeUnit.NANOSECONDS.toMillis(ordered[i]-ordered[i-1])>=220L)
        release.countDown()
        maps.forEach { assertNotNull(it.await()) }
        bulk.forEach { assertNotNull(it.await()) }
        assertEquals(0,network.tiandituBulkWaiterCountForTest())
        network.close()
    }

    @Test fun `Tianditu foreground map can use all four paced server slots`() = runBlocking {
        val started = CountDownLatch(BoundedTileNetwork.MAX_TIANDITU_ACTIVE_REQUESTS)
        val release = CountDownLatch(1)
        val active = AtomicInteger()
        val maximum = AtomicInteger()
        val starts = java.util.Collections.synchronizedList(mutableListOf<Long>())
        val network = BoundedTileNetwork(
            Files.createTempDirectory("shantu-tianditu-map-throughput-").toFile(), {},
            TileHttpClient {
                val count = active.incrementAndGet()
                maximum.updateAndGet { old -> maxOf(old, count) }
                starts += System.nanoTime()
                started.countDown()
                check(release.await(8, TimeUnit.SECONDS))
                active.decrementAndGet()
                TileHttpResponse(200, null, imageBytes)
            },
            isValidImage = { true },
        )
        val maps = (0 until 8).map { index ->
            async(Dispatchers.IO) { network.fetch("https://t${index % 8}.tianditu.gov.cn/map/$index") }
        }
        assertTrue("foreground TDT requests should fill all four shared host slots", started.await(6, TimeUnit.SECONDS))
        assertEquals(BoundedTileNetwork.MAX_TIANDITU_ACTIVE_REQUESTS, maximum.get())
        val ordered = starts.toList().sorted()
        assertEquals(BoundedTileNetwork.MAX_TIANDITU_ACTIVE_REQUESTS, ordered.size)
        for (index in 1 until ordered.size) {
            assertTrue(
                "TDT start cadence remains bounded at 250 ms",
                TimeUnit.NANOSECONDS.toMillis(ordered[index] - ordered[index - 1]) >= 220L,
            )
        }
        release.countDown()
        maps.forEach { assertNotNull(it.await()) }
        assertEquals(8L, network.snapshot().networkRequests)
        network.close()
    }

    @Test fun `map request progresses while TDT bulk lane is saturated`() = runBlocking {
        val bulkStarted=CountDownLatch(2)
        val releaseBulk=CountDownLatch(1)
        val mapStarted=CountDownLatch(1)
        val order=java.util.Collections.synchronizedList(mutableListOf<String>())
        val network=BoundedTileNetwork(Files.createTempDirectory("shantu-tianditu-priority-").toFile(),{},TileHttpClient { url ->
            order += url.substringAfterLast('/')
            if(url.contains("/bulk/")) {
                bulkStarted.countDown()
                check(releaseBulk.await(5,TimeUnit.SECONDS))
            } else {
                mapStarted.countDown()
            }
            TileHttpResponse(200,null,imageBytes)
        },isValidImage={true})
        val first=(0..1).map { i -> async(Dispatchers.IO) { network.fetch("https://t$i.tianditu.gov.cn/bulk/$i",bulkDownload=true) } }
        assertTrue(bulkStarted.await(5,TimeUnit.SECONDS))
        val bulk=async(Dispatchers.IO) { network.fetch("https://t2.tianditu.gov.cn/bulk/third",bulkDownload=true) }
        val deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(5)
        while(network.tiandituBulkWaiterCountForTest()==0) {
            check(System.nanoTime()<deadline) { "third Tianditu bulk request did not queue behind reserved bulk slots" }
            kotlinx.coroutines.yield()
        }
        val map=async(Dispatchers.IO) { network.fetch("https://t3.tianditu.gov.cn/img_w/map") }
        assertTrue("map slots remain available while both bulk slots are busy",mapStarted.await(5,TimeUnit.SECONDS))
        releaseBulk.countDown()
        first.forEach { assertNotNull(it.await()) }; assertNotNull(map.await()); assertNotNull(bulk.await())
        assertTrue("map starts before queued bulk work",order.indexOf("map")<order.indexOf("third"))
        network.close()
    }

    @Test
    fun `queued network request cancellation removes its waiter without occupying a thread`() = runBlocking {
        val activeLimit = BoundedTileNetwork.MAX_MAP_REQUESTS
        val started = CountDownLatch(activeLimit)
        val releaseRequests = CountDownLatch(1)
        val network = BoundedTileNetwork(
            Files.createTempDirectory("shantu-queue-cancel-").toFile(), {},
            TileHttpClient {
                started.countDown()
                check(releaseRequests.await(5, TimeUnit.SECONDS))
                TileHttpResponse(200, null, imageBytes)
            },
            isValidImage = { true },
        )
        val activeRequests = (0 until activeLimit).map { index ->
            async(Dispatchers.IO) { network.fetch("https://example.invalid/active-$index") }
        }
        assertTrue(started.await(5, TimeUnit.SECONDS))
        val queued = async(Dispatchers.IO) { network.fetch("https://example.invalid/queued") }
        waitForQueue(network, 1)
        assertEquals(activeLimit, network.snapshot().activeNetworkRequests)

        queued.cancelAndJoin()
        assertEquals(0, network.snapshot().queuedNetworkRequests)
        releaseRequests.countDown()
        activeRequests.forEach { assertNotNull(it.await()) }
        assertEquals(activeLimit.toLong(), network.snapshot().networkRequests)
        network.close()
    }

    @Test
    fun `close wakes queued network requests and leaves no permit waiters`() = runBlocking<Unit> {
        val activeLimit = BoundedTileNetwork.MAX_MAP_REQUESTS
        val started = CountDownLatch(activeLimit)
        val releaseRequests = CountDownLatch(1)
        val network = BoundedTileNetwork(
            Files.createTempDirectory("shantu-queue-close-").toFile(), {},
            TileHttpClient {
                started.countDown()
                check(releaseRequests.await(5, TimeUnit.SECONDS))
                TileHttpResponse(200, null, imageBytes)
            },
            isValidImage = { true },
        )
        val activeRequests = (0 until activeLimit).map { index ->
            async(Dispatchers.IO) { network.fetch("https://example.invalid/active-$index") }
        }
        assertTrue(started.await(5, TimeUnit.SECONDS))
        val queued = async(Dispatchers.IO) { network.fetch("https://example.invalid/queued") }
        waitForQueue(network, 1)

        network.close()
        assertNull(queued.await())
        assertEquals(0, network.snapshot().queuedNetworkRequests)
        releaseRequests.countDown()
        activeRequests.forEach { it.await() }
    }

    @Test fun `cache-only or final close racing with socket response prevents late cache write`() = runBlocking {
        for (stopMode in listOf("cache-only","close")) {
            val started=CountDownLatch(1)
            val release=CountDownLatch(1)
            val directory=Files.createTempDirectory("shantu-late-response-$stopMode-").toFile()
            val network=BoundedTileNetwork(directory,{},TileHttpClient {
                started.countDown()
                check(release.await(5,TimeUnit.SECONDS))
                TileHttpResponse(200,null,imageBytes)
            },isValidImage={true})
            val request=async(Dispatchers.IO) { network.fetch("https://example.invalid/late") }
            assertTrue(started.await(5,TimeUnit.SECONDS))
            if(stopMode=="cache-only") network.cacheOnly=true else network.close()
            release.countDown()
            assertNull("a response arriving after $stopMode must be discarded",request.await())
            assertTrue("no memory/disk cache may be repopulated after $stopMode",directory.listFiles().isNullOrEmpty())
            network.close()
        }
    }

    @Test
    fun `close racing with permit release reclaims an acquired waiter permit`() = runBlocking {
        val activeLimit = BoundedTileNetwork.MAX_MAP_REQUESTS
        val started = CountDownLatch(activeLimit)
        val releaseRequests = CountDownLatch(1)
        val race = CountDownLatch(1)
        val network = BoundedTileNetwork(
            Files.createTempDirectory("shantu-queue-close-race-").toFile(), {},
            TileHttpClient {
                started.countDown()
                check(releaseRequests.await(5, TimeUnit.SECONDS))
                TileHttpResponse(200, null, imageBytes)
            },
            isValidImage = { true },
        )
        val activeRequests = (0 until activeLimit).map { index ->
            async(Dispatchers.IO) { network.fetch("https://example.invalid/active-$index") }
        }
        assertTrue(started.await(5, TimeUnit.SECONDS))
        val queued = async(Dispatchers.IO) { network.fetch("https://example.invalid/queued") }
        waitForQueue(network, 1)
        val closer = Thread {
            check(race.await(5, TimeUnit.SECONDS))
            network.close()
        }.apply { start() }
        race.countDown()
        releaseRequests.countDown()

        queued.await()
        activeRequests.forEach { it.await() }
        closer.join(5_000)
        assertTrue(!closer.isAlive)
        assertEquals(0, network.snapshot().queuedNetworkRequests)
        assertEquals(0, network.snapshot().activeNetworkRequests)
    }

    @Test
    fun `same URL requests share one in flight response`() = runBlocking {
        val calls = AtomicInteger()
        val network = network("single-flight") { _, _ ->
            calls.incrementAndGet()
            Thread.sleep(120)
            TileHttpResponse(200, null, imageBytes)
        }.first
        val url = "https://example.invalid/tile/shared"

        val tasks = (0 until 8).map { async(Dispatchers.IO) { network.fetch(url) } }
        tasks.forEach { assertArrayEquals(imageBytes, it.await()) }

        assertEquals(1, calls.get())
        network.close()
    }

    @Test
    fun `long Retry-After blocks every tile for that host`() = runBlocking {
        val calls = AtomicInteger()
        val network = network("host-cooldown") { _, _ ->
            calls.incrementAndGet()
            TileHttpResponse(429, "3600", null)
        }.first

        assertNull(network.fetch("https://example.invalid/tile/first"))
        assertNull(network.fetch("https://example.invalid/tile/second"))
        assertEquals(1, calls.get())
        assertTrue(network.cooldownRemainingMillis() >= 3_500_000L)
        network.close()
    }

    @Test
    fun `huge Retry-After saturates without overflow and blocks retry`() = runBlocking {
        val calls = AtomicInteger()
        val network = network("huge-cooldown") { _, _ ->
            calls.incrementAndGet()
            TileHttpResponse(429, "999999999999999999999999999999999999", null)
        }.first

        assertNull(network.fetch("https://example.invalid/tile/first"))
        assertNull(network.fetch("https://example.invalid/tile/second"))
        assertEquals(1, calls.get())
        assertTrue(network.cooldownRemainingMillis() > 30_000L)
        network.close()
    }

    @Test
    fun `disk cache survives network owner recreation`() = runBlocking {
        val (first, directory) = network("reopen") { _, _ -> TileHttpResponse(200, null, imageBytes) }
        val url = "https://example.invalid/tile/one"
        assertArrayEquals(imageBytes, first.fetch(url))
        assertEquals(1L, first.snapshot().networkRequests)
        assertEquals(1L, first.snapshot().successes)
        first.close()

        val calls = AtomicInteger()
        val reopened = BoundedTileNetwork(directory, {}, TileHttpClient { calls.incrementAndGet(); TileHttpResponse(503, null, null) }, { true })
        assertArrayEquals(imageBytes, reopened.fetch(url))
        assertEquals(0, calls.get())
        assertEquals(1L, reopened.snapshot().diskHits)
        assertEquals(1L, reopened.snapshot().successes)
        assertEquals(0L, reopened.snapshot().networkRequests)
        assertArrayEquals(imageBytes, reopened.fetch(url))
        assertEquals(1L, reopened.snapshot().memoryHits)
        assertTrue(!reopened.snapshot().toString().contains("example.invalid"))
        reopened.close()
    }

    @Test
    fun `expired disk tile is fetched again`() = runBlocking {
        val (first, directory) = network("expiry") { _, _ -> TileHttpResponse(200, null, imageBytes) }
        val url = "https://example.invalid/tile/expired"
        assertArrayEquals(imageBytes, first.fetch(url))
        first.close()
        val tileFile = directory.listFiles()!!.single { it.name.endsWith(".tile") }
        tileFile.setLastModified(System.currentTimeMillis() - 25L * 60L * 60L * 1_000L)
        val replacementBytes = byteArrayOf(55, 66, 77)
        val calls = AtomicInteger()
        val reopened = BoundedTileNetwork(directory, {}, TileHttpClient {
            calls.incrementAndGet()
            TileHttpResponse(200, null, replacementBytes)
        }, { true })

        assertArrayEquals(replacementBytes, reopened.fetch(url))
        assertEquals(1, calls.get())
        reopened.close()
    }

    @Test
    fun `corrupt disk tile is discarded and refetched`() = runBlocking {
        val (first, directory) = network("corrupt") { _, _ -> TileHttpResponse(200, null, imageBytes) }
        val url = "https://example.invalid/tile/corrupt"
        assertArrayEquals(imageBytes, first.fetch(url))
        first.close()
        val tileFile = directory.listFiles()!!.single { it.name.endsWith(".tile") }
        tileFile.writeBytes(byteArrayOf(1, 2, 3))
        val replacementBytes = byteArrayOf(88, 99, 111)
        val calls = AtomicInteger()
        val reopened = BoundedTileNetwork(directory, {}, TileHttpClient {
            calls.incrementAndGet()
            TileHttpResponse(200, null, replacementBytes)
        }, { it.contentEquals(replacementBytes) })

        assertArrayEquals(replacementBytes, reopened.fetch(url))
        assertEquals(1, calls.get())
        reopened.close()
    }

    @Test
    fun `failed response is not written into cache`() = runBlocking {
        val (tiles, directory) = network("failed") { _, _ -> TileHttpResponse(503, null, null) }

        assertNull(tiles.fetch("https://example.invalid/tile/fail"))
        assertTrue(directory.listFiles().isNullOrEmpty())
        assertEquals(1L, tiles.snapshot().networkRequests)
        assertEquals(1L, tiles.snapshot().errors)
        assertEquals(0L, tiles.snapshot().successes)
        tiles.close()
    }

    @Test
    fun `invalid image response is not written into cache`() = runBlocking {
        val directory = Files.createTempDirectory("shantu-invalid-").toFile()
        val rejecting = BoundedTileNetwork(directory, {}, TileHttpClient { TileHttpResponse(200, null, imageBytes) }, { false })

        assertNull(rejecting.fetch("https://example.invalid/tile/invalid"))
        assertTrue(directory.listFiles().isNullOrEmpty())
        assertEquals(1L, rejecting.snapshot().networkRequests)
        assertEquals(1L, rejecting.snapshot().errors)
        assertEquals(0L, rejecting.snapshot().successes)
        assertEquals(imageBytes.size.toLong(), rejecting.snapshot().receivedBytes)
        rejecting.close()
    }

    @Test
    fun `status never includes private tile URL or key`() = runBlocking {
        val messages = mutableListOf<String>()
        val directory = Files.createTempDirectory("shantu-redacted-status-").toFile()
        val network = BoundedTileNetwork(directory, { message -> synchronized(messages) { messages += message } }, TileHttpClient {
            TileHttpResponse(503, null, null)
        }, isValidImage = { true })
        val privateKey = "secret-test-key"

        assertNull(network.fetch("https://example.invalid/tile?tk=$privateKey"))
        synchronized(messages) {
            assertTrue(messages.isNotEmpty())
            assertTrue(messages.none { it.contains(privateKey) || it.contains("example.invalid") })
        }
        network.close()
    }

    @Test
    fun `wmts paths use suffixed service path and unsuffixed layer parameter`() {
        val expected = mapOf("img" to "img_w", "cia" to "cia_w", "vec" to "vec_w", "cva" to "cva_w", "ter" to "ter_w", "cta" to "cta_w")
        for ((layer, path) in expected) {
            val url = URL(tiandituTileUrl(layer, 3, 5, 7, "test-token"))
            assertTrue(url.path.endsWith("/$path/wmts"))
            val query = url.query.split('&').associate { it.substringBefore('=') to it.substringAfter('=') }
            assertEquals(layer, query["LAYER"])
            assertEquals("3", query["TILECOL"])
            assertEquals("5", query["TILEROW"])
            assertEquals("7", query["TILEMATRIX"])
        }
    }

    @Test
    fun `cooldown extended during short retry wait prevents early retry`() = runBlocking {
        val calls = AtomicInteger()
        val extensionStarted = CountDownLatch(1)
        val extensionMayRespond = CountDownLatch(1)
        val extensionFinished = CountDownLatch(1)
        lateinit var network: BoundedTileNetwork
        val client = TileHttpClient { url ->
            calls.incrementAndGet()
            if (url.endsWith("/initial")) TileHttpResponse(429, "1", null)
            else {
                extensionStarted.countDown()
                check(extensionMayRespond.await(5, TimeUnit.SECONDS))
                TileHttpResponse(429, "3600", null)
            }
        }
        network = BoundedTileNetwork(
            Files.createTempDirectory("shantu-extended-cooldown-").toFile(), {}, client, { true },
        ) {
            extensionMayRespond.countDown()
            check(extensionFinished.await(5, TimeUnit.SECONDS))
        }
        Thread {
            runBlocking { network.fetch("https://example.invalid/extension") }
            extensionFinished.countDown()
        }.start()
        assertTrue(extensionStarted.await(5, TimeUnit.SECONDS))

        assertNull(network.fetch("https://example.invalid/initial"))
        assertEquals("second tile extended the host cooldown; initial tile was not retried", 2, calls.get())
        assertTrue(network.cooldownRemainingMillis() >= 3_500_000L)
        network.close()
    }

    @Test
    fun `disk trim ignores atomic file staging entries`() = runBlocking {
        val (tiles, directory) = network("trim-staging") { _, _ -> TileHttpResponse(200, null, imageBytes) }
        val staging = directory.resolve("another-writer.tile.new")
        staging.writeBytes(byteArrayOf(42))
        val oversized = directory.resolve("oldest.tile")
        RandomAccessFile(oversized, "rw").use { it.setLength(64L * 1024L * 1024L + 1L) }
        oversized.setLastModified(System.currentTimeMillis() - 10_000L)

        assertArrayEquals(imageBytes, tiles.fetch("https://example.invalid/tile/trim"))
        assertTrue("AtomicFile staging entry must be left to its writer", staging.exists())
        tiles.close()
    }

    private fun network(
        name: String,
        response: (String, Int) -> TileHttpResponse,
    ): Pair<BoundedTileNetwork, java.io.File> {
        val directory = Files.createTempDirectory("shantu-$name-").toFile()
        val call = AtomicInteger()
        val client = TileHttpClient { url -> response(url, call.incrementAndGet()) }
        val network = BoundedTileNetwork(directory, {}, client, isValidImage = { true })
        return network to directory
    }

    private suspend fun waitForQueue(network: BoundedTileNetwork, expected: Int) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
        while (network.snapshot().queuedNetworkRequests != expected) {
            check(System.nanoTime() < deadline) { "network queue did not reach $expected waiters" }
            kotlinx.coroutines.yield()
        }
    }
}
