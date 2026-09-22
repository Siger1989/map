package com.guanyun.weather;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.location.*;
import android.os.*;

/** Explicit foreground recording survives WebView pause; no silent boot restart. */
public final class RecordingService extends Service implements LocationListener {
    private LocationManager manager;
    private PowerManager.WakeLock cpuLock;
    private void renewCpuLock() {
        if(cpuLock!=null) { if(cpuLock.isHeld()) cpuLock.release(); cpuLock.acquire(10*60*1000L); }
    }
    private final Handler scheduler = new Handler(Looper.getMainLooper());
    private long lastMotion;
    private long requestedInterval = -1;
    private Location motionAnchor;
    private final Runnable refreshPolicy = new Runnable() {
        @Override public void run() {
            try { renewCpuLock(); configureRequests(); }
            catch (Exception e) { RecordingStore.error(RecordingService.this, "定位请求调整失败，请暂停后重试"); }
            scheduler.postDelayed(this, 10000);
        }
    };
    private static final String CHANNEL = "trip-recording";
    @Override public void onCreate() {
        super.onCreate();
        manager = (LocationManager)getSystemService(LOCATION_SERVICE);
        cpuLock=((PowerManager)getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"Shantu:Recording");
        cpuLock.setReferenceCounted(false);
        lastMotion = SystemClock.elapsedRealtime();
        ((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(new NotificationChannel(CHANNEL,"轨迹记录",NotificationManager.IMPORTANCE_LOW));
    }
    private void configureRequests() throws Exception {
        org.json.JSONObject policy = SamplingPreferences.read(this);
        long interval = SamplingPolicy.requestInterval(policy.getInt("intervalSeconds"),
            policy.getBoolean("adaptive"), SystemClock.elapsedRealtime() - lastMotion);
        if (requestedInterval == interval) return;
        manager.removeUpdates(this);
        requestedInterval = -1;
        boolean provider = false;
        for (String name : new String[]{LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER}) {
            // Distance acceptance belongs to RecordingStore. Receive stationary fixes to detect motion again.
            if (manager.isProviderEnabled(name)) { manager.requestLocationUpdates(name, interval, 0, this); provider = true; }
        }
        if (!provider) throw new Exception("系统定位已关闭，请开启后继续");
        requestedInterval = interval;
    }
    private void observeMotion(Location p) throws Exception {
        long now = System.currentTimeMillis();
        if (!p.hasAccuracy() || !Float.isFinite(p.getAccuracy()) || p.getAccuracy() < 0 ||
            p.getAccuracy() > RecordingPreferences.accuracy(this) || p.getTime() > now + 5000 || now - p.getTime() > 20000 ||
            !Double.isFinite(p.getLatitude()) || !Double.isFinite(p.getLongitude()) ||
            Math.abs(p.getLatitude()) > 85 || Math.abs(p.getLongitude()) > 180) return;
        if (motionAnchor == null) { motionAnchor = new Location(p); lastMotion = SystemClock.elapsedRealtime(); return; }
        double seconds = (p.getTime() - motionAnchor.getTime()) / 1000.0;
        float distance = motionAnchor.distanceTo(p);
        if (seconds <= 0 || distance / seconds > 80) return;
        if (distance >= Math.max(10, motionAnchor.getAccuracy() + p.getAccuracy())) {
            motionAnchor = new Location(p); lastMotion = SystemClock.elapsedRealtime(); configureRequests();
        }
    }
    private Notification notification() {
        PendingIntent open = PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent pause = PendingIntent.getService(this,1,new Intent(this,RecordingService.class).setAction("pause"),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Builder(this,CHANNEL).setSmallIcon(android.R.drawable.ic_menu_mylocation).setContentTitle("山兔正在记录轨迹").setContentText("锁屏后继续记录 · 点击返回地图").setOngoing(true).setContentIntent(open).addAction(new Notification.Action.Builder(null,"暂停",pause).build()).build();
    }
    @Override public int onStartCommand(Intent intent,int flags,int id) {
        String action = intent == null ? "recover" : intent.getAction();
        try {
            if ("pause".equals(action) || "finish".equals(action)) { RecordingStore.command(this,action); stopSelf(); return START_NOT_STICKY; }
            if (Build.VERSION.SDK_INT >= 29) startForeground(51,notification(),ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION); else startForeground(51,notification());
            if ("recover".equals(action)) { if(!RecordingStore.recover(this)) { stopSelf(); return START_NOT_STICKY; } }
            else RecordingStore.command(this,action);
            renewCpuLock();
            lastMotion = SystemClock.elapsedRealtime(); motionAnchor = null; requestedInterval = -1;
            configureRequests();
            scheduler.removeCallbacks(refreshPolicy);
            scheduler.postDelayed(refreshPolicy, 10000);
        } catch (Exception e) {
            try { RecordingStore.command(this,"pause"); } catch (Exception ignored) { }
            RecordingStore.error(this,e instanceof SecurityException?"需要精确定位权限，请授权后继续":e.getMessage()); stopSelf();
        }
        return START_STICKY;
    }
    @Override public void onLocationChanged(Location p) {
        try { observeMotion(p); RecordingStore.add(this,p); if (!RecordingStore.isRecording(this)) stopSelf(); }
        catch (Exception e) { try { RecordingStore.command(this,"pause"); } catch(Exception ignored) { } RecordingStore.error(this,"记录写入失败，已暂停"); stopSelf(); }
    }
    @Override public void onProviderDisabled(String provider) { requestedInterval = -1; RecordingStore.error(this,"定位信号不可用；恢复后将自动继续"); }
    @Override public void onProviderEnabled(String provider) { requestedInterval = -1; }
    @Override public void onStatusChanged(String provider,int status,Bundle extras) { }
    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public void onDestroy() {
        scheduler.removeCallbacks(refreshPolicy);
        if (manager != null) manager.removeUpdates(this);
        if(cpuLock!=null && cpuLock.isHeld()) cpuLock.release();
        // Explicit pause/finish already persist their state; process recreation may recover an active session.
        stopForeground(STOP_FOREGROUND_REMOVE); super.onDestroy();
    }
}
