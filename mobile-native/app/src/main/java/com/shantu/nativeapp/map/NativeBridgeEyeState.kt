package com.shantu.nativeapp.map

import earth.worldwind.geom.Camera
import earth.worldwind.geom.AltitudeMode

/** Exact eye/projection inputs consumed by WorldWind, independent of terrain-derived LookAt. */
internal data class NativeBridgeEyeState(
    val latitudeDegrees: Double,
    val longitudeDegrees: Double,
    val altitudeMeters: Double,
    val altitudeMode: AltitudeMode,
    val headingDegrees: Double,
    val tiltDegrees: Double,
    val rollDegrees: Double,
    val fieldOfViewDegrees: Double,
) {
    companion object {
        fun from(camera: Camera) = NativeBridgeEyeState(
            latitudeDegrees = camera.position.latitude.inDegrees,
            longitudeDegrees = camera.position.longitude.inDegrees,
            altitudeMeters = camera.position.altitude,
            altitudeMode = camera.altitudeMode,
            headingDegrees = camera.heading.inDegrees,
            tiltDegrees = camera.tilt.inDegrees,
            rollDegrees = camera.roll.inDegrees,
            fieldOfViewDegrees = camera.fieldOfView.inDegrees,
        )
    }
}
