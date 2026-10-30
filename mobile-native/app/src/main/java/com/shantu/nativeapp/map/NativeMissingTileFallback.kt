package com.shantu.nativeapp.map

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RectF
import java.net.URL
import java.security.MessageDigest

/** Recognizes only provider-declared misses or a byte-for-byte known placeholder. */
internal object NativeMissingTileFallback {
    const val KNOWN_PLACEHOLDER_SHA256 = "4b399ee12503d2278b244fcb0f3804d0c6c8bb42391c2621a53937b97acc494a"
    const val MAX_NEGATIVE_CACHE_MILLIS = 5 * 60 * 1000L
    const val MAX_NEGATIVE_CACHE_ENTRIES = 4096

    fun isKnownPlaceholder(bytes: ByteArray): Boolean {
        if (bytes.size != 4769) return false
        val hash = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it.toInt() and 0xff) }
        return hash == KNOWN_PLACEHOLDER_SHA256
    }

    fun isExplicitMissing(statusCode: Int, bingTileInfo: String?): Boolean =
        statusCode == 204 || statusCode == 404 || statusCode == 410 ||
            (statusCode == 200 && bingTileInfo?.trim()?.equals("no-tile", ignoreCase = true) == true)

    data class TdtTile(val layer: String, val x: Int, val y: Int, val z: Int)

    fun parseTdt(url: String): TdtTile? = runCatching {
        val parsed = URL(url)
        val match = Regex("/([a-z]{3})_w/wmts$", RegexOption.IGNORE_CASE).find(parsed.path) ?: return null
        val query = parsed.query.orEmpty().split('&').mapNotNull {
            val parts = it.split('=', limit = 2)
            if (parts.size == 2) parts[0].uppercase() to parts[1] else null
        }.toMap()
        val layer = match.groupValues[1].lowercase()
        val z = query["TILEMATRIX"]?.toIntOrNull() ?: return null
        val x = query["TILECOL"]?.toIntOrNull() ?: return null
        val y = query["TILEROW"]?.toIntOrNull() ?: return null
        if (layer !in setOf("img", "cia", "vec", "cva", "ter", "cta") || z !in 0..24) return null
        val side = 1 shl z
        if (x !in 0 until side || y !in 0 until side) return null
        TdtTile(layer, x, y, z)
    }.getOrNull()

    fun tdtUrl(original: String, tile: TdtTile): String? = runCatching {
        val parsed = URL(original)
        val query = parsed.query.orEmpty().split('&').map { part ->
            val key = part.substringBefore('=')
            when (key.uppercase()) {
                "TILEMATRIX" -> "$key=${tile.z}"
                "TILECOL" -> "$key=${tile.x}"
                "TILEROW" -> "$key=${tile.y}"
                else -> part
            }
        }.joinToString("&")
        "${parsed.protocol}://${parsed.authority}${parsed.path}?$query"
    }.getOrNull()

    /** Returns a scaled bitmap for one descendant tile inside an ancestor tile. */
    fun cropDescendant(parent: Bitmap, descendantX: Int, descendantY: Int, parentZ: Int, descendantZ: Int, outputSize: Int): Bitmap? {
        val depth = descendantZ - parentZ
        if (depth !in 1..24 || outputSize <= 0 || parent.width <= 0 || parent.height <= 0) return null
        val divisions = 1 shl depth
        val localX = descendantX and (divisions - 1)
        val localY = descendantY and (divisions - 1)
        val left = parent.width.toFloat() * localX / divisions
        val top = parent.height.toFloat() * localY / divisions
        val right = parent.width.toFloat() * (localX + 1) / divisions
        val bottom = parent.height.toFloat() * (localY + 1) / divisions
        if (right <= left || bottom <= top) return null
        val output = runCatching { Bitmap.createBitmap(outputSize, outputSize, Bitmap.Config.ARGB_8888) }.getOrNull() ?: return null
        return try {
            val matrix = Matrix().apply {
                setRectToRect(RectF(left, top, right, bottom), RectF(0f, 0f, outputSize.toFloat(), outputSize.toFloat()), Matrix.ScaleToFit.FILL)
            }
            Canvas(output).drawBitmap(parent, matrix, Paint(Paint.FILTER_BITMAP_FLAG))
            output
        } catch (_: Throwable) {
            output.recycle()
            null
        }
    }

    fun bytesForBitmap(bitmap: Bitmap, format: android.graphics.Bitmap.CompressFormat = android.graphics.Bitmap.CompressFormat.PNG): ByteArray? =
        runCatching { java.io.ByteArrayOutputStream().use { out -> if (!bitmap.compress(format, 95, out)) null else out.toByteArray() } }.getOrNull()
}
