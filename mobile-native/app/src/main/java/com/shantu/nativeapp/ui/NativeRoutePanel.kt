package com.shantu.nativeapp.ui

import android.app.AlertDialog
import android.content.Context
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import android.widget.LinearLayout
import android.widget.Toast
import com.shantu.nativeapp.data.WorkspaceStore
import com.shantu.nativeapp.map.NativeMapController
import com.shantu.nativeapp.navigation.*
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.Executors
import kotlin.math.roundToInt

/** Planning UI owns a draft independently of saved favorites; cancelling never overwrites a route. */
class NativeRoutePanel(
    private val context: Context,
    private val chrome: HomeChrome,
    private val map: NativeMapController,
    private val store: WorkspaceStore,
    private val search: ((NativePlace) -> Unit) -> Unit,
    private val locate: () -> NativePlace?,
    private val onSaved: () -> Unit,
    private val onNavigate: (JSONObject, String) -> Unit = { _, _ -> },
    private val onShowRoute: ((NativePlannedRoute) -> Unit)? = null,
    private val onShareRoute: ((NativePlannedRoute) -> Unit)? = null,
    private val onCacheRoute: ((NativePlannedRoute) -> Unit)? = null,
    private val onEditRoute: ((NativePlannedRoute) -> Unit)? = null,
    private val onCancelRoute: ((NativePlannedRoute) -> Unit)? = null,
    private val planner: NativeRoutePlanner = NativeRoutePlanner(),
) {
    private val executor = Executors.newSingleThreadExecutor()
    private val handler = Handler(Looper.getMainLooper())
    private var cancellation: CancellationSignal? = null
    private var generation = 0
    private var closed = false
    private var start: NativePlace? = null
    private var end: NativePlace? = null
    private val via = mutableListOf<NativePlace>()
    private var mode = "pedestrian"
    private var route: NativePlannedRoute? = null
    private var message = ""

    fun setEnd(place: NativePlace) { end = place; invalidate(); show() }
    fun setStart(place: NativePlace) { start = place; invalidate(); show() }
    fun show() {
        chrome.showPanel("route", "路线规划") {
            val modes = LinearLayout(context)
            listOf("auto" to "驾车", "bicycle" to "骑行", "pedestrian" to "步行").forEach { (id, title) ->
                modes.addView(chrome.textButton(title) { mode = id; invalidate(); show() }.apply {
                    if (mode == id) setTextColor(ShantuColors.accent)
                }, LinearLayout.LayoutParams(0, chrome.dp(28), 1f))
            }
            addView(modes)
            addView(chrome.row("起点：${start?.name ?: "请选择"}") { choose("起点") { start = it; invalidate(); show() } })
            via.forEachIndexed { i, place ->
                val stopRow = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
                stopRow.addView(chrome.row("途经 ${i + 1}：${place.name}") {
                    AlertDialog.Builder(context).setItems(arrayOf("重新选择", "移除")) { _, which ->
                        if (which == 0) choose("途经点") { via[i] = it; invalidate(); show() }
                        else { via.removeAt(i); invalidate(); show() }
                    }.show()
                }, LinearLayout.LayoutParams(0, chrome.dp(32), 1f))
                stopRow.addView(chrome.textButton("↑", 12) { reorderVia(i, -1) }, LinearLayout.LayoutParams(chrome.dp(32), chrome.dp(32)))
                stopRow.addView(chrome.textButton("↓", 12) { reorderVia(i, 1) }, LinearLayout.LayoutParams(chrome.dp(32), chrome.dp(32)))
                addView(stopRow)
            }
            addView(chrome.row("终点：${end?.name ?: "请选择"}") { choose("终点") { end = it; invalidate(); show() } })
            val edits = LinearLayout(context)
            edits.addView(chrome.row("交换起终点") {
                val old = start; start = end; end = old; via.reverse(); invalidate(); show()
            }, LinearLayout.LayoutParams(0, chrome.dp(28), 1f))
            edits.addView(chrome.row("添加途经点") {
                if (via.size >= 8) toast("最多8个途经点") else choose("途经点") { via.add(it); invalidate(); show() }
            }, LinearLayout.LayoutParams(0, chrome.dp(28), 1f))
            addView(edits)
            if (via.isNotEmpty()) addView(chrome.row("清空途经点（${via.size}）") { via.clear(); invalidate(); show() })
            if (message.isNotEmpty()) addView(chrome.text(message, 12))
            if (cancellation != null) addView(chrome.row("取消规划") { invalidate(); message = "已取消规划"; show() })
            else addView(chrome.row("规划路线") { plan() })
            route?.let { planned ->
                addView(chrome.text("${distance(planned.distance)} · 约 ${(planned.duration / 60).roundToInt().coerceAtLeast(1)} 分钟", 12))
                if (planned.accessDistance > 0) addView(chrome.text("其中 ${distance(planned.accessDistance)} 为道路接入直线示意，请现场确认通行", 11))
                addView(chrome.row("保存到收藏") { save(planned) })
                addView(chrome.row("开始导航") { onNavigate(planned.toJson(), "${start?.name.orEmpty()} → ${end?.name.orEmpty()}") })
                addView(chrome.row("看全程") {
                    if (onShowRoute != null) onShowRoute.invoke(planned)
                    else runCatching {
                        NativeRouteViewport.fit(planned.coordinates, map.cameraSnapshot(), map.view.width, map.view.height)
                    }.onSuccess(map::restoreCamera).onFailure { toast("地图视野尚未就绪，请稍后重试") }
                })
                addView(chrome.row("分享路线") {
                    onShareRoute?.invoke(planned) ?: toast("路线分享待主界面接入")
                })
                addView(chrome.row("缓存沿线地图") {
                    onCacheRoute?.invoke(planned) ?: toast("沿线缓存待主界面接入")
                })
                addView(chrome.row("编辑路线") {
                    if (onEditRoute != null) onEditRoute.invoke(planned)
                    else { invalidate(); show() }
                })
                addView(chrome.row("查看路线步骤") { steps(planned) })
                addView(chrome.row("取消路线") {
                    onCancelRoute?.invoke(planned)
                    invalidate(); show()
                })
            }
        }
    }
    private fun choose(label: String, selected: (NativePlace) -> Unit) {
        AlertDialog.Builder(context).setTitle("选择$label").setItems(arrayOf("搜索地点", "地图中心", "当前位置")) { _, index ->
            when (index) {
                0 -> search(selected)
                1 -> { val camera = map.cameraSnapshot(); selected(NativePlace("地图选点", camera.longitude, camera.latitude)) }
                2 -> locate()?.let(selected) ?: toast("等待设备有效定位，请稍后再选")
            }
        }.show()
    }
    private fun invalidate() {
        generation++; cancellation?.cancel(); cancellation = null
        route = null; message = ""; map.removeRoute("planning-draft")
    }
    private fun reorderVia(index: Int, delta: Int) {
        val reordered = NativeRouteStopOrder.move(via, index, delta)
        if (reordered == via) return
        via.clear(); via.addAll(reordered)
        invalidate(); show()
    }
    private fun plan() {
        val a = start; val b = end
        if (a == null || b == null) { toast("请先选择起点和终点"); return }
        invalidate()
        val signal = CancellationSignal(); cancellation = signal
        val task = generation; val selectedMode = mode; val stops = via.toList()
        message = "正在规划…"; show()
        executor.execute {
            val result = runCatching { planner.plan(a, b, selectedMode, stops, signal) }
            handler.post {
                if (closed || generation != task || signal.isCanceled) return@post
                cancellation = null
                result.fold(onSuccess = {
                    route = it; message = ""
                    map.replaceRoute("planning-draft", it.coordinates.map { p -> p.latitude to p.longitude }, ShantuColors.accent, 2f)
                }, onFailure = { message = if (it is IllegalArgumentException || it is IllegalStateException) it.message.orEmpty().take(160) else "规划未完成，请检查网络后重试" })
                if (chrome.currentPanel() == "route") show()
            }
        }
    }
    private fun save(planned: NativePlannedRoute) {
        val input = chrome.input("路线名称").apply { setText("${planned.stops.first().name} → ${planned.stops.last().name}".take(200)) }
        val dialog = AlertDialog.Builder(context).setTitle("保存路线").setView(input).setNegativeButton("取消", null).setPositiveButton("保存", null).create()
        dialog.setOnShowListener { dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
            val name = input.text.toString().trim()
            if (name.isEmpty() || name.length > 200) { input.error = "名称需1–200个字符"; return@setOnClickListener }
            fun place(value: NativePlace) = JSONObject().put("name", value.name).put("coordinates", JSONArray().put(value.longitude).put(value.latitude))
            val favorite = JSONObject().put("id", UUID.randomUUID().toString()).put("name", name).put("savedAt", System.currentTimeMillis())
                .put("start", place(planned.stops.first())).put("end", place(planned.stops.last())).put("route", planned.toJson())
            runCatching { store.upsert("favorites", favorite) }.onSuccess {
                dialog.dismiss(); invalidate(); onSaved(); toast("路线已保存")
            }.onFailure { toast("保存未完成，规划结果保留") }
        } }
        dialog.show()
    }
    private fun steps(planned: NativePlannedRoute) {
        chrome.showPanel("route-steps", "路线步骤") {
            addView(chrome.row("返回路线") { show() })
            planned.steps.forEachIndexed { i, step ->
                addView(chrome.row("${i + 1}. ${step.instruction} · ${distance(step.distance)}") {
                    step.coordinates.firstOrNull()?.let { map.centerTo(it.latitude, it.longitude) }
                })
            }
        }
    }
    fun dispose() { closed = true; cancellation?.cancel(); executor.shutdownNow(); handler.removeCallbacksAndMessages(null) }
    private fun toast(message: String) = Toast.makeText(context, message, Toast.LENGTH_SHORT).show()
    private fun distance(m: Double) = if (m < 1000) "${m.roundToInt()} 米" else "${String.format(java.util.Locale.ROOT, "%.1f", m / 1000)} 公里"
}
