package com.shantu.nativeapp.ui

import android.app.AlertDialog
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.text.InputType
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.widget.ArrayAdapter
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import com.shantu.nativeapp.photos.NativePhotoDraft
import com.shantu.nativeapp.photos.NativePhotoImporter
import com.shantu.nativeapp.photos.NativePhotoMatching
import com.shantu.nativeapp.photos.NativePhotoTrack
import com.shantu.nativeapp.photos.forAnnotation
import com.shantu.nativeapp.photos.manualPhotoTime
import org.json.JSONArray
import org.json.JSONObject
import java.util.Base64

/** Native photo library. Host owns SAF/camera selection and persists callback payloads with WorkspaceStore. */
class NativePhotoPanel(
    private val context: Context,
    private val chrome: HomeChrome,
    private val onPickPhoto: () -> Unit,
    private val onSavePhoto: (JSONObject, (Boolean)->Unit) -> Unit,
    private val onUpdatePhoto: (JSONObject, (Boolean)->Unit) -> Unit,
    private val onDeletePhoto: (String) -> Unit,
    private val onTakePhoto: (() -> Unit)? = null,
    private val onSharePhoto: ((JSONObject) -> Unit)? = null,
) {
    private var tracks: List<NativePhotoTrack> = emptyList()
    private var annotations: List<JSONObject> = emptyList()
    private var photos: List<JSONObject> = emptyList()
    private var draft: NativePhotoDraft? = null
    private var manualTimeText = ""
    private var targetTrack = ""
    private var targetAnnotation = ""
    private var saving = false
    private var disposed = false

    fun setTracks(value: List<NativePhotoTrack>) { tracks = value.toList(); render() }
    fun setAnnotations(value: List<JSONObject>) { annotations = value.map { JSONObject(it.toString()) }; render() }
    fun setPhotos(value: List<JSONObject>) { photos = value.map { JSONObject(it.toString()) }; render() }
    fun acceptDraft(value: NativePhotoDraft) { draft = value; manualTimeText = ""; render() }
    fun show() { if (!disposed) render(force = true) }
    fun showPhoto(id:String){photos.firstOrNull{it.optString("id")==id}?.let(::openPhoto)}
    fun close() { if (chrome.currentPanel() == PANEL_ID) chrome.closePanel() }
    fun dispose() { disposed = true; draft = null; close() }

    private fun saveDraftPhoto(value:JSONObject,source:NativePhotoDraft) {
        if(saving)return
        saving=true
        onSavePhoto(value) { success ->
            saving=false
            if(success && draft===source){draft=null;manualTimeText=""}
            if(!disposed)render()
        }
    }

    private fun render(force: Boolean = false) {
        if (disposed || (!force && chrome.currentPanel() != PANEL_ID)) return
        val selectedTrack = tracks.firstOrNull { it.id == targetTrack } ?: tracks.firstOrNull()
        if (selectedTrack != null) targetTrack = selectedTrack.id
        chrome.showPanel(PANEL_ID, "照片", topAligned = true, width = 320) {
            addView(chrome.row("导入照片") { onPickPhoto() }, LinearLayout.LayoutParams(-1, chrome.dp(32)))
            onTakePhoto?.let { take -> addView(chrome.row("拍摄照片") { take() },LinearLayout.LayoutParams(-1,chrome.dp(32))) }
            addView(chrome.text("每张原片最大20MB；原图不改写，照片与轨迹/标记关联单独保存。", 10), LinearLayout.LayoutParams(-1, chrome.dp(30)))
            if (draft != null) {
                val current = draft!!
                addView(chrome.text("待导入：${current.name}", 11), LinearLayout.LayoutParams(-1, chrome.dp(25)))
                val img = ImageView(context).apply {
                    setImageBitmap(decodeThumbnail(current.previewJpeg))
                    scaleType = ImageView.ScaleType.FIT_CENTER
                }
                addView(img, LinearLayout.LayoutParams(-1, chrome.dp(110)))
                val time = current.time ?: manualPhotoTime(manualTimeText)
                addView(chrome.text(if (current.time != null) "EXIF拍摄时间 · ${current.zoneLabel}" else if (time != null) "人工确认时间" else "没有有效EXIF时间；填写时间后才能匹配" , 10), LinearLayout.LayoutParams(-1, chrome.dp(25)))
                if (current.time == null) {
                    val input = EditText(context).apply {
                        hint = "yyyy-MM-dd HH:mm:ss（本机时区）"
                        setSingleLine(true); inputType = InputType.TYPE_CLASS_DATETIME
                        setText(manualTimeText)
                        addTextChangedListener(SimpleTextWatcher { manualTimeText = it })
                    }
                    addView(input, LinearLayout.LayoutParams(-1, chrome.dp(38)))
                }
                if (tracks.isNotEmpty()) {
                    val labels = tracks.map { it.name.ifBlank { it.id } }
                    val spinner = Spinner(context).apply {
                        adapter = ArrayAdapter(context, android.R.layout.simple_spinner_dropdown_item, labels)
                        setSelection(tracks.indexOfFirst { it.id == targetTrack }.coerceAtLeast(0))
                        onItemSelectedListener = SimpleSpinnerListener { index ->
                            val next = tracks.getOrNull(index)?.id.orEmpty()
                            if (next != targetTrack) { targetTrack = next; render() }
                        }
                    }
                    addView(spinner, LinearLayout.LayoutParams(-1, chrome.dp(36)))
                }
                val match = selectedTrack?.let { NativePhotoMatching.match(it, time) }
                addView(chrome.text(match?.let { if (it.kind == "point") "匹配到记录点" else "按同一记录段的前后点插值" } ?: "未匹配：检查时间、断点或速度限制", 10), LinearLayout.LayoutParams(-1, chrome.dp(25)))
                val actions = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
                actions.addView(chrome.row("保存照片") {
                    val photo = draft ?: return@row
                    val chosenTime = photo.time ?: manualPhotoTime(manualTimeText)
                    if (chosenTime == null) { android.widget.Toast.makeText(context, "请填写有效拍摄时间；不会使用文件修改时间代替", android.widget.Toast.LENGTH_SHORT).show(); return@row }
                    val track = tracks.firstOrNull { it.id == targetTrack } ?: return@row
                    val found = NativePhotoMatching.match(track, chosenTime) ?: run { android.widget.Toast.makeText(context, "当前时间没有唯一匹配轨迹点；请检查轨迹断点、时间和速度", android.widget.Toast.LENGTH_SHORT).show(); return@row }
                    val altitude = photo.altitudeMetres?.let { it to "exif" } ?: found.altitude?.let { it to found.altitudeSource }
                    val json = NativePhotoImporter.toWorkspacePhoto(photo, chosenTime ?: return@row, doubleArrayOf(found.coordinate.lon, found.coordinate.lat), track.id, track.name, found.kind, altitude?.first, altitude?.second)
                    if (photo.time == null) json.put("timeSourceDetail", "manual")
                    saveDraftPhoto(json,photo)
                }, LinearLayout.LayoutParams(0, chrome.dp(30), 1f))
                actions.addView(chrome.row("取消") { draft = null; render() }, LinearLayout.LayoutParams(0, chrome.dp(30), 1f))
                addView(actions, LinearLayout.LayoutParams(-1, chrome.dp(32)))
                if (annotations.isNotEmpty()) {
                    val markerLabels = annotations.map { it.optString("name").ifBlank { it.optString("id") } }
                    val markerSpinner = Spinner(context).apply {
                        adapter = ArrayAdapter(context, android.R.layout.simple_spinner_dropdown_item, markerLabels)
                        val markerIndex = annotations.indexOfFirst { it.optString("id") == targetAnnotation }.let { if (it >= 0) it else 0 }
                        targetAnnotation = annotations[markerIndex].optString("id")
                        setSelection(markerIndex)
                        onItemSelectedListener = SimpleSpinnerListener { index ->
                            val next = annotations.getOrNull(index)?.optString("id").orEmpty()
                            if (next != targetAnnotation) { targetAnnotation = next; render() }
                        }
                    }
                    addView(markerSpinner, LinearLayout.LayoutParams(-1, chrome.dp(34)))
                    addView(chrome.row("附加到标记") {
                        val photo = draft ?: return@row
                        val marker = annotations.firstOrNull { it.optString("id") == targetAnnotation } ?: return@row
                        val coords = marker.optJSONArray("coordinates") ?: return@row
                        val captureTime = photo.time ?: manualPhotoTime(manualTimeText)
                        val entity = runCatching {
                            photo.forAnnotation(marker.optString("id"), marker.optString("name"), doubleArrayOf(coords.optDouble(0, Double.NaN), coords.optDouble(1, Double.NaN)), captureTime)
                        }.getOrElse { android.widget.Toast.makeText(context, it.message ?: "照片时间或标记无效", android.widget.Toast.LENGTH_SHORT).show(); return@row }
                        saveDraftPhoto(entity,photo)
                    }, LinearLayout.LayoutParams(-1, chrome.dp(30)))
                }
            }
            addView(chrome.text("已存照片 · ${photos.size}张", 11), LinearLayout.LayoutParams(-1, chrome.dp(28)))
            val list = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
            photos.sortedByDescending { it.optLong("time") }.forEach { photo ->
                val row = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
                val bytes = decodeImage(photo, "previewBase64")
                val thumb = ImageView(context).apply {
                    if (bytes != null) setImageBitmap(decodeThumbnail(bytes))
                    scaleType = ImageView.ScaleType.CENTER_CROP
                }
                row.addView(thumb, LinearLayout.LayoutParams(chrome.dp(48), chrome.dp(42)))
                row.addView(chrome.row("${photo.optString("title", photo.optString("name"))}\n${photo.optString("trackName")}") { openPhoto(photo) }, LinearLayout.LayoutParams(0, chrome.dp(44), 1f))
                row.addView(chrome.row("查看") { openPhoto(photo) }, LinearLayout.LayoutParams(chrome.dp(50), chrome.dp(36)))
                list.addView(row, LinearLayout.LayoutParams(-1, chrome.dp(46)))
            }
            val scroll = ScrollView(context).apply { isFillViewport = false; addView(list) }
            addView(scroll, LinearLayout.LayoutParams(-1, chrome.dp(210)))
            if (photos.isEmpty()) addView(chrome.text("还没有已存照片。选择照片后可按时间匹配轨迹。", 10), LinearLayout.LayoutParams(-1, chrome.dp(28)))
        }
    }

    private fun openPhoto(photo: JSONObject) {
        val working = JSONObject(photo.toString())
        val imageBytes = decodeImage(working, "detailBase64") ?: decodeImage(working, "previewBase64") ?: return
        val bitmap = BitmapFactory.decodeByteArray(imageBytes, 0, imageBytes.size) ?: return
        val title = EditText(context).apply { hint = "照片标题"; setText(working.optString("title", "")); filters = arrayOf(android.text.InputFilter.LengthFilter(100)) }
        val note = EditText(context).apply { hint = "备注"; setText(working.optString("note", "")); minLines = 2; maxLines = 4; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE; filters = arrayOf(android.text.InputFilter.LengthFilter(1000)) }
        val ink = PhotoInkView(context, bitmap, working.optJSONArray("strokes") ?: JSONArray())
        var rotation = working.optInt("rotation", 0)
        ink.setRotationDegrees(rotation)
        val body = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; setPadding(16, 8, 16, 0) }
        body.addView(ink, LinearLayout.LayoutParams(-1, chrome.dp(300)))
        body.addView(chrome.row("旋转 90°（原图保持不变）") { rotation = (rotation + 90) % 360; ink.setRotationDegrees(rotation) }, LinearLayout.LayoutParams(-1, chrome.dp(34)))
        onSharePhoto?.let { share -> body.addView(chrome.row("分享编辑后的照片") {
            share(JSONObject(working.toString()).put("rotation",rotation).put("strokes",ink.toJson()))
        },LinearLayout.LayoutParams(-1,chrome.dp(32))) }
        val inkActions=LinearLayout(context)
        inkActions.addView(chrome.row("浏览 / 涂鸦") { ink.toggleDrawing() },LinearLayout.LayoutParams(0,chrome.dp(30),1f))
        inkActions.addView(chrome.row("撤销") { ink.undo() },LinearLayout.LayoutParams(0,chrome.dp(30),1f))
        inkActions.addView(chrome.row("清空") { ink.clear() },LinearLayout.LayoutParams(0,chrome.dp(30),1f))
        body.addView(inkActions)
        val colors = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
        listOf("#ff625c", "#ffda63", "#ffffff").forEach { color ->
            colors.addView(chrome.row("●") { ink.setColor(color) }.apply { setTextColor(Color.parseColor(color)) }, LinearLayout.LayoutParams(0, chrome.dp(30), 1f))
        }
        body.addView(colors, LinearLayout.LayoutParams(-1, chrome.dp(30)))
        body.addView(title, LinearLayout.LayoutParams(-1, chrome.dp(48)))
        body.addView(note, LinearLayout.LayoutParams(-1, chrome.dp(80)))
        body.addView(chrome.text("触摸照片可涂鸦；保存时只存编辑参数，不覆盖原始图像。", 10), LinearLayout.LayoutParams(-1, chrome.dp(28)))
        val dialog = AlertDialog.Builder(context).setTitle(photo.optString("title", photo.optString("name")))
            .setView(ScrollView(context).apply { addView(body) })
            .setNegativeButton("关闭", null)
            .setNeutralButton("删除", null)
            .setPositiveButton("保存", null).create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener {
                AlertDialog.Builder(context).setMessage("确定删除这张照片吗？")
                    .setNegativeButton("取消", null).setPositiveButton("删除") { _, _ -> onDeletePhoto(photo.optString("id")); dialog.dismiss() }.show()
            }
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                working.put("title", title.text.toString().take(100)).put("note", note.text.toString().take(1000)).put("rotation", rotation).put("strokes", ink.toJson())
                val saveButton=dialog.getButton(AlertDialog.BUTTON_POSITIVE);saveButton.isEnabled=false
                onUpdatePhoto(working) {success->
                    if(dialog.isShowing){saveButton.isEnabled=true;if(success)dialog.dismiss()}
                }
            }
        }
        dialog.setOnDismissListener { bitmap.recycle() }
        dialog.show()
    }

    private fun decodeImage(photo: JSONObject, key: String): ByteArray? {
        val encoded = photo.optString(key).takeIf { it.isNotBlank() } ?: return null
        return runCatching { Base64.getDecoder().decode(encoded) }.getOrNull()
    }

    private fun decodeThumbnail(bytes: ByteArray): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        var sample = 1
        while (maxOf(bounds.outWidth / sample, bounds.outHeight / sample) > 192) sample *= 2
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
    }

    private class PhotoInkView(context: Context, private val bitmap: Bitmap, private val saved: JSONArray) : View(context) {
        private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(255, 218, 99); strokeWidth = 5f; style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND }
        private val current = mutableListOf<Pair<Float, Float>>()
        private val strokes = mutableListOf<Pair<String, JSONArray>>()
        private var color = "#ffda63"
        private var rotation = 0
        private var drawing=false
        private var zoom=1f
        private var panX=0f
        private var panY=0f
        private var lastX=0f
        private var lastY=0f
        private val imageMatrix=android.graphics.Matrix()
        private val inverse=android.graphics.Matrix()
        private val scaleGesture=android.view.ScaleGestureDetector(context,object:android.view.ScaleGestureDetector.SimpleOnScaleGestureListener(){
            override fun onScale(detector:android.view.ScaleGestureDetector):Boolean {
                if(!drawing) { zoom=(zoom*detector.scaleFactor).coerceIn(1f,6f);invalidate() };return true
            }
        })
        init { for (i in 0 until saved.length()) saved.optJSONObject(i)?.let { val value = it.optString("color", "#ffda63").takeIf { c -> c in setOf("#ff625c", "#ffda63", "#ffffff") } ?: "#ffda63"; strokes += value to JSONArray(it.optJSONArray("points")?.toString() ?: "[]") } }
        fun setColor(value: String) { if (value in setOf("#ff625c", "#ffda63", "#ffffff")) { color = value; paint.color = Color.parseColor(value) } }
        fun setRotationDegrees(value: Int) { rotation = value;panX=0f;panY=0f;invalidate() }
        fun toggleDrawing() { drawing=!drawing;current.clear();android.widget.Toast.makeText(context,if(drawing)"涂鸦模式" else "浏览模式：双指缩放，单指拖动",android.widget.Toast.LENGTH_SHORT).show();invalidate() }
        fun undo() { if(strokes.isNotEmpty())strokes.removeAt(strokes.lastIndex);invalidate() }
        fun clear() { strokes.clear();current.clear();invalidate() }
        override fun onDraw(canvas: Canvas) {
            super.onDraw(canvas)
            val rotated = rotation == 90 || rotation == 270
            val rotatedWidth = if (rotated) bitmap.height else bitmap.width
            val rotatedHeight = if (rotated) bitmap.width else bitmap.height
            val scale = minOf(width.toFloat() / rotatedWidth, height.toFloat() / rotatedHeight)*zoom
            panX=panX.coerceIn(-width*(zoom-1)/2,width*(zoom-1)/2)
            panY=panY.coerceIn(-height*(zoom-1)/2,height*(zoom-1)/2)
            imageMatrix.reset()
            imageMatrix.postTranslate(-bitmap.width/2f,-bitmap.height/2f)
            imageMatrix.postRotate(rotation.toFloat());imageMatrix.postScale(scale,scale)
            imageMatrix.postTranslate(width/2f+panX,height/2f+panY)
            imageMatrix.invert(inverse)
            canvas.save()
            canvas.concat(imageMatrix)
            canvas.drawBitmap(bitmap,0f,0f,null)
            val all=toJson()
            if(current.isNotEmpty()) all.put(JSONObject().put("color",color).put("points",JSONArray().apply { current.forEach { put(JSONArray().put(it.first).put(it.second)) } }))
            com.shantu.nativeapp.photos.NativePhotoExport.drawStrokes(canvas,all,bitmap.width.toFloat(),bitmap.height.toFloat())
            canvas.restore()
        }
        override fun onTouchEvent(event: MotionEvent): Boolean {
            parent?.requestDisallowInterceptTouchEvent(event.actionMasked!=MotionEvent.ACTION_UP&&event.actionMasked!=MotionEvent.ACTION_CANCEL)
            scaleGesture.onTouchEvent(event)
            fun point():Pair<Float,Float> {
                val p=floatArrayOf(event.x,event.y);inverse.mapPoints(p)
                return (p[0]/bitmap.width).coerceIn(0f,1f) to (p[1]/bitmap.height).coerceIn(0f,1f)
            }
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> { current.clear();if(drawing&&strokes.size<80)current+=point();lastX=event.x;lastY=event.y;invalidate();return true }
                MotionEvent.ACTION_POINTER_DOWN -> current.clear()
                MotionEvent.ACTION_MOVE -> {
                    if(drawing&&event.pointerCount==1&&current.isNotEmpty()&&current.size<400)current+=point()
                    else if(!drawing&&!scaleGesture.isInProgress&&event.pointerCount==1) { panX+=event.x-lastX;panY+=event.y-lastY }
                    lastX=event.x;lastY=event.y;invalidate();return true
                }
                MotionEvent.ACTION_UP -> { if (current.isNotEmpty() && strokes.size < 80) strokes += color to JSONArray().apply { current.forEach { put(JSONArray().put(it.first).put(it.second)) } }; current.clear(); invalidate(); performClick(); return true }
                MotionEvent.ACTION_CANCEL -> { current.clear();invalidate() }
            }
            return true
        }
        override fun performClick(): Boolean { super.performClick(); return true }
        fun toJson() = JSONArray().apply { strokes.forEach { (strokeColor, points) -> put(JSONObject().put("color", strokeColor).put("points", points)) } }
    }

    companion object { const val PANEL_ID = "native-photos" }
}

private class SimpleTextWatcher(private val changed: (String) -> Unit) : android.text.TextWatcher {
    override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
    override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) { changed(s?.toString().orEmpty()) }
    override fun afterTextChanged(s: android.text.Editable?) = Unit
}
private class SimpleSpinnerListener(private val selected: (Int) -> Unit) : android.widget.AdapterView.OnItemSelectedListener {
    override fun onNothingSelected(parent: android.widget.AdapterView<*>?) = Unit
    override fun onItemSelected(parent: android.widget.AdapterView<*>?, view: View?, position: Int, id: Long) { selected(position) }
}
