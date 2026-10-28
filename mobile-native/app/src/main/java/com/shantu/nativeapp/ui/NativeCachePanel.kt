package com.shantu.nativeapp.ui

import android.app.AlertDialog
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.widget.LinearLayout
import android.widget.Toast
import androidx.core.app.NotificationManagerCompat
import com.shantu.nativeapp.map.NativeCacheManager
import com.shantu.nativeapp.map.NativeCachePlan
import com.shantu.nativeapp.map.NativeCacheSource
import com.shantu.nativeapp.map.NativeCacheTile
import com.shantu.nativeapp.map.NativeMapController
import com.shantu.nativeapp.map.nativeCacheFingerprint
import java.util.concurrent.Executors

internal class NativeCachePanel(
    private val context: Context, private val chrome: HomeChrome, private val map: NativeMapController,
    private val manager: NativeCacheManager, private val sources: () -> List<NativeCacheSource>,
) {
    private val worker=Executors.newSingleThreadExecutor()
    private val handler=Handler(Looper.getMainLooper())
    private var disposed=false
    private var generation=0
    private var estimatedFingerprint:String?=null
    private var creatingPackage=false
    private val refresh=object: Runnable {
        override fun run() {
            if(disposed) return
            chrome.findViewWithTag<android.widget.TextView>("cache-progress")?.text=manager.progress
            handler.postDelayed(this,1000)
        }
    }
    init { handler.post(refresh) }
    fun show(): Unit = chrome.showPanel("cache","离线地图缓存") {
        addView(chrome.row(if(manager.cacheOnly) "✓ 仅使用缓存 · 恢复在线" else "切换为仅使用缓存") {
            manager.cacheOnly=!manager.cacheOnly
            map.retryPendingTiles(); show()
        })
        addView(chrome.row("缓存当前中心周边") { create(listOf(map.centerLongitude to map.centerLatitude),"地图中心周边") })
        addView(chrome.text(manager.progress,11).apply { tag="cache-progress" })
        if(manager.activeId!=null) addView(chrome.row("暂停当前下载") { manager.pause(); toast("正在暂停，已完成的瓦片会保留") })
        val packages=manager.packages()
        addView(chrome.text("离线包 ${(packages.sumOf { it.optLong("bytes") }/1073741824.0).format()} / 8 GiB · 最多 250,000 项",11))
        packages.forEach { record ->
            addView(chrome.row(record.optString("name")) {
                chrome.showPanel("cache-package",record.optString("name")) {
                    addView(chrome.text(record.optString("sourceName"),12))
                    val total=record.getJSONArray("tiles").length()
                    addView(chrome.text("已保存 ${record.optInt("stored")} / $total 张 · ${(record.optLong("bytes")/1048576.0).format()} MiB",12))
                    addView(chrome.text("规划估算 ${(record.optLong("estimatedBytes")/1048576.0).format()} MiB · 容量上限 8 GiB",11))
                    addView(chrome.text(if(record.optString("state")=="complete") "下载完成" else "尚未完整下载，可继续补齐",11))
                    addView(chrome.row("继续下载 / 检查补齐") {
                        val source=sources().firstOrNull { it.id==record.optString("sourceId") }
                        if(source==null) toast("原图源已不可用，请恢复相同图源配置")
                        else runCatching { manager.start(record,source) }.onSuccess { show() }.onFailure { toast(it.message ?: "无法继续下载") }
                    })
                    addView(chrome.row("删除这个离线包") {
                        AlertDialog.Builder(context).setTitle("删除离线包？").setMessage("只删除“${record.optString("name")}”的离线瓦片，保留路线与其他离线包。")
                            .setNegativeButton("取消",null).setPositiveButton("删除") { _,_ ->
                                runCatching { manager.delete(record.getString("id")) }.onSuccess { map.retryPendingTiles(); show() }.onFailure { toast("请先等待下载暂停，然后重试删除") }
                            }.show()
                    })
                    addView(chrome.row("返回缓存列表") { show() })
                }
            })
        }
        if(packages.isEmpty()) addView(chrome.text("暂无离线包。收藏中的路线可选择“缓存沿线地图”。",12))
    }
    fun create(points: List<Pair<Double,Double>>, title: String) = createSegments(listOf(points),title)
    fun createSegments(segments: List<List<Pair<Double,Double>>>, title: String) {
        val list=sources()
        if(list.isEmpty()) { toast("没有可用图源"); return }
        var selected=list.firstOrNull { it.id==map.currentSource()?.id } ?: list.first()
        var planned: List<NativeCacheTile>?=null
        chrome.showPanel("cache-new","沿线地图缓存") {
            addView(chrome.text(title,12))
            val sourceButton=chrome.row("图源：${selected.name}") { }
            sourceButton.setOnClickListener {
                AlertDialog.Builder(context).setTitle("选择缓存图源").setItems(list.map { it.name }.toTypedArray()) { _,index ->
                    selected=list[index]; sourceButton.text="图源：${selected.name}"; planned=null; estimatedFingerprint=null; generation++
                }.show()
            }
            addView(sourceButton)
            val minimum=chrome.input("最低级别").apply { setText("12"); inputType=2 }
            val maximum=chrome.input("最高级别").apply { setText("15"); inputType=2 }
            val buffer=chrome.input("沿线宽度（公里）").apply { setText("1"); inputType=8194 }
            addView(chrome.text("起止级别（1—20），沿线半径（0.05—25公里）；上限 250,000 项 / 8 GiB",11))
            val row=LinearLayout(context)
            row.addView(minimum,LinearLayout.LayoutParams(0,-2,1f)); row.addView(maximum,LinearLayout.LayoutParams(0,-2,1f)); row.addView(buffer,LinearLayout.LayoutParams(0,-2,1f))
            addView(row)
            val estimate=chrome.text("请先估算下载量；不会自动开始请求。",11)
            addView(estimate)
            var estimatedParameters=""
            fun parameters()="${minimum.text}|${maximum.text}|${buffer.text}|${selected.id}"
            addView(chrome.row("估算下载量") {
                val low=minimum.text.toString().toIntOrNull(); val high=maximum.text.toString().toIntOrNull(); val radius=buffer.text.toString().toDoubleOrNull()
                if(low==null||high==null||radius==null) { toast("请输入正确的级别和半径"); return@row }
                val source=selected; val value=parameters(); val ticket=++generation
                estimate.text="正在计算沿线范围…"; planned=null
                worker.execute {
                    val result=runCatching {
                        val tiles=source.tilesForSegments(segments,low,high,radius)
                        NativeCachePlan.estimateBytes(tiles.size)
                        tiles to nativeCacheFingerprint(source,tiles)
                    }
                    handler.post {
                        if(disposed||generation!=ticket||chrome.currentPanel()!="cache-new") return@post
                        result.fold(onSuccess={plan->
                            val tiles=plan.first
                            val lowBytes=tiles.size.toLong()*20*1024
                            val highBytes=tiles.size.toLong()*100*1024
                            val plannedBytes=runCatching { NativeCachePlan.estimateBytes(tiles.size) }.getOrNull()
                            planned=if(plannedBytes==null) null else tiles
                            estimatedFingerprint=if(plannedBytes==null) null else plan.second
                            estimatedParameters=if(plannedBytes==null) "" else value
                            estimate.text="${tiles.size} 项请求；常见范围 ${(lowBytes/1048576.0).format()}—${(highBytes/1048576.0).format()} MiB${plannedBytes?.let { bytes -> "，规划值 ${(bytes/1048576.0).format()} MiB" } ?: "，规划估值超过 8 GiB，请缩小范围或降低级别"}；实际以图源响应为准。"
                        },onFailure={ estimate.text=it.message ?: "范围无法估算" })
                    }
                }
            })
            addView(chrome.text("下载会消耗所选图源的请求配额和网络流量；包含底图、注记及必要坐标转换边缘瓦片。失败请求可能重试一次。",11))
            addView(chrome.row("开始下载") {
                val tiles=planned
                val fingerprint=estimatedFingerprint
                if(creatingPackage) { toast("正在准备缓存任务，请稍候"); return@row }
                if(tiles==null || fingerprint==null || estimatedParameters!=parameters()) { toast("参数改变后请重新估算"); return@row }
                if(manager.cacheOnly) { toast("请先在缓存列表恢复在线加载"); return@row }
                val notificationNote=if(NotificationManagerCompat.from(context).areNotificationsEnabled())
                    "通知栏会显示后台进度与暂停/停止操作。" else "通知权限当前关闭；系统可能隐藏通知栏操作，缓存列表仍可查看进度并暂停。"
                AlertDialog.Builder(context).setTitle("下载 ${tiles.size} 张地图瓦片？")
                    .setMessage("图源：${selected.name}\n请求数：${tiles.size} 项；规划约 ${(NativeCachePlan.estimateBytes(tiles.size)/1048576.0).format()} MiB（按每项 20 KiB 粗估，常见范围 20—100 KiB/项）。将消耗该服务的请求配额和网络流量；可暂停并续传。$notificationNote 容量上限 8 GiB。")
                    .setNegativeButton("取消",null).setPositiveButton("开始下载") { _,_ ->
                        creatingPackage=true
                        val source=selected
                        worker.execute {
                            val result=runCatching { val record=manager.create(title,source,tiles,fingerprint); manager.start(record,source) }
                            handler.post {
                                creatingPackage=false
                                if(disposed) return@post
                                result.fold(onSuccess={ if(chrome.currentPanel()=="cache-new") show() },onFailure={ toast(it.message ?: "无法开始下载") })
                            }
                        }
                    }.show()
            })
            addView(chrome.row("返回缓存列表") { show() })
        }
    }
    fun dispose() { disposed=true; generation++; worker.shutdownNow(); handler.removeCallbacks(refresh); manager.close() }
    private fun Double.format()=String.format(java.util.Locale.ROOT,"%.1f",this)
    private fun toast(message:String)=Toast.makeText(context,message,Toast.LENGTH_LONG).show()
}
