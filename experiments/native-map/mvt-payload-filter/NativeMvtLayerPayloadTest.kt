package com.shantu.nativeapp.map

import earth.worldwind.layer.mvt.MvtDecoder
import earth.worldwind.layer.mvt.MvtSchemaDetector

import java.io.ByteArrayOutputStream
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeMvtLayerPayloadTest {
    @Test
    fun keepsSelectedLayersByteExactAndPreservesOrderAndDecodedGeometryAndAttributes() {
        val roads = layer("transportation", withFeature = true)
        val discarded = layer("discarded", withFeature = true)
        val water = layer("waterway", withFeature = true)
        val input = tile(roads, discarded, water)

        val filtered = NativeMvtLayerPayload.filter(input, setOf("transportation", "waterway"))
        val decoded = MvtDecoder.decode(filtered)

        assertEquals(listOf("transportation", "discarded", "waterway"), decoded.layers.map { it.name })
        assertEquals(1, decoded.layers[0].features.size)
        assertEquals(0, decoded.layers[1].features.size)
        assertTrue(decoded.layers[1].keys.isEmpty())
        assertTrue(decoded.layers[1].values.isEmpty())
        assertEquals(1, decoded.layers[2].features.size)
        assertArrayEquals(intArrayOf(9, 10, 20, 18, 30, 40), decoded.layers[0].features[0].geometry)
        assertEquals(mapOf("class" to "primary"), decoded.layers[0].features[0].toProperties(decoded.layers[0]))
        assertTrue("selected layer bytes must remain unchanged", containsBytes(filtered, layerField(roads)))
        assertTrue("selected layer bytes must remain unchanged", containsBytes(filtered, layerField(water)))
        assertEquals(2, decoded.layers[1].version)
        assertEquals(4096, decoded.layers[1].extent)
    }

    @Test
    fun schemaDetectionIsStableBecauseFilteredLayerNamesRemain() {
        val input = tile(
            layer("transportation", withFeature = true),
            layer("waterway", withFeature = true),
            layer("largeUnusedLayer", withFeature = true)
        )
        val before = MvtSchemaDetector.detect(MvtDecoder.decode(input))

        val filtered = NativeMvtLayerPayload.filter(input, setOf("transportation", "waterway"))
        val decoded = MvtDecoder.decode(filtered)

        assertEquals(listOf("transportation", "waterway", "largeUnusedLayer"), decoded.layers.map { it.name })
        assertEquals(before, MvtSchemaDetector.detect(decoded))
        assertEquals(MvtSchemaDetector.Schema.OPENMAPTILES, before)
    }

    @Test
    fun emptyTileAndUnchangedTileReturnOriginalArray() {
        val empty = byteArrayOf()
        assertSame(empty, NativeMvtLayerPayload.filter(empty, setOf("roads")))

        val onlySelected = tile(layer("roads", withFeature = true))
        assertSame(onlySelected, NativeMvtLayerPayload.filter(onlySelected, setOf("roads")))
    }

    @Test
    fun preservesUnknownTopLevelFieldsAndUnknownLayerFields() {
        val unknownVarint = varintField(10, 300)
        val unknownFixed64 = field(11, 1, ByteArray(8) { (it + 1).toByte() })
        val unknownDelimited = bytesField(12, byteArrayOf(4, 5, 6))
        val unknownFixed32 = field(13, 5, byteArrayOf(7, 8, 9, 10))
        val unknownLayer = varintField(20, 12345)
        val dropped = layer("discard", withFeature = true, extra = unknownLayer)
        val input = concat(unknownVarint, unknownFixed64, tile(dropped), unknownDelimited, unknownFixed32)

        val filtered = NativeMvtLayerPayload.filter(input, emptySet())
        val decoded = MvtDecoder.decode(filtered)

        assertEquals(listOf("discard"), decoded.layers.map { it.name })
        assertEquals(0, decoded.layers.single().features.size)
        assertTrue(containsBytes(filtered, unknownVarint))
        assertTrue(containsBytes(filtered, unknownFixed64))
        assertTrue(containsBytes(filtered, unknownDelimited))
        assertTrue(containsBytes(filtered, unknownFixed32))
        assertTrue(containsBytes(filtered, unknownLayer))
    }

    @Test
    fun parsesAndReframesMultibyteLayerAndOuterLengths() {
        val longName = "layer-" + "x".repeat(180)
        val selected = layer(longName, withFeature = true)
        val input = tile(layer("noise", withFeature = true), selected)
        assertTrue(selected.size > 127)

        val filtered = NativeMvtLayerPayload.filter(input, setOf(longName))
        val decoded = MvtDecoder.decode(filtered)

        assertEquals(listOf("noise", longName), decoded.layers.map { it.name })
        assertEquals(0, decoded.layers[0].features.size)
        assertEquals(1, decoded.layers[1].features.size)
        assertTrue(containsBytes(filtered, layerField(selected)))
    }

    @Test
    fun malformedLengthsVarintsTruncationAndUnsupportedWireTypesReturnOriginal() {
        val malformed = listOf(
            byteArrayOf(0x1a, 0x05, 0x0a, 0x01), // outer layer length exceeds input
            byteArrayOf(0x80.toByte()), // truncated tag varint
            ByteArray(10) { if (it == 9) 0x02 else 0x80.toByte() }, // 64-bit varint overflow
            byteArrayOf(0x1b), // unsupported start-group wire type
            byteArrayOf(0x09, 0x01, 0x02), // truncated fixed64 unknown field
            byteArrayOf(0x1a, 0x02, 0x0a, 0x05), // truncated layer name length
            byteArrayOf(0x1a, 0x02, 0x18, 0x80.toByte()), // truncated varint inside layer
            byteArrayOf(0x1a, 0x02, 0x1b, 0x00), // unsupported wire inside layer
        )

        for (bytes in malformed) {
            assertSame(bytes, NativeMvtLayerPayload.filter(bytes, emptySet()))
        }
    }

    private fun layer(
        name: String,
        withFeature: Boolean,
        extra: ByteArray = byteArrayOf()
    ): ByteArray = concat(
        varintField(15, 2),
        bytesField(1, name.encodeToByteArray()),
        if (withFeature) bytesField(2, feature()) else byteArrayOf(),
        bytesField(3, "class".encodeToByteArray()),
        bytesField(4, bytesField(1, "primary".encodeToByteArray())),
        varintField(5, 4096),
        extra
    )

    private fun feature(): ByteArray = concat(
        varintField(1, 7),
        bytesField(2, byteArrayOf(0, 0)), // packed key/value index pair
        varintField(3, 2), // LINESTRING
        bytesField(4, byteArrayOf(9, 10, 20, 18, 30, 40))
    )

    private fun tile(vararg layers: ByteArray): ByteArray = concat(*layers.map(::layerField).toTypedArray())

    private fun layerField(payload: ByteArray): ByteArray = bytesField(3, payload)

    private fun bytesField(number: Int, payload: ByteArray): ByteArray =
        concat(encodeVarint(((number shl 3) or 2).toLong()), encodeVarint(payload.size.toLong()), payload)

    private fun varintField(number: Int, value: Long): ByteArray =
        concat(encodeVarint((number shl 3).toLong()), encodeVarint(value))

    private fun field(number: Int, wire: Int, payload: ByteArray): ByteArray =
        concat(encodeVarint(((number shl 3) or wire).toLong()), payload)

    private fun encodeVarint(value: Long): ByteArray {
        val out = ByteArrayOutputStream()
        var remaining = value
        while (remaining and 0x7fL.inv() != 0L) {
            out.write(((remaining and 0x7fL) or 0x80L).toInt())
            remaining = remaining ushr 7
        }
        out.write(remaining.toInt())
        return out.toByteArray()
    }

    private fun concat(vararg arrays: ByteArray): ByteArray {
        val out = ByteArrayOutputStream()
        arrays.forEach(out::write)
        return out.toByteArray()
    }

    private fun containsBytes(haystack: ByteArray, needle: ByteArray): Boolean {
        if (needle.isEmpty()) return true
        if (needle.size > haystack.size) return false
        for (start in 0..haystack.size - needle.size) {
            var matches = true
            for (i in needle.indices) if (haystack[start + i] != needle[i]) {
                matches = false
                break
            }
            if (matches) return true
        }
        return false
    }
}
