package com.shantu.nativeapp.ui

import android.app.AlertDialog
import android.content.Context
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import android.widget.*
import android.view.ViewGroup
import com.shantu.nativeapp.navigation.*
import com.shantu.nativeapp.offlineRouting.NativeOfflineRouting
import com.shantu.nativeapp.offlineRouting.NativeOfflineRouteProvider
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.Executors

internal fun nativeBreadcrumbFavorite(name:String,line:List<NativeCoordinate>,index:Int):JSONObject {
    require(line.size>=2&&line.all{it.longitude.isFinite()&&it.latitude.isFinite()&&it.longitude in -180.0..180.0&&it.latitude in -85.0..85.0}){"此连续段不足两个有效点"}
    val reversed=line.reversed();var distance=0.0;for(i in 1 until reversed.size)distance+=NativeOfflineRouting.distance(reversed[i-1],reversed[i]);require(distance>=20){"此连续段不足20米"}
    val now=System.currentTimeMillis();val start=NativePlace("此段末端",reversed.first().longitude,reversed.first().latitude);val end=NativePlace("此段起点",reversed.last().longitude,reversed.last().latitude)
    val route=JSONObject().put("mode","pedestrian").put("geometryKind","track").put("coordinates",JSONArray().also{a->reversed.forEach{a.put(it.toJson())}}).put("trackNetwork",JSONArray().put(JSONArray().also{a->reversed.forEach{a.put(it.toJson())}})).put("preferredTrackPath",JSONArray().also{a->reversed.forEach{a.put(it.toJson())}}).put("distance",distance).put("duration",distance/1.111111).put("steps",JSONArray()).put("snapped",JSONArray().put(start.toJson()).put(end.toJson())).put("stops",JSONArray().put(JSONObject().put("name",start.name).put("coordinates",start.toJson())).put(JSONObject().put("name",end.name).put("coordinates",end.toJson()))).put("createdAt",now)
    return JSONObject().put("id","return-${UUID.randomUUID()}").put("name","$name · 第${index+1}段返航").put("savedAt",now).put("start",JSONObject().put("name",start.name).put("coordinates",start.toJson())).put("end",JSONObject().put("name",end.name).put("coordinates",end.toJson())).put("route",route)
}

private fun NativePlace.toJson()=JSONArray().put(longitude).put(latitude)

/** Return workflow. Location, recording, marker persistence, and navigation remain host-owned. */
class NativeReturnHomePanel(
    private val context:Context,
    private val offline:NativeOfflineRouteProvider,
    private val currentGps:()->NativePlace?,
    private val recordingSegments:()->List<List<NativeCoordinate>>,
    private val savedTrackSegments:()->List<Pair<String,List<List<NativeCoordinate>>>>,
    private val savedMarkers:()->List<NativePlace>,
    private val onRemember:(NativeCoordinate,String,String)->Unit,
    private val onNavigate:(JSONObject)->Unit,
    private val onDismiss:()->Unit={},
    private val chrome:HomeChrome?=null,
) {
    private val worker=Executors.newSingleThreadExecutor();private val handler=Handler(Looper.getMainLooper());private var cancel:CancellationSignal?=null;private var closed=false;private var dialog:AlertDialog?=null
    private val message=TextView(context);private val root=LinearLayout(context).apply{orientation=LinearLayout.VERTICAL;setPadding(0,0,0,0);chrome?.let{background=it.surface()}}
    init {root.addView(TextView(context).apply{text="返航";textSize=14f});root.addView(TextView(context).apply{text="只使用真实GPS、当前记录、已保存轨迹或标记。暂停断段分别返航，不跨缺口连线。";textSize=12f});recordingSegments().let{addSegments("当前实走记录",it)};savedTrackSegments().forEach{addSegments(it.first,it.second)};root.addView(TextView(context).apply{text="离线路网目标";textSize=13f});savedMarkers().forEach{target->root.addView(Button(context).apply{text="离线规划到 ${target.name}";setOnClickListener{routeTo(target)}})};root.addView(TextView(context).apply{text="保存当前位置";textSize=13f});val row=LinearLayout(context);listOf("车位" to "parking","营地" to "camp","撤退点" to "gate").forEach{(name,icon)->row.addView(Button(context).apply{text=name;setOnClickListener{val p=currentGps();if(p==null)message.text="需要可靠GPS定位后才能保存当前位置" else onRemember(NativeCoordinate(p.longitude,p.latitude),name,icon)}})};root.addView(row);root.addView(message);styleChrome();if(chrome!=null){chrome.showPanel("tools","返航",topAligned=true,width=300,onClose={dispose()}){addView(root,LinearLayout.LayoutParams(-1,-2))}}else{val scroll=ScrollView(context).apply{addView(root)};dialog=AlertDialog.Builder(context).setTitle("返航").setView(scroll).setNegativeButton("返回"){_,_->dispose()}.create().also{it.setOnDismissListener{dispose()};it.show()}}}
    private fun styleChrome(){val c=chrome?:return;fun visit(v:android.view.View){when(v){is Button->{c.bindThemeText(v,NativeThemeRole.INK);v.textSize=12f;v.minimumHeight=c.dp(28);v.setPadding(c.dp(6),0,c.dp(6),0);v.background=c.surface(4,ShantuColors.raised)};is TextView->{c.bindThemeText(v,NativeThemeRole.INK);if(v.textSize>14*context.resources.displayMetrics.scaledDensity)v.textSize=13f};is ViewGroup->for(i in 0 until v.childCount)visit(v.getChildAt(i))}};visit(root)}
    fun dispose(){if(closed)return;val isCurrent=chrome?.currentPanel()=="tools"&&root.isAttachedToWindow;closed=true;cancel?.cancel();cancel=null;handler.removeCallbacksAndMessages(null);worker.shutdownNow();if(isCurrent)chrome?.closePanel();if(dialog?.isShowing==true)dialog?.dismiss();dialog=null;onDismiss()}
    private fun addSegments(name:String,segments:List<List<NativeCoordinate>>){if(segments.isEmpty())return;root.addView(TextView(context).apply{text="$name（${segments.size}个连续段）"});segments.forEachIndexed{index,line->root.addView(Button(context).apply{text="预览第${index+1}段反向返航 · ${line.size}点";setOnClickListener{runCatching{breadcrumb(name,line,index)}.onSuccess(onNavigate).onFailure{message.text=it.message?:"返航段无效"}}})}}
    private fun breadcrumb(name:String,line:List<NativeCoordinate>,index:Int)=nativeBreadcrumbFavorite(name,line,index)
    private fun routeTo(target:NativePlace){val origin=currentGps();if(origin==null){message.text="请先开启GPS并等待可靠定位";return};cancel?.cancel();val signal=CancellationSignal();cancel=signal;message.text="正在离线路网规划…";worker.execute{val result=runCatching{val route=offline.route(listOf(origin,target),signal)?:error("没有覆盖当前位置和目标的离线路网");val now=System.currentTimeMillis();JSONObject().put("id","return-${UUID.randomUUID()}").put("name","返回${target.name}").put("savedAt",now).put("start",JSONObject().put("name",origin.name).put("coordinates",JSONArray().put(origin.longitude).put(origin.latitude))).put("end",JSONObject().put("name",target.name).put("coordinates",JSONArray().put(target.longitude).put(target.latitude))).put("route",route.toJson())};handler.post{if(cancel===signal){cancel=null;result.onSuccess(onNavigate).onFailure{message.text=if(signal.isCanceled)"操作已取消" else it.message?:"返航规划失败"}}}}}
}
