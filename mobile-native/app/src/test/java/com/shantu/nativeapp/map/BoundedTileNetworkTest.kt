package com.shantu.nativeapp.map

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.After
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.SQLiteMode
import java.nio.file.Files
import java.io.RandomAccessFile
import java.net.URL
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
@SQLiteMode(SQLiteMode.Mode.NATIVE)
class BoundedTileNetworkTest {
    private val imageBytes = byteArrayOf(11, 22, 33, 44)

    @Test
    fun `explicit no coverage is negatively cached while auth denial remains an error`() = runBlocking {
        val missingCalls = AtomicInteger()
        val missingUrl = "https://example.test/tiles/18/101/202.png"
        val missing = BoundedTileNetwork(
            Files.createTempDirectory("missing-tile-").toFile(), {},
            TileHttpClient { missingCalls.incrementAndGet(); TileHttpResponse(404, null, null) },
            isValidImage = { true },
        )
        assertNull(missing.fetch(missingUrl))
        assertTrue(missing.isKnownMissing(missingUrl))
        assertNull(missing.fetch(missingUrl))
        assertEquals("recent explicit misses avoid repeated same-tile requests", 1, missingCalls.get())
        missing.close()

        val deniedUrl = "https://example.test/tiles/18/101/203.png"
        val denied = BoundedTileNetwork(
            Files.createTempDirectory("denied-tile-").toFile(), {},
            TileHttpClient { TileHttpResponse(403, null, null) },
            isValidImage = { true },
        )
        assertNull(denied.fetch(deniedUrl))
        assertFalse(denied.isKnownMissing(deniedUrl))
        denied.close()

        val bingUrl = "https://ecn.t3.tiles.virtualearth.net/tiles/a.example.jpeg"
        val bing = BoundedTileNetwork(
            Files.createTempDirectory("bing-missing-tile-").toFile(), {},
            TileHttpClient { TileHttpResponse(200, null, imageBytes, "no-tile") },
            isValidImage = { true },
        )
        assertNull(bing.fetch(bingUrl))
        assertTrue("Bing no-tile response headers classify a miss even with HTTP 200", bing.isKnownMissing(bingUrl))
        bing.close()
    }

    @Test
    fun persistentReopenAndStaleRefresh() = runBlocking {
        val context = RuntimeEnvironment.getApplication()
        NativePersistentBrowseCache(context).let { cache -> runBlocking { cache.clear() }; cache.close() }
        val freshUrl = "https://tiles.example.test/0/1/2"
        val firstCalls = AtomicInteger()
        val cacheFailure = AtomicReference<String?>()
        val firstStore = NativePersistentBrowseCache(context, onCacheFailure = { operation, kind -> cacheFailure.set("$operation:$kind") })
        val token = firstStore.generationToken()
        assertNotNull("persistent cache generation token is available; storage=${cacheFailure.get()}", token)
        val first = BoundedTileNetwork(
            Files.createTempDirectory("browse-cache-first-").toFile(), {},
            TileHttpClient { firstCalls.incrementAndGet(); TileHttpResponse(200, null, imageBytes) },
            isValidImage = { true }, persistentCache = firstStore,
        )
        assertArrayEquals(imageBytes, first.fetch(freshUrl))
        assertEquals(1, firstCalls.get())
        val persistentWriteDeadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(5)
        while(firstStore.stats()?.entries!=1L) {
            check(System.nanoTime()<persistentWriteDeadline) { "background persistent cache write did not commit" }
            kotlinx.coroutines.delay(10)
        }
        assertEquals("successful response is indexed in persistent cache: failure=${cacheFailure.get()}", 1L, firstStore.stats()?.entries)
        first.close()
        firstStore.close()

        val secondCalls = AtomicInteger()
        val second = BoundedTileNetwork(
            Files.createTempDirectory("browse-cache-reopen-").toFile(), {},
            TileHttpClient { secondCalls.incrementAndGet(); TileHttpResponse(200, null, byteArrayOf(9)) },
            isValidImage = { true }, persistentCache = NativePersistentBrowseCache(context, minFreeBytes = 0),
        )
        assertArrayEquals("reopened cache must satisfy the URL without another client request", imageBytes, second.fetch(freshUrl))
        assertEquals(0, secondCalls.get())

        val staleUrl = "https://tiles.example.test/0/1/3"
        val staleCache = NativePersistentBrowseCache(context, minFreeBytes = 0)
        assertTrue(staleCache.write(staleUrl, imageBytes, savedAtMillis = System.currentTimeMillis() - 25L * 60 * 60 * 1000))
        val refreshStarted = CountDownLatch(1)
        val releaseRefresh = CountDownLatch(1)
        val refreshCalls = AtomicInteger()
        val staleNetwork = BoundedTileNetwork(
            Files.createTempDirectory("browse-cache-stale-").toFile(), {},
            TileHttpClient {
                refreshCalls.incrementAndGet(); refreshStarted.countDown()
                check(releaseRefresh.await(5, TimeUnit.SECONDS))
                TileHttpResponse(200, null, imageBytes)
            },
            isValidImage = { true }, persistentCache = staleCache,
        )
        val staleFactory = TiandituImageFactory(staleNetwork, staleUrl)
        val refreshedFactory = AtomicReference<earth.worldwind.render.image.ImageSource.NetworkBoundImageFactory?>()
        val refreshed = CountDownLatch(1)
        val observer = staleNetwork.observeRefresh { refreshedFactory.set(it); refreshed.countDown() }
        assertArrayEquals("stale imagery is available immediately", imageBytes, staleNetwork.readCached(staleUrl, staleFactory))
        assertTrue("stale tile refresh is scheduled", refreshStarted.await(5, TimeUnit.SECONDS))
        val joinedRefresh = async(Dispatchers.IO) { staleNetwork.fetch(staleUrl, forceNetwork = true) }
        kotlinx.coroutines.delay(30)
        assertEquals("foreground request joins the same canonical refresh instead of downloading twice", 1, refreshCalls.get())
        releaseRefresh.countDown()
        assertArrayEquals(imageBytes, joinedRefresh.await())
        assertTrue("successful refresh notifies render cache observer", refreshed.await(5, TimeUnit.SECONDS))
        assertEquals(staleFactory, refreshedFactory.get())
        assertEquals(1, refreshCalls.get())
        observer.close()
        second.close(); staleNetwork.close()
    }

    @Test
    fun `persistent write failure does not fail valid network response`() = runBlocking {
        val context = RuntimeEnvironment.getApplication()
        val url = "https://tiles.example.test/write-fails"
        val cache = NativePersistentBrowseCache(context, minFreeBytes = Long.MAX_VALUE)
        cache.clear()
        val network = BoundedTileNetwork(
            Files.createTempDirectory("browse-cache-write-failure-").toFile(), {},
            TileHttpClient { TileHttpResponse(200, null, imageBytes) }, isValidImage = { true }, persistentCache = cache,
        )
        assertArrayEquals(imageBytes, network.fetch(url))
        val writeFailureDeadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(5)
        while(network.snapshot().failedCacheWrites==0L) {
            check(System.nanoTime()<writeFailureDeadline) { "asynchronous browse-cache write failure was not reported" }
            kotlinx.coroutines.delay(10)
        }
        assertEquals("storage failure leaves no persisted tile entry", 0L, cache.stats()?.entries)
        assertEquals(0L, network.snapshot().completedCacheWrites)
        network.close()
    }

    @Test
    fun `offline cached read never returns unrelated persistent browse entry`() = runBlocking {
        val context = RuntimeEnvironment.getApplication()
        val cache = NativePersistentBrowseCache(context)
        val selectedUrl = "https://tiles.example.test/selected"
        val unrelatedUrl = "https://tiles.example.test/not-in-package"
        assertTrue(cache.write(unrelatedUrl, imageBytes))
        NativeTileNetworkPool.installOfflinePackageMembership { id, url -> id == "selected-package" && url == selectedUrl }
        NativeTileNetworkPool.installOfflineReader { url -> if (url == selectedUrl) imageBytes else null }
        NativeOfflineDisplayPolicy.update(NativeOfflineDisplayPolicyState(enabled = true, packageId = "selected-package", provider = "tianditu"))
        val network = BoundedTileNetwork(Files.createTempDirectory("browse-cache-offline-").toFile(), {}, isValidImage = { true }, persistentCache = cache)
        assertNull(network.readCached(unrelatedUrl))
        assertArrayEquals(imageBytes, network.readCached(selectedUrl))
        network.close()
    }

    @Test
    fun `sha256 cache names preserve lowercase utf8 digest and unsigned byte encoding`() {
        assertEquals(
            "9a6c4f4af02544eff70d5e7c15efcc02598ecba1dbbf5e9d14b6a342471db7c6",
            sha256Hex("https://example.invalid/tiles/4/3/2".toByteArray(Charsets.UTF_8)),
        )
        assertEquals(
            "9f415e9936a20af93da9a5b03989dd5cca87a22d92ea4190a0a03265c513865c",
            sha256Hex(byteArrayOf(0x00, 0x80.toByte(), 0xff.toByte(), 0x10)),
        )
    }

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
        val elapsed = AtomicInteger(1_000)
        val tiles = BoundedTileNetwork(
            Files.createTempDirectory("retry-").toFile(), {},
            TileHttpClient {
                if (calls.incrementAndGet() == 1) TileHttpResponse(429, "0", null)
                else TileHttpResponse(200, null, imageBytes)
            },
            isValidImage = { true },
            elapsedRealtimeMillis = { elapsed.get().toLong() },
            waitForCooldownMillis = { elapsed.addAndGet(it.toInt()) },
        )

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
    fun `foreground map misses use the shared twenty request budget`() = runBlocking {
        val started = CountDownLatch(BoundedTileNetwork.MAX_ACTIVE_REQUESTS)
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

        val tasks = (0 until BoundedTileNetwork.MAX_ACTIVE_REQUESTS).map { index ->
            async(Dispatchers.IO) { network.fetch("https://example.invalid/tile/$index") }
        }
        assertTrue("all submitted foreground requests should start without a fixed cadence", started.await(5, TimeUnit.SECONDS))
        assertEquals(BoundedTileNetwork.MAX_ACTIVE_REQUESTS, maximum.get())
        assertEquals(BoundedTileNetwork.MAX_ACTIVE_REQUESTS, network.snapshot().activeNetworkRequests)
        release.countDown()
        tasks.forEach { assertNotNull(it.await()) }

        assertEquals(BoundedTileNetwork.MAX_ACTIVE_REQUESTS.toLong(), network.snapshot().networkRequests)
        assertEquals(BoundedTileNetwork.MAX_ACTIVE_REQUESTS.toLong(), network.snapshot().successes)
        assertEquals(0L, network.snapshot().errors)
        assertTrue(network.snapshot().queueWaitMs >= 0L)
        assertTrue(network.snapshot().networkMs > 0L)
        network.close()
    }

    @Test
    fun `background bulk work stays within two slots and yields immediately to foreground`() = runBlocking {
        val bulkStarted=CountDownLatch(2)
        val mapStarted=CountDownLatch(4)
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
        assertTrue("background bulk fills its bounded two slots",bulkStarted.await(5,TimeUnit.SECONDS))
        val map=(0 until 4).map { i -> async(Dispatchers.IO) { network.fetch("https://map.invalid/map/$i") } }
        assertTrue("foreground work starts while background bulk is active",mapStarted.await(5,TimeUnit.SECONDS))
        assertEquals(6,network.snapshot().activeNetworkRequests)
        release.countDown()
        bulk.forEach { assertNotNull(it.await()) }; map.forEach { assertNotNull(it.await()) }
        assertEquals(2,maxBulk.get()); assertEquals(4,maxMap.get())
        assertEquals(4,hostMaximum.size)
        assertTrue(hostMaximum.values.all { it.get() <= 4 })
        network.close()
    }

    @Test fun `custom source bulk lane is bounded by background budget`() = runBlocking {
        val fourStarted=CountDownLatch(2)
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
        assertTrue("bulk work respects the shared background slot cap",fourStarted.await(5,TimeUnit.SECONDS))
        assertEquals(2,maximum.get())
        release.countDown()
        tasks.forEach { assertNotNull(it.await()) }
        assertTrue(maximum.get()<=2)
        network.close()
    }

    @Test
    fun `Tianditu subdomains share cooldown`() = runBlocking {
        val calls=AtomicInteger()
        val network=network("shared-tianditu-cooldown") { _, _ ->
            calls.incrementAndGet(); TileHttpResponse(429,"3600",null)
        }.first
        assertNull(withTimeoutOrNull(120) { network.fetch("https://t0.tianditu.gov.cn/img_w/tile/one") })
        assertNull(withTimeoutOrNull(120) { network.fetch("https://t7.tianditu.gov.cn/cva_w/tile/two",bulkDownload=true) })
        assertEquals("429 on any DataServer subdomain cools down the shared host class",1,calls.get())
        assertTrue(network.cooldownRemainingMillis()>=3_500_000L)
        network.close()

    }

    @Test fun `Tianditu shares the twenty slot scheduler without fixed start spacing`() = runBlocking {
        val totalLimit = BoundedTileNetwork.MAX_ACTIVE_REQUESTS
        val backgroundLimit = TileRequestPermitScheduler.MAX_BACKGROUND_ACTIVE
        val started=CountDownLatch(totalLimit)
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
        val maps=(0 until totalLimit - backgroundLimit).map { i -> async(Dispatchers.IO) { network.fetch("https://t${i%8}.tianditu.gov.cn/map/$i") } }
        assertTrue("TDT image requests share the total scheduler",started.await(6,TimeUnit.SECONDS))
        assertEquals(totalLimit,maxActive.get())
        assertEquals(totalLimit - backgroundLimit,maxMap.get())
        assertEquals(backgroundLimit,maxBulk.get())
        assertEquals(totalLimit,network.snapshot().activeNetworkRequests)
        assertTrue("actual concurrency stays within the shared gate",maxActive.get()<=BoundedTileNetwork.MAX_ACTIVE_REQUESTS)
        release.countDown()
        maps.forEach { assertNotNull(it.await()) }
        bulk.forEach { assertNotNull(it.await()) }
        network.close()
    }

    @Test fun `Tianditu foreground requests share the unconstrained server-governed gate`() = runBlocking {
        val started = CountDownLatch(8)
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
        assertTrue("foreground TDT requests should start without client imposed pacing", started.await(6, TimeUnit.SECONDS))
        assertEquals(8, maximum.get())
        val ordered = starts.toList().sorted()
        assertEquals(8, ordered.size)
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
        while(network.snapshot().queuedNetworkRequests==0) {
            check(System.nanoTime()<deadline) { "third Tianditu bulk request did not queue behind bounded background slots" }
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
        val activeLimit = BoundedTileNetwork.MAX_ACTIVE_REQUESTS
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

        kotlinx.coroutines.delay(10)
        queued.cancelAndJoin()
        assertEquals(0, network.snapshot().queuedNetworkRequests)
        assertTrue("a genuinely queued request accumulates queue wait", network.snapshot().queueWaitMs > 0L)
        releaseRequests.countDown()
        activeRequests.forEach { assertNotNull(it.await()) }
        assertEquals(activeLimit.toLong(), network.snapshot().networkRequests)
        network.close()
    }

    @Test
    fun `close wakes queued network requests and leaves no permit waiters`() = runBlocking<Unit> {
        val activeLimit = BoundedTileNetwork.MAX_ACTIVE_REQUESTS
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
        val activeLimit = BoundedTileNetwork.MAX_ACTIVE_REQUESTS
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
        val releasedBy = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
        while (network.snapshot().activeNetworkRequests != 0) {
            check(System.nanoTime() < releasedBy) { "closed HTTP workers must release their slots when they exit" }
            kotlinx.coroutines.yield()
        }
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
    fun `logical identity reopens cache across URL aliases without crossing auth namespaces`() = runBlocking {
        val context = RuntimeEnvironment.getApplication()
        NativePersistentBrowseCache(context).let { cache -> cache.clear(); cache.close() }
        val identity = TileRequestIdentity("source-hash", "img", 7, 21, 19, "style-hash", "credential-hash-a")
        val firstUrl = "https://t0.example.test/tiles/7/21/19?token=private-a"
        val aliasUrl = "https://t7.example.test/tiles/7/21/19?token=private-a"
        val calls = AtomicInteger()
        val firstCache = NativePersistentBrowseCache(context, minFreeBytes = 0)
        val first = BoundedTileNetwork(
            Files.createTempDirectory("identity-cache-first-").toFile(), {},
            TileHttpClient { calls.incrementAndGet(); TileHttpResponse(200, null, imageBytes) },
            isValidImage = { true }, persistentCache = firstCache,
        )
        assertArrayEquals(imageBytes, first.fetch(firstUrl, identity = identity))
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
        while (firstCache.stats()?.entries != 1L) {
            check(System.nanoTime() < deadline) { "identity cache write did not commit" }
            kotlinx.coroutines.delay(10)
        }
        first.close(); firstCache.close()

        val reopenedCalls = AtomicInteger()
        val reopened = BoundedTileNetwork(
            Files.createTempDirectory("identity-cache-reopen-").toFile(), {},
            TileHttpClient { reopenedCalls.incrementAndGet(); TileHttpResponse(200, null, imageBytes) },
            isValidImage = { true }, persistentCache = NativePersistentBrowseCache(context, minFreeBytes = 0),
        )
        assertArrayEquals("stable logical identity reads through a host URL alias after reopen", imageBytes,
            reopened.fetch(aliasUrl, identity = identity))
        assertEquals(0, reopenedCalls.get())
        val otherCredential = identity.copy(authNamespace = "credential-hash-b")
        assertArrayEquals(imageBytes, reopened.fetch(aliasUrl, identity = otherCredential))
        assertEquals("different credentials cannot read the prior identity cache entry", 1, reopenedCalls.get())
        reopened.close()
    }

    @Test
    fun `no-store probe uses network gate but does not populate memory or disk cache`() = runBlocking {
        val calls = AtomicInteger()
        val identity = TileRequestIdentity("probe-source-hash", "image", 0, 0, 0, "probe-style-hash", "no-auth")
        val network = BoundedTileNetwork(
            Files.createTempDirectory("probe-no-store-").toFile(), {},
            TileHttpClient { calls.incrementAndGet(); TileHttpResponse(200, null, imageBytes) },
            isValidImage = { true },
        )
        val url = "https://imagery.example.test/probe.png"
        assertArrayEquals(imageBytes, network.fetchProbe(url, identity))
        assertArrayEquals(imageBytes, network.fetch(url, identity = identity))
        assertEquals("probe response was not cached", 2, calls.get())
        assertEquals(0L, network.snapshot().memoryHits)
        assertEquals(0L, network.snapshot().diskHits)
        network.close()
    }

    @Test
    fun `retry budget persists for generation until explicit retry`() = runBlocking {
        val calls = AtomicInteger()
        val identity = TileRequestIdentity("retry-source-hash", "img", 6, 10, 11, "style-hash", "auth-hash")
        val network = BoundedTileNetwork(
            Files.createTempDirectory("retry-budget-").toFile(), {},
            TileHttpClient { calls.incrementAndGet(); TileHttpResponse(503, null, null) },
            isValidImage = { true },
        )
        val url = "https://tiles.example.test/retry-budget"
        assertNull(network.fetch(url, identity = identity, generation = 4))
        assertEquals(5, calls.get())
        assertNull(network.fetch(url, identity = identity, generation = 4))
        assertEquals("same generation/frame calls do not reset the retry budget", 5, calls.get())
        network.retryTile(url, identity, generation = 4)
        assertNull(network.fetch(url, identity = identity, generation = 4))
        assertEquals("explicit retry grants one new finite budget", 10, calls.get())
        assertNull(network.fetch(url, identity = identity, generation = 5))
        assertEquals("new request generation has a separate bounded budget", 15, calls.get())
        network.close()
    }

    @Test
    fun `cancelling one shared response observer preserves the other observer`() = runBlocking {
        val started = CountDownLatch(1)
        val release = CountDownLatch(1)
        val calls = AtomicInteger()
        val network = BoundedTileNetwork(
            Files.createTempDirectory("single-flight-observer-cancel-").toFile(), {},
            TileHttpClient {
                calls.incrementAndGet(); started.countDown()
                check(release.await(5, TimeUnit.SECONDS))
                TileHttpResponse(200, null, imageBytes)
            }, isValidImage = { true },
        )
        val url = "https://example.invalid/shared-observer"
        val first = async(Dispatchers.IO) { network.fetch(url) }
        assertTrue(started.await(5, TimeUnit.SECONDS))
        val second = async(Dispatchers.IO) { network.fetch(url) }
        kotlinx.coroutines.delay(30)
        first.cancelAndJoin()
        assertEquals(1, network.snapshot().activeNetworkRequests)
        release.countDown()
        assertArrayEquals(imageBytes, second.await())
        assertEquals(1, calls.get())
        network.close()
    }

    @Test
    fun `noncooperative cancelled worker keeps its permit until its IO actually ends`() = runBlocking {
        val started = CountDownLatch(1)
        val otherStarted = CountDownLatch(BoundedTileNetwork.MAX_ACTIVE_REQUESTS - 1)
        val release = CountDownLatch(1)
        val active = AtomicInteger()
        val maximum = AtomicInteger()
        val network = BoundedTileNetwork(
            Files.createTempDirectory("worker-slot-release-").toFile(), {},
            TileHttpClient { url ->
                val now = active.incrementAndGet()
                maximum.updateAndGet { old -> maxOf(old, now) }
                if (url.endsWith("/stuck")) {
                    started.countDown()
                    while (release.count > 0) {
                        try { release.await() } catch (_: InterruptedException) { /* Deliberately noncooperative fake. */ }
                    }
                } else {
                    otherStarted.countDown()
                    check(release.await(5, TimeUnit.SECONDS))
                }
                active.decrementAndGet()
                TileHttpResponse(200, null, imageBytes)
            }, isValidImage = { true },
        )
        val cancelledObserver = async(Dispatchers.IO) { withTimeoutOrNull(120) { network.fetch("https://example.invalid/stuck") } }
        assertTrue(started.await(5, TimeUnit.SECONDS))
        assertNull("observer timeout returns while the noncooperative worker still owns its permit", cancelledObserver.await())
        val remaining = (0 until BoundedTileNetwork.MAX_ACTIVE_REQUESTS).map { index ->
            async(Dispatchers.IO) { network.fetch("https://example.invalid/other/$index") }
        }
        assertTrue("only the other nineteen I/O workers may start while the cancelled worker is still alive",
            otherStarted.await(5, TimeUnit.SECONDS))
        assertEquals(BoundedTileNetwork.MAX_ACTIVE_REQUESTS, network.snapshot().activeNetworkRequests)
        assertTrue(maximum.get() <= BoundedTileNetwork.MAX_ACTIVE_REQUESTS)
        release.countDown()
        remaining.forEach { assertNotNull(it.await()) }
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
        while (network.snapshot().activeNetworkRequests != 0) {
            check(System.nanoTime() < deadline) { "all worker permits should return after underlying I/O ends" }
            kotlinx.coroutines.yield()
        }
        network.close()
    }

    @Test
    fun `long Retry-After blocks every tile for that host`() = runBlocking {
        val calls = AtomicInteger()
        val network = network("host-cooldown") { _, _ ->
            calls.incrementAndGet()
            TileHttpResponse(429, "3600", null)
        }.first

        assertNull(withTimeoutOrNull(120) { network.fetch("https://example.invalid/tile/first") })
        assertNull(withTimeoutOrNull(120) { network.fetch("https://example.invalid/tile/second") })
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

        assertNull(withTimeoutOrNull(120) { network.fetch("https://example.invalid/tile/first") })
        assertNull(withTimeoutOrNull(120) { network.fetch("https://example.invalid/tile/second") })
        assertEquals(1, calls.get())
        assertTrue(network.cooldownRemainingMillis() > 30_000L)
        network.close()
    }

    @Test
    fun `legacy cache directory is read only without persistent cache`() = runBlocking {
        val directory = Files.createTempDirectory("shantu-reopen-").toFile()
        val url = "https://example.invalid/tile/one"
        val legacyTile = directory.resolve("${sha256Hex(url.toByteArray(Charsets.UTF_8))}.tile").apply { writeBytes(imageBytes) }
        val savedAt = legacyTile.lastModified()

        val calls = AtomicInteger()
        val reopened = BoundedTileNetwork(directory, {}, TileHttpClient { calls.incrementAndGet(); TileHttpResponse(503, null, null) }, { true })
        assertArrayEquals(imageBytes, reopened.fetch(url))
        assertEquals(0, calls.get())
        assertEquals(1L, reopened.snapshot().diskHits)
        assertEquals(1L, reopened.snapshot().successes)
        assertEquals(0L, reopened.snapshot().networkRequests)
        assertArrayEquals(imageBytes, reopened.fetch(url))
        assertEquals(1L, reopened.snapshot().memoryHits)
        assertEquals("legacy hit does not refresh its timestamp or rewrite the old file", savedAt, legacyTile.lastModified())
        assertTrue(!reopened.snapshot().toString().contains("example.invalid"))
        reopened.close()
    }

    @Test
    fun `expired disk tile is fetched again`() = runBlocking {
        val directory = Files.createTempDirectory("shantu-expiry-").toFile()
        val url = "https://example.invalid/tile/expired"
        val tileFile = directory.resolve("${sha256Hex(url.toByteArray(Charsets.UTF_8))}.tile").apply { writeBytes(imageBytes) }
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
        val directory = Files.createTempDirectory("shantu-corrupt-").toFile()
        val url = "https://example.invalid/tile/corrupt"
        val tileFile = directory.resolve("${sha256Hex(url.toByteArray(Charsets.UTF_8))}.tile").apply { writeBytes(byteArrayOf(1, 2, 3)) }
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
        assertEquals(5L, tiles.snapshot().networkRequests)
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
        assertEquals(5L, rejecting.snapshot().networkRequests)
        assertEquals(1L, rejecting.snapshot().errors)
        assertEquals(0L, rejecting.snapshot().successes)
        assertEquals((imageBytes.size * 5).toLong(), rejecting.snapshot().receivedBytes)
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
        val releaseExtension = CountDownLatch(1)
        val initialRateLimited = CountDownLatch(1)
        lateinit var network: BoundedTileNetwork
        val client = TileHttpClient { url ->
            calls.incrementAndGet()
            if (url.endsWith("/initial")) {
                initialRateLimited.countDown()
                TileHttpResponse(429, "1", null)
            }
            else {
                extensionStarted.countDown()
                check(releaseExtension.await(5, TimeUnit.SECONDS))
                TileHttpResponse(429, "3600", null)
            }
        }
        network = BoundedTileNetwork(
            Files.createTempDirectory("shantu-extended-cooldown-").toFile(), {}, client, { true },
        )
        val extension = async(Dispatchers.IO) { network.fetch("https://example.invalid/extension") }
        assertTrue(extensionStarted.await(5, TimeUnit.SECONDS))
        val initial = async(Dispatchers.IO) { network.fetch("https://example.invalid/initial") }
        assertTrue(initialRateLimited.await(5, TimeUnit.SECONDS))
        releaseExtension.countDown()
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
        while (network.snapshot().rateLimits < 2L) {
            check(System.nanoTime() < deadline) { "concurrent Retry-After did not extend shared cooldown" }
            kotlinx.coroutines.yield()
        }
        assertEquals(2, calls.get())
        assertTrue(network.cooldownRemainingMillis() >= 3_500_000L)
        extension.cancelAndJoin(); initial.cancelAndJoin()
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
