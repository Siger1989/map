package com.shantu.nativeapp.map

import earth.worldwind.PickedObjectList

/** WWK rectangle picks retain unhit candidates; only GPU-marked objects are actual pixel hits. */
internal object NativeRenderedPickResults {
    fun objectIds(picked: PickedObjectList?): List<String> = picked?.objects.orEmpty().asSequence()
        .filter { it.isOnTop && !it.isTerrain }
        .mapNotNull { hit ->
            (hit.userObject as? String)?.takeIf {
                it.startsWith("shantu-object:") || it.startsWith("shantu-bridge:") ||
                    it.startsWith("geology:") || it.startsWith("shantu-photo:") || it.startsWith("shantu-section:")
            }?.removePrefix("shantu-object:")
        }.distinct().toList()
}
