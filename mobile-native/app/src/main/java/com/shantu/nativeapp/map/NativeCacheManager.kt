package com.shantu.nativeapp.map

import android.content.Context
import org.json.JSONObject
import java.security.MessageDigest
import java.nio.charset.StandardCharsets
import java.util.UUID

internal class NativeCacheSource(val id: String, val name: String, val custom: NativeMapSource?, private val key: String = "") {
    fun tilesForSegments(segments: List<List<Pair<Double,Double>>>, min: Int, max: Int, buffer: Double): List<NativeCacheTile> {
        require(segments.isNotEmpty() && segments.size<=600) { "请选择有效路线" }
        val union=linkedSetOf<NativeCacheTile>()
        segments.forEach { segment ->
            if(Thread.currentThread().isInterrupted) throw java.util.concurrent.CancellationException()
            union.addAll(tiles(segment,min,max,buffer))
            require(union.size<=NativeCachePlan.MAX_REQUESTS) { "合计超过250,000张，请缩小范围或降低级别" }
        }
        return union.toList()
    }
    fun tiles(points: List<Pair<Double,Double>>, min: Int, max: Int, buffer: Double): List<NativeCacheTile> {
        val tiles = NativeCachePlan.corridor(points,min,max,buffer)
        return if (custom != null) NativeCachePlan.sourceTiles(tiles, custom).distinctBy(::url) else {
            require(tiles.all { it.z in 1..18 }) { "天地图离线级别应为 1—18" }
            require(tiles.size * 2 <= NativeCachePlan.MAX_REQUESTS) { "底图与注记合计超过 250,000 张" }
            tiles.flatMap { listOf(it,it.copy(layer=1)) }
        }
    }
    fun url(tile: NativeCacheTile): String = if (custom != null) custom.tileUrl(tile.layer,tile.x,tile.y,tile.z) else {
        require(id in NativeMapController.SOURCE_IDS && key.isNotBlank() && tile.layer in 0..1)
        val layers = when(id) {
            NativeMapController.SOURCE_VECTOR -> listOf("vec","cva")
            NativeMapController.SOURCE_TERRAIN -> listOf("ter","cta")
            else -> listOf("img","cia")
        }
        tiandituTileUrl(layers[tile.layer],tile.x,tile.y,tile.z,java.net.URLEncoder.encode(key,"UTF-8"))
    }
    override fun toString() = "NativeCacheSource(credentials=redacted)"
}

/** UI facade. The foreground service owns downloads and the same durable archive after Activity teardown. */
internal class NativeCacheManager(context: Context, private val network: BoundedTileNetwork) {
    private val appContext=context.applicationContext
    private val archive = NativeTileArchive(appContext.filesDir.resolve("native-offline-tiles"))
    private val preferences = appContext.getSharedPreferences("native-cache",Context.MODE_PRIVATE)
    val progress: String get() = NativeCacheDownloadService.progress
    @Volatile var activeId: String? = null
        get() = NativeCacheDownloadService.activeId ?: field
        private set
    init {
        network.archive = archive
        network.cacheOnly = preferences.getBoolean("only",false)
        archive.list().filter { it.optString("state") == "downloading" && it.optString("id") != NativeCacheDownloadService.activeId }
            .forEach { archive.save(it.put("state","paused").put("error","进程已结束，已保存内容可继续补齐")) }
    }
    var cacheOnly: Boolean
        get() = network.cacheOnly
        set(value) { network.cacheOnly=value; preferences.edit().putBoolean("only",value).apply(); if(value) pause() }
    fun packages(): List<JSONObject> = archive.list()
    fun create(name: String, source: NativeCacheSource, tiles: List<NativeCacheTile>, preparedFingerprint:String?=null): JSONObject {
        check(activeId == null) { "请先暂停当前下载" }
        require(name.isNotBlank() && tiles.isNotEmpty() && tiles.size <= NativeCachePlan.MAX_REQUESTS)
        val estimate=NativeCachePlan.estimateBytes(tiles.size)
        val record = JSONObject().put("version",2).put("id",UUID.randomUUID().toString())
            .put("name",name.take(80)).put("sourceId",source.id).put("sourceName",source.name)
            .put("createdAt",System.currentTimeMillis()).put("state","paused").put("estimatedBytes",estimate)
            .put("tiles",NativeCachePlan.encode(tiles)).put("fingerprint",preparedFingerprint ?: nativeCacheFingerprint(source,tiles))
        archive.save(record)
        return record
    }
    @Synchronized fun start(record: JSONObject, source: NativeCacheSource) {
        check(!cacheOnly) { "请先恢复在线加载" }
        check(activeId == null) { "已有下载正在进行" }
        val tiles = NativeCachePlan.decode(record.getJSONArray("tiles"))
        require(source.id == record.getString("sourceId")) { "请选择该缓存包原使用的图源配置" }
        require(tiles.size <= NativeCachePlan.MAX_REQUESTS)
        activeId=record.getString("id")
        try { NativeCacheDownloadService.start(appContext,record.getString("id"),source) }
        catch(error:Exception) { activeId=null; throw error }
    }
    fun pause() { NativeCacheDownloadService.pause(appContext) }
    fun delete(id: String) { check(activeId != id) { "请等待下载暂停后再删除" }; archive.delete(id) }
    /** Activity disposal must not cancel or close a running service-owned transfer. */
    fun close() = Unit
}

internal fun nativeCacheFingerprint(source:NativeCacheSource,tiles:List<NativeCacheTile>):String {
    val digest=MessageDigest.getInstance("SHA-256")
    tiles.forEachIndexed { index,tile ->
        if(index%256==0 && Thread.currentThread().isInterrupted) throw java.util.concurrent.CancellationException()
        digest.update(NativeTileArchive.digest(source.url(tile)).toByteArray(StandardCharsets.US_ASCII))
        if(index<tiles.lastIndex) digest.update('\n'.code.toByte())
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
}
