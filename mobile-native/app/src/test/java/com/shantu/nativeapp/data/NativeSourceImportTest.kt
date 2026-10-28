package com.shantu.nativeapp.data

import android.util.Base64
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.ByteArrayOutputStream
import java.net.URLEncoder
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.charset.StandardCharsets
import java.util.zip.Deflater

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NativeSourceImportTest {
    @Test
    fun `json import validates xyz tms wmts and keeps unknown fields`() {
        val input = """
            {"maps":[
              {"id":"x","name":"XYZ","format":"XYZ","tiles":["https://tiles.example.invalid/{z}/{x}/{y}.png"],"minzoom":0,"maxzoom":18,"tileSize":256,"futureField":{"preserve":true}},
              {"id":"t","name":"TMS","format":"TMS","scheme":"tms","tiles":["https://tiles.example.invalid/{z}/{x}/{y}.png"],"minzoom":1,"maxzoom":18,"tileSize":256},
              {"id":"w","name":"WMTS","format":"WMTS","tileMatrixSet":"GoogleMapsCompatible","tiles":["https://tiles.example.invalid/wmts/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}"],"minzoom":0,"maxzoom":18,"tileSize":256},
              {"id":"bad","name":"Unsupported","kind":"online","type":"vector","tiles":["https://tiles.example.invalid/{z}/{x}/{y}"],"minzoom":0,"maxzoom":18,"tileSize":256}
            ]}
        """.trimIndent()
        val result = NativeSourceImport.parseJson(input)
        assertEquals(NativeSourceImportFormat.JSON, result.format)
        assertEquals(3, result.entries.size)
        assertEquals(1, result.issues.size)
        assertTrue(result.entries.first().toJson().getJSONObject("futureField").getBoolean("preserve"))
        assertFalse(result.toString().contains("example.invalid"))
    }

    @Test fun `export map validator combines local files and online entries against one count and byte cap`() {
        val maps = org.json.JSONArray()
        maps.put(JSONObject().put("id", "local-1").put("name", "registered image").put("kind", "image").put("format", "PNG image")
            .put("attribution", "field map").put("bounds", org.json.JSONArray(listOf(10.0, 20.0, 11.0, 21.0)))
            .put("minzoom", 0).put("maxzoom", 22).put("tileSize", 256).put("bytes", 128L * 1024 * 1024)
            .put("blobMime", "image/png").put("blobBase64", "AQID"))
        for (i in 1 until 100) maps.put(JSONObject().put("id", "online-$i").put("name", "Online $i").put("kind", "online").put("format", "XYZ")
            .put("tiles", org.json.JSONArray().put("https://tiles.example.invalid/{z}/{x}/{y}"))
            .put("minzoom", 0).put("maxzoom", 18).put("tileSize", 256).put("bytes", 0).put("attribution", "source"))
        val valid = NativeSourceImport.validateExportMaps(maps)
        assertEquals(100, valid.count)
        assertEquals(128L * 1024 * 1024, valid.totalBytes)
        maps.put(JSONObject(maps.getJSONObject(0).toString()).put("id", "local-2"))
        assertFails("最多100项") { NativeSourceImport.validateExportMaps(maps) }
        maps.remove(100)
        maps.getJSONObject(0).put("bytes", 257L * 1024 * 1024)
        assertFails("超过256MiB") { NativeSourceImport.validateExportMaps(maps) }
    }

    @Test fun `source JSON importer will not accept local private file paths as portable maps`() {
        val result = NativeSourceImport.parseJson(JSONObject().put("maps", org.json.JSONArray().put(JSONObject()
            .put("id", "local").put("name", "local image").put("kind", "image").put("format", "PNG image")
            .put("filePath", "/data/user/0/com.shantu.nativeapp/files/native-offline-maps/local/source.png")
            .put("bounds", org.json.JSONArray(listOf(10.0, 20.0, 11.0, 21.0))))) .toString())
        assertEquals(0, result.entries.size)
        assertTrue(result.issues.single().reason.contains("本地离线文件"))
    }

    @Test
    fun `json parse rejects malformed and unsupported document shapes`() {
        assertFails("JSON 图源文件无法解析") { NativeSourceImport.parseJson("{bad") }
        assertFails("缺少 maps") { NativeSourceImport.parseJson("{\"version\":1}") }
        assertFails("尾随内容") { NativeSourceImport.parseJson("{\"maps\":[]} trailing") }
    }

    @Test
    fun `ovmap type37 file imports decoded raster template without contacting host`() {
        val result = NativeSourceImport.parseOvmap(makeOvmap())
        assertEquals(NativeSourceImportFormat.OVMAP, result.format)
        assertEquals(1, result.totalRecords)
        assertEquals(1, result.entries.size)
        val source = result.entries.single().toJson()
        assertEquals("Fixture OVMAP", source.getString("name"))
        assertEquals(1, source.getJSONObject("ovmap").getJSONArray("layers").length())
        assertEquals("wgs84", source.getString("datum"))
        assertFalse(result.toString().contains("tiles.example.invalid"))
    }

    @Test
    fun `decoded OVI QR imports only supported single raster scan text`() {
        fun b64(value: String) = Base64.encodeToString(value.toByteArray(StandardCharsets.UTF_8), Base64.NO_WRAP)
        val qr = listOf(
            "t" to "37", "id" to "7", "na" to b64("QR fixture"), "gp" to b64("Maps"),
            "po" to "1", "pn" to "0", "mt" to "1", "mf" to "3", "ml" to "16", "pt" to "443",
            "hn" to b64("tiles.example.invalid"), "ul" to b64("/{z}/{x}/{y}.png"),
        ).joinToString("&") { (key, value) -> "$key=${URLEncoder.encode(value, "UTF-8")}" }
        val result = NativeSourceImport.parseScannedText("ovobj?$qr")
        assertEquals(NativeSourceImportFormat.OVI_QR, result.format)
        assertEquals("QR fixture", result.entries.single().name)
        assertFails("未支持字段") { NativeSourceImport.parseScannedText("ovobj?t=37&secret=x") }
    }

    @Test
    fun `unknown file suffix and invalid ovmap are explicit failures`() {
        assertFails("文件格式不支持") { NativeSourceImport.importFile("source.txt", byteArrayOf(1)) }
        assertFails("不是受支持") { NativeSourceImport.parseOvmap(ByteArray(24)) }
    }

    private fun makeOvmap(): ByteArray {
        val strings = listOf("Fixture OVMAP", "tiles.example.invalid", "/{\$z}/{\$x}/{\$y}.png")
            .map { it.toByteArray(StandardCharsets.UTF_8) }
        val bodyLength = 120 + strings.sumOf { 4 + it.size }
        val body = ByteArray(bodyLength)
        fun put(offset: Int, value: Long) {
            ByteBuffer.wrap(body, offset, 4).order(ByteOrder.LITTLE_ENDIAN).putInt(value.toInt())
        }
        put(0, 37); put(4, 102); put(16, 23); put(20, 0); put(24, 18)
        put(28, 0); put(32, 3); put(36, 443); put(40, 256)
        put(44, 0); put(48, 0); put(52, 0); put(56, 0); put(60, 0); put(64, 0x10000)
        var cursor = 120
        for (part in strings) {
            put(cursor, part.size.toLong())
            cursor += 4
            part.copyInto(body, cursor)
            cursor += part.size
        }
        val payload = ByteArrayOutputStream().apply {
            write(le32(body.size.toLong()))
            write(le32(37))
            write(body)
        }.toByteArray()
        val deflater = Deflater()
        val compressed = try {
            deflater.setInput(payload)
            deflater.finish()
            val output = ByteArrayOutputStream()
            val buffer = ByteArray(512)
            while (!deflater.finished()) output.write(buffer, 0, deflater.deflate(buffer))
            output.toByteArray()
        } finally { deflater.end() }
        val header = ByteArray(24)
        "OviO".toByteArray(StandardCharsets.US_ASCII).copyInto(header)
        fun setHeader(offset: Int, value: Long) {
            ByteBuffer.wrap(header, offset, 4).order(ByteOrder.LITTLE_ENDIAN).putInt(value.toInt())
        }
        setHeader(4, (header.size + compressed.size).toLong())
        setHeader(8, payload.size.toLong())
        setHeader(12, 104); setHeader(16, 100); setHeader(20, 0)
        return header + compressed
    }

    private fun le32(value: Long) = ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(value.toInt()).array()

    private inline fun assertFails(fragment: String, action: () -> Unit) {
        try { action() } catch (error: IllegalArgumentException) {
            assertTrue("Unexpected message: ${error.message}", error.message.orEmpty().contains(fragment))
            return
        }
        throw AssertionError("Expected IllegalArgumentException containing '$fragment'")
    }
}
