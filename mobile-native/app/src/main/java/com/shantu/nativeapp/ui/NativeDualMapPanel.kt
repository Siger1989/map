package com.shantu.nativeapp.ui

import android.app.AlertDialog
import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.shantu.nativeapp.map.NativeCameraSnapshot
import com.shantu.nativeapp.map.NativeMapController
import com.shantu.nativeapp.map.NativeMapSource
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.roundToInt

enum class NativeDualMapGroup(val label: String) {
    CURRENT("当前"), BUILTIN("内置"), PRIVATE("我的图源"), PUBLIC("公共库"),
}

/** A catalog item is transient until the host accepts it with the explicit Use action. */
data class NativeDualMapChoice(
    val id: String,
    val name: String,
    val group: NativeDualMapGroup,
    val sourceId: String? = null,
    val source: NativeMapSource? = null,
)

data class NativeMapRectPx(val left: Int, val top: Int, val width: Int, val height: Int) {
    val right: Int get() = left + width
    val bottom: Int get() = top + height
}

data class NativeDualMapBounds(
    val width: Int,
    val height: Int,
    val landscape: Boolean,
    val primary: NativeMapRectPx,
    val secondary: NativeMapRectPx,
)

/** Pixel geometry for two live maps; dimensions are relative to the inset-consumed Chrome root. */
internal object NativeDualMapGeometry {
    fun compute(widthPx: Int, heightPx: Int, density: Float): NativeDualMapBounds {
        val width = widthPx.coerceAtLeast(0)
        val height = heightPx.coerceAtLeast(0)
        val d = density.takeIf { it.isFinite() && it > 0f } ?: 1f
        fun px(dp: Int) = (dp * d).roundToInt()
        val heading = px(48)
        val toolbar = px(32)
        val footer = px(56)
        val landscape = width > height
        val mapTop = (heading + toolbar).coerceAtMost(height)
        val mapBottom = (height - footer).coerceAtLeast(mapTop)
        val bounds = if (landscape) {
            val half = width / 2
            NativeDualMapBounds(
                width, height, true,
                NativeMapRectPx(0, mapTop, half, mapBottom - mapTop),
                NativeMapRectPx(half, mapTop, width - half, mapBottom - mapTop),
            )
        } else {
            val paneHeight = (mapBottom - heading).coerceAtLeast(0)
            val half = paneHeight / 2
            val firstBottom = heading + half
            val secondStart = (firstBottom + toolbar).coerceAtMost(mapBottom)
            NativeDualMapBounds(
                width, height, false,
                NativeMapRectPx(0, mapTop, width, (firstBottom - mapTop).coerceAtLeast(0)),
                NativeMapRectPx(0, secondStart, width, (mapBottom - secondStart).coerceAtLeast(0)),
            )
        }
        return bounds
    }
}

internal object NativeDualMapCameraSync {
    fun targetPane(pane: Int, enabled: Boolean, source: NativeCameraSnapshot, target: NativeCameraSnapshot): Int? {
        require(pane in 0..1)
        if (!enabled || sameCamera(source, target)) return null
        return 1 - pane
    }

    private fun sameCamera(a: NativeCameraSnapshot, b: NativeCameraSnapshot): Boolean =
        kotlin.math.abs(a.latitude - b.latitude) < 1e-7 &&
            kotlin.math.abs(a.longitude - b.longitude) < 1e-7 &&
            kotlin.math.abs(a.rangeMeters - b.rangeMeters) < 0.01 &&
            kotlin.math.abs(a.headingDegrees - b.headingDegrees) < 1e-4 &&
            kotlin.math.abs(a.pitchDegrees - b.pitchDegrees) < 1e-4 &&
            kotlin.math.abs(a.rollDegrees - b.rollDegrees) < 1e-4
}

/**
 * Native controls for the two-map comparison. MainActivity owns both map lifetimes and positions
 * their real NativeMapController views using the bounds callback. No web map surface is involved.
 */
class NativeDualMapPanel(
    private val context: Context,
    private val chrome: HomeChrome,
    private val primary: NativeMapController,
    private val secondary: NativeMapController,
    private val choices: () -> List<NativeDualMapChoice>,
    private val callbacks: Callbacks = Callbacks(),
) {
    data class Callbacks(
        val onPaneBoundsChanged: (NativeDualMapBounds?) -> Unit = {},
        val onUseSource: (NativeDualMapChoice) -> Unit = {},
        val onExit: (NativeCameraSnapshot) -> Unit = {},
        val onActivePaneChanged: (Int) -> Unit = {},
        val onObjectTargetChanged: (Int) -> Unit = {},
        val onFollow: () -> Unit = {},
        val onStopFollow: () -> Unit = {},
        val onAction: (pane: Int, action: String) -> Unit = { _, _ -> },
    )

    private val prefs = context.getSharedPreferences("shantu-native-dual-map", Context.MODE_PRIVATE)
    private val root = FrameLayout(context)
    private val header = LinearLayout(context)
    private val paneBars = arrayOf(LinearLayout(context), LinearLayout(context))
    private val sourceLabels = arrayOfNulls<TextView>(2)
    private var objectTargetButton: TextView? = null
    private var sourceRerender: (() -> Unit)? = null
    private var open = false
    private var widthPx = 0
    private var heightPx = 0
    private var selectedPane = 0
    private var objectTarget = 0
    private var cameraSync = true
    private var syncingCamera = false
    private var acceptedChoice = false
    private var initialPrimarySource: NativeMapSource? = null
    private var initialPrimarySourceId: String? = null
    private var initialPrimaryWasCustom = false
    private var currentChoices: List<NativeDualMapChoice> = emptyList()
    private var selectedIds = arrayOf<String?>(null, null)
    private var sourceDialog: AlertDialog? = null

    init {
        root.setBackgroundColor(Color.TRANSPARENT)
        root.isClickable = false
        root.isFocusable = false
        header.orientation = LinearLayout.HORIZONTAL
        header.gravity = Gravity.CENTER_VERTICAL
        header.setPadding(chrome.dp(8), 0, chrome.dp(8), 0)
        header.setBackgroundColor(ShantuColors.surface)
        paneBars.forEach { bar ->
            bar.orientation = LinearLayout.HORIZONTAL
            bar.gravity = Gravity.CENTER_VERTICAL
            bar.setPadding(chrome.dp(4), 0, chrome.dp(4), 0)
            bar.setBackgroundColor(ShantuColors.surface)
        }
    }

    /** Opens comparison using the inset-consumed root's current pixel dimensions. */
    fun open(widthPx: Int, heightPx: Int) {
        if (open) { resize(widthPx, heightPx); return }
        open = true
        acceptedChoice = false
        this.widthPx = widthPx.coerceAtLeast(0)
        this.heightPx = heightPx.coerceAtLeast(0)
        val source = primary.currentSource()
        initialPrimarySource = primary.currentCustomSource()
        initialPrimarySourceId = source?.id
        initialPrimaryWasCustom = source?.custom == true
        selectedIds[0] = source?.id?.let { stableSourceId(it) }
        selectedIds[1] = secondary.currentSource()?.id?.let { stableSourceId(it) }
        cameraSync = true
        refreshChoices()
        buildOverlay()
        if (root.parent == null) chrome.addView(root, FrameLayout.LayoutParams(-1, -1))
        applyGeometry()
    }

    fun resize(widthPx: Int, heightPx: Int) {
        if (!open) return
        this.widthPx = widthPx.coerceAtLeast(0)
        this.heightPx = heightPx.coerceAtLeast(0)
        applyGeometry()
    }

    /** Forward real camera snapshots from the host's per-map touch handlers. */
    fun onCameraChanged(pane: Int, snapshot: NativeCameraSnapshot) {
        if (!open || syncingCamera || !cameraSync || pane !in 0..1) return
        val target = if (pane == 0) secondary else primary
        syncingCamera = true
        try {
            target.synchronizeCameraFrom(if (pane == 0) primary else secondary)
        } finally {
            syncingCamera = false
        }
    }

    fun setActivePane(pane: Int) {
        require(pane in 0..1)
        if (selectedPane == pane) return
        selectedPane = pane
        callbacks.onActivePaneChanged(pane)
        refreshControls()
    }

    fun setObjectTarget(pane: Int) {
        require(pane in 0..1)
        objectTarget = pane
        callbacks.onObjectTargetChanged(pane)
        refreshControls()
    }

    fun useSelectedSource(pane: Int = selectedPane) {
        require(pane in 0..1)
        val selected = choiceFor(pane) ?: return
        acceptedChoice = true
        callbacks.onUseSource(selected)
        close()
    }

    /** Hiding this card or leaving comparison restores the original source unless Use was explicit. */
    fun close() {
        if (!open) return
        sourceDialog?.dismiss()
        sourceDialog = null
        if (!acceptedChoice) restoreInitialPrimarySource()
        val camera = primary.cameraSnapshot()
        open = false
        callbacks.onPaneBoundsChanged(null)
        (root.parent as? ViewGroup)?.removeView(root)
        callbacks.onExit(camera)
    }

    /** Cleanup without treating lifecycle disposal as a user exit. */
    fun dispose() {
        if (open) {
            sourceDialog?.dismiss()
            sourceDialog = null
            if (!acceptedChoice) restoreInitialPrimarySource()
            open = false
            callbacks.onPaneBoundsChanged(null)
            (root.parent as? ViewGroup)?.removeView(root)
        }
    }

    private fun stableSourceId(id: String): String = currentChoices.firstOrNull { it.sourceId == id || it.source?.id == id || it.id == id }?.id ?: id

    private fun restoreInitialPrimarySource() {
        if (initialPrimaryWasCustom) initialPrimarySource?.let(primary::setCustomSource)
        else initialPrimarySourceId?.takeIf { it in NativeMapController.SOURCE_IDS }?.let(primary::setSource)
    }

    private fun refreshChoices() {
        currentChoices = choices().distinctBy { it.id }
        for (pane in 0..1) {
            if (currentChoices.none { it.id == selectedIds[pane] }) {
                val current = (if (pane == 0) primary else secondary).currentSource()
                selectedIds[pane] = current?.let { live -> currentChoices.firstOrNull { it.sourceId == live.id || it.source?.id == live.id || it.id == live.id }?.id }
            }
        }
    }

    private fun applyGeometry() {
        val bounds = NativeDualMapGeometry.compute(widthPx, heightPx, context.resources.displayMetrics.density)
        layoutChrome(bounds)
        callbacks.onPaneBoundsChanged(bounds)
    }

    private fun buildOverlay() {
        root.removeAllViews()
        header.removeAllViews()
        paneBars.forEach(LinearLayout::removeAllViews)
        val title = chrome.text("对比", 14).apply { setTypeface(null, android.graphics.Typeface.BOLD) }
        header.addView(title, LinearLayout.LayoutParams(0, -1, 1f))
        header.addView(chrome.row(if (cameraSync) "同步✓" else "不同步") {
            cameraSync = !cameraSync
            if (cameraSync) primary.cameraSnapshot().let { onCameraChanged(0, it) }
            refreshControls()
        }.apply { minimumWidth = chrome.dp(52); gravity = Gravity.CENTER }, LinearLayout.LayoutParams(chrome.dp(60), chrome.dp(32)))
        header.addView(chrome.row("关闭") { close() }.apply { gravity = Gravity.CENTER }, LinearLayout.LayoutParams(chrome.dp(44), chrome.dp(32)))
        root.addView(header, FrameLayout.LayoutParams(-1, chrome.dp(32), Gravity.TOP))
        for (pane in 0..1) {
            val bar = paneBars[pane]
            val label = if (pane == 0) "上图" else "下图"
            val mark = chrome.row(label) { setActivePane(pane); setObjectTarget(pane) }
            mark.setTextColor(if (selectedPane == pane) ShantuColors.accent else ShantuColors.muted)
            bar.addView(mark, LinearLayout.LayoutParams(chrome.dp(42), chrome.dp(28)))
            val sourceButton = chrome.row("") { setActivePane(pane); showSourcePicker(pane) }
            sourceLabels[pane] = sourceButton
            bar.addView(sourceButton, LinearLayout.LayoutParams(0, chrome.dp(28), 1f))
            val previous = chrome.row("↑") { step(pane, -1) }.apply { gravity = Gravity.CENTER }
            bar.addView(previous, LinearLayout.LayoutParams(chrome.dp(28), chrome.dp(28)))
            val next = chrome.row("↓") { step(pane, 1) }.apply { gravity = Gravity.CENTER }
            bar.addView(next, LinearLayout.LayoutParams(chrome.dp(28), chrome.dp(28)))
            bar.addView(chrome.row("选用") { setActivePane(pane); useSelectedSource(pane) }.apply {
                setTextColor(ShantuColors.accent)
                gravity = Gravity.CENTER
            }, LinearLayout.LayoutParams(chrome.dp(44), chrome.dp(28)))
            root.addView(bar, FrameLayout.LayoutParams(-1, chrome.dp(32)))
        }
        val footer = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(chrome.dp(8), 0, chrome.dp(8), 0)
            setBackgroundColor(ShantuColors.surface)
            fun control(label: String, action: () -> Unit) {
                addView(chrome.textButton(label, 12, action), LinearLayout.LayoutParams(0, chrome.dp(44), 1f))
            }
            control("＋") { targetMap().zoomBy(1.0); callbacks.onAction(selectedPane,"zoom-in") }
            control("−") { targetMap().zoomBy(-1.0); callbacks.onAction(selectedPane,"zoom-out") }
            control("3D") {
                val map=targetMap(); val pitch=if(map.cameraSnapshot().pitchDegrees>0.0)0.0 else 50.0
                map.setTerrain(pitch>0.0);map.setPitch(pitch);callbacks.onAction(selectedPane,"toggle-dimension")
            }
            control("标记") { callbacks.onAction(selectedPane,"mark") }
            control("跟随") { callbacks.onAction(selectedPane,"toggle-follow") }
            control("方向") { callbacks.onAction(selectedPane,"direction") }
            control("画线") { callbacks.onAction(selectedPane,"draw") }
        }
        root.addView(footer, FrameLayout.LayoutParams(-1, chrome.dp(56), Gravity.BOTTOM))
        refreshControls()
    }

    private fun layoutChrome(bounds: NativeDualMapBounds) {
        val density = context.resources.displayMetrics.density
        val headerPx = (48 * density).roundToInt()
        val toolbarPx = (32 * density).roundToInt()
        paneBars[0].layoutParams = if (bounds.landscape) {
            FrameLayout.LayoutParams(bounds.width / 2, toolbarPx, Gravity.TOP or Gravity.LEFT).apply { topMargin = headerPx }
        } else {
            FrameLayout.LayoutParams(-1, toolbarPx, Gravity.TOP).apply { topMargin = headerPx }
        }
        paneBars[1].layoutParams = if (bounds.landscape) {
            FrameLayout.LayoutParams(bounds.width - bounds.width / 2, toolbarPx, Gravity.TOP or Gravity.LEFT).apply { leftMargin = bounds.width / 2; topMargin = headerPx }
        } else {
            val mapBottom = bounds.height - (56 * density).roundToInt()
            val secondBarTop = mapBottom - bounds.secondary.height - toolbarPx
            FrameLayout.LayoutParams(-1, toolbarPx, Gravity.TOP).apply { topMargin = secondBarTop.coerceAtLeast(headerPx) }
        }
        header.layoutParams = FrameLayout.LayoutParams(-1, headerPx, Gravity.TOP)
        val footer = root.getChildAt(root.childCount - 1)
        footer.layoutParams = FrameLayout.LayoutParams(-1, (56 * density).roundToInt(), Gravity.BOTTOM)
        root.requestLayout()
    }

    private fun targetMap() = if (selectedPane == 0) primary else secondary

    private fun choiceFor(pane: Int): NativeDualMapChoice? = currentChoices.firstOrNull { it.id == selectedIds[pane] }

    private fun applyChoice(pane: Int, choice: NativeDualMapChoice) {
        selectedIds[pane] = choice.id
        val map = if (pane == 0) primary else secondary
        when {
            choice.source != null -> map.setCustomSource(choice.source)
            choice.sourceId != null && choice.sourceId in NativeMapController.SOURCE_IDS -> map.setSource(choice.sourceId)
            else -> return
        }
        refreshControls()
    }

    private fun step(pane: Int, direction: Int) {
        refreshChoices()
        val visible = visibleChoices()
        if (visible.isEmpty()) return
        val current = visible.indexOfFirst { it.id == selectedIds[pane] }
        val next = if (current < 0) 0 else (current + direction + visible.size) % visible.size
        applyChoice(pane, visible[next])
    }

    private fun visibleChoices(): List<NativeDualMapChoice> {
        val favoriteIds = favorites()
        val expanded = expandedGroups()
        val all = currentChoices
        val ordered = buildList {
            addAll(all.filter { it.id in favoriteIds })
            NativeDualMapGroup.values().forEach { group -> if (group.name in expanded) addAll(all.filter { it.group == group && it.id !in favoriteIds }) }
        }
        return ordered.distinctBy { it.id }
    }

    private fun showSourcePicker(pane: Int) {
        refreshChoices()
        val content = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; setPadding(chrome.dp(4), chrome.dp(4), chrome.dp(4), chrome.dp(4)) }
        val scroll = ScrollView(context).apply { addView(content) }
        val dialog = AlertDialog.Builder(context).setTitle("${if (pane == 0) "上" else "下"}图图源").setView(scroll).setNegativeButton("关闭", null).create()
        sourceDialog = dialog
        fun render() {
            content.removeAllViews()
            val favoriteIds = favorites()
            val expanded = expandedGroups()
            if (favoriteIds.isNotEmpty()) {
                addGroupRows(content, "常用", currentChoices.filter { it.id in favoriteIds }, pane, favoriteIds)
            }
        NativeDualMapGroup.values().forEach { group ->
                val visible = group.name in expanded
                content.addView(chrome.row("${group.label}  ${if (visible) "−" else "+"}") {
                    val next = expandedGroups().toMutableSet().apply { if (visible) remove(group.name) else add(group.name) }
                    prefs.edit().putString("groups", JSONArray(next.toList()).toString()).apply()
                    render()
                }, LinearLayout.LayoutParams(-1, chrome.dp(28)).apply { topMargin = chrome.dp(3) })
                if (visible) addGroupRows(content, group.label, currentChoices.filter { it.group == group && it.id !in favoriteIds }, pane, favoriteIds)
            }
        }
        render()
        dialog.setOnDismissListener { sourceDialog = null; sourceRerender = null }
        sourceRerender = ::render
        dialog.show()
        dialog.window?.setLayout((context.resources.displayMetrics.widthPixels * .86f).roundToInt(), (context.resources.displayMetrics.heightPixels * .72f).roundToInt())
    }

    private fun addGroupRows(
        parent: LinearLayout,
        label: String,
        values: List<NativeDualMapChoice>,
        pane: Int,
        favoriteIds: Set<String>,
    ) {
        parent.addView(chrome.text(label, 10).apply {
            setTextColor(ShantuColors.muted)
            setPadding(chrome.dp(6), 0, 0, 0)
        }, LinearLayout.LayoutParams(-1, chrome.dp(22)))
        values.forEach { choice ->
            val row = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
            row.addView(chrome.row(choice.name + if (selectedIds[pane] == choice.id) " ✓" else "") {
                applyChoice(pane, choice)
                sourceDialog?.dismiss()
                setActivePane(pane)
            }, LinearLayout.LayoutParams(0, chrome.dp(28), 1f))
            row.addView(chrome.row(if (choice.id in favoriteIds) "★" else "☆") {
                val next = favorites().toMutableSet().apply { if (!add(choice.id)) remove(choice.id) }
                prefs.edit().putString("favorites", JSONArray(next.toList()).toString()).apply()
                sourceRerender?.invoke()
            }.apply { gravity = Gravity.CENTER; setTextColor(ShantuColors.accent) }, LinearLayout.LayoutParams(chrome.dp(32), chrome.dp(28)))
            parent.addView(row, LinearLayout.LayoutParams(-1, chrome.dp(30)))
        }
    }

    private fun favorites(): Set<String> = stringSet("favorites")
    private fun expandedGroups(): Set<String> = stringSet("groups").ifEmpty { NativeDualMapGroup.values().map { it.name }.toSet() }
    private fun stringSet(key: String): Set<String> = try {
        val array = JSONArray(prefs.getString(key, "[]"))
        (0 until array.length()).map { array.optString(it) }.filter(String::isNotBlank).toSet()
    } catch (_: Exception) { emptySet() }

    private fun refreshControls() {
        if (root.childCount == 0) return
        val syncButton = header.getChildAt(1) as? TextView
        syncButton?.text = if (cameraSync) "同步✓" else "不同步"
        for (pane in 0..1) {
            val bar = paneBars[pane]
            (bar.getChildAt(0) as? TextView)?.setTextColor(if (pane == selectedPane) ShantuColors.accent else ShantuColors.muted)
        }
        objectTargetButton?.text = if (objectTarget == 0) "操作目标：上图" else "操作目标：下图"
        for (pane in 0..1) sourceLabels[pane]?.text = choiceFor(pane)?.name
            ?: (if (pane == 0) primary else secondary).currentSource()?.name ?: "选择图源"
    }
}
