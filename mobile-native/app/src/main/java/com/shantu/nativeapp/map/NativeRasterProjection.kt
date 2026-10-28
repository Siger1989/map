package com.shantu.nativeapp.map

import android.graphics.Bitmap
import android.graphics.Color
import kotlin.math.PI
import kotlin.math.atan
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sinh
import kotlin.math.sqrt

/** WGS84 output-tile sampling into a provider's GCJ02/BD09 Web Mercator pixel grid. */
internal object NativeRasterProjection {
    private const val GRID = 16
    private const val A = 6_378_245.0
    private const val EE = 0.00669342162296594323

    fun plan(z: Int, x: Int, y: Int, tileSize: Int, datum: NativeRasterDatum): NativeRasterWarpPlan {
        require(z in 0..24 && tileSize in setOf(256, 512, 1024, 2048))
        val worldSize = tileSize * 2.0.pow(z)
        val points = DoubleArray((GRID + 1) * (GRID + 1) * 2)
        var minX = Double.POSITIVE_INFINITY
        var maxX = Double.NEGATIVE_INFINITY
        var minY = Double.POSITIVE_INFINITY
        var maxY = Double.NEGATIVE_INFINITY
        for (row in 0..GRID) for (col in 0..GRID) {
            val lngLat = pixelLngLat((x + col.toDouble() / GRID) * tileSize, (y + row.toDouble() / GRID) * tileSize, worldSize)
            val sourceCoord = toProviderDatum(lngLat.first, lngLat.second, datum)
            val pixel = worldPixel(sourceCoord.first, sourceCoord.second, worldSize)
            val index = (row * (GRID + 1) + col) * 2
            points[index] = pixel.first
            points[index + 1] = pixel.second
            minX = min(minX, pixel.first); maxX = max(maxX, pixel.first)
            minY = min(minY, pixel.second); maxY = max(maxY, pixel.second)
        }
        val firstX = floor(minX / tileSize).toInt()
        val lastX = floor(maxX / tileSize).toInt()
        val firstY = max(0, floor(minY / tileSize).toInt())
        val lastY = min((1 shl z) - 1, floor(maxY / tileSize).toInt())
        val width = lastX - firstX + 1
        val height = lastY - firstY + 1
        require(width > 0 && height > 0 && width * height <= 16) { "坐标转换跨越瓦片边界，请检查图源坐标系" }
        return NativeRasterWarpPlan(points, firstX, firstY, width, height, tileSize)
    }

    /** Input mosaic tiles are laid out from plan.left/plan.top in provider tile coordinates. */
    fun resample(plan: NativeRasterWarpPlan, mosaic: Bitmap): Bitmap {
        val size = plan.tileSize
        require(mosaic.width == plan.width * size && mosaic.height == plan.height * size)
        val pixels = IntArray(mosaic.width * mosaic.height)
        mosaic.getPixels(pixels, 0, mosaic.width, 0, 0, mosaic.width, mosaic.height)
        val output = IntArray(size * size)
        val gridSize = GRID + 1
        val step = size.toDouble() / GRID
        val mosaicWidth = plan.width * size
        val mosaicHeight = plan.height * size
        for (py in 0 until size) {
            val gy = (py + 0.5) / step
            val row = floor(gy).toInt().coerceIn(0, GRID - 1)
            val dy = gy - row
            for (px in 0 until size) {
                val gx = (px + 0.5) / step
                val col = floor(gx).toInt().coerceIn(0, GRID - 1)
                val dx = gx - col
                val a = (row * gridSize + col) * 2
                val b = a + 2
                val c = a + gridSize * 2
                val d = c + 2
                val srcX = interpolate(plan.points[a], plan.points[b], plan.points[c], plan.points[d], dx, dy) - plan.left * size - 0.5
                val srcY = interpolate(plan.points[a + 1], plan.points[b + 1], plan.points[c + 1], plan.points[d + 1], dx, dy) - plan.top * size - 0.5
                val sx = srcX.coerceIn(0.0, mosaicWidth - 1.001)
                val sy = srcY.coerceIn(0.0, mosaicHeight - 1.001)
                val ix = floor(sx).toInt(); val iy = floor(sy).toInt()
                val fx = sx - ix; val fy = sy - iy
                val c00 = pixels[iy * mosaicWidth + ix]
                val c10 = pixels[iy * mosaicWidth + ix + 1]
                val c01 = pixels[(iy + 1) * mosaicWidth + ix]
                val c11 = pixels[(iy + 1) * mosaicWidth + ix + 1]
                output[py * size + px] = bilinearPremultiplied(c00, c10, c01, c11, fx, fy)
            }
        }
        return Bitmap.createBitmap(output, size, size, Bitmap.Config.ARGB_8888)
    }

    fun cropSubdivided(bitmap: Bitmap, x: Int, y: Int, outputTileSize: Int): Bitmap {
        require(bitmap.width % 2 == 0 && bitmap.height % 2 == 0)
        val halfWidth = bitmap.width / 2
        val halfHeight = bitmap.height / 2
        require(halfWidth == outputTileSize && halfHeight == outputTileSize) { "OVMAP 父级瓦片尺寸与声明不一致" }
        return Bitmap.createBitmap(bitmap, (x and 1) * halfWidth, (y and 1) * halfHeight, halfWidth, halfHeight)
    }

    private fun toProviderDatum(lng: Double, lat: Double, datum: NativeRasterDatum): Pair<Double, Double> {
        if (datum == NativeRasterDatum.WGS84 || outsideChina(lng, lat)) return lng to lat
        val gcj = wgs84ToGcj02(lng, lat)
        return if (datum == NativeRasterDatum.GCJ02) gcj else gcj02ToBd09(gcj.first, gcj.second)
    }

    private fun wgs84ToGcj02(lng: Double, lat: Double): Pair<Double, Double> {
        var dLat = transformLat(lng - 105.0, lat - 35.0)
        var dLng = transformLng(lng - 105.0, lat - 35.0)
        val radLat = lat / 180.0 * PI
        var magic = sin(radLat)
        magic = 1 - EE * magic * magic
        val sqrtMagic = sqrt(magic)
        dLat = dLat * 180.0 / ((A * (1 - EE)) / (magic * sqrtMagic) * PI)
        dLng = dLng * 180.0 / (A / sqrtMagic * cos(radLat) * PI)
        return (lng + dLng) to (lat + dLat)
    }

    private fun gcj02ToBd09(lng: Double, lat: Double): Pair<Double, Double> {
        val z = sqrt(lng * lng + lat * lat) + 0.00002 * sin(lat * PI * 3000.0 / 180.0)
        val theta = atan2(lat, lng) + 0.000003 * cos(lng * PI * 3000.0 / 180.0)
        return (z * cos(theta) + 0.0065) to (z * sin(theta) + 0.006)
    }

    private fun transformLat(x: Double, y: Double): Double {
        var value = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * sqrt(kotlin.math.abs(x))
        value += (20.0 * sin(6.0 * x * PI) + 20.0 * sin(2.0 * x * PI)) * 2.0 / 3.0
        value += (20.0 * sin(y * PI) + 40.0 * sin(y / 3.0 * PI)) * 2.0 / 3.0
        value += (160.0 * sin(y / 12.0 * PI) + 320.0 * sin(y * PI / 30.0)) * 2.0 / 3.0
        return value
    }

    private fun transformLng(x: Double, y: Double): Double {
        var value = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * sqrt(kotlin.math.abs(x))
        value += (20.0 * sin(6.0 * x * PI) + 20.0 * sin(2.0 * x * PI)) * 2.0 / 3.0
        value += (20.0 * sin(x * PI) + 40.0 * sin(x / 3.0 * PI)) * 2.0 / 3.0
        value += (150.0 * sin(x / 12.0 * PI) + 300.0 * sin(x / 30.0 * PI)) * 2.0 / 3.0
        return value
    }

    private fun outsideChina(lng: Double, lat: Double) = lng !in 72.004..137.8347 || lat !in 0.8293..55.8271

    private fun worldPixel(lng: Double, lat: Double, size: Double): Pair<Double, Double> {
        val sine = sin(lat.coerceIn(-85.05112878, 85.05112878) * PI / 180.0)
        return ((lng + 180.0) / 360.0 * size) to ((0.5 - ln((1 + sine) / (1 - sine)) / (4 * PI)) * size)
    }

    private fun pixelLngLat(x: Double, y: Double, size: Double): Pair<Double, Double> =
        (x / size * 360.0 - 180.0) to (atan(sinh(PI * (1.0 - 2.0 * y / size))) * 180.0 / PI)

    private fun interpolate(a: Double, b: Double, c: Double, d: Double, u: Double, v: Double): Double =
        (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v

    private fun bilinearPremultiplied(c00: Int, c10: Int, c01: Int, c11: Int, fx: Double, fy: Double): Int {
        val w00 = (1 - fx) * (1 - fy); val w10 = fx * (1 - fy)
        val w01 = (1 - fx) * fy; val w11 = fx * fy
        val a0 = Color.alpha(c00); val a1 = Color.alpha(c10); val a2 = Color.alpha(c01); val a3 = Color.alpha(c11)
        val alpha = a0 * w00 + a1 * w10 + a2 * w01 + a3 * w11
        if (alpha <= 0.0) return Color.TRANSPARENT
        fun channel(value: (Int) -> Int): Int {
            val premultiplied = value(c00) * a0 * w00 + value(c10) * a1 * w10 + value(c01) * a2 * w01 + value(c11) * a3 * w11
            return (premultiplied / alpha).toInt().coerceIn(0, 255)
        }
        return Color.argb(
            alpha.toInt().coerceIn(0, 255),
            channel { Color.red(it) },
            channel { Color.green(it) },
            channel { Color.blue(it) },
        )
    }

}
