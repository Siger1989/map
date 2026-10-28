package com.shantu.nativeapp.ui

import android.content.Context
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.EditText
import com.shantu.nativeapp.layout.NativeLayoutDraft
import com.shantu.nativeapp.layout.NativeLayoutEntry
import org.json.JSONObject
import kotlin.math.roundToInt

/** Functional layout editor: edits are applied live, drag occurs on the selected home control. */
class NativeLayoutEditor(
    private val context:Context,
    private val chrome:HomeChrome,
    private val initial:NativeLayoutDraft=NativeLayoutDraft(),
    private val onSave:(JSONObject)->Boolean={ json->chrome.onLayoutSave?.invoke(json) ?: false },
    private val onImportRequest:(()->Unit)?=null,
    private val onExportRequest:((JSONObject)->Unit)?=null,
    private val onUnknownSelectors:((List<String>)->Unit)?=null,
) {
    private var draft=initial
    private val undo=ArrayDeque<NativeLayoutDraft>()
    private var selected:String?=null
    private val importText=EditText(context)
    init {
        chrome.onLayoutDraftChanged={ draft=it }
        chrome.onLayoutDragStarted={ undo.addLast(it); while(undo.size>100) undo.removeFirst() }
    }
    private fun edit(change:(NativeLayoutDraft)->NativeLayoutDraft) {
        undo.addLast(draft); while(undo.size>100) undo.removeFirst()
        draft=change(draft); chrome.setLayoutDraft(draft); show()
    }
    fun importDraft(raw:String) {
        val parsed=NativeLayoutDraft.parse(raw)
        edit { parsed }
    }

    /** Cancel previews and restore the saved draft; safe for Back/menu teardown. */
    fun cancel() {
        chrome.setLayoutDraft(initial)
        detach()
    }

    fun dispose() = cancel()

    private fun finishSaved() = detach()

    private fun detach() {
        chrome.setLayoutEditing(false,null)
        chrome.onLayoutDraftChanged=null
        chrome.onLayoutDragStarted=null
    }
    fun show() {
        chrome.setLayoutDraft(draft); chrome.setLayoutEditing(true,selected)
        val controls=chrome.availableLayoutControls()
        val available=controls.map { it.first }.toSet()
        val known=controls.map { (selector,label)->draft.entry(selector)?:NativeLayoutEntry(selector,label) }
        val unknown=draft.entries.filter { it.selector !in available }.map { it.selector }
        (onUnknownSelectors ?: chrome.onUnknownLayoutSelectors)?.invoke(unknown)
        chrome.showPanel("layout-editor","布局自定义",topAligned=false,width=300,onClose={ cancel(); chrome.closePanel() }) {
            val row=LinearLayout(context).apply { orientation=LinearLayout.HORIZONTAL }
            row.addView(chrome.row("撤销") { if(undo.isNotEmpty()) { draft=undo.removeLast(); chrome.setLayoutDraft(draft); show() } },LinearLayout.LayoutParams(0,chrome.dp(32),1f))
            row.addView(chrome.row("取消") { cancel(); chrome.closePanel() },LinearLayout.LayoutParams(0,chrome.dp(32),1f))
            row.addView(chrome.row("保存") { if(onSave(draft.toJson())) { finishSaved(); chrome.closePanel() } },LinearLayout.LayoutParams(0,chrome.dp(32),1f))
            addView(row)
            addView(chrome.text("选择控件后可在地图上拖动；变更会即时预览。锁定与布局恢复入口不可隐藏。未知选择器会报告并保留在导出文件。",10))
            known.forEach { e ->
                val title=if(selected==e.selector) "● ${e.label}" else e.label
                addView(chrome.row(title) { selected=e.selector; chrome.setLayoutEditing(true,selected); show() })
                if(selected==e.selector) {
                    val actions=LinearLayout(context).apply { orientation=LinearLayout.HORIZONTAL }
                    actions.addView(chrome.row("缩小") { edit { d -> d.replace((d.entry(e.selector)?:e).copy(scale=((d.entry(e.selector)?:e).scale-.1).coerceAtLeast(.4))) } },LinearLayout.LayoutParams(0,chrome.dp(30),1f))
                    actions.addView(chrome.row("放大") { edit { d -> d.replace((d.entry(e.selector)?:e).copy(scale=((d.entry(e.selector)?:e).scale+.1).coerceAtMost(2.5))) } },LinearLayout.LayoutParams(0,chrome.dp(30),1f))
                    actions.addView(chrome.row(if(e.hidden) "显示" else "隐藏") { edit { d -> val now=d.entry(e.selector)?:e; d.replace(now.copy(hidden=!now.hidden)) } },LinearLayout.LayoutParams(0,chrome.dp(30),1f))
                    actions.addView(chrome.row("恢复控件") { edit { it.remove(e.selector) } },LinearLayout.LayoutParams(0,chrome.dp(30),1f))
                    addView(actions)
                    val dimensions=LinearLayout(context).apply { orientation=LinearLayout.HORIZONTAL }
                    fun dimensionField(hint:String,value:Double?)=EditText(context).apply { this.hint=hint; textSize=10f; setSingleLine(); value?.let { setText(it.toInt().toString()) } }
                    val width=dimensionField("宽度",e.width); val height=dimensionField("高度",e.height); val font=dimensionField("字号",e.fontSize); val z=dimensionField("层级",e.zIndex?.toDouble())
                    listOf(width,height,font,z).forEach { dimensions.addView(it,LinearLayout.LayoutParams(0,chrome.dp(38),1f)) }
                    addView(dimensions)
                    val anchorJson=EditText(context).apply { hint="锚点 JSON（reference/x/y/gapX/gapY），留空不使用"; textSize=10f; isSingleLine=true; e.anchor?.let { setText(JSONObject().put("reference",it.reference).put("x",it.x).put("y",it.y).put("gapX",it.gapX).put("gapY",it.gapY).toString()) } }
                    addView(anchorJson,LinearLayout.LayoutParams(-1,chrome.dp(38)))
                    addView(chrome.row("应用尺寸/文字/层级/锚点") {
                        runCatching {
                            fun value(field:EditText)=field.text.toString().takeIf { it.isNotBlank() }?.toDouble()
                            val anchor=anchorJson.text.toString().takeIf { it.isNotBlank() }?.let { a->val o=JSONObject(a); com.shantu.nativeapp.layout.NativeLayoutAnchor(NativeLayoutDraft.migrateSelector(o.getString("reference")),o.getString("x"),o.getString("y"),o.getDouble("gapX"),o.getDouble("gapY")) }
                            val updated=(draft.entry(e.selector)?:e).copy(width=value(width),height=value(height),fontSize=value(font),zIndex=value(z)?.roundToInt(),anchor=anchor)
                            val parsed=NativeLayoutDraft.parse(draft.replace(updated).toJson().toString())
                            edit { parsed }
                        }.onFailure { chrome.status.text=it.message?:"布局参数无效" }
                    })
                }
            }
            if(unknown.isNotEmpty()) addView(chrome.text("未识别选择器：${unknown.joinToString()}",10).apply { setTextColor(ShantuColors.muted) })
            importText.hint="粘贴布局 JSON 后导入"; importText.textSize=11f; importText.minLines=2; importText.maxLines=4
            addView(importText,LinearLayout.LayoutParams(-1,chrome.dp(72)))
            val io=LinearLayout(context).apply { orientation=LinearLayout.HORIZONTAL }
            io.addView(chrome.row("导入文本") { runCatching { importDraft(importText.text.toString()) }.onFailure { chrome.status.text=it.message?:"布局导入失败" } },LinearLayout.LayoutParams(0,chrome.dp(32),1f))
            io.addView(chrome.row("选择导入文件") { (onImportRequest ?: chrome.onLayoutImportRequest)?.invoke() ?: run { chrome.status.text="宿主未接入文件导入" } },LinearLayout.LayoutParams(0,chrome.dp(32),1f))
            io.addView(chrome.row("导出") { (onExportRequest ?: chrome.onLayoutExportRequest)?.invoke(draft.toJson()) ?: run { chrome.status.text="宿主未接入文件导出" } },LinearLayout.LayoutParams(0,chrome.dp(32),1f))
            addView(io)
        }
    }

}
