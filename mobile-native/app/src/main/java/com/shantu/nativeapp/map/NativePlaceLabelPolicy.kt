package com.shantu.nativeapp.map

import kotlin.math.log2

/** Extra foreground preference, applied before the SDK's normal minzoom/collision/dedup pass. */
internal object NativePlaceLabelPolicy {
    /** Keep WorldWind 2.1.1's population/kind tiers, including its hidden administrative names. */
    fun minimumZoom(props: Map<String, Any?>): Int {
        if (props.containsKey("housenumber")) return 14
        val kind = (props["class"] ?: props["kind"] ?: props["subclass"])?.toString()
        val population = (props["population"] as? Number)?.toDouble()
        val defaultPopulation = when (kind) {
            "capital" -> 1_000_000.0
            "state_capital" -> 250_000.0
            "city" -> 150_000.0
            "town" -> 20_000.0
            "village" -> 2_000.0
            "suburb", "borough" -> 5_000.0
            "quarter", "neighbourhood" -> 1_000.0
            "hamlet", "locality", "isolated_dwelling", "farm" -> 200.0
            else -> null
        }
        if (population == null && defaultPopulation == null) {
            (props["admin_level"] as? Number)?.toDouble()?.let { return if (it <= 2) 4 else 99 }
            when (kind) {
                "continent" -> return 3
                "country" -> return 4
                "state", "province", "region" -> return 99
            }
            (props["rank"] as? Number)?.toInt()?.let { return (it - 1).coerceIn(4, 15) }
        }
        val pop = population ?: defaultPopulation ?: 200.0
        return when {
            pop >= 5_000_000 -> 3
            pop >= 1_000_000 -> 4
            pop >= 500_000 -> 5
            pop >= 200_000 -> 6
            pop >= 100_000 -> 7
            pop >= 50_000 -> 8
            pop >= 20_000 -> 9
            pop >= 10_000 -> 10
            pop >= 2_000 -> 11
            else -> 12
        }
    }

    /** Same ordering as the fixed SDK, so the extra distance gate does not invert collision priority. */
    fun priority(props: Map<String, Any?>): Int {
        val population = (props["population"] as? Number)?.toLong()
        if (population != null && population > 0) return 1_000_000 + population.coerceAtMost(Int.MAX_VALUE.toLong() - 1_000_000).toInt()
        ((props["rank"] ?: props["symbolrank"]) as? Number)?.toInt()?.let { return 1_000_000 - it.coerceIn(0, 999) * 1000 }
        return when ((props["class"] ?: props["kind"] ?: props["subclass"])?.toString()) {
            "country" -> 900_000
            "state", "province", "region" -> 800_000
            "city", "capital" -> 700_000
            "town" -> 500_000
            "village" -> 300_000
            "suburb", "neighbourhood", "quarter", "borough" -> 200_000
            "hamlet", "locality", "isolated_dwelling", "farm" -> 100_000
            else -> 50_000
        }
    }

    /**
     * Distances are to the label and to the actual look-at point, not screen Y or a fixed kilometre cap.
     * The near band keeps the existing SDK eligibility. Further away, smaller places lose up to
     * three extra zoom levels, then leave at a tier-specific distance. A small exit margin avoids
     * flicker while hovering at a boundary. Invalid frame measurements leave the SDK in control.
     */
    fun keep(minZoom: Int, effectiveZoom: Double, distanceRatio: Double, previouslyKept: Boolean): Boolean {
        if (!effectiveZoom.isFinite() || !distanceRatio.isFinite() || distanceRatio <= 0) return true
        if (distanceRatio <= 1.5) return true
        val maximumRatio = when {
            minZoom <= 4 -> 12.0
            minZoom <= 8 -> 6.0
            minZoom <= 10 -> 4.0
            else -> 2.5
        }
        if (distanceRatio > maximumRatio * if (previouslyKept) 1.08 else 1.0) return false
        val extraBias = (log2(distanceRatio / 1.5) * 2.0).coerceIn(0.0, 3.0)
        // The SDK already subtracts four zoom levels from minor names. Preserve that near policy.
        val sdkBias = if (minZoom > 8) 4.0 else 0.0
        val exitMargin = if (previouslyKept) .25 else 0.0
        return effectiveZoom - sdkBias + exitMargin >= minZoom + extraBias
    }
}
