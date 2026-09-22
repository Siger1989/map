package com.guanyun.weather;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.os.*;
import java.io.*;
import org.json.*;

/** User-started dataSync service; tiles are committed before progress checkpoints. */
public final class OfflineDownloadService extends Service {
    static volatile boolean running;
    private volatile boolean stop;
    private Thread worker;
    private PowerManager.WakeLock cpu;
    private static final String CHANNEL="offline-maps";
    @Override public void onCreate(){super.onCreate();((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(new NotificationChannel(CHANNEL,"离线地图下载",NotificationManager.IMPORTANCE_LOW));}
    private Notification notification(String text,int done,int total){
        PendingIntent open=PendingIntent.getActivity(this,30,new Intent(this,MainActivity.class),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent pause=PendingIntent.getService(this,31,new Intent(this,OfflineDownloadService.class).setAction("pause"),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Builder(this,CHANNEL).setSmallIcon(android.R.drawable.stat_sys_download).setContentTitle("山兔 · 缓存地图").setContentText(text).setOngoing(true).setOnlyAlertOnce(true).setContentIntent(open).setProgress(Math.max(1,total),done,total==0).addAction(new Notification.Action.Builder(null,"暂停",pause).build()).build();
    }
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        if(intent!=null && "pause".equals(intent.getAction())){stop=true;OfflineStore.status(this,"paused","下载已暂停，可继续");stopSelf();return START_NOT_STICKY;}
        if(worker!=null)return START_STICKY;
        try{
            running=true;stop=false;
            if(Build.VERSION.SDK_INT>=29)startForeground(52,notification("准备缓存…",0,0),ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);else startForeground(52,notification("准备缓存…",0,0));
            cpu=((PowerManager)getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"Shantu:MapDownload");cpu.setReferenceCounted(false);cpu.acquire(10*60*1000L);
            worker=new Thread(this::download,"shantu-map-cache");worker.start();
        }catch(Exception e){running=false;OfflineStore.status(this,"paused","后台服务未能启动，请返回应用继续下载");stopSelf();}
        return START_STICKY;
    }
    private void download(){
        try{
            JSONObject task=OfflineStore.read(OfflineStore.job(this,OfflineStore.activeId(this)));JSONArray urls=task.getJSONArray("urls");
            int total=urls.length(),done=0;long bytes=0,updated=0;
            // Verify durable files first, preserving their counts throughout resume.
            boolean[] cached=new boolean[total];for(int i=0;i<total;i++){File f=OfflineStore.tile(this,urls.getString(i));cached[i]=f.isFile()&&f.length()>0;if(cached[i]){done++;bytes+=f.length();}}
            task.put("done",done).put("bytes",bytes).put("total",total).put("state","running").put("error","");OfflineStore.save(this,task);
            for(int i=0;i<total && !stop;i++){
                if(cached[i])continue;
                int retries=0;
                while(!stop){
                    try{
                        byte[] data=OfflineStore.download(this,urls.getString(i));if(stop)break;
                        if(bytes+data.length>1024L*1024*1024)throw new IOException("离线包达到1 GB上限");
                        OfflineStore.write(OfflineStore.tile(this,urls.getString(i)),data);done++;bytes+=data.length;task.put("state","running").put("error","");break;
                    }catch(Exception e){
                        String message=e.getMessage()==null?"连接中断":e.getMessage();
                        if(message.contains("401")||message.contains("403")||message.contains("429")||message.contains("授权")||message.contains("1 GB")||message.contains("space"))throw e;
                        retries++;task.put("state","waiting").put("error","等待网络恢复，已下载内容保留");OfflineStore.save(this,task);
                        ((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).notify(52,notification("等待网络恢复 · "+done+"/"+total,done,total));
                        for(int wait=0;wait<Math.min(60,5*retries)&&!stop;wait++)Thread.sleep(1000);
                        if(retries>=10)throw new IOException("资源持续不可用，已暂停；稍后继续补齐");
                    }
                }
                task.put("done",done).put("bytes",bytes);OfflineStore.save(this,task);
                long now=System.currentTimeMillis();if(now-updated>1000){updated=now;((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).notify(52,notification(done+"/"+total+" 项 · "+(done*100/Math.max(1,total))+"%",done,total));if(cpu!=null)cpu.acquire(10*60*1000L);}
                if(!stop)Thread.sleep(350);
            }
            task.put("state",done==total?"complete":"paused");OfflineStore.save(this,task);
        }catch(Exception e){OfflineStore.status(this,"paused",e instanceof InterruptedException?"下载已暂停，可继续":"下载暂停："+(e.getMessage()==null?"连接或存储异常":e.getMessage()));}
        finally{running=false;stopSelf();}
    }
    @Override public void onTimeout(int id,int type){stop=true;OfflineStore.status(this,"paused","系统后台时限已到，请返回应用继续");stopSelf();}
    @Override public IBinder onBind(Intent intent){return null;}
    @Override public void onDestroy(){stop=true;if(worker!=null)worker.interrupt();if(cpu!=null&&cpu.isHeld())cpu.release();if(worker==null)running=false;stopForeground(STOP_FOREGROUND_REMOVE);super.onDestroy();}
}
