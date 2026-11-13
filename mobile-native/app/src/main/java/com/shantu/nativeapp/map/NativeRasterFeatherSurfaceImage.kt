/*
 * Surface-image drawable setup adapted from WorldWind Kotlin 2.1.1 SurfaceImage.
 * Copyright WorldWind Kotlin contributors. Licensed under Apache-2.0.
 * See mobile-native/raster-feather-NOTICE and worldwind-labels/LICENSE.
 */
package com.shantu.nativeapp.map

import earth.worldwind.geom.Sector
import earth.worldwind.render.RenderContext
import earth.worldwind.render.image.ImageSource
import earth.worldwind.shape.SurfaceImage

/** Fixed-detail frontier. A missing same-frame cached ancestor leaves the image opaque. */
internal class NativeRasterFeatherSurfaceImage(
    sector: Sector,
    imageSource: ImageSource,
    private val level: Int,
    private val x: Int,
    private val xyzY: Int,
    private val backing: NativeRasterFeatherBackingStore?,
) : SurfaceImage(sector, imageSource) {
    @Volatile var featherEdges: Int = 0

    override fun doRender(rc: RenderContext) {
        if (rc.isPickMode || featherEdges == 0) {
            super.doRender(rc); return
        }
        val parent = backing?.find(rc, level, x, xyzY)
        val parentTexture = parent?.texture
        if (parentTexture == null) {
            backing?.diagnostics?.recordFixedChild(false)
            super.doRender(rc); return
        }
        terrainSector.copy(sector)
        if (terrainSector.isEmpty || !terrainSector.intersect(rc.terrain.sector) || !getExtent(rc).intersectsFrustum(rc.frustum)) return
        val own = texture ?: imageSource?.let { rc.getTexture(it, imageOptions) } ?: return
        backing?.diagnostics?.recordFixedChild(true)
        val pool = rc.getDrawablePool(NativeRasterFeatherDrawable.KEY)
        val drawable = NativeRasterFeatherDrawable.obtain(pool)
        drawable.diagnostics = backing?.diagnostics
        drawable.preparedSequence = backing?.diagnostics?.sequence() ?: 0L
        drawable.set(NativeRasterFeatherProgram.get(rc), sector, rc.currentLayer.opacity, own,
            own.coordTransform, rc.globe.offset, terrainSector)
        drawable.edges = featherEdges
        drawable.backingTexture = parentTexture
        backing?.diagnostics?.queuedPair()
        drawable.backingMatrix.copy(parentTexture.coordTransform).multiplyByTileTransform(sector, checkNotNull(parent).sector)
        rc.offerSurfaceDrawable(drawable, zOrder)
    }
}
