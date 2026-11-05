// Shantu Android review patch, 2026-11-05. Licensed under Apache-2.0.
package earth.worldwind.layer.mvt

import android.graphics.Paint
import android.graphics.Rect
import android.graphics.Typeface
import earth.worldwind.shape.TextAttributes
import kotlin.math.ceil
import kotlin.math.max

/**
 * Matches WorldWind 2.1.1 Android TextRenderer's bitmap extent without creating a bitmap.
 * LabelSpec.pixelSize is the logical constructor argument, while Android Font.size is already
 * SP-to-device-pixel converted. Keep those existing SDK fields and their ABI unchanged.
 *
 * One instance belongs to one collider/render thread. Its bounded cache retains only text and
 * immutable metric snapshots, never Labels, TextAttributes, controllers, windows or callbacks.
 * 4096 entries tolerate a tilted view's candidate set before collision; a 512-entry LRU can miss
 * on every frame when a stable scan exceeds 512 items. Text over 256 UTF-16 units is measured
 * normally but not retained, bounding cached character payload to 2 MiB per collider.
 */
internal class AndroidMvtLabelMetrics {
    internal data class Extent(val width: Double, val height: Double)

    private data class Key(
        var text: String = "",
        var size: Float = 0f,
        var typeface: Typeface? = null,
        var outlineWidth: Float = 0f,
    )

    private val lookupKey = Key() // only used for lookup; insert an immutable snapshot on a miss
    private val cache = object : LinkedHashMap<Key, Extent>(64, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Key, Extent>?): Boolean = size > 4096
    }
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val fontMetrics = Paint.FontMetrics()
    private val textBounds = Rect()

    fun measure(text: String, attributes: TextAttributes): Extent {
        val cacheable = text.length <= 256
        lookupKey.text = if (cacheable) text else "" // do not retain an uncached long text in scratch state
        lookupKey.size = attributes.font.size
        lookupKey.typeface = attributes.font.typeface
        lookupKey.outlineWidth = if (attributes.isOutlineEnabled) attributes.outlineWidth else 0f
        if (cacheable) cache[lookupKey]?.let { return it }

        paint.typeface = lookupKey.typeface
        paint.textSize = lookupKey.size
        paint.getFontMetrics(fontMetrics)
        var start = 0
        var lineCount = 0
        var maxWidth = 0
        while (true) {
            val newline = text.indexOf('\n', start)
            val end = if (newline < 0) text.length else newline
            paint.getTextBounds(text, start, end, textBounds)
            maxWidth = max(maxWidth, textBounds.width())
            lineCount++
            if (newline < 0) break
            start = newline + 1
        }
        val strokePad = ceil(lookupKey.outlineWidth * 0.5f).toInt()
        val result = Extent(
            width = maxWidth + 2.0 + 2.0 * strokePad,
            height = MvtLabelCollisionMath.textureHeight(fontMetrics.top, fontMetrics.bottom, lineCount, strokePad),
        )
        if (cacheable) cache[lookupKey.copy()] = result
        return result
    }
}
