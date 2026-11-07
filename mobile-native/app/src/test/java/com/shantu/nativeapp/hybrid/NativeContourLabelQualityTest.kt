package com.shantu.nativeapp.hybrid

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color as AndroidColor
import android.graphics.Paint
import earth.worldwind.geom.Position
import earth.worldwind.render.Font
import earth.worldwind.render.RenderContext
import earth.worldwind.render.TextRenderer
import earth.worldwind.shape.TextAttributes
import earth.worldwind.layer.mvt.MvtCurvedLineLabel
import com.shantu.nativeapp.map.NativeContourCurvedLabel
import com.shantu.nativeapp.map.NativeContourVectorGeometry
import java.io.File
import java.io.FileOutputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], manifest = Config.NONE)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class NativeContourLabelQualityTest {
    private class RasterTextRenderer(rc: RenderContext) : TextRenderer(rc) {
        fun raster(text: String, attributes: TextAttributes): Bitmap = drawText(text, attributes)
    }

    @Test
    fun `contour delegates rasterize physical target size and preserve scale cache`() {
        val label = NativeContourCurvedLabel(
            Position.fromDegrees(0.0, 0.0, 0.0),
            doubleArrayOf(0.0, 0.0, 0.01, 0.0), "4500 m",
        )
        val activeField = NativeContourCurvedLabel::class.java.getDeclaredField("activeDelegate").apply { isAccessible = true }
        for (scale in listOf(1f, 2f, 3.2f)) {
            label.setCssScale(scale)
            val delegate = activeField.get(label) as MvtCurvedLineLabel
            val attributes = delegate.attributes
            val targetSize = NativeContourVectorGeometry.LABEL_SIZE * scale
            assertEquals(targetSize, attributes.font.size, 1e-4f)
            assertEquals("font bitmap is rendered at physical size; do not resize its quad", 1.0, attributes.scale, 0.0)
            assertEquals(NativeContourVectorGeometry.LABEL_HALO_WIDTH * scale, attributes.outlineWidth, 1e-4f)
            assertEquals(targetSize.toInt().coerceAtLeast(1), delegate.pixelSize)
            assertEquals(attributes.font.measureText(label.text), delegate.textWidth, 1e-4f)
            assertEquals(attributes.font.measureChars(label.text).toList(), delegate.charWidths.toList())
            val extent = label.collisionExtent
            assertTrue("collision must cover arbitrary tangent rotation", extent > delegate.textWidth)
        }
        assertEquals("main and dual pane metric variants remain bounded", 2, label.delegateCacheCount)
    }

    @Test
    fun `SDK text renderer comparison emits rasterized density and tangent samples`() {
        val labels = listOf("150 m", "1200 m", "4500 m")
        val densities = listOf(1f, 2f, 3.2f)
        val cellW = 440
        val rowH = 122
        val output = Bitmap.createBitmap(cellW * 2, rowH * densities.size * labels.size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(output)
        val background = Paint().apply { color = AndroidColor.rgb(50, 70, 62) }
        val titlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = AndroidColor.WHITE; textSize = 15f }
        val mapPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = AndroidColor.rgb(134, 157, 116); strokeWidth = 1f }
        val renderer = RasterTextRenderer(RenderContext())
        var row = 0
        for (scale in densities) for (text in labels) {
            val top = row++ * rowH
            canvas.drawRect(0f, top.toFloat(), output.width.toFloat(), (top + rowH).toFloat(), background)
            canvas.drawText("$text  density=$scale  (0° / 45°)", 10f, top + 20f, titlePaint)
            canvas.drawLine(12f, top + 64f, output.width - 12f, top + 64f, mapPaint)
            for (angle in listOf(0f, 45f)) {
                val oldAttrs = TextAttributes().apply {
                    font = Font(7.5f)
                    this.scale = 1.0
                    textColor = earth.worldwind.render.Color(0xfffff1c9.toInt())
                    outlineColor = earth.worldwind.render.Color(0xff1a3034.toInt())
                    outlineWidth = 0.8f
                    isOutlineEnabled = true
                }
                val newAttrs = TextAttributes().apply {
                    font = Font(NativeContourVectorGeometry.LABEL_SIZE * scale)
                    this.scale = 1.0
                    textColor = earth.worldwind.render.Color(0xfffff1c9.toInt())
                    outlineColor = earth.worldwind.render.Color(0xff1a3034.toInt())
                    outlineWidth = NativeContourVectorGeometry.LABEL_HALO_WIDTH * scale
                    isOutlineEnabled = true
                }
                val oldBitmap = renderer.raster(text, oldAttrs)
                val newBitmap = renderer.raster(text, newAttrs)
                assertTrue("density $scale: native raster should retain target-size glyph samples", newBitmap.width >= oldBitmap.width)
                val x = if (angle == 0f) 110f else 330f
                drawSample(canvas, oldBitmap, x, top + 64f, angle, scale)
                drawSample(canvas, newBitmap, x + cellW, top + 64f, angle, 1f)
                oldBitmap.recycle()
                newBitmap.recycle()
            }
        }
        var repositoryRoot = File(System.getProperty("user.dir")).canonicalFile
        while (repositoryRoot.parentFile != null && !File(repositoryRoot, ".git").exists()) repositoryRoot = repositoryRoot.parentFile!!
        val evidence = File(repositoryRoot, ".openai/186-label-quality").apply { mkdirs() }.resolve("sdk-text-renderer-comparison.png")
        FileOutputStream(evidence).use { output.compress(Bitmap.CompressFormat.PNG, 100, it) }
        assertTrue("comparison PNG should be available for visual inspection", evidence.isFile && evidence.length() > 1_000L)
        output.recycle()
    }

    private fun drawSample(canvas: Canvas, bitmap: Bitmap, centerX: Float, baselineY: Float, angle: Float, bitmapScale: Float) {
        val save = canvas.save()
        canvas.translate(centerX, baselineY)
        canvas.rotate(angle)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
        val width = bitmap.width * bitmapScale
        val height = bitmap.height * bitmapScale
        canvas.drawBitmap(bitmap, null, android.graphics.RectF(-width / 2f, -height / 2f, width / 2f, height / 2f), paint)
        canvas.restoreToCount(save)
    }
}
