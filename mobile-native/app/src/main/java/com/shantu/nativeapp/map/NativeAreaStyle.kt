package com.shantu.nativeapp.map

import android.graphics.Color as AndroidColor
import earth.worldwind.render.Color
import earth.worldwind.shape.ShapeAttributes

/** Saved areas use the same translucent fill as the Web AreaLayer. */
internal object NativeAreaStyle {
    const val FILL_OPACITY = 0.22f

    fun fillColor(color: Int): Color = Color(
        AndroidColor.red(color) / 255f,
        AndroidColor.green(color) / 255f,
        AndroidColor.blue(color) / 255f,
        AndroidColor.alpha(color) / 255f * FILL_OPACITY,
    )

    fun attributes(color: Int, outlineWidth: Float): ShapeAttributes {
        val outlineColor = Color(
            AndroidColor.red(color) / 255f,
            AndroidColor.green(color) / 255f,
            AndroidColor.blue(color) / 255f,
            AndroidColor.alpha(color) / 255f,
        )
        return ShapeAttributes().apply {
            isDrawInterior = true
            isDrawOutline = true
            interiorColor = fillColor(color)
            this.outlineColor = outlineColor
            this.outlineWidth = outlineWidth
            isDepthTest = true
        }
    }
}
