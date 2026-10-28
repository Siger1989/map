package com.shantu.nativeapp.ui

import android.app.AlertDialog
import android.content.Context
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Typeface
import android.text.Editable
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.widget.ArrayAdapter
import android.widget.EditText
import android.widget.GridLayout
import android.widget.LinearLayout
import android.widget.SeekBar
import android.widget.Spinner
import android.widget.TextView
import com.shantu.nativeapp.appearance.NativeAppearanceTokens
import org.json.JSONObject

/** Native counterpart to AppearanceSettings. Changes preview immediately and are committed explicitly. */
class NativeAppearancePanel(
    private val context: Context,
    private val chrome: HomeChrome,
    initial: JSONObject,
    private val onPreview: (JSONObject, NativeAppearanceTokens) -> Unit,
    private val onSave: (JSONObject, NativeAppearanceTokens) -> Unit,
    private val systemDark: Boolean =
        (context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES,
) {
    private val original = copy(initial)
    private var value = copy(initial)
    private var committed = false
    private var previewRestored = false
    private var previewSwatch: TextView? = null
    private var previewText: TextView? = null
    private var contrastLabel: TextView? = null
    private var contrastBar: SeekBar? = null
    private var colorInputs = linkedMapOf<String, EditText>()
    private var colorSwatches = linkedMapOf<String, TextView>()
    private var status: TextView? = null

    fun show() {
        committed = false
        previewRestored = false
        onPreview(copy(value), NativeAppearanceTokens.tokens(value, systemDark))
        chrome.showPanelWithSlots(
            id = "appearance",
            title = "个性化",
            topAligned = true,
            width = 300,
            maxHeightDp = 200,
            fixedHeader = {
                gravity = Gravity.CENTER_VERTICAL
                addView(chrome.textButton("‹ 返回", 12) { cancel() }.apply {
                    gravity = Gravity.CENTER_VERTICAL or Gravity.START
                    setPadding(chrome.dp(4), 0, chrome.dp(4), 0)
                }, LinearLayout.LayoutParams(chrome.dp(56), chrome.dp(36)))
                addView(chrome.text("个性化", 14).apply {
                    setTypeface(null, Typeface.BOLD)
                    gravity = Gravity.CENTER_VERTICAL or Gravity.START
                    setPadding(chrome.dp(6), 0, chrome.dp(6), 0)
                }, LinearLayout.LayoutParams(0, chrome.dp(36), 1f))
                addView(chrome.textButton("×", 18) { cancel() }.apply {
                    chrome.bindThemeText(this, NativeThemeRole.CLOSE)
                    contentDescription = "关闭"
                }, LinearLayout.LayoutParams(chrome.dp(36), chrome.dp(36)))
            },
            fixedFooter = {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.END or Gravity.CENTER_VERTICAL
                addView(chrome.textButton("恢复默认", 12) { reset() }.apply {
                    background = chrome.surface(HomeChromeMetrics.CONTROL_RADIUS_DP, ShantuColors.raised)
                    setPadding(chrome.dp(8), 0, chrome.dp(8), 0)
                    chrome.bindThemeBackground(this, NativeThemeRole.RAISED, HomeChromeMetrics.CONTROL_RADIUS_DP)
                }, LinearLayout.LayoutParams(-2, chrome.dp(32)).apply { rightMargin = chrome.dp(4) })
                addView(chrome.textButton("取消", 12) { cancel() }.apply {
                    background = chrome.surface(HomeChromeMetrics.CONTROL_RADIUS_DP, ShantuColors.raised)
                    setPadding(chrome.dp(8), 0, chrome.dp(8), 0)
                    chrome.bindThemeBackground(this, NativeThemeRole.RAISED, HomeChromeMetrics.CONTROL_RADIUS_DP)
                }, LinearLayout.LayoutParams(-2, chrome.dp(32)).apply { rightMargin = chrome.dp(4) })
                addView(chrome.textButton("保存", 12) { save() }.apply {
                    background = chrome.surface(HomeChromeMetrics.CONTROL_RADIUS_DP, ShantuColors.accent)
                    chrome.bindThemeBackground(this, NativeThemeRole.ACCENT, HomeChromeMetrics.CONTROL_RADIUS_DP)
                    chrome.bindThemeText(this, NativeThemeRole.ON_ACCENT)
                    setPadding(chrome.dp(10), 0, chrome.dp(10), 0)
                }, LinearLayout.LayoutParams(-2, chrome.dp(32)))
            },
            content = { buildBody(this) },
        )
    }

    private fun buildBody(target: LinearLayout) {
        target.addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
            override fun onViewAttachedToWindow(view: View) = Unit
            override fun onViewDetachedFromWindow(view: View) {
                restorePreviewIfNeeded()
            }
        })
        target.orientation = LinearLayout.VERTICAL
        target.addView(label("外观"))
        val mode = Spinner(context).apply {
            adapter = ArrayAdapter(context, android.R.layout.simple_spinner_item, listOf("浅色", "深色", "跟随系统")).also {
                it.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
            }
            val modes = listOf("light", "dark", "system")
            setSelection(modes.indexOf(NativeAppearanceTokens.normalize(value).optString("mode")).coerceAtLeast(0))
            layoutParams = rowParams()
            onItemSelectedListener = object : android.widget.AdapterView.OnItemSelectedListener {
                override fun onNothingSelected(parent: android.widget.AdapterView<*>?) = Unit
                override fun onItemSelected(parent: android.widget.AdapterView<*>?, view: View?, position: Int, id: Long) {
                    val selected = modes[position]
                    if (NativeAppearanceTokens.normalize(value).optString("mode") != selected) {
                        value = NativeAppearanceTokens.updateMode(value, selected)
                        refresh()
                    }
                }
            }
        }
        target.addView(mode, LinearLayout.LayoutParams(-1, chrome.dp(36)))

        target.addView(label("配色风格"))
        val presets = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        listOf("山兔默认", "湖蓝", "暖沙").forEach { name ->
            presets.addView(chrome.row(name) {
                value = NativeAppearanceTokens.applyPreset(value, name)
                refresh()
            }.apply {
                gravity = Gravity.CENTER
                setPadding(chrome.dp(2), 0, chrome.dp(2), 0)
            }, LinearLayout.LayoutParams(0, chrome.dp(28), 1f).apply { marginEnd = chrome.dp(4) })
        }
        target.addView(presets, LinearLayout.LayoutParams(-1, chrome.dp(28)))

        val preview = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            background = chrome.surface(HomeChromeMetrics.CONTROL_RADIUS_DP, ShantuColors.raised)
            chrome.bindThemeBackground(this, NativeThemeRole.RAISED, HomeChromeMetrics.CONTROL_RADIUS_DP)
            setPadding(chrome.dp(6), 0, chrome.dp(6), 0)
        }
        previewText = chrome.text("深色预览 · 窗口文字", 11).also {
            preview.addView(it, LinearLayout.LayoutParams(0, chrome.dp(32), 1f))
        }
        previewSwatch = chrome.text("选中按钮", 11).apply {
            gravity = Gravity.CENTER
            setPadding(chrome.dp(6), 0, chrome.dp(6), 0)
            chrome.bindThemeBackground(this, NativeThemeRole.ACTIVE, HomeChromeMetrics.CONTROL_RADIUS_DP)
            chrome.bindThemeText(this, NativeThemeRole.ACTIVE_INK)
            preview.addView(this, LinearLayout.LayoutParams(-2, chrome.dp(28)))
        }
        target.addView(preview, LinearLayout.LayoutParams(-1, chrome.dp(36)).apply { topMargin = chrome.dp(4) })

        colorInputs.clear()
        colorSwatches.clear()
        listOf("accent" to "主色", "background" to "窗口背景", "button" to "按钮底色", "foreground" to "文字").forEach { (key, title) ->
            val row = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
            row.addView(chrome.text(title, 11).apply { gravity = Gravity.CENTER_VERTICAL or Gravity.START },
                LinearLayout.LayoutParams(chrome.dp(64), chrome.dp(36)))
            val swatch = chrome.text("色", 12).apply {
                gravity = Gravity.CENTER
                contentDescription = "${title}选择器"
                setOnClickListener { showColorPicker(key, title) }
            }
            row.addView(swatch, LinearLayout.LayoutParams(chrome.dp(36), chrome.dp(32)).apply { rightMargin = chrome.dp(4) })
            colorSwatches[key] = swatch
            val input = chrome.input("#RRGGBB").apply {
                setSingleLine(true)
                filters = arrayOf(android.text.InputFilter.LengthFilter(7))
                setTypeface(android.graphics.Typeface.MONOSPACE)
            }
            colorInputs[key] = input
            input.addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                    val raw = s?.toString().orEmpty()
                    input.error = if (NativeAppearanceTokens.isHex(raw)) null else "请输入 #RRGGBB"
                    if (NativeAppearanceTokens.isHex(raw)) {
                        value = NativeAppearanceTokens.updatePalette(value, activeScheme(), key, raw)
                        emitPreview()
                    }
                }
                override fun afterTextChanged(s: Editable?) = Unit
            })
            row.addView(input, LinearLayout.LayoutParams(0, chrome.dp(36), 1f))
            target.addView(row, LinearLayout.LayoutParams(-1, chrome.dp(36)).apply { topMargin = chrome.dp(2) })
        }

        val contrast = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        contrastLabel = chrome.text("对比度 40", 11).apply { gravity = Gravity.CENTER_VERTICAL or Gravity.START }
        contrast.addView(contrastLabel, LinearLayout.LayoutParams(chrome.dp(78), chrome.dp(36)))
        contrastBar = SeekBar(context).apply {
            max = 100
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
                    contrastLabel?.text = "对比度 $progress"
                    if (fromUser) {
                        value = NativeAppearanceTokens.updatePalette(value, activeScheme(), "contrast", progress)
                        emitPreview()
                    }
                }
                override fun onStartTrackingTouch(seekBar: SeekBar?) = Unit
                override fun onStopTrackingTouch(seekBar: SeekBar?) = Unit
            })
        }
        contrast.addView(contrastBar, LinearLayout.LayoutParams(0, chrome.dp(36), 1f))
        target.addView(contrast, LinearLayout.LayoutParams(-1, chrome.dp(36)).apply { topMargin = chrome.dp(2) })
        status = chrome.text("调整立即预览并保存，可随时恢复山兔默认。", 10).apply {
            chrome.bindThemeText(this, NativeThemeRole.MUTED)
        }
        target.addView(status, LinearLayout.LayoutParams(-1, -2).apply { topMargin = chrome.dp(2) })
        refresh()
    }

    private fun label(text: String) = chrome.text(text, 11).apply {
        chrome.bindThemeText(this, NativeThemeRole.MUTED)
        layoutParams = LinearLayout.LayoutParams(-1, chrome.dp(24)).apply { topMargin = chrome.dp(3) }
    }

    private fun rowParams() = LinearLayout.LayoutParams(-1, chrome.dp(36)).apply { topMargin = chrome.dp(2) }

    private fun activeScheme() = NativeAppearanceTokens.resolvedScheme(value, systemDark)

    private fun refresh() {
        val normalized = NativeAppearanceTokens.normalize(value)
        val scheme = activeScheme()
        val palette = normalized.getJSONObject(scheme)
        for ((key, input) in colorInputs) {
            val next = palette.getString(key)
            if (input.text.toString() != next) input.setText(next)
            colorSwatches[key]?.apply {
                setBackground(chrome.surface(HomeChromeMetrics.CONTROL_RADIUS_DP, Color.parseColor(next)))
                setTextColor(if (NativeAppearanceTokens.contrastRatio(next, "#ffffff") > NativeAppearanceTokens.contrastRatio(next, "#10243c")) Color.WHITE else Color.rgb(16, 36, 60))
            }
        }
        val contrast = palette.getDouble("contrast").toInt().coerceIn(0, 100)
        contrastLabel?.text = "对比度 $contrast"
        if (contrastBar?.progress != contrast) contrastBar?.progress = contrast
        val tokens = NativeAppearanceTokens.tokens(value, systemDark)
        previewText?.apply {
            text = "${if (scheme == "dark") "深色" else "浅色"}预览 · 窗口文字"
            setTextColor(tokens.ink)
        }
        previewSwatch?.apply {
            setBackgroundColor(tokens.active)
            setTextColor(tokens.activeInk)
        }
        status?.text = if (NativeAppearanceTokens.contrastRatio(palette.getString("background"), palette.getString("foreground")) < 4.5) {
            "文字对比度不足，已自动使用清晰文字色。"
        } else "调整立即预览并保存，可随时恢复山兔默认。"
        emitPreview()
    }

    private fun emitPreview() {
        val tokens = NativeAppearanceTokens.tokens(value, systemDark)
        val palette = NativeAppearanceTokens.normalize(value).getJSONObject(activeScheme())
        previewText?.apply {
            text = "${if (activeScheme() == "dark") "深色" else "浅色"}预览 · 窗口文字"
            setTextColor(tokens.ink)
        }
        previewSwatch?.apply {
            setBackgroundColor(tokens.active)
            setTextColor(tokens.activeInk)
        }
        for ((key, swatch) in colorSwatches) {
            val hex = palette.getString(key)
            swatch.setBackground(chrome.surface(HomeChromeMetrics.CONTROL_RADIUS_DP, Color.parseColor(hex)))
            swatch.setTextColor(if (NativeAppearanceTokens.contrastRatio(hex, "#ffffff") > NativeAppearanceTokens.contrastRatio(hex, "#10243c")) Color.WHITE else Color.rgb(16, 36, 60))
        }
        status?.text = if (NativeAppearanceTokens.contrastRatio(palette.getString("background"), palette.getString("foreground")) < 4.5) {
            "文字对比度不足，已自动使用清晰文字色。"
        } else "调整立即预览并保存，可随时恢复山兔默认。"
        onPreview(copy(value), tokens)
    }

    private fun reset() {
        value = NativeAppearanceTokens.resetKnownDefaults(value)
        refresh()
        status?.text = "已恢复山兔默认，保存后生效。"
    }

    private fun save() {
        val next = NativeAppearanceTokens.normalize(value)
        runCatching { onSave(copy(next), NativeAppearanceTokens.tokens(next, systemDark)) }
            .onSuccess {
                committed = true
                chrome.closePanel()
            }
            .onFailure { error ->
                status?.text = "保存失败，当前预览和编辑内容已保留：${error.message ?: "请重试"}".take(180)
            }
    }

    private fun cancel() {
        restorePreviewIfNeeded()
        chrome.closePanel()
    }

    private fun restorePreviewIfNeeded() {
        if (committed || previewRestored) return
        previewRestored = true
        onPreview(copy(original), NativeAppearanceTokens.tokens(original, systemDark))
    }

    private fun showColorPicker(key: String, title: String) {
        val scheme = activeScheme()
        val selected = NativeAppearanceTokens.normalize(value).getJSONObject(scheme).getString(key)
        val palette = listOf(
            "#d0f76b", "#15572b", "#176ba0", "#7cc7ff", "#edc28a", "#875820",
            "#ff6b5f", "#e64a8b", "#8c6bd9", "#29a89a", "#ffffff", "#18201f",
        )
        val grid = GridLayout(context).apply {
            columnCount = 6
            setPadding(chrome.dp(8), chrome.dp(8), chrome.dp(8), chrome.dp(4))
        }
        var dialog: AlertDialog? = null
        palette.forEach { hex ->
            val chip = TextView(context).apply {
                text = if (hex.equals(selected, true)) "✓" else ""
                gravity = Gravity.CENTER
                textSize = 13f
                setTextColor(if (hex == "#ffffff" || hex == "#edc28a" || hex == "#d0f76b") Color.BLACK else Color.WHITE)
                setBackground(chrome.surface(4, Color.parseColor(hex)))
                setOnClickListener {
                    value = NativeAppearanceTokens.updatePalette(value, scheme, key, hex)
                    refresh()
                    dialog?.dismiss()
                }
            }
            grid.addView(chip, GridLayout.LayoutParams().apply {
                width = chrome.dp(38); height = chrome.dp(38); setMargins(chrome.dp(3), chrome.dp(3), chrome.dp(3), chrome.dp(3))
            })
        }
        val wrapper = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            addView(grid)
            addView(chrome.input("自定义色值 #RRGGBB").apply {
                setText(selected)
                filters = arrayOf(android.text.InputFilter.LengthFilter(7))
                setSingleLine(true)
            }, LinearLayout.LayoutParams(-1, chrome.dp(40)).apply {
                setMargins(chrome.dp(12), chrome.dp(4), chrome.dp(12), chrome.dp(8))
            })
        }
        val input = wrapper.getChildAt(1) as EditText
        val colorDialog = AlertDialog.Builder(context).setTitle("${title}颜色").setView(wrapper)
            .setNegativeButton("取消", null)
            .setPositiveButton("应用", null).create()
        dialog = colorDialog
        colorDialog.setOnShowListener {
            colorDialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val hex = input.text.toString()
                if (!NativeAppearanceTokens.isHex(hex)) input.error = "请输入 #RRGGBB"
                else {
                    value = NativeAppearanceTokens.updatePalette(value, scheme, key, hex)
                    refresh()
                    colorDialog.dismiss()
                }
            }
        }
        colorDialog.show()
    }

    private fun copy(value: JSONObject) = JSONObject(value.toString())
}
