package com.shantu.nativeapp.geology

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class NativeWorldMvtDecoderTest {
    @Test fun `world decoder accepts ordinary complete feature and keeps existing decoder contract`() {
        val encoded = tile(feature(3))
        assertEquals(1, NativeMvtDecoder.decodeWorld(encoded).size)
        assertEquals(1, NativeMvtDecoder.decode(encoded).size)
    }

    @Test fun `world decoder rejects complete tile when feature ceiling is crossed`() {
        val encoded = tile(feature(3), feature(3))
        assertEquals(2, NativeMvtDecoder.decode(encoded).size)
        assertThrows(NativeMvtTileLimitException::class.java) {
            NativeMvtDecoder.decodeWorld(encoded, NativeWorldMvtLimits(maxFeatures = 1))
        }
    }

    @Test fun `world decoder rejects whole tile when per feature vertex ceiling is crossed`() {
        assertThrows(NativeMvtTileLimitException::class.java) {
            NativeMvtDecoder.decodeWorld(tile(feature(5)), NativeWorldMvtLimits(maxVerticesPerFeature = 4))
        }
    }

    @Test fun `world decoder rejects whole tile when cumulative path budget is crossed`() {
        assertThrows(NativeMvtTileLimitException::class.java) {
            NativeMvtDecoder.decodeWorld(tile(feature(3), feature(3)), NativeWorldMvtLimits(maxPaths = 1))
        }
    }

    @Test fun `world decoder rejects whole tile when cumulative vertex budget is crossed`() {
        assertThrows(NativeMvtTileLimitException::class.java) {
            NativeMvtDecoder.decodeWorld(tile(feature(3), feature(3)), NativeWorldMvtLimits(maxVertices = 5))
        }
    }

    private fun tile(vararg features: ByteArray): ByteArray = field(3, buildList {
        addAll(field(1, "units".encodeToByteArray()).toList())
        features.forEach { addAll(field(2, it).toList()) }
    }.toByteArray())

    private fun feature(vertices: Int): ByteArray {
        require(vertices >= 3)
        val geometry = buildList {
            addAll(varint((1 shl 3) or 1).toList()); add(0); add(0)
            addAll(varint(((vertices - 1) shl 3) or 2).toList())
            repeat((vertices - 1) * 2) { add(0) }
            addAll(varint((1 shl 3) or 7).toList())
        }.toByteArray()
        return varint((3 shl 3) or 0) + varint(3) + field(4, geometry)
    }

    private fun field(number: Int, payload: ByteArray): ByteArray =
        varint((number shl 3) or 2) + varint(payload.size) + payload

    private fun varint(value: Int): ByteArray {
        require(value >= 0)
        var current = value
        val bytes = mutableListOf<Byte>()
        while (current >= 0x80) {
            bytes += ((current and 0x7f) or 0x80).toByte()
            current = current ushr 7
        }
        bytes += current.toByte()
        return bytes.toByteArray()
    }
}
