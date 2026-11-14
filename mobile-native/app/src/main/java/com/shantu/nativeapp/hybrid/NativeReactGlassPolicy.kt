package com.shantu.nativeapp.hybrid

import kotlin.math.max
import kotlin.math.roundToInt

/** Bounded work shared by the native glass view and its JVM tests. */
internal object NativeReactGlassPolicy {
    const val MAX_REGIONS = 32
    const val MAX_MAPS = 2
    const val MAX_VARIANTS = 8
    const val MAX_DIMENSION = 384
    const val INTERVAL_MS = 150L

    fun captureSize(width: Int, height: Int): Pair<Int, Int>? {
        if (width <= 0 || height <= 0) return null
        val scale = minOf(1.0, MAX_DIMENSION.toDouble() / max(width, height))
        return max(1, (width * scale).roundToInt()) to max(1, (height * scale).roundToInt())
    }

    fun bitmapRadius(cssBlur: Float, physicalPerCss: Float, bitmapWidth: Int, surfaceWidth: Int): Int {
        if (!cssBlur.isFinite() || !physicalPerCss.isFinite() || surfaceWidth <= 0 || bitmapWidth <= 0) return 0
        return (cssBlur.coerceIn(0f, 64f) * physicalPerCss * bitmapWidth / surfaceWidth).roundToInt().coerceIn(0, 32)
    }

    /** Three separable box passes approximate the CSS Gaussian without large GPU allocations.
     *  Source is a bounded PixelCopy map buffer, never a screen/WebView capture.
     *  Premultiply before filtering to avoid dark fringes around transparent map pixels. */
    fun blur(source: IntArray, width: Int, height: Int, radius: Int): IntArray {
        require(width > 0 && height > 0 && source.size == width * height)
        if (radius <= 0) return source.copyOf()
        val r = radius.coerceAtMost(32)
        var pixels = IntArray(source.size) { index ->
            val c = source[index]; val a = c ushr 24
            (a shl 24) or ((((c ushr 16) and 255) * a / 255) shl 16) or
                ((((c ushr 8) and 255) * a / 255) shl 8) or ((c and 255) * a / 255)
        }
        val scratch = IntArray(source.size)
        repeat(3) {
            box(pixels, scratch, width, height, r, true)
            box(scratch, pixels, width, height, r, false)
        }
        for (i in pixels.indices) {
            val c = pixels[i]; val a = c ushr 24
            pixels[i] = if (a == 0) 0 else (a shl 24) or
                (((((c ushr 16) and 255) * 255 / a).coerceAtMost(255)) shl 16) or
                (((((c ushr 8) and 255) * 255 / a).coerceAtMost(255)) shl 8) or
                (((c and 255) * 255 / a).coerceAtMost(255))
        }
        return pixels
    }

    private fun box(source: IntArray, output: IntArray, width: Int, height: Int, radius: Int, horizontal: Boolean) {
        val lines = if (horizontal) height else width
        val length = if (horizontal) width else height
        val count = radius * 2 + 1
        fun index(line: Int, position: Int) = if (horizontal) line * width + position else position * width + line
        for (line in 0 until lines) {
            var a = 0; var r = 0; var g = 0; var b = 0
            for (p in -radius..radius) {
                val c = source[index(line, p.coerceIn(0, length - 1))]
                a += c ushr 24; r += (c ushr 16) and 255; g += (c ushr 8) and 255; b += c and 255
            }
            for (position in 0 until length) {
                output[index(line, position)] = ((a / count) shl 24) or ((r / count) shl 16) or ((g / count) shl 8) or (b / count)
                val remove = source[index(line, (position - radius).coerceIn(0, length - 1))]
                val add = source[index(line, (position + radius + 1).coerceIn(0, length - 1))]
                a += (add ushr 24) - (remove ushr 24)
                r += ((add ushr 16) and 255) - ((remove ushr 16) and 255)
                g += ((add ushr 8) and 255) - ((remove ushr 8) and 255)
                b += (add and 255) - (remove and 255)
            }
        }
    }
}

/** The sequence is read BEFORE PixelCopy, never upgraded by a later GL callback.
 * A capture can therefore lag a new frame but cannot falsely acknowledge one it never copied. */
internal data class NativeGlassFrameKey(val sequence: Long?, val width: Int, val height: Int, val radii: List<Int>) {
    fun needsCapture(previous: NativeGlassFrameKey?): Boolean = sequence == null || previous != this
}

/** A late PixelCopy/worker callback cannot revive a paused, replaced or closed page. */
internal class NativeGlassCaptureGate {
    var foreground = false; private set
    var closed = false; private set
    var busy = false; private set
    private var generation = 0L
    fun foreground(active: Boolean) { if (foreground != active) { foreground = active; generation++ } }
    fun invalidate() { generation++ }
    fun begin(hasRegions: Boolean): Long? {
        if (closed || !foreground || busy || !hasRegions) return null
        busy = true
        return generation
    }
    fun accepts(ticket: Long) = !closed && foreground && generation == ticket
    fun finish() { busy = false }
    fun close() { closed = true; foreground = false; generation++ }
}
