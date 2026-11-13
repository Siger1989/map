package com.shantu.nativeapp.map

/** Raster-only edge policy. Rows follow WorldWind's south-origin Mercator grid. */
internal object NativeRasterFeatherPolicy {
    const val WEST = 1
    const val SOUTH = 2
    const val EAST = 4
    const val NORTH = 8
    const val ALL = WEST or SOUTH or EAST or NORTH
    /** Maximum feather depth measured inward from one child-tile edge; 0.5 ends at tile center. */
    const val BAND_FRACTION = 0.5f
    const val MAX_LEAVES = 2048

    fun key(level: Int, row: Int, column: Int): Long =
        (level.toLong() shl 48) or (row.toLong() shl 24) or column.toLong()

    /** Conservative: unknown/offscreen or partly fine neighboring edges never cause fading. */
    fun lodEdges(level: Int, row: Int, column: Int, resolvedLevel: Int, hasBacking: Boolean,
                 resolvedLeaves: Map<Long, Int>): Int {
        if (!hasBacking || resolvedLevel < 0 || level !in 0..24) return 0
        val side = 1 shl level
        fun finerBorder(z: Int, r: Int, c: Int, facing: Int, depth: Int): Boolean {
            val value = resolvedLeaves[key(z, r, c)]
            if (value != null) return value >= 0 && value < resolvedLevel
            if (depth == 0 || z == 24) return false
            // Follow only the two children touching our edge, not the neighbor's entire subtree.
            return when (facing) {
                WEST -> finerBorder(z+1,r*2,c*2,WEST,depth-1) && finerBorder(z+1,r*2+1,c*2,WEST,depth-1)
                EAST -> finerBorder(z+1,r*2,c*2+1,EAST,depth-1) && finerBorder(z+1,r*2+1,c*2+1,EAST,depth-1)
                SOUTH -> finerBorder(z+1,r*2,c*2,SOUTH,depth-1) && finerBorder(z+1,r*2,c*2+1,SOUTH,depth-1)
                else -> finerBorder(z+1,r*2+1,c*2,NORTH,depth-1) && finerBorder(z+1,r*2+1,c*2+1,NORTH,depth-1)
            }
        }
        fun coarser(nextRow: Int, nextColumn: Int, facing: Int): Boolean {
            if (nextRow !in 0 until side) return false
            val col = Math.floorMod(nextColumn, side)
            for (candidate in level downTo 0) {
                val shift = level - candidate
                val neighbor = resolvedLeaves[key(candidate, nextRow shr shift, col shr shift)]
                if (neighbor != null) return neighbor >= 0 && neighbor < resolvedLevel
            }
            return finerBorder(level, nextRow, col, facing, 3)
        }
        var result = 0
        if (coarser(row, column - 1, EAST)) result = result or WEST
        if (coarser(row - 1, column, NORTH)) result = result or SOUTH
        if (coarser(row, column + 1, WEST)) result = result or EAST
        if (coarser(row + 1, column, SOUTH)) result = result or NORTH
        return result
    }

    /** A fixed-resolution frontier is softened only where a known lower-level backing exists. */
    fun fixedEdges(west: Boolean, south: Boolean, east: Boolean, north: Boolean): Int =
        (if (west) 0 else WEST) or (if (south) 0 else SOUTH) or
            (if (east) 0 else EAST) or (if (north) 0 else NORTH)

    fun fade(distance: Double, width: Double): Double {
        if (width <= 0.0) return 1.0
        val t = (distance / width).coerceIn(0.0, 1.0)
        return t * t * (3.0 - 2.0 * t)
    }
}
