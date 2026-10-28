package com.shantu.nativeapp.offlineMaps

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import com.shantu.nativeapp.coordinates.NativeCoordinateTransform
import com.shantu.nativeapp.coordinates.NativeProjectCrs
import java.io.File
import kotlin.math.abs

data class NativeCalibratedRaster(
    val width: Int,
    val height: Int,
    val rgba: ByteArray,
    val affine: List<Double>,
    val bounds: List<Double>,
    val crs: NativeProjectCrs,
)

/** Explicit world-file georeferencing for ordinary PNG/JPEG/WebP imagery. */
object NativeCalibratedImage {
    fun worldFileAffine(text: String, width: Int, height: Int): List<Double> {
        require(width >= 2 && height >= 2)
        val tokens = text.trim().split(Regex("\\s+"))
        val values = tokens.map { it.toDoubleOrNull() ?: throw IllegalArgumentException("世界文件须包含6个有限数字") }
        require(values.size == 6 && values.all(Double::isFinite)) { "世界文件须包含6个有限数字" }
        val a=values[0];val d=values[1];val b=values[2];val e=values[3];val centerX=values[4];val centerY=values[5]
        require(abs(a * e - b * d) > 1e-20) { "世界文件仿射矩阵不可逆" }
        // World files locate the centre of pixel (0,0); internal affines locate pixel corners.
        return listOf(a, b, centerX - (a + b) * 0.5, d, e, centerY - (d + e) * 0.5)
    }

    fun bounds(affine: List<Double>, width: Int, height: Int, crs: NativeProjectCrs): List<Double> {
        require(affine.size == 6 && affine.all(Double::isFinite) && width >= 2 && height >= 2)
        require(abs(affine[0] * affine[4] - affine[1] * affine[3]) > 1e-20) { "影像仿射矩阵不可逆" }
        val source = NativeCoordinateTransform.resolve(crs)
        val target = NativeCoordinateTransform.resolve("EPSG:4326")
        val points = mutableListOf<List<Double>>()
        for (i in 0..32) {
            val tx = i / 32.0
            val ty = tx
            points += transform(affine, width * tx, 0.0, source, target)
            points += transform(affine, width * tx, height.toDouble(), source, target)
            points += transform(affine, 0.0, height * ty, source, target)
            points += transform(affine, width.toDouble(), height * ty, source, target)
        }
        require(points.all { it.size >= 2 && it[0].isFinite() && it[1].isFinite() }) { "影像坐标转换失败" }
        val result = listOf(points.minOf { it[0] }, points.minOf { it[1] }, points.maxOf { it[0] }, points.maxOf { it[1] })
        require(result[0] >= -180.0 && result[2] <= 180.0 && result[1] >= -85.051129 && result[3] <= 85.051129 && result[0] < result[2] && result[1] < result[3]) {
            "影像配准超出Web地图范围或跨日期变更线"
        }
        return result
    }

    fun load(source: NativeOfflineMap): NativeCalibratedRaster {
        require(source.kind == "image" && source.sourceCrs != null && source.imageAffine?.size == 6 && source.imageWidth != null && source.imageHeight != null)
        val options = BitmapFactory.Options()
        val bitmap = BitmapFactory.decodeFile(source.filePath, options) ?: error("本地影像无法解码")
        try {
            require(bitmap.width == source.imageWidth && bitmap.height == source.imageHeight) { "影像尺寸与配准记录不一致" }
            val argb = IntArray(bitmap.width * bitmap.height)
            bitmap.getPixels(argb, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
            val rgba = ByteArray(argb.size * 4)
            for (i in argb.indices) {
                val pixel = argb[i]
                rgba[i * 4] = (pixel ushr 16).toByte()
                rgba[i * 4 + 1] = (pixel ushr 8).toByte()
                rgba[i * 4 + 2] = pixel.toByte()
                rgba[i * 4 + 3] = (pixel ushr 24).toByte()
            }
            return NativeCalibratedRaster(bitmap.width, bitmap.height, rgba, source.imageAffine, source.bounds ?: error("配准范围缺失"), NativeCoordinateTransform.resolve(source.sourceCrs))
        } finally {
            bitmap.recycle()
        }
    }

    private fun transform(affine: List<Double>, x: Double, y: Double, source: NativeProjectCrs, target: NativeProjectCrs): List<Double> =
        NativeCoordinateTransform.transform(listOf(affine[0] * x + affine[1] * y + affine[2], affine[3] * x + affine[4] * y + affine[5]), source, target)
}
