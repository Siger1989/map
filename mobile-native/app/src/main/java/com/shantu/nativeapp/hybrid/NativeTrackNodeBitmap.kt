package com.shantu.nativeapp.hybrid

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.Shader

/** Cached by the renderer; the glow leaves a genuine user-colored core. */
internal object NativeTrackNodeBitmap {
    private const val SIZE = 64
    fun collectionRing(): Bitmap = Bitmap.createBitmap(SIZE, SIZE, Bitmap.Config.ARGB_8888).also { bitmap ->
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            shader = RadialGradient(32f, 32f, 31f,
                intArrayOf(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT,
                    android.graphics.Color.argb(170, 32, 185, 120), android.graphics.Color.TRANSPARENT),
                floatArrayOf(0f, .45f, .68f, 1f), Shader.TileMode.CLAMP)
        }
        Canvas(bitmap).drawCircle(32f, 32f, 31f, paint)
    }
    fun create(color: String, selected: Boolean, active: Boolean, boxSelected: Boolean): Bitmap =
        Bitmap.createBitmap(SIZE, SIZE, Bitmap.Config.ARGB_8888).also { bitmap ->
            val canvas = Canvas(bitmap)
            val center = SIZE / 2f
            val paint = Paint(Paint.ANTI_ALIAS_FLAG)
            if (boxSelected || active) {
                val green = NativeOverlayStyle.androidColor("#20b978")
                paint.shader = RadialGradient(center, center, 31f, intArrayOf(
                    android.graphics.Color.argb(42, android.graphics.Color.red(green), android.graphics.Color.green(green), android.graphics.Color.blue(green)),
                    android.graphics.Color.argb(if (active) 112 else 88, android.graphics.Color.red(green), android.graphics.Color.green(green), android.graphics.Color.blue(green)),
                    android.graphics.Color.argb(34, android.graphics.Color.red(green), android.graphics.Color.green(green), android.graphics.Color.blue(green)),
                    android.graphics.Color.TRANSPARENT,
                ), floatArrayOf(0f, 0.34f, 0.7f, 1f), Shader.TileMode.CLAMP)
                canvas.drawCircle(center, center, 31f, paint)
                paint.shader = null
                paint.style = Paint.Style.STROKE
                paint.strokeWidth = 1.4f
                paint.color = android.graphics.Color.argb(174, android.graphics.Color.red(green), android.graphics.Color.green(green), android.graphics.Color.blue(green))
                canvas.drawCircle(center, center, 14f, paint)
                paint.style = Paint.Style.FILL
                paint.color = NativeOverlayStyle.androidColor("#14392e")
                canvas.drawCircle(center, center, 14f, paint)
                paint.color = NativeOverlayStyle.androidColor(color)
                canvas.drawCircle(center, center, 11f, paint)
                if (active) {
                    paint.color = android.graphics.Color.WHITE
                    canvas.drawCircle(center, center, 2f, paint)
                }
            } else if (selected) {
                paint.color = NativeOverlayStyle.androidColor(if (active) "#fff3a0" else "#ffffff")
                canvas.drawCircle(center, center, 29f, paint)
            }
            if (!boxSelected && !active) {
                paint.color = NativeOverlayStyle.androidColor("#14392e")
                canvas.drawCircle(center, center, 23f, paint)
                paint.color = NativeOverlayStyle.androidColor(color)
                canvas.drawCircle(center, center, 18f, paint)
            }
        }
}
