package com.shantu.nativeapp.map

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.concurrent.CompletionException
import java.util.concurrent.TimeoutException
import javax.net.ssl.SSLHandshakeException

class NativeTileFailureTest {
    @Test fun classifiesDnsTlsAndTimeoutFromExceptionTypesAndCauses() {
        val dns = CompletionException(IOException("sensitive host and query").apply {
            initCause(UnknownHostException("private-host.invalid"))
        })
        assertEquals(NativeTileFailureKind.DOMAIN_UNRESOLVED, classifyNativeTileFailure(dns))
        assertEquals(NativeTileFailureKind.TLS_CONNECTION, classifyNativeTileFailure(SSLHandshakeException("private key text")))
        assertEquals(NativeTileFailureKind.TIMEOUT, classifyNativeTileFailure(SocketTimeoutException("full private URL")))
        assertEquals(NativeTileFailureKind.TIMEOUT, classifyNativeTileFailure(CompletionException(TimeoutException("opaque provider message"))))
        assertEquals(NativeTileFailureKind.OTHER, classifyNativeTileFailure(IOException("unclassified private detail")))
    }

    @Test fun causeTraversalStopsAtItsDepthBoundAndOnCycles() {
        var deep: Throwable = UnknownHostException("synthetic")
        repeat(40) {
            deep = IOException("wrapper").apply { initCause(deep) }
        }
        assertEquals(NativeTileFailureKind.OTHER, classifyNativeTileFailure(deep))

        val first = IOException("first")
        val second = IOException("second")
        first.initCause(second)
        second.initCause(first)
        assertEquals(NativeTileFailureKind.OTHER, classifyNativeTileFailure(first))
    }

    @Test fun statusMessagesContainOnlySafeCategoriesAndRetryState() {
        val error = UnknownHostException("private-host.invalid/path?token=fixture-only")
        val retrying = nativeTileFailureStatus(error, retryExhausted = false)
        val exhausted = nativeTileFailureStatus(error, retryExhausted = true)
        assertEquals("图源域名无法解析；当前瓦片暂缓，可点重试", retrying)
        assertEquals("图源域名无法解析；已达到本轮重试上限", exhausted)
        assertFalse(retrying.contains("private-host.invalid"))
        assertFalse(retrying.contains("token"))
        assertFalse(retrying.contains("fixture-only"))
    }
}
