package com.shantu.nativeapp.ui

import android.content.Context
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.Toast
import com.shantu.nativeapp.recording.RecordingFacade
import org.json.JSONObject

internal class NativeSamplingPanel(private val context: Context,private val chrome:HomeChrome,private val onBack:()->Unit) {
    fun show(draft:JSONObject=RecordingFacade.sampling(context)) {
        chrome.showPanel("record-settings","记录模式") {
            val modes=listOf("power" to "省电","standard" to "标准","accuracy" to "高频","custom" to "自定义")
            val tabs=LinearLayout(context)
            modes.forEach { (key,label) -> tabs.addView(chrome.textButton(label) {
                val next=JSONObject(draft.toString()).put("mode",key)
                val preset=when(key) { "power" -> intArrayOf(10,10,60); "accuracy" -> intArrayOf(1,2,10); else -> intArrayOf(4,5,30) }
                if(key!="custom") next.put("intervalSeconds",preset[0]).put("distanceMetres",preset[1]).put("stationarySeconds",preset[2]).put("adaptive",key=="power")
                show(next)
            }.apply { if(key==draft.optString("mode")) setTextColor(ShantuColors.accent) },LinearLayout.LayoutParams(0,chrome.dp(32),1f)) }
            addView(tabs)
            val inputs=linkedMapOf<String,android.widget.EditText>()
            for((key,label) in listOf("intervalSeconds" to "间隔（1—30秒）","distanceMetres" to "距离（1—100米）","stationarySeconds" to "原地补点间隔（10—90秒）")) {
                addView(chrome.text(label,11))
                addView(chrome.input(label).apply { inputType=2; setText(draft.getInt(key).toString()); isEnabled=draft.optString("mode")=="custom"; inputs[key]=this })
            }
            val checks=linkedMapOf<String,CheckBox>()
            for((key,label) in listOf("distanceOnly" to "按距离记点，原地不补点","adaptive" to "静止60秒后降频，移动后恢复","recordOnNavigation" to "开始导航时自动开始新记录")) {
                addView(CheckBox(context).apply { text=label; textSize=12f; setTextColor(ShantuColors.ink); isChecked=draft.getBoolean(key); checks[key]=this })
            }
            addView(chrome.row("应用记录模式") {
                val next=JSONObject(draft.toString())
                inputs.forEach { (key,input) -> next.put(key,input.text.toString().toIntOrNull() ?: -1) }
                checks.forEach { (key,check) -> next.put(key,check.isChecked) }
                if(RecordingFacade.saveSampling(context,next)) { Toast.makeText(context,"记录模式已保存",Toast.LENGTH_SHORT).show(); onBack() }
                else Toast.makeText(context,"参数无效或保存失败；原地间隔不能小于采样间隔",Toast.LENGTH_LONG).show()
            })
            addView(chrome.text("高频定位更耗电。自动开始仅在没有待处理记录时生效。",11))
            addView(chrome.row("返回记录") { onBack() })
        }
    }
}
