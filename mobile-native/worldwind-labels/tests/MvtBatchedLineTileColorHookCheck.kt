package earth.worldwind.layer.mvt

import earth.worldwind.geom.Sector
import earth.worldwind.render.Color

/** Exercises the same packed-range-to-DrawShapeState.color path used immediately before drawElements. */
fun main() {
    val tile = MvtBatchedLineTile(emptyList(), Sector())
    val original = Color()
    tile.applyRangeColor(0x137B63CC, original)
    check(kotlin.math.abs(original.red - 0x13 / 255f) < 1e-6f &&
        kotlin.math.abs(original.green - 0x7B / 255f) < 1e-6f &&
        kotlin.math.abs(original.blue - 0x63 / 255f) < 1e-6f && original.alpha > 0.79f) {
        "A null transform changed the packed range color: $original"
    }
    tile.outlineColorTransform = { color ->
        fun linear(channel: Float): Double = if (channel <= 0.04045f) channel / 12.92
        else Math.pow(((channel + 0.055f) / 1.055f).toDouble(), 2.4)
        val luminance = 0.2126 * linear(color.red) + 0.7152 * linear(color.green) + 0.0722 * linear(color.blue)
        val whiteRatio = 1.05 / (luminance + 0.05)
        val blackRatio = (luminance + 0.05) / 0.05
        val selected = if (whiteRatio >= blackRatio) 1f else 0f
        color.set(selected, selected, selected, color.alpha)
    }

    // SDK line ranges pack RGBA, not Android ARGB. These are a dark green and bright yellow
    // representative of the contour palette. Test the actual output Color consumed as drawState.color.
    val emitted = Color()
    tile.applyRangeColor(0x137B63CC, emitted)
    check(emitted.red == 1f && emitted.green == 1f && emitted.blue == 1f && emitted.alpha > 0.79f) {
        "Dark range did not emit white with the original alpha: $emitted"
    }
    tile.applyRangeColor(0xFFE02ECC.toInt(), emitted)
    check(emitted.red == 0f && emitted.green == 0f && emitted.blue == 0f && emitted.alpha > 0.79f) {
        "Bright range did not emit black with the original alpha: $emitted"
    }
    println("range color hook: dark->white, bright->black, alpha preserved")
}
