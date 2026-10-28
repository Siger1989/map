package com.shantu.nativeapp.ui

import android.app.AlertDialog
import android.content.Context
import android.graphics.BitmapFactory
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.Toast
import com.shantu.nativeapp.industry.NativeIndustryBundle
import com.shantu.nativeapp.industry.NativeIndustryBundleFile
import com.shantu.nativeapp.industry.NativeIndustryRenderResult
import com.shantu.nativeapp.industry.NativeIndustryRenderer
import org.json.JSONArray
import org.json.JSONObject
import java.util.Base64
import java.util.UUID
import java.util.concurrent.Executors

/** Import review, saved-project list, preview, and export callbacks for industry chart documents. */
class NativeIndustryPanel(
    private val context: Context,
    private val chrome: HomeChrome,
    private val onPickFile: () -> Unit,
    private val onSave: (JSONObject) -> Boolean,
    private val onOpen: (JSONObject) -> Unit,
    private val onDelete: (String) -> Unit,
    private val onExport: (ByteArray, String, String) -> Unit,
    private val onShare: (ByteArray, String, String) -> Unit,
) {
    private val worker = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private var projects: List<JSONObject> = emptyList()
    private var draft: Draft? = null
    private var viewed: JSONObject? = null
    private var failure: Failure? = null
    private var expandedIssues = false
    private var busy = false
    private var disposed = false
    private var status: String? = null
    private var showDetail=false

    private data class Draft(val name: String, val source: ByteArray, val result: NativeIndustryRenderResult)
    private data class Failure(val kind: String, val name: String, val message: String, val issues: JSONArray)

    fun setProjects(value: List<JSONObject>) {
        projects = value.take(MAX_PROJECTS).map { JSONObject(it.toString()) }
        if (value.size > MAX_PROJECTS) status = "项目清单超过 $MAX_PROJECTS 项上限；仅显示前 $MAX_PROJECTS 项。"
        render()
    }

    /** Host calls after parsing succeeds. The source bytes are retained verbatim in the saved project. */
    fun acceptDraft(kind: String, name: String, sourceBytes: ByteArray, result: NativeIndustryRenderResult) {
        require(kind == result.kind && kind in setOf("section", "drill")) { "行业图件类型不匹配" }
        require(sourceBytes.isNotEmpty() && sourceBytes.size <= MAX_SOURCE_BYTES) { "原始工作簿必须为1–20 MiB" }
        draft = Draft(name.take(240).ifBlank { result.title }, sourceBytes.copyOf(), result)
        viewed = null
        currentResult = null
        failure = null
        expandedIssues = true
        status = null
        render()
    }

    fun acceptFailure(kind: String, name: String, message: String, issues: JSONArray = JSONArray()) {
        failure = Failure(kind, name, message, JSONArray(issues.toString()))
        draft = null
        viewed = null
        currentResult = null
        expandedIssues = true
        status = null
        render()
    }

    /** Host calls after re-reading a saved source workbook and regenerating the current normalized view. */
    fun acceptOpened(project: JSONObject, result: NativeIndustryRenderResult) {
        require(project.optString("kind") == result.kind) { "保存项目与图件类型不匹配" }
        viewed = JSONObject(project.toString())
        currentResult = result
        draft = null
        failure = null
        status = null
        render()
    }

    private var currentResult: NativeIndustryRenderResult? = null

    fun show() { if (!disposed) render(force = true) }

    fun dispose() {
        disposed = true
        draft?.source?.fill(0)
        draft = null
        currentResult = null
        worker.shutdownNow()
        close()
    }

    fun close() { if (chrome.currentPanel() == PANEL_ID) chrome.closePanel() }

    private fun render(force: Boolean = false) {
        if (disposed || (!force && chrome.currentPanel() != PANEL_ID)) return
        chrome.showPanel(PANEL_ID, "剖面与钻孔图件", topAligned = true, width = 340) {
            addView(chrome.row("导入 XLSX 工作簿") { onPickFile() }, LinearLayout.LayoutParams(-1, chrome.dp(30)))
            addView(chrome.text("原始工作簿保留在项目记录中；支持规范剖面/钻孔模板1.0及整合钻孔v2/v3。坐标或角度依据不足时不会推算空间孔轨迹。", 10).apply { setTextColor(ShantuColors.muted) }, LinearLayout.LayoutParams(-1, -2))
            status?.let { addView(chrome.text(it, 10).apply { setTextColor(ShantuColors.accent) }, LinearLayout.LayoutParams(-1, -2)) }
            addView(chrome.row("下载模板 / 示例工作簿"){
                val files=listOf("section-template" to "剖面模板","section-example" to "剖面示例","drill-template" to "钻孔模板","drill-example" to "钻孔示例","drill-integrated-template" to "整合钻孔v2模板","drill-integrated-example" to "整合钻孔v2示例","drill-integrated-v3-template" to "整合钻孔v3模板","drill-integrated-v3-example" to "整合钻孔v3示例","drill-integrated-v3-reference-example" to "整合钻孔v3参考示例","drill-integrated-v3-continuous-example" to "整合钻孔v3连续示例")
                AlertDialog.Builder(context).setTitle("模板与示例").setItems(files.map{it.second}.toTypedArray()){_,i->worker.execute{
                    val selected=files[i];val r=runCatching{context.assets.open(selected.first+".xlsx").use{it.readBytes()}}
                    main.post{if(!disposed)r.onSuccess{onExport(it,selected.first+".xlsx","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}.onFailure{Toast.makeText(context,"模板无法读取",Toast.LENGTH_SHORT).show()}}
                }}.setNegativeButton("返回",null).show()
            })
            failure?.let { showFailure(this, it) }
            draft?.let { showReview(this, it) }
            currentResult?.let { result -> showResult(this, result, viewed?.optString("name") ?: result.title) }
            addView(chrome.text("已保存项目 · ${projects.size}/$MAX_PROJECTS", 11).apply { setTextColor(ShantuColors.accent) }, LinearLayout.LayoutParams(-1, chrome.dp(26)))
            if (projects.isEmpty()) addView(chrome.text("尚无剖面或钻孔项目。", 10), LinearLayout.LayoutParams(-1, chrome.dp(30)))
            else projects.forEach { addView(projectRow(it), LinearLayout.LayoutParams(-1, chrome.dp(74))) }
        }
    }

    private fun showFailure(body: LinearLayout, value: Failure) = with(body) {
        addView(chrome.text("未导入：${value.name} · ${kindName(value.kind)}", 12).apply { setTextColor(ShantuColors.close) }, LinearLayout.LayoutParams(-1, chrome.dp(26)))
        addView(chrome.text(value.message, 11).apply { setTextColor(ShantuColors.close) }, LinearLayout.LayoutParams(-1, -2))
        val errors = issueCount(value.issues, "error"); val warnings = issueCount(value.issues, "warning")
        addView(chrome.row("审核问题：$errors 错误 · $warnings 警告 · ${if (expandedIssues) "收起" else "展开"}") { expandedIssues = !expandedIssues; render() }, LinearLayout.LayoutParams(-1, chrome.dp(28)))
        if (expandedIssues) showIssues(this, value.issues)
    }

    private fun showReview(body: LinearLayout, value: Draft) = with(body) {
        addView(chrome.text("待审核：${value.name} · ${kindName(value.result.kind)} · ${(value.source.size / 1024)} KiB 原件", 11), LinearLayout.LayoutParams(-1, chrome.dp(28)))
        showResult(this, value.result, value.name)
        val errors = issueCount(value.result.audit.optJSONArray("issues") ?: JSONArray(), "error")
        val warnings = issueCount(value.result.audit.optJSONArray("issues") ?: JSONArray(), "warning")
        addView(chrome.row("审核问题：$errors 错误 · $warnings 警告 · ${if (expandedIssues) "收起" else "展开"}") { expandedIssues = !expandedIssues; render() }, LinearLayout.LayoutParams(-1, chrome.dp(28)))
        if (expandedIssues) showIssues(this, value.result.audit.optJSONArray("issues") ?: JSONArray())
        val canSave = errors == 0 && projects.size < MAX_PROJECTS && totalSourceBytes(projects) + value.source.size <= MAX_TOTAL_SOURCE_BYTES
        val actions = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
        actions.addView(chrome.row(if (canSave) "保存项目" else "暂不可保存") { if (canSave) save(value) }, LinearLayout.LayoutParams(0, chrome.dp(30), 1f))
        actions.addView(chrome.row("取消") { value.source.fill(0); draft = null; failure = null; status = null; render() }, LinearLayout.LayoutParams(0, chrome.dp(30), 1f).apply { leftMargin = chrome.dp(4) })
        addView(actions, LinearLayout.LayoutParams(-1, chrome.dp(32)))
        if (!canSave) addView(chrome.text(if (errors > 0) "存在错误级问题，不能保存。" else "已达到项目数或原始文件存储上限。", 10).apply { setTextColor(ShantuColors.close) }, LinearLayout.LayoutParams(-1, -2))
    }

    private fun showResult(body: LinearLayout, result: NativeIndustryRenderResult, displayName: String) = with(body) {
        val switch=LinearLayout(context)
        switch.addView(chrome.row(if(showDetail)"切换主图" else "切换详图"){showDetail=!showDetail;render()},LinearLayout.LayoutParams(0,chrome.dp(28),1f))
        switch.addView(chrome.row("放大浏览 / 适宽–800%"){NativeImageViewer.show(context,chrome,displayName,if(showDetail)result.detailPng else result.mainPng)},LinearLayout.LayoutParams(0,chrome.dp(28),1f))
        addView(switch)
        addView(chrome.text("${kindName(result.kind)}主图预览 · ${result.audit.optJSONObject("main")?.optInt("width")} × ${result.audit.optJSONObject("main")?.optInt("height")} px", 10), LinearLayout.LayoutParams(-1, chrome.dp(24)))
        val image = ImageView(context).apply {
            scaleType = ImageView.ScaleType.FIT_CENTER
            contentDescription = "$displayName 主图预览"
            setImageBitmap(decodePreview(if(showDetail)result.detailPng else result.mainPng))
            setOnClickListener{NativeImageViewer.show(context,chrome,displayName,if(showDetail)result.detailPng else result.mainPng)}
            background = chrome.surface(4, ShantuColors.raised)
        }
        addView(image, LinearLayout.LayoutParams(-1, chrome.dp(174)))
        val layout = result.audit.optJSONObject("layout") ?: JSONObject()
        val summary = if (result.kind == "section") "测点 ${result.normalized.optJSONArray("nodes")?.length() ?: 0} · 层段 ${result.normalized.optJSONArray("intervals")?.length() ?: 0} · 样品 ${result.normalized.optJSONArray("samples")?.length() ?: 0} · 图件模式 ${layout.optString("geometry_mode", "未知")}" else "终孔 ${layout.optDouble("endpoint_m").takeIf { it.isFinite() } ?: 0.0} m · 分层 ${result.normalized.optJSONArray("layers")?.length() ?: 0} · 样品 ${result.normalized.optJSONArray("samples")?.length() ?: 0} · 详图 ${layout.optDouble("detail_limit_m").takeIf { it.isFinite() } ?: 0.0} m"
        addView(chrome.text(summary, 10).apply { setTextColor(ShantuColors.muted) }, LinearLayout.LayoutParams(-1, -2))
        if (result.kind == "section") addView(chrome.text("剖面虚线层界为按产状外推的估算线，未定位样品不在图上伪造位置。", 10).apply { setTextColor(ShantuColors.muted) }, LinearLayout.LayoutParams(-1, -2))
        if (busy) addView(chrome.text("正在准备导出包…", 10).apply { setTextColor(ShantuColors.accent) }, LinearLayout.LayoutParams(-1, chrome.dp(22)))
        val buttons = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
        buttons.addView(chrome.row("导出完整图件 ZIP") { makeBundle(result, false) }, LinearLayout.LayoutParams(0, chrome.dp(30), 1f))
        buttons.addView(chrome.row("分享 ZIP") { makeBundle(result, true) }, LinearLayout.LayoutParams(0, chrome.dp(30), 1f).apply { leftMargin = chrome.dp(4) })
        addView(buttons, LinearLayout.LayoutParams(-1, chrome.dp(32)))
    }

    private fun showIssues(body: LinearLayout, issues: JSONArray) {
        if (issues.length() == 0) { body.addView(chrome.text("无审核问题。", 10), LinearLayout.LayoutParams(-1, chrome.dp(24))); return }
        for (i in 0 until issues.length()) {
            val issue = issues.optJSONObject(i) ?: continue
            val cells = issue.optJSONArray("cells")?.let { a -> (0 until a.length()).joinToString(", ") { a.optString(it) } }.orEmpty()
            body.addView(chrome.text("${issue.optString("severity").uppercase()} · ${issue.optString("code")}\n${issue.optString("message")}${if (cells.isBlank()) "" else "\n來源：$cells"}", 10).apply {
                setTextColor(if (issue.optString("severity") == "error") ShantuColors.close else ShantuColors.muted)
                gravity = Gravity.CENTER_VERTICAL or Gravity.START
                setPadding(chrome.dp(4), chrome.dp(3), chrome.dp(4), chrome.dp(3))
            }, LinearLayout.LayoutParams(-1, -2))
        }
    }

    private fun projectRow(project: JSONObject): LinearLayout = LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL
        background = chrome.surface(4, ShantuColors.raised)
        val name = project.optString("name", "未命名行业项目")
        val title = "${kindName(project.optString("kind"))} · $name"
        addView(chrome.text(title, 11).apply { gravity = Gravity.CENTER_VERTICAL or Gravity.START; setPadding(chrome.dp(6), 0, chrome.dp(4), 0) }, LinearLayout.LayoutParams(-1, chrome.dp(25)))
        val actions = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
        actions.addView(chrome.row("重新打开 / 重新审核") { onOpen(JSONObject(project.toString())) }, LinearLayout.LayoutParams(0, chrome.dp(28), 1f))
        actions.addView(chrome.row("删除") { confirmDelete(project) }, LinearLayout.LayoutParams(chrome.dp(58), chrome.dp(28)).apply { leftMargin = chrome.dp(4) })
        addView(actions, LinearLayout.LayoutParams(-1, chrome.dp(32)))
    }

    private fun save(value: Draft) {
        try {
            val existing = mutableSetOf<String>().also { ids -> projects.forEach { ids += it.optString("id") } }
            val id = UUID.randomUUID().toString()
            require(id !in existing) { "项目标识冲突，请重试" }
            val record = JSONObject().put("id", id).put("name", value.name.take(240)).put("kind", value.result.kind)
                .put("sourceBase64", Base64.getEncoder().encodeToString(value.source)).put("createdAt", System.currentTimeMillis())
            if (onSave(record)) {
                currentResult = value.result
                viewed = JSONObject(record.toString())
                draft = null
                status = "项目已保存；原始工作簿字节已保留。"
                value.source.fill(0)
            } else status = "保存未成功；待审核数据仍保留，可重试。"
        } catch (e: Exception) { status = "保存未成功：${e.message ?: "数据校验失败"}" }
        render()
    }

    private fun confirmDelete(project: JSONObject) {
        AlertDialog.Builder(context).setTitle("删除行业项目？")
            .setMessage("将删除“${project.optString("name", "未命名项目")}”。此操作不会删除其他项目。")
            .setNegativeButton("取消", null).setPositiveButton("删除") { _, _ -> onDelete(project.optString("id")) }.show()
    }

    private fun makeBundle(result: NativeIndustryRenderResult, share: Boolean) {
        if (busy || disposed) return
        busy = true; render()
        worker.execute {
            val file = try { NativeIndustryBundle.create(result) } catch (e: Exception) { e }
            main.post {
                if (disposed) return@post
                busy = false
                if (file is NativeIndustryBundleFile) {
                    status = "图件包已生成：${file.name}"
                    if (share) onShare(file.bytes, file.name, file.mime) else onExport(file.bytes, file.name, file.mime)
                } else status = "图件包生成失败：${(file as? Exception)?.message ?: "未知错误"}"
                render()
            }
        }
    }

    private fun decodePreview(bytes: ByteArray): android.graphics.Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 1400) sample *= 2
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample.coerceAtLeast(1) })
    }

    private fun issueCount(issues: JSONArray, severity: String) = (0 until issues.length()).count { issues.optJSONObject(it)?.optString("severity") == severity }
    private fun totalSourceBytes(items: List<JSONObject>): Long = items.sumOf { p -> try { Base64.getDecoder().decode(p.optString("sourceBase64")).size.toLong() } catch (_: Exception) { 0L } }
    private fun kindName(kind: String) = if (kind == "section") "实测剖面" else if (kind == "drill") "钻孔柱状图" else "行业图件"
    companion object {
        private const val PANEL_ID = "industry"
        private const val MAX_PROJECTS = 100
        private const val MAX_SOURCE_BYTES = 20 * 1024 * 1024
        private const val MAX_TOTAL_SOURCE_BYTES = 40L * 1024 * 1024
    }
}
