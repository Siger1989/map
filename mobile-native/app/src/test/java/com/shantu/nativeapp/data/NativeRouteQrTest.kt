package com.shantu.nativeapp.data

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.ByteArrayOutputStream
import java.util.Base64
import java.util.zip.Deflater

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], manifest = Config.NONE)
class NativeRouteQrTest {
    @Test fun decodesTypeScriptGoldenPayloadAndPreservesRouteMetadata() {
        val golden = "shantu-route:1:46:eNqrVspTslJyz89JSc1T-DB_QruSjlIuUCQpM7kyOScVyCtWsoqOjjY0MDEAAx1jCG0QqwMUBPKNIGxTODs2VkepAKRJ6cXW7c-bdirpADUDtQEVKT3f3QET0TMwMAOKAikTkI4SJSsDHaUUJSug-bUA7U0rHg"
        val track = NativeRouteQr.decode(golden, 1_234)
        assertEquals("Golden 🐇（扫码）", track.getString("name"))
        assertEquals(1_234L, track.getLong("createdAt"))
        assertEquals("bicycle", track.getString("navigationMode"))
        assertEquals("shared", track.getString("source"))
        assertEquals(3, track.getJSONArray("segments").getJSONArray(0).length())
        assertEquals("起点", track.getJSONObject("sharedRoute").getJSONArray("stops").getJSONObject(0).getString("name"))
        assertEquals(300.0, track.getJSONObject("sharedRoute").getDouble("duration"), 0.0)
    }

    @Test fun encodesTrackGeometryStopsAndColourChangesWithinQrBudget() {
        val track = JSONObject().put("id", "track").put("name", "native share").put("navigationMode", "bicycle")
            .put("segments", JSONArray().put(line(104.0 to 30.0, 104.001 to 30.001, 104.002 to 30.0, 104.003 to 30.001)).put(line(104.02 to 30.0, 104.021 to 30.0)))
            .put("routeTerminals", JSONObject().put("start", JSONArray().put(104.0).put(30.0)).put("end", JSONArray().put(104.021).put(30.0)))
            .put("sharedRoute", JSONObject().put("stops", JSONArray().put(stop("出发", 104.0, 30.0)).put(stop("途经", 104.002, 30.0)).put(stop("到达", 104.021, 30.0))).put("duration", 325))
            .put("style", JSONObject().put("color", "#AABBCC").put("width", 2.0).put("pointSize", 8).put("opacity", .7).put("colorMode", "solid"))
            .put("edgeColors", JSONArray().put(JSONArray().put("#aabbcc").put("#ff0000").put("#ff0000")).put(JSONArray().put("#00aa00")))
            .put("colorConditions", JSONObject().put("#ff0000", "桥头施工"))
        val encoded = NativeRouteQr.encode(track)
        assertTrue(encoded.text.startsWith(NativeRouteQr.PREFIX))
        assertTrue(encoded.text.length <= NativeRouteQr.QR_BUDGET)
        assertEquals(0, encoded.tolerance)
        val decoded = NativeRouteQr.decode(encoded.text, 42)
        assertEquals(2, decoded.getJSONArray("segments").length())
        assertEquals(3, decoded.getJSONObject("sharedRoute").getJSONArray("stops").length())
        assertEquals("#ff0000", decoded.getJSONArray("edgeColors").getJSONArray(0).getString(1))
        assertEquals("桥头施工", decoded.getJSONObject("colorConditions").getString("#ff0000"))
        assertEquals("#aabbcc", decoded.getJSONObject("style").getString("color"))
    }

    @Test fun rejectsMalformedStyleEdgeColorsColorConditionsAndInflationBomb() {
        val points = JSONArray().put(JSONArray().put(104_000_000).put(30_000_000)).put(JSONArray().put(1_000).put(1_000))
        val base = JSONObject().put("n", "bad").put("m", "auto").put("s", JSONArray().put(points)).put("p", JSONArray().put(JSONArray().put("start").put(104.0).put(30.0))).put("t", 0).put("d", JSONObject.NULL)
        assertRejected(base.deepCopy().put("st", JSONObject().put("color", "not-a-color").put("width", 1.5)))
        assertRejected(base.deepCopy().put("ec", JSONArray().put(JSONArray().put("not-a-color"))))
        assertRejected(base.deepCopy().put("cc", JSONObject().put("red", "invalid color key")))

        val bomb = ByteArray(100_000)
        val deflater = Deflater(9)
        val compressed = try {
            deflater.setInput(bomb); deflater.finish()
            ByteArrayOutputStream().use { out -> val buffer = ByteArray(256); while (!deflater.finished()) { val n = deflater.deflate(buffer); out.write(buffer, 0, n) }; out.toByteArray() }
        } finally { deflater.end() }
        val text = NativeRouteQr.PREFIX + "a:" + Base64.getUrlEncoder().withoutPadding().encodeToString(compressed)
        assertTrue(text.length < NativeRouteQr.QR_BUDGET)
        assertRejectedText(text)
    }

    @Test fun reportsExplicitLossWhenLargeTrackMustBeSimplified() {
        val points = JSONArray()
        repeat(2500) { i -> points.put(JSONArray().put(104.0 + i * .00004).put(30.0 + kotlin.math.sin(i * 1.8) * .004)) }
        val stops = JSONArray().put(stop("起", 104.0, 30.0)).put(stop("中", 104.048, 30.0)).put(stop("终", 104.09996, 30.0))
        val track = JSONObject().put("name", "长线").put("navigationMode", "auto").put("segments", JSONArray().put(points))
            .put("sharedRoute", JSONObject().put("stops", stops).put("duration", JSONObject.NULL))
        val result = NativeRouteQr.encode(track)
        assertTrue(result.text.length <= NativeRouteQr.QR_BUDGET)
        if (result.tolerance > 0) assertTrue(result.explanation.contains("简化") || result.explanation.contains("概括"))
        val imported = NativeRouteQr.decode(result.text)
        assertEquals("中", imported.getJSONObject("sharedRoute").getJSONArray("stops").getJSONObject(1).getString("name"))
    }

    private fun line(vararg points: Pair<Double, Double>) = JSONArray().also { out -> points.forEach { out.put(JSONArray().put(it.first).put(it.second)) } }
    private fun stop(name: String, lon: Double, lat: Double) = JSONObject().put("name", name).put("coordinates", JSONArray().put(lon).put(lat))
    private fun JSONObject.deepCopy() = JSONObject(toString())
    private fun assertRejected(value: JSONObject) = assertRejectedText(pack(value))
    private fun assertRejectedText(text: String) { assertThrows(IllegalArgumentException::class.java) { NativeRouteQr.decode(text) } }
    private fun pack(value: JSONObject): String {
        val raw = value.toString().toByteArray(Charsets.UTF_8); val deflater = Deflater(9)
        val compressed = try {
            deflater.setInput(raw); deflater.finish()
            ByteArrayOutputStream().use { out -> val buffer = ByteArray(4096); while (!deflater.finished()) { val n = deflater.deflate(buffer); out.write(buffer, 0, n) }; out.toByteArray() }
        } finally { deflater.end() }
        return NativeRouteQr.PREFIX + raw.size.toString(36) + ":" + Base64.getUrlEncoder().withoutPadding().encodeToString(compressed)
    }
}
