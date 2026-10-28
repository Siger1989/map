package com.shantu.nativeapp.ui

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.widget.LinearLayout
import com.shantu.nativeapp.offlineMaps.*
import java.io.InputStream
import java.util.concurrent.Executors

class NativeOfflineMapsPanel(private val context:Context,private val store:NativeOfflineMapStore,private val legacy:NativeLegacyOfflineArchive,
    private val onRequestMapImport:()->Unit,private val onRequestLegacyArchive:()->Unit,private val onSelect:(NativeOfflineMap)->Unit,
    private val onShow:(List<Double>)->Unit,private val chrome:HomeChrome,private val onDismiss:()->Unit={},private val onRequestGeoreferencedImage:()->Unit={}) {
    private val worker=Executors.newSingleThreadExecutor()
    private val handler=Handler(Looper.getMainLooper())
    private var closed=false
    private var message=""
    private var maps=emptyList<NativeOfflineMap>()
    init{show();refresh()}
    private fun show(){if(closed)return;chrome.showPanel("offline-maps","本地离线地图",topAligned=true,width=300,onClose={dispose();chrome.closePanel()}){
        addView(chrome.text("栅格MBTiles、已配准GeoTIFF与旧版瓦片归档。导入保留源文件。",11))
        addView(chrome.row("导入本地图像 / MBTiles / GeoTIFF"){onRequestMapImport()})
        addView(chrome.row("导入配准图片（图片 + 世界文件 + CRS）"){onRequestGeoreferencedImage()})
        addView(chrome.row("迁入旧版离线缓存归档"){onRequestLegacyArchive()})
        if(message.isNotBlank())addView(chrome.text(message,11))
        maps.forEach{m->addView(chrome.text("${m.name} · ${m.format} · ${m.bytes/1048576}MiB",12))
            addView(LinearLayout(context).apply{orientation=LinearLayout.HORIZONTAL
                addView(chrome.row("显示"){onSelect(m)},LinearLayout.LayoutParams(0,chrome.dp(28),1f))
                addView(chrome.row("查看范围"){m.bounds?.let(onShow)},LinearLayout.LayoutParams(0,chrome.dp(28),1f))
                addView(chrome.row("移除"){android.app.AlertDialog.Builder(context).setMessage("移除 ${m.name}？").setNegativeButton("取消",null).setPositiveButton("移除"){_,_->worker.execute{val r=runCatching{store.delete(m.id)};handler.post{if(!closed){message=r.fold({"已移除本地副本"},{"未移除，文件保留"});refresh()}}}}.show()},LinearLayout.LayoutParams(0,chrome.dp(28),1f))
            })
            if(m.detail.isNotBlank())addView(chrome.text(m.detail,10))
        }
    }}
    private fun refresh(){worker.execute{val result=runCatching{store.list()};handler.post{if(!closed){maps=result.getOrDefault(emptyList());show()}}}}
    fun importMap(name:String,input:InputStream){worker.execute{val r=runCatching{input.use{store.importFile(name,it)}};handler.post{if(!closed){message=r.fold({"已导入 ${it.name}"},{it.message?:"地图未导入"});refresh()}}}}
    fun importLegacy(input:InputStream){worker.execute{val r=runCatching{input.use{legacy.importZip(it)}};handler.post{if(!closed){message=r.fold({"已迁入${it.importedTasks}项任务、${it.importedTiles}张旧瓦片"},{it.message?:"旧版归档未迁入"});show()}}}}
    fun dispose(){if(closed)return;closed=true;handler.removeCallbacksAndMessages(null);worker.shutdownNow();onDismiss()}
}
