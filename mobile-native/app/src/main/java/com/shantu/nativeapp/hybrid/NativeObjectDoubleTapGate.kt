package com.shantu.nativeapp.hybrid

/** Pairs only nearby, single-pointer taps whose top native business pick is the same object. */
internal class NativeObjectDoubleTapGate(
    private val timeoutMs: Long = 300L,
    private val slopPx: Float = 48f,
) {
    enum class State { SINGLE, PENDING, MATCH, DIFFERENT }
    data class Resolution(
        val state: State,
        val objectId: String? = null,
        val secondEventTime: Long? = null,
        val secondX: Float? = null,
        val secondY: Float? = null,
    )
    private data class Tap(val eventTime: Long, val x: Float, val y: Float, val objectId: String?, val resolved: Boolean)

    companion object {
        /** Mirrors NativeTapSemantics: annotation, route, track, then area. */
        fun primaryObjectId(
            ids: List<String>, annotationIds: Set<String>, routeIds: Set<String>,
            trackIds: Set<String>, areaIds: Set<String>,
        ): String? {
            fun selected(kind: String, expected: Set<String>, accepts: (String, String) -> Boolean): String? =
                expected.firstNotNullOfOrNull { id -> ids.firstOrNull { hit -> accepts(hit, id) }?.let { "$kind:$id" } }
            selected("annotation", annotationIds) { hit, id -> hit == id || hit == "shantu-object:$id" || hit == "annotation:$id" }?.let { return it }
            selected("route", routeIds) { hit, id -> hit == id || hit == "route:$id" || hit.startsWith("route:$id:") }?.let { return it }
            selected("track", trackIds) { hit, id -> hit == id || hit == "track:$id" || hit.startsWith("track:$id:") }?.let { return it }
            return selected("area", areaIds) { hit, id -> hit == id || hit == "area:$id" }
        }
    }

    private var previous: Tap? = null
    private var candidate: Tap? = null
    val isCandidateActive: Boolean get() = candidate != null
    fun isResolvingEarlierTap(eventTime: Long): Boolean = candidate?.let { eventTime < it.eventTime } == true

    /** Reserve ACTION_UP before asynchronous native pick results return. */
    fun noteTap(eventTime: Long, x: Float, y: Float, enabled: Boolean) {
        if (!enabled) { cancel(); return }
        if (candidate != null) return
        previous = Tap(eventTime, x, y, null, false)
    }

    /** Called at the real ACTION_DOWN, before the candidate's camera events are forwarded. */
    fun begin(eventTime: Long, x: Float, y: Float, pointerCount: Int, enabled: Boolean): Boolean {
        candidate = null
        if (!enabled || pointerCount != 1) { cancel(); return false }
        val first = previous ?: return false
        if (first.resolved && first.objectId.isNullOrBlank()) { previous = null; return false }
        val elapsed = eventTime - first.eventTime
        if (elapsed < 0L || elapsed > timeoutMs ||
            kotlin.math.hypot((x - first.x).toDouble(), (y - first.y).toDouble()) > slopPx) return false
        candidate = Tap(eventTime, x, y, null, false)
        return true
    }

    /** Results are matched by their real eventTime, so out-of-order GPU callbacks remain safe. */
    fun resolve(eventTime: Long, x: Float, y: Float, objectId: String?, enabled: Boolean): Resolution {
        val second = candidate
        val first = previous
        if (!enabled) { cancel(); return Resolution(State.DIFFERENT) }
        if (second == null) {
            previous = Tap(eventTime, x, y, objectId?.takeIf(String::isNotBlank), true)
            return Resolution(State.SINGLE)
        }
        if (eventTime < second.eventTime) {
            previous = Tap(eventTime, x, y, objectId?.takeIf(String::isNotBlank), true)
            if (!second.resolved) return Resolution(State.PENDING, secondEventTime = second.eventTime, secondX = second.x, secondY = second.y)
            return finishPair(first = previous, second = second, secondId = second.objectId)
        }
        if (eventTime - first?.eventTime.orZero() > timeoutMs ||
            kotlin.math.hypot((x - second.x).toDouble(), (y - second.y).toDouble()) > slopPx) {
            candidate = null
            previous = Tap(eventTime, x, y, objectId?.takeIf(String::isNotBlank), true)
            return Resolution(State.DIFFERENT)
        }
        candidate = second.copy(eventTime = eventTime, x = x, y = y, objectId = objectId?.takeIf(String::isNotBlank), resolved = true)
        if (first == null || !first.resolved) return Resolution(State.PENDING, secondEventTime = second.eventTime, secondX = second.x, secondY = second.y)
        return finishPair(first, candidate!!, candidate!!.objectId)
    }

    fun expire(nowEventTime: Long, maxWaitMs: Long = 450L): Boolean {
        val second = candidate ?: return false
        if (nowEventTime - second.eventTime < maxWaitMs) return false
        cancel()
        return true
    }

    private fun finishPair(first: Tap?, second: Tap, secondId: String?): Resolution {
        candidate = null
        previous = second.takeIf { !secondId.isNullOrBlank() }
        val same = first?.objectId?.takeIf { it == secondId }
        return if (same != null) {
            previous = null
            Resolution(State.MATCH, same, second.eventTime, second.x, second.y)
        } else Resolution(State.DIFFERENT, secondEventTime = second.eventTime, secondX = second.x, secondY = second.y)
    }

    private fun Long?.orZero(): Long = this ?: 0L

    fun cancel() { candidate = null; previous = null }
}
