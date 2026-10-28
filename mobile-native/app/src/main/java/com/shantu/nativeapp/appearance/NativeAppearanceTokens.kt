package com.shantu.nativeapp.appearance

import android.graphics.Color
import org.json.JSONObject
import kotlin.math.pow
import kotlin.math.roundToInt

/** Android color equivalents of modules/appearance/theme.ts. */
data class NativeAppearanceTokens(
    val surface: Int,
    val ink: Int,
    val accent: Int,
    val close: Int,
    val active: Int,
    val activeInk: Int,
    val button: Int,
    val buttonInk: Int,
    val raised: Int,
    val field: Int,
    val selected: Int,
    val danger: Int,
    val line: Int,
    val muted: Int,
    val onAccent: Int,
    val glassSurface: Int,
    val glassAlpha: Float = 0.64f,
    val glassBlurDp: Int = 18,
    val glassSaturation: Int = 110,
    val glassShadow: String = "0 10px 28px rgba(0, 0, 0, 0.18)",
) {
    fun asHexMap(): Map<String, String> = linkedMapOf(
        "--ui-surface" to hex(surface), "--ui-ink" to hex(ink), "--ui-accent" to hex(accent),
        "--ui-close" to hex(close), "--ui-active" to hex(active), "--ui-active-ink" to hex(activeInk),
        "--ui-button" to hex(button), "--ui-button-ink" to hex(buttonInk), "--ui-raised" to hex(raised),
        "--ui-field" to hex(field), "--ui-selected" to hex(selected), "--ui-danger" to hex(danger),
        "--ui-line" to hex(line), "--ui-muted" to hex(muted), "--ui-on-accent" to hex(onAccent),
    )

    companion object {
        const val THEME_KEY = "shantu.appearance.v1"
        private const val NAVY = "#10243c"
        private const val WHITE = "#ffffff"

        private data class PaletteDefaults(
            val accent: String,
            val background: String,
            val button: String,
            val foreground: String,
            val contrast: Int,
        )

        private val DARK_DEFAULT = PaletteDefaults("#d0f76b", "#18201f", "#252e2b", "#f2f5ed", 40)
        private val LIGHT_DEFAULT = PaletteDefaults("#15572b", "#ffffff", "#eef3f0", "#10243c", 40)

        fun defaultAppearance(): JSONObject = JSONObject()
            .put("mode", "dark")
            .put("light", paletteJson(LIGHT_DEFAULT))
            .put("dark", paletteJson(DARK_DEFAULT))

        /** Normalize known fields while retaining unknown fields on valid roots and palettes. */
        fun normalize(raw: JSONObject?): JSONObject {
            val defaults = defaultAppearance()
            if (raw == null) return defaults
            val result = deepCopy(raw)
            if (result.optString("mode") !in setOf("light", "dark", "system")) result.put("mode", "dark")
            for ((scheme, fallback) in listOf("light" to LIGHT_DEFAULT, "dark" to DARK_DEFAULT)) {
                val existing = result.optJSONObject(scheme)
                val palette = if (existing == null) JSONObject() else deepCopy(existing)
                val d = defaults.getJSONObject(scheme)
                for (key in listOf("accent", "background", "button", "foreground")) {
                    if (!isHex(palette.optString(key))) palette.put(key, d.getString(key))
                }
                val contrast = palette.opt("contrast")
                val value = when (contrast) {
                    is Number -> contrast.toDouble()
                    else -> Double.NaN
                }
                if (!value.isFinite() || value !in 0.0..100.0) palette.put("contrast", fallback.contrast)
                result.put(scheme, palette)
            }
            return result
        }

        fun tokens(raw: JSONObject?, systemDark: Boolean): NativeAppearanceTokens {
            val appearance = normalize(raw)
            val isDark = when (appearance.optString("mode")) {
                "dark" -> true
                "light" -> false
                else -> systemDark
            }
            val palette = appearance.getJSONObject(if (isDark) "dark" else "light")
            val background = palette.getString("background")
            val foreground = palette.getString("foreground")
            val accent = palette.getString("accent")
            val button = palette.optString("button", if (isDark) DARK_DEFAULT.button else LIGHT_DEFAULT.button)
            val contrast = palette.getDouble("contrast")
            val safeInk = if (contrastRatio(background, NAVY) > contrastRatio(background, WHITE)) NAVY else WHITE
            val ink = if (contrastRatio(background, foreground) >= 4.5) foreground else safeInk
            val buttonInk = if (contrastRatio(button, foreground) >= 4.5) foreground
                else if (contrastRatio(button, NAVY) > contrastRatio(button, WHITE)) NAVY else WHITE
            val active = mix(button, accent, 0.16)
            val activeInk = if (contrastRatio(active, accent) >= 4.5) accent else buttonInk
            val close = if (luminance(background) < .2) "#c7b86d" else "#766100"
            val muted = mix(ink, background, .25)
            val line = mix(background, ink, .06 + contrast / 1000.0)
            val onAccent = if (contrastRatio(accent, WHITE) >= contrastRatio(accent, NAVY)) WHITE else NAVY
            return NativeAppearanceTokens(
                surface = color(background), ink = color(ink), accent = color(accent), close = color(close),
                active = color(active), activeInk = color(activeInk), button = color(button), buttonInk = color(buttonInk),
                raised = color(button), field = color(mix(button, ink, .055)), selected = color(mix(background, accent, .11)),
                danger = color(if (luminance(background) < .2) "#ff9b8f" else "#a33626"),
                line = color(line), muted = color(muted), onAccent = color(onAccent),
                glassSurface = Color.argb(
                    (.64 * 255).roundToInt(),
                    Color.red(color(background)),
                    Color.green(color(background)),
                    Color.blue(color(background)),
                ),
            )
        }

        fun resolvedScheme(raw: JSONObject?, systemDark: Boolean): String {
            val mode = normalize(raw).optString("mode")
            return if (mode == "dark" || (mode == "system" && systemDark)) "dark" else "light"
        }

        fun applyPreset(raw: JSONObject?, presetName: String): JSONObject {
            val result = normalize(raw)
            val preset = preset(presetName) ?: return result
            result.put("light", mergeKnownPalette(result.getJSONObject("light"), preset.first))
            result.put("dark", mergeKnownPalette(result.getJSONObject("dark"), preset.second))
            return result
        }

        fun resetKnownDefaults(raw: JSONObject?): JSONObject {
            val result = normalize(raw)
            val defaults = defaultAppearance()
            result.put("mode", defaults.getString("mode"))
            result.put("light", mergeKnownPalette(result.getJSONObject("light"), defaults.getJSONObject("light")))
            result.put("dark", mergeKnownPalette(result.getJSONObject("dark"), defaults.getJSONObject("dark")))
            return result
        }

        fun updateMode(raw: JSONObject?, mode: String): JSONObject = normalize(raw).apply {
            require(mode in setOf("light", "dark", "system"))
            put("mode", mode)
        }

        fun updatePalette(raw: JSONObject?, scheme: String, key: String, value: Any): JSONObject {
            require(scheme == "light" || scheme == "dark")
            require(key in setOf("accent", "background", "button", "foreground", "contrast"))
            val result = normalize(raw)
            if (key == "contrast") {
                val number = (value as? Number)?.toDouble() ?: error("contrast must be numeric")
                require(number.isFinite() && number in 0.0..100.0)
                result.getJSONObject(scheme).put(key, number)
            } else {
                val hex = value as? String ?: error("palette colors must be strings")
                require(isHex(hex))
                result.getJSONObject(scheme).put(key, hex.lowercase())
            }
            return result
        }

        fun isHex(value: String): Boolean = HEX.matches(value)

        fun contrastRatio(a: String, b: String): Double {
            val x = luminance(a); val y = luminance(b)
            return (maxOf(x, y) + .05) / (minOf(x, y) + .05)
        }

        fun mix(a: String, b: String, amount: Double): String {
            val left = channels(a); val right = channels(b)
            return "#" + left.indices.joinToString("") { i ->
                (left[i] * (1 - amount) + right[i] * amount).roundToInt().coerceIn(0, 255).toString(16).padStart(2, '0')
            }
        }

        private val HEX = Regex("^#[0-9a-fA-F]{6}$")
        private fun paletteJson(value: PaletteDefaults) = JSONObject()
            .put("accent", value.accent).put("background", value.background).put("button", value.button)
            .put("foreground", value.foreground).put("contrast", value.contrast)

        private fun preset(name: String): Pair<JSONObject, JSONObject>? = when (name) {
            "山兔默认" -> LIGHT_DEFAULT to DARK_DEFAULT
            "湖蓝" -> PaletteDefaults("#176ba0", "#f5faff", "#e3edf7", "#18364a", 40) to
                PaletteDefaults("#7cc7ff", "#142431", "#2c4053", "#eaf5ff", 50)
            "暖沙" -> PaletteDefaults("#875820", "#fff9ef", "#f0e6d7", "#3c3022", 40) to
                PaletteDefaults("#edc28a", "#292219", "#493b2c", "#fff4e1", 50)
            else -> null
        }?.let { (light, dark) -> paletteJson(light) to paletteJson(dark) }

        private fun mergeKnownPalette(existing: JSONObject, values: JSONObject): JSONObject = deepCopy(existing).apply {
            for (key in listOf("accent", "background", "button", "foreground", "contrast")) put(key, values.get(key))
        }

        private fun deepCopy(value: JSONObject) = JSONObject(value.toString())
        private fun color(hex: String) = Color.parseColor(hex)
        private fun hex(color: Int) = "#%02x%02x%02x".format(Color.red(color), Color.green(color), Color.blue(color))
        private fun channels(hex: String) = intArrayOf(1, 3, 5).map { hex.substring(it, it + 2).toInt(16) }
        private fun luminance(hex: String): Double = channels(hex).map { it / 255.0 }
            .map { if (it <= .04045) it / 12.92 else ((it + .055) / 1.055).pow(2.4) }
            .zip(listOf(.2126, .7152, .0722)).sumOf { (channel, weight) -> channel * weight }
    }
}
