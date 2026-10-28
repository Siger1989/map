package com.shantu.nativeapp.ui

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.widget.LinearLayout
import com.shantu.nativeapp.data.NativeTaskMigration
import com.shantu.nativeapp.data.WorkspaceStore
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.util.concurrent.Executors

/** SAF-driven preview and explicit confirmation for a paused-task migration JSON. */
class NativeTaskMigrationPanel(
    private val context: Context,
    private val store: WorkspaceStore,
    private val chrome: HomeChrome,
    private val onRequestMigrationFile: () -> Unit,
    private val onDismiss: () -> Unit = {},
) {
    private val worker = Executors.newSingleThreadExecutor()
    private val handler = Handler(Looper.getMainLooper())
    private var closed = false
    private var message = ""
    private var pending: ByteArray? = null
    private var preview = ""
    private var opening: InputStream? = null

    init { show() }

    private fun show() {
        if (closed) return
        chrome.showPanel("task-migration", "迁移暂停任务", topAligned = true, width = 300, onClose = { dispose(); chrome.closePanel() }) {
            addView(chrome.text("从旧版明确导出的迁移 JSON 可恢复未保存画线和暂停记录。导入会保存为新轨迹；同 ID 自动复制，本地记录不会被覆盖。", 11))
            addView(chrome.row("选择暂停任务迁移 JSON") { onRequestMigrationFile() })
            if (preview.isNotBlank()) {
                addView(chrome.text(preview, 11))
                addView(LinearLayout(context).apply {
                    orientation = LinearLayout.HORIZONTAL
                    addView(chrome.row("确认导入并保存") { confirm() }, LinearLayout.LayoutParams(0, chrome.dp(28), 1f))
                    addView(chrome.row("取消") { pending = null; preview = ""; show() }, LinearLayout.LayoutParams(0, chrome.dp(28), 1f))
                })
            }
            if (message.isNotBlank()) addView(chrome.text(message, 11))
        }
    }

    /** Called by the host SAF result after the user explicitly selects a migration JSON. */
    fun receiveMigration(input: InputStream) {
        opening = input
        worker.execute {
            val result = runCatching {
                val bytes = input.use { source -> ByteArrayOutputStream().use { out ->
                    val buffer = ByteArray(16 * 1024); var total = 0
                    while (true) { val n = source.read(buffer); if (n < 0) break; total += n; require(total <= NativeTaskMigration.MAX_BYTES) { "迁移文件超过8MiB" }; out.write(buffer, 0, n) }
                    out.toByteArray()
                } }
                val migration = NativeTaskMigration.parse(String(bytes, Charsets.UTF_8))
                val items = migration.toTracks()
                val description = items.joinToString("\n") { item ->
                    val count = (0 until item.getJSONArray("segments").length()).sumOf { item.getJSONArray("segments").getJSONArray(it).length() }
                    "${item.optString("name")} · $count 个点 · ${if (item.optString("source") == "recorded") "暂停记录" else "画线草稿"}"
                } + if (migration.fileReferences.length() > 0) "\n需重新选择的文件：\n" + (0 until migration.fileReferences.length()).joinToString("\n") { i ->
                    val ref = migration.fileReferences.getJSONObject(i)
                    "${ref.optString("displayName")} · ${ref.optString("purpose")}"
                } else ""
                bytes to description
            }
            opening = null
            handler.post { if (!closed) result.fold({ (bytes, text) -> pending = bytes; preview = text; message = "请核对后确认；确认前不会写入。" }, { pending = null; preview = ""; message = it.message ?: "迁移文件无效" }); show() }
        }
    }

    private fun confirm() {
        val bytes = pending ?: return
        pending = null
        worker.execute {
            val result = runCatching { store.importTaskMigration(ByteArrayInputStream(bytes)) }
            handler.post { if (!closed) { message = result.fold({ imported -> "已保存${imported.tracks.size}条任务轨迹；${imported.fileReferences.size}项文件引用需重新选择。" }, { it.message ?: "迁入失败；本机工作区未更改。" }); preview = ""; show() } }
        }
    }

    fun dispose() { if (closed) return; closed = true; pending = null; runCatching { opening?.close() }; opening = null; handler.removeCallbacksAndMessages(null); worker.shutdownNow(); onDismiss() }
}
