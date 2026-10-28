package com.shantu.nativeapp.photos

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.media.ExifInterface
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.security.MessageDigest
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.ResolverStyle
import java.util.Base64
import kotlin.math.max

data class NativePhotoDraft(
    val id: String,
    val name: String,
    val time: Long?,
    val timeSource: String?,
    val zoneLabel: String,
    val altitudeMetres: Double?,
    val previewJpeg: ByteArray,
    val detailJpeg: ByteArray,
)

object NativePhotoImporter {
    const val MAX_INPUT_BYTES = 20 * 1024 * 1024
    const val MAX_PREVIEW_BYTES = 1024 * 1024
    const val MAX_DETAIL_BYTES = 4 * 1024 * 1024

    /** Reads one selected image into a bounded buffer; the source stream is never modified. */
    fun readBounded(input: InputStream, maximum: Int = MAX_INPUT_BYTES): ByteArray {
        require(maximum in 1..MAX_INPUT_BYTES) { "照片读取上限无效" }
        val out = ByteArrayOutputStream(minOf(maximum, 64 * 1024))
        val buffer = ByteArray(32 * 1024)
        var total = 0
        while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            if (read == 0) continue
            require(total <= maximum - read) { "照片超过 20 MB" }
            out.write(buffer, 0, read)
            total += read
        }
        require(total > 0) { "照片文件为空" }
        return out.toByteArray()
    }

    fun decode(name: String, source: ByteArray): NativePhotoDraft {
        require(source.isNotEmpty() && source.size <= MAX_INPUT_BYTES) { "照片超过 20 MB 或文件为空" }
        require(supportedImage(source)) { "请选择 JPEG、PNG、WebP 或设备支持的 HEIC 照片" }
        val exif = runCatching { ExifInterface(ByteArrayInputStream(source)) }.getOrNull()
        val timeText = exif?.getAttribute(ExifInterface.TAG_DATETIME_ORIGINAL)
        val offset = exif?.getAttribute("OffsetTimeOriginal")
        val time = parseExifTime(timeText, offset)
        val altitude = exif?.let { exifAltitude(it) }

        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(source, 0, source.size, bounds)
        require(bounds.outWidth > 0 && bounds.outHeight > 0) { "无法解码照片，请选择 JPEG、PNG、WebP 或设备支持的照片" }
        require(bounds.outWidth <= 50_000 && bounds.outHeight <= 50_000 && bounds.outWidth.toLong() * bounds.outHeight <= 500_000_000L) { "照片像素尺寸过大" }
        val orientation = exif?.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
            ?: ExifInterface.ORIENTATION_NORMAL
        val sample = sampleSize(bounds.outWidth, bounds.outHeight, 2560)
        val decoded = BitmapFactory.decodeByteArray(source, 0, source.size, BitmapFactory.Options().apply {
            inSampleSize = sample
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }) ?: throw IllegalArgumentException("无法解码照片")
        val oriented = orient(decoded, orientation)
        try {
            val detail = fitJpeg(oriented, 2560, MAX_DETAIL_BYTES, 88)
            val previewBitmap = scaled(oriented, 960)
            try {
                val preview = fitJpeg(previewBitmap, 960, MAX_PREVIEW_BYTES, 82)
                val hash = MessageDigest.getInstance("SHA-256").digest(source).joinToString("") { "%02x".format(it) }
                return NativePhotoDraft(
                    id = hash,
                    name = name.trim().ifEmpty { "照片" }.take(200),
                    time = time,
                    timeSource = if (time != null) "exif" else null,
                    zoneLabel = if (!offset.isNullOrBlank()) "拍摄时区 $offset" else "无时区信息，按本机时区解释",
                    altitudeMetres = altitude,
                    previewJpeg = preview,
                    detailJpeg = detail,
                )
            } finally { if (previewBitmap !== oriented) previewBitmap.recycle() }
        } finally {
            if (oriented !== decoded) oriented.recycle()
            decoded.recycle()
        }
    }

    fun parseExifTime(raw: String?, offset: String?, zone: ZoneId = ZoneId.systemDefault()): Long? {
        if (raw.isNullOrBlank()) return null
        val local = runCatching { LocalDateTime.parse(fixExifDate(raw.trim().replace(' ', 'T')), DateTimeFormatter.ISO_LOCAL_DATE_TIME) }.getOrNull()
            ?: return null
        if (local.year !in 1970..2100) return null
        if (!offset.isNullOrBlank()) {
            val m = Regex("^([+-])(\\d{2}):(\\d{2})$").matchEntire(offset.trim()) ?: return null
            val hours = m.groupValues[2].toInt(); val minutes = m.groupValues[3].toInt()
            if (hours > 14 || minutes > 59 || (hours == 14 && minutes != 0)) return null
            val sign = if (m.groupValues[1] == "-") -1 else 1
            val parsed = ZoneOffset.ofTotalSeconds(sign * (hours * 3600 + minutes * 60))
            return local.toInstant(parsed).toEpochMilli()
        }
        return runCatching { local.atZone(zone).takeIf { it.toLocalDateTime() == local }?.toInstant()?.toEpochMilli() }.getOrNull()
    }

    /** EXIF's YYYY:MM:DD HH:mm:ss becomes ISO local date-time. */
    private fun fixExifDate(value: String): String {
        val m = Regex("^(\\d{4}):(\\d{2}):(\\d{2})T(\\d{2}):(\\d{2}):(\\d{2})$").matchEntire(value) ?: return value
        return "${m.groupValues[1]}-${m.groupValues[2]}-${m.groupValues[3]}T${m.groupValues[4]}:${m.groupValues[5]}:${m.groupValues[6]}"
    }

    private fun exifAltitude(exif: ExifInterface): Double? {
        val raw = parseRational(exif.getAttribute(ExifInterface.TAG_GPS_ALTITUDE)) ?: return null
        if (!raw.isFinite() || raw !in 0.0..112_000.0) return null
        val ref = exif.getAttributeInt(ExifInterface.TAG_GPS_ALTITUDE_REF, 0)
        val value = if (ref == 1) -raw else raw
        return value.takeIf { it in -12_000.0..100_000.0 }
    }

    private fun parseRational(value: String?): Double? {
        val text = value?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        val parts = text.split('/')
        val numerator = parts.firstOrNull()?.toDoubleOrNull() ?: return null
        val denominator = parts.getOrNull(1)?.toDoubleOrNull() ?: 1.0
        if (!numerator.isFinite() || !denominator.isFinite() || denominator == 0.0) return null
        return (numerator / denominator).takeIf { it.isFinite() }
    }

    private fun supportedImage(bytes: ByteArray): Boolean {
        if (bytes.size >= 3 && bytes[0] == 0xff.toByte() && bytes[1] == 0xd8.toByte() && bytes[2] == 0xff.toByte()) return true
        if (bytes.size >= 8 && bytes.sliceArray(0..7).contentEquals(byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))) return true
        if (bytes.size >= 12 && String(bytes, 0, 4, Charsets.US_ASCII) == "RIFF" && String(bytes, 8, 4, Charsets.US_ASCII) == "WEBP") return true
        if (bytes.size >= 12 && String(bytes, 4, 4, Charsets.US_ASCII) == "ftyp") {
            val brand = String(bytes, 8, 4, Charsets.US_ASCII)
            if (brand in setOf("heic", "heix", "heif", "heis", "hevc", "hevx", "hevm", "mif1", "msf1")) return true
        }
        return false
    }

    private fun sampleSize(width: Int, height: Int, maxSide: Int): Int {
        var sample = 1
        while (max(width / sample, height / sample) > maxSide * 2 && sample < 64) sample *= 2
        return sample
    }

    private fun orient(source: Bitmap, orientation: Int): Bitmap {
        val matrix = Matrix()
        when (orientation) {
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.setScale(-1f, 1f)
            ExifInterface.ORIENTATION_ROTATE_180 -> matrix.setRotate(180f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> { matrix.setRotate(180f); matrix.postScale(-1f, 1f) }
            ExifInterface.ORIENTATION_TRANSPOSE -> { matrix.setRotate(90f); matrix.postScale(-1f, 1f) }
            ExifInterface.ORIENTATION_ROTATE_90 -> matrix.setRotate(90f)
            ExifInterface.ORIENTATION_TRANSVERSE -> { matrix.setRotate(-90f); matrix.postScale(-1f, 1f) }
            ExifInterface.ORIENTATION_ROTATE_270 -> matrix.setRotate(-90f)
            else -> return source
        }
        return Bitmap.createBitmap(source, 0, 0, source.width, source.height, matrix, true)
    }

    private fun scaled(source: Bitmap, maxSide: Int): Bitmap {
        val factor = minOf(1.0, maxSide.toDouble() / max(source.width, source.height))
        if (factor == 1.0) return source
        return Bitmap.createScaledBitmap(source, max(1, (source.width * factor).toInt()), max(1, (source.height * factor).toInt()), true)
    }

    private fun fitJpeg(input: Bitmap, maxSide: Int, maxBytes: Int, startQuality: Int): ByteArray {
        var current = scaled(input, maxSide)
        var owned = current !== input
        try {
            repeat(8) {
                val opaque = Bitmap.createBitmap(current.width, current.height, Bitmap.Config.ARGB_8888)
                Canvas(opaque).apply { drawColor(Color.WHITE); drawBitmap(current, 0f, 0f, null) }
                for (quality in listOf(startQuality, 76, 64, 52, 40)) {
                    val out = ByteArrayOutputStream()
                    if (!opaque.compress(Bitmap.CompressFormat.JPEG, quality, out)) { opaque.recycle(); throw IllegalArgumentException("照片副本生成失败") }
                    val bytes = out.toByteArray()
                    if (bytes.size <= maxBytes) { opaque.recycle(); return bytes }
                }
                opaque.recycle()
                if (max(current.width, current.height) <= 320) throw IllegalArgumentException("照片无法压缩至要求大小")
                val reduced = Bitmap.createScaledBitmap(current, max(1, (current.width * .82).toInt()), max(1, (current.height * .82).toInt()), true)
                if (owned) current.recycle()
                current = reduced
                owned = true
            }
            throw IllegalArgumentException(if (maxBytes == MAX_PREVIEW_BYTES) "照片预览无法压缩至1MB" else "清晰副本无法压缩至4MB")
        } finally { if (owned) current.recycle() }
    }

    fun toWorkspacePhoto(
        draft: NativePhotoDraft,
        time: Long,
        coordinates: DoubleArray,
        trackId: String,
        trackName: String,
        kind: String,
        altitude: Double? = draft.altitudeMetres,
        altitudeSource: String? = if (draft.altitudeMetres != null) "exif" else "track",
        previous: JSONObject? = null,
    ): JSONObject {
        require(time > 0 && coordinates.size == 2 && coordinates.all(Double::isFinite)) { "照片时间或坐标无效" }
        require(coordinates[0] in -180.0..180.0 && coordinates[1] in -90.0..90.0) { "照片坐标超出范围" }
        require(kind in setOf("point", "interpolated", "annotation")) { "照片关联类型无效" }
        val out = previous?.let { JSONObject(it.toString()) } ?: JSONObject()
        val oldCoordinates = previous?.optJSONArray("coordinates")
        val samePositionAndTime = previous != null && previous.optLong("time", Long.MIN_VALUE) == time &&
            oldCoordinates != null && oldCoordinates.length() >= 2 &&
            oldCoordinates.optDouble(0, Double.NaN) == coordinates[0] && oldCoordinates.optDouble(1, Double.NaN) == coordinates[1]
        out.put("id", if (kind == "annotation") "marker:$trackId:${draft.id}" else "${draft.id}:$trackId")
            .put("name", draft.name).put("trackId", if (kind == "annotation") "" else trackId)
            .put("trackName", trackName).put("time", time).put("coordinates", org.json.JSONArray().put(coordinates[0]).put(coordinates[1]))
            .put("kind", kind).put("mime", "image/jpeg")
            .put("previewBase64", Base64.getEncoder().encodeToString(draft.previewJpeg))
            .put("detailBase64", Base64.getEncoder().encodeToString(draft.detailJpeg))
        if (kind == "annotation") out.put("annotationId", trackId) else out.remove("annotationId")
        if (draft.timeSource != null) out.put("timeSource", draft.timeSource) else out.remove("timeSource")
        out.remove("timeSourceDetail")
        if (kind == "annotation") {
            out.remove("locationSource"); out.remove("locationAccuracy"); out.remove("locationTimeSource")
        } else {
            out.put("locationSource", "track")
            out.remove("locationAccuracy"); out.remove("locationTimeSource")
        }
        if (altitude != null && altitude.isFinite() && altitude in -12_000.0..100_000.0 && altitudeSource in setOf("exif", "track", "interpolated")) out.put("altitude", JSONObject().put("metres", altitude).put("source", altitudeSource)) else out.remove("altitude")
        if (!samePositionAndTime) { out.remove("weather"); out.remove("weatherError") }
        return out
    }
}

fun manualPhotoTime(raw: String, zone: ZoneId = ZoneId.systemDefault()): Long? {
    val value = raw.trim()
    if (value.isEmpty()) return null
    val formatter = DateTimeFormatter.ofPattern("uuuu-MM-dd HH:mm:ss").withResolverStyle(ResolverStyle.STRICT)
    val local = runCatching { LocalDateTime.parse(value, formatter) }.getOrNull() ?: return null
    if (local.year !in 1970..2100) return null
    return runCatching { local.atZone(zone).takeIf { it.toLocalDateTime() == local }?.toInstant()?.toEpochMilli() }.getOrNull()
}
