/*
 * Controlled single-tile surface draw adapted from WorldWind Kotlin 2.1.1.
 * Copyright WorldWind Kotlin contributors. Licensed under Apache-2.0.
 * See mobile-native/raster-feather-NOTICE and worldwind-labels/LICENSE.
 */
package com.shantu.nativeapp.map

import earth.worldwind.draw.DrawContext
import earth.worldwind.draw.Drawable
import earth.worldwind.draw.DrawableSurfaceTexture
import earth.worldwind.geom.Matrix3
import earth.worldwind.layer.shadow.applyShadowReceiverUniforms
import earth.worldwind.render.Texture
import earth.worldwind.render.program.SurfaceTextureProgram
import earth.worldwind.util.Pool
import earth.worldwind.util.kgl.GL_TEXTURE0

/** One draw per tile. A feather draw binds parent on unit 0 and child on unit 5, then flushes. */
internal class NativeRasterFeatherDrawable private constructor() : DrawableSurfaceTexture() {
    var edges = 0
    var backingTexture: Texture? = null
    val backingMatrix = Matrix3()
    var diagnostics: NativeRasterFeatherDiagnostics? = null
    var preparedSequence = 0L
    private var ownPool: Pool<NativeRasterFeatherDrawable>? = null

    override fun recycle() {
        edges = 0
        backingTexture = null
        diagnostics = null
        preparedSequence = 0L
        super.recycle()
        ownPool?.release(this)
        ownPool = null
    }

    // Keep queue grouping compatible only with this controlled renderer. It still splits every tile below.
    override fun canBatchWith(that: Drawable) = that is NativeRasterFeatherDrawable && program === that.program

    override fun drawSurfaceTextures(dc: DrawContext) {
        val program = program as? NativeRasterFeatherProgram ?: return
        program.enablePickMode(dc.isPickMode)
        dc.applyShadowReceiverUniforms(program)
        val shadowState = dc.shadowState
        val reliefActive = shadowState != null && !dc.isPickMode && shadowState.terrainLambert > 0f
        program.loadTerrainRelief(if (reliefActive) shadowState.terrainLambert else 0f, shadowState?.lightDirection)
        dc.gl.enableVertexAttribArray(1)

        val scratch = dc.scratchList
        for (terrainIndex in 0 until dc.drawableTerrainCount) {
            val terrain = dc.getDrawableTerrain(terrainIndex)
            val terrainSector = terrain.sector
            val origin = terrain.vertexOrigin
            var usingTerrain = false
            for (entry in scratch) {
                val tile = entry as NativeRasterFeatherDrawable
                if (tile.offset != terrain.offset || !tile.terrainSector.intersects(terrainSector)) continue
                if (!usingTerrain) {
                    if (!terrain.useVertexPointAttrib(dc, 0) || !terrain.useVertexTexCoordAttrib(dc, 1)) break
                    usingTerrain = true
                    if (reliefActive) {
                        if (terrain.useVertexNormalAttrib(dc, 2)) dc.gl.enableVertexAttribArray(2)
                        else dc.gl.disableVertexAttribArray(2)
                    }
                    program.mvpMatrix.copy(dc.modelviewProjection)
                    program.mvpMatrix.multiplyByTranslation(origin.x, origin.y, origin.z)
                    program.loadModelviewProjection()
                    if (dc.shadowState != null) program.loadVertexOrigin(
                        (origin.x - dc.eyePoint.x).toFloat(),
                        (origin.y - dc.eyePoint.y).toFloat(),
                        (origin.z - dc.eyePoint.z).toFloat()
                    )
                }

                val own = tile.texture
                val parent = tile.backingTexture
                var count = 0
                var pair = false
                if (!dc.isPickMode && tile.edges != 0 && parent != null) {
                    dc.activeTextureUnit(GL_TEXTURE0 + SurfaceTextureProgram.TEXTURE_UNITS[0])
                    val parentBound = parent.bindTexture(dc)
                    if (parentBound) {
                        dc.activeTextureUnit(GL_TEXTURE0 + SurfaceTextureProgram.TEXTURE_UNITS[1])
                        val childBound = own?.bindTexture(dc) == true
                        if (childBound) {
                            program.setBatchTexture(0, tile.backingMatrix, terrainSector, tile.textureSector, tile.opacity)
                            program.setBatchTexture(1, tile.texCoordMatrix, terrainSector, tile.textureSector, tile.opacity)
                            program.setFeatherPair(true, tile.edges, terrainSector, tile.textureSector)
                            pair = true
                            count = 2
                        } else {
                            // If the child is not bindable yet, render the real cached parent across this tile.
                            program.setBatchTexture(0, tile.backingMatrix, terrainSector, tile.textureSector, tile.opacity)
                            count = 1
                        }
                    }
                }
                if (!pair && count == 0) {
                    dc.activeTextureUnit(GL_TEXTURE0 + SurfaceTextureProgram.TEXTURE_UNITS[0])
                    if (own?.bindTexture(dc) == true) {
                        program.setBatchTexture(0, tile.texCoordMatrix, terrainSector, tile.textureSector, tile.opacity)
                        if (dc.isPickMode) program.loadColor(tile.color)
                        count = 1
                    } else if (parent != null) {
                        // Use the cached parent only if the child and pair path both failed.
                        dc.activeTextureUnit(GL_TEXTURE0 + SurfaceTextureProgram.TEXTURE_UNITS[0])
                        if (parent.bindTexture(dc)) {
                            program.setBatchTexture(0, tile.backingMatrix, terrainSector, tile.textureSector, tile.opacity)
                            count = 1
                        }
                    }
                }
                if (count == 0) continue
                if (!pair) program.setFeatherPair(false, 0, terrainSector, tile.textureSector)
                program.loadBatchTextures(count)
                terrain.drawTriangles(dc)
                tile.diagnostics?.submitted(tile.preparedSequence, pair)
            }
        }
        dc.activeTextureUnit(GL_TEXTURE0)
        dc.gl.disableVertexAttribArray(1)
        if (reliefActive) dc.gl.disableVertexAttribArray(2)
    }

    companion object {
        val KEY = NativeRasterFeatherDrawable::class
        fun obtain(pool: Pool<NativeRasterFeatherDrawable>): NativeRasterFeatherDrawable =
            (pool.acquire() ?: NativeRasterFeatherDrawable()).also {
                it.ownPool = pool
                it.edges = 0
                it.backingTexture = null
                it.diagnostics = null
                it.preparedSequence = 0L
            }
    }
}
