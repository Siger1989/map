package com.guanyun.weather;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.location.*;
import android.os.*;

/** Explicit foreground recording survives WebView pause; no silent boot restart. */
public final class RecordingService extends Service implements LocationListener {
    private LocationManager manager;
    private static final String CHANNEL = "trip-recording";
    @Override public void onCreate() {
        super.onCreate();
        manager = (LocationManager)getSystemService(LOCATION_SERVICE);
        ((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(new NotificationChannel(CHANNEL,"轨迹记录",NotificationManager.IMPORTANCE_LOW));
    }
    private Notification notification() {
        PendingIntent open = PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent pause = PendingIntent.getService(this,1,new Intent(this,RecordingService.class).setAction("pause"),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Builder(this,CHANNEL).setSmallIcon(android.R.drawable.ic_menu_mylocation).setContentTitle("观云正在记录轨迹").setContentText("锁屏后继续记录 · 点击返回地图").setOngoing(true).setContentIntent(open).addAction(new Notification.Action.Builder(null,"暂停",pause).build()).build();
    }
    @Override public int onStartCommand(Intent intent,int flags,int id) {
        String action = intent == null ? "pause" : intent.getAction();
        try {
            if ("pause".equals(action) || "finish".equals(action)) { RecordingStore.command(this,action); stopSelf(); return START_NOT_STICKY; }
            if (Build.VERSION.SDK_INT >= 29) startForeground(51,notification(),ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION); else startForeground(51,notification());
            RecordingStore.command(this,action);
            manager.removeUpdates(this);
            boolean provider = false;
            for (String name : new String[]{LocationManager.GPS_PROVIDER,LocationManager.NETWORK_PROVIDER}) {
                if (manager.isProviderEnabled(name)) { manager.requestLocationUpdates(name,4000,5,this); provider=true; }
            }
            if (!provider) throw new Exception("系统定位已关闭，请开启后继续");
        } catch (Exception e) {
            try { RecordingStore.command(this,"pause"); } catch (Exception ignored) { }
            RecordingStore.error(this,e instanceof SecurityException?"需要精确定位权限，请授权后继续":e.getMessage()); stopSelf();
        }
        return START_NOT_STICKY;
    }
    @Override public void onLocationChanged(Location p) {
        try { RecordingStore.add(this,p); if (!new org.json.JSONObject(RecordingStore.snapshot(this)).optString("phase").equals("recording")) stopSelf(); }
        catch (Exception e) { RecordingStore.error(this,"记录写入失败，已暂停"); stopSelf(); }
    }
    @Override public void onProviderDisabled(String provider) { RecordingStore.error(this,"定位信号不可用；恢复后将自动继续"); }
    @Override public void onProviderEnabled(String provider) { }
    @Override public void onStatusChanged(String provider,int status,Bundle extras) { }
    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public void onDestroy() {
        if (manager != null) manager.removeUpdates(this);
        try { if (new org.json.JSONObject(RecordingStore.snapshot(this)).optString("phase").equals("recording")) RecordingStore.command(this,"pause"); } catch (Exception ignored) { }
        stopForeground(STOP_FOREGROUND_REMOVE); super.onDestroy();
    }
}
