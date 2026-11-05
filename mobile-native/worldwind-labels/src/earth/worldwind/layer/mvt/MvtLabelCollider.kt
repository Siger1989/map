// Shantu Android review patch, 2026-11-05; upstream WorldWind 2.1.1, Apache-2.0.
package earth.worldwind.layer.mvt

import earth.worldwind.geom.AltitudeMode
import earth.worldwind.geom.Angle.Companion.degrees
import earth.worldwind.geom.Vec2
import earth.worldwind.geom.Vec3
import earth.worldwind.render.RenderContext
import earth.worldwind.shape.Label
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.log2

/**
 * Cross-tile label collision pass for [MvtVectorLayer]. Walks every label across every
 * visible [MvtLabelGroup], computes a screen-space bbox per label, sorts by priority
 * (with a stickiness bonus for last-frame survivors), then greedily accepts
 * non-overlapping bboxes top-down. Each group's [MvtLabelGroup.enabledMask] is updated
 * to reflect the accepted set so the group's render path emits exactly the survivors.
 *
 * Stickiness exists because at borderline overlaps a tiny camera move can flip which
 * label "wins" the collision, making the loser blink between frames. Last-frame-visible
 * labels get a small priority bonus so they keep winning ties — see [STICKINESS_BONUS].
 *
 * Scratch buffers are grown geometrically and reused frame-to-frame; the per-frame label
 * sets are double-buffered so [endFrame] just swaps references. Zero per-frame allocation
 * under steady state.
 *
 * Cost: cheap per-label culls (empty/occlusion/minzoom) run BEFORE the screen projection, then an
 * O(N log N) priority sort over the survivors, then a greedy accept that is O(N·A) with A = boxes
 * accepted so far, hard-capped at [labelBudget]. No per-tile fallback — one global pass per frame.
 */
internal class MvtLabelCollider {

    private var capacity = 0
    private var groupIdx = IntArray(0)
    private var labelIdx = IntArray(0)
    private var effPrio = IntArray(0)
    private var order = IntArray(0)
    private var orderLong = LongArray(0) // (effPrio shl 32 | index) packed for an O(N log N) sort
    private var bboxX1 = FloatArray(0)
    private var bboxY1 = FloatArray(0)
    private var bboxX2 = FloatArray(0)
    private var bboxY2 = FloatArray(0)
    private var visible = BooleanArray(0)

    // Shared by points and accepted line repeats. Appending a repeat grows with copyOf, preserving
    // the already accepted point/repeat boxes; repeat count may exceed line owner count.
    private var accCapacity = 0
    private var accX1 = FloatArray(0)
    private var accY1 = FloatArray(0)
    private var accX2 = FloatArray(0)
    private var accY2 = FloatArray(0)

    // Sort owners by their existing priority; each prepared repeat gets its own collision decision.
    private var lineCapacity = 0
    private var lineEffPrio = IntArray(0)
    private var lineOrder = IntArray(0)
    private var lineOrderLong = LongArray(0)
    private var acceptedLineIds = LongArray(0)
    private var acceptedLineX = FloatArray(0)
    private var acceptedLineY = FloatArray(0)
    private val lineLayoutStats = LongArray(MvtLabelCollisionMath.LINE_STATS_SIZE)
    private val lineStatsScratch = LongArray(MvtLabelCollisionMath.LINE_STATS_SIZE)
    // Per-frame id dedup for point labels: a place clipped across coarse parent + finer child keeps one id.
    private val pointIdSeen = HashSet<Long>()

    /** Labels accepted in the previous frame, read by this frame's stickiness check. */
    private var lastFrameVisible: HashSet<Label> = HashSet()
    /** Labels accepted in this frame. Swapped with [lastFrameVisible] by [endFrame]. */
    private var thisFrameVisible: HashSet<Label> = HashSet()
    /** Line labels accepted last/this frame — same stickiness as point labels, to stop edge blink. */
    private var lineLast: HashSet<MvtCurvedLineLabel> = HashSet()
    private var lineThis: HashSet<MvtCurvedLineLabel> = HashSet()

    private val cartesian = Vec3()
    private val screen = Vec3()
    private val textMetrics = AndroidMvtLabelMetrics()
    private val textOffset = Vec2()
    private val measuredBounds = FloatArray(4)

    /** Aggregate of MvtCurvedLineLabel.copyLayoutStatistics for the most recent collision pass. */
    fun copyLineLayoutStatistics(result: LongArray) {
        require(result.size >= lineLayoutStats.size)
        lineLayoutStats.copyInto(result)
    }

    /**
     * Run the collision pass. Updates each group's `enabledMask` in place. Caller is
     * expected to have computed [totalLabels] (summed across [activeLabelGroups]) so we
     * can right-size scratch arrays in one go.
     */
    fun run(
        rc: RenderContext,
        activeLabelGroups: List<MvtLabelGroup>,
        totalLabels: Int,
        dedup: LabelGeoDedup,
        lineLabels: List<MvtCurvedLineLabel>,
        lineDedup: LabelDedup,
    ) {
        ensureCapacity(totalLabels, lineLabels.size)
        lineLayoutStats.fill(0)
        val linePassToken = Any()
        rc.putUserProperty(MvtLabelCollisionMath.linePassKey, linePassToken)
        rc.putUserProperty(MvtLabelCollisionMath.lineMetricsKey, textMetrics)

        // Occlusion (over-the-horizon) cut: a place farther than this is behind the globe's curve.
        val maxLabelDist = rc.horizonDistance * labelHorizonFraction

        // Viewport bounds for the off-screen early-out. A label whose anchor sits more than
        // VIEWPORT_LABEL_MARGIN pixels past any edge is dropped before bbox compute —
        // perfectly invisible without wasting collision cycles on it.
        val vp = rc.viewport
        val vpMinX = vp.x - VIEWPORT_LABEL_MARGIN
        val vpMinY = vp.y - VIEWPORT_LABEL_MARGIN
        val vpMaxX = vp.x + vp.width + VIEWPORT_LABEL_MARGIN
        val vpMaxY = vp.y + vp.height + VIEWPORT_LABEL_MARGIN

        // Accepted-bbox count, shared across the point phase and the line phase below.
        var accCount = 0

        if (totalLabels == 0) {
            for (g in activeLabelGroups) g.enabledMask = null
        } else {
        pointIdSeen.clear()
        // Mercator circumference for the per-label slippy-zoom (minzoom eligibility) computation.
        val equatorialCircumference = 2.0 * PI * rc.globe.equatorialRadius

        var ci = 0
        for (gi in activeLabelGroups.indices) {
            val group = activeLabelGroups[gi]
            val existing = group.enabledMask
            val mask = if (existing != null && existing.size == group.labels.size) existing
            else BooleanArray(group.labels.size).also { group.enabledMask = it }
            for (i in mask.indices) mask[i] = false

            for (li in group.labels.indices) {
                val label = group.labels[li]
                groupIdx[ci] = gi
                labelIdx[ci] = li
                effPrio[ci] = group.priorities[li] + (if (label in lastFrameVisible) STICKINESS_BONUS else 0)

                // Mapbox/MapLibre placement: stage 1 = zoom eligibility, stage 2 = priority-ordered greedy
                // collision + budget. The CHEAP culls (empty text, occlusion, minzoom) run BEFORE the screen
                // projection so a coarse/far view skips the costly rc.project for the labels it rejects anyway
                // (e.g. a tile's thousands of housenumbers, minzoom 14, when zoomed out). These gates read
                // only the cartesian + camera distance — NOT the projection — so this reorders cost without
                // changing which labels survive.
                val text = label.text
                if (text.isNullOrEmpty()) {
                    visible[ci] = false; ci++; continue
                }
                val pos = label.position
                rc.geographicToCartesian(
                    pos.latitude, pos.longitude, 0.0,
                    AltitudeMode.ABSOLUTE, cartesian,
                )
                val dist = rc.cameraPoint.distanceTo(cartesian)
                // Occlusion cull: past the globe tangent the place is behind the curve (sky text).
                if (dist > maxLabelDist) {
                    visible[ci] = false; ci++; continue
                }
                // Stage 1 — zoom eligibility: the slippy zoom resolved at this label's globe location.
                val mpp = rc.pixelSizeAtDistance(dist)
                val effZoom = if (mpp > 0.0)
                    log2(equatorialCircumference * cos(pos.latitude.inRadians) / (LABEL_TILE_PX * mpp))
                else Double.MAX_VALUE
                // Top tiers (minzoom ≤ MAJOR) appear at their plain minzoom; minor places (towns/villages)
                // get the horizon bias subtracted so the far field thins to the important names without
                // hiding admin/capital labels.
                val mz = group.minZooms[li]
                val gate = if (mz <= MAJOR_PLACE_MINZOOM) effZoom else effZoom - labelZoomBias
                if (gate < mz) {
                    visible[ci] = false; ci++; continue
                }
                // Survived the cheap gates — only now pay for the projection + viewport cull + dedup + bbox.
                // Match Label.doRender's terrain anchor for screen-space collision. Keep the existing
                // low-cost distance/minzoom gates above; this patch does not change label eligibility.
                val altitudeMode = if (rc.globe.is2D) AltitudeMode.CLAMP_TO_GROUND else label.altitudeMode
                rc.geographicToCartesian(pos.latitude, pos.longitude, pos.altitude, altitudeMode, cartesian)
                if (!rc.project(cartesian, screen)) {
                    visible[ci] = false; ci++; continue
                }
                val sx = screen.x
                val sy = screen.y
                if (sx < vpMinX || sx > vpMaxX || sy < vpMinY || sy > vpMaxY) {
                    visible[ci] = false; ci++; continue
                }
                val attrs = if (label.isHighlighted) label.highlightAttributes ?: label.attributes else label.attributes
                val extent = textMetrics.measure(text, attrs)
                attrs.textOffset.offsetForSize(extent.width, extent.height, textOffset)
                MvtLabelCollisionMath.bounds(
                    sx, sy, extent.width, extent.height, textOffset.x, textOffset.y,
                    attrs.scale, COLLISION_PAD, measuredBounds,
                )
                bboxX1[ci] = measuredBounds[0]
                bboxY1[ci] = measuredBounds[1]
                bboxX2[ci] = measuredBounds[2]
                bboxY2[ci] = measuredBounds[3]
                visible[ci] = true
                ci++
            }
        }

        // Sort indices by [effPrio] descending: pack (priority, index) into Longs and sort once —
        // O(N log N), allocation-free (no boxing), priority non-negative so natural order works.
        for (i in 0 until totalLabels) orderLong[i] = (effPrio[i].toLong() shl 32) or i.toLong()
        orderLong.sort(0, totalLabels)
        for (i in 0 until totalLabels) order[i] = (orderLong[totalLabels - 1 - i] and 0xFFFFFFFFL).toInt()

        // Greedy accept-if-no-overlap, importance-ordered, capped at the per-view budget.
        for (k in 0 until totalLabels) {
            if (accCount >= labelBudget) break
            val idx = order[k]
            if (!visible[idx]) continue
            val x1 = bboxX1[idx]
            val y1 = bboxY1[idx]
            val x2 = bboxX2[idx]
            val y2 = bboxY2[idx]
            var collides = false
            for (j in 0 until accCount) {
                if (x1 < accX2[j] && x2 > accX1[j] && y1 < accY2[j] && y2 > accY1[j]) {
                    collides = true; break
                }
            }
            if (collides) continue
            // Dedup at ACCEPT time (priority order) so the highest-priority place instance wins and records
            // the id/anchor. By feature id when present (a clipped place keeps one id), else text + geographic
            // metres for id=0 (per-tile anchor quantization defeats screen-proximity dedup at high zoom).
            val gi = groupIdx[idx]
            val li = labelIdx[idx]
            val group = activeLabelGroups[gi]
            val label = group.labels[li]
            val text = label.text ?: continue
            val fid = group.featureIds[li]
            val pos = label.position
            // Major settlements (low minzoom) get the wide radius (collapses a 2–8 km node + relation-centroid
            // pair); minor places (high minzoom) keep the tight radius so distinct same-named villages survive.
            val dedupRadius = if (group.minZooms[li] <= MAJOR_PLACE_MINZOOM) labelGeoDedupMetersMajor else labelGeoDedupMeters
            val dup = if (fid != 0L) !pointIdSeen.add(fid)
            else dedup.isDuplicate(text, pos.latitude.inDegrees, pos.longitude.inDegrees, dedupRadius)
            if (dup) continue
            accX1[accCount] = x1; accY1[accCount] = y1
            accX2[accCount] = x2; accY2[accCount] = y2
            accCount++
            activeLabelGroups[gi].enabledMask!![li] = true
            thisFrameVisible += label
        }
        } // end point phase

        // ---- Curved line-label phase ----
        // Points already occupy acc*. A repeat is atomic: accept all its glyphs or none, while
        // other repeats and the separate road geometry remain eligible. Never use a midpoint proxy.
        val lineN = lineLabels.size
        if (lineN > 0) {
            var acceptedIdCount = 0
            val dedupRadiusSq = labelDedupRadius * labelDedupRadius
            for (i in 0 until lineN) {
                val l = lineLabels[i]
                l.collisionEnabled = false
                lineEffPrio[i] = l.priority + (if (l in lineLast) STICKINESS_BONUS else 0)
            }
            for (i in 0 until lineN) lineOrderLong[i] = (lineEffPrio[i].toLong() shl 32) or i.toLong()
            lineOrderLong.sort(0, lineN)
            for (i in 0 until lineN) lineOrder[i] = (lineOrderLong[lineN - 1 - i] and 0xFFFFFFFFL).toInt()
            for (k in 0 until lineN) {
                val line = lineLabels[lineOrder[k]]
                val repeats = line.prepareCollision(rc, textMetrics, linePassToken)
                for (repeat in 0 until repeats) {
                    line.copyRunBounds(repeat, measuredBounds)
                    if (MvtLabelCollisionMath.overlapsAccepted(measuredBounds, accX1, accY1, accX2, accY2, accCount)) continue
                    val sx = (measuredBounds[0] + measuredBounds[2]) * 0.5f
                    val sy = (measuredBounds[1] + measuredBounds[3]) * 0.5f
                    // Dedup only accepted, spatially coincident repeats; an id no longer disables
                    // every other occurrence of the same long way across visible tiles.
                    if (line.featureId != 0L) {
                        var duplicate = false
                        for (j in 0 until acceptedIdCount) {
                            if (acceptedLineIds[j] != line.featureId) continue
                            val dx = sx - acceptedLineX[j]; val dy = sy - acceptedLineY[j]
                            if (dx * dx + dy * dy < dedupRadiusSq) { duplicate = true; break }
                        }
                        if (duplicate) continue
                        ensureAcceptedLineCapacity(acceptedIdCount + 1)
                        acceptedLineIds[acceptedIdCount] = line.featureId
                        acceptedLineX[acceptedIdCount] = sx; acceptedLineY[acceptedIdCount] = sy
                        acceptedIdCount++
                    } else if (lineDedup.isDuplicate(line.text, sx, sy)) {
                        continue
                    }
                    ensureAccumulatorCapacity(accCount + 1)
                    accX1[accCount] = measuredBounds[0]; accY1[accCount] = measuredBounds[1]
                    accX2[accCount] = measuredBounds[2]; accY2[accCount] = measuredBounds[3]
                    accCount++
                    line.acceptCollisionRun(repeat)
                }
                if (line.collisionEnabled) lineThis += line
                line.copyLayoutStatistics(lineStatsScratch)
                for (i in lineLayoutStats.indices) lineLayoutStats[i] += lineStatsScratch[i]
            }
        }
    }

    /** Swap the visibility sets so this frame's accepted labels become next frame's
     *  stickiness candidates. Call after the group render pass. */
    fun endFrame() {
        val tmp = lastFrameVisible
        lastFrameVisible = thisFrameVisible
        thisFrameVisible = tmp
        thisFrameVisible.clear()
        val lt = lineLast
        lineLast = lineThis
        lineThis = lt
        lineThis.clear()
    }

    private fun ensureCapacity(pointN: Int, lineN: Int) {
        // Grow geometrically (2x) so collision sets that gradually expand don't repeatedly
        // hit the resize path. Point scratch, line scratch and the shared acc buffer grow
        // independently (acc must hold accepted points + accepted lines).
        if (pointN > capacity) {
            val cap = maxOf(pointN, capacity * 2, 16)
            capacity = cap
            groupIdx = IntArray(cap)
            labelIdx = IntArray(cap)
            effPrio = IntArray(cap)
            order = IntArray(cap)
            orderLong = LongArray(cap)
            bboxX1 = FloatArray(cap)
            bboxY1 = FloatArray(cap)
            bboxX2 = FloatArray(cap)
            bboxY2 = FloatArray(cap)
            visible = BooleanArray(cap)
        }
        ensureAccumulatorCapacity(pointN + lineN)
        if (lineN > lineCapacity) {
            val cap = maxOf(lineN, lineCapacity * 2, 16)
            lineCapacity = cap
            lineEffPrio = IntArray(cap)
            lineOrder = IntArray(cap)
            lineOrderLong = LongArray(cap)
        }
    }

    private fun ensureAccumulatorCapacity(required: Int) {
        if (required <= accCapacity) return
        val size = maxOf(required, accCapacity * 2, 16)
        accCapacity = size
        accX1 = accX1.copyOf(size); accY1 = accY1.copyOf(size)
        accX2 = accX2.copyOf(size); accY2 = accY2.copyOf(size)
    }

    private fun ensureAcceptedLineCapacity(required: Int) {
        if (required <= acceptedLineIds.size) return
        val size = maxOf(required, acceptedLineIds.size * 2, 16)
        acceptedLineIds = acceptedLineIds.copyOf(size)
        acceptedLineX = acceptedLineX.copyOf(size)
        acceptedLineY = acceptedLineY.copyOf(size)
    }

    private companion object {
        // Collision bbox sizing: line-height as a multiple of pixel size, plus a small fixed pad.
        const val COLLISION_LINE_H = 1.3f
        // Padding around each accepted bbox; visible separation without over-suppression.
        const val COLLISION_PAD = 3f // small, exact: width is now measured, not estimated (was 12 to hide the estimate)
        // Priority bonus given to last-frame-visible labels during this frame's collision.
        // 1 is enough to break ties between same-priority candidates without overriding the
        // hierarchy across actual zOrder bands (band spacing is 10 in MvtStyle.Z_*).
        const val STICKINESS_BONUS = 1
        // Margin past each viewport edge a label anchor may sit and still be considered (bbox may straddle).
        const val VIEWPORT_LABEL_MARGIN: Double = 80.0
        // Web-Mercator tile size (px) — the reference for the per-label slippy-zoom (minzoom) computation.
        const val LABEL_TILE_PX: Double = 256.0
        // Cities (minzoom ≤ this) appear at their standard minzoom; only towns/villages keep the horizon
        // bias. Cities still thin toward the horizon via their own per-label effective zoom failing minzoom.
        const val MAJOR_PLACE_MINZOOM: Int = 8
    }
}

/** Occlusion cull: drop labels past this fraction of the camera-to-horizon (globe-tangent) distance —
 *  beyond it the place is over the curve (sky text). Tier density is the style rules' per-zoom job. */
internal var labelHorizonFraction = 0.82

/** Zoom levels subtracted from a minor place's effective zoom before the minzoom check — the horizon
 *  thinner. Higher = sparser towns/villages (the far field and foreground both keep only major names);
 *  0 = pure minzoom cartography. Country/region/capital/city (minzoom ≤ [MvtLabelCollider.Companion.
 *  MAJOR_PLACE_MINZOOM]) are exempt, so this never hides them. */
internal var labelZoomBias = 4.0

/** Max labels the whole frame shows — the most important (population-ordered) non-overlapping ones
 *  survive. A safety cap on top of the zoom gate + collision; raise to show more names at once. */
internal var labelBudget = 200

/** Screen radius within which two same-text labels are treated as the same place and deduped. */
internal var labelDedupRadius = 30f

/** Tight id=0 cross-tile dedup tolerance for MINOR places (high minzoom): under the spacing of distinct
 *  same-named villages, so it merges duplicates without collapsing genuinely separate ones. */
internal var labelGeoDedupMeters = 1000.0

/** Wide id=0 cross-tile dedup tolerance for MAJOR settlements (low minzoom): sparse and uniquely named, so
 *  a generous radius collapses the 2–8 km place-NODE + boundary-RELATION-centroid pair without false merges. */
internal var labelGeoDedupMetersMajor = 12_000.0

/** Lean cross-tile symbol dedup (à la Mapbox `CrossTileSymbolIndex`): the same place reaching the
 *  frame from overlapping tiles — a coarse tile and its finer child in the progressive cut, or two
 *  tiles sharing an edge — lands a few px apart and must render once. Keyed on text + screen
 *  proximity; the first instance wins, later ones are dropped. One instance per frame, cleared by
 *  the caller; shared by the cross-tile pass and the per-tile fallback so both paths dedup. */
internal class LabelDedup {
    private val byText = HashMap<String, MutableList<Float>>() // text → flat [x0,y0,x1,y1,…] of kept anchors
    fun clear() = byText.clear()
    /** True if a same-text label already sits within [labelDedupRadius] of (x,y); else records it. */
    fun isDuplicate(text: String, x: Float, y: Float): Boolean {
        val kept = byText.getOrPut(text) { ArrayList(4) }
        val r2 = labelDedupRadius * labelDedupRadius
        var i = 0
        while (i < kept.size) {
            val dx = x - kept[i]; val dy = y - kept[i + 1]
            if (dx * dx + dy * dy < r2) return true
            i += 2
        }
        kept.add(x); kept.add(y)
        return false
    }
}

/** Geographic sibling of [LabelDedup] for POINT labels: keyed on text + a zoom-independent metres tolerance
 *  instead of screen pixels, so it collapses a coarse parent + finer child whose quantized anchors project
 *  far apart at high zoom. First instance wins; one per frame, cleared by the caller; id=0 sources only. */
internal class LabelGeoDedup {
    private val byText = HashMap<String, MutableList<Double>>() // text → flat [lat°,lon°,…] of kept anchors
    fun clear() = byText.clear()
    /** True if a same-text label already sits within [radiusMeters] of (lat,lon); else records it. */
    fun isDuplicate(text: String, lat: Double, lon: Double, radiusMeters: Double): Boolean {
        val kept = byText.getOrPut(text) { ArrayList(4) }
        val mPerDeg = 111_320.0
        val lonScale = mPerDeg * cos(lat * PI / 180.0) // local-equirectangular metres (cheap, no globe)
        val r2 = radiusMeters * radiusMeters
        var i = 0
        while (i < kept.size) {
            val dLat = (lat - kept[i]) * mPerDeg
            val dLon = (lon - kept[i + 1]) * lonScale
            if (dLat * dLat + dLon * dLon < r2) return true
            i += 2
        }
        kept.add(lat); kept.add(lon)
        return false
    }
}
