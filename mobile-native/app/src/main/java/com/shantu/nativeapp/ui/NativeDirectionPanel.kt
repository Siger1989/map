package com.shantu.nativeapp.ui

import android.content.Context
import android.widget.LinearLayout
import android.widget.TextView
import com.shantu.nativeapp.map.NativeDirectionMode

/** Small reusable direction selector; host owns compass sensor lifecycle and camera following. */
class NativeDirectionPanel(private val chrome: HomeChrome, initial: NativeDirectionMode = NativeDirectionMode.FREE, private val onModeChanged: (NativeDirectionMode) -> Unit) : LinearLayout(chrome.context) {
    private val modes = listOf(NativeDirectionMode.FREE to "自由", NativeDirectionMode.NORTH to "正北", NativeDirectionMode.DEVICE to "手机朝上", NativeDirectionMode.MOTION to "运动朝上")
    private val buttons = mutableMapOf<NativeDirectionMode, TextView>()
    var mode: NativeDirectionMode = initial
        private set
    var directionStatus: String = ""
        set(value) { field = value; refresh() }

    init {
        orientation = HORIZONTAL
        gravity = android.view.Gravity.CENTER_VERTICAL
        modes.forEach { (value, label) ->
            val button = chrome.row(label) { mode = value; refresh(); onModeChanged(value) }
            button.gravity = android.view.Gravity.CENTER
            button.layoutParams = LayoutParams(0, chrome.dp(28), 1f)
            buttons[value] = button
            addView(button)
        }
        refresh()
    }

    private fun refresh() {
        buttons.forEach { (value, view) ->
            chrome.bindThemeText(view, if (value == mode) com.shantu.nativeapp.ui.NativeThemeRole.ACCENT else com.shantu.nativeapp.ui.NativeThemeRole.MUTED)
            view.contentDescription = if (value == mode && directionStatus.isNotBlank()) "$directionStatus；${view.text}" else view.text
        }
    }
}
