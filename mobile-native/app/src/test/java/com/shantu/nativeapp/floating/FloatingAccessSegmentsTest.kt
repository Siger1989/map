package com.shantu.nativeapp.floating

import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], manifest = Config.NONE)
class FloatingAccessSegmentsTest {
    private fun payload() = JSONObject("""{"version":1,"kind":"route","mode":"north","label":"test","coordinates":[[103,30],[103.001,30],[103.002,30]],"segments":[{"kind":"access","coordinates":[[103,30],[103.001,30]]},{"kind":"road","coordinates":[[103.001,30],[103.002,30]]}]}""")

    @Test fun payloadPreservesAccessAndLegacyRoutes() {
        val original = payload()
        val safe = FloatingNavigationService.validatePayload(original)
        assertEquals(original.getJSONArray("segments").toString(), safe.getJSONArray("segments").toString())
        original.remove("segments")
        assertFalse(FloatingNavigationService.validatePayload(original).has("segments"))
        for (segments in listOf("[]", "[{\"kind\":\"bad\",\"coordinates\":[[103,30],[104,30]]}]", "[{\"kind\":\"access\",\"coordinates\":[[999,30],[104,30]]}]")) {
            assertThrows(IllegalArgumentException::class.java) { FloatingNavigationService.validatePayload(payload().put("segments", JSONArray(segments))) }
        }
        assertThrows(IllegalArgumentException::class.java) { FloatingNavigationService.validatePayload(payload().put("kind", "position").put("coordinates", JSONArray())) }
    }

    private data class Stroke(val dashed: Boolean, val color: Int, val bounds: RectF)
    private class CaptureCanvas : Canvas() {
        val strokes = mutableListOf<Stroke>()
        override fun drawPath(path: Path, paint: Paint) {
            val bounds = RectF(); path.computeBounds(bounds, true)
            strokes += Stroke(paint.pathEffect != null, paint.color, bounds)
        }
    }

    @Test fun accessHasOneDashedStrokeAndNoSolidHaloOnBothSurfaces() {
        for (lockscreen in listOf(false, true)) {
            val view = FloatingNavigationView(RuntimeEnvironment.getApplication())
            view.lockscreenPresentation = lockscreen
            val a = FloatingCoordinate(103.0, 30.0)
            val b = FloatingCoordinate(103.001, 30.0)
            val c = FloatingCoordinate(103.002, 30.0)
            view.route = listOf(a, b, c)
            view.routeSegments = listOf(FloatingRouteSegment(true, listOf(a, b)), FloatingRouteSegment(false, listOf(b, c)))
            val draw = FloatingNavigationView::class.java.getDeclaredMethod("drawRoute", Canvas::class.java, FloatingCoordinate::class.java, Float::class.javaPrimitiveType, Float::class.javaPrimitiveType)
            draw.isAccessible = true
            val canvas = CaptureCanvas()
            draw.invoke(view, canvas, a, 100f, 100f)
            assertEquals(4, canvas.strokes.size)
            assertEquals(1, canvas.strokes.count { it.dashed })
            assertEquals(0xffffcb65.toInt(), canvas.strokes.first().color)
            val accessBounds = canvas.strokes.first().bounds
            assertTrue(canvas.strokes.drop(1).all { it.bounds.left >= accessBounds.right - .01f })
            // Metadata-only replacement invalidates cached paths; absent metadata stays compatible.
            view.routeSegments = emptyList()
            val legacy = CaptureCanvas()
            draw.invoke(view, legacy, a, 100f, 100f)
            assertEquals(3, legacy.strokes.size)
            assertTrue(legacy.strokes.none { it.dashed })
            assertTrue(legacy.strokes.all { it.bounds.left < accessBounds.right })
        }
    }
}
