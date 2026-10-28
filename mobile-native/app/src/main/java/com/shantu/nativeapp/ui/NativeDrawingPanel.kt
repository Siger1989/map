package com.shantu.nativeapp.ui

import android.app.AlertDialog
import android.content.Context
import android.graphics.Color
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.SeekBar
import android.widget.TextView
import com.shantu.nativeapp.drawing.NativeDrawingSnapMode
import com.shantu.nativeapp.drawing.NativeDrawingNodeRef
import com.shantu.nativeapp.drawing.NativeDrawingState
import com.shantu.nativeapp.data.NativeImportedSettings
import com.shantu.nativeapp.navigation.NativeCoordinate
import com.shantu.nativeapp.navigation.NativePlace
import com.shantu.nativeapp.navigation.NativePlannedRoute
import com.shantu.nativeapp.navigation.NativeRoutePlanner
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors
import kotlin.math.*

/** Matches the original track path interpolation and follows the shorter arc at the date line. */
internal fun drawingPathMidpoint(a: NativeCoordinate, b: NativeCoordinate): NativeCoordinate {
    val delta = ((b.longitude - a.longitude + 540.0) % 360.0) - 180.0
    val longitude = ((a.longitude + delta * .5 + 540.0) % 360.0) - 180.0
    return NativeCoordinate(longitude, (a.latitude + b.latitude) * .5)
}

data class NativeDrawingCallbacks(
    val onRequestMapPoint: (Boolean) -> Unit = {},
    val onRender: (JSONObject) -> Unit = {},
    val onDraftChanged: (JSONObject?) -> Unit = {},
    /** Called only after the user explicitly chooses to discard an un-restorable draft. */
    val onDiscardDamagedDraft: (JSONObject) -> Unit = {},
    /** Return false to leave the editable draft open and unchanged. */
    val onSave: (JSONObject) -> Boolean = { false },
    val onClose: () -> Unit = {},
    /** Return a real native river path, or null when that source is unavailable. */
    val onSnapRiver: ((NativeCoordinate, NativeCoordinate, CancellationSignal) -> List<NativeCoordinate>?)? = null,
)

private enum class DrawingInputMode { MAP_TAP, FREEHAND }

/** Route drawing/editor UI. Map coordinates and persistence remain explicit host callbacks. */
class NativeDrawingPanel(
    private val context: Context,
    private val chrome: HomeChrome,
    private val planner: NativeRoutePlanner = NativeRoutePlanner(),
    initialDraft: JSONObject? = null,
    private val callbacks: NativeDrawingCallbacks = NativeDrawingCallbacks(),
) {
    private val executor = Executors.newSingleThreadExecutor()
    private val handler = Handler(Looper.getMainLooper())
    private val snapTargets = mutableListOf<NativeCoordinate>()
    private val initialRestore = initialDraft?.let { runCatching { NativeDrawingState.restore(it) } }
    private var message = if (initialRestore?.isFailure == true)
        "此前保存的画线草稿无法恢复，原草稿已保留。请明确选择丢弃后再新建或载入路线。"
    else ""
    private var protectedDraftRaw: JSONObject? = initialDraft?.takeIf { initialRestore?.isFailure == true }
        ?.let { JSONObject(it.toString()) }
    private var state: NativeDrawingState? = initialRestore?.getOrNull()
    private var cancellation: CancellationSignal? = null
    private var generation = 0
    private var closed = false
    private var requestActive = false
    private var nameInput: EditText? = null
    private var noteInput: EditText? = null
    private var inputMode = DrawingInputMode.MAP_TAP
    private val selectedNodes = linkedSetOf<NativeDrawingNodeRef>()
    private var branchAnchor: NativeCoordinate? = null

    /** True only while the host may accept a completed, projected single-pointer stroke. */
    val acceptsFreehand: Boolean
        get() = !closed && state?.paused == false && requestActive && cancellation == null &&
            inputMode == DrawingInputMode.FREEHAND && state?.snapMode in setOf(NativeDrawingSnapMode.OFF, NativeDrawingSnapMode.NODE)

    /** Host supplies real map-projected coordinates after a single-pointer gesture completes. */
    fun onFreehandStroke(points: List<NativeCoordinate>): Boolean {
        if (!acceptsFreehand) return false
        val current = state ?: return false
        return runCatching { current.appendStroke(points) }.fold(
            onSuccess = { didChange ->
                if (didChange) {
                    message = "自由手绘线已加入草稿，可一次撤销。"
                    changed()
                } else message = "手绘线没有新增节点，草稿未改变。"
                showIfOpen()
                didChange
            },
            onFailure = { error ->
                message = error.message ?: "手绘线无效，草稿未改变。"
                showIfOpen()
                false
            },
        )
    }

    fun startNew(name: String? = null) {
        if (protectedDraftRaw != null) { show(); return }
        val existing = state
        if (existing != null && existing.pointCount() > 0) {
            callbacks.onDraftChanged(existing.toDraft())
            message = "当前草稿已保留；请先保存或继续编辑，避免覆盖未完成线路。"
            showIfOpen()
            return
        }
        cancelRoadRequest()
        state = newTrack(name.orEmpty())
        state?.setPaused(false)
        message = "轻点地图添加路线节点。道路吸附会按真实道路服务返回结果。"
        requestMap(true)
        changed()
        show()
    }

    fun continueFrom(track: JSONObject, draft: JSONObject? = null) {
        if (protectedDraftRaw != null) { show(); return }
        val existing = state
        if (draft == null && existing != null && existing.pointCount() > 0) {
            callbacks.onDraftChanged(existing.toDraft())
            message = "当前草稿已保留；请先保存或继续编辑，避免覆盖未完成线路。"
            showIfOpen()
            return
        }
        cancelRoadRequest()
        state = NativeDrawingState.continueFrom(track, draft)
        state?.setPaused(false)
        message = if (track.optString("source") == "recorded" || track.has("samples"))
            "已从实走轨迹创建手绘副本，原始记录保持不变。"
        else "已载入路线副本编辑，原记录在保存前保持不变。"
        requestMap(true)
        changed()
        show()
    }

    /** Map host forwards only a genuine user tap coordinate. */
    fun onMapPoint(longitude: Double, latitude: Double) {
        val current = state ?: return
        if (closed || current.paused || !requestActive || cancellation != null) return
        if (inputMode == DrawingInputMode.FREEHAND && current.snapMode in setOf(NativeDrawingSnapMode.OFF, NativeDrawingSnapMode.NODE)) return
        val point = NativeCoordinate(longitude, latitude)
        val valid = longitude.isFinite() && latitude.isFinite() && longitude in -180.0..180.0 && latitude in -85.051129..85.051129
        if (!valid) { message = "地图返回的坐标无效，草稿未改变。"; showIfOpen(); return }
        when (current.snapMode) {
            NativeDrawingSnapMode.ROAD -> {
                val anchor = branchAnchor ?: lastCoordinate(current.snapshot())
                if (anchor == null) addPoint(snapNode(point)) else planRoad(anchor, point)
            }
            NativeDrawingSnapMode.RIVER -> {
                val anchor = branchAnchor ?: lastCoordinate(current.snapshot())
                if (anchor == null) addPoint(snapNode(point)) else snapRiver(anchor, point)
            }
            NativeDrawingSnapMode.NODE -> addPoint(snapNode(point))
            NativeDrawingSnapMode.OFF -> addPoint(point)
        }
        if (inputMode == DrawingInputMode.FREEHAND && current.snapMode in setOf(NativeDrawingSnapMode.ROAD, NativeDrawingSnapMode.RIVER)) {
            message = "道路/河流吸附沿用地图点选；关闭网络吸附后才可自由手绘。"
            showIfOpen()
        }
    }

    /** Set current visible route/track vertices used by the original point-snap strategy. */
    fun setSnapTargets(points: List<NativeCoordinate>) {
        snapTargets.clear()
        snapTargets += points.filter { it.longitude.isFinite() && it.latitude.isFinite() && it.longitude in -180.0..180.0 && it.latitude in -85.051129..85.051129 }
    }

    fun show() {
        val current = state ?: newTrack().also { state = it }
        closed = false
        val snapshot = current.snapshot()
        chrome.showPanelWithSlots(
            id = "draw",
            title = "画线",
            topAligned = true,
            width = 300,
            maxHeightDp = 200,
            fixedHeader = {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                addView(chrome.textButton("‹ 返回", 12) { closeKeepingDraft() }.apply {
                    gravity = Gravity.CENTER_VERTICAL or Gravity.START
                    setPadding(chrome.dp(4), 0, chrome.dp(4), 0)
                }, LinearLayout.LayoutParams(chrome.dp(56), chrome.dp(36)))
                addView(chrome.text("画线", 14).apply {
                    setTypeface(null, android.graphics.Typeface.BOLD)
                    gravity = Gravity.CENTER_VERTICAL or Gravity.START
                }, LinearLayout.LayoutParams(0, chrome.dp(36), 1f))
                addView(chrome.textButton("×", 18) { closeKeepingDraft() }.apply {
                    setTextColor(ShantuColors.close)
                    contentDescription = "关闭画线"
                }, LinearLayout.LayoutParams(chrome.dp(36), chrome.dp(36)))
            },
            fixedFooter = {
                gravity = Gravity.CENTER_VERTICAL
                orientation = LinearLayout.HORIZONTAL
                if (protectedDraftRaw == null) {
                    addView(chrome.textButton(if (requestActive) "停止点选" else "地图点选", 11) {
                        if (requestActive) pause() else resume()
                    }.apply { setPadding(chrome.dp(6), 0, chrome.dp(6), 0) },
                        LinearLayout.LayoutParams(0, chrome.dp(32), 1f).apply { rightMargin = chrome.dp(4) })
                    addView(chrome.textButton(if (current.paused) "继续" else "暂停", 11) {
                        if (current.paused) resume() else pause()
                    }.apply { setPadding(chrome.dp(6), 0, chrome.dp(6), 0) },
                        LinearLayout.LayoutParams(0, chrome.dp(32), 1f).apply { rightMargin = chrome.dp(4) })
                    addView(chrome.textButton("保存", 12) { save() }.apply {
                        background = chrome.surface(HomeChromeMetrics.CONTROL_RADIUS_DP, ShantuColors.accent)
                        setTextColor(ShantuColors.surface)
                        setPadding(chrome.dp(10), 0, chrome.dp(10), 0)
                    }, LinearLayout.LayoutParams(-2, chrome.dp(32)))
                }
            },
            content = {
                if (protectedDraftRaw != null) {
                    addView(chrome.text(message, 12).apply { setTextColor(ShantuColors.muted) })
                    addView(chrome.text("原始草稿内容由宿主保留；本面板不会自动清除或替换。", 11).apply { setTextColor(ShantuColors.muted) })
                    addView(chrome.row("丢弃损坏草稿并新建") {
                        val damagedDraft = protectedDraftRaw
                        if (damagedDraft != null) {
                            callbacks.onDiscardDamagedDraft(damagedDraft)
                            protectedDraftRaw = null
                            callbacks.onDraftChanged(null)
                            state = newTrack()
                            state?.setPaused(true)
                            message = "已按你的选择丢弃无法恢复的草稿。"
                            changed()
                            show()
                        }
                    })
                } else buildBody(this, current, snapshot)
            },
        )
    }

    fun pause() {
        val current = state ?: return
        cancelRoadRequest()
        current.setPaused(true)
        requestMap(false)
        message = "画线已暂停，草稿已保留。"
        changed()
        showIfOpen()
    }

    fun resume() {
        val current = state ?: return
        current.setPaused(false)
        requestMap(true)
        message = "轻点地图继续添加路线节点。"
        changed()
        showIfOpen()
    }

    fun cancelRoadRequest() {
        generation++
        cancellation?.cancel()
        cancellation = null
    }

    fun dispose() {
        closed = true
        pauseWithoutPanel()
        if (protectedDraftRaw == null) callbacks.onDraftChanged(state?.toDraft())
        executor.shutdownNow()
        handler.removeCallbacksAndMessages(null)
    }

    /** Close the editor while retaining a resumable draft. */
    fun close() = closeKeepingDraft()

    private fun buildBody(target: LinearLayout, current: NativeDrawingState, snapshot: JSONObject) {
        target.addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
            override fun onViewAttachedToWindow(view: View) = Unit
            override fun onViewDetachedFromWindow(view: View) {
                // Chrome rebuilds this panel for edits; defer the check until that replacement is installed.
                handler.post {
                    if (!closed && chrome.currentPanel() != "draw") finishPanelExit()
                }
            }
        })
        target.orientation = LinearLayout.VERTICAL
        target.addView(chrome.text("${current.pointCount()} 个节点 · ${current.segmentCount()} 段", 11).apply {
            setTextColor(ShantuColors.muted)
        })
        if (message.isNotBlank()) target.addView(chrome.text(message, 11).apply { setTextColor(ShantuColors.muted) })
        if (cancellation != null) target.addView(chrome.row("取消网络吸附 / 道路规划") { cancelRoadRequest(); message = "网络请求已取消，草稿保持不变。"; show() })

        target.addView(chrome.text("输入方式", 11).apply { setTextColor(ShantuColors.muted) })
        val inputRow = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
        listOf(DrawingInputMode.MAP_TAP to "地图点选", DrawingInputMode.FREEHAND to "自由手绘").forEach { (mode, label) ->
            inputRow.addView(chrome.row(label) {
                inputMode = mode
                message = if (mode == DrawingInputMode.FREEHAND && current.snapMode in setOf(NativeDrawingSnapMode.ROAD, NativeDrawingSnapMode.RIVER))
                    "道路/河流吸附沿用地图点选；关闭网络吸附后才可自由手绘。"
                else if (mode == DrawingInputMode.FREEHAND) "单指完成一笔后提交；多指手势由地图宿主取消。"
                else "轻点地图逐个添加节点。"
                show()
            }.apply {
                gravity = Gravity.CENTER
                if (inputMode == mode) setTextColor(ShantuColors.accent)
            }, LinearLayout.LayoutParams(0, chrome.dp(28), 1f).apply { rightMargin = chrome.dp(3) })
        }
        target.addView(inputRow)

        target.addView(chrome.text("吸附方式", 11).apply { setTextColor(ShantuColors.muted) })
        val snapRow = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
        listOf(
            NativeDrawingSnapMode.NODE to "节点",
            NativeDrawingSnapMode.ROAD to "道路",
            NativeDrawingSnapMode.RIVER to "河流",
            NativeDrawingSnapMode.OFF to "自由",
        ).forEach { (mode, label) ->
            snapRow.addView(chrome.row(label) {
                current.setSnapMode(mode)
                changed()
                show()
            }.apply {
                gravity = Gravity.CENTER
                if (current.snapMode == mode) setTextColor(ShantuColors.accent)
            }, LinearLayout.LayoutParams(0, chrome.dp(28), 1f).apply { rightMargin = chrome.dp(3) })
        }
        target.addView(snapRow)
        if (current.snapMode == NativeDrawingSnapMode.RIVER && callbacks.onSnapRiver == null) {
            target.addView(chrome.text("当前主端尚未提供河流几何数据；此模式不会假造河道线。", 10).apply { setTextColor(ShantuColors.muted) })
        }

        target.addView(chrome.text("道路出行方式", 11).apply { setTextColor(ShantuColors.muted) })
        val modeRow = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
        listOf("auto" to "驾车", "bicycle" to "骑行", "pedestrian" to "步行").forEach { (mode, label) ->
            modeRow.addView(chrome.row(label) {
                current.setTravelMode(mode)
                changed()
                show()
            }.apply {
                gravity = Gravity.CENTER
                if (current.travelMode == mode) setTextColor(ShantuColors.accent)
            }, LinearLayout.LayoutParams(0, chrome.dp(28), 1f).apply { rightMargin = chrome.dp(3) })
        }
        target.addView(modeRow)

        val style = snapshot.optJSONObject("style") ?: JSONObject().put("color", NativeDrawingState.DEFAULT_COLOR).put("width", 1.5).put("opacity", 1.0)
        target.addView(chrome.text("线条样式", 11).apply { setTextColor(ShantuColors.muted) })
        val colorRow = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        colorRow.addView(chrome.textButton("颜色", 12) { colorPicker(current, style.optString("color", NativeDrawingState.DEFAULT_COLOR)) }.apply {
            background = chrome.surface(HomeChromeMetrics.CONTROL_RADIUS_DP, Color.parseColor(style.optString("color", NativeDrawingState.DEFAULT_COLOR)))
            setTextColor(contrastInk(style.optString("color", NativeDrawingState.DEFAULT_COLOR)))
            setPadding(chrome.dp(8), 0, chrome.dp(8), 0)
        }, LinearLayout.LayoutParams(chrome.dp(64), chrome.dp(28)).apply { rightMargin = chrome.dp(4) })
        val widths = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
        listOf(.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0).forEach { width ->
            widths.addView(chrome.row(width.toString()) {
                runCatching { current.setStyleWidth(width) }.onFailure { message = it.message.orEmpty() }
                changed(); show()
            }.apply {
                gravity = Gravity.CENTER
                if (abs(style.optDouble("width", 1.5) - width) < .001) setTextColor(ShantuColors.accent)
            }, LinearLayout.LayoutParams(0, chrome.dp(28), 1f).apply { rightMargin = chrome.dp(2) })
        }
        colorRow.addView(widths, LinearLayout.LayoutParams(0, chrome.dp(28), 1f))
        target.addView(colorRow)
        val opacityRow = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        val opacityLabel = chrome.text("不透明度 ${((style.optDouble("opacity", 1.0) * 100).roundToInt())}%", 10)
        opacityRow.addView(opacityLabel, LinearLayout.LayoutParams(chrome.dp(84), chrome.dp(30)))
        opacityRow.addView(SeekBar(context).apply {
            max = 90
            progress = ((style.optDouble("opacity", 1.0).coerceIn(.1, 1.0) - .1) * 100).roundToInt()
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(seekBar: SeekBar?, value: Int, fromUser: Boolean) {
                    opacityLabel.text = "不透明度 ${10 + value}%"
                    if (fromUser) {
                        current.setStyleOpacity((.1 + value / 100.0).coerceIn(.1, 1.0))
                        changed()
                    }
                }
                override fun onStartTrackingTouch(seekBar: SeekBar?) = Unit
                override fun onStopTrackingTouch(seekBar: SeekBar?) { if (seekBar != null) { message = "线条不透明度已更新。"; show() } }
            })
        }, LinearLayout.LayoutParams(0, chrome.dp(30), 1f))
        target.addView(opacityRow)

        nameInput = chrome.input("线路名称（最多60字）").apply {
            filters = arrayOf(android.text.InputFilter.LengthFilter(60))
            setText(snapshot.optString("name"))
            setOnFocusChangeListener { _, hasFocus -> if (!hasFocus) commitTextFields(current) }
        }
        target.addView(nameInput)
        noteInput = EditText(context).apply {
            hint = "当前线条颜色的路况 / 备注（可选）"
            textSize = 16f
            setTextColor(ShantuColors.ink)
            setHintTextColor(ShantuColors.muted)
            setPadding(chrome.dp(8), chrome.dp(4), chrome.dp(8), chrome.dp(4))
            background = chrome.surface(HomeChromeMetrics.CONTROL_RADIUS_DP, ShantuColors.raised)
            minLines = 2
            maxLines = 3
            filters = arrayOf(android.text.InputFilter.LengthFilter(NativeDrawingState.MAX_NOTE_LENGTH))
            setText(snapshot.optJSONObject("colorConditions")?.optString(style.optString("color", NativeDrawingState.DEFAULT_COLOR)).orEmpty())
            setOnFocusChangeListener { _, hasFocus -> if (!hasFocus) commitTextFields(current) }
        }
        target.addView(noteInput, LinearLayout.LayoutParams(-1, chrome.dp(56)).apply { topMargin = chrome.dp(4) })

        val tools = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
        listOf(
            "撤销" to { if (!current.undo()) message = "没有可撤销的更改。" else message = "已撤销。" },
            "重做" to { if (!current.redo()) message = "没有可重做的更改。" else message = "已重做。" },
            "反向" to { current.reverse(); message = "路线方向已反转。" },
            "清空" to { confirmClear() },
        ).forEach { (label, action) ->
            tools.addView(chrome.row(label) {
                action()
                if (label != "清空") { changed(); show() }
            }.apply { gravity = Gravity.CENTER }, LinearLayout.LayoutParams(0, chrome.dp(28), 1f).apply { rightMargin = chrome.dp(3) })
        }
        target.addView(tools)

        val batch = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
        batch.addView(chrome.row("删 ${selectedNodes.size} 点") {
            runCatching { current.deleteNodes(selectedNodes.toSet()) }.onSuccess { count ->
                selectedNodes.clear(); changed(); message = "已删除${count}个节点，断段已保留。"; show()
            }.onFailure { message = it.message.orEmpty(); show() }
        }, LinearLayout.LayoutParams(0, chrome.dp(30), 1f))
        batch.addView(chrome.row("从选点分叉") {
            val ref = selectedNodes.firstOrNull()
            val line = ref?.let { snapshot.optJSONArray("segments")?.optJSONArray(it.segment) }
            val anchor = if (ref == null) null else line?.optJSONArray(ref.index)?.let(::parseCoordinate)
            if (anchor == null) message = "先选择一个路线节点。" else {
                branchAnchor = anchor; current.setPaused(false); requestMap(true)
                message = "分叉起点已选；下一次地图点选会创建独立分支。"
            }
            show()
        }, LinearLayout.LayoutParams(0, chrome.dp(30), 1f).apply { leftMargin = chrome.dp(3) })
        batch.addView(chrome.row("连接两点") {
            val pair = selectedNodes.take(2)
            if (pair.size != 2) message = "请选择两个节点后连接。" else runCatching { current.connectNodes(pair[0], pair[1]) }
                .onSuccess { selectedNodes.clear(); changed(); message = "已按明确选点新增连接线段。" }
                .onFailure { message = it.message.orEmpty() }
            show()
        }, LinearLayout.LayoutParams(0, chrome.dp(30), 1f).apply { leftMargin = chrome.dp(3) })
        batch.addView(chrome.row("合并相接段") {
            val pair = selectedNodes.map { it.segment }.distinct().take(2)
            if (pair.size != 2) message = "分别选择两条线段上的节点后合并。" else runCatching { current.mergeSegments(pair[0], pair[1]) }
                .onSuccess { selectedNodes.clear(); changed(); message = "已合并相接线段；未连接的端点不补线。" }
                .onFailure { message = it.message.orEmpty() }
            show()
        }, LinearLayout.LayoutParams(0, chrome.dp(30), 1f).apply { leftMargin = chrome.dp(3) })
        target.addView(batch)

        target.addView(chrome.text("节点列表 · 点选复选支持批量删点、分叉、连接与合并", 11).apply { setTextColor(ShantuColors.muted) })
        val segments = snapshot.optJSONArray("segments") ?: JSONArray()
        for (s in 0 until segments.length()) {
            val line = segments.optJSONArray(s) ?: continue
            for (i in 0 until line.length()) {
                val coordinate = parseCoordinate(line.optJSONArray(i)) ?: continue
                val row = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
                row.addView(chrome.text("${s + 1}.${i + 1}  ${formatCoordinate(coordinate)}", 10).apply {
                    gravity = Gravity.CENTER_VERTICAL or Gravity.START
                    setPadding(chrome.dp(4), 0, chrome.dp(4), 0)
                }, LinearLayout.LayoutParams(0, chrome.dp(28), 1f))
                val ref = NativeDrawingNodeRef(s, i)
                row.addView(chrome.row(if (ref in selectedNodes) "✓选" else "选") {
                    if (!selectedNodes.add(ref)) selectedNodes.remove(ref)
                    show()
                }.apply { gravity = Gravity.CENTER; if (ref in selectedNodes) setTextColor(ShantuColors.accent) }, LinearLayout.LayoutParams(chrome.dp(36), chrome.dp(28)))
                row.addView(chrome.row("编辑") { editNode(current, s, i, coordinate) }.apply { gravity = Gravity.CENTER },
                    LinearLayout.LayoutParams(chrome.dp(48), chrome.dp(28)))
                if (i < line.length() - 1) row.addView(chrome.row("插点") { insertNode(current, s, i + 1) }.apply { gravity = Gravity.CENTER },
                    LinearLayout.LayoutParams(chrome.dp(48), chrome.dp(28)))
                target.addView(row)
            }
        }
        if (segments.length() == 0) target.addView(chrome.text("尚无节点。点击“地图点选”后在真实地图上轻点添加。", 11).apply { setTextColor(ShantuColors.muted) })
        target.addView(chrome.row("继续地图点选") { resume() })
        target.addView(chrome.row("保存草稿并关闭") { closeKeepingDraft() })
    }

    private fun addPoint(point: NativeCoordinate) {
        val current = state ?: return
        val anchor = branchAnchor
        runCatching { if (anchor != null) current.appendBranch(anchor, point) else current.appendPoint(point) }.onSuccess {
            if (anchor != null) branchAnchor = null
            selectedNodes.clear()
            changed(); message = if (anchor != null) "分叉线段已从选中节点开始；原路线保持不变。" else if (it) "节点已加入草稿。" else "与上一个节点相同，未重复添加。"
        }
            .onFailure { message = it.message ?: "节点未加入，草稿保持不变。" }
        showIfOpen()
    }

    private fun snapNode(point: NativeCoordinate): NativeCoordinate {
        val currentPoints = state?.nodes()?.map { it.second }.orEmpty()
        val candidate = (snapTargets + currentPoints).distinctBy { "${it.longitude},${it.latitude}" }
            .minByOrNull { distanceMeters(point, it) }
        return candidate?.takeIf { distanceMeters(point, it) <= NODE_SNAP_METERS } ?: point
    }

    private fun planRoad(from: NativeCoordinate, to: NativeCoordinate) {
        val current = state ?: return
        val signal = CancellationSignal()
        cancellation = signal
        val task = ++generation
        val mode = current.travelMode
        message = "正在请求真实道路路线…"
        showIfOpen()
        executor.execute {
            val result = runCatching {
                planner.plan(NativePlace("当前线段起点", from.longitude, from.latitude), NativePlace("地图选点", to.longitude, to.latitude), mode, cancellationSignal = signal)
            }
            handler.post {
                if (closed || generation != task || signal.isCanceled) return@post
                cancellation = null
                result.fold(
                    onSuccess = { route ->
                        runCatching { current.appendRoadLeg(route) }
                            .onSuccess { branchAnchor = null; changed(); message = if (route.accessDistance > 0) "已加入${modeLabel(route.mode)}道路段；另有${route.accessDistance.roundToInt()}米接入距离未画作道路。" else "已加入真实道路路线段。" }
                            .onFailure { message = it.message ?: "道路路线无效，原草稿保留。" }
                    },
                    onFailure = { error -> message = if (error is InterruptedException || error is java.util.concurrent.CancellationException) "道路规划已取消，原草稿保留。" else "道路规划失败：${error.message ?: "请检查网络后重试"}".take(180) },
                )
                showIfOpen()
            }
        }
    }

    private fun snapRiver(from: NativeCoordinate, to: NativeCoordinate) {
        val snap = callbacks.onSnapRiver
        if (snap == null) { message = "河流吸附数据不可用；草稿未改变。"; showIfOpen(); return }
        val signal = CancellationSignal(); cancellation = signal
        val task = ++generation
        message = "正在查询河流水系中心线…"; showIfOpen()
        executor.execute {
            val result = runCatching { snap(from, to, signal) }
            handler.post {
                if (closed || generation != task || signal.isCanceled) return@post
                cancellation = null
                result.fold(
                    onSuccess = { points ->
                        if (points == null || points.size < 2) message = "附近没有可连接的河流中心线，草稿未改变。"
                        else runCatching { state?.appendRiverLeg(points) }
                            .onSuccess { branchAnchor = null; changed(); message = "已加入 OpenStreetMap 河流数据的实际中心线。" }
                            .onFailure { message = it.message ?: "河流线段无效，草稿未改变。" }
                    },
                    onFailure = { error -> message = if (error is java.util.concurrent.CancellationException || error is android.os.OperationCanceledException) "河流吸附已取消，草稿保持不变。" else "河流吸附失败：${error.message ?: "请检查网络"}".take(180) },
                )
                showIfOpen()
            }
        }
    }

    private fun insertNode(current: NativeDrawingState, segment: Int, index: Int) {
        val line = current.snapshot().optJSONArray("segments")?.optJSONArray(segment) ?: return
        val a = parseCoordinate(line.optJSONArray(index - 1)) ?: return
        val b = parseCoordinate(line.optJSONArray(index)) ?: return
        val middle = drawingPathMidpoint(a, b)
        val lat = chrome.input("纬度").apply { setText(middle.latitude.toString()) }
        val lon = chrome.input("经度").apply { setText(middle.longitude.toString()) }
        val form = verticalForm().apply { addView(lat); addView(lon) }
        val dialog = AlertDialog.Builder(context).setTitle("插入路线节点").setView(form)
            .setNegativeButton("取消", null).setPositiveButton("插入", null).create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val point = parsePoint(lon.text.toString(), lat.text.toString())
                if (point == null) { lon.error = "请输入有效经纬度"; return@setOnClickListener }
                runCatching { current.insertNode(segment, index, point) }.onSuccess {
                    dialog.dismiss(); changed(); message = "已插入节点。"; show()
                }.onFailure { lon.error = it.message }
            }
        }
        dialog.show()
    }

    private fun editNode(current: NativeDrawingState, segment: Int, index: Int, original: NativeCoordinate) {
        val lon = chrome.input("经度").apply { setText(original.longitude.toString()) }
        val lat = chrome.input("纬度").apply { setText(original.latitude.toString()) }
        val form = verticalForm().apply { addView(lon); addView(lat) }
        val dialog = AlertDialog.Builder(context).setTitle("编辑节点 ${segment + 1}.${index + 1}").setView(form)
            .setNegativeButton("取消", null).setNeutralButton("删除", null).setPositiveButton("保存", null).create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener {
                AlertDialog.Builder(context).setTitle("删除此节点？").setMessage("删除后，原线段会在此处断开，不会补出直线。")
                    .setNegativeButton("取消", null).setPositiveButton("删除") { _, _ ->
                        runCatching { current.deleteNode(segment, index) }.onSuccess { changed(); message = "节点已删除，断点已保留。"; dialog.dismiss(); show() }
                            .onFailure { message = it.message.orEmpty(); showIfOpen() }
                    }.show()
            }
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val point = parsePoint(lon.text.toString(), lat.text.toString())
                if (point == null) { lon.error = "请输入有效经纬度"; return@setOnClickListener }
                runCatching { current.moveNode(segment, index, point) }.onSuccess {
                    dialog.dismiss(); changed(); message = "节点已更新。"; show()
                }.onFailure { lon.error = it.message }
            }
        }
        dialog.show()
    }

    private fun colorPicker(current: NativeDrawingState, currentColor: String) {
        lateinit var picker: AlertDialog
        val colors = listOf("#ffb477", "#d0f76b", "#ff625c", "#377eb8", "#4daf4a", "#984ea3", "#ff7f00", "#ffffff", "#10243c")
        val grid = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; setPadding(chrome.dp(8), chrome.dp(8), chrome.dp(8), 0) }
        colors.chunked(3).forEach { values ->
            val row = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
            values.forEach { color ->
                row.addView(chrome.textButton(if (color.equals(currentColor, true)) "✓" else "", 14) {
                    current.setStyleColor(color); changed(); message = "线条颜色已更新。"; picker.dismiss(); show()
                }.apply {
                    background = chrome.surface(HomeChromeMetrics.CONTROL_RADIUS_DP, Color.parseColor(color))
                    setTextColor(contrastInk(color))
                }, LinearLayout.LayoutParams(0, chrome.dp(40), 1f).apply { rightMargin = chrome.dp(4); bottomMargin = chrome.dp(4) })
            }
            grid.addView(row)
        }
        val custom = chrome.input("自定义色值 #RRGGBB").apply { setText(currentColor); filters = arrayOf(android.text.InputFilter.LengthFilter(7)) }
        grid.addView(custom)
        val dialog = AlertDialog.Builder(context).setTitle("线条颜色").setView(grid).setNegativeButton("取消", null).setPositiveButton("应用", null).create()
        picker = dialog
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                runCatching { current.setStyleColor(custom.text.toString()) }.onSuccess {
                    dialog.dismiss(); changed(); message = "线条颜色已更新。"; show()
                }.onFailure { custom.error = it.message }
            }
        }
        dialog.show()
    }

    private fun confirmClear() {
        AlertDialog.Builder(context).setTitle("清空未保存草稿？")
            .setMessage("已保存的原线路保持不变。")
            .setNegativeButton("取消", null)
            .setPositiveButton("清空") { _, _ ->
                state = newTrack()
                state?.setPaused(true)
                requestMap(false)
                message = "草稿已清空。"
                changed(); show()
            }.show()
    }

    private fun save() {
        val current = state ?: return
        commitTextFields(current)
        if (current.pointCount() == 0) { message = "请先添加路线节点，再保存。"; showIfOpen(); return }
        val result = runCatching { callbacks.onSave(current.toTrack()) }.getOrElse {
            message = "保存失败：${it.message ?: "请重试"}。草稿已保留。"; showIfOpen(); return
        }
        if (!result) { message = "保存未完成，当前草稿已保留。"; showIfOpen(); return }
        current.setPaused(true)
        requestMap(false)
        cancelRoadRequest()
        callbacks.onDraftChanged(null)
        closed = true
        state = null
        nameInput = null
        noteInput = null
        callbacks.onClose()
        chrome.closePanel()
    }

    private fun closeKeepingDraft() {
        if (closed) return
        finishPanelExit()
        chrome.closePanel()
    }

    private fun finishPanelExit() {
        if (closed) return
        pauseWithoutPanel()
        if (protectedDraftRaw == null) callbacks.onDraftChanged(state?.toDraft())
        closed = true
        nameInput = null
        noteInput = null
        callbacks.onClose()
    }

    private fun pauseWithoutPanel() {
        cancelRoadRequest()
        branchAnchor = null
        state?.setPaused(true)
        requestMap(false)
    }

    private fun commitTextFields(current: NativeDrawingState) {
        nameInput?.text?.toString()?.let { runCatching { current.setName(it) } }
        val color = current.snapshot().optJSONObject("style")?.optString("color", NativeDrawingState.DEFAULT_COLOR) ?: NativeDrawingState.DEFAULT_COLOR
        noteInput?.text?.toString()?.let { runCatching { current.setColorCondition(color, it) } }
        changed()
    }

    private fun newTrack(name:String=""):NativeDrawingState {
        val style=NativeImportedSettings.readRuntime(context).trackStyle
        val json=JSONObject().put("color",style.color).put("width",style.width).put("pointSize",style.pointSize)
            .put("opacity",style.opacity).put("colorMode",style.colorMode)
        style.travelMode?.let { json.put("travelMode",it) }
        return NativeDrawingState.newTrack(name,json)
    }

    private fun changed() {
        val current = state ?: return
        callbacks.onDraftChanged(current.toDraft())
        callbacks.onRender(current.snapshot())
    }

    private fun requestMap(enabled: Boolean) {
        requestActive = enabled
        callbacks.onRequestMapPoint(enabled)
    }

    private fun showIfOpen() { if (!closed && chrome.currentPanel() == "draw") show() }

    private fun verticalForm() = LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(chrome.dp(12), chrome.dp(4), chrome.dp(12), chrome.dp(4))
    }

    private fun parsePoint(longitude: String, latitude: String): NativeCoordinate? {
        val lon = longitude.trim().toDoubleOrNull() ?: return null
        val lat = latitude.trim().toDoubleOrNull() ?: return null
        return NativeCoordinate(lon, lat).takeIf { lon.isFinite() && lat.isFinite() && lon in -180.0..180.0 && lat in -85.051129..85.051129 }
    }

    private fun parseCoordinate(array: JSONArray?): NativeCoordinate? {
        if (array == null || array.length() < 2) return null
        val lon = array.optDouble(0, Double.NaN); val lat = array.optDouble(1, Double.NaN)
        return parsePoint(lon.toString(), lat.toString())
    }

    private fun lastCoordinate(track: JSONObject): NativeCoordinate? {
        val segments = track.optJSONArray("segments") ?: return null
        for (i in segments.length() - 1 downTo 0) {
            val line = segments.optJSONArray(i) ?: continue
            if (line.length() > 0) return parseCoordinate(line.optJSONArray(line.length() - 1))
        }
        return null
    }

    private fun distanceMeters(a: NativeCoordinate, b: NativeCoordinate): Double {
        val rad = Math.PI / 180
        val dLat = (b.latitude - a.latitude) * rad
        val dLon = (b.longitude - a.longitude) * rad
        val h = sin(dLat / 2).pow(2) + cos(a.latitude * rad) * cos(b.latitude * rad) * sin(dLon / 2).pow(2)
        return 6_371_000 * 2 * asin(sqrt(h.coerceIn(0.0, 1.0)))
    }

    private fun contrastInk(hex: String): Int = if (Color.luminance(Color.parseColor(hex)) > .42) Color.rgb(16, 36, 60) else Color.WHITE
    private fun formatCoordinate(point: NativeCoordinate) = "${"%.6f".format(java.util.Locale.ROOT, point.latitude)}, ${"%.6f".format(java.util.Locale.ROOT, point.longitude)}"
    private fun modeLabel(mode: String) = when (mode) { "auto" -> "驾车"; "bicycle" -> "骑行"; else -> "步行" }
    companion object { private const val NODE_SNAP_METERS = 12.0 }
}
