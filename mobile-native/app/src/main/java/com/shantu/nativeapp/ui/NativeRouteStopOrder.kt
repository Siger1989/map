package com.shantu.nativeapp.ui

/** Small pure helper so stop reordering can be verified without Android views. */
object NativeRouteStopOrder {
    fun <T> move(stops: List<T>, index: Int, delta: Int): List<T> {
        require(delta == -1 || delta == 1) { "delta must move one position" }
        if (index !in stops.indices) return stops
        val target = index + delta
        if (target !in stops.indices) return stops
        return stops.toMutableList().also { values ->
            val item = values[index]
            values[index] = values[target]
            values[target] = item
        }
    }
}
