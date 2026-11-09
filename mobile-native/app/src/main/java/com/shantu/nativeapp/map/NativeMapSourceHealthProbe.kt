package com.shantu.nativeapp.map

import kotlin.math.floor
import kotlin.math.ln

internal data class NativeMapSourceHealthResult(
    val status: String,
    val successes: Int,
    val missing: Int,
    val failures: Int,
    val sampled: Int,
    val sourceName: String = "当前图源",
    val testedZoom: Int? = null,
    val elapsedMs: Long = 0L,
    val testedAtEpochMs: Long = System.currentTimeMillis(),
    val scope: String = "representative-tiles",
) {
    val message: String get() = when (status) {
        "ok" -> "当前位置图源可正常读取影像"
        "partial" -> "当前位置图源部分瓦片可读，部分无覆盖或失败"
        "missing" -> "当前位置所测瓦片均无影像覆盖"
        "authorization" -> "图源服务拒绝访问，请核对授权或访问范围"
        "dns" -> "图源域名解析失败"
        "tls" -> "图源 HTTPS 安全连接失败"
        "timeout" -> "图源请求超时"
        "http" -> "图源服务器返回错误响应"
        "invalid" -> "图源返回内容为空或不是有效地图影像"
        else -> "图源测试结果未知，请检查网络后重试"
    }
}

/** Three direct, cache-free samples. Tile transport stays inside BoundedTileNetwork's limits. */
internal suspend fun probeNativeMapSource(
    network: BoundedTileNetwork,
    source: NativeMapSource?,
    center: Pair<Double, Double>,
    cameraZoom: Double,
    builtinTileUrl: ((x: Int, y: Int, z: Int) -> String)? = null,
    builtinDisplayName: String? = null,
    builtinDatum: NativeRasterDatum = NativeRasterDatum.WGS84,
): NativeMapSourceHealthResult {
    val startedAt = System.currentTimeMillis()
    val latitude = center.first
    val longitude = center.second
    if (!latitude.isFinite() || !longitude.isFinite() || latitude !in -90.0..90.0)
        return NativeMapSourceHealthResult("unknown", 0, 0, 0, 0)
    val layer = source?.layers?.firstOrNull()
    if (source != null && (source.kind != "online" || layer == null))
        return NativeMapSourceHealthResult("unknown", 0, 0, 0, 0)
    if (source == null && builtinTileUrl == null)
        return NativeMapSourceHealthResult("unknown", 0, 0, 0, 0)
    val minZoom = layer?.minZoom ?: 0
    val maxZoom = layer?.maxZoom ?: 22
    if (minZoom > MAX_PROBE_ZOOM) return NativeMapSourceHealthResult("unknown", 0, 0, 0, 0)
    val probeMaxZoom = minOf(maxZoom, MAX_PROBE_ZOOM).coerceAtLeast(minZoom)
    val zoom = cameraZoom.takeIf { it.isFinite() }?.toInt()?.coerceIn(minZoom, probeMaxZoom) ?: probeMaxZoom
    val side = 1 shl zoom
    val lat = latitude.coerceIn(-85.05112878, 85.05112878)
    val datum = source?.datum ?: builtinDatum
    val probeCoordinate = if (datum != NativeRasterDatum.WGS84)
        NativeRasterProjection.providerCoordinate(longitude.wrapLongitudeHealth(), lat, datum)
    else longitude.wrapLongitudeHealth() to lat
    val x = floor((probeCoordinate.first + 180.0) / 360.0 * side).toInt().coerceIn(0, side - 1)
    val sin = kotlin.math.sin(Math.toRadians(lat))
    val probeSin = kotlin.math.sin(Math.toRadians(probeCoordinate.second.coerceIn(-85.05112878, 85.05112878)))
    val y = floor((0.5 - ln((1 + probeSin) / (1 - probeSin)) / (4 * Math.PI)) * side).toInt().coerceIn(0, side - 1)
    val tiles = listOf(x to y, minOf(side - 1, x + 1) to y, x to minOf(side - 1, y + 1))
    val outcomes = mutableListOf<NativeTileProbeOutcome>()
    for ((tileX, tileY) in tiles) {
        val url = try { source?.tileUrl(0, tileX, tileY, zoom) ?: builtinTileUrl!!.invoke(tileX, tileY, zoom) }
            catch (_: Exception) { outcomes += NativeTileProbeOutcome.INVALID; continue }
        outcomes += network.probeTile(url)
    }
    val successes = outcomes.count { it == NativeTileProbeOutcome.OK }
    val missing = outcomes.count { it == NativeTileProbeOutcome.MISSING }
    val failures = outcomes.size - successes - missing
    val status = when {
        successes == outcomes.size && successes > 0 -> "ok"
        successes > 0 -> "partial"
        outcomes.isNotEmpty() && missing == outcomes.size -> "missing"
        NativeTileProbeOutcome.AUTHORIZATION in outcomes -> "authorization"
        NativeTileProbeOutcome.DNS in outcomes -> "dns"
        NativeTileProbeOutcome.TLS in outcomes -> "tls"
        NativeTileProbeOutcome.TIMEOUT in outcomes -> "timeout"
        NativeTileProbeOutcome.HTTP in outcomes -> "http"
        NativeTileProbeOutcome.INVALID in outcomes -> "invalid"
        else -> "unknown"
    }
    val safeName = (source?.name ?: builtinDisplayName).orEmpty().replace(Regex("https?://\\S+", RegexOption.IGNORE_CASE), "[已隐藏地址]")
        .replace(Regex("(?i)(key|token|secret|api[_-]?key)=\\S+"), "$1=[已隐藏]").take(80).ifBlank { "当前图源" }
    return NativeMapSourceHealthResult(status, successes, missing, failures, outcomes.size, safeName, zoom,
        System.currentTimeMillis() - startedAt, startedAt, if ((source?.layers?.size ?: 1) > 1) "base-layer-only" else "representative-tiles")
}

private fun Double.wrapLongitudeHealth(): Double = ((this + 180.0) % 360.0 + 360.0) % 360.0 - 180.0

private const val MAX_PROBE_ZOOM = 24
