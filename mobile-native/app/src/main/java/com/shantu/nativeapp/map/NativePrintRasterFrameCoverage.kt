package com.shantu.nativeapp.map

import earth.worldwind.geom.Location
import earth.worldwind.draw.Drawable
import earth.worldwind.draw.DrawContext
import earth.worldwind.layer.mercator.MercatorSector
import earth.worldwind.layer.mercator.MercatorTiledSurfaceImage
import earth.worldwind.layer.mercator.MercatorTileFactory
import earth.worldwind.render.RenderContext
import earth.worldwind.render.Texture
import earth.worldwind.render.image.ImageConfig
import earth.worldwind.render.image.ImageOptions
import earth.worldwind.render.image.ImageTile
import earth.worldwind.render.image.ImageSource
import earth.worldwind.util.LevelSet

/** Per-frame proof of which visible print-image leaves had their own texture vs an ancestor fallback. */
internal data class NativePrintRasterFrameSnapshot(
    val sequence: Long = 0,
    val visibleLeafKeys: Set<String> = emptySet(),
    val texturedLeafKeys: Set<String> = emptySet(),
    val visibleMaxLevel: Int = -1,
    val texturedMaxLevel: Int = -1,
    val textureCacheUsedBytes: Long = 0,
    val textureCacheCapacityBytes: Long = 0,
    val textureCacheEntries: Int = 0,
    val visibleLeafLevels: Map<Int, Int> = emptyMap(),
    val texturedLeafLevels: Map<Int, Int> = emptyMap(),
) {
    val visibleLeafCount get() = visibleLeafKeys.size
    val texturedLeafCount get() = texturedLeafKeys.size
    val missingLeafCount get() = (visibleLeafKeys - texturedLeafKeys).size
    val complete get() = visibleLeafCount > 0 && missingLeafCount == 0
}

/** Immutable tile-coverage candidate owned by exactly one WorldWind Frame. */
internal data class NativePrintRasterFrameCandidate internal constructor(
    val candidateId: Long,
    val visibleLeafKeys: Set<String>,
    val texturedLeafKeys: Set<String>,
    val visibleLeafLevels: Map<Int, Int>,
    val texturedLeafLevels: Map<Int, Int>,
    val visibleMaxLevel: Int,
    val texturedMaxLevel: Int,
    val leafImageSources: Map<String, ImageSource>,
)

/** No-op screen drawable used as an identity-bound callback in the owning Frame's draw queue. */
internal class NativePrintFrameWitnessDrawable(private val onDrawFrame: () -> Unit) : Drawable {
    override fun draw(dc: DrawContext) = onDrawFrame()
    override fun recycle() = Unit
}

/** Collects render-phase candidates and publishes them only through their owning frame's draw callback. */
internal class NativePrintRasterFrameCoverage {
    private val historyLimit = 128
    private var buildingVisible = linkedSetOf<String>()
    private var buildingTextured = linkedSetOf<String>()
    private var buildingVisibleLevels = linkedMapOf<Int, Int>()
    private var buildingTexturedLevels = linkedMapOf<Int, Int>()
    private var buildingImageSources = linkedMapOf<String, ImageSource>()
    private var buildingVisibleMax = -1
    private var buildingTexturedMax = -1
    private var nextCandidateId = 0L
    private var drawSequence = 0L
    private val publishedCandidates = linkedMapOf<Long, NativePrintRasterFrameSnapshot>()
    @Volatile private var latest = NativePrintRasterFrameSnapshot()
    @Volatile private var history: List<NativePrintRasterFrameSnapshot> = emptyList()

    @Synchronized fun beginFrame() {
        buildingVisible = linkedSetOf()
        buildingTextured = linkedSetOf()
        buildingVisibleLevels = linkedMapOf()
        buildingTexturedLevels = linkedMapOf()
        buildingImageSources = linkedMapOf()
        buildingVisibleMax = -1
        buildingTexturedMax = -1
    }

    @Synchronized fun recordVisibleLeaf(level: Int, row: Int, column: Int, hasOwnTexture: Boolean, imageSource: ImageSource? = null) {
        val key = "$level/$row/$column"
        if (buildingVisible.add(key)) buildingVisibleLevels[level] = (buildingVisibleLevels[level] ?: 0) + 1
        if (imageSource != null) buildingImageSources[key] = imageSource
        buildingVisibleMax = maxOf(buildingVisibleMax, level)
        if (hasOwnTexture && buildingTextured.add(key)) {
            buildingTexturedLevels[level] = (buildingTexturedLevels[level] ?: 0) + 1
            buildingTexturedMax = maxOf(buildingTexturedMax, level)
        }
    }

    @Synchronized fun freezeFrame(): NativePrintRasterFrameCandidate = NativePrintRasterFrameCandidate(
        candidateId = ++nextCandidateId,
        visibleLeafKeys = buildingVisible.toSet(),
        texturedLeafKeys = buildingTextured.toSet(),
        visibleLeafLevels = buildingVisibleLevels.toMap(),
        texturedLeafLevels = buildingTexturedLevels.toMap(),
        visibleMaxLevel = buildingVisibleMax,
        texturedMaxLevel = buildingTexturedMax,
        leafImageSources = buildingImageSources.toMap(),
    )

    /** Publishes only when this candidate's own Frame reaches its GL draw callback. */
    @Synchronized fun publishDrawnFrame(
        candidate: NativePrintRasterFrameCandidate,
        cacheUsedBytes: Long = 0,
        cacheCapacityBytes: Long = 0,
        cacheEntries: Int = 0,
        isTextureAvailable: ((ImageSource) -> Boolean)? = null,
    ): NativePrintRasterFrameSnapshot {
        publishedCandidates[candidate.candidateId]?.let { return it }
        val texturedLeaves = if (isTextureAvailable == null) candidate.texturedLeafKeys else {
            candidate.texturedLeafKeys.filter { key ->
                val source = candidate.leafImageSources[key]
                source != null && isTextureAvailable(source)
            }.toSet()
        }
        val texturedLevels = texturedLeaves.mapNotNull { key -> key.substringBefore('/').toIntOrNull() }
            .groupingBy { it }.eachCount()
        val snapshot = NativePrintRasterFrameSnapshot(
            sequence = ++drawSequence,
            visibleLeafKeys = candidate.visibleLeafKeys,
            texturedLeafKeys = texturedLeaves,
            visibleLeafLevels = candidate.visibleLeafLevels,
            texturedLeafLevels = texturedLevels,
            visibleMaxLevel = candidate.visibleMaxLevel,
            texturedMaxLevel = texturedLevels.keys.maxOrNull() ?: -1,
            textureCacheUsedBytes = cacheUsedBytes,
            textureCacheCapacityBytes = cacheCapacityBytes,
            textureCacheEntries = cacheEntries,
        )
        publishedCandidates[candidate.candidateId] = snapshot
        while (publishedCandidates.size > historyLimit) publishedCandidates.remove(publishedCandidates.keys.first())
        latest = snapshot
        history = (history + snapshot).takeLast(historyLimit)
        return snapshot
    }

    /** Convenience for unit tests that model one prepared frame followed by its draw. */
    @Synchronized fun endFrame(cacheUsedBytes: Long = 0, cacheCapacityBytes: Long = 0, cacheEntries: Int = 0): NativePrintRasterFrameSnapshot =
        publishDrawnFrame(freezeFrame(), cacheUsedBytes, cacheCapacityBytes, cacheEntries)

    fun snapshot(): NativePrintRasterFrameSnapshot = latest

    @Synchronized fun snapshotsAfter(sequence: Long): List<NativePrintRasterFrameSnapshot> =
        history.filter { it.sequence > sequence }
}

/** The print-only subclass records WorldWind's visible leaf selection after each actual draw. */
internal class NativePrintTrackedMercatorSurfaceImage(
    tileFactory: MercatorTileFactory,
    levelSet: LevelSet,
    private val coverage: NativePrintRasterFrameCoverage,
) : MercatorTiledSurfaceImage(tileFactory, levelSet) {
    override fun addTile(rc: RenderContext, tile: ImageTile) {
        val source = tile.imageSource
        val hasOwnTexture = source != null && rc.renderResourceCache[source] is Texture
        coverage.recordVisibleLeaf(tile.level.levelNumber, tile.row, tile.column, hasOwnTexture, source)
        super.addTile(rc, tile)
    }

    companion object {
        fun build(
            tileFactory: MercatorTileFactory,
            coverage: NativePrintRasterFrameCoverage,
            transparent: Boolean,
            maxZoom: Int,
            minZoom: Int,
            tileSize: Int,
        ): NativePrintTrackedMercatorSurfaceImage {
            val sector = MercatorSector()
            val tileOrigin = MercatorSector()
            val firstLevelDelta = Location(tileOrigin.deltaLatitude, tileOrigin.deltaLongitude)
            val levels = LevelSet(sector, tileOrigin, firstLevelDelta, maxZoom + 1, tileSize, tileSize, minZoom)
            return NativePrintTrackedMercatorSurfaceImage(tileFactory, levels, coverage).also {
                if (!transparent) it.imageOptions = ImageOptions(ImageConfig.RGB_565)
            }
        }
    }
}
