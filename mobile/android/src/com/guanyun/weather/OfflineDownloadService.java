package com.guanyun.weather;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.os.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import org.json.*;

/** User-started, generation-isolated dataSync worker for imported tile manifests. */
public final class OfflineDownloadService extends Service {
    static volatile boolean running;
    private static final String CHANNEL="offline-maps";
    private static final int NOTIFICATION=52;
    private static final Object LOCK=new Object();
    private static String busyId="";
    private static long generation;
    private static OfflineDownloadService ownerService;
    private volatile Run active;

    private static final class Run {
        final String id; final long generation;
        final AtomicBoolean stop=new AtomicBoolean(false);
        final AtomicLong sequence=new AtomicLong(), lastSaved=new AtomicLong(), lastNotify=new AtomicLong();
        final Set<String> requests=Collections.newSetFromMap(new ConcurrentHashMap<String,Boolean>());
        volatile String state="paused", message="下载已暂停，可继续";
        volatile int latestStartId; volatile boolean done;
        volatile Thread thread; volatile PowerManager.WakeLock wake;
        Run(String id,long generation,int startId){this.id=id;this.generation=generation;this.latestStartId=startId;}
    }
    static boolean reserve(String id){synchronized(OfflineStore.class){synchronized(LOCK){if(running||(!busyId.isEmpty()&&!busyId.equals(id)))return false;busyId=id;running=true;generation++;return true;}}}
    static void releaseReservation(String id){synchronized(OfflineStore.class){synchronized(LOCK){if(id!=null&&id.equals(busyId)&&ownerService==null){busyId="";running=false;}}}}
    static boolean isBusy(String id){synchronized(LOCK){return running&&id!=null&&id.equals(busyId);}}
    private boolean owns(Run r){synchronized(LOCK){return r!=null&&busyId.equals(r.id)&&generation==r.generation&&active==r&&!r.done;}}

    @Override public void onCreate(){super.onCreate();((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(new NotificationChannel(CHANNEL,"离线地图下载",NotificationManager.IMPORTANCE_LOW));}
    private Notification notification(String text,int done,int total){
        PendingIntent open=PendingIntent.getActivity(this,30,new Intent(this,MainActivity.class),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent pause=PendingIntent.getService(this,31,new Intent(this,OfflineDownloadService.class).setAction("pause"),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent cancel=PendingIntent.getService(this,32,new Intent(this,OfflineDownloadService.class).setAction("cancel"),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Builder(this,CHANNEL).setSmallIcon(android.R.drawable.stat_sys_download).setContentTitle("山兔 · 缓存地图").setContentText(text).setOngoing(true).setOnlyAlertOnce(true).setContentIntent(open).setProgress(Math.max(1,total),Math.min(done,Math.max(1,total)),total==0).addAction(new Notification.Action.Builder(null,"暂停",pause).build()).addAction(new Notification.Action.Builder(null,"取消",cancel).build()).build();
    }
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        String action=intent==null?null:intent.getAction();
        if("pause".equals(action)||"cancel".equals(action)){Run r=active;if(r!=null){r.latestStartId=startId;if(owns(r))requestStop(r,"cancel".equals(action)?"cancelled":"paused","cancel".equals(action)?"下载已取消，已完成瓦片保留":"下载已暂停，可继续");}return START_NOT_STICKY;}
        Run existing=active;if(existing!=null){existing.latestStartId=startId;if(owns(existing))return START_STICKY;return START_NOT_STICKY;}
        String id=intent==null?"":intent.getStringExtra("offlineId");
        try{
            if(id==null||id.isEmpty())id=OfflineStore.activeId(this);
            // Enter foreground before loading a potentially large tile manifest.
            JSONObject task=OfflineStore.read(OfflineStore.job(this,id));
            if(!"imported".equals(task.optString("provider")))throw new IOException("仅支持用户导入的图源");
            synchronized(OfflineStore.class){synchronized(LOCK){if(running&&!id.equals(busyId))throw new IOException("已有地图正在下载");if(busyId.isEmpty()){busyId=id;running=true;generation++;} }}
            Run r=new Run(id,generation,startId);active=r;synchronized(LOCK){ownerService=this;}
            if(Build.VERSION.SDK_INT>=29)startForeground(NOTIFICATION,notification("准备缓存…",0,0),ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);else startForeground(NOTIFICATION,notification("准备缓存…",0,0));
            PowerManager pm=(PowerManager)getSystemService(POWER_SERVICE);r.wake=pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"Shantu:MapDownload");r.wake.setReferenceCounted(false);r.wake.acquire(10*60*1000L);
            final Run captured=r;r.thread=new Thread(()->download(captured),"shantu-map-cache-"+r.generation);r.thread.start();
        }catch(Exception e){OfflineStore.status(this,id,"paused","后台服务未能启动，请返回应用后重试");Run failed=active;if(failed!=null&&failed.id.equals(id)&&failed.thread==null){synchronized(LOCK){if(active==failed){active=null;ownerService=null;running=false;busyId="";}}}else releaseReservation(id);stopForeground(STOP_FOREGROUND_REMOVE);stopSelfResult(startId);}
        return START_NOT_STICKY;
    }
    private void requestStop(Run r){requestStop(r,null,null);}
    private void requestStop(Run r,String state,String message){synchronized(r){r.stop.set(true);if(state!=null){r.state=state;r.message=message;}}for(String request:r.requests)MapTileProxy.cancel(request);Thread t=r.thread;if(t!=null)t.interrupt();}
    private void checkpoint(Run r,JSONObject task,boolean force){long now=System.currentTimeMillis(),last=r.lastSaved.get();if(!force&&now-last<500)return;if(!force&&!r.lastSaved.compareAndSet(last,now))return;if(!owns(r))return;try{synchronized(task){OfflineStore.save(this,task);}}catch(Exception ignored){}}
    private void notifyProgress(Run r,String text,int done,int total,boolean force){long now=System.currentTimeMillis(),last=r.lastNotify.get();if(!force&&now-last<1000)return;if(!force&&!r.lastNotify.compareAndSet(last,now))return;if(owns(r))((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).notify(NOTIFICATION,notification(text,done,total));}
    private void download(Run r){ExecutorService pool=null;JSONObject task=null;try{
        task=OfflineStore.readTask(this,r.id);JSONArray urls=task.getJSONArray("urls");int total=urls.length(),done=0;long bytes=0;
        boolean[] cached=new boolean[total];for(int i=0;i<total;i++){if(!owns(r)||r.stop.get())return;File f=OfflineStore.tile(this,urls.getString(i));cached[i]=f.isFile()&&f.length()>0;if(cached[i]){done++;bytes+=f.length();}}
        synchronized(r){if(r.stop.get())return;r.state="running";r.message="下载进行中";}task.put("done",done).put("bytes",bytes).put("total",total).put("state","running").put("error","");checkpoint(r,task,true);
        AtomicInteger cursor=new AtomicInteger();AtomicInteger completed=new AtomicInteger(done);AtomicLong totalBytes=new AtomicLong(bytes);AtomicReference<Throwable> fatal=new AtomicReference<>();final JSONObject currentTask=task;
        pool=Executors.newFixedThreadPool(16);for(int w=0;w<16;w++){pool.submit(()->{for(int index;(index=cursor.getAndIncrement())<total&&!r.stop.get();){if(cached[index])continue;fetchOne(r,urls.optString(index),currentTask,total,completed,totalBytes,fatal);}});}
        pool.shutdown();try{if(!pool.awaitTermination(Long.MAX_VALUE,TimeUnit.DAYS))throw new IOException("worker timeout");}catch(InterruptedException e){Thread.currentThread().interrupt();requestStop(r);pool.shutdownNow();pool.awaitTermination(20,TimeUnit.SECONDS);}
        if(fatal.get()!=null){Throwable e=fatal.get();synchronized(r){if(!"cancelled".equals(r.state)&&!"paused".equals(r.state)){r.state="paused";r.message="下载暂停："+(e.getMessage()==null?"连接或存储异常":e.getMessage());}}}
        if(r.state.equals("running")){if(r.stop.get()){if(r.state.equals("running"))r.state="paused";}else if(completed.get()>=total){r.state="complete";r.message="缓存完成";}}
        synchronized(task){task.put("done",completed.get()).put("bytes",totalBytes.get()).put("state",r.state).put("error",r.message);}checkpoint(r,task,true);
    }catch(Exception e){if(!r.stop.get()){r.state="paused";r.message="下载暂停："+(e.getMessage()==null?"连接或存储异常":e.getMessage());}if(task!=null)try{synchronized(task){task.put("state",r.state).put("error",r.message);}checkpoint(r,task,true);}catch(Exception ignored){}}
    finally{if(pool!=null&&!pool.isTerminated()){pool.shutdownNow();try{pool.awaitTermination(20,TimeUnit.SECONDS);}catch(InterruptedException e){Thread.currentThread().interrupt();}}
        finish(r);
    }}
    private void fetchOne(Run r,String url,JSONObject task,int total,AtomicInteger done,AtomicLong bytes,AtomicReference<Throwable> fatal){int retries=0;while(!r.stop.get()&&fatal.get()==null&&owns(r)){
        String request="offline:"+r.generation+":"+r.sequence.incrementAndGet();r.requests.add(request);if(r.stop.get()){r.requests.remove(request);MapTileProxy.cancel(request);return;}
        try{byte[] data=OfflineStore.download(this,url,request);r.requests.remove(request);if(!owns(r)||r.stop.get())return;boolean wrote=OfflineStore.commit(this,url,data,bytes,()->owns(r)&&!r.stop.get());if(wrote){if(!owns(r)||r.stop.get())return;int n=done.incrementAndGet();synchronized(task){task.put("done",n).put("bytes",bytes.get()).put("state","running").put("error","");}synchronized(r){if(!owns(r)||r.stop.get())return;r.state="running";r.message="下载进行中";}checkpoint(r,task,false);notifyProgress(r,n+"/"+total+" 项 · "+(n*100/Math.max(1,total))+"%",n,total,false);PowerManager.WakeLock wake=r.wake;if(wake!=null&&wake.isHeld())wake.acquire(10*60*1000L);}return;
        }catch(Exception e){r.requests.remove(request);if(r.stop.get())return;int status=e instanceof MapTileProxy.TileException?((MapTileProxy.TileException)e).status:0;if(status==401||status==403||status==429){fatal.compareAndSet(null,new IOException("图源授权或访问频率受限（HTTP "+status+"）"));requestStop(r,"paused","下载暂停：图源授权或访问频率受限");return;}String message=e.getMessage()==null?"连接中断":e.getMessage();if(message.contains("8 GB")||message.contains("存储")){fatal.compareAndSet(null,e);requestStop(r,"paused","下载暂停："+message);return;}
            if(r.stop.get()||!owns(r))return;retries++;synchronized(r){if(r.stop.get())return;r.state="waiting";r.message="等待网络恢复，已下载内容保留";}try{synchronized(task){task.put("state","waiting").put("error",r.message);}}catch(JSONException ignored){}checkpoint(r,task,false);notifyProgress(r,"等待网络恢复",done.get(),total,false);if(retries>=10){fatal.compareAndSet(null,new IOException("资源持续不可用，已暂停；稍后继续补齐"));requestStop(r,"paused","资源持续不可用，已暂停；稍后继续补齐");return;}try{Thread.sleep(Math.min(60,5*retries)*1000L);}catch(InterruptedException interrupted){Thread.currentThread().interrupt();return;}
        }
    }}
    private void finish(Run r){boolean current;synchronized(LOCK){current=active==r&&busyId.equals(r.id)&&generation==r.generation&&!r.done;if(current)r.done=true;}if(current)try{OfflineStore.status(this,r.id,r.state,r.message);}catch(Exception ignored){}if(current)stopForeground(STOP_FOREGROUND_REMOVE);if(r.wake!=null&&r.wake.isHeld())try{r.wake.release();}catch(Exception ignored){}int stopId=r.latestStartId;if(current)synchronized(OfflineStore.class){synchronized(LOCK){if(active==r&&busyId.equals(r.id)&&generation==r.generation){active=null;ownerService=null;busyId="";running=false;}}}stopSelfResult(stopId);}
    @Override public void onTimeout(int id,int type){Run r=active;if(r!=null&&owns(r))requestStop(r,"paused","系统后台时限已到，请返回应用继续");stopForeground(STOP_FOREGROUND_REMOVE);if(r!=null)stopSelfResult(r.latestStartId);}
    @Override public IBinder onBind(Intent intent){return null;}
    @Override public void onDestroy(){Run r=active;if(r!=null&&owns(r)&&!r.stop.get())requestStop(r,"paused","下载已暂停，可继续");stopForeground(STOP_FOREGROUND_REMOVE);super.onDestroy();}
}
