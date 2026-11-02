package com.shantu.nativeapp.map

import java.io.ByteArrayOutputStream

/**
 * Removes unselected MVT layer payloads without decoding their feature geometry.
 *
 * Selected layers and all top-level fields outside Tile.layers are copied byte-for-byte. For an
 * unselected layer, only fields 2/3/4 (features/keys/values) are removed; name, version, extent,
 * and unknown layer fields remain in their original encoded form. Any malformed or unsupported
 * protobuf wire data makes this a no-op and returns the original array.
 */
internal object NativeMvtLayerPayload {
    fun filter(bytes: ByteArray, retainedLayerNames: Set<String>): ByteArray {
        return try {
            filterChecked(bytes, retainedLayerNames)
        } catch (_: InvalidProtobuf) {
            bytes
        } catch (_: IndexOutOfBoundsException) {
            bytes
        } catch (_: IllegalArgumentException) {
            bytes
        }
    }

    private fun filterChecked(bytes: ByteArray, retainedLayerNames: Set<String>): ByteArray {
        var out: ByteArrayOutputStream? = null
        val cursor = Cursor(bytes)

        while (cursor.position < bytes.size) {
            val fieldStart = cursor.position
            val tag = cursor.readTag(bytes.size)
            if (tag.number == TILE_LAYERS_FIELD) {
                if (tag.wireType != WIRE_LENGTH_DELIMITED) throw InvalidProtobuf()
                val rawLengthStart = cursor.position
                val layerLength = cursor.readLength(bytes.size)
                val layerStart = cursor.position
                val layerEnd = cursor.checkedEnd(layerLength, bytes.size)
                val result = inspectLayer(bytes, layerStart, layerEnd)
                if (result.name in retainedLayerNames) {
                    out?.write(bytes, fieldStart, layerEnd - fieldStart)
                } else if (result.removedContent) {
                    if (out == null) {
                        out = ByteArrayOutputStream(bytes.size)
                        out.write(bytes, 0, fieldStart)
                    }
                    // Preserve the original tag bytes, then frame the newly compacted layer.
                    out.write(bytes, fieldStart, rawLengthStart - fieldStart)
                    writeVarint(out, result.payload.size.toLong())
                    out.write(result.payload)
                } else {
                    out?.write(bytes, fieldStart, layerEnd - fieldStart)
                }
                cursor.position = layerEnd
            } else {
                cursor.skip(tag.wireType, bytes.size)
                out?.write(bytes, fieldStart, cursor.position - fieldStart)
            }
        }

        return out?.toByteArray() ?: bytes
    }

    private fun inspectLayer(bytes: ByteArray, start: Int, end: Int): LayerResult {
        val cursor = Cursor(bytes, start)
        val payload = ByteArrayOutputStream(minOf(128, end - start))
        var name = ""
        var removedContent = false

        while (cursor.position < end) {
            val fieldStart = cursor.position
            val tag = cursor.readTag(end)
            val isContentField = tag.number == LAYER_FEATURES_FIELD ||
                tag.number == LAYER_KEYS_FIELD || tag.number == LAYER_VALUES_FIELD

            // The MVT schema assigns these fields length-delimited wire type. A mismatched known
            // field is malformed for this decoder, so fail closed rather than rewrite it.
            if ((tag.number == LAYER_NAME_FIELD && tag.wireType != WIRE_LENGTH_DELIMITED) ||
                (isContentField && tag.wireType != WIRE_LENGTH_DELIMITED) ||
                ((tag.number == LAYER_VERSION_FIELD || tag.number == LAYER_EXTENT_FIELD) && tag.wireType != WIRE_VARINT)
            ) throw InvalidProtobuf()

            when {
                tag.number == LAYER_NAME_FIELD -> {
                    val length = cursor.readLength(end)
                    val valueStart = cursor.position
                    val valueEnd = cursor.checkedEnd(length, end)
                    name = bytes.decodeToString(valueStart, valueEnd)
                    cursor.position = valueEnd
                    payload.write(bytes, fieldStart, cursor.position - fieldStart)
                }
                isContentField -> {
                    cursor.skip(tag.wireType, end)
                    removedContent = true
                }
                else -> {
                    cursor.skip(tag.wireType, end)
                    payload.write(bytes, fieldStart, cursor.position - fieldStart)
                }
            }
        }

        if (cursor.position != end) throw InvalidProtobuf()
        return LayerResult(name, payload.toByteArray(), removedContent)
    }

    private data class LayerResult(val name: String, val payload: ByteArray, val removedContent: Boolean)
    private data class Tag(val number: Int, val wireType: Int)

    private class Cursor(
        private val bytes: ByteArray,
        var position: Int = 0
    ) {
        fun readTag(limit: Int): Tag {
            val raw = readVarint(limit)
            if (raw <= 0L || raw > UINT32_MAX) throw InvalidProtobuf()
            val wireType = (raw and 0x7L).toInt()
            val number = (raw ushr 3).toInt()
            if (number == 0 || number > MAX_FIELD_NUMBER) throw InvalidProtobuf()
            if (wireType != WIRE_VARINT && wireType != WIRE_FIXED64 &&
                wireType != WIRE_LENGTH_DELIMITED && wireType != WIRE_FIXED32
            ) throw InvalidProtobuf()
            return Tag(number, wireType)
        }

        fun readLength(limit: Int): Int {
            val length = readVarint(limit)
            if (length < 0L || length > Int.MAX_VALUE.toLong() || length > (limit - position).toLong()) {
                throw InvalidProtobuf()
            }
            return length.toInt()
        }

        fun checkedEnd(length: Int, limit: Int): Int {
            if (length < 0 || length > limit - position) throw InvalidProtobuf()
            return position + length
        }

        fun skip(wireType: Int, limit: Int) {
            when (wireType) {
                WIRE_VARINT -> readVarint(limit)
                WIRE_FIXED64 -> advance(8, limit)
                WIRE_LENGTH_DELIMITED -> {
                    val length = readLength(limit)
                    position = checkedEnd(length, limit)
                }
                WIRE_FIXED32 -> advance(4, limit)
                else -> throw InvalidProtobuf()
            }
        }

        private fun advance(count: Int, limit: Int) {
            if (count < 0 || count > limit - position) throw InvalidProtobuf()
            position += count
        }

        private fun readVarint(limit: Int): Long {
            var result = 0L
            for (index in 0 until 10) {
                if (position >= limit) throw InvalidProtobuf()
                val byte = bytes[position++].toInt() and 0xff
                // A 64-bit varint's tenth byte can contain only bit 0 and cannot continue.
                if (index == 9 && (byte and 0xfe) != 0) throw InvalidProtobuf()
                result = result or ((byte and 0x7f).toLong() shl (index * 7))
                if ((byte and 0x80) == 0) return result
            }
            throw InvalidProtobuf()
        }
    }

    private class InvalidProtobuf : RuntimeException()

    private fun writeVarint(out: ByteArrayOutputStream, value: Long) {
        var remaining = value
        while (remaining and 0x7fL.inv() != 0L) {
            out.write(((remaining and 0x7fL) or 0x80L).toInt())
            remaining = remaining ushr 7
        }
        out.write(remaining.toInt())
    }

    private const val TILE_LAYERS_FIELD = 3
    private const val LAYER_NAME_FIELD = 1
    private const val LAYER_FEATURES_FIELD = 2
    private const val LAYER_KEYS_FIELD = 3
    private const val LAYER_VALUES_FIELD = 4
    private const val LAYER_EXTENT_FIELD = 5
    private const val LAYER_VERSION_FIELD = 15
    private const val WIRE_VARINT = 0
    private const val WIRE_FIXED64 = 1
    private const val WIRE_LENGTH_DELIMITED = 2
    private const val WIRE_FIXED32 = 5
    private const val MAX_FIELD_NUMBER = 0x1fffffff
    private const val UINT32_MAX = 0xffffffffL
}
