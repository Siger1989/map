package com.shantu.nativeapp.map

import earth.worldwind.layer.source.TileBlob
import earth.worldwind.layer.source.TileSource
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class NativeMvtLayerSourceTest {
    private class Source(var blob: TileBlob?) : TileSource {
        var cachedCalls = 0
        var fetchCalls = 0
        var closed = false
        var args: List<Any?> = emptyList()
        override suspend fun tryReadCachedTile(z: Int,x: Int,y: Int): TileBlob? {
            cachedCalls++; args = listOf(z,x,y); return blob
        }
        override suspend fun fetchTile(z: Int,x: Int,y: Int,previousEtag: String?,previousLastModified: String?): TileBlob? {
            fetchCalls++; args = listOf(z,x,y,previousEtag,previousLastModified); return blob
        }
        override fun close() { closed = true }
    }
    // Tile.layers = {name:"unused", features:{}} -- well-formed, minimal feature payload.
    private val raw = byteArrayOf(26,10,10,6,117,110,117,115,101,100,18,0)

    @Test fun `decode view preserves original cache and blob metadata without another fetch`() = runBlocking {
        val blob = TileBlob(raw, "etag", "modified", "application/vnd.mapbox-vector-tile", 1234)
        val source = Source(blob)
        val names = mutableSetOf("transportation")
        val view = NativeMvtLayerSource(source,names)
        names.add("unused") // Constructor takes a snapshot of the fixed style contract.
        val selected = view.tryReadCachedTile(4,5,6)!!
        assertTrue(selected.bytes.size < raw.size)
        assertSame(raw,source.blob!!.bytes)
        assertEquals("etag",selected.etag); assertEquals("modified",selected.lastModified)
        assertEquals(blob.contentType,selected.contentType); assertEquals(1234L,selected.cachedAt)
        assertEquals(listOf(4,5,6),source.args)
        assertEquals(1,source.cachedCalls); assertEquals(0,source.fetchCalls)
        view.close(); assertFalse(source.closed)
    }

    @Test fun `fetch preserves conditional headers and missing empty malformed results`() = runBlocking {
        val source = Source(null)
        val view = NativeMvtLayerSource(source,setOf("transportation"))
        assertNull(view.fetchTile(3,2,1,"e","m"))
        assertEquals(listOf(3,2,1,"e","m"),source.args)
        source.blob = TileBlob.EMPTY
        assertSame(TileBlob.EMPTY,view.tryReadCachedTile(3,2,1))
        source.blob = TileBlob(byteArrayOf(26,127,10))
        assertSame(source.blob,view.fetchTile(3,2,1,null,null))
        source.blob = TileBlob(raw)
        val all = NativeMvtLayerSource(source,setOf("unused"))
        assertSame(source.blob,all.tryReadCachedTile(3,2,1))
    }
}
