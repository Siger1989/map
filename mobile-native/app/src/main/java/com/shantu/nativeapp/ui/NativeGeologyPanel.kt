package com.shantu.nativeapp.ui

import android.view.Gravity
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.ImageView
import android.graphics.BitmapFactory
import com.shantu.nativeapp.geology.*

/** Compact native geology controls; values and state are supplied by NativeGeologyLayer. */
class NativeGeologyPanel(private val chrome:HomeChrome,private val onSource:(NativeGeologySource)->Unit,private val onRetry:()->Unit,private val onOpacity:(Double)->Unit,private val onSelect:(String)->Unit):LinearLayout(chrome.context){
    private val body=LinearLayout(context).apply{orientation=VERTICAL}
    private val status=chrome.text("地质图已关闭",11)
    private val providerLegend=ImageView(context).apply{adjustViewBounds=true;scaleType=ImageView.ScaleType.FIT_CENTER}
    private var opacity=.85
    init {
        orientation=VERTICAL
        val heading=chrome.text("地质图例",13).apply{setTypeface(null,android.graphics.Typeface.BOLD)}
        addView(heading,LayoutParams(-1,chrome.dp(28)))
        val sources=LinearLayout(context).apply{orientation=HORIZONTAL}
        sources.addView(chrome.row("世界概览"){onSource(NativeGeologySource.WORLD)},LayoutParams(0,chrome.dp(28),1f))
        sources.addView(chrome.row("1∶20万 · 地质云"){onSource(NativeGeologySource.GEO_CLOUD_200K)},LayoutParams(0,chrome.dp(28),1f))
        addView(sources)
        addView(status,LayoutParams(-1,chrome.dp(28)))
        val alpha=chrome.row("图层透明度 85%"){opacity=if(opacity<.98)1.0 else .85;onOpacity(opacity);refreshOpacity()}
        alpha.tag="geology-opacity";addView(alpha)
        addView(chrome.row("重新连接"){onRetry()})
        addView(body,LayoutParams(-1,-2))
        addView(providerLegend,LayoutParams(-1,chrome.dp(96)))
    }
    fun render(state:NativeGeologyState){status.text=state.message.ifBlank{when(state.status){NativeGeologyStatus.OFF->"地质图已关闭";NativeGeologyStatus.LOADING->"正在加载地质图…";NativeGeologyStatus.READY->"已加载真实图层";NativeGeologyStatus.EMPTY->"当前视野没有地质要素";NativeGeologyStatus.AUTHORIZATION->"服务需要有效授权";NativeGeologyStatus.ERROR->"地质服务暂时不可用"}};opacity=state.opacity;refreshOpacity();body.removeAllViews();if(state.attribution.isNotBlank())body.addView(chrome.text("图源：${state.attribution}",10));state.units.take(30).forEach{unit->val row=LinearLayout(context).apply{orientation=HORIZONTAL;gravity=Gravity.CENTER_VERTICAL};val swatch=android.view.View(context).apply{setBackgroundColor(runCatching{android.graphics.Color.parseColor(unit.color)}.getOrDefault(android.graphics.Color.GRAY))};row.addView(swatch,LayoutParams(chrome.dp(12),chrome.dp(12)));val label=chrome.text("${unit.name} · ${unit.age} · ${unit.lithology}",10);label.setOnClickListener{onSelect(unit.key)};row.addView(label,LayoutParams(0,chrome.dp(28),1f));body.addView(row)};state.selected?.let{unit->body.addView(chrome.text("${unit.name} · ${unit.age} · ${unit.lithology}\n${unit.description}\n图源：${unit.source}",10))};if(state.source==NativeGeologySource.GEO_CLOUD_200K)body.addView(chrome.text("地质云 1∶20万为WMTS原图；按其实际覆盖、服务图例及授权使用。",10));val bytes=state.legendImage;providerLegend.setImageBitmap(bytes?.let{BitmapFactory.decodeByteArray(it,0,it.size)});providerLegend.visibility=if(bytes==null)GONE else VISIBLE}
    private fun refreshOpacity(){(findViewWithTag<TextView>("geology-opacity"))?.text="图层透明度 ${(opacity*100).toInt()}%"}
}
