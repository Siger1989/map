package com.guanyun.weather

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Rect
import android.graphics.SurfaceTexture
import android.hardware.GeomagneticField
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.hardware.camera2.CaptureResult
import android.hardware.camera2.TotalCaptureResult
import android.hardware.display.DisplayManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Size
import android.view.Surface
import android.view.TextureView
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.FrameLayout
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.asin
import kotlin.math.atan
import kotlin.math.atan2
import kotlin.math.hypot
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** Owns the rear camera and device pose for the foreground, trusted sky page. */
internal class SkyCameraBridge(
    private val activity: NativeReactActivity,
    root: FrameLayout,
    private val webView: WebView,
) : SensorEventListener, TextureView.SurfaceTextureListener {
    private val main = Handler(Looper.getMainLooper())
    private val cameraManager = activity.getSystemService(CameraManager::class.java)
    private val sensors = activity.getSystemService(SensorManager::class.java)
    private val rotationVector = sensors.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
    private val pressureSensor = sensors.getDefaultSensor(Sensor.TYPE_PRESSURE)
    private val barometer = SkyBarometer()
    private val displayManager = activity.getSystemService(DisplayManager::class.java)
    private val texture = TextureView(activity).apply { surfaceTextureListener = this@SkyCameraBridge }
    private val frame = FrameLayout(activity).apply {
        visibility = View.GONE
        setBackgroundColor(Color.BLACK)
        importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
        addView(texture, FrameLayout.LayoutParams(-1, -1))
    }
    private val displayListener = object : DisplayManager.DisplayListener {
        override fun onDisplayAdded(displayId: Int) = Unit
        override fun onDisplayRemoved(displayId: Int) = Unit
        override fun onDisplayChanged(displayId: Int) {
            if (displayId == texture.display?.displayId && rotation != displayRotation()) resizePreview()
        }
    }

    var isActive = false
        private set
    private var cameraEnabled = true
    private var foreground = false
    private var sensorRegistered = false
    private var pressureRegistered = false
    private var lastPressureTime = 0L
    private var permissionPending = false
    private var permissionDenied = false
    private var generation = 0
    private var opening = false
    private var camera: CameraDevice? = null
    private var session: CameraCaptureSession? = null
    private var surface: Surface? = null
    private var buffer: Size? = null
    private var characteristics: CameraCharacteristics? = null
    private var calibratedFocalLength: Double? = null
    private var captureCrop: Rect? = null
    private var frameReady = false
    private var rotation = Surface.ROTATION_0
    private var lastPoseTime = 0L
    private var declination: Double? = null
    private var poseStatus = "waiting"
    private var optics: JSONObject? = null
    private val matrix = FloatArray(9)

    init {
        root.addView(frame, root.indexOfChild(webView), FrameLayout.LayoutParams(0, 0))
        displayManager.registerDisplayListener(displayListener, main)
        frame.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> resizePreview() }
    }

    @JavascriptInterface
    fun setActive(enabled: Boolean, preview: Boolean) = dispatch {
        if (!enabled) {
            stopPage()
        } else {
            if (!isActive || preview != cameraEnabled) permissionDenied = false
            isActive = true
            cameraEnabled = preview
            reconcile()
        }
    }

    @JavascriptInterface
    fun setViewport(left: Double, top: Double, width: Double, height: Double, scale: Double) = dispatch {
        if (!listOf(left, top, width, height, scale).all(Double::isFinite) ||
            scale !in 0.25..16.0 || width !in 1.0..10000.0 || height !in 1.0..10000.0) return@dispatch
        val right = (left + width) * scale
        val bottom = (top + height) * scale
        if (left * scale < -1 || top * scale < -1 || right > webView.width + 1 ||
            bottom > webView.height + 1) return@dispatch
        val x = (left * scale).roundToInt() + webView.left
        val y = (top * scale).roundToInt() + webView.top
        val pixelWidth = right.roundToInt() - (left * scale).roundToInt()
        val pixelHeight = bottom.roundToInt() - (top * scale).roundToInt()
        val layout = frame.layoutParams as FrameLayout.LayoutParams
        if (layout.leftMargin != x || layout.topMargin != y ||
            layout.width != pixelWidth || layout.height != pixelHeight) {
            layout.leftMargin = x
            layout.topMargin = y
            layout.width = pixelWidth
            layout.height = pixelHeight
            frame.layoutParams = layout
        }
    }

    @JavascriptInterface
    fun setLocation(latitude: Double, longitude: Double, altitude: Double) = dispatch {
        if (latitude !in -90.0..90.0 || longitude !in -180.0..180.0 || !altitude.isFinite()) return@dispatch
        declination = GeomagneticField(
            latitude.toFloat(), longitude.toFloat(),
            altitude.coerceIn(-500.0, 20000.0).toFloat(), System.currentTimeMillis(),
        ).declination.toDouble()
    }

    @JavascriptInterface
    fun setAltitudeReference(latitude: Double, longitude: Double, altitude: Double, source: String) = dispatch {
        if (barometer.reference(latitude, longitude, altitude, source)) publishAltitude(null)
    }

    @JavascriptInterface
    fun clearLocation() = dispatch {
        declination = null
        barometer.clear()
        publishAltitude(null)
        updatePoseStatus("location")
        publishPose(null)
    }

    private fun dispatch(action: () -> Unit) {
        main.post { if (activity.trustedForeground()) action() }
    }

    fun onResume() {
        foreground = true
        reconcile()
    }

    fun onPause() {
        foreground = false
        stopCapture()
        stopSensors()
        if (isActive) publishStatus(if (cameraEnabled) "starting" else "idle")
    }

    fun onPermissionResult(requestCode: Int, grantResults: IntArray) {
        if (requestCode != REQUEST_CAMERA) return
        permissionPending = false
        permissionDenied = grantResults.firstOrNull() != PackageManager.PERMISSION_GRANTED
        reconcile()
    }

    fun stopPage() {
        isActive = false
        declination = null
        barometer.clear()
        stopCapture()
        stopSensors()
    }

    fun close() {
        stopPage()
        displayManager.unregisterDisplayListener(displayListener)
        (frame.parent as? FrameLayout)?.removeView(frame)
    }

    private fun reconcile() {
        if (!isActive || !foreground || !activity.trustedForeground()) return
        startSensors()
        updatePressureSensor(cameraEnabled)
        if (!cameraEnabled) {
            stopCapture()
            publishStatus("idle")
            return
        }
        if (activity.checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            if (permissionDenied) {
                publishStatus("denied")
            } else if (!permissionPending) {
                permissionPending = true
                publishStatus("starting")
                activity.requestPermissions(arrayOf(Manifest.permission.CAMERA), REQUEST_CAMERA)
            }
            return
        }
        frame.visibility = View.VISIBLE
        if (camera == null && !opening) {
            publishStatus("starting")
            texture.surfaceTexture?.let(::openRearCamera)
        }
    }

    private fun startSensors() {
        if (sensorRegistered) return
        sensorRegistered = rotationVector != null &&
            sensors.registerListener(this, rotationVector, SensorManager.SENSOR_DELAY_GAME, main)
        updatePoseStatus(if (sensorRegistered) "waiting" else "unavailable")
    }

    private fun updatePressureSensor(enabled: Boolean) {
        val sensor = pressureSensor ?: return
        if (pressureRegistered == enabled) return
        if (enabled) {
            pressureRegistered = sensors.registerListener(this, sensor, SensorManager.SENSOR_DELAY_NORMAL, main)
            return
        }
        sensors.unregisterListener(this, sensor)
        pressureRegistered = false
        lastPressureTime = 0
        barometer.resetMeasurements()
        publishAltitude(null)
    }

    private fun stopSensors() {
        updatePressureSensor(false)
        sensors.unregisterListener(this)
        sensorRegistered = false
        poseStatus = "waiting"
        lastPoseTime = 0
    }

    @SuppressLint("MissingPermission")
    private fun openRearCamera(target: SurfaceTexture) {
        if (!isActive || !foreground || !cameraEnabled || opening || camera != null ||
            frame.visibility != View.VISIBLE) return
        try {
            val rear = cameraManager.cameraIdList.firstNotNullOfOrNull { id ->
                val metadata = cameraManager.getCameraCharacteristics(id)
                if (metadata.get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_BACK &&
                    metadata.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP) != null) id to metadata
                else null
            }
            val size = rear?.second?.let(::chooseBuffer)
            if (rear == null || size == null) {
                fail("unavailable")
                return
            }
            characteristics = rear.second
            buffer = size
            target.setDefaultBufferSize(size.width, size.height)
            val output = Surface(target)
            surface = output
            opening = true
            val token = ++generation
            cameraManager.openCamera(rear.first, object : CameraDevice.StateCallback() {
                override fun onOpened(device: CameraDevice) {
                    if (generation != token) {
                        device.close()
                        return
                    }
                    opening = false
                    camera = device
                    configure(device, output, token)
                }
                override fun onDisconnected(device: CameraDevice) = deviceFailed(device, token)
                override fun onError(device: CameraDevice, error: Int) = deviceFailed(device, token)
            }, main)
        } catch (_: SecurityException) {
            fail("denied")
        } catch (_: Exception) {
            fail("error")
        }
    }

    private fun chooseBuffer(metadata: CameraCharacteristics): Size? {
        val sizes = metadata.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
            ?.getOutputSizes(SurfaceTexture::class.java)?.toList().orEmpty()
        val sensor = metadata.get(CameraCharacteristics.SENSOR_INFO_ACTIVE_ARRAY_SIZE)
        val aspect = if (sensor != null) sensor.width().toDouble() / sensor.height() else 4.0 / 3.0
        val bounded = sizes.filter { it.width <= 1920 && it.height <= 1080 }
        return bounded.ifEmpty { sizes }.minWithOrNull(compareBy<Size> {
            abs(ln(it.width.toDouble() / it.height / aspect))
        }.thenByDescending { it.width.toLong() * it.height })
    }

    @Suppress("DEPRECATION")
    private fun configure(device: CameraDevice, output: Surface, token: Int) {
        try {
            device.createCaptureSession(listOf(output), object : CameraCaptureSession.StateCallback() {
                override fun onConfigured(configured: CameraCaptureSession) {
                    if (generation != token) {
                        configured.close()
                        return
                    }
                    session = configured
                    try {
                        val request = device.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW).apply {
                            addTarget(output)
                            set(CaptureRequest.CONTROL_VIDEO_STABILIZATION_MODE, CaptureRequest.CONTROL_VIDEO_STABILIZATION_MODE_OFF)
                            set(CaptureRequest.LENS_OPTICAL_STABILIZATION_MODE, CaptureRequest.LENS_OPTICAL_STABILIZATION_MODE_OFF)
                            if (Build.VERSION.SDK_INT >= 31 && characteristics
                                    ?.get(CameraCharacteristics.SCALER_AVAILABLE_ROTATE_AND_CROP_MODES)
                                    ?.contains(CaptureRequest.SCALER_ROTATE_AND_CROP_NONE) == true) {
                                set(CaptureRequest.SCALER_ROTATE_AND_CROP, CaptureRequest.SCALER_ROTATE_AND_CROP_NONE)
                            }
                            val focusModes = characteristics?.get(CameraCharacteristics.CONTROL_AF_AVAILABLE_MODES)
                            if (focusModes?.contains(CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE) == true) {
                                set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE)
                            }
                        }
                        resizePreview()
                        configured.setRepeatingRequest(request.build(), object : CameraCaptureSession.CaptureCallback() {
                            override fun onCaptureCompleted(
                                session: CameraCaptureSession,
                                request: CaptureRequest,
                                result: TotalCaptureResult,
                            ) {
                                if (generation != token) return
                                val focal = result.get(CaptureResult.LENS_FOCAL_LENGTH)?.toDouble()
                                val crop = result.get(CaptureResult.SCALER_CROP_REGION)
                                if (focal != calibratedFocalLength || crop != captureCrop) {
                                    calibratedFocalLength = focal
                                    captureCrop = crop
                                    resizePreview()
                                }
                            }
                        }, main)
                    } catch (_: Exception) {
                        fail("error")
                    }
                }
                override fun onConfigureFailed(configured: CameraCaptureSession) {
                    configured.close()
                    if (generation == token) fail("error")
                }
            }, main)
        } catch (_: Exception) {
            fail("error")
        }
    }

    private fun deviceFailed(device: CameraDevice, token: Int) {
        if (device !== camera) device.close()
        if (generation == token) fail("error")
    }

    private fun fail(code: String) {
        stopCapture()
        publishStatus(code)
    }

    private fun stopCapture() {
        generation++
        opening = false
        frameReady = false
        session?.close()
        session = null
        camera?.close()
        camera = null
        surface?.release()
        surface = null
        characteristics = null
        calibratedFocalLength = null
        captureCrop = null
        buffer = null
        optics = null
        frame.visibility = View.GONE
    }

    @Suppress("DEPRECATION")
    private fun displayRotation() = texture.display?.rotation ?: activity.windowManager.defaultDisplay.rotation

    private fun resizePreview() {
        rotation = displayRotation()
        val size = buffer ?: return
        val metadata = characteristics ?: return
        val width = texture.width.toDouble()
        val height = texture.height.toDouble()
        if (width <= 0 || height <= 0) return
        val sensorOrientation = metadata.get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 0
        val naturalSwap = sensorOrientation % 180 != 0
        val displaySwap = rotation % 2 != 0
        val flip = naturalSwap != displaySwap
        val imageWidth = if (flip) size.height.toDouble() else size.width.toDouble()
        val imageHeight = if (flip) size.width.toDouble() else size.height.toDouble()
        val scale = max(width / imageWidth, height / imageHeight)
        val naturalWidth = if (naturalSwap) size.height.toDouble() else size.width.toDouble()
        val naturalHeight = if (naturalSwap) size.width.toDouble() else size.height.toDouble()
        val pivotX = (width / 2).toFloat()
        val pivotY = (height / 2).toFloat()
        // The camera producer supplies sensor-to-natural-display orientation. Undo
        // TextureView's stretch, then apply the current display rotation.
        texture.setTransform(Matrix().apply {
            setScale((naturalWidth * scale / width).toFloat(),
                (naturalHeight * scale / height).toFloat(), pivotX, pivotY)
            postRotate(-rotation * 90f, pivotX, pivotY)
        })
        val availableFocal = metadata.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)
        val focal = calibratedFocalLength ?: availableFocal?.singleOrNull()?.toDouble()
        val sensor = metadata.get(CameraCharacteristics.SENSOR_INFO_PHYSICAL_SIZE)
        val pixels = metadata.get(CameraCharacteristics.SENSOR_INFO_PIXEL_ARRAY_SIZE)
        val active = captureCrop ?: metadata.get(CameraCharacteristics.SENSOR_INFO_ACTIVE_ARRAY_SIZE)
        val previousOptics = optics?.toString()
        optics = null
        if (sensor != null && pixels != null && active != null && focal != null && focal > 0) {
            val sensorWidth = sensor.width * active.width().toDouble() / pixels.width
            val sensorHeight = sensor.height * active.height().toDouble() / pixels.height
            val aspect = size.width.toDouble() / size.height
            val cropWidth = min(sensorWidth, sensorHeight * aspect)
            val cropHeight = min(sensorHeight, sensorWidth / aspect)
            val physicalWidth = if (flip) cropHeight else cropWidth
            val physicalHeight = if (flip) cropWidth else cropHeight
            optics = JSONObject()
                .put("horizontalFov", Math.toDegrees(2 * atan(physicalWidth * width / (imageWidth * scale * 2 * focal))))
                .put("verticalFov", Math.toDegrees(2 * atan(physicalHeight * height / (imageHeight * scale * 2 * focal))))
        }
        if (frameReady && previousOptics != optics?.toString()) publishStatus("ready")
    }

    override fun onSurfaceTextureAvailable(target: SurfaceTexture, width: Int, height: Int) {
        openRearCamera(target)
    }
    override fun onSurfaceTextureSizeChanged(target: SurfaceTexture, width: Int, height: Int) {
        resizePreview()
    }
    override fun onSurfaceTextureDestroyed(target: SurfaceTexture): Boolean {
        if (surface != null) {
            stopCapture()
            frame.post { reconcile() }
        }
        return true
    }
    override fun onSurfaceTextureUpdated(target: SurfaceTexture) {
        if (!frameReady && camera != null && session != null && foreground && isActive) {
            frameReady = true
            publishStatus("ready")
        }
    }

    override fun onAccuracyChanged(sensor: Sensor, accuracy: Int) {
        if (sensor.type == Sensor.TYPE_ROTATION_VECTOR && sensorRegistered &&
            accuracy == SensorManager.SENSOR_STATUS_UNRELIABLE) {
            updatePoseStatus("magnetic")
            publishPose(null)
        }
    }

    override fun onSensorChanged(event: SensorEvent) {
        if (!foreground || !isActive) return
        val now = SystemClock.uptimeMillis()
        if (event.sensor.type == Sensor.TYPE_PRESSURE) {
            if (pressureRegistered && now - lastPressureTime >= 500) {
                lastPressureTime = now
                val pressure = event.values.firstOrNull()?.toDouble() ?: return
                barometer.pressure(pressure)?.let(::publishAltitude)
            }
            return
        }
        if (!sensorRegistered || now - lastPoseTime < 50) return
        lastPoseTime = now
        val correction = declination
        if (correction == null) {
            updatePoseStatus("location")
            return
        }
        val headingError = event.values.getOrNull(4)?.toDouble()
        if (event.accuracy == SensorManager.SENSOR_STATUS_UNRELIABLE ||
            (headingError != null && headingError > Math.PI / 6)) {
            updatePoseStatus("magnetic")
            publishPose(null)
            return
        }
        SensorManager.getRotationMatrixFromVector(matrix, event.values)
        // Android's matrix maps device coordinates to east, magnetic north, up.
        // The rear optical axis is -Z. Rotate the screen's +X for the current display.
        val east = -matrix[2].toDouble()
        val north = -matrix[5].toDouble()
        val up = -matrix[8].toDouble()
        val horizontal = hypot(east, north)
        val bearing = if (horizontal > 1e-6) atan2(east, north) else 0.0
        // Inverting the counterclockwise TextureView rotation maps its +X
        // back onto +X, -Y, -X, +Y in natural-device coordinates.
        val axis = displayRotation()
        val column = axis % 2
        val sign = if (axis == 1 || axis == 2) -1 else 1
        val rightEast = sign * matrix[column].toDouble()
        val rightNorth = sign * matrix[3 + column].toDouble()
        val rightUp = sign * matrix[6 + column].toDouble()
        val rollSin = if (horizontal > 1e-6) rightUp / horizontal else -up * rightNorth
        val rollCos = rightEast * kotlin.math.cos(bearing) - rightNorth * kotlin.math.sin(bearing)
        updatePoseStatus("ready")
        publishPose(JSONObject()
            .put("azimuth", (Math.toDegrees(bearing) + correction + 360) % 360)
            .put("altitude", Math.toDegrees(asin(up.coerceIn(-1.0, 1.0))))
            .put("roll", Math.toDegrees(atan2(rollSin, rollCos))))
    }

    private fun updatePoseStatus(value: String) {
        if (poseStatus == value) return
        poseStatus = value
        emit(JSONObject().put("poseStatus", value))
    }

    private fun publishPose(pose: JSONObject?) = emit(JSONObject().put("pose", pose ?: JSONObject.NULL))

    private fun publishAltitude(reading: SkyBarometer.Reading?) = emit(JSONObject()
        .put("altitudeMeters", reading?.altitudeMeters ?: JSONObject.NULL)
        .put("altitudeSource", reading?.source ?: JSONObject.NULL))

    private fun publishStatus(value: String) {
        emit(JSONObject().put("status", value).put("optics", optics ?: JSONObject.NULL)
            .put("poseStatus", poseStatus))
    }

    private fun emit(detail: JSONObject) {
        if (activity.trustedForeground() && isActive) {
            webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('shantu:sky-camera',{detail:$detail}))", null)
        }
    }

    companion object {
        const val JS_NAME = "ShantuSkyCamera"
        private const val REQUEST_CAMERA = 0x5F21
    }
}
