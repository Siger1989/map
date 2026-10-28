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
        assertEquals(listOf(1 to 1, 5 to 1, 5 to 5, 1 to 1), decoded.single().paths.first())
        assertEquals(listOf(3 to 3, 4 to 3, 4 to 4, 3 to 3), decoded.single().paths.last())
        val unit = geologyUnit(decoded.single().properties)
        assertEquals("#112233", unit.color)
        assertEquals("Jurassic", unit.name)
    }

    @Test fun `empty tile remains empty and malformed protobuf fails closed`() {
        assertTrue(NativeMvtDecoder.decode(byteArrayOf()).isEmpty())
        assertTrue(NativeMvtDecoder.decode(field(3, field(1, str("units")))).isEmpty())
        assertThrows(IllegalArgumentException::class.java) { NativeMvtDecoder.decode(byteArrayOf(0x1a, 0x7f)) }
    }

    @Test fun `geocloud authorization failures are distinct from empty and generic errors`() {
        assertEquals(NativeGeologyStatus.AUTHORIZATION, geologyCloudFailureStatus(401))
        assertEquals(NativeGeologyStatus.AUTHORIZATION, geologyCloudFailureStatus(403))
        assertEquals(NativeGeologyStatus.ERROR, geologyCloudFailureStatus(503))
        assertEquals(NativeGeologyStatus.ERROR, geologyCloudFailureStatus(502))
    }

    private fun str(s:String)=s.toByteArray()
    private fun field(n:Int,payload:ByteArray)=varint(n*8+2)+varint(payload.size)+payload
    private fun field(n:Int,payload:Long)=varint(n*8)+varint(payload)
    private fun packed(payload:ByteArray)=payload
    private fun varint(v:Int):ByteArray=varint(v.toLong())
    private fun varint(value:Long):ByteArray { var v=value;val out=mutableListOf<Byte>();while(v>127){out+=(v.toInt() and 127 or 128).toByte();v=v ushr 7};out+=v.toByte();return out.toByteArray() }
}
