package com.shantu.nativeapp.map

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean

/** Full identity for contour output; XYZ alone is insufficient across different DEM inputs. */
internal data class NativeContourGeometryKey(
    val z: Int,
    val x: Int,
    val sourceY: Int,
    val intervalMeters: Int,
    val sampleSha256: String,
) {
    companion object {
        /** Hashes the complete sample array using a small reusable chunk, without a full byte copy. */
        fun fromSamples(z: Int, x: Int, sourceY: Int, intervalMeters: Int, samples: DoubleArray): NativeContourGeometryKey {
            require(z >= 0 && x >= 0 && sourceY >= 0 && intervalMeters > 0 && samples.isNotEmpty())
            val digest = MessageDigest.getInstance("SHA-256")
            val chunk = ByteBuffer.allocate(8192).order(ByteOrder.BIG_ENDIAN)
            chunk.putLong(samples.size.toLong())
            for (sample in samples) {
                if (chunk.remaining() < java.lang.Long.BYTES) {
                    digest.update(chunk.array(), 0, chunk.position())
                    chunk.clear()
                }
                chunk.putLong(java.lang.Double.doubleToRawLongBits(sample))
            }
            if (chunk.position() > 0) digest.update(chunk.array(), 0, chunk.position())
            val hex = "0123456789abcdef"
            val hash = digest.digest().joinToString("") { byte ->
                val value = byte.toInt() and 0xff
                "${hex[value ushr 4]}${hex[value and 0x0f]}"
            }
            return NativeContourGeometryKey(z, x, sourceY, intervalMeters, hash)
        }
    }
}

/**
 * Process-local deduplication whose map retains values only while at least one map pane owns a lease.
 * Cache misses are serialized by NativeContourProcessBudget before calling [acquireOrCreate].
 */
internal class NativeContourGeometryStore<K : Any, V : Any> {
    private class Entry<V : Any>(val value: V, var references: Int) {
        val token = Any()
    }
    private val lock = Any()
    private val entries = HashMap<K, Entry<V>>()

    class Lease<V : Any> internal constructor(
        value: V,
        private val releaseValue: () -> Boolean,
    ) : AutoCloseable {
        private val closed = AtomicBoolean(false)
        @Volatile private var retainedValue: V? = value

        val value: V get() = checkNotNull(retainedValue) { "Contour geometry lease has been released" }

        /** Returns true only for the owner that released the final lease. */
        fun release(): Boolean {
            if (!closed.compareAndSet(false, true)) return false
            return try { releaseValue() } finally { retainedValue = null }
        }
        fun valueIfActive(): V? = retainedValue
        override fun close() { release() }
    }

    /** The factory is called outside the store lock; production callers serialize CPU-only misses globally. */
    fun acquireOrCreate(key: K, create: () -> V): Lease<V> {
        synchronized(lock) {
            entries[key]?.let { entry ->
                entry.references++
                return lease(key, entry)
            }
        }

        val candidate = create()
        synchronized(lock) {
            val entry = entries[key]
            if (entry != null) {
                // Defensive race handling. The process assembly lane normally prevents a duplicate build.
                entry.references++
                return lease(key, entry)
            }
            val created = Entry(candidate, 1)
            entries[key] = created
            return lease(key, created)
        }
    }

    private fun lease(key: K, expected: Entry<V>): Lease<V> {
        val token = expected.token
        return try {
            // Capture only the small token/key, never Entry itself, so a released lease cannot retain V.
            Lease(expected.value) { releaseLease(key, token) }
        } catch (failure: Throwable) {
        // Even allocation failure while wrapping a large geometry must not leak its reference.
            synchronized(lock) {
                if (entries[key] === expected && expected.references > 0) {
                    expected.references--
                    if (expected.references == 0) entries.remove(key)
                }
            }
            throw failure
        }
    }

    private fun releaseLease(key: K, token: Any): Boolean = synchronized(lock) {
        val entry = entries[key]
        if (entry == null || entry.token !== token) return@synchronized false
        check(entry.references > 0)
        entry.references--
        if (entry.references == 0) {
            entries.remove(key)
            true
        } else false
    }

    fun snapshot(): Snapshot = synchronized(lock) {
        Snapshot(entries.size, entries.values.sumOf { it.references })
    }

    data class Snapshot(val activeGeometryEntries: Int, val activeLeases: Int)
}
