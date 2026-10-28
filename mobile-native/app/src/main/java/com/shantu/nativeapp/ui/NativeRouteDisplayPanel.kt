package com.shantu.nativeapp.ui

import android.content.Context
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.Switch
import com.shantu.nativeapp.navigation.NativeRouteColorMode
import com.shantu.nativeapp.navigation.NativeRouteDisplay
import com.shantu.nativeapp.navigation.NativeRouteDisplayData
import org.json.JSONObject

/** Native route display controls; map rendering is delegated as immutable colored edge fragments. */
class NativeRouteDisplayPanel(
    private val context: Context,
    private val chrome: HomeChrome,
    private val onDisplay: (NativeRouteDisplayData) -> Unit,
    private val onClose: () -> Unit = {},
    settings: JSONObject = defaults(),
    private val onSettingsChanged: (JSONObject) -> Unit = {},
) {
    private var route: JSONObject? = null
    private var mode = NativeRouteColorMode.SOLID
    private var chart: NativeRouteChartView? = null
    private var settings = normalize(settings)

    fun show(route: JSONObject, initialMode: NativeRouteColorMode = mode) {
        this.route = JSONObject(route.toString()); mode = initialMode
        val storedMode=when(settings.optString("mode","original")) { "elevation"->NativeRouteColorMode.ELEVATION; "speed"->NativeRouteColorMode.SPEED; "slope"->NativeRouteColorMode.SLOPE; else->NativeRouteColorMode.SOLID }
        mode=initialMode.takeIf { it != NativeRouteColorMode.SOLID } ?: storedMode
        val data = NativeRouteDisplay.build(route, mode)
        onDisplay(data)
        chart = null
        chrome.setRouteDisplayInfo(createInfoView(data), isPureSpeedLegend())
        chrome.showPanel(PANEL_ID, "路线显示", topAligned = true, width = 300, onClose = onClose) {
            val modes = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
            listOf(NativeRouteColorMode.SOLID to "原色", NativeRouteColorMode.ELEVATION to "海拔", NativeRouteColorMode.SPEED to "速度", NativeRouteColorMode.SLOPE to "坡度").forEach { (value, title) ->
                modes.addView(chrome.row(title) { select(value) }.apply {
                    gravity = Gravity.CENTER
                    if (value == mode) setTextColor(ShantuColors.accent)
                }, LinearLayout.LayoutParams(0, chrome.dp(30), 1f).apply { rightMargin = chrome.dp(3) })
            }
            addView(modes)
            addView(toggle("显示图例", "legend"))
            addView(toggle("统计信息", "statistics"))
            addView(toggle("高程剖面", "profile"))
            addView(toggle("陡坡提示", "steep"))
            addView(toggle("坐标信息", "coordinates"))
            addView(chrome.row("返回路线") { onClose(); chrome.closePanel() })
        }
    }

    private fun toggle(title:String,key:String)=Switch(context).apply {
        text=title; isChecked=settings.optBoolean(key)
        setOnCheckedChangeListener { _, checked ->
            settings.put(key,checked); onSettingsChanged(JSONObject(settings.toString()))
            route?.let { show(it,mode) }
        }
    }

    private fun normalize(input:JSONObject):JSONObject {
        val out=defaults()
        val m=input.opt("mode") as? String ?: "original"; out.put("mode",if(m in setOf("original","solid","elevation","speed","slope")) m else "original")
        listOf("legend","statistics","profile","steep","coordinates").forEach { key -> (input.opt(key) as? Boolean)?.let { out.put(key,it) } }
        return out
    }

    private fun isPureSpeedLegend() = settings.optBoolean("legend") && mode==NativeRouteColorMode.SPEED && listOf("statistics","profile","steep","coordinates").none { settings.optBoolean(it) }

    private fun createInfoView(data:NativeRouteDisplayData):LinearLayout? {
        val visible=(settings.optBoolean("legend") && mode!=NativeRouteColorMode.SOLID) || settings.optBoolean("statistics") || settings.optBoolean("profile") || settings.optBoolean("steep") || settings.optBoolean("coordinates")
        if(!visible) return null
        return LinearLayout(context).apply {
            orientation=LinearLayout.VERTICAL; setPadding(chrome.dp(6),chrome.dp(4),chrome.dp(6),chrome.dp(4))
            background=chrome.surface(4,ShantuColors.surface); elevation=chrome.dp(2).toFloat()
            val edges=data.segments.flatten(); val first=edges.firstOrNull()?.from; val last=edges.lastOrNull()?.to
            if(settings.optBoolean("statistics")) addView(chrome.text("距离 ${formatMeters(data.distanceMeters)} · 海拔 ${data.minimumElevation?.let { "%.0f".format(it) } ?: "—"}–${data.maximumElevation?.let { "%.0f".format(it) } ?: "—"} m · 最高速度 ${data.maximumSpeedKmh?.let { "%.1f km/h".format(it) } ?: "—"}",10))
            if(settings.optBoolean("steep")) addView(chrome.text("最大坡度 ${data.maximumAbsoluteSlopePercent?.let { "%.1f%%".format(it) } ?: "—"} · 陡坡标记 ${data.steepWarnings.size}处",10))
            if(settings.optBoolean("legend") && mode!=NativeRouteColorMode.SOLID) {
                val legend=LinearLayout(context).apply { orientation=LinearLayout.HORIZONTAL; gravity=Gravity.CENTER_VERTICAL }
                data.legend.forEach { (name,color)->legend.addView(chrome.text("● $name",10).apply { setTextColor(color) },LinearLayout.LayoutParams(0,chrome.dp(24),1f)) }
                addView(legend)
            }
            if(settings.optBoolean("coordinates") && first!=null && last!=null) addView(chrome.text("起 %.5f, %.5f · 终 %.5f, %.5f".format(first.longitude,first.latitude,last.longitude,last.latitude),10))
            if(settings.optBoolean("profile")) {
                val profile=NativeRouteChartView(context)
                profile.data=data
                chart=profile
                addView(profile,LinearLayout.LayoutParams(-1,chrome.dp(118)))
                addView(chrome.text("捏合缩放 · 缺值与断段保持断开",10).apply { setTextColor(ShantuColors.muted) })
            }
        }
    }

    private fun select(value: NativeRouteColorMode) {
        mode = value
        settings.put("mode", when(value) { NativeRouteColorMode.ELEVATION->"elevation"; NativeRouteColorMode.SPEED->"speed"; NativeRouteColorMode.SLOPE->"slope"; NativeRouteColorMode.SOLID->"original" })
        onSettingsChanged(JSONObject(settings.toString()))
        val source = route ?: return
        val data = NativeRouteDisplay.build(source, value)
        onDisplay(data)
        show(source, value)
    }

    /** Controller can call this pure adapter without owning the panel lifecycle. */
    fun displayFragment(route: JSONObject, mode: NativeRouteColorMode = this.mode): NativeRouteDisplayData = NativeRouteDisplay.build(route, mode)
    fun currentSettings()=JSONObject(settings.toString())

    private fun formatMeters(meters: Double): String = if (meters >= 1000) "%.1f km".format(meters / 1000) else "${meters.toInt()} m"
    companion object {
        const val PANEL_ID = "route-display"
        const val SETTINGS_KEY = "shantu.route-display.v1"
        fun defaults()=JSONObject().put("mode","original").put("legend",true).put("statistics",false).put("profile",false).put("steep",false).put("coordinates",false)
    }
}
