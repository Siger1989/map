package com.shantu.nativeapp.hybrid

import com.shantu.nativeapp.map.NativeCameraSnapshot
import earth.worldwind.WorldWind
import earth.worldwind.geom.*
import earth.worldwind.geom.Angle.Companion.degrees
import earth.worldwind.render.RenderResourceCache
import earth.worldwind.util.kgl.AndroidKgl
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import kotlin.math.hypot

/** Uses WorldWind's actual WGS84 current-camera projection, with no GL draw or network. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NativeCameraOffsetProjectionTest {
    private fun projector(latitude: Double, longitude: Double): (NativeCameraSnapshot) -> Pair<Double, Double>? {
        val engine = WorldWind(AndroidKgl(), RenderResourceCache(RuntimeEnvironment.getApplication(), 4_194_304L, 3_145_728L)).apply {
            viewport.set(0, 0, 390, 857)
            isKeepScale = false
            camera.fieldOfView = 45.0.degrees
        }
        val target = Position(latitude.degrees, longitude.degrees, 0.0)
        val point = Vec3(); val normal = Vec3(); val eye = Vec3(); val screen = Vec2()
        engine.globe.geographicToCartesian(target.latitude, target.longitude, 0.0, point)
        engine.globe.geographicToCartesianNormal(target.latitude, target.longitude, normal)
        return { pose ->
            engine.cameraFromLookAt(LookAt().apply { set(pose.latitude.degrees, pose.longitude.degrees, 0.0,
                AltitudeMode.ABSOLUTE, pose.rangeMeters, pose.headingDegrees.degrees, pose.pitchDegrees.degrees, pose.rollDegrees.degrees) })
            val camera = engine.camera.position
            engine.globe.geographicToCartesian(camera.latitude, camera.longitude, camera.altitude, eye)
            if ((eye.x - point.x) * normal.x + (eye.y - point.y) * normal.y + (eye.z - point.z) * normal.z <= 0.0) null
            else if (engine.geographicToScreenPoint(target, screen)) screen.x to screen.y else null
        }
    }

    private fun assertPreserved(initial: NativeCameraSnapshot, result: NativeCameraOffsetPolicy.Solution) {
        assertEquals(initial.rangeMeters, result.pose.rangeMeters, 0.0)
        assertEquals(initial.pitchDegrees, result.pose.pitchDegrees, 0.0)
        assertEquals(initial.headingDegrees, result.pose.headingDegrees, 0.0)
        assertEquals(initial.rollDegrees, result.pose.rollDegrees, 0.0)
        assertTrue(result.evaluations <= 38)
    }

    @Test fun regionalHighPitchAndBearingPlacePointInAvailableBottomArea() {
        val initial = NativeCameraSnapshot(30.67, 104.06, 2500.0, 53.0, 61.0)
        val project = projector(initial.latitude, initial.longitude)
        val result = NativeCameraOffsetPolicy.solve(initial, null, 183.0, 650.0, project)
        assertPreserved(initial, result)
        assertTrue("remaining error ${result.errorPixels}", result.errorPixels < 2.0)
        val final = project(result.pose)!!
        assertEquals(183.0, final.first, 2.0); assertEquals(650.0, final.second, 2.0)
    }

    @Test fun globeScaleRejectsPolarSeedAndKeepsTargetOnVisibleHemisphere() {
        val initial = NativeCameraSnapshot(15.0, 25.0, 19_000_000.0, 0.0, 0.0)
        val project = projector(initial.latitude, initial.longitude)
        val baseline = project(initial)!!
        val result = NativeCameraOffsetPolicy.solve(initial, initial.copy(latitude = -89.999999), 195.0, 620.0, project)
        assertPreserved(initial, result)
        assertNotNull(project(result.pose))
        assertTrue(result.errorPixels < hypot(baseline.first - 195.0, baseline.second - 620.0))
        assertTrue("globe error ${result.errorPixels}", result.errorPixels < 3.0)
    }

    @Test fun unreachableGlobeOffsetNeverMakesTheViewWorseOrFliesToOppositePole() {
        val initial = NativeCameraSnapshot(65.0, 20.0, 25_000_000.0, 0.0, 0.0)
        val project = projector(initial.latitude, initial.longitude)
        val baseline = project(initial)!!
        val result = NativeCameraOffsetPolicy.solve(initial, null, 195.0, 820.0, project)
        assertPreserved(initial, result)
        assertNotNull(project(result.pose))
        assertTrue(result.errorPixels <= hypot(baseline.first - 195.0, baseline.second - 820.0))
        assertTrue(result.pose.latitude > 0.0)
    }

    @Test fun dateLineWithRotatedObliqueCameraConvergesWithoutChangingZoomRange() {
        val initial = NativeCameraSnapshot(20.0, 179.98, 5000.0, 85.0, 48.0)
        val result = NativeCameraOffsetPolicy.solve(initial, null, 235.0, 620.0, projector(initial.latitude, initial.longitude))
        assertPreserved(initial, result)
        assertTrue("date line error ${result.errorPixels}", result.errorPixels < 2.0)
    }

    @Test fun alreadyCenteredAndUnprojectableTargetsKeepInitialPose() {
        val initial = NativeCameraSnapshot(30.0, 104.0, 2000.0, 20.0, 50.0)
        val project = projector(initial.latitude, initial.longitude)
        val point = project(initial)!!
        assertEquals(initial, NativeCameraOffsetPolicy.solve(initial, null, point.first, point.second, project).pose)
        assertEquals(initial, NativeCameraOffsetPolicy.solve(initial, null, 100.0, 200.0) { null }.pose)
    }
}
