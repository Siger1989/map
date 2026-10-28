package com.shantu.nativeapp.map

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlin.coroutines.coroutineContext

/** Started foreground service. It is not bound to an Activity, so navigation or Activity teardown is harmless. */
internal class NativeCacheDownloadService : Service() {
    private val serviceScope=CoroutineScope(SupervisorJob()+Dispatchers.IO)
    private var transfer: Job?=null
    private lateinit var archive: NativeTileArchive
    private lateinit var networkLease: NativeTileNetworkPool.Lease
    private lateinit var network: BoundedTileNetwork
    private var taskId: String?=null
    private var wakeLock:PowerManager.WakeLock?=null
    @Volatile private var serviceDestroyed=false

    override fun onCreate() {
        super.onCreate()
        archive=NativeTileArchive(filesDir.resolve("native-offline-tiles"))
        networkLease=NativeTileNetworkPool.acquire(applicationContext,{})
        network=networkLease.network
        network.archive=archive
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when(intent?.action) {
            ACTION_PAUSE, ACTION_CANCEL -> {
                if(transfer?.isActive==true) transfer?.cancel()
                else {
                    taskId?.let { id ->
                        archive.list().firstOrNull { it.optString("id")==id }?.let { runCatching { archive.save(it.put("state","paused").put("error","下载已停止，可继续补齐")) } }
                        clearActive(id)
                    }
                    stopForeground(STOP_FOREGROUND_REMOVE); stopSelf(startId)
                }
                return START_NOT_STICKY
            }
            ACTION_START -> {
                val id=intent.getStringExtra(EXTRA_ID) ?: run { stopSelf(startId); return START_NOT_STICKY }
                if(transfer?.isActive==true && taskId!=id) {
                    sources.remove(id)
                    archive.list().firstOrNull { it.optString("id")==id }?.let {
                        runCatching { archive.save(it.put("state","paused").put("error","已有缓存任务正在运行，请稍后继续此包")) }
                    }
                    return START_NOT_STICKY
                }
                taskId=id
                startForeground(NOTIFICATION_ID,notification("正在准备缓存…",true))
                progress="正在准备缓存…"
                if(wakeLock==null) wakeLock=(getSystemService(Context.POWER_SERVICE) as PowerManager)
                    .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"Shantu:offline-cache").apply { setReferenceCounted(false) }
                if(wakeLock?.isHeld!=true) wakeLock?.acquire(10*60*1000L)
                if(transfer?.isActive==true) return START_NOT_STICKY
                val source=sources.remove(id)
                if(source==null) {
                    archive.list().firstOrNull { it.optString("id")==id }?.let {
                        runCatching { archive.save(it.put("state","paused").put("error","后台服务需要重新选择原图源后继续")) }
                    }
                    clearActive(id)
                    stopForeground(STOP_FOREGROUND_REMOVE); stopSelf(startId); return START_NOT_STICKY
                }
                runTransfer(id,source,startId)
            }
            else -> { stopSelf(startId); return START_NOT_STICKY }
        }
        return START_NOT_STICKY
    }

    private fun runTransfer(id:String,source:NativeCacheSource,startId:Int) {
        // ATOMIC start guarantees the coroutine enters its try/finally even if Android destroys
        // the service immediately after dispatching this start command.
        transfer=serviceScope.launch(start=CoroutineStart.ATOMIC) {
            var record:JSONObject?=null
            val completed=AtomicInteger()
            val failed=AtomicInteger()
            val processed=AtomicInteger()
            val failureReason=AtomicReference<String?>()
            var outcome="paused"
            var message="下载已暂停，已完成内容保留，可继续补齐"
            try {
                record=archive.list().firstOrNull { it.optString("id")==id } ?: error("缓存包不存在")
                val tiles=NativeCachePlan.decode(record.getJSONArray("tiles"))
                require(tiles.size<=NativeCachePlan.MAX_REQUESTS)
                val expected=record.getString("fingerprint")
                require(nativeCacheFingerprint(source,tiles)==expected) {
                    "图源配置已变化，旧包保留，请恢复相同图源配置"
                }
                record.put("state","downloading").put("error","")
                archive.save(record)
                val cursor=AtomicInteger()
                val workerCount=if(source.custom==null && source.id in NativeMapController.SOURCE_IDS) 1 else MAX_CUSTOM_WORKERS
                coroutineScope {
                    repeat(workerCount) {
                        launch(Dispatchers.IO) {
                            while(true) {
                                coroutineContext.ensureActive()
                                if(failed.get()>=MAX_FAILURES_TO_PAUSE) break
                                val index=cursor.getAndIncrement()
                                if(index>=tiles.size) break
                                try {
                                    val tile=tiles[index]
                                    val url=source.url(tile)
                                    if(archive.contains(id,url)) completed.incrementAndGet()
                                    else {
                                        val data=network.fetch(url,bulkDownload=true)
                                        coroutineContext.ensureActive()
                                        if(data==null) failed.incrementAndGet()
                                        else { coroutineContext.ensureActive(); archive.write(id,url,data); completed.incrementAndGet() }
                                    }
                                } catch(cancelled:CancellationException) { throw cancelled }
                                catch(error:Exception) {
                                    failureReason.compareAndSet(null,error.message ?: "缓存写入失败")
                                    failed.set(MAX_FAILURES_TO_PAUSE)
                                }
                                val count=processed.incrementAndGet()
                                if(count%16==0 || count==tiles.size || failed.get()>=MAX_FAILURES_TO_PAUSE)
                                    checkpoint(id,record,tiles.size,completed.get(),failed.get())
                            }
                        }
                    }
                }
                if(completed.get()==tiles.size) { outcome="complete"; message="缓存下载完成" }
                else if(failed.get()>=MAX_FAILURES_TO_PAUSE) message=failureReason.get() ?: "图源持续失败或正在冷却，已暂停；稍后可续传"
                else message="下载已暂停，已完成内容保留，可继续补齐"
            } catch(_:CancellationException) {
                outcome="paused"
            } catch(error:Exception) {
                outcome="paused"
                message=error.message?.take(160) ?: "缓存下载暂停；已完成内容保留"
            } finally {
                record?.let {
                    runCatching { it.put("state",outcome).put("error",message).put("completed",completed.get()).put("failed",failed.get()).put("bytes",packageBytes(id)); archive.save(it) }
                }
                if(taskId==id) taskId=null
                transfer=null
                if(wakeLock?.isHeld==true) runCatching { wakeLock?.release() }
                progress=if(outcome=="complete") "缓存下载完成" else message
                if(!serviceDestroyed) {
                    updateNotification(if(outcome=="complete") "缓存下载完成" else "缓存已暂停",false)
                    stopForeground(STOP_FOREGROUND_REMOVE)
                    stopSelf(startId)
                }
                clearActive(id)
            }
        }
    }

    private fun checkpoint(id:String,record:JSONObject,total:Int,completed:Int,failed:Int) {
        synchronized(record) {
            if(wakeLock?.isHeld==true) wakeLock?.acquire(10*60*1000L)
            record.put("completed",completed).put("failed",failed).put("bytes",packageBytes(id)).put("state","downloading")
            archive.save(record)
            progress="已保存 $completed / $total 张 · ${(completed*100/total)}%"
            updateNotification(progress,true)
        }
    }

    private fun packageBytes(id:String):Long=archive.list().firstOrNull { it.optString("id")==id }?.optLong("bytes",0L) ?: 0L
    private fun createChannel() {
        if(Build.VERSION.SDK_INT>=26) getSystemService(NotificationManager::class.java)
            .createNotificationChannel(NotificationChannel(CHANNEL_ID,"离线地图缓存",NotificationManager.IMPORTANCE_LOW))
    }
    private fun notification(text:String,ongoing:Boolean):Notification {
        val pause=PendingIntent.getService(this,41,Intent(this,NativeCacheDownloadService::class.java).setAction(ACTION_PAUSE),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val cancel=PendingIntent.getService(this,42,Intent(this,NativeCacheDownloadService::class.java).setAction(ACTION_CANCEL),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val builder=NotificationCompat.Builder(this,CHANNEL_ID).setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle("山兔离线地图缓存").setContentText(text).setOnlyAlertOnce(true).setOngoing(ongoing)
        if(ongoing) builder.addAction(0,"暂停",pause).addAction(0,"停止",cancel)
        return builder.build()
    }
    private fun updateNotification(text:String,ongoing:Boolean) {
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID,notification(text,ongoing))
    }
    override fun onBind(intent:Intent?):IBinder?=null
    override fun onTimeout(startId:Int,fgsType:Int) {
        transfer?.cancel()
        progress="系统后台时限到达，已暂停；已完成内容保留"
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf(startId)
    }
    override fun onDestroy() {
        serviceDestroyed=true
        transfer?.cancel()
        networkLease.close()
        if(wakeLock?.isHeld==true) runCatching { wakeLock?.release() }
        serviceScope.cancel()
        // Do not race the transfer's structured finally/checkpoint writes with a second, stale
        // manifest update or free the process-wide task slot before that finalization completes.
        // If the process is killed before finally runs, startup repairs "downloading" to paused.
        super.onDestroy()
    }

    companion object {
        private const val ACTION_START="com.shantu.nativeapp.cache.START"
        private const val ACTION_PAUSE="com.shantu.nativeapp.cache.PAUSE"
        private const val ACTION_CANCEL="com.shantu.nativeapp.cache.CANCEL"
        private const val EXTRA_ID="package_id"
        private const val CHANNEL_ID="native_offline_cache"
        private const val NOTIFICATION_ID=4308
        private const val MAX_CUSTOM_WORKERS=16
        private const val MAX_FAILURES_TO_PAUSE=5
        @Volatile internal var activeId:String?=null
            private set
        @Volatile internal var progress=""
            private set
        private val sources=ConcurrentHashMap<String,NativeCacheSource>()
        private val startLock=Any()
        private fun clearActive(id:String) = synchronized(startLock) { if(activeId==id) activeId=null }
        internal fun start(context:Context,id:String,source:NativeCacheSource) = synchronized(startLock) {
            check(activeId==null) { "已有下载正在进行" }
            sources[id]=source
            activeId=id
            val intent=Intent(context,NativeCacheDownloadService::class.java).setAction(ACTION_START).putExtra(EXTRA_ID,id)
            try {
                if(Build.VERSION.SDK_INT>=26) context.startForegroundService(intent) else context.startService(intent)
            } catch(error:Exception) {
                sources.remove(id); activeId=null
                throw error
            }
        }
        internal fun pause(context:Context) {
            context.startService(Intent(context,NativeCacheDownloadService::class.java).setAction(ACTION_PAUSE))
        }
    }
}
