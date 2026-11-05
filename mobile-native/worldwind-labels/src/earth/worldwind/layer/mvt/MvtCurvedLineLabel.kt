// Shantu Android review patch, 2026-11-05; upstream WorldWind 2.1.1, Apache-2.0.
package earth.worldwind.layer.mvt

import earth.worldwind.geom.AltitudeMode
import earth.worldwind.geom.Angle.Companion.degrees
import earth.worldwind.geom.Offset
import earth.worldwind.geom.Position
import earth.worldwind.geom.Vec2
import earth.worldwind.geom.Vec3
import earth.worldwind.render.AbstractRenderable
import earth.worldwind.render.RenderContext
import earth.worldwind.shape.Label
import earth.worldwind.shape.OrientationMode
import earth.worldwind.shape.TextAttributes
import kotlin.math.max
import kotlin.math.min

/**
 * Original WorldWind arc-length algorithm and pooled glyph Labels, with one collision candidate per
 * repeat. Layout, final terrain projection, collision and drawing use the same glyph snapshot.
 * A rejected repeat removes only that name instance, never the independent road geometry.
 */
class MvtCurvedLineLabel(
    val coords: DoubleArray,
    val text: String,
    val attributes: TextAttributes,
    val charWidths: FloatArray,
    val textWidth: Float,
    val pixelSize: Int,
    val priority: Int = 0,
    val featureId: Long = 0L,
    val repeatGapPx: Float = 1100f,
    displayName: String? = null,
) : AbstractRenderable(displayName) {
    init { isPickEnabled = false }

    /** Preserved public switch. The collider enables it when at least one complete repeat survives. */
    var collisionEnabled = true

    private val projected = ArrayList<Vec2>()
    private val vecPool = ArrayList<Vec2>()
    private val projectedGeo = ArrayList<Position>()
    private val geoPool = ArrayList<Position>()
    private var projectedW = DoubleArray(0)
    private val labelPool = ArrayList<Label>()
    private val charText = HashMap<Char, String>()
    private val cartesian = Vec3()
    private val screen = Vec3()
    private val measuredBounds = FloatArray(4)
    private val placementCounts = LongArray(2)
    private val centeredAttributes = TextAttributes(attributes).apply { textOffset = Offset.center() }
    private var placeWidths = FloatArray(0)
    private var glyphWidths = DoubleArray(0)
    private var glyphHeights = DoubleArray(0)
    private var glyphAngles = FloatArray(0)
    private var glyphLatitudes = DoubleArray(0)
    private var glyphLongitudes = DoubleArray(0)
    private var glyphRotations = FloatArray(0)
    private var runStarts = IntArray(0)
    private var runCounts = IntArray(0)
    private var runBounds = FloatArray(0)
    private var acceptedRuns = BooleanArray(0)
    private var runCount = 0
    private var glyphCount = 0
    private var preparedToken: Any? = null // token only; never retain RenderContext/WorldWindow
    private val layoutStats = LongArray(MvtLabelCollisionMath.LINE_STATS_SIZE)

    /**
     * Allocation-free diagnostic snapshot; caller supplies at least 11 longs:
     * 0 candidate repeats, 1 prepared repeats, 2 accepted repeats, 3 source-vertex projections,
     * 4 final glyph projections, 5 projection-rejected repeats, 6 direction-rejected repeats,
     * 7 offscreen repeats, 8 layout nanoseconds, 9 contiguous valid chunks, 10 metric queries.
     * Counters describe the latest collision invocation, not a performance acceptance result.
     */
    fun copyLayoutStatistics(result: LongArray) {
        require(result.size >= layoutStats.size)
        layoutStats.copyInto(result)
    }

    /** Called once per collision pass; the same snapshot is subsequently consumed by doRender. */
    internal fun prepareCollision(rc: RenderContext, metrics: AndroidMvtLabelMetrics, token: Any): Int {
        if (preparedToken === token) return runCount
        val started = System.nanoTime()
        preparedToken = token
        runCount = 0
        glyphCount = 0
        collisionEnabled = false
        layoutStats.fill(0)
        projected.clear()
        projectedGeo.clear()
        try {
            if (coords.size < 4 || text.isEmpty() || charWidths.size < text.length ||
                !repeatGapPx.isFinite() || repeatGapPx < 0f) return 0
            val scale = centeredAttributes.scale
            val gs = curvedGlyphAdvanceScale(rc) * scale.toFloat()
            if (!scale.isFinite() || scale <= 0.0 || !gs.isFinite() || gs <= 0f) return 0
            if (placeWidths.size < text.length) {
                placeWidths = FloatArray(text.length)
                glyphWidths = DoubleArray(text.length)
                glyphHeights = DoubleArray(text.length)
                glyphAngles = FloatArray(text.length)
            }
            var advance = 0f
            var glyphMargin = 0.0
            for (i in text.indices) {
                val width = charWidths[i] * gs
                if (!width.isFinite() || width < 0f) return 0
                placeWidths[i] = width
                advance += width
                val character = charText.getOrPut(text[i]) { text[i].toString() }
                val extent = metrics.measure(character, centeredAttributes)
                layoutStats[10]++
                glyphWidths[i] = extent.width
                glyphHeights[i] = extent.height
                // Conservative for any rotation and the original scale-dependent pivot.
                glyphMargin = max(glyphMargin, (extent.width + extent.height) * (scale + 1.0) + 3.0)
            }
            if (!advance.isFinite() || advance <= 0f || !(repeatGapPx * gs).isFinite()) return 0
            // measureText may differ from sum(measureChars); use the advances actually walked.
            val vertexCount = coords.size / 2
            if (projectedW.size < vertexCount) projectedW = DoubleArray(vertexCount)
            for (i in 0 until vertexCount) {
                val lon = coords[i * 2]
                val lat = coords[i * 2 + 1]
                var valid = lat.isFinite() && lon.isFinite()
                var w = Double.NaN
                if (valid) {
                    rc.geographicToCartesian(lat.degrees, lon.degrees, 0.0, AltitudeMode.CLAMP_TO_GROUND, cartesian)
                    layoutStats[3]++
                    w = MvtLabelCollisionMath.clipW(rc.modelviewProjection.m, cartesian.x, cartesian.y, cartesian.z)
                    valid = w.isFinite() && w > 0.0 && rc.project(cartesian, screen) &&
                        screen.x.isFinite() && screen.y.isFinite()
                }
                if (!valid) {
                    prepareChunk(rc, advance, repeatGapPx * gs, glyphMargin)
                    projected.clear()
                    projectedGeo.clear()
                    continue // never bridge a failed/behind-camera source vertex
                }
                val slot = projected.size
                val point = if (slot < vecPool.size) vecPool[slot] else Vec2().also { vecPool.add(it) }
                point.set(screen.x, screen.y)
                projected.add(point)
                val geo = if (slot < geoPool.size) geoPool[slot] else Position().also { geoPool.add(it) }
                geo.setDegrees(lat, lon, 0.0)
                projectedGeo.add(geo)
                projectedW[slot] = w
            }
            prepareChunk(rc, advance, repeatGapPx * gs, glyphMargin)
            layoutStats[1] = runCount.toLong()
            return runCount
        } finally {
            layoutStats[8] = System.nanoTime() - started
        }
    }

    internal fun copyRunBounds(index: Int, result: FloatArray) {
        require(index in 0 until runCount && result.size >= 4)
        runBounds.copyInto(result, 0, index * 4, index * 4 + 4)
    }

    internal fun acceptCollisionRun(index: Int) {
        require(index in 0 until runCount)
        if (!acceptedRuns[index]) {
            acceptedRuns[index] = true
            layoutStats[2]++
            collisionEnabled = true
        }
    }

    private fun prepareChunk(rc: RenderContext, advance: Float, gap: Float, margin: Double) {
        if (projected.size < 2) return
        layoutStats[9]++
        val vp = rc.viewport
        var x1 = Double.POSITIVE_INFINITY; var y1 = Double.POSITIVE_INFINITY
        var x2 = Double.NEGATIVE_INFINITY; var y2 = Double.NEGATIVE_INFINITY
        for (p in projected) {
            x1 = min(x1, p.x); x2 = max(x2, p.x)
            y1 = min(y1, p.y); y2 = max(y2, p.y)
        }
        if (x2 + margin < vp.x || x1 - margin > vp.x + vp.width ||
            y2 + margin < vp.y || y1 - margin > vp.y + vp.height) return
        if (projected.last().x < projected.first().x) {
            projected.reverse()
            projectedGeo.reverse()
            var a = 0
            var b = projected.size - 1
            while (a < b) {
                val w = projectedW[a]; projectedW[a] = projectedW[b]; projectedW[b] = w
                a++; b--
            }
        }
        val runs = MvtLabelCollisionMath.placeVisible(
            projected, text, placeWidths, advance, gap,
            vp.x - margin, vp.y - margin, vp.x + vp.width + margin, vp.y + vp.height + margin,
            placementCounts,
        )
        layoutStats[0] += placementCounts[0]
        layoutStats[7] += placementCounts[1]
        val maxDistance = rc.horizonDistance * labelHorizonFraction
        val maxDistanceSq = maxDistance * maxDistance
        for (run in runs) {
            for (i in run.glyphs.indices) glyphAngles[i] = run.glyphs[i].angleRad
            if (!MvtLabelCollisionMath.readableAngles(glyphAngles, run.glyphs.size)) {
                layoutStats[6]++
                continue
            }
            // Skip invisible repeats before final terrain lookups and Label preparation.
            var visible = false
            for (g in run.glyphs) {
                if (g.x + margin >= vp.x && g.x - margin <= vp.x + vp.width &&
                    g.y + margin >= vp.y && g.y - margin <= vp.y + vp.height) { visible = true; break }
            }
            if (!visible) { layoutStats[7]++; continue }
            ensureGlyphCapacity(glyphCount + run.glyphs.size)
            var bx1 = Float.POSITIVE_INFINITY; var by1 = Float.POSITIVE_INFINITY
            var bx2 = Float.NEGATIVE_INFINITY; var by2 = Float.NEGATIVE_INFINITY
            var valid = true
            for (i in run.glyphs.indices) {
                val g = run.glyphs[i]
                val seg = g.segIndex
                if (seg < 0 || seg + 1 >= projectedGeo.size) { valid = false; break }
                val sa = projected[seg]
                val sb = projected[seg + 1]
                val screenU = MvtLabelCollisionMath.screenFraction(g.x.toDouble(), g.y.toDouble(), sa.x, sa.y, sb.x, sb.y)
                val t = MvtLabelCollisionMath.perspectiveFraction(screenU, projectedW[seg], projectedW[seg + 1])
                if (!t.isFinite()) { valid = false; break }
                val a = projectedGeo[seg]
                val b = projectedGeo[seg + 1]
                val lat = a.latitude.inDegrees + (b.latitude.inDegrees - a.latitude.inDegrees) * t
                val lon = a.longitude.inDegrees + (b.longitude.inDegrees - a.longitude.inDegrees) * t
                rc.geographicToCartesian(lat.degrees, lon.degrees, 0.0, AltitudeMode.CLAMP_TO_GROUND, cartesian)
                layoutStats[4]++
                if (rc.cameraPoint.distanceToSquared(cartesian) > maxDistanceSq || !rc.project(cartesian, screen) ||
                    !MvtLabelCollisionMath.projectionMatches(screen.x, screen.y, g.x.toDouble(), g.y.toDouble())) {
                    valid = false; break
                }
                // Keep only numeric candidates. Allocate/mutate Label objects after collision accepts
                // this repeat, so rejected candidates cannot inflate retained per-tile Label pools.
                glyphLatitudes[glyphCount + i] = lat
                glyphLongitudes[glyphCount + i] = lon
                glyphRotations[glyphCount + i] = g.angleRad
                MvtLabelCollisionMath.rotatedBounds(
                    screen.x, screen.y, glyphWidths[i], glyphHeights[i],
                    glyphWidths[i] * 0.5, glyphHeights[i] * 0.5,
                    centeredAttributes.scale, g.angleRad.toDouble(), 3f, measuredBounds,
                )
                bx1 = min(bx1, measuredBounds[0]); by1 = min(by1, measuredBounds[1])
                bx2 = max(bx2, measuredBounds[2]); by2 = max(by2, measuredBounds[3])
            }
            if (!valid) { layoutStats[5]++; continue }
            if (bx2 < vp.x || bx1 > vp.x + vp.width || by2 < vp.y || by1 > vp.y + vp.height) {
                layoutStats[7]++; continue
            }
            ensureRunCapacity(runCount + 1)
            runStarts[runCount] = glyphCount
            runCounts[runCount] = run.glyphs.size
            runBounds[runCount * 4] = bx1; runBounds[runCount * 4 + 1] = by1
            runBounds[runCount * 4 + 2] = bx2; runBounds[runCount * 4 + 3] = by2
            acceptedRuns[runCount] = false
            glyphCount += run.glyphs.size
            runCount++
        }
    }

    private fun ensureRunCapacity(required: Int) {
        if (required <= runStarts.size) return
        val size = maxOf(required, runStarts.size * 2, 4)
        runStarts = runStarts.copyOf(size)
        runCounts = runCounts.copyOf(size)
        runBounds = runBounds.copyOf(size * 4)
        acceptedRuns = acceptedRuns.copyOf(size)
    }

    private fun ensureGlyphCapacity(required: Int) {
        if (required <= glyphLatitudes.size) return
        val size = maxOf(required, glyphLatitudes.size * 2, text.length)
        glyphLatitudes = glyphLatitudes.copyOf(size)
        glyphLongitudes = glyphLongitudes.copyOf(size)
        glyphRotations = glyphRotations.copyOf(size)
    }

    override fun doRender(rc: RenderContext) {
        if (!collisionEnabled) return
        val token = rc.getUserProperty<Any>(MvtLabelCollisionMath.linePassKey)
        if (token == null || preparedToken !== token) {
            // Preserve direct rendering without a collider; still require complete, legible repeats.
            val metrics = rc.getUserProperty<AndroidMvtLabelMetrics>(MvtLabelCollisionMath.lineMetricsKey)
                ?: AndroidMvtLabelMetrics().also { rc.putUserProperty(MvtLabelCollisionMath.lineMetricsKey, it) }
            prepareCollision(rc, metrics, Any())
            for (i in 0 until runCount) acceptCollisionRun(i)
            // No collider owns this call: a temporarily invisible direct-rendered label must be
            // allowed to prepare again after the next camera move.
            collisionEnabled = true
        }
        var renderedGlyph = 0
        for (i in 0 until runCount) {
            if (!acceptedRuns[i]) continue
            val start = runStarts[i]
            for (j in start until start + runCounts[i]) {
                val label = pooledLabel(renderedGlyph++)
                label.position.setDegrees(glyphLatitudes[j], glyphLongitudes[j], 0.0)
                label.text = charText[text[j - start]]
                // project: +Y up. Label applies -rotation, yielding the correct +tangent angle.
                label.rotation = (-Math.toDegreesShim(glyphRotations[j].toDouble())).degrees
                label.render(rc)
            }
        }
    }

    private fun pooledLabel(index: Int): Label {
        while (index >= labelPool.size) {
            labelPool.add(Label(Position.fromDegrees(0.0, 0.0, 0.0), null, centeredAttributes).apply {
                altitudeMode = AltitudeMode.CLAMP_TO_GROUND
                rotationMode = OrientationMode.RELATIVE_TO_SCREEN
            })
        }
        return labelPool[index]
    }
}

/** Kept with its original class name and method ABI. */
private object Math {
    fun toDegreesShim(rad: Double): Double = rad * 57.29577951308232
}

