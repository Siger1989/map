package com.shantu.nativeapp.map

import org.json.JSONArray
import kotlin.math.*

internal data class NativeCacheTile(val z: Int, val x: Int, val y: Int, val layer: Int = 0)

/** Bounded route corridor enumeration, with antimeridian wrapping and no silent truncation. */
internal object NativeCachePlan {
    const val MAX_REQUESTS = 250_000
    const val MAX_ARCHIVE_BYTES = 8L * 1024 * 1024 * 1024
    fun estimateBytes(requestCount: Int, averageBytesPerTile: Int = 20 * 1024): Long {
        require(requestCount in 1..MAX_REQUESTS && averageBytesPerTile in 1..4 * 1024 * 1024)
        val estimate = requestCount.toLong() * averageBytesPerTile
        require(estimate <= MAX_ARCHIVE_BYTES) { "预计空间超过 8 GiB 上限，请降低级别或分段缓存" }
        return estimate
    }
    fun corridor(points: List<Pair<Double, Double>>, minZoom: Int, maxZoom: Int, bufferKm: Double): List<NativeCacheTile> {
        require(points.size in 1..6000 && points.all { it.first.isFinite() && it.second.isFinite() && abs(it.first) <= 180 && abs(it.second) <= 85.051129 }) { "路线坐标无效" }
        require(minZoom in 0..20 && maxZoom in minZoom..20 && bufferKm.isFinite() && bufferKm in 0.05..25.0)
        val found = linkedSetOf<NativeCacheTile>()
        var work = 0
        for (z in minZoom..maxZoom) {
            val n = 2.0.pow(z)
            fun add(lon: Double, lat: Double) {
                val x = (lon + 180) / 360 * n
                val y = (1 - asinh(tan(Math.toRadians(lat.coerceIn(-85.05112878, 85.05112878)))) / PI) / 2 * n
                val metersPerTile = 40_075_016.686 / n * cos(Math.toRadians(lat)).coerceAtLeast(.01)
                val radius = ceil(bufferKm * 1000 / metersPerTile).toInt() + 1
                require((radius * 2L + 1).pow2() <= MAX_REQUESTS * 4L) { "范围或级别过大，请缩小范围" }
                for (dy in -radius..radius) for (dx in -radius..radius) {
                    require(++work <= 2_000_000) { "路线范围过大，请分段缓存" }
                    val ty = floor(y).toInt() + dy
                    if (ty !in 0 until n.toInt()) continue
                    // Conservative square corridor includes edge tiles; estimate shows exact request count.
                    val tx = Math.floorMod(floor(x).toInt() + dx, n.toInt())
                    found.add(NativeCacheTile(z, tx, ty))
                    require(found.size <= MAX_REQUESTS) { "超过 250,000 张上限，请降低级别或缩小范围" }
                }
            }
            if (points.size == 1) add(points[0].first, points[0].second)
            else points.zipWithNext().forEach { (a,b) ->
                val deltaLon = ((b.first - a.first + 540) % 360) - 180
                val dx = deltaLon / 360 * n
                fun merc(lat: Double) = (1 - asinh(tan(Math.toRadians(lat.coerceIn(-85.05112878,85.05112878)))) / PI) / 2 * n
                val dy = merc(b.second) - merc(a.second)
                val steps = ceil(max(abs(dx),abs(dy)) * 2).toInt().coerceAtLeast(1)
                require(steps <= 24000) { "路线过长，请分段缓存" }
                for (i in 0..steps) {
                    val t = i.toDouble() / steps
                    val latitude = Math.toDegrees(atan(sinh(PI * (1 - 2 * (merc(a.second) + dy * t) / n))))
                    add(a.first + deltaLon * t, latitude)
                }
            }
        }
        return found.toList()
    }
    /** Include the provider tiles needed by the native reprojection, not only the WGS84 destination tile. */
    fun sourceTiles(tiles: List<NativeCacheTile>, source: NativeMapSource): List<NativeCacheTile> {
        val result = linkedSetOf<NativeCacheTile>()
        source.layers.forEachIndexed { layerIndex, layer ->
            tiles.filter { it.z in layer.minZoom..layer.maxZoom }.forEach { tile ->
                if (source.datum == NativeRasterDatum.WGS84) result += tile.copy(layer = layerIndex)
                else {
                    val plan = NativeRasterProjection.plan(tile.z,tile.x,tile.y,layer.outputTileSize,source.datum)
                    for (dy in 0 until plan.height) for (dx in 0 until plan.width)
                        result += NativeCacheTile(tile.z,Math.floorMod(plan.left+dx,1 shl tile.z),plan.top+dy,layerIndex)
                }
                require(result.size <= MAX_REQUESTS) { "多图层请求超过 250,000 张上限，请降低级别" }
            }
        }
        require(result.isNotEmpty()) { "图源不提供所选级别" }
        return result.toList()
    }
    fun encode(tiles: List<NativeCacheTile>) = JSONArray().apply { tiles.forEach { put(JSONArray(listOf(it.z,it.x,it.y,it.layer))) } }
    fun decode(array: JSONArray): List<NativeCacheTile> {
        require(array.length() in 1..MAX_REQUESTS)
        return (0 until array.length()).map { index ->
            val item=array.getJSONArray(index)
            NativeCacheTile(item.getInt(0),item.getInt(1),item.getInt(2),item.getInt(3)).also {
                require(it.z in 0..20 && it.x in 0 until (1 shl it.z) && it.y in 0 until (1 shl it.z) && it.layer in 0..31)
            }
        }
    }
    private fun Long.pow2() = this * this
}
