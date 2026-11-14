package com.shantu.nativeapp.hybrid

import com.shantu.nativeapp.map.NativeCameraSnapshot
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.max

/** Only camera placement uses the ellipsoid when a distant terrain mesh is not loaded.
 * Business picking and GPS are deliberately not routed through this policy. */
internal object NativeCameraOffsetPolicy {
    data class Solution(val pose: NativeCameraSnapshot, val errorPixels: Double, val evaluations: Int)

    /** Bounded screen-space solve. A globe is not a latitude/longitude plane:
     * reject any candidate that makes the screen error worse or hides the target.
     * The callback projects against the candidate's real current-camera transform. */
    fun solve(initial: NativeCameraSnapshot, seed: NativeCameraSnapshot?, x: Double, y: Double,
              project: (NativeCameraSnapshot) -> Pair<Double, Double>?): Solution {
        var evaluations = 0
        fun evaluate(pose: NativeCameraSnapshot): Pair<Double, Double>? {
            evaluations++
            return project(pose)?.takeIf { it.first.isFinite() && it.second.isFinite() }
        }
        fun error(point: Pair<Double, Double>) = hypot(point.first - x, point.second - y)
        var best = initial
        var point = evaluate(initial) ?: return Solution(initial, Double.POSITIVE_INFINITY, evaluations)
        var bestError = error(point)
        if (!x.isFinite() || !y.isFinite()) return Solution(initial, Double.POSITIVE_INFINITY, evaluations)
        if (bestError <= 1.5) return Solution(best, bestError, evaluations)
        if (seed != null) evaluate(seed)?.let { candidate ->
            val value = error(candidate)
            if (value < bestError) { best = seed; point = candidate; bestError = value }
        }
        for (iteration in 0 until 6) {
            if (bestError <= 1.5) break
            val step = (best.rangeMeters / 111_320.0 * 0.01).coerceIn(0.00001, 0.25)
            val latStep = if (best.latitude + step >= 89.999999) -step else step
            val latitudePoint = evaluate(best.copy(latitude = best.latitude + latStep)) ?: break
            val longitudePoint = evaluate(best.copy(longitude = wrap(best.longitude + step))) ?: break
            val ax = (latitudePoint.first - point.first) / latStep
            val ay = (latitudePoint.second - point.second) / latStep
            val bx = (longitudePoint.first - point.first) / step
            val by = (longitudePoint.second - point.second) / step
            val determinant = ax * by - ay * bx
            if (!determinant.isFinite() || abs(determinant) < 1e-10) break
            val ex = x - point.first; val ey = y - point.second
            var dLat = (ex * by - ey * bx) / determinant
            var dLon = (ax * ey - ay * ex) / determinant
            if (!dLat.isFinite() || !dLon.isFinite()) break
            val span = max(abs(dLat), abs(dLon))
            if (span > 20.0) { dLat *= 20.0 / span; dLon *= 20.0 / span }
            var accepted = false
            for (fraction in doubleArrayOf(1.0, 0.5, 0.25, 0.125)) {
                val candidate = best.copy(latitude = (best.latitude + dLat * fraction).coerceIn(-89.999999, 89.999999),
                    longitude = wrap(best.longitude + dLon * fraction))
                val candidatePoint = evaluate(candidate) ?: continue
                val candidateError = error(candidatePoint)
                if (candidateError + 0.001 < bestError) {
                    best = candidate; point = candidatePoint; bestError = candidateError; accepted = true; break
                }
            }
            if (!accepted) break
        }
        return Solution(best, bestError, evaluations)
    }

    private fun wrap(value: Double) = ((value + 180.0) % 360.0 + 360.0) % 360.0 - 180.0

    fun ground(terrain: () -> Pair<Double, Double>?, ellipsoid: () -> Pair<Double, Double>?): Pair<Double, Double>? {
        fun valid(point: Pair<Double, Double>?) = point?.takeIf {
            it.first.isFinite() && it.first in -90.0..90.0 && it.second.isFinite()
        }
        return valid(terrain()) ?: valid(ellipsoid())
    }

    fun translated(pose: NativeCameraSnapshot, latitude: Double, longitude: Double, ground: Pair<Double, Double>): NativeCameraSnapshot? {
        val dLat = latitude - ground.first
        val dLon = ((longitude - ground.second + 540.0) % 360.0) - 180.0
        if (abs(dLat) < 1e-8 && abs(dLon) < 1e-8) return null
        return pose.copy(latitude = (pose.latitude + dLat).coerceIn(-89.999999, 89.999999), longitude = pose.longitude + dLon)
    }
}
