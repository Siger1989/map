package com.shantu.nativeapp.map

import java.security.MessageDigest

/** Equality key for WorldWind image sources; dynamic view generation is intentionally excluded. */
internal class NativeImageSourceIdentity(
    private val network: Any,
    private val source: Any,
    private val tile: TileRequestIdentity?,
    private val fallback: String,
    private val onDecoded: () -> Unit,
    private val onStarted: () -> Unit,
    private val onFinished: () -> Unit,
    @Suppress("UNUSED_PARAMETER") generationSupplier: (() -> Long?)?,
) {
    override fun equals(other: Any?): Boolean {
        if (other !is NativeImageSourceIdentity || network !== other.network) return false
        val sameTile = if (tile != null && other.tile != null) tile.cacheKey == other.tile.cacheKey
            else tile == null && other.tile == null && source === other.source && fallback == other.fallback
        return sameTile && onDecoded === other.onDecoded && onStarted === other.onStarted && onFinished === other.onFinished
    }

    override fun hashCode(): Int {
        var result = System.identityHashCode(network)
        result = 31 * result + (tile?.cacheKey ?: fallback).hashCode()
        result = 31 * result + System.identityHashCode(onDecoded)
        result = 31 * result + System.identityHashCode(onStarted)
        result = 31 * result + System.identityHashCode(onFinished)
        return result
    }
}

/** Canonical raw provider tile actually fetched by transformed/subdivided output tiles. */
internal data class NativeRasterSourceTileKey(val z: Int, val x: Int, val y: Int) {
    companion object {
        fun from(z: Int, x: Int, y: Int): NativeRasterSourceTileKey? {
            if (z !in 0..24 || y !in 0 until (1 shl z)) return null
            return NativeRasterSourceTileKey(z, Math.floorMod(x, 1 shl z), y)
        }

        /** Parent image actually requested by the explicit OVMAP `{$x/2},{$y/2},{$z-1}` pattern. */
        fun requestKey(layer: NativeMapRasterLayer, z: Int, x: Int, y: Int): NativeRasterSourceTileKey? {
            val tile = from(z, x, y) ?: return null
            if (!layer.subdivide || !layer.ovmapTemplate || z == 0 || !layer.tiles.any(::hasSubdivideParentPattern)) return tile
            return NativeRasterSourceTileKey(z - 1, tile.x / 2, tile.y / 2)
        }

        private fun hasSubdivideParentPattern(template: String): Boolean =
            Regex("\\{\\\$x/2\\}", RegexOption.IGNORE_CASE).containsMatchIn(template) &&
                Regex("\\{\\\$y/2\\}", RegexOption.IGNORE_CASE).containsMatchIn(template) &&
                Regex("\\{\\\$z-1\\}", RegexOption.IGNORE_CASE).containsMatchIn(template)
    }
}

/** Fingerprints request-defining source configuration without retaining or exposing templates/tokens. */
internal object NativeRasterStyleFingerprint {
    fun create(fields: List<String>): String {
        val canonical = fields.joinToString(separator = "") { "${it.length}:$it;" }
        val digest = MessageDigest.getInstance("SHA-256").digest(canonical.toByteArray(Charsets.UTF_8))
        val hex = CharArray(digest.size * 2); val digits = "0123456789abcdef"
        digest.forEachIndexed { index, item ->
            val byte = item.toInt() and 0xff
            hex[index * 2] = digits[byte ushr 4]; hex[index * 2 + 1] = digits[byte and 0x0f]
        }
        return String(hex)
    }
}
