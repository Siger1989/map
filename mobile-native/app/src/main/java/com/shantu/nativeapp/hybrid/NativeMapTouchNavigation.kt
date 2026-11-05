package com.shantu.nativeapp.hybrid

import android.view.MotionEvent

/** Transfers an editor-owned stream to the native camera when a second finger arrives. */
internal class NativeMapTouchNavigation(density: Float = 1f, touchSlopPx: Float = 6f) {
    var isNavigating = false
        private set

    private var editorGesture = false
    private var editorPanActive = false
    private var firstPointerId = -1
    private var secondPointerId = -1
    private var downFirstX = 0f
    private var downFirstY = 0f
    private var downSecondX = 0f
    private var downSecondY = 0f
    private var lastFirstX = 0f
    private var lastFirstY = 0f
    private var lastSecondX = 0f
    private var lastSecondY = 0f
    private var panStartDistance = 0f
    private var panStartAngle = 0f
    private val scale = density.takeIf { it.isFinite() && it > 0f } ?: 1f
    private val minSharedTranslation = 2f * scale
    private val maxParallelDivergence = 50f * scale
    private val transformSlop = maxOf(6f * scale, touchSlopPx.takeIf { it.isFinite() && it > 0f } ?: 6f * scale)

    private data class Point(val x: Float, val y: Float)

    private companion object {
        // Only editor-owned two-finger streams are remapped. Browsing retains the SDK's native
        // pan/tilt/rotation recognizers. Small, parallel movement is intercepted before the SDK
        // can interpret a same-direction vertical drag as tilt.
        const val ROTATION_SWITCH_DEGREES = 5f
    }

    fun capture(
        event: MotionEvent,
        editorOwnsPointer: Boolean,
        onEditorNavigation: (Boolean) -> Unit = {},
        dispatchCamera: (MotionEvent) -> Unit,
    ): Boolean {
        if (event.actionMasked == MotionEvent.ACTION_DOWN) {
            isNavigating = false
            resetEditorGesture()
            onEditorNavigation(false)
        }
        val endsEditorGesture = editorGesture &&
            (event.actionMasked == MotionEvent.ACTION_UP || event.actionMasked == MotionEvent.ACTION_CANCEL)
        try {
            if (event.actionMasked == MotionEvent.ACTION_POINTER_DOWN && !isNavigating) {
                isNavigating = true
                if (editorOwnsPointer) {
                    editorGesture = true
                    onEditorNavigation(true)
                    val cancel = MotionEvent.obtain(event).apply { action = MotionEvent.ACTION_CANCEL }
                    try { dispatchCamera(cancel) } finally { cancel.recycle() }
                    // WorldWind did not receive the editor's DOWN. Start its recognizers with
                    // the existing finger before normal dispatch delivers POINTER_DOWN.
                    val index = if (event.actionIndex == 0) 1 else 0
                    val properties = MotionEvent.PointerProperties().also { event.getPointerProperties(index, it) }
                    val coordinates = MotionEvent.PointerCoords().also { event.getPointerCoords(index, it) }
                    val down = MotionEvent.obtain(event.downTime, event.eventTime, MotionEvent.ACTION_DOWN,
                        1, arrayOf(properties), arrayOf(coordinates), event.metaState, event.buttonState,
                        event.xPrecision, event.yPrecision, event.deviceId, event.edgeFlags, event.source, event.flags)
                    try { dispatchCamera(down) } finally { down.recycle() }

                    val secondIndex = event.actionIndex
                    val firstIndex = if (secondIndex == 0) 1 else 0
                    firstPointerId = event.getPointerId(firstIndex)
                    secondPointerId = event.getPointerId(secondIndex)
                    downFirstX = event.getX(firstIndex); downFirstY = event.getY(firstIndex)
                    downSecondX = event.getX(secondIndex); downSecondY = event.getY(secondIndex)
                    lastFirstX = downFirstX; lastFirstY = downFirstY
                    lastSecondX = downSecondX; lastSecondY = downSecondY
                }
            }

            if (editorGesture) {
                when (event.actionMasked) {
                    MotionEvent.ACTION_MOVE -> {
                        val firstIndex = indexOfPointer(event, firstPointerId)
                        val secondIndex = indexOfPointer(event, secondPointerId)
                        if (firstIndex >= 0 && secondIndex >= 0 && event.pointerCount == 2) {
                            val first = Point(event.getX(firstIndex), event.getY(firstIndex))
                            val second = Point(event.getX(secondIndex), event.getY(secondIndex))
                            val previousCenter = center(lastFirstX, lastFirstY, lastSecondX, lastSecondY)
                            val currentCenter = center(first.x, first.y, second.x, second.y)
                            val currentDistance = distance(first, second)
                            val previousFirst = Point(lastFirstX, lastFirstY)
                            val previousSecond = Point(lastSecondX, lastSecondY)
                            val pinchDelta = kotlin.math.abs(currentDistance - distance(previousFirst, previousSecond))
                            val currentAngle = angle(first, second)
                            val angleStep = angleDifference(currentAngle, angle(previousFirst, previousSecond))
                            val translationStep = distance(previousCenter, currentCenter)
                            val rotationTravel = angleStep * (Math.PI / 180.0).toFloat() * currentDistance * 0.5f
                            // Span jitter during a shared translation must not repeatedly cancel and
                            // restart the camera. Change mode only when a real radial/angular step
                            // dominates translation and has accumulated beyond a density-aware slop.
                            val startsPinch = kotlin.math.abs(currentDistance - panStartDistance) >= transformSlop &&
                                pinchDelta * 0.5f > translationStep
                            val startsRotation = angleDifference(currentAngle, panStartAngle) >= ROTATION_SWITCH_DEGREES &&
                                rotationTravel > translationStep
                            if (editorPanActive && (startsPinch || startsRotation)) {
                                // End the synthetic one-pointer pan at its current point, then seed a
                                // fresh native two-pointer stream at the current geometry. The next
                                // original MOVE continues pinching without a camera-origin jump.
                                dispatchSingle(event, MotionEvent.ACTION_CANCEL, previousCenter, firstPointerId, dispatchCamera)
                                dispatchNativePairStart(event, firstIndex, secondIndex, dispatchCamera)
                                editorPanActive = false
                                downFirstX = first.x; downFirstY = first.y
                                downSecondX = second.x; downSecondY = second.y
                                remember(first, second)
                                return false
                            }

                            val stepFirstX = first.x - lastFirstX; val stepFirstY = first.y - lastFirstY
                            val stepSecondX = second.x - lastSecondX; val stepSecondY = second.y - lastSecondY
                            val totalFirstX = first.x - downFirstX; val totalFirstY = first.y - downFirstY
                            val totalSecondX = second.x - downSecondX; val totalSecondY = second.y - downSecondY
                            val anchorFirst = Point(downFirstX, downFirstY)
                            val anchorSecond = Point(downSecondX, downSecondY)
                            val anchorSpanDelta = kotlin.math.abs(currentDistance - distance(anchorFirst, anchorSecond))
                            val anchorAngleDelta = angleDifference(currentAngle, angle(anchorFirst, anchorSecond))
                            val parallelStep = pinchDelta < transformSlop && rotationTravel < translationStep &&
                                pinchDelta * 0.5f < translationStep &&
                                areParallel(stepFirstX, stepFirstY, stepSecondX, stepSecondY)
                            val parallelTotal = anchorSpanDelta < transformSlop && anchorAngleDelta < ROTATION_SWITCH_DEGREES &&
                                areParallel(totalFirstX, totalFirstY, totalSecondX, totalSecondY)

                            if (editorPanActive) {
                                dispatchSingle(event, MotionEvent.ACTION_MOVE, currentCenter, firstPointerId, dispatchCamera)
                                remember(first, second)
                                return true
                            }

                            if (parallelStep || parallelTotal) {
                                // Cancel the SDK's two-pointer recognizers before this MOVE reaches
                                // them. For a slow initial drag retain the real accumulated centroid
                                // movement, rather than losing each sub-threshold input before pan begins.
                                val cancel = MotionEvent.obtain(event).apply { action = MotionEvent.ACTION_CANCEL }
                                try { dispatchCamera(cancel) } finally { cancel.recycle() }
                                val panOrigin = if (parallelTotal) center(downFirstX, downFirstY, downSecondX, downSecondY) else previousCenter
                                dispatchSingle(event, MotionEvent.ACTION_DOWN, panOrigin, firstPointerId, dispatchCamera)
                                dispatchSingle(event, MotionEvent.ACTION_MOVE, currentCenter, firstPointerId, dispatchCamera)
                                editorPanActive = true
                                panStartDistance = currentDistance
                                panStartAngle = currentAngle
                                remember(first, second)
                                return true
                            }
                            // Once native pinch/rotation has moved, later slow translation starts from
                            // this actual pair, not the obsolete pre-pinch gesture origin.
                            if (anchorSpanDelta >= transformSlop || anchorAngleDelta >= ROTATION_SWITCH_DEGREES) {
                                downFirstX = first.x; downFirstY = first.y
                                downSecondX = second.x; downSecondY = second.y
                            }
                            remember(first, second)
                        }
                    }
                    MotionEvent.ACTION_POINTER_UP -> if (editorPanActive && event.pointerCount == 2) {
                        val firstIndex = indexOfPointer(event, firstPointerId)
                        val secondIndex = indexOfPointer(event, secondPointerId)
                        if (firstIndex >= 0 && secondIndex >= 0) {
                            val end = center(event.getX(firstIndex), event.getY(firstIndex), event.getX(secondIndex), event.getY(secondIndex))
                            dispatchSingle(event, MotionEvent.ACTION_UP, end, firstPointerId, dispatchCamera)
                        }
                        editorPanActive = false
                        panStartDistance = 0f
                        return true
                    }
                    MotionEvent.ACTION_UP -> if (editorPanActive) {
                        val index = indexOfPointer(event, firstPointerId).takeIf { it >= 0 } ?: 0
                        dispatchSingle(event, MotionEvent.ACTION_UP, Point(event.getX(index), event.getY(index)), firstPointerId, dispatchCamera)
                        editorPanActive = false
                        panStartDistance = 0f
                        return true
                    }
                    MotionEvent.ACTION_CANCEL -> if (editorPanActive) {
                        val index = indexOfPointer(event, firstPointerId).takeIf { it >= 0 } ?: 0
                        dispatchSingle(event, MotionEvent.ACTION_CANCEL, Point(event.getX(index), event.getY(index)), firstPointerId, dispatchCamera)
                        editorPanActive = false
                        panStartDistance = 0f
                        return true
                    }
                }
            }
            return editorOwnsPointer && !isNavigating && event.pointerCount == 1
        } finally {
            if (endsEditorGesture) {
                resetEditorGesture()
                onEditorNavigation(false)
            }
        }
    }

    private fun resetEditorGesture() {
        editorGesture = false
        editorPanActive = false
        panStartDistance = 0f
        panStartAngle = 0f
        firstPointerId = -1
        secondPointerId = -1
    }

    private fun remember(first: Point, second: Point) {
        lastFirstX = first.x; lastFirstY = first.y
        lastSecondX = second.x; lastSecondY = second.y
    }

    private fun indexOfPointer(event: MotionEvent, pointerId: Int): Int {
        for (index in 0 until event.pointerCount) if (event.getPointerId(index) == pointerId) return index
        return -1
    }

    private fun center(firstX: Float, firstY: Float, secondX: Float, secondY: Float) =
        Point((firstX + secondX) * 0.5f, (firstY + secondY) * 0.5f)

    private fun distance(first: Point, second: Point): Float = magnitude(first.x - second.x, first.y - second.y)

    private fun magnitude(x: Float, y: Float): Float = kotlin.math.sqrt((x * x + y * y).toDouble()).toFloat()

    private fun angle(first: Point, second: Point): Float =
        Math.toDegrees(kotlin.math.atan2((second.y - first.y).toDouble(), (second.x - first.x).toDouble())).toFloat()

    private fun angleDifference(first: Float, second: Float): Float = kotlin.math.abs((first - second + 540f) % 360f - 180f)

    private fun areParallel(firstX: Float, firstY: Float, secondX: Float, secondY: Float): Boolean {
        val firstLength = magnitude(firstX, firstY)
        val secondLength = magnitude(secondX, secondY)
        if (firstLength < minSharedTranslation || secondLength < minSharedTranslation) return false
        val dot = firstX * secondX + firstY * secondY
        if (dot <= 0f) return false
        val divergence = magnitude(firstX - secondX, firstY - secondY)
        if (divergence > maxParallelDivergence) return false
        val cross = kotlin.math.abs(firstX * secondY - firstY * secondX)
        return cross <= firstLength * secondLength * 0.65f
    }

    private fun dispatchSingle(
        source: MotionEvent,
        action: Int,
        point: Point,
        pointerId: Int,
        dispatchCamera: (MotionEvent) -> Unit,
    ) {
        val sourceIndex = indexOfPointer(source, pointerId).takeIf { it >= 0 } ?: 0
        val properties = MotionEvent.PointerProperties().also {
            source.getPointerProperties(sourceIndex, it)
            it.id = pointerId.coerceAtLeast(0)
        }
        val coordinates = MotionEvent.PointerCoords().also {
            source.getPointerCoords(sourceIndex, it)
            it.x = point.x; it.y = point.y
        }
        val synthetic = MotionEvent.obtain(
            source.downTime, source.eventTime, action, 1, arrayOf(properties), arrayOf(coordinates),
            source.metaState, source.buttonState, source.xPrecision, source.yPrecision, source.deviceId,
            source.edgeFlags, source.source, source.flags,
        )
        try { dispatchCamera(synthetic) } finally { synthetic.recycle() }
    }

    private fun dispatchNativePairStart(
        source: MotionEvent,
        firstIndex: Int,
        secondIndex: Int,
        dispatchCamera: (MotionEvent) -> Unit,
    ) {
        dispatchSingle(source, MotionEvent.ACTION_DOWN,
            Point(source.getX(firstIndex), source.getY(firstIndex)), firstPointerId, dispatchCamera)
        val firstProperties = MotionEvent.PointerProperties().also { source.getPointerProperties(firstIndex, it); it.id = firstPointerId }
        val secondProperties = MotionEvent.PointerProperties().also { source.getPointerProperties(secondIndex, it); it.id = secondPointerId }
        val firstCoords = MotionEvent.PointerCoords().also { source.getPointerCoords(firstIndex, it) }
        val secondCoords = MotionEvent.PointerCoords().also { source.getPointerCoords(secondIndex, it) }
        val pointerDown = MotionEvent.obtain(
            source.downTime, source.eventTime,
            MotionEvent.ACTION_POINTER_DOWN or (1 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT),
            2, arrayOf(firstProperties, secondProperties), arrayOf(firstCoords, secondCoords),
            source.metaState, source.buttonState, source.xPrecision, source.yPrecision, source.deviceId,
            source.edgeFlags, source.source, source.flags,
        )
        try { dispatchCamera(pointerDown) } finally { pointerDown.recycle() }
    }
}
