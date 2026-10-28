package com.shantu.nativeapp.ui

/** Framework-free collection ordering and folder-tree rules shared by the native panel. */
internal object NativeCollectionPanelLogic {
    data class SortItem(
        val key: String,
        val kind: String,
        val createdAt: Long?,
        /** Longitude, latitude. */
        val coordinate: Pair<Double, Double>?,
    )

    data class Folder(val id: String, val parentId: String?, val name: String)
    data class FolderRow(val folder: Folder, val depth: Int, val hasChildren: Boolean)

    fun <T> sort(
        values: List<T>,
        keys: List<SortItem>,
        order: String,
        center: Pair<Double, Double>?,
        keyOf: (T) -> String,
    ): List<T> {
        if (order == "manual") return values
        val keyById = keys.associateBy { it.key }
        val kinds = listOf("route", "track", "pin", "model", "area", "section")
        return values.withIndex().sortedWith { left, right ->
            val a = keyById[keyOf(left.value)]
            val b = keyById[keyOf(right.value)]
            val comparison = when (order) {
                "kind" -> (kinds.indexOf(a?.kind) - kinds.indexOf(b?.kind))
                    .takeIf { it != 0 } ?: 0
                "nearest", "farthest" -> compareNullable(
                    a?.coordinate?.let { coordinate -> center?.let { distanceMeters(coordinate, it) } },
                    b?.coordinate?.let { coordinate -> center?.let { distanceMeters(coordinate, it) } },
                    descending = order == "farthest",
                )
                "oldest", "newest" -> compareNullable(a?.createdAt, b?.createdAt, descending = order == "newest")
                "name" -> 0 // Name sorting is performed by the caller, which owns display labels.
                else -> 0
            }
            if (comparison != 0) comparison else left.index.compareTo(right.index)
        }.map { it.value }
    }

    /** Extracts the original sibling tree order while omitting children under collapsed folders. */
    fun visibleFolders(folders: List<Folder>, collapsed: Set<String>): List<FolderRow> {
        val children = folders.groupBy { it.parentId.orEmpty() }
        val result = mutableListOf<FolderRow>()
        fun visit(parent: String?, depth: Int) {
            children[parent.orEmpty()].orEmpty().forEach { folder ->
                val hasChildren = children[folder.id].orEmpty().isNotEmpty()
                result += FolderRow(folder, depth, hasChildren)
                if (hasChildren && folder.id !in collapsed) visit(folder.id, depth + 1)
            }
        }
        visit(null, 0)
        return result
    }

    fun descendantFolderIds(folders: List<Folder>, rootId: String?): Set<String> {
        if (rootId == null) return folders.map { it.id }.toSet() + "unfiled"
        if (rootId == "unfiled") return setOf("unfiled")
        val result = mutableSetOf(rootId)
        var changed = true
        while (changed) {
            changed = false
            folders.forEach { folder ->
                if (folder.parentId in result && result.add(folder.id)) changed = true
            }
        }
        return result
    }

    private fun <T : Comparable<T>> compareNullable(a: T?, b: T?, descending: Boolean): Int {
        if (a == null || b == null) return when {
            a == null && b == null -> 0
            a == null -> 1
            else -> -1
        }
        val result = a.compareTo(b)
        return if (descending) -result else result
    }

    private fun distanceMeters(a: Pair<Double, Double>, b: Pair<Double, Double>): Double {
        val rad = Math.PI / 180.0
        val lat1 = a.second * rad
        val lat2 = b.second * rad
        val dLat = (b.second - a.second) * rad
        val dLon = (b.first - a.first) * rad
        val h = kotlin.math.sin(dLat / 2) * kotlin.math.sin(dLat / 2) +
            kotlin.math.cos(lat1) * kotlin.math.cos(lat2) *
            kotlin.math.sin(dLon / 2) * kotlin.math.sin(dLon / 2)
        return 6_371_000.0 * 2 * kotlin.math.asin(kotlin.math.sqrt(h.coerceIn(0.0, 1.0)))
    }
}
