package com.shantu.nativeapp.floating

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.hardware.GeomagneticField
import android.view.Surface
import android.view.WindowManager
import java.util.Date

/** Screen-on, view-scoped device compass. No route/course fallback is provided. */
internal class FloatingCompassSource(
    context: Context,
    private val onHeading: (Double?, String, Long?, Boolean) -> Unit,
) : SensorEventListener {
    private val appContext = context.applicationContext
    private val sensorManager = appContext.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
    private val rotationSensor = sensorManager?.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
    private var registered = false
    private val samplePolicy = FloatingCompassSamplePolicy()
    private val recoveryPolicy = FloatingCompassRecoveryPolicy()
    private val handler = Handler(Looper.getMainLooper())
    private var receivedSampleThisRun = false
    private var lastRegistrationFailed = false
    private var cachedHeading: Double? = null
    private var cachedHeadingAtNanos = 0L
    private var lastDeclinationUpdate = 0L
    private var declination = 0.0
    private var declinationReady = false
    private var latitude: Double? = null
    private var longitude: Double? = null
    private var altitudeMeters = 0f
    private var locationUpdatedAtNanos = 0L
    private val rotationMatrix = FloatArray(9)
    private val remappedMatrix = FloatArray(9)
    private val orientation = FloatArray(3)
    private val retryRegistration = Runnable { retrySensorRegistration() }
    private val sampleTimeout = Runnable { recoverIfNoSample() }

    fun start() {
        if (registered) return
        recoveryPolicy.reset()
        receivedSampleThisRun = false
        lastRegistrationFailed = false
        samplePolicy.start()
        publishFreshCacheOrWaiting()
        val manager = sensorManager
        val sensor = rotationSensor
        if (manager == null || sensor == null) {
            samplePolicy.stop()
            publishCachedPreview("设备不支持罗盘传感器")
            return
        }
        registerSensor()
        if (registered) scheduleSampleTimeout() else scheduleRetry()
    }

    fun stop() {
        handler.removeCallbacks(retryRegistration)
        handler.removeCallbacks(sampleTimeout)
        if (registered) sensorManager?.unregisterListener(this)
        registered = false
        samplePolicy.stop()
        publishCachedPreview("等待罗盘方向")
    }

    fun updateLocation(lat: Double, lon: Double, altitude: Double) {
        if (!lat.isFinite() || lat !in -90.0..90.0 || !lon.isFinite() || lon !in -180.0..180.0) return
        latitude = lat
        longitude = lon
        locationUpdatedAtNanos = SystemClock.elapsedRealtimeNanos()
        altitudeMeters = altitude.toFloat().takeIf { it.isFinite() } ?: 0f
        // Keep the last valid declination while recalculating for the new fix.
        lastDeclinationUpdate = 0L
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {
        if (sensor?.type != Sensor.TYPE_ROTATION_VECTOR) return
        if (accuracy < SensorManager.SENSOR_STATUS_ACCURACY_MEDIUM) publishCachedPreview("罗盘精度不足，请移动手机校准")
    }

    override fun onSensorChanged(event: SensorEvent) {
        if (event.sensor.type != Sensor.TYPE_ROTATION_VECTOR || !registered) return
        val elapsedNow = SystemClock.elapsedRealtimeNanos()
        if (!samplePolicy.accepts(event.timestamp, elapsedNow, event.accuracy)) {
            val message = when {
                event.accuracy < SensorManager.SENSOR_STATUS_ACCURACY_MEDIUM -> "罗盘精度不足，请移动手机校准"
                event.timestamp > elapsedNow -> "罗盘传感器时间异常"
                event.timestamp <= 0L || elapsedNow - event.timestamp > 3_000_000_000L -> "罗盘数据已过期，等待新方向"
                else -> "等待罗盘方向"
            }
            publishCachedPreview(message)
            return
        }
        receivedSampleThisRun = true
        handler.removeCallbacks(retryRegistration)
        handler.removeCallbacks(sampleTimeout)
        SensorManager.getRotationMatrixFromVector(rotationMatrix, event.values)
        val displayRotation = runCatching {
            (appContext.getSystemService(Context.WINDOW_SERVICE) as WindowManager).defaultDisplay.rotation
        }.getOrDefault(Surface.ROTATION_0)
        val (axisX, axisY) = when (displayRotation) {
            Surface.ROTATION_90 -> SensorManager.AXIS_Y to SensorManager.AXIS_MINUS_X
            Surface.ROTATION_180 -> SensorManager.AXIS_MINUS_X to SensorManager.AXIS_MINUS_Y
            Surface.ROTATION_270 -> SensorManager.AXIS_MINUS_Y to SensorManager.AXIS_X
            else -> SensorManager.AXIS_X to SensorManager.AXIS_Y
        }
        if (!SensorManager.remapCoordinateSystem(rotationMatrix, axisX, axisY, remappedMatrix)) return
        SensorManager.getOrientation(remappedMatrix, orientation)
        val magneticAzimuth = Math.toDegrees(orientation[0].toDouble())
        if (!magneticAzimuth.isFinite()) return
        updateDeclination(System.currentTimeMillis())
        val locationCurrent = locationUpdatedAtNanos > 0L && SystemClock.elapsedRealtimeNanos() - locationUpdatedAtNanos <= 30_000_000_000L
        val resolved = samplePolicy.resolveHeading(magneticAzimuth, declination.takeIf { declinationReady }, locationCurrent) ?: return
        samplePolicy.rememberAccepted(event.timestamp, event.accuracy)
        cachedHeading = resolved.degrees
        cachedHeadingAtNanos = event.timestamp
        val label = if (resolved.label == "真北") "" else resolved.label
        onHeading(resolved.degrees, label, event.timestamp, true)
    }

    private fun publishFreshCacheOrWaiting() {
        publishCachedPreview("等待新的罗盘方向")
    }

    private fun publishCachedPreview(fallbackMessage: String) {
        val state = samplePolicy.cacheState(SystemClock.elapsedRealtimeNanos())
        if (cachedHeading != null && (state == FloatingCompassSamplePolicy.CacheState.FRESH || state == FloatingCompassSamplePolicy.CacheState.PREVIEW)) {
            onHeading(cachedHeading, "上次方向，正在更新", cachedHeadingAtNanos, false)
        } else {
            onHeading(null, fallbackMessage, null, false)
        }
    }

    private fun registerSensor() {
        val manager = sensorManager
        val sensor = rotationSensor
        registered = manager != null && sensor != null && manager.registerListener(this, sensor, SensorManager.SENSOR_DELAY_UI)
        lastRegistrationFailed = !registered
    }

    private fun scheduleSampleTimeout() {
        handler.removeCallbacks(sampleTimeout)
        handler.postDelayed(sampleTimeout, SAMPLE_TIMEOUT_MS)
    }

    private fun recoverIfNoSample() {
        if (!registered || receivedSampleThisRun) return
        if (recoveryPolicy.takeRetry()) {
            sensorManager?.unregisterListener(this)
            registered = false
            registerSensor()
            if (registered) {
                publishCachedPreview("仍在等待罗盘传感器数据，正在重试")
                scheduleSampleTimeout()
            } else {
                publishCachedPreview("罗盘传感器暂不可用，正在重试")
                scheduleRetry()
            }
            return
        }
        registered = false
        sensorManager?.unregisterListener(this)
        samplePolicy.stop()
        val message = if (lastRegistrationFailed) "罗盘传感器暂不可用，请稍后重试"
        else "未收到可靠罗盘数据，请移动手机校准或稍后重试"
        publishCachedPreview(message)
    }

    private fun scheduleRetry() {
        handler.removeCallbacks(retryRegistration)
        handler.postDelayed(retryRegistration, SAMPLE_TIMEOUT_MS)
    }

    private fun retrySensorRegistration() {
        if (registered || !samplePolicy.isRunning()) return
        if (!recoveryPolicy.takeRetry()) {
            samplePolicy.stop()
            publishCachedPreview("罗盘传感器暂不可用，请稍后重试")
            return
        }
        registerSensor()
        if (registered) {
            publishCachedPreview("仍在等待罗盘传感器数据，正在重试")
            scheduleSampleTimeout()
        } else {
            publishCachedPreview("罗盘传感器暂不可用，正在重试")
            scheduleRetry()
        }
    }

    private fun updateDeclination(now: Long) {
        if (now - lastDeclinationUpdate < 60_000L) return
        val lat = latitude ?: return
        val lon = longitude ?: return
        declination = runCatching {
            GeomagneticField(lat.toFloat(), lon.toFloat(), altitudeMeters, Date(now).time).declination.toDouble()
        }.getOrNull() ?: return
        declinationReady = declination.isFinite()
        lastDeclinationUpdate = now
    }

    private companion object {
        const val SAMPLE_TIMEOUT_MS = 1_500L
    }
}
