package com.shantu.nativeapp.ui

import android.content.Context
import android.graphics.Color
import android.location.Location
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import android.os.OperationCanceledException
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import com.shantu.nativeapp.map.NativeFix
import com.shantu.nativeapp.map.NativeGuidance
import com.shantu.nativeapp.map.NativeGuidanceState
import com.shantu.nativeapp.map.NativeMapController
import com.shantu.nativeapp.navigation.NativePlace
import com.shantu.nativeapp.navigation.NativePlannedRoute
import com.shantu.nativeapp.navigation.NativeRoutePlanner
import com.shantu.nativeapp.navigation.nativeAverageSpeedKmh
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

/** Map-first native guidance card. It never changes the saved/original route. */
class NativeNavigationPanel(
    private val context: Context,
    private val chrome: HomeChrome,
    private val map: NativeMapController,
    private val planner: NativeRoutePlanner = NativeRoutePlanner(),
    private val onFollow: () -> Unit,
    private val onStop: () -> Unit,
) {
    private enum class Connection { DEPARTURE, REJOIN }

    private val main = Handler(Looper.getMainLooper())
    private val executor = Executors.newSingleThreadExecutor()
    private var cancellation: CancellationSignal? = null
    private var generation = 0
    private var disposed = false
    private var expanded = false
    private var following = false
    private var averageStartAt: Long? = null
    private var lastAverageTickAt: Long? = null
    private var activeNavigationMillis = 0L
    private var averageDistanceMeters = 0.0
    private var lastReportedTravelled: Double? = null
    private var title = "路线导航"
    private var originalJson: JSONObject? = null
    private var originalState: NativeGuidanceState? = null
    private var departurePending = false
    private var accessState: NativeGuidanceState? = null
    private var accessJson: JSONObject? = null
    private var connection: Connection? = null
    private var connectionTarget: Pair<Double, Double>? = null
    private var planning = false
    private var connectionError = ""
    private var locationError = ""
    private var latestFix: NativeFix? = null
    private var originalOverlayId = ""
    private var accessOverlayId = ""
    private var stepPage = 0
    private var followButton: TextView? = null
    private var statusView: TextView? = null
    private var maneuverView: TextView? = null
    private var instructionView: TextView? = null
    private var metricsView: TextView? = null
    private var checkpointView: TextView? = null
    private var speedView: TextView? = null
    private var qualityView: TextView? = null
    private var connectionErrorView: TextView? = null
    private var displayedStepViews: List<Pair<Int, TextView>> = emptyList()
    private val heartbeat = object : Runnable {
        override fun run() {
            if (disposed || originalJson == null) return
            accumulateAverageTime(System.currentTimeMillis())
            processFix(latestFix)
            recordGuidanceDistance()
            updateLiveCard()
            main.postDelayed(this, HEARTBEAT_MS)
        }
    }

    /** Begin guidance from the original route. The original object remains immutable. */
    fun start(route: JSONObject, title: String = "路线导航") {
        checkMainThread()
        if (disposed) return
        val routeOnly = route.optJSONObject("route") ?: route
        val copy = JSONObject(routeOnly.toString())
        val initialState = try { NativeGuidance.create(copy, System.currentTimeMillis()) }
        catch (error: Exception) {
            toast(error.message ?: "路线无法用于导航")
            return
        }
        clearSession(notifyHost = false)
        generation++
        this.title = title.ifBlank { "路线导航" }
        originalState = initialState
        averageStartAt = null
        lastAverageTickAt = null
        activeNavigationMillis = 0L
        averageDistanceMeters = 0.0
        lastReportedTravelled = null
        originalJson = copy
        departurePending = true
        originalOverlayId = "navigation-original-$generation"
        accessOverlayId = "navigation-access-$generation"
        stepPage = 0
        drawOriginal()
        main.removeCallbacks(heartbeat)
        main.postDelayed(heartbeat, HEARTBEAT_MS)
        processFix(latestFix)
        renderCard(force = true)
    }

    /** Feed only a real platform location. No camera center or route bearing is substituted. */
    fun onLocation(location: Location) {
        val update = {
            if (!disposed && originalJson != null) {
                latestFix = location.toNativeFix()
                if (NativeGuidance.freshFix(latestFix, System.currentTimeMillis())) {
                    if (averageStartAt == null) averageStartAt = latestFix?.timestamp ?: System.currentTimeMillis()
                    if (lastAverageTickAt == null) lastAverageTickAt = System.currentTimeMillis()
                }
                val previousLocationError = locationError
                locationError = ""
                if (connectionError == previousLocationError || connectionError == "等待真实定位后才能计算接入路线") connectionError = ""
                processFix(latestFix)
                accumulateAverageTime(System.currentTimeMillis())
                recordGuidanceDistance()
                updateLiveCard()
            }
        }
        if (Looper.myLooper() == Looper.getMainLooper()) update() else main.post { update() }
    }

    fun onLocationError(message: String) {
        val update = {
            if (!disposed && originalJson != null) {
                locationError = message.ifBlank { "等待当前位置…" }
                lastAverageTickAt = null
                val now = System.currentTimeMillis()
                accessState = accessState?.let { NativeGuidance.advance(it, null, now, locationError) }
                if (!departurePending && accessState == null)
                    originalState = originalState?.let { NativeGuidance.advance(it, null, now, locationError) }
                updateLiveCard()
            }
        }
        if (Looper.myLooper() == Looper.getMainLooper()) update() else main.post { update() }
    }

    /** Allow the host to reflect whether the system location-follow request actually succeeded. */
    fun setFollowing(value: Boolean) {
        val update = { following = value; updateLiveCard() }
        if (Looper.myLooper() == Looper.getMainLooper()) update() else main.post { update() }
    }

    /** Re-open a card that was collapsed; this does not start a new session. */
    fun show() {
        checkMainThread()
        if (disposed || originalJson == null) return
        if (chrome.currentPanel() != PANEL_ID) renderCard(force = true) else updateLiveCard()
    }

    /** True while guidance owns a route session, including while its card is collapsed. */
    fun isActive(): Boolean = !disposed && originalJson != null

    /** Restore ephemeral guidance lines after the host redraws saved workspace routes. */
    fun refreshOverlays() {
        checkMainThread()
        if (!isActive()) return
        drawOriginal()
        accessJson?.let(::drawAccess)
    }

    /** Lifecycle resume: keep the same route and reopen its card for an active session. */
    fun resume() {
        checkMainThread()
        if (originalJson == null || disposed) return
        latestFix?.let(::processFix)
        show()
    }

    /** Collapse the navigation card without stopping guidance or cancelling a road plan. */
    fun hideCard() {
        checkMainThread()
        if (chrome.currentPanel() == PANEL_ID) chrome.closePanel()
    }

    /** Explicit end action. This removes only navigation overlays, never the saved route. */
    fun stop() {
        checkMainThread()
        clearSession(notifyHost = true)
    }

    /** Activity teardown cleanup; does not send a second host stop callback. */
    fun dispose() {
        if (disposed) return
        checkMainThread()
        clearSession(notifyHost = false)
        disposed = true
        executor.shutdownNow()
    }

    private fun processFix(fix: NativeFix?) {
        val original = originalJson ?: return
        val now = System.currentTimeMillis()
        if (departurePending && accessState == null && !planning && connectionError.isBlank()) {
            if (NativeGuidance.freshFix(fix, now)) {
                val current = requireNotNull(fix)
                val startPoint = firstCoordinate(original) ?: run {
                    connectionError = "原路线起点坐标无效"
                    return
                }
                if (distanceMeters(current.longitude to current.latitude, startPoint) <= departureStartRadius(current.accuracy)) {
                    departurePending = false
                    connectionError = ""
                } else {
                    planConnection(Connection.DEPARTURE, current, startPoint)
                    return
                }
            } else if (locationError.isNotEmpty()) {
                connectionError = locationError
            }
        }

        val access = accessState
        if (access != null) {
            val updated = NativeGuidance.advance(access, fix, now, locationError)
            accessState = updated
            if (updated.arrived && NativeGuidance.freshFix(fix, now)) {
                val kind = connection
                    val target = connectionTarget
                    val targetRadius = departureStartRadius(requireNotNull(fix).accuracy)
                    if (kind != null && target != null &&
                        distanceMeters(fix.longitude to fix.latitude, target) > targetRadius) {
                        connectionError = if (kind == Connection.DEPARTURE)
                            "已到达接入路线末端，但尚未确认到达原路线起点；继续定位或重试。"
                        else "已到达接入路线末端，但尚未确认接回途经点；继续定位或重试。"
                        return
                    }
                accessState = null
                accessJson = null
                connection = null
                    connectionTarget = null
                map.removeRoute(accessOverlayId)
                if (kind == Connection.DEPARTURE) {
                    departurePending = false
                    connectionError = ""
                } else {
                    originalState = originalState?.copy(
                        last = null, anchor = null, offRoute = false, offSince = null,
                        arriveSince = null, quality = "", qualityFromLocationError = false,
                        gap = true,
                    )
                    connectionError = ""
                }
                originalState = originalState?.let { NativeGuidance.advance(it, fix, now) }
            }
            return
        }
        if (!departurePending) originalState = originalState?.let { NativeGuidance.advance(it, fix, now, locationError) }
    }

    private fun planConnection(kind: Connection, fix: NativeFix, target: Pair<Double, Double>) {
        val targetName = if (kind == Connection.DEPARTURE) "原路线起点" else nextCheckpointLabel()
        val targetDistance = distanceMeters(fix.longitude to fix.latitude, target)
        if (targetDistance < 20.0) {
            if (kind == Connection.DEPARTURE) departurePending = false
            else originalState = originalState?.copy(last = null, anchor = null, offRoute = false, offSince = null, arriveSince = null, quality = "", qualityFromLocationError = false, gap = true)
            connectionError = ""
            if (!departurePending) originalState = originalState?.let { NativeGuidance.advance(it, fix, System.currentTimeMillis()) }
            return
        }
        cancelPlan()
        generation++
        val requestGeneration = generation
        val signal = CancellationSignal()
        cancellation = signal
        planning = true
        connection = kind
        connectionTarget = target
        connectionError = ""
        val route = requireNotNull(originalJson)
        val mode = route.optString("mode", "pedestrian")
        executor.execute {
            val result = runCatching {
                val planned = planner.plan(
                    NativePlace("当前位置", fix.longitude, fix.latitude),
                    NativePlace(targetName, target.first, target.second), mode, cancellationSignal = signal,
                )
                NativeNavigationRoad.toGuidanceJson(planned, fix, target)
            }
            main.post {
                if (disposed || requestGeneration != generation) return@post
                planning = false
                cancellation = null
                result.onSuccess { geometry ->
                    try {
                        accessJson = geometry
                        accessState = NativeGuidance.create(geometry, System.currentTimeMillis())
                        connection = kind
                        drawAccess(geometry)
                        latestFix?.let(::processFix)
                    } catch (error: Exception) {
                        connectionError = error.message ?: "道路接入路线无效"
                        accessState = null
                        accessJson = null
                        connectionTarget = null
                    }
                }.onFailure { error ->
                    if (error !is OperationCanceledException && signal.isCanceled.not())
                        connectionError = error.message ?: "道路接入路线规划失败"
                    connectionTarget = null
                }
                renderCard()
            }
        }
        updateLiveCard()
    }

    private fun retryConnection() {
        val fix = latestFix
        if (!NativeGuidance.freshFix(fix, System.currentTimeMillis())) {
            connectionError = "等待真实定位后才能计算接入路线"
            updateLiveCard()
            return
        }
        val current = requireNotNull(fix)
        if (connectionError == "等待真实定位后才能计算接入路线") connectionError = ""
        if (departurePending) {
            val start = firstCoordinate(originalJson ?: return) ?: return
            planConnection(Connection.DEPARTURE, current, start)
        } else {
            val state = originalState ?: return
            val checkpoint = state.route.checkpoints.getOrNull(state.nextCheckpoint)
            val target = checkpoint?.point ?: state.route.coordinates.lastOrNull()
            if (target == null) { connectionError = "原路线目标点无效"; updateLiveCard(); return }
            planConnection(Connection.REJOIN, current, target)
        }
        updateLiveCard()
    }

    private fun renderCard(force: Boolean = false) {
        if (disposed || originalJson == null) return
        if (!force && chrome.currentPanel() != PANEL_ID) return
        val route = originalJson ?: return
        val mode = route.optString("mode", "pedestrian")
        val status = statusText()
        displayedStepViews = emptyList()
        followButton = null
        statusView = null
        maneuverView = null
        instructionView = null
        metricsView = null
        checkpointView = null
        speedView = null
        qualityView = null
        connectionErrorView = null
        chrome.showPanel(PANEL_ID, title, topAligned = true, width = 300, onClose = ::hideCard) {
            val head = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
            val follow = chrome.row(if (following) "导航跟随中" else "继续导航") {
                onFollow()
            }
            followButton = follow
            head.addView(follow, LinearLayout.LayoutParams(0, chrome.dp(28), 1f))
            head.addView(chrome.text(modeLabel(mode), 10).apply {
                gravity = Gravity.CENTER
                setTextColor(ShantuColors.accent)
            }, LinearLayout.LayoutParams(chrome.dp(44), chrome.dp(28)))
            addView(head, LinearLayout.LayoutParams(-1, chrome.dp(30)))

            val primary = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
            val maneuver = chrome.text(maneuverSymbol(), 22).apply {
                setTextColor(if (isOffRoute()) WARNING else ShantuColors.accent)
                gravity = Gravity.CENTER
            }
            maneuverView = maneuver
            primary.addView(maneuver, LinearLayout.LayoutParams(chrome.dp(34), chrome.dp(38)))
            val statusText = chrome.text(status, 12).apply {
                gravity = Gravity.CENTER_VERTICAL or Gravity.START
                maxLines = 2
                setPadding(chrome.dp(4), 0, chrome.dp(2), 0)
            }
            statusView = statusText
            primary.addView(statusText, LinearLayout.LayoutParams(0, chrome.dp(38), 1f))
            addView(primary, LinearLayout.LayoutParams(-1, chrome.dp(40)))

            val state = activeState()
            instructionView = chrome.text("", 11).apply { visibility = View.GONE }
            addView(instructionView, LinearLayout.LayoutParams(-1, chrome.dp(24)))
            val quick = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
            quick.addView(chrome.row(if (expanded) "收起详情" else "展开详情") { expanded = !expanded; renderCard(force = true) },
                LinearLayout.LayoutParams(0, chrome.dp(28), 1f))
            if (expanded && !isArrived()) quick.addView(chrome.row("重新计算接入") { retryConnection() },
                LinearLayout.LayoutParams(0, chrome.dp(28), 1f).apply { leftMargin = chrome.dp(4) })
            addView(quick, LinearLayout.LayoutParams(-1, chrome.dp(30)))

            if (expanded) {
                val cameraModes = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
                cameraModes.addView(chrome.row("第一人称跟随") { map.setPitch(65.0); onFollow() },
                    LinearLayout.LayoutParams(0, chrome.dp(28), 1f))
                cameraModes.addView(chrome.row("俯视跟随") { map.setPitch(0.0); onFollow() },
                    LinearLayout.LayoutParams(0, chrome.dp(28), 1f).apply { leftMargin = chrome.dp(4) })
                addView(cameraModes, LinearLayout.LayoutParams(-1, chrome.dp(30)))
                val current = activeState()
                val total = current?.route?.path?.length ?: routeDistance(route)
                val travelled = current?.travelled ?: 0.0
                val progress = current?.progress ?: 0.0
                val remaining = (total - progress).coerceAtLeast(0.0)
                metricsView = chrome.text("", 11)
                addView(metricsView, LinearLayout.LayoutParams(-1, chrome.dp(24)))
                checkpointView = chrome.text("", 10).apply { visibility = View.GONE }
                addView(checkpointView, LinearLayout.LayoutParams(-1, chrome.dp(24)))
                if (isOffRoute()) addView(chrome.text("已偏离原路线；接回目标按下一未到途经点计算。", 11).apply { setTextColor(WARNING) },
                    LinearLayout.LayoutParams(-1, chrome.dp(24)))
                val fix = latestFix
                val speed = fix?.speed?.takeIf { it.isFinite() && it >= 0 }?.let { "实时 ${"%.1f".format(it * 3.6)} km/h" } ?: "实时速度 —"
                speedView = chrome.text("$speed   均速 ${averageSpeedText()}", 10)
                addView(speedView, LinearLayout.LayoutParams(-1, chrome.dp(22)))
                val routeForSteps = if (accessState != null) accessJson else originalJson
                val steps = routeForSteps?.optJSONArray("steps") ?: JSONArray()
                if (steps.length() > 0) {
                    val activeStep = current?.let { state -> routeForSteps?.let { currentStepIndex(it, state) } } ?: -1
                    addView(chrome.text(if (accessState != null) "接入路线步骤" else "原路线步骤", 11),
                        LinearLayout.LayoutParams(-1, chrome.dp(22)))
                    val pageCount = (steps.length() + STEPS_PER_PAGE - 1) / STEPS_PER_PAGE
                    stepPage = stepPage.coerceIn(0, (pageCount - 1).coerceAtLeast(0))
                    val first = stepPage * STEPS_PER_PAGE
                    val lastExclusive = minOf(steps.length(), first + STEPS_PER_PAGE)
                    if (pageCount > 1) {
                        val pages = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
                        pages.addView(chrome.text("步骤 ${first + 1}–$lastExclusive / ${steps.length()}", 10),
                            LinearLayout.LayoutParams(0, chrome.dp(24), 1f))
                        pages.addView(chrome.row("上一页") { stepPage = (stepPage - 1).coerceAtLeast(0); renderCard(force = true) },
                            LinearLayout.LayoutParams(chrome.dp(58), chrome.dp(26)))
                        pages.addView(chrome.row("下一页") { stepPage = (stepPage + 1).coerceAtMost(pageCount - 1); renderCard(force = true) },
                            LinearLayout.LayoutParams(chrome.dp(58), chrome.dp(26)).apply { leftMargin = chrome.dp(3) })
                        addView(pages, LinearLayout.LayoutParams(-1, chrome.dp(26)))
                    }
                    val stepRows = mutableListOf<Pair<Int, TextView>>()
                    for (index in first until lastExclusive) {
                        val item = steps.optJSONObject(index) ?: continue
                        val instruction = item.optString("instruction").ifBlank { "沿路线继续前行" }
                        val marker = when { index == activeStep -> "▶"; index < activeStep -> "✓"; else -> "·" }
                        val row = chrome.text("$marker ${index + 1}. ${formatDistance(item.optDouble("distance", 0.0))} · $instruction", 10).apply {
                            if (index == activeStep) setTextColor(ShantuColors.accent)
                            setPadding(chrome.dp(4), 0, chrome.dp(2), 0)
                            maxLines = 2
                            gravity = Gravity.CENTER_VERTICAL
                        }
                        stepRows += index to row
                        addView(row, LinearLayout.LayoutParams(-1, chrome.dp(30)))
                    }
                    displayedStepViews = stepRows
                }
                val quality = activeState()?.quality.orEmpty().ifBlank { locationError }
                qualityView = chrome.text(quality, 11).apply { setTextColor(WARNING); visibility = if (quality.isBlank()) View.GONE else View.VISIBLE }
                addView(qualityView, LinearLayout.LayoutParams(-1, chrome.dp(24)))
                connectionErrorView = chrome.text(connectionError, 11).apply { setTextColor(WARNING); visibility = if (connectionError.isBlank()) View.GONE else View.VISIBLE }
                addView(connectionErrorView, LinearLayout.LayoutParams(-1, chrome.dp(36)))
                if (accessState != null) addView(chrome.text("接入线仅沿规划器返回的道路路径；未找到相邻可通行道路时需重试。", 10),
                    LinearLayout.LayoutParams(-1, chrome.dp(28)))
                val footer = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
                footer.addView(chrome.row("继续跟随") { onFollow() }, LinearLayout.LayoutParams(0, chrome.dp(28), 1f))
                footer.addView(chrome.row("结束导航") { stop() }, LinearLayout.LayoutParams(0, chrome.dp(28), 1f).apply { leftMargin = chrome.dp(4) })
                addView(footer, LinearLayout.LayoutParams(-1, chrome.dp(30)).apply { topMargin = chrome.dp(2) })
            }
        }
        updateLiveCard()
    }

    /** Refresh live guidance labels in-place so a GPS tick never replaces the scroll tree. */
    private fun updateLiveCard() {
        if (disposed || originalJson == null || chrome.currentPanel() != PANEL_ID) return
        followButton?.let { setTextIfChanged(it, if (following) "导航跟随中" else "继续导航") }
        statusView?.let { setTextIfChanged(it, statusText()) }
        maneuverView?.apply {
            setTextIfChanged(this, maneuverSymbol())
            setTextColor(if (isOffRoute()) WARNING else ShantuColors.accent)
        }
        val state = activeState()
        val instruction = if (state != null && accessState == null && !departurePending)
            currentStep(originalJson ?: return, state)?.let { "${formatDistance(it.first)} · ${it.second}" } ?: "沿路线继续前行"
        else ""
        instructionView?.apply {
            setTextIfChanged(this, instruction)
            val nextVisibility = if (instruction.isBlank()) View.GONE else View.VISIBLE
            if (visibility != nextVisibility) visibility = nextVisibility
        }
        val total = state?.route?.path?.length ?: originalJson?.let(::routeDistance) ?: 0.0
        val travelled = state?.travelled ?: 0.0
        val progress = state?.progress ?: 0.0
        val remaining = (total - progress).coerceAtLeast(0.0)
        metricsView?.let { setTextIfChanged(it, "已走约 ${formatDistance(travelled)}   ${if (departurePending) "主体里程" else "剩余约 ${formatDistance(remaining)}"}") }
        val next = state?.route?.checkpoints?.getOrNull(state.nextCheckpoint)
        checkpointView?.apply {
            setTextIfChanged(this, if (next == null) "" else "下一途经点 ${state.nextCheckpoint + 1} / ${state.route.checkpoints.size} · ${formatDistance((next.distance - state.progress).coerceAtLeast(0.0))}")
            val nextVisibility = if (next == null) View.GONE else View.VISIBLE
            if (visibility != nextVisibility) visibility = nextVisibility
        }
        val fix = latestFix
        val speed = fix?.speed?.takeIf { it.isFinite() && it >= 0 }?.let { "实时 ${"%.1f".format(it * 3.6)} km/h" } ?: "实时速度 —"
        speedView?.let { setTextIfChanged(it, "$speed   均速 ${averageSpeedText()}") }
        val quality = activeState()?.quality.orEmpty().ifBlank { locationError }
        qualityView?.apply {
            setTextIfChanged(this, quality)
            val nextVisibility = if (quality.isBlank()) View.GONE else View.VISIBLE
            if (visibility != nextVisibility) visibility = nextVisibility
        }
        connectionErrorView?.apply {
            setTextIfChanged(this, connectionError)
            val nextVisibility = if (connectionError.isBlank()) View.GONE else View.VISIBLE
            if (visibility != nextVisibility) visibility = nextVisibility
        }
        val routeForSteps = if (accessState != null) accessJson else originalJson
        val activeStep = if (state != null && routeForSteps != null) currentStepIndex(routeForSteps, state) else -1
        displayedStepViews.forEach { (index, view) ->
            val item = routeForSteps?.optJSONArray("steps")?.optJSONObject(index) ?: return@forEach
            val marker = when { index == activeStep -> "▶"; index < activeStep -> "✓"; else -> "·" }
            setTextIfChanged(view, "$marker ${index + 1}. ${formatDistance(item.optDouble("distance", 0.0))} · ${item.optString("instruction").ifBlank { "沿路线继续前行" }}")
            val color = if (index == activeStep) ShantuColors.accent else ShantuColors.ink
            if (view.currentTextColor != color) view.setTextColor(color)
        }
    }

    private fun setTextIfChanged(view: TextView, value: String) {
        if (view.text.toString() != value) view.text = value
    }

    private fun statusText(): String {
        if (!NativeGuidance.freshFix(latestFix, System.currentTimeMillis())) {
            if (locationError.isNotBlank()) return locationError
            val fix = latestFix
            return when {
                fix == null -> "等待真实定位…"
                !fix.accuracy.isFinite() || fix.accuracy > 50.0 -> "等待有效定位精度…"
                else -> "定位已过期，等待更新"
            }
        }
        if (planning) return when (connection) {
            Connection.DEPARTURE -> "正在计算当前位置到原路线起点的道路路线…"
            Connection.REJOIN -> "正在计算当前位置接回原路线…"
            null -> "正在计算道路路线…"
        }
        if (connectionError.isNotBlank()) return connectionError
        val access = accessState
        if (access != null) {
            if (access.quality.isNotBlank()) return access.quality
            return if (connection == Connection.DEPARTURE) "前往原路线起点" else "沿道路接回下一未到途经点"
        }
        val original = originalState
        if (departurePending) return locationError.ifBlank { original?.quality?.ifBlank { "等待真实定位…" } ?: "等待真实定位…" }
        if (original?.quality?.isNotBlank() == true) return original.quality
        if (original?.arrived == true) return "已到达终点"
        if (original?.offRoute == true) return "已偏离原路线"
        return "沿原路线导航"
    }

    private fun activeState(): NativeGuidanceState? = accessState ?: originalState
    private fun isOffRoute() = accessState?.offRoute == true || (accessState == null && originalState?.offRoute == true)
    private fun isArrived() = accessState == null && originalState?.arrived == true
    private fun maneuverSymbol(): String = when {
        planning -> "…"
        isArrived() -> "⚑"
        departurePending || accessState != null -> "↗"
        isOffRoute() -> "!"
        else -> "↑"
    }

    private fun currentStep(route: JSONObject, state: NativeGuidanceState): Pair<Double, String>? {
        val steps = route.optJSONArray("steps") ?: return null
        var covered = 0.0
        for (index in 0 until steps.length()) {
            val step = steps.optJSONObject(index) ?: continue
            val distance = step.optDouble("distance", 0.0).takeIf { it.isFinite() && it >= 0 } ?: 0.0
            if (covered + distance >= state.progress) {
                return (covered + distance - state.progress).coerceAtLeast(0.0) to
                    step.optString("instruction").ifBlank { "沿路线继续前行" }
            }
            covered += distance
        }
        return null
    }

    private fun currentStepIndex(route: JSONObject, state: NativeGuidanceState): Int {
        val steps = route.optJSONArray("steps") ?: return -1
        var covered = 0.0
        for (index in 0 until steps.length()) {
            val distance = steps.optJSONObject(index)?.optDouble("distance", 0.0)?.takeIf { it.isFinite() && it >= 0 } ?: 0.0
            covered += distance
            if (covered >= state.progress) return index
        }
        return (steps.length() - 1).coerceAtLeast(-1)
    }

    private fun drawOriginal() {
        val json = originalJson ?: return
        val coords = mapCoordinates(json.optJSONArray("coordinates"))
        val color = runCatching { Color.parseColor(json.optJSONObject("style")?.optString("color", "#ffb477") ?: "#ffb477") }
            .getOrDefault(Color.rgb(255, 180, 119))
        map.replaceRoute(originalOverlayId, coords, color, 4f)
    }

    private fun drawAccess(json: JSONObject) {
        map.replaceRoute(accessOverlayId, mapCoordinates(json.optJSONArray("coordinates")), ACCESS_COLOR, 4f)
    }

    private fun nextCheckpointLabel(): String {
        val state = originalState ?: return "原路线目标点"
        val checkpoint = state.route.checkpoints.getOrNull(state.nextCheckpoint)
        return if (checkpoint == null) "原路线终点" else "下一未到途经点"
    }

    private fun firstCoordinate(json: JSONObject): Pair<Double, Double>? =
        json.optJSONArray("coordinates")?.optJSONArray(0)?.let { point -> point.optDouble(0, Double.NaN) to point.optDouble(1, Double.NaN) }
            ?.takeIf { it.first.isFinite() && it.second.isFinite() }

    private fun mapCoordinates(array: JSONArray?): List<Pair<Double, Double>> = array?.let { points ->
        (0 until points.length()).mapNotNull { index ->
            val point = points.optJSONArray(index) ?: return@mapNotNull null
            val lon = point.optDouble(0, Double.NaN); val lat = point.optDouble(1, Double.NaN)
            if (lat.isFinite() && lon.isFinite()) lat to lon else null
        }
    } ?: emptyList()

    private fun cancelPlan() {
        generation++
        cancellation?.cancel()
        cancellation = null
        planning = false
    }

    private fun clearSession(notifyHost: Boolean) {
        main.removeCallbacks(heartbeat)
        cancelPlan()
        if (originalOverlayId.isNotBlank()) map.removeRoute(originalOverlayId)
        if (accessOverlayId.isNotBlank()) map.removeRoute(accessOverlayId)
        val hadSession = originalJson != null
        originalJson = null
        originalState = null
        accessState = null
        accessJson = null
        departurePending = false
        connection = null
        connectionTarget = null
        connectionError = ""
        locationError = ""
        latestFix = null
        following = false
        averageStartAt = null; lastAverageTickAt = null; activeNavigationMillis = 0L; averageDistanceMeters = 0.0; lastReportedTravelled = null
        originalOverlayId = ""
        accessOverlayId = ""
        if (chrome.currentPanel() == PANEL_ID) chrome.closePanel()
        if (notifyHost && hadSession) onStop()
    }

    private fun accumulateAverageTime(now: Long) {
        if (NativeGuidance.freshFix(latestFix, now)) {
            val last = lastAverageTickAt
            if (last != null && now >= last) activeNavigationMillis += (now - last).coerceAtMost(HEARTBEAT_MS * 2)
            lastAverageTickAt = now
        } else lastAverageTickAt = null
    }

    private fun averageSpeedText(): String {
        if (averageStartAt == null) return "—"
        val distance = averageDistanceMeters.takeIf { it.isFinite() && it >= 0 } ?: 0.0
        return nativeAverageSpeedKmh(distance, activeNavigationMillis)?.let { "%.1f km/h".format(it) } ?: "—"
    }

    private fun recordGuidanceDistance() {
        val travelled = activeState()?.travelled?.takeIf { it.isFinite() && it >= 0 } ?: run { lastReportedTravelled = null; return }
        val previous = lastReportedTravelled
        if (previous != null && travelled >= previous) {
            val delta = travelled - previous
            if (delta <= 500.0) averageDistanceMeters += delta
        }
        lastReportedTravelled = travelled
    }

    private fun locationToFix(location: Location): NativeFix = NativeFix(
        longitude = location.longitude,
        latitude = location.latitude,
        timestamp = location.time,
        accuracy = if (location.hasAccuracy()) location.accuracy.toDouble() else Double.NaN,
        speed = if (location.hasSpeed()) location.speed.toDouble() else null,
        heading = if (location.hasBearing()) location.bearing.toDouble() else null,
        provider = location.provider,
    )

    private fun Location.toNativeFix() = locationToFix(this)
    private fun departureStartRadius(accuracy: Double) = maxOf(20.0, minOf(35.0, accuracy))
    private fun routeDistance(route: JSONObject) = route.optDouble("distance", 0.0).takeIf { it.isFinite() && it >= 0 } ?: 0.0
    private fun distanceMeters(a: Pair<Double, Double>, b: Pair<Double, Double>): Double {
        val rad = Math.PI / 180.0
        val dLat = (b.second - a.second) * rad
        val dLon = (b.first - a.first) * rad
        val h = sin(dLat / 2) * sin(dLat / 2) + cos(a.second * rad) * cos(b.second * rad) * sin(dLon / 2) * sin(dLon / 2)
        return 6_371_000.0 * 2 * asin(sqrt(h.coerceIn(0.0, 1.0)))
    }

    private fun formatDistance(meters: Double): String = when {
        !meters.isFinite() || meters < 0 -> "—"
        meters < 1000 -> "${meters.roundToInt()} 米"
        else -> "${"%.1f".format(meters / 1000.0)} 公里"
    }

    private fun modeLabel(mode: String) = when (mode) { "auto" -> "驾车"; "bicycle" -> "骑行"; else -> "步行" }
    private fun toast(message: String) = android.widget.Toast.makeText(context, message, android.widget.Toast.LENGTH_SHORT).show()
    private fun checkMainThread() = check(Looper.myLooper() == Looper.getMainLooper()) { "导航界面操作必须在主线程" }

    companion object {
        private const val PANEL_ID = "navigation"
        private const val STEPS_PER_PAGE = 12
        private const val HEARTBEAT_MS = 1_000L
        private val ACCESS_COLOR = Color.rgb(255, 180, 119)
        private val WARNING = Color.rgb(255, 164, 118)
    }
}

/** Guidance geometry built only from the planner's routed road legs, never its straight access hints. */
internal object NativeNavigationRoad {
    fun toGuidanceJson(planned: NativePlannedRoute, fix: NativeFix, target: Pair<Double, Double>): JSONObject {
        require(planned.roadLegs.size == 1) { "接入路线分段无效，请重试" }
        val leg = planned.roadLegs.single()
        require(leg.size >= 2) { "附近没有可通行道路，请稍后重试" }
        val roadStart = leg.first().longitude to leg.first().latitude
        val roadEnd = leg.last().longitude to leg.last().latitude
        val startGap = distanceMeters(fix.longitude to fix.latitude, roadStart)
        val endGap = distanceMeters(target, roadEnd)
        require(startGap <= maxOf(20.0, minOf(35.0, fix.accuracy))) { "当前位置离可通行道路过远，未生成直线接入" }
        require(endGap <= 20.0) { "原路线目标点离可通行道路过远，无法安全接入" }
        val roadSteps = planned.steps.filter { it.kind != "access" }
        val coordinates = JSONArray().also { out -> leg.forEach { out.put(it.toJson()) } }
        val snapped = JSONArray().put(leg.first().toJson()).put(leg.last().toJson())
        val distance = roadSteps.sumOf { it.distance }
        return JSONObject()
            .put("mode", planned.mode)
            .put("coordinates", coordinates)
            .put("distance", distance)
            .put("steps", JSONArray().also { out -> roadSteps.forEach { out.put(it.toJson()) } })
            .put("snapped", snapped)
    }

    private fun distanceMeters(a: Pair<Double, Double>, b: Pair<Double, Double>): Double {
        val rad = Math.PI / 180.0
        val dLat = (b.second - a.second) * rad
        val dLon = (b.first - a.first) * rad
        val h = sin(dLat / 2) * sin(dLat / 2) + cos(a.second * rad) * cos(b.second * rad) * sin(dLon / 2) * sin(dLon / 2)
        return 6_371_000.0 * 2 * asin(sqrt(h.coerceIn(0.0, 1.0)))
    }
}
