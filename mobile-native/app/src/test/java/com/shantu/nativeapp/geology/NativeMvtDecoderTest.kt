package com.shantu.nativeapp.geology

import org.junit.Assert.*
import org.junit.Test

class NativeMvtDecoderTest {
    @Test fun `decodes MVT units properties and polygon geometry`() {
        val geometry = packed(varint(9) + varint(2) + varint(2) + varint(18) + varint(8) + varint(0) + varint(0) + varint(8) + varint(15) + varint(9) + varint(4) + varint(4) + varint(18) + varint(2) + varint(0) + varint(0) + varint(2) + varint(15))
        val feature = field(2, packed(varint(0) + varint(0) + varint(1) + varint(1))) + field(3, 3L) + field(4, geometry)
        val layer = field(1, str("units")) + field(2, feature) + field(3, str("name")) + field(3, str("color")) + field(4, field(1, str("Jurassic"))) + field(4, field(1, str("#112233"))) + field(5, 2048L)
        val decoded = NativeMvtDecoder.decode(field(3, layer))
        assertEquals(1, decoded.size)
        assertEquals("units", decoded.single().layer)
        assertEquals(3, decoded.single().type)
        assertEquals(2048, decoded.single().extent)
        assertEquals("Jurassic", decoded.single().properties["name"])
        assertEquals(2, decoded.single().paths.size)
        assertEquals(listOf(1 to 1, 5 to 1, 5 to 5, 1 to 1), decoded.single().paths.first())
        assertEquals(listOf(7 to 7, 8 to 7, 8 to 8, 7 to 7), decoded.single().paths.last())
        val unit = geologyUnit(decoded.single().properties)
        assertEquals("#112233", unit.color)
        assertEquals("Jurassic", unit.name)
    }

    @Test fun `empty tile remains empty and malformed protobuf fails closed`() {
        assertTrue(NativeMvtDecoder.decode(byteArrayOf()).isEmpty())
        assertTrue(NativeMvtDecoder.decode(field(3, field(1, str("units")))).isEmpty())
        assertThrows(IllegalArgumentException::class.java) { NativeMvtDecoder.decode(byteArrayOf(0x1a, 0x7f)) }
    }

    @Test fun `multilinestring MoveTo starts a new path without resetting delta cursor`() {
        val geometry = packed(
            varint(9) + varint(zig(10)) + varint(zig(20)) +
                varint(18) + varint(zig(5)) + varint(zig(0)) + varint(zig(0)) + varint(zig(5)) +
                varint(9) + varint(zig(85)) + varint(zig(75)) +
                varint(10) + varint(zig(10)) + varint(zig(0))
        )
        val decoded = NativeMvtDecoder.decode(encodedTile("lines", 2, geometry)).single()

        assertEquals(listOf(listOf(10 to 20, 15 to 20, 15 to 25), listOf(100 to 100, 110 to 100)), decoded.paths)
    }

    @Test fun `multipoint MoveTo count remains one path containing all points`() {
        val geometry = packed(
            varint(25) + varint(zig(1)) + varint(zig(1)) +
                varint(zig(1)) + varint(zig(1)) + varint(zig(2)) + varint(zig(1))
        )
        val decoded = NativeMvtDecoder.decode(encodedTile("points", 1, geometry)).single()

        assertEquals(listOf(listOf(1 to 1, 2 to 2, 4 to 3)), decoded.paths)
    }

    @Test fun `geocloud authorization failures are distinct from empty and generic errors`() {
        assertEquals(NativeGeologyStatus.AUTHORIZATION, geologyCloudFailureStatus(401))
        assertEquals(NativeGeologyStatus.AUTHORIZATION, geologyCloudFailureStatus(403))
        assertEquals(NativeGeologyStatus.ERROR, geologyCloudFailureStatus(503))
        assertEquals(NativeGeologyStatus.ERROR, geologyCloudFailureStatus(502))
    }

    @Test fun `floating decoder reserves label features before building budget`() {
        val point = packed(varint(9) + varint(zig(20)) + varint(zig(30)))
        val labelFeature = field(2, packed(varint(0) + varint(0))) + field(3, 1L) + field(4, point)
        val labelLayer = field(1, str("place_label")) + field(2, labelFeature) +
            field(3, str("name")) + field(4, field(1, str("Sample Place"))) + field(5, 4096L)
        val building = encodedTile("building", 1, point)
        val buildingLayer = PbForTest.payloadOfTile(building)
        val tile = field(3, buildingLayer) + field(3, labelLayer)
        val decoded = NativeMvtDecoder.decodeForFloatingMap(tile, NativeMvtDecodeLimits(maxFeatures = 1, maxLabelFeatures = 1))

        assertEquals(listOf("place_label"), decoded.features.map { it.layer })
        assertEquals("Sample Place", decoded.features.single().properties["name"])
        assertEquals(1, decoded.stats.acceptedFeatures)
        assertTrue(decoded.stats.scannedFeatures >= 2)
    }

    @Test fun `floating decoder candidate cap counts skipped features without materializing them`() {
        val point = packed(varint(9) + varint(zig(2)) + varint(zig(3)))
        val feature = field(3, 1L) + field(4, point)
        val layer = field(1, str("transportation")) + field(2, feature) + field(2, feature) + field(2, feature) + field(5, 4096L)
        val decoded = NativeMvtDecoder.decodeForFloatingMap(field(3, layer), NativeMvtDecodeLimits(maxCandidatesPerPriority = 2))

        assertEquals(2, decoded.features.size)
        assertEquals(3, decoded.stats.scannedFeatures)
        assertEquals(1, decoded.stats.candidateCapSkipped)
    }

    @Test fun `floating label reserve also respects remaining global vertex budget`() {
        val twoPoints = packed(varint(17) + varint(zig(1)) + varint(zig(1)) + varint(zig(2)) + varint(zig(0)))
        val feature = field(3, 1L) + field(4, twoPoints)
        val labelLayer = field(1, str("place_label")) + field(2, feature) + field(2, feature) + field(5, 4096L)
        val decoded = NativeMvtDecoder.decodeForFloatingMap(field(3, labelLayer), NativeMvtDecodeLimits(
            maxVertices = 3, maxLabelFeatures = 4, maxLabelVertices = 10, maxFeatures = 4,
        ))

        assertEquals(1, decoded.features.size)
        assertEquals(2, decoded.stats.acceptedVertices)
        assertEquals(1, decoded.stats.skippedByLabelReserve)
    }

    @Test fun `floating decoder rejects a whole geometry above command budget`() {
        val geometry = packed(varint(9) + varint(zig(0)) + varint(zig(0)) +
            varint(18) + varint(zig(1)) + varint(zig(0)) + varint(zig(1)) + varint(zig(0)))
        val decoded = NativeMvtDecoder.decodeForFloatingMap(encodedTile("road", 2, geometry), NativeMvtDecodeLimits(maxGeometryCommandsPerFeature = 2))

        assertTrue(decoded.features.isEmpty())
        assertEquals(1, decoded.stats.commandLimitSkipped)
    }

    @Test fun `floating decoder fails closed on malformed or oversized input`() {
        assertThrows(IllegalArgumentException::class.java) {
            NativeMvtDecoder.decodeForFloatingMap(byteArrayOf(0x1a, 0x7f))
        }
        assertThrows(IllegalArgumentException::class.java) {
            NativeMvtDecoder.decodeForFloatingMap(ByteArray(4 * 1024 * 1024 + 1), NativeMvtDecodeLimits(maxBytes = 8 * 1024 * 1024))
        }
    }

    private fun str(s:String)=s.toByteArray()
    private fun field(n:Int,payload:ByteArray)=varint(n*8+2)+varint(payload.size)+payload
    private fun field(n:Int,payload:Long)=varint(n*8)+varint(payload)
    private fun encodedTile(layerName:String,type:Int,geometry:ByteArray):ByteArray {
        val feature = field(3, type.toLong()) + field(4, geometry)
        val layer = field(1, str(layerName)) + field(2, feature) + field(5, 4096L)
        return field(3, layer)
    }
    private object PbForTest {
        fun payloadOfTile(tile: ByteArray): ByteArray {
            var i = 0
            while (i < tile.size) {
                var tag = 0; var shift = 0
                while (true) { val b = tile[i++].toInt() and 255; tag = tag or ((b and 127) shl shift); if (b < 128) break; shift += 7 }
                require((tag ushr 3) == 3 && (tag and 7) == 2)
                var length = 0; shift = 0
                while (true) { val b = tile[i++].toInt() and 255; length = length or ((b and 127) shl shift); if (b < 128) break; shift += 7 }
                return tile.copyOfRange(i, i + length)
            }
            error("tile layer missing")
        }
    }
    private fun zig(value:Int)=(value shl 1) xor (value shr 31)
    private fun packed(payload:ByteArray)=payload
    private fun varint(v:Int):ByteArray=varint(v.toLong())
    private fun varint(value:Long):ByteArray { var v=value;val out=mutableListOf<Byte>();while(v>127){out+=(v.toInt() and 127 or 128).toByte();v=v ushr 7};out+=v.toByte();return out.toByteArray() }
}
