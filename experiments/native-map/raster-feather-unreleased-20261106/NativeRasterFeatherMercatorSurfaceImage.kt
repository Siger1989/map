/*
 * Tile selection/ancestral texture setup adapted from WorldWind Kotlin 2.1.1.
 * Copyright WorldWind Kotlin contributors. Licensed under Apache-2.0.
 * See mobile-native/raster-feather-NOTICE and worldwind-labels/LICENSE.
 */
package com.shantu.nativeapp.map

import earth.worldwind.geom.Location
import earth.worldwind.geom.Matrix3
import earth.worldwind.draw.DrawableSurfaceTexture
import earth.worldwind.layer.mercator.MercatorSector
import earth.worldwind.layer.mercator.MercatorTileFactory
import earth.worldwind.layer.mercator.MercatorTiledSurfaceImage
import earth.worldwind.render.RenderContext
import earth.worldwind.render.Texture
import earth.worldwind.render.image.ImageConfig
import earth.worldwind.render.image.ImageOptions
import earth.worldwind.render.image.ImageTile
import earth.worldwind.render.program.SurfaceTextureProgram
import earth.worldwind.util.LevelSet
import earth.worldwind.util.TileFactory

/** The selected base keeps its original textures, RGB565 and WorldWind LOD/request policy. */
internal class NativeRasterFeatherMercatorSurfaceImage(
    factory: TileFactory,
    levels: LevelSet,
    private val featherOpaque: Boolean = true,
    private val backing: NativeRasterFeatherBackingStore? = null,
    private val cssPixelScale: () -> Float = { 1f },
) : MercatorTiledSurfaceImage(factory, levels) {
    private class Leaf {
        var tile: ImageTile? = null
        var texture: Texture? = null
        var parent: ImageTile? = null
        var parentTexture: Texture? = null
        var resolvedLevel = -1
        var edges = 0
        var potentialEdges = 0
        fun clear() { tile = null; texture = null; parent = null; parentTexture = null }
    }
    private val leaves = ArrayList<Leaf>()
    private val resolved = HashMap<Long, Int>()
    private var count = 0
    private var previousCount = 0
    private var signature = 0L
    private val parentMatrix = Matrix3()

    override fun determineActiveProgram(rc: RenderContext) {
        activeProgram = if (rc.isPickMode || !featherOpaque)
            SurfaceTextureProgram.get(rc) else NativeRasterFeatherProgram.get(rc)
    }

    override fun doRender(rc: RenderContext) {
        backing?.begin(rc)
        try { super.doRender(rc) }
        finally { backing?.end() }
    }

    override fun getTexture(rc: RenderContext, tile: ImageTile, retrieve: Boolean): Texture? =
        super.getTexture(rc, tile, retrieve)?.also { backing?.remember(tile, it) }

    override fun assembleTiles(rc: RenderContext) {
        if (rc.isPickMode || !featherOpaque) {
            super.assembleTiles(rc)
            return
        }
        previousCount = count; count = 0
        try {
            super.assembleTiles(rc)
            var nextSignature = -3750763034362895579L
            for (i in 0 until count) {
                val leaf = leaves[i]; val tile = leaf.tile ?: continue
                val key = NativeRasterFeatherPolicy.key(tile.level.levelNumber, tile.row, tile.column)
                nextSignature = (nextSignature xor key) * 1099511628211L
                nextSignature = (nextSignature xor leaf.resolvedLevel.toLong()) * 1099511628211L
                nextSignature = (nextSignature xor if (leaf.parentTexture != null) 1L else 0L) * 1099511628211L
            }
            if (signature != nextSignature || previousCount != count) {
                resolved.clear()
                for (i in 0 until count) {
                    val leaf = leaves[i]; val tile = leaf.tile ?: continue
                    resolved[NativeRasterFeatherPolicy.key(tile.level.levelNumber, tile.row, tile.column)] = leaf.resolvedLevel
                }
                for (i in 0 until count) {
                    val leaf = leaves[i]; val tile = leaf.tile ?: continue
                    leaf.potentialEdges = NativeRasterFeatherPolicy.lodEdges(tile.level.levelNumber, tile.row,
                        tile.column, leaf.resolvedLevel, leaf.texture != null, resolved)
                    leaf.edges = if (leaf.parentTexture != null) leaf.potentialEdges else 0
                }
                signature = nextSignature
            }
            val opacity = rc.currentLayer.opacity
            val program = activeProgram as? NativeRasterFeatherProgram ?: return
            val pool = rc.getDrawablePool(NativeRasterFeatherDrawable.KEY)
            var boundaries = 0; var featherChildren = 0; var noParent = 0
            for (i in 0 until count) {
                val leaf = leaves[i]; val tile = leaf.tile ?: continue
                val own = leaf.texture
                val parent = leaf.parent
                val ancestor = leaf.parentTexture
                val texture = own ?: ancestor ?: continue
                if (leaf.potentialEdges != 0) {
                    boundaries++
                    if (leaf.edges != 0) featherChildren++ else noParent++
                }
            val canFeather = own != null && leaf.edges != 0 && parent != null && ancestor != null
            if (!canFeather) {
                // Keep ordinary tiles on the SDK's four-texture batch path; only real boundary pairs split.
                val standard = DrawableSurfaceTexture.obtain(rc.getDrawablePool(DrawableSurfaceTexture.KEY))
                if (own != null) {
                    standard.set(SurfaceTextureProgram.get(rc), tile.sector, opacity, own,
                        own.coordTransform, rc.globe.offset)
                } else if (parent != null) {
                    parentMatrix.copy(texture.coordTransform).multiplyByTileTransform(tile.sector, parent.sector)
                    standard.set(SurfaceTextureProgram.get(rc), tile.sector, opacity, texture,
                        parentMatrix, rc.globe.offset)
                } else {
                    standard.set(SurfaceTextureProgram.get(rc), tile.sector, opacity, texture,
                        texture.coordTransform, rc.globe.offset)
                }
                rc.offerSurfaceDrawable(standard, zOrder)
                continue
                }
            val drawable = NativeRasterFeatherDrawable.obtain(pool)
            drawable.diagnostics = backing?.diagnostics
            drawable.preparedSequence = backing?.diagnostics?.sequence() ?: 0L
            drawable.cssPixelScale = cssPixelScale().takeIf { it.isFinite() }?.coerceIn(0.5f, 8f) ?: 1f
            val childTexture = checkNotNull(own)
            val parentTile = checkNotNull(parent)
            val parentTexture = checkNotNull(ancestor)
            drawable.set(program, tile.sector, opacity, childTexture, childTexture.coordTransform, rc.globe.offset)
            drawable.edges = leaf.edges
            drawable.backingTexture = parentTexture
            backing?.diagnostics?.queuedPair()
            drawable.backingMatrix.copy(parentTexture.coordTransform).multiplyByTileTransform(tile.sector, parentTile.sector)
                rc.offerSurfaceDrawable(drawable, zOrder)
            }
            backing?.diagnostics?.recordLeaves(count, boundaries, featherChildren, noParent)
        } finally {
            for (i in 0 until maxOf(count, previousCount)) leaves[i].clear()
        }
    }

    override fun addTile(rc: RenderContext, tile: ImageTile) {
        if (rc.isPickMode || !featherOpaque) {
            super.addTile(rc, tile)
            return
        }
        val texture = getTexture(rc, tile)
        val parent = ancestorTile
        val parentTexture = ancestorTexture
        val validFallback = parent != null && parentTexture != null && (useAncestorTileTexture ||
            tile.level.levelNumber - parent.level.levelNumber <= 1 && tile.imageSource != null &&
            !rc.renderResourceCache.absentResourceList.isResourceAbsent(tile.imageSource.hashCode()))
        if (count >= NativeRasterFeatherPolicy.MAX_LEAVES) {
            val chosen = texture ?: if (validFallback) parentTexture else null
            if (chosen != null) {
                val drawable = DrawableSurfaceTexture.obtain(rc.getDrawablePool(DrawableSurfaceTexture.KEY))
                if (texture == null && parent != null) {
                    parentMatrix.copy(chosen.coordTransform).multiplyByTileTransform(tile.sector, parent.sector)
                    drawable.set(SurfaceTextureProgram.get(rc), tile.sector, rc.currentLayer.opacity, chosen, parentMatrix, rc.globe.offset)
                } else drawable.set(SurfaceTextureProgram.get(rc), tile.sector, rc.currentLayer.opacity, chosen, chosen.coordTransform, rc.globe.offset)
                rc.offerSurfaceDrawable(drawable, zOrder)
            }
            return
        }
        if (count == leaves.size) leaves.add(Leaf())
        leaves[count++].apply {
            this.tile = tile; this.texture = texture
            this.parent = if (validFallback) parent else null
            this.parentTexture = if (validFallback) parentTexture else null
            resolvedLevel = if (texture != null) tile.level.levelNumber else if (validFallback) parent!!.level.levelNumber else -1
        }
    }

    override fun invalidateTiles() {
        super.invalidateTiles()
        signature = 0L
        backing?.clear()
    }

    override fun clone() = NativeRasterFeatherMercatorSurfaceImage(tileFactory, with(levelSet) {
        LevelSet(MercatorSector.fromSector(sector), MercatorSector.fromSector(tileOrigin), firstLevelDelta,
            numLevels, tileWidth, tileHeight, levelOffset, firstLevel.levelNumber)
    }, featherOpaque, backing, cssPixelScale).also {
        // A clone can belong to a print window/context; do not share frame backing state across windows.
        it.imageOptions = imageOptions; it.detailControl = detailControl
        it.useAncestorTileTexture = useAncestorTileTexture; it.retrieveTopLevelTiles = retrieveTopLevelTiles
    }

    companion object {
        fun build(factory: MercatorTileFactory, transparent: Boolean = false, maxZoom: Int = 21,
                  minZoom: Int = 1, tileSize: Int = 256, backing: NativeRasterFeatherBackingStore? = null,
                  allowFeather: Boolean = !transparent,
                  cssPixelScale: () -> Float = { 1f }): NativeRasterFeatherMercatorSurfaceImage {
            val sector = MercatorSector(); val origin = MercatorSector()
            val delta = Location(origin.deltaLatitude, origin.deltaLongitude)
            return NativeRasterFeatherMercatorSurfaceImage(factory,
                LevelSet(sector, origin, delta, maxZoom + 1, tileSize, tileSize, minZoom), allowFeather, backing, cssPixelScale).apply {
                if (!transparent) imageOptions = ImageOptions(ImageConfig.RGB_565)
            }
        }
    }
}
