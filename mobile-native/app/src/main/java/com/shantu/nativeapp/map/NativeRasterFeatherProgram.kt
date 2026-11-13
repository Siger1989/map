/*
 * Controlled single-tile LOD feather experiment for WorldWind Kotlin 2.1.1.
 * Copyright WorldWind Kotlin contributors. Licensed under Apache-2.0.
 * See mobile-native/raster-feather-NOTICE and worldwind-labels/LICENSE.
 */
package com.shantu.nativeapp.map

import earth.worldwind.draw.DrawContext
import earth.worldwind.geom.Matrix3
import earth.worldwind.geom.Sector
import earth.worldwind.render.RenderContext
import earth.worldwind.render.program.SurfaceTextureProgram
import earth.worldwind.util.kgl.KglUniformLocation

/**
 * Controlled A/B shader: one drawable, at most one parent/child pair, no cross-tile batch.
 * Slot 0 is unit 0 (parent); slot 1 is unit 5 (child), per the locked SDK sampler table.
 */
internal open class NativeRasterFeatherProgram(shadows: Boolean = false) : SurfaceTextureProgram(shadows) {
    private val edgeWidth = FloatArray(4)
    private val edgeWidthVector = FloatArray(4)
    private val transform = Matrix3()
    private var edgeWidthId = KglUniformLocation.NONE
    private var pairEnabledId = KglUniformLocation.NONE

    init {
        val shader = programSources[1]
        val marker = "uniform float texOpacity[${TEXTURE_UNITS.size}];"
        check(shader.contains(marker)) { "Review locked WorldWind surface shader before changing feathering" }
        var fragment = shader.replace(
            marker,
            marker + "\nuniform highp vec4 nativeFeatherWidth;\nuniform bool nativeFeatherPair;"
        )
        val helper = """
            highp float nativeRasterFeather(highp vec4 width, highp vec2 p, highp vec4 rect) {
                if (max(max(width.x, width.y), max(width.z, width.w)) <= 0.0) return 1.0;
                highp vec4 distance = vec4(p.x - rect.x, p.y - rect.y, rect.z - p.x, rect.w - p.y);
                highp vec4 fade = smoothstep(vec4(0.0), max(width, vec4(0.0000001)), distance);
                fade = mix(vec4(1.0), fade, step(vec4(0.0000001), width));
                return fade.x * fade.y * fade.z * fade.w;
            }
        """.trimIndent()
        check(fragment.contains("void main()"))
        fragment = fragment.replace("void main()", helper + "\nvoid main()")

        val start = fragment.indexOf("vec4 accum = vec4(0.0);")
        val end = fragment.indexOf("gl_FragColor = accum;", start)
        check(start >= 0 && end > start) { "Review locked WorldWind composite shader before changing feathering" }
        val controlledComposite = """
                    vec4 accum = vec4(0.0);
                    if (nativeFeatherPair && texCount > 1) {
                        vec2 lo0 = step(texRect[0].xy, tileCoord);
                        vec2 hi0 = step(tileCoord, texRect[0].zw);
                        float mask0 = lo0.x * lo0.y * hi0.x * hi0.y;
                        vec2 uv0 = tileCoord * texScaleTrans[0].xy + texScaleTrans[0].zw;
                        vec4 parent = texture2D(texSampler0, uv0) * (texOpacity[0] * mask0);

                        vec2 lo1 = step(texRect[1].xy, tileCoord);
                        vec2 hi1 = step(tileCoord, texRect[1].zw);
                        float mask1 = lo1.x * lo1.y * hi1.x * hi1.y;
                        vec2 uv1 = tileCoord * texScaleTrans[1].xy + texScaleTrans[1].zw;
                        vec4 child = texture2D(texSampler1, uv1) * (texOpacity[1] * mask1);
                        accum = mix(parent, child, nativeRasterFeather(nativeFeatherWidth, tileCoord, texRect[1]));
                    } else if (texCount > 0) {
                        vec2 lo0 = step(texRect[0].xy, tileCoord);
                        vec2 hi0 = step(tileCoord, texRect[0].zw);
                        float mask0 = lo0.x * lo0.y * hi0.x * hi0.y;
                        vec2 uv0 = tileCoord * texScaleTrans[0].xy + texScaleTrans[0].zw;
                        accum = texture2D(texSampler0, uv0) * (texOpacity[0] * mask0);
                    }
        """.trimIndent()
        fragment = fragment.substring(0, start) + controlledComposite + fragment.substring(end)
        programSources = arrayOf(programSources[0], fragment)
    }

    override fun initProgram(dc: DrawContext) {
        super.initProgram(dc)
        edgeWidthId = gl.getUniformLocation(program, "nativeFeatherWidth")
        pairEnabledId = gl.getUniformLocation(program, "nativeFeatherPair")
    }

    fun setFeatherPair(enabled: Boolean, edges: Int, terrainSector: Sector, textureSector: Sector) {
        gl.uniform1i(pairEnabledId, if (enabled) 1 else 0)
        if (!enabled || edges == 0) {
            edgeWidthVector.fill(0f)
            gl.uniform4fv(edgeWidthId, 1, edgeWidthVector, 0)
            return
        }
        val m = transform.setToTileTransform(terrainSector, textureSector).m
        val width = (NativeRasterFeatherPolicy.BAND_FRACTION / kotlin.math.abs(m[0])).toFloat()
        val height = (NativeRasterFeatherPolicy.BAND_FRACTION / kotlin.math.abs(m[4])).toFloat()
        edgeWidth[0] = if (edges and NativeRasterFeatherPolicy.WEST != 0) width else 0f
        edgeWidth[1] = if (edges and NativeRasterFeatherPolicy.SOUTH != 0) height else 0f
        edgeWidth[2] = if (edges and NativeRasterFeatherPolicy.EAST != 0) width else 0f
        edgeWidth[3] = if (edges and NativeRasterFeatherPolicy.NORTH != 0) height else 0f
        edgeWidth.copyInto(edgeWidthVector)
        gl.uniform4fv(edgeWidthId, 1, edgeWidthVector, 0)
    }

    companion object {
        fun get(rc: RenderContext): NativeRasterFeatherProgram = if (rc.hasShadowLayer)
            rc.getShaderProgram { NativeRasterFeatherShadowProgram() }
        else rc.getShaderProgram { NativeRasterFeatherProgram() }
    }
}

internal class NativeRasterFeatherShadowProgram : NativeRasterFeatherProgram(true)
