package com.shantu.nativeapp.map

internal data class NativeContourProjectedFootprint(
    val distanceFromFocusPx: Double,
    val minimumVisibleExtentPx: Double,
) {
    val containsFocus get() = distanceFromFocusPx == 0.0
}

/**
 * Latches far-field generation when the currently rendered contour cut approaches its byte cap.
 * It never drops loaded tiles or changes their geometry; it only keeps far queued work suspended
 * before it receives a preparation permit and starts DEM sampling/assembly.
 */
internal class NativeContourVisibleBudgetPolicy(
    private val capacityBytes: Long,
    private val pressureFramesToRaise: Int = 2,
    private val recoveryStableNanos: Long = 30_000_000_000L,
) {
    private var pressureFrames = 0
    private var lowPressureSinceNanos: Long? = null
    private var level = 0

    init {
        require(capacityBytes > 0)
        require(pressureFramesToRaise > 0 && recoveryStableNanos > 0)
    }

    /** Observes unique bytes from the rendered cut; recovery requires a quiet queue and 30s stable. */
    fun observe(visibleBytes: Long, nowNanos: Long, generationWorkPending: Boolean): Int {
        val ratio = visibleBytes.coerceAtLeast(0L).toDouble() / capacityBytes
        if (ratio >= RAISE_THRESHOLDS[level]) {
            lowPressureSinceNanos = null
            pressureFrames++
            if (pressureFrames >= pressureFramesToRaise && level < MAX_LEVEL) {
                level++
                pressureFrames = 0
            }
            return level
        }

        pressureFrames = 0
        if (level == 0 || ratio > LOWER_THRESHOLDS[level] || generationWorkPending) {
            lowPressureSinceNanos = null
            return level
        }

        val since = lowPressureSinceNanos
        if (since == null || nowNanos < since) {
            lowPressureSinceNanos = nowNanos
        } else if (nowNanos - since >= recoveryStableNanos) {
            level--
            lowPressureSinceNanos = nowNanos
        }
        return level
    }

    /** Distance and thickness are measured on the clipped projected footprint, never its center. */
    fun shouldDefer(footprint: NativeContourProjectedFootprint?, viewportWidthPx: Int, viewportHeightPx: Int): Boolean {
        if (level == 0 || footprint == null || !footprint.distanceFromFocusPx.isFinite() ||
            !footprint.minimumVisibleExtentPx.isFinite() || viewportWidthPx <= 0 || viewportHeightPx <= 0 ||
            footprint.minimumVisibleExtentPx < 0.0 || footprint.containsFocus) return false
        val shortSide = minOf(viewportWidthPx, viewportHeightPx).toDouble()
        val distance = footprint.distanceFromFocusPx
        val protectedFocusRadius = shortSide * PROTECTED_FOCUS_RADIUS
        if (distance <= protectedFocusRadius) return false
        val nearFocusRadius = shortSide * NEAR_FOCUS_RADII[level]
        if (distance > nearFocusRadius) return true
        // At steep tilt, horizon tiles can lie close to screen center while collapsing into a
        // narrow strip. Treat thin projected patches as far-field once outside the focus core.
        val thinExtentLimit = shortSide * THIN_EXTENT_LIMITS[level]
        return footprint.minimumVisibleExtentPx < thinExtentLimit
    }

    fun level(): Int = level

    companion object {
        const val MAX_LEVEL = 3
        private const val PROTECTED_FOCUS_RADIUS = 0.12
        private val RAISE_THRESHOLDS = doubleArrayOf(0.60, 0.75, 0.90, Double.POSITIVE_INFINITY)
        private val LOWER_THRESHOLDS = doubleArrayOf(0.0, 0.45, 0.55, 0.70)
        private val NEAR_FOCUS_RADII = doubleArrayOf(0.0, 0.60, 0.45, 0.32)
        private val THIN_EXTENT_LIMITS = doubleArrayOf(0.0, 0.06, 0.10, 0.14)
    }
}
