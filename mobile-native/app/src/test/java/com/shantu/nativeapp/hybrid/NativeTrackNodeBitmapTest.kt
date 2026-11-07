package com.shantu.nativeapp.hybrid

import android.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], manifest = Config.NONE)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class NativeTrackNodeBitmapTest {
    @Test fun collectionGlowLeavesTheMarkerAndLabelCenterTransparent() {
        val bitmap = NativeTrackNodeBitmap.collectionRing()
        assertEquals(0, Color.alpha(bitmap.getPixel(32, 32)))
        assertEquals(0, Color.alpha(bitmap.getPixel(0, 0)))
        assertTrue(Color.alpha(bitmap.getPixel(53, 32)) > 0)
        assertTrue(Color.green(bitmap.getPixel(53, 32)) > Color.red(bitmap.getPixel(53, 32)))
        bitmap.recycle()
    }
    @Test fun boxSelectionKeepsTheOriginalRedAndBlueCoresWithGreenOutside() {
        for (source in listOf("#e41a1c", "#377eb8")) {
            val bitmap = NativeTrackNodeBitmap.create(source, true, false, true)
            assertEquals(Color.parseColor(source), bitmap.getPixel(32, 32))
            assertEquals(Color.parseColor(source), bitmap.getPixel(38, 32))
            val glow = bitmap.getPixel(54, 32)
            assertTrue(Color.alpha(glow) > 0)
            assertTrue(Color.green(glow) > Color.red(glow))
            assertEquals(0, Color.alpha(bitmap.getPixel(0, 0)))
            bitmap.recycle()
        }
    }
    @Test fun activeNodeKeepsItsColorOutsideTheExistingWhiteCenterCue() {
        val bitmap = NativeTrackNodeBitmap.create("#f781bf", true, true, true)
        assertEquals(Color.parseColor("#f781bf"), bitmap.getPixel(38, 32))
        assertEquals(Color.WHITE, bitmap.getPixel(32, 32))
        bitmap.recycle()
    }
}
