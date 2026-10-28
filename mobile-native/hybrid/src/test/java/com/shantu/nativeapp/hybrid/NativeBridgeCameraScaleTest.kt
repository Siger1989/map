package com.shantu.nativeapp.hybrid

import android.app.ActivityManager
import android.content.Context
import com.shantu.nativeapp.map.NativeCameraSnapshot
import com.shantu.nativeapp.map.NativeMapController
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import earth.worldwind.geom.Angle
import earth.worldwind.geom.Angle.Companion.degrees
import earth.worldwind.geom.Position
import earth.worldwind.geom.LookAt
import earth.worldwind.geom.Sector
import earth.worldwind.globe.elevation.coverage.AbstractElevationCoverage
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], manifest = Config.NONE)
class NativeBridgeCameraScaleTest {
    private class ChangingGround : AbstractElevationCoverage() {
        var height = 1_000f
        init { sector.setFullSphere() }
        override fun clear() {}
        override fun doGetElevation(latitude: Angle, longitude: Angle, retrieve: Boolean) = height
        override fun doGetElevationGrid(sector: Sector, gridWidth: Int, gridHeight: Int, result: FloatArray) { result.fill(height) }
        override fun doGetElevationLimits(sector: Sector, result: FloatArray) { result.fill(height) }
    }

    @Test fun loadedGroundAndExaggerationKeepRequestedTargetUntilManualGesture() {
        val context = RuntimeEnvironment.getApplication()
        val memory = shadowOf(context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager)
        memory.setMemoryClass(256)
        memory.setMemoryInfo(ActivityManager.MemoryInfo().apply { totalMem = 2L * 1024 * 1024 * 1024 })
        val controller = NativeMapController(context, "fixture") { }
        try {
            controller.configureBridgeCameraScale()
            val engine = controller.worldWindowForBridge().engine
            engine.setupViewport(390, 857, 1f)
            controller.setTerrain(true)
            val ground = ChangingGround()
            engine.globe.elevationModel.addCoverage(ground)
            controller.setTerrainExaggeration(2.0)
            val target = NativeCameraSnapshot(31.0, 102.9, 17_000.0, 20.0, 55.0)
            controller.restoreCamera(target)
            fun assertAnchor(height: Double) {
                val look = engine.cameraAsLookAt(LookAt(), Position(31.0.degrees, 102.9.degrees, height))
                assertEquals(17_000.0, look.range, 0.01)
                assertEquals(55.0, look.tilt.inDegrees, 0.01)
                repeat(30) {
                    val actual = controller.cameraSnapshot()
                    assertEquals(31.0, actual.latitude, 1e-9)
                    assertEquals(102.9, actual.longitude, 1e-9)
                    assertEquals(17_000.0, actual.rangeMeters, 0.01)
                    assertEquals(55.0, actual.pitchDegrees, 0.01)
                }
            }
            assertAnchor(2_000.0)
            ground.height = 1_500f
            assertTrue(controller.refreshBridgeGroundAnchor())
            assertAnchor(3_000.0)
            assertFalse(controller.refreshBridgeGroundAnchor())
            // The anchor is only the inversion reference. Never return the requested
            // snapshot itself: changing the real eye must change the measured range.
            engine.camera.position.altitude += 500.0
            assertTrue(kotlin.math.abs(controller.cameraSnapshot().rangeMeters - 17_000.0) > 1.0)
            controller.restoreCamera(target)
            controller.clearBridgeGroundAnchor()
            ground.height = 2_000f
            assertFalse(controller.refreshBridgeGroundAnchor())
        } finally { controller.dispose() }
    }

    @Test fun repeatedTwoWayCameraSnapshotsConvergeWithoutMovingGroundTargetOrRange() {
        val context = RuntimeEnvironment.getApplication()
        val memory = shadowOf(context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager)
        memory.setMemoryClass(256)
        memory.setMemoryInfo(ActivityManager.MemoryInfo().apply { totalMem = 2L * 1024 * 1024 * 1024 })
        val controllers = List(2) { NativeMapController(context, "fixture") { } }
        try {
            controllers.forEach { controller ->
                controller.configureBridgeCameraScale()
                val engine = controller.worldWindowForBridge().engine
                engine.setupViewport(1076, 857, 1f)
                controller.setTerrain(true)
                engine.globe.elevationModel.addCoverage(ChangingGround())
            }
            val target = NativeCameraSnapshot(31.0, 102.9, 17_000.0, 20.0, 55.0)
            controllers[0].restoreCamera(target)
            repeat(60) {
                controllers[1].restoreCamera(controllers[0].cameraSnapshot())
                controllers[0].restoreCamera(controllers[1].cameraSnapshot())
            }
            controllers.forEach { controller ->
                val actual = controller.cameraSnapshot()
                assertEquals(target.latitude, actual.latitude, 1e-8)
                assertEquals(target.longitude, actual.longitude, 1e-8)
                assertEquals(target.rangeMeters, actual.rangeMeters, .01)
                assertEquals(target.headingDegrees, actual.headingDegrees, .01)
                assertEquals(target.pitchDegrees, actual.pitchDegrees, .01)
                controller.clearBridgeGroundAnchor()
                controller.zoomBy(1.0)
                assertFalse(controller.refreshBridgeGroundAnchor())
            }
        } finally { controllers.forEach { it.dispose() } }
    }

    @Test fun initialTinySurfaceAndPhoneResizesKeepTheCameraProjectionAndRange() {
        val context = RuntimeEnvironment.getApplication()
        val memory = shadowOf(context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager)
        memory.setMemoryClass(256)
        memory.setMemoryInfo(ActivityManager.MemoryInfo().apply { totalMem = 2L * 1024 * 1024 * 1024 })
        val controller = NativeMapController(context, "fixture") { }
        try {
            controller.configureBridgeCameraScale()
            assertFalse(controller.cartographyForBridge().layers.any { it.isEnabled })
            val engine = controller.worldWindowForBridge().engine
            assertFalse(engine.isKeepScale)
            engine.setupViewport(1, 1, 1f)
            engine.setupViewport(390, 857, 1f)
            assertEquals(45.0, engine.camera.fieldOfView.inDegrees, 1e-9)
            controller.restoreCamera(NativeCameraSnapshot(31.0, 102.9, 17_000.0, 20.0, 55.0))
            val before = controller.cameraSnapshot()
            assertEquals(17_000.0, before.rangeMeters, 0.01)
            assertEquals(55.0, before.pitchDegrees, 0.01)
            engine.setupViewport(360, 780, 1f)
            assertEquals(45.0, engine.camera.fieldOfView.inDegrees, 1e-9)
            assertEquals(before.rangeMeters, controller.cameraSnapshot().rangeMeters, 0.01)
            controller.restoreCamera(NativeCameraSnapshot(31.0, 102.9, 17_000.0, 0.0, 0.0))
            assertEquals(0.0, controller.cameraSnapshot().pitchDegrees, 0.0)
            assertEquals(0.0, controller.cameraSnapshot().headingDegrees, 0.0)
            controller.restoreCamera(NativeCameraSnapshot(31.0, 102.9, 17_000.0, 0.0, 50.0))
            assertEquals(50.0, controller.cameraSnapshot().pitchDegrees, 0.01)
        } finally { controller.dispose() }
    }
}
