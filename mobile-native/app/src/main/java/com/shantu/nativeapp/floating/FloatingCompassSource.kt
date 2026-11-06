package com.shantu.nativeapp.floating

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.SystemClock
import android.hardware.GeomagneticField
import android.view.Surface
import android.view.WindowManager
import java.util.Date

/** Screen-on, view-scoped device compass. No route/course fallback is provided. */
internal class FloatingCompassSource(
    context: Context,
    private val onHeading: (Double?, String, Long?) -> Unit,
) : SensorEventListener {
    private val appContext = context.applicationContext
    private val sensorManager = appContext.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
    private val rotationSensor = sensorManager?.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
    private var registered = false
    private val samplePolicy = FloatingCompassSamplePolicy()
    private var lastDeclinationUpdate = 0L
    private var declination = 0.0
    private var declinationReady = false
    private var latitude: Double? = null
    private var longitude: Double? = null
    private var altitudeMeters = 0f
    private val rotationMatrix = FloatArray(9)
    private val remappedMatrix = FloatArray(9)
    private val orientation = FloatArray(3)

    fun start() {
        if (registered) return
        val manager = sensorManager
        val sensor = rotationSensor
        if (manager == null || sensor == null) {
            onHeading(null, "设备不支持罗盘传感器", null)
            return
        }
        registered = manager.registerListener(this, sensor, SensorManager.SENSOR_DELAY_UI)
        if (registered) samplePolicy.start() else onHeading(null, "罗盘暂不可用", null)
    }

    fun stop() {
        if (registered) sensorManager?.unregisterListener(this)
        registered = false
        samplePolicy.stop()
        onHeading(null, "等待罗盘方向", null)
    }

    fun updateLocation(lat: Double, lon: Double, altitude: Double) {
        if (!lat.isFinite() || lat !in -90.0..90.0 || !lon.isFinite() || lon !in -180.0..180.0) return
        latitude = lat
        longitude = lon
        altitudeMeters = altitude.toFloat().takeIf { it.isFinite() } ?: 0f
        lastDeclinationUpdate = 0L
        declinationReady = false
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {
        if (sensor?.type != Sensor.TYPE_ROTATION_VECTOR) return
        if (accuracy < SensorManager.SENSOR_STATUS_ACCURACY_MEDIUM) onHeading(null, "罗盘精度不足，请移动手机校准", null)
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
            onHeading(null, message, null)
            return
        }
        if (latitude == null || longitude == null) {
            onHeading(null, "等待定位以校正罗盘", null)
            return
        }
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
        if (!declinationReady) { onHeading(null, "等待定位以校正罗盘", null); return }
        val trueAzimuth = ((magneticAzimuth + declination) % 360.0 + 360.0) % 360.0
        onHeading(trueAzimuth, "", event.timestamp)
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
}
