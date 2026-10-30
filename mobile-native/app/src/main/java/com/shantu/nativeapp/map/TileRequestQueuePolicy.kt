package com.shantu.nativeapp.map

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred

/** Stable logical tile identity. authNamespace must be a non-secret account/config fingerprint. */
internal data class TileRequestIdentity(
    val sourceId: String,
    val layerId: String,
    val z: Int,
    val x: Int,
    val y: Int,
    val styleNamespace: String,
    val authNamespace: String,
) {
    /** Hashed key is safe for cache filenames/telemetry and deliberately excludes request URL aliases. */
    val cacheKey: String by lazy(LazyThreadSafetyMode.PUBLICATION) {
        val fields = listOf(sourceId, layerId, z.toString(), x.toString(), y.toString(), styleNamespace, authNamespace)
        val canonical = fields.joinToString(separator = "") { field -> "${field.length}:$field;" }
        "tile-v1:" + sha256Hex(canonical.toByteArray(Charsets.UTF_8))
    }
}

/** Complete immutable-by-contract viewport ranking update; values are screen-projection pixel distances. */
internal data class TileViewDemand(
    val viewId: String,
    val generation: Long,
    val visible: Boolean,
    val ranks: Map<TileRequestIdentity, Double>,
    val inactiveIdentities: Set<TileRequestIdentity> = emptySet(),
)

/** A queued request keeps its original view generation; the scheduler compares it with the latest demand. */
internal data class TilePendingRequest(
    val sequence: Long,
    val viewId: String?,
    val generation: Long?,
    val enqueuedAtNanos: Long,
    val identity: TileRequestIdentity,
    val background: Boolean = false,
    val allowForegroundPromotion: Boolean = false,
    val respectInactiveLayers: Boolean = true,
)

/**
 * Deterministic selection policy for not-yet-started requests. It reads current viewport snapshots on every
 * selection, so pan/zoom can reorder queued work without interrupting an active HTTP request. A bounded burst
 * shares admission between simultaneously visible views; hidden/idle work is considered only after foreground.
 */
internal class TileRequestQueuePolicy(private val maxSameViewBurst: Int = DEFAULT_MAX_SAME_VIEW_BURST) {
    init { require(maxSameViewBurst > 0) }

    private var lastSelectedView: String? = null
    private var sameViewBurst = 0

    @Synchronized
    fun selectNext(
        pending: Collection<TilePendingRequest>,
        demands: Map<String, TileViewDemand>,
        @Suppress("UNUSED_PARAMETER") nowNanos: Long,
    ): TilePendingRequest? {
        if (pending.isEmpty()) return null

        val foreground = pending.filter { isForeground(it, demands) }
        val candidates = if (foreground.isNotEmpty()) foreground else pending.toList()
        val otherView = if (foreground.isNotEmpty() && sameViewBurst >= maxSameViewBurst && lastSelectedView != null) {
            foreground.asSequence().filter { foregroundView(it, demands) != lastSelectedView }.minWithOrNull(
                compareBy<TilePendingRequest> { foregroundRank(it, demands) }.thenBy { it.sequence },
            )
        } else null
        val selected = otherView ?: candidates.minWithOrNull(
            compareBy<TilePendingRequest> { foregroundRank(it, demands) }.thenBy { it.sequence },
        ) ?: return null

        val selectedView = foregroundView(selected, demands)
        if (selectedView == null || selectedView != lastSelectedView) {
            lastSelectedView = selectedView
            sameViewBurst = 1
        } else {
            sameViewBurst++
        }
        return selected
    }

    internal fun isForeground(request: TilePendingRequest, demands: Map<String, TileViewDemand>): Boolean = foregroundView(request, demands) != null

    /** Suppress only an explicitly inactive owner when no other currently visible view needs this identity. */
    internal fun isSuppressed(
        request: TilePendingRequest,
        demands: Map<String, TileViewDemand>,
        removedViewIds: Set<String> = emptySet(),
    ): Boolean {
        if (!request.respectInactiveLayers) return false
        val ownerViewId = request.viewId ?: return false
        val owner = demands[ownerViewId]
        val ownerInactive = owner?.let { !it.visible || request.identity in it.inactiveIdentities } == true
        val ownerRemoved = owner == null && ownerViewId in removedViewIds
        if (!ownerInactive && !ownerRemoved) return false
        return demands.values.none { demand ->
            demand.visible && demand.ranks[request.identity]?.let { it.isFinite() && it >= 0.0 } == true
        }
    }

    internal fun foregroundView(request: TilePendingRequest, demands: Map<String, TileViewDemand>): String? {
        if (request.background && !request.allowForegroundPromotion) return null
        if (request.viewId == null && !request.allowForegroundPromotion) return UNSCOPED_FOREGROUND_VIEW_ID
        return demands.values.asSequence()
            .filter { it.visible }
            .mapNotNull { demand ->
                val rank = demand.ranks[request.identity]?.takeIf { it.isFinite() && it >= 0.0 } ?: return@mapNotNull null
                demand.viewId to rank
            }
            .minWithOrNull(compareBy<Pair<String, Double>> { it.second }.thenBy { it.first })
            ?.first
    }

    internal fun foregroundRank(request: TilePendingRequest, demands: Map<String, TileViewDemand>): Double {
        if (request.background && !request.allowForegroundPromotion) return Double.POSITIVE_INFINITY
        if (request.viewId == null && !request.allowForegroundPromotion) return Double.POSITIVE_INFINITY
        return demands.values.asSequence()
            .filter { it.visible }
            .mapNotNull { it.ranks[request.identity]?.takeIf { rank -> rank.isFinite() && rank >= 0.0 } }
            .minOrNull() ?: Double.POSITIVE_INFINITY
    }

    internal companion object {
        const val DEFAULT_MAX_SAME_VIEW_BURST = 8
        const val UNSCOPED_FOREGROUND_VIEW_ID = "<unscoped-foreground>"
    }
}

/** A single bounded admission queue for foreground, background and refresh traffic. */
internal class TileRequestPermitScheduler(
    private val capacity: Int = DEFAULT_CAPACITY,
    private val maxQueued: Int = DEFAULT_MAX_QUEUED,
    private val demands: () -> Map<String, TileViewDemand>,
    private val policy: TileRequestQueuePolicy = TileRequestQueuePolicy(),
    private val removedViewIds: () -> Set<String> = { emptySet() },
) {
    private data class Waiter(val request: TilePendingRequest, val ready: CompletableDeferred<TileRequestPermit?>)

    data class TileRequestPermit internal constructor(val sequence: Long, val background: Boolean)

    private val lock = Any()
    private val waiters = mutableListOf<Waiter>()
    private var active = 0
    private var activeBackground = 0
    private val activePermits = mutableMapOf<Long, Boolean>()
    private var closed = false

    init { require(capacity > 0); require(maxQueued > 0) }

    suspend fun acquire(request: TilePendingRequest): TileRequestPermit? {
        val waiter = Waiter(request, CompletableDeferred())
        synchronized(lock) {
            if (closed || waiters.size >= maxQueued || policy.isSuppressed(request, demands(), removedViewIds())) return null
            waiters += waiter
            dispatchLocked()
        }
        return try {
            waiter.ready.await()
        } catch (cancelled: CancellationException) {
            synchronized(lock) {
                if (waiters.remove(waiter)) dispatchLocked()
                else {
                    val granted = activePermits.remove(request.sequence)
                    if (granted != null) {
                        active = (active - 1).coerceAtLeast(0)
                        if (granted) activeBackground = (activeBackground - 1).coerceAtLeast(0)
                    }
                    dispatchLocked()
                }
            }
            throw cancelled
        }
    }

    fun onDemandChanged() = synchronized(lock) { dispatchLocked() }

    fun release(permit: TileRequestPermit) = synchronized(lock) {
        val background = activePermits.remove(permit.sequence) ?: return@synchronized
        if (active > 0) active--
        if (background) activeBackground = (activeBackground - 1).coerceAtLeast(0)
        dispatchLocked()
    }

    fun close() = synchronized(lock) {
        closed = true
        waiters.toList().also { waiters.clear() }.forEach { it.ready.complete(null) }
    }

    fun activeCount(): Int = synchronized(lock) { active }
    fun activeBackgroundCount(): Int = synchronized(lock) { activeBackground }
    fun queuedCount(): Int = synchronized(lock) { waiters.size }

    private fun dispatchLocked() {
        if (closed) return
        val currentDemands = demands()
        val currentRemovedViews = removedViewIds()
        val suppressed = waiters.filter { policy.isSuppressed(it.request, currentDemands, currentRemovedViews) }
        suppressed.forEach { waiter ->
            waiters.remove(waiter)
            waiter.ready.complete(null)
        }
        while (active < capacity && waiters.isNotEmpty()) {
            val liveDemands = demands()
            val frontQueued = waiters.any { isForeground(it.request, liveDemands) }
            if (!frontQueued && activeBackground >= MAX_BACKGROUND_ACTIVE) return
            if (!frontQueued && active >= capacity - MAX_BACKGROUND_ACTIVE) return
            val eligible = if (frontQueued) waiters.filter { isForeground(it.request, liveDemands) } else waiters
            val request = policy.selectNext(eligible.map { it.request }, liveDemands, System.nanoTime()) ?: return
            val waiter = waiters.firstOrNull { it.request === request || it.request == request } ?: return
            waiters.remove(waiter)
            active++
            val background = !isForeground(request, liveDemands)
            activePermits[request.sequence] = background
            if (background) activeBackground++
            waiter.ready.complete(TileRequestPermit(request.sequence, background))
        }
    }

    private fun isForeground(request: TilePendingRequest, currentDemands: Map<String, TileViewDemand>): Boolean {
        return policy.isForeground(request, currentDemands)
    }

    internal companion object {
        const val DEFAULT_CAPACITY = 20
        const val DEFAULT_MAX_QUEUED = 256
        const val MAX_BACKGROUND_ACTIVE = 2
    }
}
