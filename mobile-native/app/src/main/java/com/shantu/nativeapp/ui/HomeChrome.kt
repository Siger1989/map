package com.shantu.nativeapp.ui

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.util.TypedValue
import com.shantu.nativeapp.appearance.NativeAppearanceTokens
import com.shantu.nativeapp.layout.NativeLayoutDraft
import com.shantu.nativeapp.layout.NativeLayoutEntry
import org.json.JSONObject
import kotlin.math.roundToInt

/** Default dark theme values from appearance/theme.ts and outdoorTheme.css. */
object ShantuColors {
    // Stable business defaults (for map objects/route colors) remain separate from appearance tokens.
    val surface = Color.rgb(24, 32, 31) // #18201f
    val raised = Color.rgb(37, 46, 43) // #252e2b
    val ink = Color.rgb(242, 245, 237) // #f2f5ed
    val accent = Color.rgb(208, 247, 107) // #d0f76b
    val close = Color.rgb(199, 184, 109) // #c7b86d
    val muted = Color.rgb(188, 192, 186) // #bcc0ba
}

/** Native equivalent of the fixed map header, home dock and compact map rails. */
class HomeChrome(context: Context, val action: (String) -> Unit) : FrameLayout(context) {
    private val themeBindings = NativeThemeBindings()
    private val top = LinearLayout(context)
    private val bottom = FrameLayout(context)
    private val bottomNavigation = LinearLayout(context)
    private val rail = LinearLayout(context)
    private val upperRail = LinearLayout(context)
    val scaleBar = NativeScaleBar(context)
    private val quick = FrameLayout(context)
    private val layoutRecoveryButton = textButton("布局", 11) { if(locked) setLocked(false); onOpenLayoutEditor?.invoke() }
    private val routeInfoSlot = FrameLayout(context)
    private var routeInfoView: View? = null
    private var cameraJoystickView: NativeCameraJoystick? = null
    private var routeInfoSpeedLegend = false
    private var layoutDraft = NativeLayoutDraft()
    private var layoutEditing = false
    private var selectedLayoutSelector: String? = null
    private val layoutTargets = linkedMapOf<String, View>()
    private val layoutTargetLabels = linkedMapOf<String,String>()
    private val layoutBaseParams = linkedMapOf<String, Pair<Int,Int>>()
    private val layoutBaseTextSizes = linkedMapOf<String,List<Pair<TextView,Float>>>()
    private val bottomItems = linkedMapOf<String, BottomItem>()
    private var panel: View? = null
    private var panelScroll: ScrollView? = null
    private var panelId: String? = null
    private var panelTopAligned = false
    private var panelRequestedWidth = 300
    private var panelMaxHeightOverrideDp: Int? = null
    private var collectionSplit = false
    private var comparison = false
    private var terrainEnabled = false
    fun setComparisonMode(enabled:Boolean) { comparison=enabled;refreshVisibility() }

    /** MainActivity resizes the map surface to keep it live below the collection workbench. */
    var onMapViewportChanged: ((topPx: Int, bottomPx: Int) -> Unit)? = null
    /** Host creates NativeLayoutEditor and owns persistence/import/export. */
    var onOpenLayoutEditor: (() -> Unit)? = null
    var onLayoutSave: ((JSONObject) -> Boolean)? = null
    var onLayoutImportRequest: (() -> Unit)? = null
    var onLayoutExportRequest: ((JSONObject) -> Unit)? = null
    var onUnknownLayoutSelectors: ((List<String>) -> Unit)? = null

    var locked = false
        private set
    private var taskActive = false
    private val lockButton = textButton("锁定\n隐藏UI", 11) { setLocked(!locked) }
    val status = text("", 11).apply {
        setPadding(dp(4), dp(2), dp(4), dp(2))
        maxLines = 3
        themeBindings.bindText(this, NativeThemeRole.MUTED)
    }
    private val terrainButton = textButton("3D", 16) { action("terrain") }
    val quickRecord = textButton("▶\n开始", 11) { action("record-quick") }

    private data class BottomItem(
        val root: FrameLayout,
        val icon: ImageView,
        val label: TextView,
        val indicator: View,
    )

    init {
        top.gravity = Gravity.CENTER_VERTICAL
        top.setPadding(dp(8), 0, dp(8), 0)
        top.setBackgroundColor(ShantuColors.surface)
        themeBindings.bindBackground(top, NativeThemeRole.SURFACE)
        top.addView(textButton("山兔", 14) { action("about") }.apply {
            setTypeface(null, Typeface.BOLD)
        }, LinearLayout.LayoutParams(dp(HomeChromeMetrics.HEADER_CONTROL_DP), dp(HomeChromeMetrics.HEADER_CONTROL_DP)))
        top.addView(View(context), LinearLayout.LayoutParams(dp(4), 1))
        top.addView(icon("search", "搜索地点") { action("search") }.apply {
            themeBindings.bindTint(this, NativeThemeRole.MUTED)
        }, LinearLayout.LayoutParams(dp(HomeChromeMetrics.HEADER_CONTROL_DP), dp(HomeChromeMetrics.HEADER_CONTROL_DP)))
        top.addView(textButton("搜索地点", 12) { action("search") }.apply {
            themeBindings.bindText(this, NativeThemeRole.MUTED)
            gravity = Gravity.CENTER_VERTICAL or Gravity.START
            setPadding(dp(2), 0, dp(4), 0)
        }, LinearLayout.LayoutParams(0, dp(HomeChromeMetrics.HEADER_CONTROL_DP), 1f))
        top.addView(View(context), LinearLayout.LayoutParams(dp(4), 1))
        top.addView(icon("layers", "图层") { action("layers") }.apply {
            themeBindings.bindTint(this, NativeThemeRole.MUTED)
        }, LinearLayout.LayoutParams(dp(46), dp(HomeChromeMetrics.HEADER_CONTROL_DP)))
        addView(top, LayoutParams(-1, dp(HomeChromeMetrics.HEADER_HEIGHT_DP), Gravity.TOP))

        bottomNavigation.orientation = LinearLayout.HORIZONTAL
        bottomNavigation.gravity = Gravity.CENTER
        bottomNavigation.setPadding(0, 0, 0, 0)
        listOf("record" to "记录", "route" to "路线", "draw" to "画线", "favorite" to "收藏", "tools" to "工具").forEach { (id, title) ->
            val item = FrameLayout(context).apply {
                contentDescription = title
                isFocusable = true
                isClickable = true
                setOnClickListener { action(id) }
            }
            val contents = LinearLayout(context).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER
                importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
            }
            val navIcon = icon(id, title) { }.apply {
                    themeBindings.bindTint(this, NativeThemeRole.MUTED)
                    isClickable = false
                    isFocusable = false
                    importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
                }
            contents.addView(navIcon, LinearLayout.LayoutParams(dp(22), dp(22)))
            val label = text(title, 12).apply {
                gravity = Gravity.CENTER
                themeBindings.bindText(this, NativeThemeRole.MUTED)
            }
            contents.addView(label, LinearLayout.LayoutParams(-1, dp(14)).apply { topMargin = dp(2) })
            item.addView(contents, LayoutParams(-1, -1, Gravity.CENTER))
            val indicator = View(context).apply {
                background = GradientDrawable().apply { setColor(ShantuColors.accent); cornerRadius = dp(1).toFloat() }
                themeBindings.bindBackground(this, NativeThemeRole.ACCENT, dp(1).toFloat())
                visibility = GONE
            }
            item.addView(indicator, LayoutParams(dp(24), dp(2), Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL).apply {
                bottomMargin = dp(1)
            })
            bottomNavigation.addView(item, LinearLayout.LayoutParams(0, dp(44), 1f))
            bottomItems[id] = BottomItem(item, navIcon, label, indicator)
        }
        bottom.setBackgroundColor(ShantuColors.surface)
        themeBindings.bindBackground(bottom, NativeThemeRole.SURFACE)
        bottom.addView(bottomNavigation, LayoutParams(-1, dp(44), Gravity.CENTER))
        bottom.elevation = dp(5).toFloat()
        addView(bottom, LayoutParams(-1, dp(HomeChromeMetrics.FOOTER_HEIGHT_DP), Gravity.BOTTOM))

        upperRail.orientation = LinearLayout.VERTICAL
        upperRail.background = surface(HomeChromeMetrics.CARD_RADIUS_DP)
        themeBindings.bindBackground(upperRail, NativeThemeRole.SURFACE, dp(HomeChromeMetrics.CARD_RADIUS_DP).toFloat())
        upperRail.elevation = dp(3).toFloat()
        upperRail.setPadding(dp(3), dp(3), dp(3), dp(3))
        upperRail.addView(terrainButton, LinearLayout.LayoutParams(dp(44), dp(44)).apply { bottomMargin = dp(2) })
        upperRail.addView(textButton("⌗\n框选", 12) { action("box") }, LinearLayout.LayoutParams(dp(44), dp(44)))
        addView(upperRail, LayoutParams(dp(50), -2, Gravity.TOP or Gravity.END).apply {
            topMargin = dp(HomeChromeMetrics.HEADER_HEIGHT_DP + 8)
            rightMargin = dp(8)
        })

        rail.orientation = LinearLayout.VERTICAL
        rail.background = surface(HomeChromeMetrics.CARD_RADIUS_DP)
        themeBindings.bindBackground(rail, NativeThemeRole.SURFACE, dp(HomeChromeMetrics.CARD_RADIUS_DP).toFloat())
        rail.elevation = dp(3).toFloat()
        rail.setPadding(dp(3), dp(3), dp(3), dp(3))
        val railItems = listOf("favorite-source" to "图源", "quality" to "级别", "+" to "+", "−" to "−", "marker" to "标记", "direction" to "方向", "follow" to "跟随")
        railItems.forEachIndexed { index, (id, label) ->
            val item = if (id == "+" || id == "−") textButton(label, 26) { action(id) }
            else LinearLayout(context).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER
                contentDescription = label
                isFocusable = true
                isClickable = true
                setOnClickListener { action(id) }
                val source = when (id) { "favorite-source" -> "favorite"; "quality" -> "layers"; else -> id }
                addView(icon(source, label) { }.apply {
                    themeBindings.bindTint(this, NativeThemeRole.MUTED)
                    isClickable = false
                    isFocusable = false
                    importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
                }, LinearLayout.LayoutParams(dp(21), dp(22)))
                addView(text(label, 10).apply { themeBindings.bindText(this, NativeThemeRole.MUTED) }, LinearLayout.LayoutParams(-1, dp(13)))
            }
            item.tag = id
            rail.addView(item, LinearLayout.LayoutParams(dp(44), dp(44)).apply {
                if (index < railItems.lastIndex) bottomMargin = dp(2)
            })
        }
        addView(rail, LayoutParams(dp(50), -2, Gravity.BOTTOM or Gravity.END).apply {
            rightMargin = dp(8)
            bottomMargin = dp(HomeChromeMetrics.FOOTER_HEIGHT_DP + 84)
        })

        quickRecord.background = surface(HomeChromeMetrics.CONTROL_RADIUS_DP)
        themeBindings.bindBackground(quickRecord, NativeThemeRole.RAISED, dp(HomeChromeMetrics.CONTROL_RADIUS_DP).toFloat())
        themeBindings.bindText(quickRecord, NativeThemeRole.ACCENT)
        quick.addView(lockButton, LayoutParams(dp(44), dp(44), Gravity.BOTTOM or Gravity.START).apply {
            leftMargin = dp(8)
            bottomMargin = dp(HomeChromeMetrics.focusLockBottomMarginDp())
        })
        layoutRecoveryButton.id = View.generateViewId()
        layoutRecoveryButton.tag = "#shantu-layout-recovery"
        quick.addView(layoutRecoveryButton, LayoutParams(dp(44), dp(44), Gravity.BOTTOM or Gravity.START).apply {
            leftMargin = dp(56)
            bottomMargin = dp(HomeChromeMetrics.focusLockBottomMarginDp())
        })
        quick.addView(quickRecord, LayoutParams(dp(44), dp(44), Gravity.BOTTOM or Gravity.START).apply {
            leftMargin = dp(8)
            bottomMargin = dp(HomeChromeMetrics.recordingBottomMarginDp(viewportHeightDp()))
        })
        quick.isClickable = false
        quick.isFocusable = false
        quick.setOnTouchListener { _, _ -> false }
        addView(quick, LayoutParams(-1, -1))
        addView(status, LayoutParams(-1, -2, Gravity.TOP).apply {
            topMargin = dp(HomeChromeMetrics.HEADER_HEIGHT_DP + 4)
            rightMargin = dp(66)
        })
        addView(scaleBar, LayoutParams(dp(50),dp(26),Gravity.TOP or Gravity.RIGHT).apply { topMargin=dp(154);rightMargin=dp(8) })
        routeInfoSlot.isClickable = false
        routeInfoSlot.isFocusable = false
        addView(routeInfoSlot, LayoutParams(-1, -1))
        layoutTargets.putAll(mapOf(
            "#home-topbar" to top, "#home-map-actions" to upperRail,
            "#home-position-dock" to rail, "#home-bottom-nav" to bottomNavigation,
            "#home-recording" to quickRecord, "#home-scale-bar" to scaleBar,
            "#home-status" to status,
        ))
        layoutTargetLabels.putAll(mapOf("#home-topbar" to "顶部栏", "#home-map-actions" to "地图操作栏", "#home-position-dock" to "地图工具栏", "#home-bottom-nav" to "底部导航", "#home-recording" to "快捷记录", "#home-scale-bar" to "比例尺", "#home-status" to "状态栏"))
        layoutTargets.forEach { (key,view)->
            val p=view.layoutParams
            if(p!=null) layoutBaseParams[key]=p.width to p.height
            layoutBaseTextSizes[key]=textViews(view).map { it to it.textSize }
        }
        updateBottomSelection()
    }

    fun setTerrainButton(enabled: Boolean) {
        terrainEnabled = enabled
        terrainButton.text = "3D"
        themeBindings.bindText(terrainButton, if (enabled) NativeThemeRole.ACCENT else NativeThemeRole.INK)
    }

    /** Apply an appearance preview to Chrome and all explicitly role-bound current controls. */
    fun applyAppearance(tokens: NativeAppearanceTokens) {
        themeBindings.apply(tokens)
        top.setBackgroundColor(tokens.surface)
        bottom.setBackgroundColor(tokens.surface)
        setTerrainButton(terrainEnabled)
        cameraJoystickView?.setAccentColor(tokens.accent)
        updateBottomSelection()
        invalidate()
    }

    fun bindThemeText(view: TextView, role: NativeThemeRole): TextView = themeBindings.bindText(view, role)
    fun bindThemeHint(view: EditText, role: NativeThemeRole): EditText = themeBindings.bindHint(view, role)
    fun bindThemeTint(view: ImageView, role: NativeThemeRole): ImageView = themeBindings.bindTint(view, role)
    fun bindThemeBackground(view: View, role: NativeThemeRole, radiusDp: Int = 0): View =
        themeBindings.bindBackground(view, role, dp(radiusDp).toFloat())

    fun setTaskActive(value: Boolean) {
        taskActive = value
        refreshVisibility()
        updateBottomSelection()
    }

    fun setLocked(value: Boolean) {
        locked = value
        lockButton.text = if (value) "解锁" else "锁定\n隐藏UI"
        lockButton.contentDescription = if (value) "解锁地图界面" else "锁定并隐藏地图界面"
        refreshVisibility()
    }

    /** Map-hosted route data is positioned over the map and follows the UI lock state. */
    fun setRouteDisplayInfo(view: View?) = setRouteDisplayInfo(view, false)

    fun setRouteDisplayInfo(view: View?, speedLegend: Boolean) {
        routeInfoView?.let { if (it.parent === routeInfoSlot) routeInfoSlot.removeView(it) }
        routeInfoView = view
        routeInfoSpeedLegend = speedLegend
        if(view==null) { layoutTargets.remove("#home-route-display-info"); layoutTargetLabels.remove("#home-route-display-info") }
        if (view != null) {
            (view.parent as? ViewGroup)?.removeView(view)
            val params = LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM or Gravity.START).apply {
                leftMargin = dp(8)
                rightMargin = dp(80)
                bottomMargin = dp(HomeChromeMetrics.FOOTER_HEIGHT_DP + if (speedLegend) 4 else 8)
            }
            routeInfoSlot.addView(view, params)
            registerLayoutTarget("#home-route-display-info","路线信息组合",view)
        }
        refreshVisibility()
    }

    fun setLayoutDraft(draft: NativeLayoutDraft) {
        layoutDraft = draft
        applyNativeLayout()
    }

    fun currentLayoutDraft() = layoutDraft

    /** Register a host-owned real View (camera joystick/route subview) as a selectable layout target. */
    fun registerLayoutTarget(selector:String,label:String,view:View?) {
        val key=NativeLayoutDraft.migrateSelector(selector)
        if(view==null) { layoutTargets.remove(key); layoutTargetLabels.remove(key); return }
        require(key.startsWith("#home-") && label.length<=120) { "原生布局选择器无效" }
        layoutTargets[key]=view; layoutTargetLabels[key]=label
        view.layoutParams?.let { layoutBaseParams[key]=it.width to it.height }
        layoutBaseTextSizes[key]=textViews(view).map { it to it.textSize }
        applyNativeLayout()
    }

    fun availableLayoutControls():List<Pair<String,String>> = layoutTargets.keys.map { it to (layoutTargetLabels[it] ?: it) }

    /** Adds the native joystick just below the right rail, clear of the footer and left route overlay. */
    fun registerCameraJoystick(view:NativeCameraJoystick?) {
        cameraJoystickView?.let { old -> layoutTargets.remove("#home-camera-joystick"); layoutTargetLabels.remove("#home-camera-joystick"); if(old.parent===this) removeView(old) }
        cameraJoystickView=view
        if(view!=null) {
            if(view.parent!==this) {
                (view.parent as? ViewGroup)?.removeView(view)
                addView(view,LayoutParams(dp(56),dp(56),Gravity.BOTTOM or Gravity.END).apply { rightMargin=dp(8);bottomMargin=dp(HomeChromeMetrics.FOOTER_HEIGHT_DP+8) })
            } else view.layoutParams=LayoutParams(dp(56),dp(56),Gravity.BOTTOM or Gravity.END).apply { rightMargin=dp(8);bottomMargin=dp(HomeChromeMetrics.FOOTER_HEIGHT_DP+8) }
            registerLayoutTarget("#home-camera-joystick","相机摇杆",view)
        }
        refreshVisibility()
    }

    fun setLayoutEditing(enabled: Boolean, selectedSelector: String? = null) {
        layoutEditing = enabled
        selectedLayoutSelector = selectedSelector?.let(NativeLayoutDraft::migrateSelector)
        applyNativeLayout()
    }

    private fun applyNativeLayout() {
        layoutTargets.forEach { (selector, view) ->
            val entry = layoutDraft.entry(selector)
            val density=resources.displayMetrics.density
            view.translationX = ((entry?.dx ?: 0.0)*density).toFloat()
            view.translationY = ((entry?.dy ?: 0.0)*density).toFloat()
            view.scaleX = (entry?.scale ?: 1.0).toFloat()
            view.scaleY = (entry?.scale ?: 1.0).toFloat()
            view.pivotX=0f; view.pivotY=0f
            val params = view.layoutParams
            if (params != null) {
                val base=layoutBaseParams[selector]
                params.width = entry?.width?.let { dp(it.roundToInt()) } ?: base?.first ?: params.width
                params.height = entry?.height?.let { dp(it.roundToInt()) } ?: base?.second ?: params.height
                view.layoutParams = params
            }
            if(entry?.fontSize!=null) textViews(view).forEach { it.setTextSize(TypedValue.COMPLEX_UNIT_PX,(entry.fontSize*density).toFloat()) }
            else layoutBaseTextSizes[selector].orEmpty().forEach { (text,size)->text.setTextSize(TypedValue.COMPLEX_UNIT_PX,size) }
            view.translationZ = (entry?.zIndex ?: 0).toFloat()
            view.visibility = if (entry?.hidden == true && selector !in NativeLayoutDraft.protected) GONE else VISIBLE
            view.setOnTouchListener(if (layoutEditing && selectedLayoutSelector == selector && selector !in NativeLayoutDraft.protected) layoutDragListener(selector) else null)
            entry?.anchor?.let { anchor -> view.post {
                val reference=layoutTargets[NativeLayoutDraft.migrateSelector(anchor.reference)] ?: return@post
                if(reference===view) return@post
                val targetLoc=IntArray(2); val refLoc=IntArray(2); view.getLocationInWindow(targetLoc); reference.getLocationInWindow(refLoc)
                val targetX=when(anchor.x) { "left"->refLoc[0].toFloat(); "right"->refLoc[0]+reference.width.toFloat(); else->refLoc[0]+reference.width/2f }
                val targetY=when(anchor.y) { "top"->refLoc[1].toFloat(); "bottom"->refLoc[1]+reference.height.toFloat(); else->refLoc[1]+reference.height/2f }
                val ownX=when(anchor.x) { "left"->targetLoc[0].toFloat(); "right"->targetLoc[0]+view.width.toFloat(); else->targetLoc[0]+view.width/2f }
                val ownY=when(anchor.y) { "top"->targetLoc[1].toFloat(); "bottom"->targetLoc[1]+view.height.toFloat(); else->targetLoc[1]+view.height/2f }
                view.translationX += targetX-ownX+(anchor.gapX*resources.displayMetrics.density).toFloat(); view.translationY += targetY-ownY+(anchor.gapY*resources.displayMetrics.density).toFloat()
            } }
        }
        // Protected recovery controls cannot be hidden or displaced by an imported draft.
        lockButton.visibility = if (HomeChromeMetrics.showLockEntry(locked, panelId, taskActive)) VISIBLE else GONE
        layoutRecoveryButton.visibility = VISIBLE
        refreshVisibility()
    }

    private fun textViews(view:View):List<TextView> = when(view) {
        is TextView -> listOf(view)
        is ViewGroup -> (0 until view.childCount).flatMap { textViews(view.getChildAt(it)) }
        else -> emptyList()
    }

    private fun layoutHidden(selector:String)=layoutDraft.entry(selector)?.hidden==true

    private fun layoutDragListener(selector: String): View.OnTouchListener {
        var lastX = 0f; var lastY = 0f
        return View.OnTouchListener { view, event ->
            when (event.actionMasked) {
                android.view.MotionEvent.ACTION_DOWN -> { lastX = event.rawX; lastY = event.rawY; onLayoutDragStarted?.invoke(layoutDraft); true }
                android.view.MotionEvent.ACTION_MOVE -> {
                    val dx = event.rawX - lastX; val dy = event.rawY - lastY
                    lastX = event.rawX; lastY = event.rawY
                    val old = layoutDraft.entry(selector) ?: NativeLayoutEntry(selector, selector.removePrefix("#"))
                    layoutDraft = layoutDraft.replace(old.copy(dx = (old.dx + dx / resources.displayMetrics.density).coerceIn(-3000.0, 3000.0), dy = (old.dy + dy / resources.displayMetrics.density).coerceIn(-3000.0, 3000.0)))
                    view.translationX += dx; view.translationY += dy
                    onLayoutDraftChanged?.invoke(layoutDraft)
                    true
                }
                android.view.MotionEvent.ACTION_UP, android.view.MotionEvent.ACTION_CANCEL -> true
                else -> true
            }
        }
    }

    var onLayoutDraftChanged: ((NativeLayoutDraft) -> Unit)? = null
    var onLayoutDragStarted: ((NativeLayoutDraft) -> Unit)? = null

    fun closePanel() {
        val wasCollectionSplit = collectionSplit
        panel?.let(::removeView)
        panel = null
        panelScroll = null
        panelId = null
        panelMaxHeightOverrideDp = null
        collectionSplit = false
        if (wasCollectionSplit) {
            (rail.layoutParams as? LayoutParams)?.let { params ->
                params.bottomMargin = dp(HomeChromeMetrics.FOOTER_HEIGHT_DP + 84)
                rail.layoutParams = params
            }
            rail.setPadding(dp(3), dp(3), dp(3), dp(3))
            for (index in 0 until rail.childCount) {
                (rail.getChildAt(index).layoutParams as? LinearLayout.LayoutParams)?.let { itemParams ->
                    itemParams.bottomMargin = if (index < rail.childCount - 1) dp(2) else 0
                    rail.getChildAt(index).layoutParams = itemParams
                }
            }
            onMapViewportChanged?.invoke(0, 0)
        }
        refreshVisibility()
        updateBottomSelection()
    }

    fun currentPanel() = panelId

    fun showPanel(id: String, title: String, topAligned: Boolean = false, width: Int = 300, content: LinearLayout.() -> Unit) =
        showPanelInternal(id, title, topAligned, width, null, content)

    /** Overload for panels whose close affordance means hide/collapse rather than discard. */
    fun showPanel(
        id: String,
        title: String,
        topAligned: Boolean,
        width: Int,
        onClose: () -> Unit,
        content: LinearLayout.() -> Unit,
    ) = showPanelInternal(id, title, topAligned, width, onClose, content)

    /** Panel variant with fixed compact header/footer slots around a scrollable body. */
    fun showPanelWithSlots(
        id: String,
        title: String,
        topAligned: Boolean = false,
        width: Int = 300,
        maxHeightDp: Int? = null,
        fixedHeader: LinearLayout.() -> Unit,
        fixedFooter: LinearLayout.() -> Unit,
        content: LinearLayout.() -> Unit,
    ) = showPanelInternal(id, title, topAligned, width, null, content, fixedHeader, fixedFooter, maxHeightDp)

    /** Full-width collection workspace. Unlike ordinary floating panels, its height reserves a map viewport. */
    fun showCollectionWorkbench(
        title: String,
        fixedHeader: LinearLayout.() -> Unit = {},
        content: LinearLayout.() -> Unit,
    ) {
        showPanelInternal("favorite", title, true, widthDp(), null, content, fixedHeader, null, null, collectionWorkbench = true)
    }

    private fun showPanelInternal(
        id: String,
        title: String,
        topAligned: Boolean,
        width: Int,
        onClose: (() -> Unit)?,
        content: LinearLayout.() -> Unit,
        fixedHeader: (LinearLayout.() -> Unit)? = null,
        fixedFooter: (LinearLayout.() -> Unit)? = null,
        maxHeightDp: Int? = null,
        collectionWorkbench: Boolean = false,
    ) {
        val previousScroll = if (panelId == id) panelScroll?.scrollY ?: 0 else 0
        closePanel()
        panelId = id
        panelTopAligned = topAligned
        panelRequestedWidth = width
        panelMaxHeightOverrideDp = maxHeightDp?.coerceAtLeast(0)
        collectionSplit = collectionWorkbench
        val card = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            background = surface(HomeChromeMetrics.CARD_RADIUS_DP)
            elevation = dp(5).toFloat()
            setPadding(dp(8), dp(4), dp(8), dp(6))
            if (collectionWorkbench) {
                background = GradientDrawable().apply { setColor(ShantuColors.surface); cornerRadius = 0f }
                elevation = 0f
                setPadding(0, 0, 0, 0)
            }
            themeBindings.bindBackground(this, NativeThemeRole.SURFACE, if (collectionWorkbench) 0f else dp(HomeChromeMetrics.CARD_RADIUS_DP).toFloat())
            if (fixedHeader != null) {
                val headerSlot = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; fixedHeader() }
                addView(headerSlot, LinearLayout.LayoutParams(-1, -2))
            } else {
                val closeAction = onClose ?: { closePanel() }
                val heading = LinearLayout(context).apply { gravity = Gravity.CENTER_VERTICAL }
                heading.addView(textButton("‹ 返回", 12) { closeAction() }.apply {
                    setPadding(dp(4), 0, dp(4), 0)
                }, LinearLayout.LayoutParams(dp(52), dp(36)))
                heading.addView(text(title, 14).apply {
                    setTypeface(null, Typeface.BOLD)
                    gravity = Gravity.CENTER_VERTICAL or Gravity.START
                    setPadding(dp(6), 0, dp(6), 0)
                    maxLines = 1
                    ellipsize = android.text.TextUtils.TruncateAt.END
                }, LinearLayout.LayoutParams(0, dp(36), 1f))
                heading.addView(textButton("×", 18) { closeAction() }.apply {
                    themeBindings.bindText(this, NativeThemeRole.CLOSE)
                    contentDescription = "关闭"
                }, LinearLayout.LayoutParams(dp(36), dp(36)))
                addView(heading, LinearLayout.LayoutParams(-1, dp(36)))
            }
            val body = LinearLayout(context).apply {
                orientation = LinearLayout.VERTICAL
                content()
            }
            val scroll = ScrollView(context).apply {
                isFillViewport = false
                isVerticalScrollBarEnabled = true
                overScrollMode = View.OVER_SCROLL_IF_CONTENT_SCROLLS
                addView(body, FrameLayout.LayoutParams(-1, -2))
            }
            addView(scroll, LinearLayout.LayoutParams(-1, -2))
            panelScroll = scroll
            if (fixedFooter != null) {
                val footerSlot = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; fixedFooter() }
                addView(footerSlot, LinearLayout.LayoutParams(-1, -2))
            }
        }
        panel = card
        addView(card, panelLayoutParams(id, width, topAligned))
        card.post {
            constrainPanelHeight(card)
            if (previousScroll > 0) panelScroll?.post { panelScroll?.scrollTo(0, previousScroll) }
        }
        refreshVisibility()
        updateBottomSelection()
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        if (panelId != null) post { refreshPanelBounds() }
        if (h > 0 && quick.childCount > 0) {
            val recordParams = quickRecord.layoutParams as? FrameLayout.LayoutParams
            if (recordParams != null) {
                recordParams.bottomMargin = dp(HomeChromeMetrics.recordingBottomMarginDp(viewportHeightDp()))
                quickRecord.layoutParams = recordParams
            }
        }
        if (collectionSplit) post { updateCollectionViewport() }
        if (layoutDraft.entries.any { it.anchor != null }) post { applyNativeLayout() }
    }

    private fun refreshPanelBounds() {
        val id = panelId ?: return
        val card = panel as? LinearLayout ?: return
        panelScroll?.layoutParams = LinearLayout.LayoutParams(-1, -2)
        val params = panelLayoutParams(id, panelRequestedWidth, panelTopAligned)
        card.layoutParams = params
        card.post { constrainPanelHeight(card) }
    }

    private fun panelLayoutParams(id: String, requestedWidth: Int, topAligned: Boolean): LayoutParams {
        if (collectionSplit) {
            return LayoutParams(-1, dp(HomeChromeMetrics.collectionSplitHeightDp(heightDp())), Gravity.TOP)
        }
        val frame = HomeChromeMetrics.panelFrame(id, requestedWidth, widthDp(), heightDp(), topAligned)
        return LayoutParams(dp(frame.widthDp), ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.START or if (topAligned) Gravity.TOP else Gravity.BOTTOM).apply {
            leftMargin = dp(frame.leftMarginDp)
            topMargin = dp(frame.topMarginDp)
            bottomMargin = dp(frame.bottomMarginDp)
        }
    }

    private fun constrainPanelHeight(card: LinearLayout) {
        if (panel !== card) return
        if (collectionSplit) {
            val splitHeight = HomeChromeMetrics.collectionSplitHeightDp(heightDp())
            val params = card.layoutParams as? LayoutParams ?: return
            val target = dp(splitHeight)
            if (params.height != target) { params.height = target; card.layoutParams = params }
            panelScroll?.layoutParams = LinearLayout.LayoutParams(-1, 0, 1f)
            updateCollectionViewport()
            return
        }
        val id = panelId ?: return
        val frame = HomeChromeMetrics.panelFrame(id, panelRequestedWidth, widthDp(), heightDp(), panelTopAligned)
        val cap = dp(minOf(panelMaxHeightOverrideDp ?: frame.maxHeightDp, frame.maxHeightDp))
        val scroll = panelScroll ?: return
        val cardParams = card.layoutParams as? LayoutParams ?: return
        val scrollParams = scroll.layoutParams as? LinearLayout.LayoutParams ?: return

        // Measure the natural content height from the same exact width each time. The prior
        // implementation compared the already-capped measured height with `cap`; a card at
        // exactly the cap then flipped back to WRAP_CONTENT, oscillating on repeated layouts.
        if (scrollParams.height != ViewGroup.LayoutParams.WRAP_CONTENT || scrollParams.weight != 0f) {
            scrollParams.height = ViewGroup.LayoutParams.WRAP_CONTENT
            scrollParams.weight = 0f
            scroll.layoutParams = scrollParams
        }
        if (cardParams.height != ViewGroup.LayoutParams.WRAP_CONTENT) {
            cardParams.height = ViewGroup.LayoutParams.WRAP_CONTENT
            card.layoutParams = cardParams
        }
        val widthSpec = View.MeasureSpec.makeMeasureSpec(cardParams.width.coerceAtLeast(0), View.MeasureSpec.EXACTLY)
        card.measure(widthSpec, View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED))
        // Zero available height is a real cap (for example before the root is measured or
        // under an extreme IME resize), never an alias for unbounded WRAP_CONTENT.
        val needsScroll = card.measuredHeight > cap
        val targetHeight = if (needsScroll) cap else ViewGroup.LayoutParams.WRAP_CONTENT
        val targetScrollHeight = if (needsScroll) 0 else ViewGroup.LayoutParams.WRAP_CONTENT
        val targetScrollWeight = if (needsScroll) 1f else 0f
        if (cardParams.height != targetHeight) {
            cardParams.height = targetHeight
            card.layoutParams = cardParams
        }
        if (scrollParams.height != targetScrollHeight || scrollParams.weight != targetScrollWeight) {
            scrollParams.height = targetScrollHeight
            scrollParams.weight = targetScrollWeight
            scroll.layoutParams = scrollParams
        }
    }

    private fun updateCollectionViewport() {
        if (!collectionSplit) return
        val topPx = dp(HomeChromeMetrics.collectionSplitHeightDp(heightDp()))
        (rail.layoutParams as? LayoutParams)?.let { params ->
            val target = dp(HomeChromeMetrics.FOOTER_HEIGHT_DP)
            if (params.bottomMargin != target) { params.bottomMargin = target; rail.layoutParams = params }
        }
        rail.setPadding(dp(1), dp(1), dp(1), dp(1))
        for (index in 0 until rail.childCount) {
            (rail.getChildAt(index).layoutParams as? LinearLayout.LayoutParams)?.let { itemParams ->
                itemParams.bottomMargin = if (index < rail.childCount - 1) dp(1) else 0
                rail.getChildAt(index).layoutParams = itemParams
            }
        }
        onMapViewportChanged?.invoke(topPx, 0)
    }

    private fun refreshVisibility() {
        if(comparison) {
            listOf(top,bottom,upperRail,rail,quick,status,scaleBar,routeInfoSlot).forEach { it.visibility=GONE }
            cameraJoystickView?.visibility=GONE
            layoutRecoveryButton.visibility=VISIBLE
            lockButton.visibility=if(locked) VISIBLE else GONE
            panel?.visibility=if(locked) GONE else VISIBLE
            return
        }
        routeInfoSlot.visibility = if (locked || routeInfoView == null || layoutHidden("#home-route-display-info")) GONE else VISIBLE
        cameraJoystickView?.visibility = if (locked || layoutDraft.entry("#home-camera-joystick")?.hidden == true) GONE else VISIBLE
        quick.visibility=VISIBLE;status.visibility=VISIBLE
        top.visibility = if (locked || collectionSplit || layoutHidden("#home-topbar")) GONE else VISIBLE
        bottom.visibility = if (locked || layoutHidden("#home-bottom-nav")) GONE else VISIBLE
        bottomNavigation.visibility = if (layoutHidden("#home-bottom-nav")) GONE else VISIBLE
        upperRail.visibility = if (locked || collectionSplit || layoutHidden("#home-map-actions")) GONE else VISIBLE
        scaleBar.visibility = if (upperRail.visibility != VISIBLE || layoutHidden("#home-scale-bar")) GONE else VISIBLE
        rail.visibility = if (layoutHidden("#home-position-dock")) GONE else VISIBLE
        for (i in 0 until rail.childCount) {
            val child = rail.getChildAt(i)
            child.visibility = if (!locked || child.tag in listOf("marker", "direction", "follow")) VISIBLE else GONE
        }
        quickRecord.visibility = if (locked || layoutHidden("#home-recording")) GONE else VISIBLE
        status.visibility = if (layoutHidden("#home-status")) GONE else VISIBLE
        panel?.visibility = if (locked) GONE else VISIBLE
        // An open panel/actual task hides the lock entry until locked; locked state always leaves an unlock.
        lockButton.visibility = if (HomeChromeMetrics.showLockEntry(locked, panelId, taskActive)) VISIBLE else GONE
        layoutRecoveryButton.visibility = VISIBLE
        updateBottomSelection()
    }

    private fun updateBottomSelection() {
        val selected = when (panelId) {
            "record" -> "record"
            "route" -> "route"
            "draw" -> "draw"
            "favorite" -> "favorite"
            "tools" -> "tools"
            else -> if (panelId == null && taskActive) "draw" else null
        }
        bottomItems.forEach { (id, item) ->
            val active = id == selected
            val role = if (active) NativeThemeRole.ACCENT else NativeThemeRole.MUTED
            themeBindings.bindTint(item.icon, role)
            themeBindings.bindText(item.label, role)
            item.label.setTypeface(null, if (active) Typeface.BOLD else Typeface.NORMAL)
            item.indicator.visibility = if (active) VISIBLE else GONE
            item.root.isSelected = active
        }
    }

    fun text(label: String, size: Int = 13) = TextView(context).apply {
        text = label
        textSize = size.toFloat()
        themeBindings.bindText(this, NativeThemeRole.INK)
        gravity = Gravity.CENTER_VERTICAL or Gravity.CENTER_HORIZONTAL
        includeFontPadding = false
    }

    fun textButton(label: String, size: Int = 13, click: () -> Unit) = text(label, size).apply {
        isClickable = true
        isFocusable = true
        contentDescription = label.replace('\n', ' ')
        minimumHeight = dp(HomeChromeMetrics.MAP_CONTROL_DP)
        setOnClickListener { click() }
    }

    /** Compact menu row; map-direct actions remain 44dp elsewhere. */
    fun row(label: String, click: () -> Unit) = textButton(label, 12, click).apply {
        gravity = Gravity.CENTER_VERTICAL or Gravity.START
        setPadding(dp(6), 0, dp(6), 0)
        minimumHeight = 0
        background = surface(HomeChromeMetrics.CONTROL_RADIUS_DP, ShantuColors.raised)
        themeBindings.bindBackground(this, NativeThemeRole.RAISED, dp(HomeChromeMetrics.CONTROL_RADIUS_DP).toFloat())
        layoutParams = LinearLayout.LayoutParams(-1, dp(28)).apply { topMargin = dp(HomeChromeMetrics.PANEL_GAP_DP) }
    }

    fun input(hintValue: String) = EditText(context).apply {
        val markerEditor = panelId == "marker"
        hint = hintValue
        textSize = if (markerEditor) 13f else 16f
        themeBindings.bindText(this, NativeThemeRole.INK)
        themeBindings.bindHint(this, NativeThemeRole.MUTED)
        setPadding(dp(8), dp(4), dp(8), dp(4))
        background = surface(HomeChromeMetrics.CONTROL_RADIUS_DP, ShantuColors.raised)
        themeBindings.bindBackground(this, NativeThemeRole.FIELD, dp(HomeChromeMetrics.CONTROL_RADIUS_DP).toFloat())
        layoutParams = LinearLayout.LayoutParams(-1, dp(if (markerEditor) 32 else 40)).apply {
            topMargin = dp(HomeChromeMetrics.PANEL_GAP_DP)
        }
        isSingleLine = true
    }

    private fun icon(name: String, label: String, click: () -> Unit) = ImageView(context).apply {
        val resource = resources.getIdentifier("ic_$name", "drawable", context.packageName)
        if (resource != 0) setImageResource(resource)
        themeBindings.bindTint(this, NativeThemeRole.MUTED)
        scaleType = ImageView.ScaleType.CENTER_INSIDE
        contentDescription = label
        isFocusable = true
        setOnClickListener { click() }
    }

    fun surface(radius: Int = HomeChromeMetrics.CARD_RADIUS_DP, color: Int = ShantuColors.surface) = GradientDrawable().apply {
        setColor(color)
        cornerRadius = dp(radius).toFloat()
    }

    fun dp(value: Int) = (value * resources.displayMetrics.density + .5f).toInt()

    private fun widthDp() = (width / resources.displayMetrics.density).roundToInt().coerceAtLeast(0)
    private fun heightDp() = (height / resources.displayMetrics.density).roundToInt().coerceAtLeast(0)
    private fun viewportHeightDp() = (resources.displayMetrics.heightPixels / resources.displayMetrics.density).roundToInt()
}
