package com.shantu.nativeapp.map

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NativeMapSourceTest {
    @Test
    fun `parses xyz source and expands subdomain and token without leaking in string form`() {
        val catalog = NativeMapSourceCatalog.fromJson(JSONObject("""
            {"maps":[{"id":"fixture","name":"Fixture","format":"XYZ","tiles":["https://{s}.example.invalid/{z}/{x}/{y}?key={token}"],"subdomains":["a","b"],"token":"fixture-token","minzoom":2,"maxzoom":12,"tileSize":256,"attribution":"Fixture source"}]}
        """))

        assertTrue(catalog.errors.isEmpty())
        val source = catalog.sources.single()
        assertEquals("https://a.example.invalid/3/4/5?key=fixture-token", source.tileUrl(4, 5, 3))
        assertEquals("Fixture source", source.attribution)
        assertFalse(source.toString().contains("fixture-token"))
        assertFalse(source.toString().contains("example.invalid"))
    }

    @Test
    fun `runtime coordinate-system preference overrides source datum without changing source metadata`() {
        val source = NativeMapSourceCatalog.fromJson(JSONObject("""
            {"maps":[{"id":"fixture","format":"XYZ","tiles":["https://tiles.example.invalid/{z}/{x}/{y}"],"datum":"gcj02","minzoom":0,"maxzoom":8}]}
        """)).sources.single()
        val corrected = source.withDatum(NativeRasterDatum.BD09)
        assertEquals(NativeRasterDatum.GCJ02, source.datum)
        assertEquals(NativeRasterDatum.BD09, corrected.datum)
        assertEquals(source.id, corrected.id)
        assertEquals(source.tileUrl(2, 3, 4), corrected.tileUrl(2, 3, 4))
    }

    @Test
    fun `tms flips y and wmts aliases use matrix coordinates`() {
        val tms = NativeMapSourceCatalog.fromJson(JSONObject("""
            {"mapSources":[{"id":"tms","tiles":["https://tiles.example.invalid/{z}/{x}/{y}"],"scheme":"tms","minzoom":0,"maxzoom":8}]}
        """ )).sources.single()
        assertEquals("https://tiles.example.invalid/3/2/5", tms.tileUrl(2, 2, 3))

        val wmts = NativeMapSourceCatalog.fromJson(JSONObject("""
            {"maps":[{"id":"wmts","format":"WMTS","tiles":["https://tiles.example.invalid/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}"],"tileMatrixSet":"GoogleMapsCompatible","minzoom":0,"maxzoom":10}]}
        """ )).sources.single()
        assertEquals("https://tiles.example.invalid/GoogleMapsCompatible/4/6/7", wmts.tileUrl(7, 6, 4))
    }

    @Test
    fun `xyz resolver expands quadkey prefix and web mercator bbox`() {
        val source = NativeMapSourceCatalog.fromJson(JSONObject("""
            {"maps":[{"id":"derived","tiles":["https://tiles.example.invalid/{z}/{x}/{y}/{quadkey}/{prefix}?bbox={bbox-epsg-3857}"],"minzoom":0,"maxzoom":8}]}
        """ )).sources.single()
        val url = source.tileUrl(2, 3, 3)
        assertTrue(url.contains("/3/2/3/032/23?bbox="))
        assertBbox(url, "bbox=", -10_018_754.171394622, 0.0, -5_009_377.085697312, 5_009_377.085697312)
    }

    @Test
    fun `accepts original high density 1024 and 2048 tile sizes`() {
        val catalog = NativeMapSourceCatalog.fromJson(JSONObject("""
            {"maps":[
              {"id":"dense-1024","tileSize":1024,"tiles":["https://tiles.example.invalid/1024/{z}/{x}/{y}"]},
              {"id":"dense-2048","tileSize":2048,"tiles":["https://tiles.example.invalid/2048/{z}/{x}/{y}"]}
            ]}
        """))
        assertTrue(catalog.errors.toString(), catalog.errors.isEmpty())
        assertEquals(listOf(1024, 2048), catalog.sources.map { it.tileSize })
        assertEquals("https://tiles.example.invalid/2048/4/2/3", catalog.sources[1].tileUrl(2, 3, 4))
    }

    @Test
    fun `quadkey-only and bbox-only raster addresses are valid`() {
        val catalog = NativeMapSourceCatalog.fromJson(JSONObject("""
            {"maps":[
              {"id":"quadkey-only","tiles":["https://tiles.example.invalid/{quadkey}"],"minzoom":0,"maxzoom":8},
              {"id":"bbox-only","tiles":["https://tiles.example.invalid/render?bbox={bbox-epsg-3857}"],"minzoom":0,"maxzoom":8}
            ]}
        """))
        assertTrue(catalog.errors.isEmpty())
        assertEquals("https://tiles.example.invalid/032", catalog.sources[0].tileUrl(2, 3, 3))
        assertBbox(catalog.sources[1].tileUrl(2, 3, 3), "bbox=", -10_018_754.171394622, 0.0, -5_009_377.085697312, 5_009_377.085697312)
    }

    @Test
    fun `unsupported matrix types and missing local source files are reported rather than accepted`() {
        val catalog = NativeMapSourceCatalog.fromJson(JSONObject("""
            {"maps":[
              {"id":"local","kind":"mbtiles","tiles":["https://tiles.example.invalid/{z}/{x}/{y}"]},
              {"id":"bad-crs","crs":"EPSG:4326","tiles":["https://tiles.example.invalid/{z}/{x}/{y}"]},
              {"id":"bad-placeholder","tiles":["https://tiles.example.invalid/{z}/{x}/{scale}"]},
              {"id":"division-by-zero","format":"OVMAP","tiles":["https://tiles.example.invalid/{\u0024x/0}/{\u0024y}/{\u0024z}"]}
            ]}
        """))

        assertTrue(catalog.sources.isEmpty())
        assertEquals(4, catalog.errors.size)
        assertTrue(catalog.errors[0].reason.contains("本地离线地图文件不存在"))
        assertTrue(catalog.errors[1].reason.contains("Web Mercator"))
        assertTrue(catalog.errors[2].reason.contains("占位符"))
        assertTrue(catalog.errors[3].reason.contains("变量"))
    }

    @Test fun `calibrated image source retains image dispatch kind`() {
        val image = File.createTempFile("native-calibrated-source-", ".png").apply { writeBytes(byteArrayOf(1, 2, 3)) }
        try {
            val catalog = NativeMapSourceCatalog.fromJson(JSONObject().put("maps", org.json.JSONArray().put(JSONObject()
                .put("id", "calibrated").put("name", "Calibrated").put("kind", "image").put("format", "PNG image")
                .put("filePath", image.absolutePath).put("minzoom", 0).put("maxzoom", 22).put("bounds", org.json.JSONArray(listOf(10.0, 20.0, 11.0, 21.0))))))
            assertTrue(catalog.errors.toString(), catalog.errors.isEmpty())
            assertEquals("image", catalog.sources.single().kind)
            assertEquals("PNG image", catalog.sources.single().format)
        } finally { image.delete() }
    }

    @Test
    fun `resolved ovmap base and overlay tiles remain usable through source zoom 23`() {
        val catalog = NativeMapSourceCatalog.fromJson(JSONObject("""
            {"maps":[{"id":"fixture-ovmap","name":"Resolved source","kind":"online","format":"OVMAP","minzoom":3,"maxzoom":22,"tileSize":256,"datum":"wgs84","ovmap":{"layers":[{"tiles":["https://tiles.example.invalid/{z}/{x}/{y}"],"tileSize":256,"minzoom":3,"maxzoom":23},{"tiles":["https://overlay.example.invalid/{\u0024z-1}/{\u0024x/2}/{\u0024y/2}"],"tileSize":512,"subdivide":true,"minzoom":5,"maxzoom":22}]}}]}
        """))

        assertTrue(catalog.errors.isEmpty())
        val source = catalog.sources.single()
        assertEquals(23, source.maxZoom)
        assertEquals("https://tiles.example.invalid/23/1/2", source.tileUrl(1, 2, 23))
        assertEquals(2, source.layers.size)
        assertEquals(22, source.layers[1].outputMaxZoom)
        // OVMAP arithmetic maps an output z22 tile to the provider's z21 parent tile.
        assertEquals("https://overlay.example.invalid/21/1/2", source.tileUrl(1, 3, 4, 22))
        assertTrue(source.limitations.isEmpty())
    }

    @Test
    fun `gcj and bd09 datums are accepted for raster reprojection`() {
        val catalog = NativeMapSourceCatalog.fromJson(JSONObject("""
            {"maps":[{"id":"shifted","datum":"gcj02","tiles":["https://tiles.example.invalid/{z}/{x}/{y}"]},{"id":"bd","datum":"bd09","tiles":["https://tiles.example.invalid/{z}/{x}/{y}"]}]}
        """))
        assertTrue(catalog.errors.isEmpty())
        assertEquals(listOf(NativeRasterDatum.GCJ02, NativeRasterDatum.BD09), catalog.sources.map { it.datum })
        val wgs = NativeRasterProjection.plan(12, 3370, 1645, 256, NativeRasterDatum.WGS84)
        val gcj = NativeRasterProjection.plan(12, 3370, 1645, 256, NativeRasterDatum.GCJ02)
        val bd = NativeRasterProjection.plan(12, 3370, 1645, 256, NativeRasterDatum.BD09)
        assertTrue(gcj.points.indices.filter { it % 2 == 0 }.any { kotlin.math.abs(gcj.points[it] - wgs.points[it]) > 0.01 })
        assertTrue(bd.points.indices.filter { it % 2 == 1 }.any { kotlin.math.abs(bd.points[it] - gcj.points[it]) > 0.01 })
    }

    /** Optional local-only smoke; emits structural counts and parser reasons, never private URLs or tokens. */
    @Test
    fun `private native source asset smoke when explicitly enabled`() {
        val path = System.getenv("SHANTU_PRIVATE_SOURCE_SMOKE")?.takeIf(String::isNotBlank) ?: return
        val root = JSONObject(File(path).readText())
        val catalog = NativeMapSourceCatalog.fromJson(root)
        val safeErrors = catalog.errors.joinToString(separator = ";") { "index=${it.index},reason=${it.reason}" }
        println("private-source-smoke valid=${catalog.sources.size} errors=${catalog.errors.size} $safeErrors")
        assertEquals("all expected private map sources must parse", 39, catalog.sources.size)
        assertTrue("private source parser errors: $safeErrors", catalog.errors.isEmpty())
    }

    private fun assertBbox(url: String, marker: String, vararg expected: Double) {
        val actual = url.substringAfter(marker).split(',').map(String::toDouble)
        assertEquals(expected.size, actual.size)
        expected.indices.forEach { index -> assertEquals(expected[index], actual[index], 0.02) }
    }
}
