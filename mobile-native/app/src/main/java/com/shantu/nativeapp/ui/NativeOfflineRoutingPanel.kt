package com.shantu.nativeapp.ui

import android.app.AlertDialog
import android.content.Context
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import android.widget.*
import com.shantu.nativeapp.offlineRouting.*
import java.util.concurrent.Executors

/** Offline road package manager. Platform file selection and map framing are host callbacks. */
class NativeOfflineRoutingPanel(
    private val context:Context,
    private val storage:NativeOfflineRouting,
    private val downloader:NativeOverpassDownloader=NativeOverpassDownloader(),
    private val bounds:()->List<Double>?,
    private val packageName:()->String={"地图区域"},
    private val routingPreference:()->String={"online"},
    private val onRoutingPreference:(String)->Unit={},
    private val onImport:()->Unit,
    private val onExport:(String,ByteArray)->Unit,
    private val onShow:(List<Double>)->Unit,
    private val onDismiss:()->Unit={},
    private val chrome:HomeChrome?=null,
) {
    private val worker=Executors.newSingleThreadExecutor();private val handler=Handler(Looper.getMainLooper());private var cancel:CancellationSignal?=null;private var closed=false;private var dialog:AlertDialog?=null
    private val root=LinearLayout(context).apply{orientation=LinearLayout.VERTICAL;setPadding(0,0,0,0);chrome?.let{background=it.surface()}}
    private val message=TextView(context);private val list=LinearLayout(context).apply{orientation=LinearLayout.VERTICAL}
    init { root.addView(TextView(context).apply{text="离线路网 · 步行";textSize=14f});root.addView(TextView(context).apply{text="仅使用已下载的公开步行道路。单区≤100km²；最多8包，每包≤60,000节点、150,000连接、24MiB。© OpenStreetMap contributors · ODbL 1.0";textSize=12f});root.addView(Button(context).apply{text="路线策略：${modeLabel(routingPreference())}";setOnClickListener{val modes=arrayOf("在线优先","离线优先","仅离线");val keys=arrayOf("online","offlineFirst","offlineOnly");AlertDialog.Builder(context).setTitle("步行路线策略").setItems(modes){_,which->onRoutingPreference(keys[which]);text="路线策略：${modeLabel(keys[which])}"}.show()}});val row=LinearLayout(context);row.addView(Button(context).apply{text="下载当前范围";setOnClickListener{download()}});row.addView(Button(context).apply{text="导入JSON";setOnClickListener{onImport()}});root.addView(row);root.addView(message);root.addView(ScrollView(context).apply{addView(list)});styleChrome();refresh();if(chrome!=null){chrome.showPanel("tools","离线路网",topAligned=true,width=300,onClose={dispose()}){addView(root,LinearLayout.LayoutParams(-1,-2))}}else{dialog=AlertDialog.Builder(context).setTitle("离线路网").setView(root).setNegativeButton("返回"){_,_->dispose()}.create().also{it.setOnDismissListener{dispose()};it.show()}} }
    private fun styleChrome(view:android.view.View=root){val c=chrome?:return;fun visit(v:android.view.View){when(v){is Button->{c.bindThemeText(v,NativeThemeRole.INK);v.textSize=12f;v.minimumHeight=c.dp(28);v.setPadding(c.dp(6),0,c.dp(6),0);v.background=c.surface(4,ShantuColors.raised)};is TextView->{c.bindThemeText(v,NativeThemeRole.INK);if(v.textSize>14*context.resources.displayMetrics.scaledDensity)v.textSize=13f};is ViewGroup->for(i in 0 until v.childCount)visit(v.getChildAt(i))}};visit(view)}
    fun dispose(){if(closed)return;val isCurrent=chrome?.currentPanel()=="tools"&&root.isAttachedToWindow;closed=true;cancel?.cancel();cancel=null;handler.removeCallbacksAndMessages(null);worker.shutdownNow();if(isCurrent)chrome?.closePanel();if(dialog?.isShowing==true)dialog?.dismiss();dialog=null;onDismiss()}
    private fun modeLabel(mode:String)=when(mode){"offlineFirst"->"离线优先";"offlineOnly"->"仅离线";else->"在线优先"}
    private fun download(){val b=bounds();if(b==null||b.size!=4){message.text="无法取得地图范围";return};if(cancel!=null)return;val c=CancellationSignal();cancel=c;message.text="正在从Overpass下载并构建步行路网…";worker.execute{val result=runCatching{val graph=downloader.download(packageName(),b,c);c.throwIfCanceled();storage.save(graph)};handler.post{if(cancel===c){cancel=null;message.text=result.fold({"已保存 ${it.nodes} 节点、${it.edges} 连接"},{if(c.isCanceled)"下载已取消" else it.message?:"路网下载失败"});refresh()}}} }
    fun importJson(bytes:ByteArray){worker.execute{val result=runCatching{storage.import(bytes)};handler.post{if(closed)return@post;message.text=result.fold({"导入完成：${it.name}"},{it.message?:"导入失败"});refresh()}}}
    private fun refresh(){list.removeAllViews();worker.execute{val packages=storage.list();handler.post{if(closed)return@post;packages.forEach{p->val card=LinearLayout(context).apply{orientation=LinearLayout.VERTICAL};card.addView(TextView(context).apply{text="${p.name} · ${p.nodes}节点 / ${p.edges}连接 · ${p.bytes/1048576}MiB"});val row=LinearLayout(context);row.addView(Button(context).apply{text="查看范围";setOnClickListener{onShow(p.bounds)}});row.addView(Button(context).apply{text="导出";setOnClickListener{worker.execute{runCatching{storage.export(p.id)}.onSuccess{bytes->handler.post{if(!closed)onExport("${p.name}.shantu-routing.json",bytes)}}.onFailure{handler.post{if(!closed)message.text=it.message}}}}});row.addView(Button(context).apply{text="校验";setOnClickListener{worker.execute{val r=runCatching{storage.verify(p)};handler.post{if(!closed)message.text=r.fold({"SHA-256与拓扑校验通过"},{it.message?:"校验失败"})}}}});row.addView(Button(context).apply{text="删除";setOnClickListener{AlertDialog.Builder(context).setMessage("删除路网包 ${p.name}？").setNegativeButton("取消",null).setPositiveButton("删除"){_,_->storage.delete(p.id);refresh()}.show()}});card.addView(row);styleChrome(card);list.addView(card,ViewGroup.LayoutParams.MATCH_PARENT,ViewGroup.LayoutParams.WRAP_CONTENT)} }} }
}
