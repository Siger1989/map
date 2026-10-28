package com.shantu.nativeapp.geology

import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertTrue
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.net.ServerSocket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class NativeGeologyCancellationTest {
    @Test fun `tile body reader caps allocation at limit plus one and maps failures safely`() {
        var bytesRead = 0
        val oversized = object : java.io.InputStream() {
            override fun read(): Int { bytesRead++; return 1 }
            override fun read(b: ByteArray, off: Int, len: Int): Int {
                val n = minOf(len, 1_000_000 - bytesRead)
                if (n <= 0) return -1
                java.util.Arrays.fill(b, off, off + n, 1.toByte())
                bytesRead += n
                return n
            }
        }
        val error = assertThrows(IllegalStateException::class.java) { boundedHttpRead(oversized, 32, "安全错误") }
        assertEquals("安全错误", error.message)
        assertEquals(33, bytesRead)
        assertThrows(IllegalStateException::class.java) { checkDeclaredLength(33, 32, "声明长度超限") }
        checkDeclaredLength(-1, 32, "unknown")
    }

    @Test fun `bounded tile body observes interrupt before reading`() {
        Thread.currentThread().interrupt()
        try {
            assertThrows(java.util.concurrent.CancellationException::class.java) {
                boundedHttpRead(java.io.ByteArrayInputStream(byteArrayOf(1)), 32, "safe")
            }
        } finally { Thread.interrupted() }
    }

    @Test fun `tile HTTP disconnects promptly when its coroutine is cancelled`() = runBlocking {
        val server = ServerSocket(0)
        val accepted = CountDownLatch(1)
        val closed = CountDownLatch(1)
        val serverThread = Thread {
            server.accept().use { socket ->
                accepted.countDown()
                try { while (socket.getInputStream().read() >= 0) Unit } catch (_: Exception) { }
                closed.countDown()
            }
        }.apply { isDaemon = true; start() }
        try {
            val request = async { cancellableHttp(java.net.URL("http://127.0.0.1:${server.localPort}/tile")) }
            assertTrue(accepted.await(2, TimeUnit.SECONDS))
            request.cancelAndJoin()
            assertTrue("cancel must close the active socket", closed.await(2, TimeUnit.SECONDS))
        } finally {
            server.close()
            serverThread.join(1000)
        }
    }
}
