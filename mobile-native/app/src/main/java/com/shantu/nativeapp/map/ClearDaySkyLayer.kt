package com.shantu.nativeapp.map

import earth.worldwind.draw.DrawContext
import earth.worldwind.draw.Drawable
import earth.worldwind.geom.Matrix4
import earth.worldwind.layer.atmosphere.AtmosphereLayer
import earth.worldwind.render.RenderContext
import earth.worldwind.render.buffer.BufferObject
import earth.worldwind.render.program.AbstractShaderProgram
import earth.worldwind.util.NumericArray
import earth.worldwind.util.Pool
import earth.worldwind.util.kgl.GL_ARRAY_BUFFER
import earth.worldwind.util.kgl.GL_CCW
import earth.worldwind.util.kgl.GL_CW
import earth.worldwind.util.kgl.GL_ELEMENT_ARRAY_BUFFER
import earth.worldwind.util.kgl.GL_FLOAT
import earth.worldwind.util.kgl.GL_TRIANGLE_STRIP
import earth.worldwind.util.kgl.GL_UNSIGNED_SHORT
import earth.worldwind.util.kgl.KglUniformLocation

/** RGB palette used by the former MapLibre clear-day sky. */
internal object ClearDaySkyPalette {
    const val SKY_HEX = 0x69b9e8
    const val HORIZON_HEX = 0xffffff
    const val FOG_HEX = 0xe5eff5

    fun glslRgb(hex: Int): String {
        require(hex in 0..0xffffff)
        val red = ((hex shr 16) and 0xff) / 255f
        val green = ((hex shr 8) and 0xff) / 255f
        val blue = (hex and 0xff) / 255f
        return "$red, $green, $blue"
    }
}

/**
 * Native globe sky with a blue zenith, bright white horizon, and restrained near-horizon haze.
 * The inherited atmosphere layer supplies a globe-sized shell, so the sky follows the horizon
 * and is naturally occluded by terrain rather than painting a screen-space rectangle.
 */
class ClearDaySkyLayer : AtmosphereLayer() {
    init {
        // Keep the requested haze in the sky gradient; do not scatter over and wash out map imagery.
        groundFadeFarAltitude = 0.0
    }

    override fun renderSky(rc: RenderContext) {
        val pool = rc.getDrawablePool(ClearDaySkyDrawable.KEY)
        val drawable = ClearDaySkyDrawable.obtain(pool)
        val size = 128
        drawable.program = rc.getShaderProgram { ClearDaySkyProgram() }
        drawable.vertexPoints = rc.getBufferObject(VERTEX_POINTS_KEY) { BufferObject(GL_ARRAY_BUFFER, 0) }
        rc.offerGLBufferUpload(VERTEX_POINTS_KEY, 1) {
            NumericArray.Floats(assembleVertexPoints(rc, size, size, rc.atmosphereAltitude.toFloat()))
        }
        drawable.triStripElements = rc.getBufferObject(TRI_STRIP_ELEMENTS_KEY) {
            BufferObject(GL_ELEMENT_ARRAY_BUFFER, 0)
        }
        rc.offerGLBufferUpload(TRI_STRIP_ELEMENTS_KEY, 1) {
            NumericArray.Shorts(assembleTriStripElements(size, size))
        }
        rc.offerSurfaceDrawable(drawable, Double.POSITIVE_INFINITY)
    }

    private companion object {
        val VERTEX_POINTS_KEY = ClearDaySkyLayer::class.simpleName + ".points"
        val TRI_STRIP_ELEMENTS_KEY = ClearDaySkyLayer::class.simpleName + ".triStripElements"
    }
}

private class ClearDaySkyDrawable : Drawable {
    var program: ClearDaySkyProgram? = null
    var vertexPoints: BufferObject? = null
    var triStripElements: BufferObject? = null
    private var pool: Pool<ClearDaySkyDrawable>? = null

    companion object {
        val KEY = ClearDaySkyDrawable::class

        fun obtain(pool: Pool<ClearDaySkyDrawable>): ClearDaySkyDrawable {
            val drawable = pool.acquire() ?: ClearDaySkyDrawable()
            drawable.pool = pool
            return drawable
        }
    }

    override fun recycle() {
        program = null
        vertexPoints = null
        triStripElements = null
        pool?.release(this)
        pool = null
    }

    override fun draw(dc: DrawContext) {
        val skyProgram = program ?: return
        if (!skyProgram.useProgram(dc)) return
        if (vertexPoints?.bindBuffer(dc) != true) return
        val indices = triStripElements ?: return
        if (!indices.bindBuffer(dc)) return

        skyProgram.loadCamera(dc.modelviewProjection, dc.eyePoint)
        dc.gl.vertexAttribPointer(0, 3, GL_FLOAT, false, 0, 0)
        try {
            // Match WorldWind's own sky dome state: draw the inner sphere without depth writes.
            dc.gl.depthMask(false)
            dc.gl.frontFace(GL_CW)
            dc.gl.drawElements(GL_TRIANGLE_STRIP, indices.byteCount / 2, GL_UNSIGNED_SHORT, 0)
        } finally {
            dc.gl.depthMask(true)
            dc.gl.frontFace(GL_CCW)
        }
    }
}

private class ClearDaySkyProgram : AbstractShaderProgram() {
    override var programSources = arrayOf(
        """
            #ifdef GL_ES
            precision highp float;
            #endif

            uniform mat4 mvpMatrix;
            uniform vec3 eyePoint;
            attribute vec4 vertexPoint;
            varying float horizonElevation;

            void main() {
                vec3 viewRay = normalize(vertexPoint.xyz - eyePoint);
                vec3 localUp = normalize(eyePoint);
                horizonElevation = dot(viewRay, localUp);
                gl_Position = mvpMatrix * vertexPoint;
            }
        """.trimIndent(),
        """
            #ifdef GL_ES
            precision highp float;
            #endif

            const vec3 SKY_COLOR = vec3(${ClearDaySkyPalette.glslRgb(ClearDaySkyPalette.SKY_HEX)});
            const vec3 HORIZON_COLOR = vec3(${ClearDaySkyPalette.glslRgb(ClearDaySkyPalette.HORIZON_HEX)});
            const vec3 FOG_COLOR = vec3(${ClearDaySkyPalette.glslRgb(ClearDaySkyPalette.FOG_HEX)});
            // A tilted map exposes a shallow slice of sky; reach blue within that slice.
            const float HORIZON_BLEND_END = 0.18;
            const float FOG_STRENGTH = 0.14;

            varying float horizonElevation;

            void main() {
                float elevation = clamp(horizonElevation, 0.0, 1.0);
                vec3 color = mix(HORIZON_COLOR, SKY_COLOR, smoothstep(0.0, HORIZON_BLEND_END, elevation));
                float fogBand = smoothstep(0.0, 0.015, elevation) * (1.0 - smoothstep(0.02, 0.14, elevation));
                color = mix(color, FOG_COLOR, FOG_STRENGTH * fogBand);
                gl_FragColor = vec4(color, 1.0);
            }
        """.trimIndent(),
    )
    override val attribBindings = arrayOf("vertexPoint")

    private var mvpMatrixId = KglUniformLocation.NONE
    private var eyePointId = KglUniformLocation.NONE
    private val matrixArray = FloatArray(16)
    private val vectorArray = FloatArray(3)

    override fun initProgram(dc: DrawContext) {
        super.initProgram(dc)
        mvpMatrixId = gl.getUniformLocation(program, "mvpMatrix")
        eyePointId = gl.getUniformLocation(program, "eyePoint")
    }

    fun loadCamera(matrix: Matrix4, eyePoint: earth.worldwind.geom.Vec3) {
        matrix.transposeToArray(matrixArray, 0)
        gl.uniformMatrix4fv(mvpMatrixId, 1, false, matrixArray, 0)
        eyePoint.toArray(vectorArray, 0)
        gl.uniform3fv(eyePointId, 1, vectorArray, 0)
    }
}
