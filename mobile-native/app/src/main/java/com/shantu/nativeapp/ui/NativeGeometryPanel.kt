package com.shantu.nativeapp.ui

import android.app.AlertDialog
import android.content.Context
import android.widget.Toast
import com.shantu.nativeapp.data.WorkspaceStore
import com.shantu.nativeapp.data.NativeImportedSettings
import com.shantu.nativeapp.geometry.GeoPoint
import com.shantu.nativeapp.geometry.NativeMeasurements
import com.shantu.nativeapp.geometry.NativeAreaDisplay
import com.shantu.nativeapp.map.NativeMapController
import com.shantu.nativeapp.section.NativeMeasurementProfileExporter
import android.os.CancellationSignal
import android.widget.HorizontalScrollView
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale
import java.util.UUID

/** Native geometry drafts. Closing the panel preserves points and releases the drawing task. */
class NativeGeometryPanel(
    private val context: Context, private val chrome: HomeChrome,
    private val map: NativeMapController, private val store: WorkspaceStore,
    private val refreshMap: () -> Unit,
    /** Host must persist through its SAF/share destination and return true only after success. */
    private val onExportProfileImage: ((fileName: String, pngBytes: ByteArray) -> Boolean)? = null,
) {
    private val preferences = context.getSharedPreferences("native-geometry", Context.MODE_PRIVATE)
    private var kind = ""
    private val points = mutableListOf<GeoPoint>()
    private val pointMetadata = mutableListOf<JSONObject>()
    private var draftId = UUID.randomUUID().toString()
    private var existing: JSONObject? = null
    var acceptingMapPoints = false
        private set

    fun open(container: String, saved: JSONObject? = null) {
        require(container in listOf("measurements", "areas"))
        if (kind != container || saved != null) {
            persist(); kind = container; points.clear(); pointMetadata.clear(); existing = saved?.let { JSONObject(it.toString()) }
            draftId = saved?.getString("id") ?: UUID.randomUUID().toString()
            val raw = saved ?: runCatching { preferences.getString(container, null)?.let(::JSONObject) }.getOrNull()
            if (saved == null && raw != null) draftId = raw.optString("id", draftId)
            val list = raw?.optJSONArray(if (container == "areas") "boundary" else "points")
            if (list != null) for (i in 0 until list.length()) {
                val value = if (container == "areas") list.optJSONArray(i) else list.optJSONObject(i)?.optJSONArray("coordinates")
                if (value != null) runCatching {
                    val p = GeoPoint(value.getDouble(0), value.getDouble(1),
                        if (container == "measurements" && list.getJSONObject(i).opt("altitude") is Number) list.getJSONObject(i).getDouble("altitude") else null)
                    points.add(p)
                    pointMetadata.add(if (container == "measurements") JSONObject(list.getJSONObject(i).toString()) else JSONObject())
                }
            }
            if (kind == "areas" && points.size > 1 && points.first() == points.last()) points.removeAt(points.lastIndex)
        }
        acceptingMapPoints = false; chrome.setTaskActive(false); show()
    }
    fun addMapPoint(latitude: Double, longitude: Double) {
        if (!acceptingMapPoints) return
        if (!latitude.isFinite() || kotlin.math.abs(latitude) > 85 || !longitude.isFinite() || kotlin.math.abs(longitude) > 180) { toast("选点超出当前工具支持范围"); return }
        if (points.size >= if (kind == "areas") 6000 else 200) { toast("已达点数上限"); return }
        val elevation = map.getElevation(latitude, longitude)
        points.add(GeoPoint(longitude, latitude, elevation))
        pointMetadata.add(JSONObject().put("id", UUID.randomUUID().toString()).put("heightSource", if (elevation == null) "unknown" else "terrain"))
        persist(); draw()
        if (chrome.currentPanel() == "geometry") show()
    }
    fun stopPicking() { acceptingMapPoints = false; chrome.setTaskActive(false) }
    private fun show() {
        chrome.showPanel("geometry", if (kind == "areas") "划区域 · ${points.size} 点" else "连线测量 · ${points.size} 点") {
            val distance = NativeMeasurements.distance(points)
            addView(chrome.text("水平距离 ${length(distance)}", 12))
            if (kind == "measurements" && points.size >= 2) {
                val preview = HorizontalScrollView(context).apply {
                    isHorizontalScrollBarEnabled = true
                    addView(NativeMeasurementProjectionView(context, points.toList()))
                }
                addView(preview, android.widget.LinearLayout.LayoutParams(-1, chrome.dp(132)))
            }
            if (kind == "areas" && points.size >= 3) runCatching { NativeMeasurements.area(NativeMeasurements.closeBoundary(points)) }.onSuccess {
                val unit = NativeImportedSettings.readRuntime(context).areaUnit
                addView(chrome.row("球面面积 ${NativeAreaDisplay.format(it.area, unit)} · 周长 ${length(it.perimeter)} · 单位 ▾") {
                    val index = NativeAreaDisplay.units.indexOfFirst { entry -> entry.id == unit }.coerceAtLeast(0)
                    val next = NativeAreaDisplay.units[(index + 1) % NativeAreaDisplay.units.size]
                    context.getSharedPreferences(NativeImportedSettings.PREFS, Context.MODE_PRIVATE).edit().putString("area-unit", next.id).apply()
                    show()
                })
            }
            addView(chrome.row(if (acceptingMapPoints) "暂停地图选点" else "在地图点选") {
                acceptingMapPoints = !acceptingMapPoints; chrome.setTaskActive(acceptingMapPoints)
                chrome.closePanel(); if (acceptingMapPoints) chrome.status.text = "轻点地图添加${if (kind == "areas") "边界" else "测量"}点，拖动地图不会加点"
            })
            addView(chrome.row("添加地图中心点") {
                val camera = map.cameraSnapshot()
                val active = acceptingMapPoints; acceptingMapPoints = true
                addMapPoint(camera.latitude, camera.longitude); acceptingMapPoints = active; show()
            })
            addView(chrome.row("撤销点") { if (points.isNotEmpty()) { pointMetadata.removeAt(points.lastIndex); points.removeAt(points.lastIndex) }; persist(); draw(); show() })
            addView(chrome.row("编辑点坐标 / 高程") { pointList() })
            if (kind == "measurements" && points.size >= 2) addView(chrome.row("导出测量投影图 PNG") { chooseMeasurementExportPage() })
            addView(chrome.row(if (kind == "areas") "闭合并保存区域" else "保存测量") { save() })
            addView(chrome.row("清除当前草稿") {
                AlertDialog.Builder(context).setTitle("清除草稿？").setMessage("已保存对象保留。").setNegativeButton("取消", null)
                    .setPositiveButton("清除") { _, _ -> points.clear(); pointMetadata.clear(); existing = null; draftId = UUID.randomUUID().toString(); stopPicking(); persist(); refreshMap(); show() }.show()
            })
        }
        draw()
    }
    private fun pointList() {
        chrome.showPanel("geometry-points", "测点与边界节点") {
            addView(chrome.row("返回") { show() })
            points.forEachIndexed { i, p ->
                addView(chrome.row("${i + 1} · ${p.longitude}, ${p.latitude}") { editPoint(i) })
                if (i > 0) {
                    val m = NativeMeasurements.segment(points[i - 1], p)
                    addView(chrome.text("水平 ${length(m.horizontal)} · 高差 ${m.rise?.let(::length) ?: "待定"} · 空间 ${m.spatial?.let(::length) ?: "待定"}", 11))
                }
            }
        }
    }
    private fun editPoint(index: Int) {
        val p = points[index]
        chrome.showPanel("geometry-edit", "编辑第 ${index + 1} 点") {
            val coordinates = chrome.input("经度,纬度").apply { setText("${p.longitude},${p.latitude}") }; addView(coordinates)
            val height = chrome.input("海拔（米），未知留空").apply { setText(p.altitude?.toString().orEmpty()) }; addView(height)
            addView(chrome.row("保存节点") {
                val c = com.shantu.nativeapp.navigation.NativePlaceSearch.coordinate(coordinates.text.toString())
                val raw = height.text.toString().trim(); val altitude = if (raw.isEmpty()) null else raw.toDoubleOrNull()
                if (c == null || raw.isNotEmpty() && altitude == null) { toast("请输入有效坐标和高程"); return@row }
                runCatching {
                    val next = GeoPoint(c.first, c.second, altitude)
                    val proposed = points.toMutableList().apply { set(index, next) }
                    if (kind == "areas" && existing != null) NativeMeasurements.closeBoundary(proposed)
                    if (altitude != points[index].altitude) pointMetadata[index].put("heightSource", if (altitude == null) "unknown" else "manual")
                    points[index] = next; persist(); draw(); pointList()
                }.onFailure { toast(it.message ?: "节点无效") }
            })
            addView(chrome.row("删除节点") { points.removeAt(index); pointMetadata.removeAt(index); persist(); draw(); pointList() })
            addView(chrome.row("取消") { pointList() })
        }
    }
    private fun save() {
        if (points.size < if (kind == "areas") 3 else 2) { toast("点数不足，无法保存"); return }
        val ring = if (kind == "areas") runCatching { NativeMeasurements.closeBoundary(points) }.getOrElse { toast(it.message ?: "边界无效"); return } else points.toList()
        val input = chrome.input("名称").apply { setText(existing?.optString("name") ?: if (kind == "areas") "新建区域" else "连线测量") }
        val dialog = AlertDialog.Builder(context).setTitle("保存").setView(input).setNegativeButton("取消", null).setPositiveButton("保存", null).create()
        dialog.setOnShowListener { dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
            val name = input.text.toString().trim()
            if (name.isEmpty() || name.length > if (kind == "areas") 60 else 100) { input.error = "名称为空或过长"; return@setOnClickListener }
            val item = existing?.let { JSONObject(it.toString()) } ?: JSONObject().put("id", draftId)
            item.put("name", name)
            if (kind == "areas") {
                if (!item.has("createdAt")) item.put("createdAt", System.currentTimeMillis())
                if (!item.has("note")) item.put("note", "")
                if (!item.has("color")) item.put("color", "#d0f76b")
                if (!item.has("visible")) item.put("visible", true)
                item.put("boundary", JSONArray(ring.map { listOf(it.longitude, it.latitude) }))
            } else item.put("points", pointJson()).put("updatedAt", System.currentTimeMillis())
            runCatching { store.upsert(kind, item) }.onSuccess {
                dialog.dismiss(); stopPicking(); points.clear(); pointMetadata.clear(); existing = null; draftId = UUID.randomUUID().toString()
                preferences.edit().remove(kind).apply(); chrome.closePanel(); refreshMap(); toast("已保存")
            }.onFailure { toast("保存未完成，草稿保留") }
        } }
        dialog.show()
    }
    private fun pointJson() = JSONArray().also { array -> points.forEachIndexed { i, point ->
        val original = pointMetadata.getOrNull(i)
        val value = original?.let { JSONObject(it.toString()) } ?: JSONObject().put("id", UUID.randomUUID().toString())
        value.put("coordinates", JSONArray().put(point.longitude).put(point.latitude)).put("altitude", point.altitude ?: JSONObject.NULL)
            .put("heightSource", if (point.altitude == null) "unknown" else original?.optString("heightSource", "manual")?.takeIf { it != "unknown" } ?: "manual")
        array.put(value)
    } }

    private fun chooseMeasurementExportPage() {
        val callback = onExportProfileImage
        if (callback == null) { toast("剖面图片保存尚未接入系统文件/分享回调，测量数据未改变"); return }
        val total = (points.size - 1 + NativeMeasurementProfileExporter.SEGMENTS_PER_PAGE - 1) / NativeMeasurementProfileExporter.SEGMENTS_PER_PAGE
        val entries = (0 until total).map { "第 ${it + 1} / $total 页 · 测点 ${it * NativeMeasurementProfileExporter.SEGMENTS_PER_PAGE + 1}–${minOf(points.lastIndex, (it + 1) * NativeMeasurementProfileExporter.SEGMENTS_PER_PAGE)}" }.toTypedArray()
        val dialog = AlertDialog.Builder(context).setTitle("导出剖面图 PNG").setItems(entries) { _, page ->
            val signal = CancellationSignal()
            val source = points.toList()
            runCatching {
                val rendered = NativeMeasurementProfileExporter.render(source, existing?.optString("name") ?: "连线测量", page, signal)
                val saved = callback("测量剖面-${page + 1}.png", rendered.pngBytes())
                if (saved) toast("剖面图片已交给系统保存") else toast("系统保存未确认，原测量数据保留")
            }.onFailure { toast(it.message ?: "剖面图片生成失败，原测量数据保留") }
        }.setNegativeButton("取消", null).create()
        dialog.show()
    }
    private fun persist() {
        if (kind.isEmpty()) return
        preferences.edit().putString(kind, JSONObject().put("id", draftId)
            .put(if (kind == "areas") "boundary" else "points", if (kind == "areas") JSONArray(points.map { listOf(it.longitude, it.latitude) }) else pointJson()).toString()).apply()
    }
    private fun draw() {
        if (points.size >= 2) map.replaceRoute("geometry-draft", points.map { it.latitude to it.longitude }, ShantuColors.accent, 2f)
        else map.removeRoute("geometry-draft")
    }
    private fun length(value: Double) = if (kotlin.math.abs(value) < 1000) "${String.format(Locale.ROOT, "%.1f", value)} m" else "${String.format(Locale.ROOT, "%.3f", value / 1000)} km"
    private fun toast(message: String) = Toast.makeText(context, message, Toast.LENGTH_SHORT).show()
}
