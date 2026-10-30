package com.shantu.nativeapp.hybrid

import android.graphics.Color as AndroidColor
import org.json.JSONArray

/** Converts CSS/MapLibre overlay paint values to the physical-pixel styles WorldWind consumes. */
internal object NativeOverlayStyle {
    data class Dash(val factor: Int, val pattern: Short)

    fun widthInPixels(cssWidth: Double, cssScale: Double): Float {
        val width = cssWidth.takeIf { it.isFinite() }?.coerceIn(0.1, 40.0) ?: 2.0
        val scale = cssScale.takeIf { it.isFinite() }?.coerceIn(0.1, 10.0) ?: 1.0
        return (width * scale).toFloat()
    }

    fun color(cssColor: String, opacity: Double): earth.worldwind.render.Color {
        val rgba = parseCssColor(cssColor)
        val safeOpacity = opacity.takeIf { it.isFinite() }?.coerceIn(0.0, 1.0) ?: 1.0
        val alpha = (rgba[3] * safeOpacity).toFloat()
        return earth.worldwind.render.Color(rgba[0].toFloat(), rgba[1].toFloat(), rgba[2].toFloat(), alpha)
    }

    /** A 16-bit repeating stipple approximating MapLibre's dash lengths while retaining their ratio. */
    fun dashStyle(dash: JSONArray, cssWidth: Double, density: Double): Dash? {
        if (dash.length() == 0) return null
        val values = (0 until dash.length()).map { dash.optDouble(it, Double.NaN) }
        if (values.any { !it.isFinite() || it <= 0.0 }) return null
        val total = values.sum()
        if (!total.isFinite() || total <= 0.0) return null
        var bits = 0
        for (bit in 0 until 16) {
            val phase = ((bit + 0.5) / 16.0 * total) % total
            var cursor = 0.0
            var run = 0
            while (run < values.lastIndex && phase >= cursor + values[run]) {
                cursor += values[run++]
            }
            if (run % 2 == 0) bits = bits or (1 shl (15 - bit))
        }
        val pattern = bits.toShort().takeIf { it != 0.toShort() && it != (-1).toShort() } ?: return null
        val safeWidth = cssWidth.takeIf { it.isFinite() }?.coerceIn(0.1, 40.0) ?: 2.0
        val safeScale = density.takeIf { it.isFinite() }?.coerceIn(0.1, 10.0) ?: 1.0
        val factor = (total * safeWidth * safeScale / 16.0)
            .toInt().coerceIn(1, 255)
        return Dash(factor, pattern)
    }

    private fun parseCssColor(input: String): FloatArray {
        val text = input.trim()
        val fn = Regex("^rgba?\\(\\s*([^)]*)\\)$", RegexOption.IGNORE_CASE).matchEntire(text)
        if (fn != null) {
            val parsed = runCatching {
                val parts = fn.groupValues[1].trim().split(Regex("\\s*,\\s*|\\s+\\/\\s+|\\s+"))
                require(parts.size in 3..4)
                fun channel(value: String): Double {
                    val n = value.removeSuffix("%").toDouble().also { require(it.isFinite()) }
                    return (if (value.endsWith('%')) n / 100.0 else n / 255.0).coerceIn(0.0, 1.0)
                }
                val alpha = parts.getOrNull(3)?.let {
                    val n = it.removeSuffix("%").toDouble().also { number -> require(number.isFinite()) }
                    (if (it.endsWith('%')) n / 100.0 else n).coerceIn(0.0, 1.0)
                } ?: 1.0
                floatArrayOf(channel(parts[0]).toFloat(), channel(parts[1]).toFloat(), channel(parts[2]).toFloat(), alpha.toFloat())
            }.getOrNull()
            if (parsed != null) return parsed
        }
        val value = runCatching {
            when {
                text.matches(Regex("^#[0-9a-fA-F]{3}$")) -> {
                    val rgb = text.drop(1).map { "$it$it" }.joinToString("").toLong(16).toInt()
                    AndroidColor.rgb(AndroidColor.red(rgb), AndroidColor.green(rgb), AndroidColor.blue(rgb))
                }
                text.matches(Regex("^#[0-9a-fA-F]{4}$")) -> {
                    val expanded = text.drop(1).map { "$it$it" }
                    val rgb = expanded.take(3).joinToString("").toLong(16).toInt()
                    val alpha = expanded[3].toInt(16)
                    AndroidColor.argb(alpha, AndroidColor.red(rgb), AndroidColor.green(rgb), AndroidColor.blue(rgb))
                }
                text.matches(Regex("^#[0-9a-fA-F]{8}$")) -> {
                    val rgb = text.substring(1, 7).toLong(16).toInt()
                    val alpha = text.substring(7, 9).toInt(16)
                    AndroidColor.argb(alpha, AndroidColor.red(rgb), AndroidColor.green(rgb), AndroidColor.blue(rgb))
                }
                else -> AndroidColor.parseColor(text)
            }
        }.getOrDefault(AndroidColor.rgb(208, 247, 107))
        return floatArrayOf(AndroidColor.red(value) / 255f, AndroidColor.green(value) / 255f,
            AndroidColor.blue(value) / 255f, AndroidColor.alpha(value) / 255f)
    }
}
