package com.shantu.nativeapp.navigation

import org.json.JSONObject
import android.os.CancellationSignal
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

data class NativePlace(val name: String, val longitude: Double, val latitude: Double, val detail: String = "")

/** Same Tianditu POI protocol as modules/navigation/tiandituSearch.ts. Never logs URLs. */
class NativePlaceSearch(private val key: String) {
    fun search(query: String, cancellation: CancellationSignal? = null): List<NativePlace> {
        cancellation?.throwIfCanceled()
        val keyword = query.trim().take(120)
        require(keyword.isNotEmpty()) { "请输入地点名称" }
        require(key.isNotBlank()) { "天地图搜索授权未配置" }
        val parameters = JSONObject().put("keyWord", keyword).put("level", 12)
            .put("mapBound", "73,3,136,54").put("queryType", 1).put("start", 0).put("count", 20).put("show", 2)
        val connection = URL("https://api.tianditu.gov.cn/v2/search?type=query&postStr=" +
            URLEncoder.encode(parameters.toString(), "UTF-8") + "&tk=" + URLEncoder.encode(key, "UTF-8"))
            .openConnection() as HttpURLConnection
        try {
            cancellation?.setOnCancelListener { connection.disconnect() }
            cancellation?.throwIfCanceled()
            connection.connectTimeout = 12_000
            connection.readTimeout = 15_000
            connection.setRequestProperty("Accept", "application/json")
            val code = connection.responseCode
            require(code != 429) { "搜索请求较多，请稍后重试" }
            require(code in 200..299) { "天地图搜索服务暂不可用" }
            val bytes = connection.inputStream.use { input ->
                val out = java.io.ByteArrayOutputStream()
                val buffer = ByteArray(8192)
                while (true) {
                    cancellation?.throwIfCanceled()
                    if (Thread.currentThread().isInterrupted) throw InterruptedException()
                    val count = input.read(buffer)
                    if (count < 0) break
                    require(out.size() + count <= 2_000_000) { "搜索结果过大" }
                    out.write(buffer, 0, count)
                }
                out.toByteArray()
            }
            return parse(JSONObject(bytes.toString(Charsets.UTF_8)))
        } finally { cancellation?.setOnCancelListener(null); connection.disconnect() }
    }

    companion object {
        fun parse(response: JSONObject): List<NativePlace> {
            val status = response.optJSONObject("status") ?: response.optJSONArray("status")?.optJSONObject(0)
            val code = status?.optInt("infocode", -1)
            if (code == 3001) return emptyList()
            require(code == 1000) { "天地图搜索不可用，请检查服务授权或稍后重试" }
            if (response.has("resultType") && response.optInt("resultType") != 1) return emptyList()
            if (!response.has("pois") || response.isNull("pois")) return emptyList()
            val pois = response.optJSONArray("pois") ?: throw IllegalArgumentException("天地图搜索响应格式异常")
            val places = linkedMapOf<String, NativePlace>()
            for (index in 0 until pois.length()) {
                val poi = pois.optJSONObject(index) ?: continue
                val name = (poi.opt("name") as? String)?.trim()?.take(160) ?: continue
                val coordinates = coordinate(poi.opt("lonlat") as? String ?: continue) ?: continue
                if (name.isEmpty()) continue
                val locality = listOf("province", "city", "county").mapNotNull { (poi.opt(it) as? String)?.trim() }.filter { it.isNotEmpty() }.distinct()
                var address = (poi.opt("address") as? String).orEmpty().trim()
                locality.forEach { address = address.replace(it, "") }
                address = address.replace(Regex("[\\s·,，、;；|/\\\\-]+"), " ").trim()
                val detail = (locality + address).filter { it.isNotBlank() }.joinToString(" · ").take(240)
                val value = NativePlace(name, coordinates.first, coordinates.second, detail)
                places.putIfAbsent("${name.lowercase()}|${value.longitude}|${value.latitude}", value)
                if (places.size >= 20) break
            }
            return places.values.toList()
        }

        fun coordinate(text: String): Pair<Double, Double>? {
            val values = text.trim().replace('，', ',').split(',')
            if (values.size != 2) return null
            val lon = values[0].trim().toDoubleOrNull() ?: return null
            val lat = values[1].trim().toDoubleOrNull() ?: return null
            return if (lon.isFinite() && lat.isFinite() && lon in -180.0..180.0 && lat in -85.051129..85.051129) lon to lat else null
        }
    }
}
