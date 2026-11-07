package com.guanyun.weather

import android.content.Intent
import android.content.ClipData
import android.net.Uri
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.net.SocketTimeoutException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], manifest = Config.NONE)
class GooglePlaceLinkResolverTest {
    private val destination = "https://www.google.com/maps/place/Central+Park/@40.78,-73.96,15z"

    @Test fun strictUrlPolicyAcceptsOnlyExactHostsAndMapsPaths() {
        listOf(
            "https://maps.app.goo.gl/abc", "https://goo.gl/maps/abc",
            "https://google.com/maps?q=park", "https://www.google.com/maps/place/x", "https://maps.google.com/maps/@1,2",
            "https://maps.google.com/?q=10,20(Name)"
        ).forEach { assertTrue("$it", GooglePlaceLinkResolver.isGoogleMapsUrl(it)) }
        listOf(
            "http://maps.app.goo.gl/abc", "https://maps.app.goo.gl.evil.test/abc", "https://goo.gl/abc", "https://goo.gl/maps",
            "https://google.com/search?q=x", "https://www.google.com.evil.test/maps", "https://maps.google.com/",
            "https://www.google.com/mapsfoo", "https://maps.google.com/?q=Central+Park",
            "https://user@www.google.com/maps", "https://www.google.com:444/maps", "https://www.google.com:80/maps",
            "https://www.google.com/maps" + "a".repeat(8193)
        ).forEach { assertFalse("$it", GooglePlaceLinkResolver.isGoogleMapsUrl(it)) }
        assertEquals("https://maps.app.goo.gl/abc", GooglePlaceLinkResolver.extractGoogleMapsUrl("Central Park https://maps.app.goo.gl/abc."))
        assertNull(GooglePlaceLinkResolver.extractGoogleMapsUrl("https://evil.example/maps"))
        assertEquals("https://maps.google.com/?q=10,20(Name)", GooglePlaceLinkResolver.extractGoogleMapsUrl("https://maps.google.com/?q=10,20(Name)"))
        assertNull(GooglePlaceLinkResolver.extractGoogleMapsUrl("https://maps.app.goo.gl/one https://example.test/file"))
        assertNull(GooglePlaceLinkResolver.extractGoogleMapsUrl("geo:10,20 https://maps.app.goo.gl/one"))
    }

    @Test fun shortLinkFollowsRelativeRedirectAndReturnsLongGoogleMapsUrl() {
        val seen = mutableListOf<String>()
        val resolver = resolver { url, _, _ ->
            seen += url
            if (seen.size == 1) GooglePlaceLinkResolver.Response(302, "/maps/place/Central+Park")
            else GooglePlaceLinkResolver.Response(302, destination)
        }
        val result = resolver.resolve("https://maps.app.goo.gl/abc")
        assertTrue(result.reason, result.success)
        assertEquals(destination, result.url)
        assertEquals(2, seen.size)
    }

    @Test fun rejectsCrossDomainRedirectLoopsHttpErrorsAndHtmlResponses() {
        val cross = resolver { _, _, _ -> GooglePlaceLinkResolver.Response(302, "https://evil.example/maps") }.resolve("https://goo.gl/maps/abc")
        assertFalse(cross.success); assertTrue(cross.reason.contains("跳转"))

        var calls = 0
        val loop = resolver { _, _, _ -> calls++; GooglePlaceLinkResolver.Response(302, "https://maps.app.goo.gl/abc") }
            .resolve("https://maps.app.goo.gl/abc")
        assertFalse(loop.success); assertTrue(loop.reason.contains("循环")); assertEquals(1, calls)

        val httpError = resolver { _, _, _ -> GooglePlaceLinkResolver.Response(503, null) }.resolve("https://goo.gl/maps/abc")
        assertFalse(httpError.success); assertTrue(httpError.retryable); assertTrue(httpError.reason.contains("503"))

        val html = resolver { _, _, _ -> GooglePlaceLinkResolver.Response(200, null) }.resolve("https://goo.gl/maps/abc")
        assertFalse(html.success); assertFalse(html.retryable); assertTrue(html.reason.contains("网页"))
    }

    @Test fun timeoutIsRetryableAndEachRequestGetsBoundedTimeouts() {
        var connect = 0; var read = 0
        val result = resolver { _, c, r -> connect = c; read = r; throw SocketTimeoutException() }
            .resolve("https://maps.app.goo.gl/abc")
        assertFalse(result.success); assertTrue(result.retryable)
        assertTrue(connect in 1..5000); assertTrue(read in 1..5000)
    }

    @Test fun retryKeepsSessionTokenAndTransitionsFromFailedToReceived() {
        val calls = AtomicInteger()
        val receiver = IncomingPlaces({}, resolver { _, _, _ ->
            if (calls.incrementAndGet() == 1) GooglePlaceLinkResolver.Response(503, null)
            else GooglePlaceLinkResolver.Response(302, destination)
        })
        try {
            assertTrue(receiver.accept(send("https://maps.app.goo.gl/retry")))
            await { info(receiver)["state"] == "failed" }
            val id = info(receiver).getString("token")
            assertTrue(info(receiver).getBoolean("retryable"))
            assertTrue(receiver.retry(id))
            await { info(receiver)["state"] == "received" }
            assertEquals(id, info(receiver).getString("token"))
            assertEquals(destination, info(receiver).getString("raw"))
            assertFalse(receiver.retry(id))
        } finally { receiver.close() }
    }

    @Test fun stalledTransportHasIndependentDeadlineEvenWhenItIgnoresInterrupts() {
        val entered = CountDownLatch(1); val release = CountDownLatch(1)
        val receiver = IncomingPlaces({}, resolver { _, _, _ ->
            entered.countDown()
            awaitIgnoringInterrupts(release)
            GooglePlaceLinkResolver.Response(302, destination)
        }, 80L)
        try {
            receiver.accept(send("https://maps.app.goo.gl/stalled"))
            assertTrue(entered.await(2, TimeUnit.SECONDS))
            await { info(receiver).getString("state") == "failed" }
            assertTrue(info(receiver).getBoolean("retryable"))
            assertTrue(info(receiver).getString("reason").contains("短链接不含坐标"))
            assertEquals("", info(receiver).getString("raw"))
            release.countDown(); Thread.sleep(60)
            assertEquals("failed", info(receiver).getString("state"))
        } finally { receiver.close(); release.countDown() }
    }

    @Test fun timedOutAttemptCannotOverwriteSameTokenRetryAndQueueAlsoTimesOut() {
        val firstEntered = CountDownLatch(1); val release = CountDownLatch(1)
        val calls = AtomicInteger()
        val receiver = IncomingPlaces({}, resolver { _, _, _ ->
            if (calls.incrementAndGet() == 1) {
                firstEntered.countDown(); awaitIgnoringInterrupts(release)
                GooglePlaceLinkResolver.Response(302, "https://www.google.com/maps?q=1,2")
            } else GooglePlaceLinkResolver.Response(302, destination)
        }, 100L)
        try {
            receiver.accept(send("https://maps.app.goo.gl/stalled-retry"))
            assertTrue(firstEntered.await(2, TimeUnit.SECONDS))
            await { info(receiver).getString("state") == "failed" }
            val token = info(receiver).getString("token")
            assertTrue(receiver.retry(token))
            await { info(receiver).getString("state") == "failed" }
            assertEquals(1, calls.get()) // queued work also gets a deadline
            assertTrue(receiver.retry(token))
            release.countDown()
            await { info(receiver).getString("state") == "received" }
            assertEquals(token, info(receiver).getString("token"))
            assertEquals(destination, info(receiver).getString("raw"))
            assertEquals(2, calls.get())
        } finally { receiver.close(); release.countDown() }
    }

    @Test fun coordinateLongLinkSucceedsWithoutAnyTransportOrGoogleConnectivity() {
        val receiver = IncomingPlaces({}, resolver { _, _, _ -> throw AssertionError("network must not be used") }, 30L)
        try {
            val coordinateUrl = "https://www.google.com/maps?q=10,20(Synthetic+Park)"
            assertTrue(receiver.accept(send(coordinateUrl)))
            assertEquals("received", info(receiver).getString("state"))
            assertEquals(coordinateUrl, info(receiver).getString("raw"))
            Thread.sleep(60)
            assertEquals("received", info(receiver).getString("state"))
        } finally { receiver.close() }
    }

    @Test fun newIntentDropsOldResultAndCloseCancelsNotification() {
        val entered = CountDownLatch(1); val release = CountDownLatch(1)
        val resolver = resolver { _, _, _ ->
            entered.countDown()
            try { release.await(2, TimeUnit.SECONDS) } catch (_: InterruptedException) { }
            GooglePlaceLinkResolver.Response(302, "https://www.google.com/maps/place/Old+Share/data=!3d10!4d20")
        }
        val receiver = IncomingPlaces({}, resolver)
        try {
            assertTrue(receiver.accept(send("https://maps.app.goo.gl/slow")))
            assertTrue(entered.await(2, TimeUnit.SECONDS))
            assertTrue(receiver.accept(Intent(Intent.ACTION_VIEW, Uri.parse(destination))))
            val secondToken = info(receiver)["token"]
            release.countDown()
            await { info(receiver)["state"] == "received" }
            assertEquals(secondToken, info(receiver)["token"])
            assertEquals(destination, info(receiver)["raw"])

        } finally { receiver.close(); release.countDown() }
    }

    @Test fun redirectsHaveAHopLimitAndLongLinksDoNotFetchPages() {
        var calls = 0
        val bounded = resolver { _, _, _ -> calls++; GooglePlaceLinkResolver.Response(302, "https://maps.app.goo.gl/hop$calls") }
        assertFalse(bounded.resolve("https://maps.app.goo.gl/start").success)
        assertEquals(GooglePlaceLinkResolver.MAX_HOPS, calls)
        calls = 0
        assertTrue(bounded.resolve(destination).success)
        assertEquals(0, calls)
    }

    @Test fun dismissDuringResolutionCannotResurrectItsSession() {
        val entered = CountDownLatch(1); val release = CountDownLatch(1)
        val receiver = IncomingPlaces({}, resolver { _, _, _ ->
            entered.countDown()
            try { release.await(2, TimeUnit.SECONDS) } catch (_: InterruptedException) { }
            GooglePlaceLinkResolver.Response(302, destination)
        })
        try {
            receiver.accept(send("https://maps.app.goo.gl/cancel"))
            assertTrue(entered.await(2, TimeUnit.SECONDS))
            receiver.dismiss(info(receiver).getString("token")); release.countDown()
            Thread.sleep(80)
            assertEquals("empty", info(receiver).getString("state"))
            assertEquals("", info(receiver).getString("token"))
        } finally { receiver.close(); release.countDown() }
    }

    @Test fun closeCancelsAndSuppressesLateCompletion() {
        val entered = CountDownLatch(1); val release = CountDownLatch(1); val notices = AtomicInteger()
        val receiver = IncomingPlaces({ notices.incrementAndGet() }, resolver { _, _, _ ->
            entered.countDown()
            try { release.await(2, TimeUnit.SECONDS) } catch (_: InterruptedException) { }
            GooglePlaceLinkResolver.Response(302, destination)
        })
        assertTrue(receiver.accept(send("https://maps.app.goo.gl/close")))
        assertTrue(entered.await(2, TimeUnit.SECONDS))
        val beforeClose = notices.get()
        receiver.close(); release.countDown(); Thread.sleep(80)
        assertEquals(beforeClose, notices.get())
    }

    @Test fun documentImportDoesNotReplaceOrCancelPendingPlace() {
        val entered = CountDownLatch(1); val release = CountDownLatch(1)
        val resolver = resolver { _, _, _ -> entered.countDown(); release.await(2, TimeUnit.SECONDS); GooglePlaceLinkResolver.Response(302, destination) }
        val receiver = IncomingPlaces({}, resolver)
        try {
            assertTrue(receiver.accept(send("https://maps.app.goo.gl/pending")))
            assertTrue(entered.await(2, TimeUnit.SECONDS))
            val before = info(receiver)
            val file = Intent(Intent.ACTION_SEND).setType("application/gpx+xml")
                .putExtra(Intent.EXTRA_STREAM, Uri.parse("content://files/route.gpx"))
            assertFalse(receiver.accept(file))
            assertEquals(before["token"], info(receiver)["token"])
            assertEquals("resolving", info(receiver)["state"])
        } finally { receiver.close(); release.countDown() }
    }

    @Test fun googleTextWithDocumentStreamLeavesFileImportInControl() {
        val receiver = IncomingPlaces({}, resolver { _, _, _ -> GooglePlaceLinkResolver.Response(302, destination) })
        try {
            val shared = send("https://maps.app.goo.gl/one")
                .putExtra(Intent.EXTRA_STREAM, Uri.parse("content://files/route.gpx"))
            assertFalse(receiver.accept(shared))
            assertEquals("empty", info(receiver).getString("state"))
            val wrongMime = Intent(Intent.ACTION_SEND).setType("text/html").putExtra(Intent.EXTRA_TEXT, "https://maps.app.goo.gl/one")
            assertFalse(receiver.accept(wrongMime))
            assertEquals("empty", info(receiver).getString("state"))
        } finally { receiver.close() }
    }

    @Test fun shareTitlePrefersSubjectThenTextPrefixAndIgnoresGoogleMapsGenericTitle() {
        val receiver = IncomingPlaces({}, resolver { _, _, _ -> GooglePlaceLinkResolver.Response(302, destination) })
        try {
            receiver.accept(send("Central Park\nhttps://www.google.com/maps/place/Central+Park"))
            assertEquals("Central Park", info(receiver)["title"])
            val subject = send("Park\nhttps://www.google.com/maps/place/Central+Park")
                .putExtra(Intent.EXTRA_SUBJECT, "Google Maps")
            receiver.accept(subject)
            assertEquals("Park", info(receiver)["title"])
        } finally { receiver.close() }
    }

    @Test fun textLinkWithClipDataThumbnailUsesGooglePlaceAndExtraTitle() {
        val receiver = IncomingPlaces({}, resolver { _, _, _ -> GooglePlaceLinkResolver.Response(302, destination) })
        try {
            val shared = send("https://www.google.com/maps?q=10,20")
                .putExtra(Intent.EXTRA_TITLE, "Synthetic Trail Entrance")
                .putExtra(Intent.EXTRA_SUBJECT, "Google Maps")
            shared.clipData = ClipData.newRawUri("preview", Uri.parse("content://preview/image"))
            assertTrue(receiver.accept(shared))
            assertEquals("received", info(receiver).getString("state"))
            assertEquals("https://www.google.com/maps?q=10,20", info(receiver).getString("raw"))
            assertEquals("Synthetic Trail Entrance", info(receiver).getString("title"))
        } finally { receiver.close() }
    }

    @Test fun documentOnlyClipDataAndDocumentMimeAreNotTreatedAsTextPreviews() {
        val receiver = IncomingPlaces({}, resolver { _, _, _ -> GooglePlaceLinkResolver.Response(302, destination) })
        try {
            val clip = ClipData.newRawUri("route", Uri.parse("content://files/route.gpx"))
            val document = Intent(Intent.ACTION_SEND).setType("application/gpx+xml")
                .putExtra(Intent.EXTRA_TEXT, "https://www.google.com/maps?q=10,20")
            document.clipData = clip
            assertFalse(receiver.accept(document))
            val textFile = Intent(Intent.ACTION_SEND).setType("text/plain")
            textFile.clipData = clip
            assertFalse(receiver.accept(textFile))
            assertEquals("empty", info(receiver).getString("state"))
        } finally { receiver.close() }
    }

    @Test fun amapSendAndExactViewAreAcceptedWithoutNetwork() {
        val receiver = IncomingPlaces({}, resolver { _, _, _ -> throw AssertionError("Amap links must never use transport") })
        try {
            val amap = "https://m.amap.com/poi/detail?__p=BSYNTHETIC01%2C31.234567%2C121.345678%2CSynthetic%20Place%2CSynthetic%20Address&poiid=BSYNTHETIC01"
            assertTrue(receiver.accept(send(amap)))
            assertEquals("received", info(receiver).getString("state"))
            assertEquals(amap, info(receiver).getString("raw"))
            assertTrue(receiver.accept(Intent(Intent.ACTION_VIEW, Uri.parse(amap))))
            assertEquals("received", info(receiver).getString("state"))
            assertEquals(amap, info(receiver).getString("raw"))
        } finally { receiver.close() }
    }

    @Test fun amapThumbnailIsAllowedButExplicitStreamAndDocumentMimeKeepFileImport() {
        val receiver = IncomingPlaces({}, resolver { _, _, _ -> throw AssertionError("Amap links must never use transport") })
        try {
            val amap = "https://m.amap.com/poi/detail?__p=BSYNTHETIC01%2C31.234567%2C121.345678%2CSynthetic%20Place%2CSynthetic%20Address"
            val thumbnail = send(amap)
            thumbnail.clipData = ClipData.newRawUri("preview", Uri.parse("content://preview/image"))
            assertTrue(receiver.accept(thumbnail))
            assertEquals(amap, info(receiver).getString("raw"))
            val stream = send(amap).putExtra(Intent.EXTRA_STREAM, Uri.parse("content://files/route.gpx"))
            assertFalse(receiver.accept(stream))
            val document = Intent(Intent.ACTION_SEND).setType("application/gpx+xml")
                .putExtra(Intent.EXTRA_TEXT, amap).putExtra(Intent.EXTRA_STREAM, Uri.parse("content://files/route.gpx"))
            assertFalse(receiver.accept(document))
            val documentWithoutUri = Intent(Intent.ACTION_SEND).setType("application/gpx+xml").putExtra(Intent.EXTRA_TEXT, amap)
            assertFalse(receiver.accept(documentWithoutUri))
            assertEquals("received", info(receiver).getString("state"))
        } finally { receiver.close() }
    }

    @Test fun mixedAndUnsafeAmapLinksAreNeverSelectedAsPlaceUrls() {
        val receiver = IncomingPlaces({}, resolver { _, _, _ -> throw AssertionError("Amap links must never use transport") })
        try {
            val amap = "https://m.amap.com/poi/detail?__p=BSYNTHETIC01%2C31.234567%2C121.345678%2CSynthetic%20Place%2CSynthetic%20Address"
            listOf(
                "$amap https://example.test/track",
                "https://m.amap.com.evil.test/poi/detail?__p=synthetic",
                "https://user@m.amap.com/poi/detail?__p=synthetic",
                "https://m.amap.com/poi/detail/extra?__p=synthetic"
            ).forEach { text ->
                assertTrue(receiver.accept(send(text)))
                assertEquals("unsupported", info(receiver).getString("state"))
                assertEquals("", info(receiver).getString("raw"))
            }
            assertFalse(receiver.accept(Intent(Intent.ACTION_VIEW, Uri.parse("https://m.amap.com.evil.test/poi/detail?__p=synthetic"))))
        } finally { receiver.close() }
    }

    private fun resolver(block: (String, Int, Int) -> GooglePlaceLinkResolver.Response) =
        GooglePlaceLinkResolver(object : GooglePlaceLinkResolver.Transport {
            override fun get(url: String, connectTimeoutMs: Int, readTimeoutMs: Int) = block(url, connectTimeoutMs, readTimeoutMs)
        })

    private fun send(text: String) = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
    private fun awaitIgnoringInterrupts(latch: CountDownLatch) {
        val end = System.nanoTime() + TimeUnit.SECONDS.toNanos(3)
        while (System.nanoTime() < end) {
            try { if (latch.await(20, TimeUnit.MILLISECONDS)) return } catch (_: InterruptedException) { }
        }
    }
    private fun info(receiver: IncomingPlaces) = JSONObject(receiver.info())
    private fun await(predicate: () -> Boolean) {
        val until = System.nanoTime() + TimeUnit.SECONDS.toNanos(3)
        while (System.nanoTime() < until) { if (predicate()) return; Thread.sleep(10) }
        assertTrue("condition timed out", predicate())
    }
}
