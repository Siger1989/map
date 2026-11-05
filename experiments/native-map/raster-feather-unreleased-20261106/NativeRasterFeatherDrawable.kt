/*
 * Terrain batching adapted from WorldWind Kotlin 2.1.1 DrawableSurfaceTexture.
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

/** One queued tile; the optional parent and child still share the upstream four-texture batch. */
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
        super.recycle()
        ownPool?.release(this)
        ownPool = null
    }

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
            var count = 0
            for (textureIndex in scratch.indices) {
                val tile = scratch[textureIndex] as NativeRasterFeatherDrawable
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
                        (origin.x - dc.eyePoint.x).toFloat(), (origin.y - dc.eyePoint.y).toFloat(), (origin.z - dc.eyePoint.z).toFloat())
                }
                val parent = tile.backingTexture
                if (tile.edges != 0 && parent != null) {
                    // Keep a pair within one batch: the parent slot is held, then RGBA-mixed by its child.
                    if (count > SurfaceTextureProgram.TEXTURE_UNITS.size - 2) {
                        program.loadBatchTextures(count); program.loadFeather(count); terrain.drawTriangles(dc); count = 0
                    }
                    dc.activeTextureUnit(GL_TEXTURE0 + SurfaceTextureProgram.TEXTURE_UNITS[count])
                    if (parent.bindTexture(dc)) {
                        dc.activeTextureUnit(GL_TEXTURE0 + SurfaceTextureProgram.TEXTURE_UNITS[count + 1])
                        if (tile.texture?.bindTexture(dc) == true) {
                            tile.diagnostics?.submitted(tile.preparedSequence, true)
                            program.setBatchTexture(count, tile.backingMatrix, terrainSector, tile.textureSector, tile.opacity)
                            program.setFeather(count, 0, terrainSector, tile.textureSector, 1f)
                            count++
                            program.setBatchTexture(count, tile.texCoordMatrix, terrainSector, tile.textureSector, tile.opacity)
                            program.setFeather(count, tile.edges, terrainSector, tile.textureSector, 2f)
                            count++
                        } else {
                            tile.diagnostics?.submitted(tile.preparedSequence, false)
                            // If the new child cannot bind yet, retain the already cached fallback.
                            program.setBatchTexture(count, tile.backingMatrix, terrainSector, tile.textureSector, tile.opacity)
                            program.setFeather(count, 0, terrainSector, tile.textureSector)
                            count++
                        }
                        if (count == SurfaceTextureProgram.TEXTURE_UNITS.size) {
                            program.loadBatchTextures(count); program.loadFeather(count); terrain.drawTriangles(dc); count = 0
                        }
                        continue
                    }
                }
                dc.activeTextureUnit(GL_TEXTURE0 + SurfaceTextureProgram.TEXTURE_UNITS[count])
                if (tile.texture?.bindTexture(dc) != true) continue
                tile.diagnostics?.submitted(tile.preparedSequence, false)
                program.setBatchTexture(count, tile.texCoordMatrix, terrainSector, tile.textureSector, tile.opacity)
                program.setFeather(count, 0, terrainSector, tile.textureSector)
                if (dc.isPickMode) program.loadColor(tile.color)
                if (++count == SurfaceTextureProgram.TEXTURE_UNITS.size) {
                    program.loadBatchTextures(count); program.loadFeather(count); terrain.drawTriangles(dc); count = 0
                }

            }
            if (count > 0) {
                program.loadBatchTextures(count); program.loadFeather(count); terrain.drawTriangles(dc)
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
                it.ownPool = pool; it.edges = 0; it.backingTexture = null; it.diagnostics = null; it.preparedSequence = 0L
            }
    }
}
