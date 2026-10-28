package com.shantu.nativeapp.navigation

import android.os.CancellationSignal
import android.os.OperationCanceledException
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URLEncoder
import java.net.URL
import kotlin.math.*

fun interface NativeRiverTransport { fun get(url: String, cancellation: CancellationSignal?): String }

class HttpNativeRiverTransport : NativeRiverTransport {
    override fun get(url: String, cancellation: CancellationSignal?): String {
        cancellation?.throwIfCanceled()
        val connection = URL(url).openConnection() as HttpURLConnection
        try {
            cancellation?.setOnCancelListener(CancellationSignal.OnCancelListener { connection.disconnect() })
            connection.connectTimeout = 10_000; connection.readTimeout = 15_000; connection.useCaches = false
            connection.setRequestProperty("Accept", "application/json")
            val status = connection.responseCode
            if (status !in 200..299) throw IllegalStateException("河流水系数据暂不可用（HTTP $status）")
            val declared = connection.getHeaderField("Content-Length")?.toLongOrNull()
            require(declared == null || declared <= MAX_BYTES) { "河流数据响应过大" }
            val out = ByteArrayOutputStream(); val buffer = ByteArray(8192)
            connection.inputStream.use { input -> while (true) {
                cancellation?.throwIfCanceled()
                val count = input.read(buffer); if (count < 0) break
                require(out.size().toLong() + count <= MAX_BYTES) { "河流数据响应过大" }; out.write(buffer, 0, count)
            } }
            cancellation?.throwIfCanceled()
            return out.toString(Charsets.UTF_8.name())
        } catch (error: Exception) {
            if (cancellation?.isCanceled == true) throw OperationCanceledException()
            throw error
        } finally { cancellation?.setOnCancelListener(null); connection.disconnect() }
    }
    companion object { const val MAX_BYTES = 2 * 1024 * 1024 }
}

/** Fetches actual OSM river/stream/canal centerlines; it never draws a straight replacement. */
class NativeRiverSnapService(
    private val transport: NativeRiverTransport = HttpNativeRiverTransport(),
    private val endpoint: String = "https://overpass-api.de/api/interpreter",
) {
    fun snap(from: NativeCoordinate, to: NativeCoordinate, cancellation: CancellationSignal? = null): List<NativeCoordinate>? {
        cancellation?.throwIfCanceled()
        require(from.longitude.isFinite() && from.latitude.isFinite() && to.longitude.isFinite() && to.latitude.isFinite())
        val south = min(from.latitude, to.latitude) - .025; val north = max(from.latitude, to.latitude) + .025
        val west = min(from.longitude, to.longitude) - .025; val east = max(from.longitude, to.longitude) + .025
        require(south >= -90 && north <= 90 && west >= -180 && east <= 180) { "路线靠近日期变更线或极区，请缩短河流吸附范围" }
        val query = "[out:json][timeout:20];(way[\"waterway\"~\"^(river|stream|canal)$\"]($south,$west,$north,$east););out geom;"
        val url = "$endpoint?data=${URLEncoder.encode(query, Charsets.UTF_8.name())}"
        val body = transport.get(url, cancellation)
        cancellation?.throwIfCanceled()
        val json = JSONObject(body)
        val ways = json.optJSONArray("elements") ?: return null
        var best: List<NativeCoordinate>? = null
        var bestCost = Double.POSITIVE_INFINITY
        for (i in 0 until ways.length()) {
            cancellation?.throwIfCanceled()
            val way = ways.optJSONObject(i) ?: continue
            if (way.optJSONObject("tags")?.optString("waterway") !in setOf("river", "stream", "canal")) continue
            val geometry = way.optJSONArray("geometry") ?: continue
            val line = (0 until geometry.length()).mapNotNull { n ->
                val p = geometry.optJSONObject(n) ?: return@mapNotNull null
                val lon = p.optDouble("lon", Double.NaN); val lat = p.optDouble("lat", Double.NaN)
                NativeCoordinate(lon, lat).takeIf { lon.isFinite() && lat.isFinite() }
            }
            if (line.size < 2) continue
            val a = line.indices.minByOrNull { distance(from, line[it]) } ?: continue
            val b = line.indices.minByOrNull { distance(to, line[it]) } ?: continue
            val endpointCost = distance(from, line[a]) + distance(to, line[b])
            if (endpointCost < bestCost && distance(from, line[a]) <= 1200 && distance(to, line[b]) <= 1200) {
                bestCost = endpointCost
                best = if (a <= b) line.subList(a, b + 1) else line.subList(b, a + 1).asReversed()
            }
        }
        return best?.takeIf { it.size >= 2 }
    }

    private fun distance(a: NativeCoordinate, b: NativeCoordinate): Double {
        val r = Math.PI / 180; val dLat = (b.latitude - a.latitude) * r; val dLon = (b.longitude - a.longitude) * r
        val h = sin(dLat / 2).pow(2) + cos(a.latitude * r) * cos(b.latitude * r) * sin(dLon / 2).pow(2)
        return 6_371_000 * 2 * asin(sqrt(h.coerceIn(0.0, 1.0)))
    }
}
