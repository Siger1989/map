package com.shantu.nativeapp.hybrid

import android.graphics.Bitmap
import android.graphics.BitmapShader
import android.graphics.Matrix
import android.graphics.Shader
import android.graphics.Canvas
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.view.MotionEvent
import android.view.PixelCopy
import android.view.SurfaceView
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import org.json.JSONObject
import org.json.JSONArray
import kotlin.math.roundToInt

/** Native map pixels behind CSS glass. No screenshot encoding, JS bitmap transport or web map. */
internal class NativeReactGlassBackdrop(
    private val web: WebView,
    private val targets: NativeReactTouchRouter.MapTargetLookup,
    private val frameSequence: (String) -> Long?,
) : View(web.context), AutoCloseable {
    private data class Region(val rect: RectF, val radii: FloatArray, val blur: Float, val saturation: Float, val opacity: Float, val chromeMapId: String? = null)
    private data class Frame(val target: SurfaceView, val key: NativeGlassFrameKey, val variants: Map<Int, Bitmap>) {
        val width get() = key.width
        val height get() = key.height
    }
    private data class Capture(val id: String, val target: SurfaceView, val key: NativeGlassFrameKey, val size: Pair<Int, Int>)
    private val gate = NativeGlassCaptureGate()
    private val main = Handler(Looper.getMainLooper())
    private val workerThread = HandlerThread("ShantuGlass", android.os.Process.THREAD_PRIORITY_BACKGROUND).apply { start() }
    private val worker = Handler(workerThread.looper)
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val path = Path()
    private var regions = emptyList<Region>()
    private var mapIds = emptyList<String>()
    private val frames = linkedMapOf<String, Frame>()
    private var cssWidth = 0f
    private var cssHeight = 0f
    private var nextMap = 0
    private var copies = 0L
    private var cleanSkips = 0L
    private var lastCopyStatus: Int? = null
    private var lastProbeGeometry = ""
    private val tick = Runnable { captureNext() }

    init {
        setWillNotDraw(false)
        isClickable = false; isFocusable = false
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
    }

    fun handleUiRegions(payload: JSONObject) {
        updateDimensions(payload)
        val items = payload.optJSONArray("glassRegions")
        regions = buildList {
            for (i in 0 until minOf(items?.length() ?: 0, NativeReactGlassPolicy.MAX_REGIONS)) {
                val item = items!!.optJSONObject(i) ?: continue
                val l = item.optDouble("left", Double.NaN).toFloat(); val t = item.optDouble("top", Double.NaN).toFloat()
                val r = item.optDouble("right", Double.NaN).toFloat(); val b = item.optDouble("bottom", Double.NaN).toFloat()
                val blur = item.optDouble("blur", 0.0).toFloat()
                val opacity = item.optDouble("opacity", 1.0).toFloat()
                val saturation = item.optDouble("saturation", 1.0).toFloat()
                if (!listOf(l, t, r, b, blur, opacity, saturation).all(Float::isFinite) || r <= l || b <= t || blur <= 0 || opacity <= 0) continue
                val corners = item.optJSONArray("radii")
                val radii = FloatArray(4) { corner -> corners?.optDouble(corner, 0.0)?.toFloat()?.takeIf(Float::isFinite)?.coerceIn(0f, minOf(r - l, b - t) / 2f) ?: 0f }
                val chromeMapId = if (item.optString("edgeExtend") == "comparison-chrome")
                    item.optString("sourceMapId").takeIf { it.isNotBlank() && it.length <= 96 } else null
                add(Region(RectF(l, t, r, b), radii, blur.coerceAtMost(64f), saturation.coerceIn(0f, 3f), opacity.coerceIn(0f, 1f), chromeMapId))
            }
        }
        if (regions.isEmpty()) { gate.invalidate(); clearFrames() }
        logProbeGeometry()
        invalidate(); schedule(0)
    }

    fun updateMapViewports(payload: JSONObject) {
        updateDimensions(payload)
        val array = payload.optJSONArray("viewports") ?: return
        val ids = buildList {
            for (i in 0 until minOf(array.length(), NativeReactGlassPolicy.MAX_MAPS)) {
                array.optJSONObject(i)?.optString("mapId")?.takeIf { it.isNotBlank() && it.length <= 96 }?.let(::add)
            }
        }.distinct()
        if (mapIds != ids) { gate.invalidate(); mapIds = ids; clearFrames() }
        logProbeGeometry()
        invalidate(); schedule(0)
    }

    private fun updateDimensions(payload: JSONObject) {
        val w = payload.optDouble("clientViewportWidth", 0.0).toFloat()
        val h = payload.optDouble("clientViewportHeight", 0.0).toFloat()
        if (w.isFinite() && h.isFinite() && w > 0 && h > 0) {
            if (w != cssWidth || h != cssHeight) { gate.invalidate(); clearFrames() }
            cssWidth = w; cssHeight = h
        }
    }

    fun setForeground(active: Boolean) {
        gate.foreground(active)
        if (!active) { main.removeCallbacks(tick); clearFrames(); invalidate() } else schedule(0)
    }

    fun clearPage() {
        gate.invalidate(); regions = emptyList(); mapIds = emptyList()
        main.removeCallbacks(tick); clearFrames(); invalidate()
    }

    fun inspect(): JSONObject = JSONObject().put("foreground", gate.foreground).put("closed", gate.closed)
        .put("pending", gate.busy).put("regionCount", regions.size).put("mapCount", mapIds.size)
        .put("frameCount", frames.size).put("copies", copies).put("lastCopyStatus", lastCopyStatus ?: JSONObject.NULL)
        .put("cleanSkips", cleanSkips)
        .put("frameSequences", JSONObject().also { result -> frames.forEach { (id, frame) -> result.put(id, frame.key.sequence ?: JSONObject.NULL) } })
        .put("maxDimension", NativeReactGlassPolicy.MAX_DIMENSION)

    /** Isolated probe only: geometry/filter numbers, never text, coordinates or source URLs. */
    private fun logProbeGeometry() {
        if (context.packageName != "com.shantu.hybridprobe") return
        val geometry = JSONObject().put("mapIds", JSONArray(mapIds)).put("cssWidth", cssWidth).put("cssHeight", cssHeight)
            .put("glassRegions", JSONArray().also { out -> regions.forEach { region -> out.put(JSONObject()
                .put("left", region.rect.left).put("top", region.rect.top).put("right", region.rect.right).put("bottom", region.rect.bottom)
                .put("radii", JSONArray(region.radii.toList())).put("blur", region.blur).put("saturation", region.saturation).put("opacity", region.opacity)
                .put("chromeMapId", region.chromeMapId ?: JSONObject.NULL)) } }).toString()
        if (geometry != lastProbeGeometry) { lastProbeGeometry = geometry; android.util.Log.d("ShantuGlass", geometry) }
    }

    private fun schedule(delay: Long) {
        main.removeCallbacks(tick)
        if (!gate.closed && gate.foreground && regions.isNotEmpty() && mapIds.isNotEmpty() && !gate.busy) main.postDelayed(tick, delay)
    }

    private fun captureNext() {
        if (!isAttachedToWindow || !isShown || cssWidth <= 0 || web.width <= 0) { schedule(500); return }
        val physicalPerCss = web.width / cssWidth
        val candidates = mapIds.mapNotNull { id ->
            val target = targets.lookup(id) as? SurfaceView ?: return@mapNotNull null
            if (!target.isShown || !target.holder.surface.isValid || !hasRegionOver(id, target)) return@mapNotNull null
            val size = NativeReactGlassPolicy.captureSize(target.width, target.height) ?: return@mapNotNull null
            val radii = regions.map { NativeReactGlassPolicy.bitmapRadius(it.blur, physicalPerCss, size.first, target.width) }
                .distinct().take(NativeReactGlassPolicy.MAX_VARIANTS).sorted()
            val key = NativeGlassFrameKey(frameSequence(id)?.takeIf { it >= 0L }, target.width, target.height, radii)
            val previous = frames[id]?.takeIf { it.target === target }?.key
            if (!key.needsCapture(previous)) { cleanSkips++; return@mapNotNull null }
            Capture(id, target, key, size)
        }
        if (candidates.isEmpty()) { schedule(NativeReactGlassPolicy.INTERVAL_MS); return }
        val ticket = gate.begin(regions.isNotEmpty() && mapIds.isNotEmpty()) ?: return
        nextMap %= candidates.size
        val (id, target, key, size) = candidates[nextMap]
        nextMap = (nextMap + 1) % candidates.size
        val targetWidth = key.width; val targetHeight = key.height
        val bitmap = Bitmap.createBitmap(size.first, size.second, Bitmap.Config.ARGB_8888)
        try {
            PixelCopy.request(target, bitmap, { status ->
                lastCopyStatus = status
                if (status != PixelCopy.SUCCESS || !gate.accepts(ticket)) {
                    bitmap.recycle(); finishCapture()
                } else {
                    worker.post {
                        val variants = linkedMapOf<Int, Bitmap>()
                        try {
                            val pixels = IntArray(bitmap.width * bitmap.height)
                            bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
                            for (radius in key.radii) {
                                val blurred = NativeReactGlassPolicy.blur(pixels, bitmap.width, bitmap.height, radius)
                                variants[radius] = Bitmap.createBitmap(blurred, bitmap.width, bitmap.height, Bitmap.Config.ARGB_8888)
                            }
                        } catch (_: RuntimeException) { variants.values.forEach { it.recycle() }; variants.clear() }
                        finally { bitmap.recycle() }
                        main.post {
                            if (gate.accepts(ticket) && targets.lookup(id) === target && target.width == targetWidth && target.height == targetHeight && variants.isNotEmpty()) {
                                // Published bitmaps can remain in a RenderThread display list.
                                // Drop our old reference; Android/GC retire that frame safely.
                                // Keep the pre-copy sequence: a frame rendered during PixelCopy
                                // or blur must still invalidate this cache on the next poll.
                                frames[id] = Frame(target, key, variants)
                                copies++
                                if (context.packageName == "com.shantu.hybridprobe" && (copies <= 4 || copies % 100L == 0L)) {
                                    val location = IntArray(2); target.getLocationInWindow(location)
                                    android.util.Log.d("ShantuGlass", "frame id=$id count=${frames.size} sequence=${key.sequence} window=${location[0]},${location[1]} size=${targetWidth}x${targetHeight}")
                                }
                                invalidate()
                            } else variants.values.forEach { it.recycle() }
                            finishCapture()
                        }
                    }
                }
            }, main)
        } catch (_: IllegalArgumentException) { bitmap.recycle(); finishCapture() }
    }

    private fun finishCapture() { gate.finish(); schedule(NativeReactGlassPolicy.INTERVAL_MS) }
    private fun clearFrames() { frames.clear() }

    private fun hasRegionOver(id: String, target: SurfaceView): Boolean {
        if (cssWidth <= 0 || cssHeight <= 0) return false
        val mapPosition = IntArray(2); val webPosition = IntArray(2)
        target.getLocationInWindow(mapPosition); web.getLocationInWindow(webPosition)
        val bounds = RectF(mapPosition[0].toFloat(), mapPosition[1].toFloat(), (mapPosition[0] + target.width).toFloat(), (mapPosition[1] + target.height).toFloat())
        val sx = web.width / cssWidth; val sy = web.height / cssHeight
        return regions.any { region -> region.chromeMapId == id || (region.chromeMapId == null && RectF.intersects(bounds, RectF(webPosition[0] + region.rect.left * sx, webPosition[1] + region.rect.top * sy,
            webPosition[0] + region.rect.right * sx, webPosition[1] + region.rect.bottom * sy))) }
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (!gate.foreground || cssWidth <= 0 || cssHeight <= 0) return
        val ourPosition = IntArray(2); val webPosition = IntArray(2)
        getLocationInWindow(ourPosition); web.getLocationInWindow(webPosition)
        val sx = web.width / cssWidth; val sy = web.height / cssHeight
        val dx = (webPosition[0] - ourPosition[0]).toFloat(); val dy = (webPosition[1] - ourPosition[1]).toFloat()
        for (region in regions) {
            val rect = RectF(dx + region.rect.left * sx, dy + region.rect.top * sy, dx + region.rect.right * sx, dy + region.rect.bottom * sy)
            val corners = FloatArray(8) { index -> region.radii[index / 2] * if (index % 2 == 0) sx else sy }
            path.reset(); path.addRoundRect(rect, corners, Path.Direction.CW)
            val checkpoint = canvas.save(); canvas.clipPath(path)
            paint.alpha = (region.opacity * 255).roundToInt()
            paint.colorFilter = ColorMatrixColorFilter(ColorMatrix().apply { setSaturation(region.saturation) })
            for ((id, frame) in frames) {
                if (region.chromeMapId != null && region.chromeMapId != id) continue
                if (targets.lookup(id) !== frame.target || frame.target.width != frame.width || frame.target.height != frame.height || !frame.target.isShown) continue
                val position = IntArray(2); frame.target.getLocationInWindow(position)
                val destination = RectF((position[0] - ourPosition[0]).toFloat(), (position[1] - ourPosition[1]).toFloat(),
                    (position[0] - ourPosition[0] + frame.width).toFloat(), (position[1] - ourPosition[1] + frame.height).toFloat())
                if (region.chromeMapId == null && !RectF.intersects(rect, destination)) continue
                val sample = frame.variants.values.firstOrNull() ?: continue
                val radius = NativeReactGlassPolicy.bitmapRadius(region.blur, sx, sample.width, frame.width)
                val image = frame.variants[radius] ?: frame.variants.minByOrNull { kotlin.math.abs(it.key - radius) }?.value ?: continue
                if (region.chromeMapId != null) {
                    // Only declared comparison bars sample beyond the map viewport.
                    // CLAMP repeats actual blurred edge pixels; projection and touch
                    // bounds stay unchanged, and ordinary windows retain intersection.
                    val shader = BitmapShader(image, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP)
                    shader.setLocalMatrix(Matrix().apply { setRectToRect(RectF(0f, 0f, image.width.toFloat(), image.height.toFloat()), destination, Matrix.ScaleToFit.FILL) })
                    paint.shader = shader
                    canvas.drawRect(rect, paint)
                    paint.shader = null
                } else canvas.drawBitmap(image, null, destination, paint)
            }
            canvas.restoreToCount(checkpoint)
        }
    }

    override fun onTouchEvent(event: MotionEvent) = false

    override fun close() {
        gate.close(); main.removeCallbacks(tick); clearFrames(); invalidate()
        // quitSafely drains the single accepted blur job; its callback sees the closed generation.
        workerThread.quitSafely()
        (parent as? ViewGroup)?.removeView(this)
    }
}
