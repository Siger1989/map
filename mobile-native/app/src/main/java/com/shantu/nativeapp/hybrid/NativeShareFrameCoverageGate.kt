package com.shantu.nativeapp.hybrid

import com.shantu.nativeapp.map.NativePrintRasterFrameSnapshot

/** Requires two consecutive real draw frames with identical, complete visible base-tile coverage. */
internal class NativeShareFrameCoverageGate(private val requiredStableFrames: Int = 2) {
    init { require(requiredStableFrames >= 1) }

    private var lastSequence = 0L
    private var previousVisibleKeys: Set<String>? = null
    private var previousSupplementalSignature: String? = null
    private var stableFrames = 0

    fun lastObservedSequence(): Long = lastSequence
    fun stableFrameCount(): Int = stableFrames

    fun observe(snapshot: NativePrintRasterFrameSnapshot, supplementalSignature: String = ""): Int {
        if (snapshot.sequence <= lastSequence) return stableFrames
        val consecutive = lastSequence == 0L || snapshot.sequence == lastSequence + 1L
        lastSequence = snapshot.sequence
        if (!consecutive) {
            previousVisibleKeys = null
            previousSupplementalSignature = null
            stableFrames = 0
        }
        if (!snapshot.complete) {
            previousVisibleKeys = null
            previousSupplementalSignature = null
            stableFrames = 0
            return stableFrames
        }
        stableFrames = if (snapshot.visibleLeafKeys == previousVisibleKeys && supplementalSignature == previousSupplementalSignature) stableFrames + 1 else 1
        previousVisibleKeys = snapshot.visibleLeafKeys
        previousSupplementalSignature = supplementalSignature
        return stableFrames
    }

    fun isReady(): Boolean = stableFrames >= requiredStableFrames
}
