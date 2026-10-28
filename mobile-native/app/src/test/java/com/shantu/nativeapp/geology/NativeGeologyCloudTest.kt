package com.shantu.nativeapp.geology

import org.junit.Assert.*
import org.junit.Test

class NativeGeologyCloudTest {
    @Test fun `missing user authorization fails without a network request`() = kotlinx.coroutines.runBlocking {
        val client=NativeGeologyCloudClient(NativeGeologyCredentialProvider{null})
        try { client.capabilities(); org.junit.Assert.fail("missing credential should be rejected") } catch (_:NativeGeologyAuthorizationException) { }
        client.close()
    }
    @Test fun `capabilities validates authorized map title projection matrices and source legend`() {
        val xml = """<Capabilities xmlns:xlink="http://www.w3.org/1999/xlink"><Contents><Layer><Title>全国地质图 1:200,000</Title><Identifier>geology-200k</Identifier><Format>image/png</Format><Style isDefault="true"><Identifier>default</Identifier><LegendURL><OnlineResource xlink:href="https://geocloud.cgs.gov.cn/legend.png"/></LegendURL></Style><TileMatrixSetLink><TileMatrixSet>EPSG:3857</TileMatrixSet><TileMatrixSetLimits><TileMatrixLimits><TileMatrix>0</TileMatrix><MinTileRow>0</MinTileRow><MaxTileRow>1</MaxTileRow><MinTileCol>0</MinTileCol><MaxTileCol>1</MaxTileCol></TileMatrixLimits></TileMatrixSetLimits></TileMatrixSetLink></Layer><TileMatrixSet><Identifier>EPSG:3857</Identifier><SupportedCRS>urn:ogc:def:crs:EPSG::3857</SupportedCRS><TileMatrix><Identifier>0</Identifier><ScaleDenominator>559082264.0287178</ScaleDenominator><TopLeftCorner>-20037508.342789244 20037508.342789244</TopLeftCorner><TileWidth>256</TileWidth><TileHeight>256</TileHeight><MatrixWidth>2</MatrixWidth><MatrixHeight>2</MatrixHeight></TileMatrix></TileMatrixSet></Contents></Capabilities>"""
        val metadata = parseGeocloudCapabilities(xml)
        assertEquals("geology-200k", metadata.layer)
        assertEquals("mercator", metadata.projection)
        assertEquals("EPSG:3857", metadata.matrixSet)
        assertEquals("image/png", metadata.format)
        assertTrue(metadata.hasLegend)
        assertEquals(1, metadata.matrices.size)
        assertEquals(1, metadata.matrices.single().maxRow)
    }

    @Test fun `capabilities refuse unrelated or insecurely structured services`() {
        val bad = """<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><Capabilities>&e;</Capabilities>"""
        assertThrows(IllegalArgumentException::class.java) { parseGeocloudCapabilities(bad) }
        assertEquals(NativeGeologyStatus.AUTHORIZATION, geologyCloudFailureStatus(401))
        assertEquals(NativeGeologyStatus.AUTHORIZATION, geologyCloudFailureStatus(403))
        assertEquals(NativeGeologyStatus.ERROR, geologyCloudFailureStatus(502))
    }
}
