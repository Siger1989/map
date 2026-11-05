/*
 * Surface-texture shader adaptation from WorldWind Kotlin 2.1.1.
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

/** Adds a narrow, premultiplied-alpha edge mask without modifying or duplicating source pixels. */
internal open class NativeRasterFeatherProgram(shadows: Boolean = false) : SurfaceTextureProgram(shadows) {
    private val edgeWidths = FloatArray(TEXTURE_UNITS.size * 4)
    private val pairRoles = FloatArray(TEXTURE_UNITS.size)
    private val transform = Matrix3()
    private var edgeId = KglUniformLocation.NONE
    private var roleId = KglUniformLocation.NONE

    init {
        val marker = "uniform float texOpacity[${TEXTURE_UNITS.size}];"
        val shader = programSources[1]
        check(shader.contains(marker)) { "Review the locked WorldWind surface shader before updating feathering" }
        var fragment = shader.replace(marker, marker + "\nuniform highp vec4 nativeFeatherWidth[${TEXTURE_UNITS.size}];" +
            "\nuniform vec4 nativePairRole;")
        val helper = """
            highp float nativeRasterFeather(highp vec4 width, highp vec2 p, highp vec4 rect) {
                // Uniform early-out: normal imagery and same-level interiors pay no derivative cost.
                if (max(max(width.x, width.y), max(width.z, width.w)) <= 0.0) return 1.0;
                #ifdef WW_HAS_DERIVATIVES
                highp vec2 screenWidth = fwidth(p) * ${NativeRasterFeatherPolicy.SCREEN_PIXELS};
                width = min(width, vec4(screenWidth, screenWidth));
                #endif
                highp vec4 distance = vec4(p - rect.xy, rect.zw - p);
                highp vec4 fade = smoothstep(vec4(0.0), max(width, vec4(0.0000001)), distance);
                fade = mix(vec4(1.0), fade, step(vec4(0.0000001), width));
                return fade.x * fade.y * fade.z * fade.w;
            }
        """.trimIndent()
        check(fragment.contains("void main()"))
        fragment = fragment.replace("void main()", helper + "\nvoid main()")
        check(fragment.contains("vec4 accum = vec4(0.0);"))
        fragment = fragment.replace("vec4 accum = vec4(0.0);", "vec4 accum = vec4(0.0);\nvec4 nativeParent = vec4(0.0);")
        for (k in TEXTURE_UNITS.indices) {
            val old = "accum = src$k + accum * (1.0 - src$k.a);"
            check(fragment.contains(old))
            // Pair RGBA before OVER: transparent pixels and layer opacity remain exact in the interior.
            // Texture sampling itself stays outside this uniform control flow and all varying branches.
            fragment = fragment.replace(old, """
                if (nativePairRole[$k] > 1.5) {
                    src$k = mix(nativeParent, src$k, nativeRasterFeather(nativeFeatherWidth[$k], tileCoord, texRect[$k]));
                }
                if (nativePairRole[$k] > 0.5 && nativePairRole[$k] < 1.5) nativeParent = src$k;
                else accum = src$k + accum * (1.0 - src$k.a);
            """.trimIndent())
        }
        programSources = arrayOf(programSources[0], fragment)
    }

    override fun initProgram(dc: DrawContext) {
        super.initProgram(dc)
        edgeId = gl.getUniformLocation(program, "nativeFeatherWidth")
        roleId = gl.getUniformLocation(program, "nativePairRole")
    }

    fun setFeather(k: Int, edges: Int, terrainSector: Sector, textureSector: Sector, role: Float = 0f) {
        pairRoles[k] = role
        val offset = k * 4
        if (edges == 0) {
            for (i in 0..3) edgeWidths[offset + i] = 0f
            return
        }
        val m = transform.setToTileTransform(terrainSector, textureSector).m
        val width = (NativeRasterFeatherPolicy.BAND_FRACTION / kotlin.math.abs(m[0])).toFloat()
        val height = (NativeRasterFeatherPolicy.BAND_FRACTION / kotlin.math.abs(m[4])).toFloat()
        edgeWidths[offset] = if (edges and NativeRasterFeatherPolicy.WEST != 0) width else 0f
        edgeWidths[offset + 1] = if (edges and NativeRasterFeatherPolicy.SOUTH != 0) height else 0f
        edgeWidths[offset + 2] = if (edges and NativeRasterFeatherPolicy.EAST != 0) width else 0f
        edgeWidths[offset + 3] = if (edges and NativeRasterFeatherPolicy.NORTH != 0) height else 0f
    }

    fun loadFeather(count: Int) {
        gl.uniform4fv(edgeId, count, edgeWidths, 0)
        gl.uniform4fv(roleId, 1, pairRoles, 0)
    }

    companion object {
        fun get(rc: RenderContext): NativeRasterFeatherProgram = if (rc.hasShadowLayer)
            rc.getShaderProgram { NativeRasterFeatherShadowProgram() }
        else rc.getShaderProgram { NativeRasterFeatherProgram() }
    }
}

internal class NativeRasterFeatherShadowProgram : NativeRasterFeatherProgram(true)
