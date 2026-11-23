package com.guanyun.weather;

import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.*;
import android.os.*;
import java.util.HashMap;
import java.util.Map;

/** Explicit foreground recording survives WebView pause; no silent boot restart. */
public final class RecordingService extends Service implements LocationListener {
    static final String EXPECTED_RECORDING_ID = "recording.expectedId";
    private LocationManager manager;
    private PowerManager.WakeLock cpuLock;
    private long nextCpuLockRenewal;
    private void renewCpuLock() {
        long now = SystemClock.elapsedRealtime();
        if (cpuLock.isHeld() && now < nextCpuLockRenewal) return;
        if (cpuLock.isHeld()) cpuLock.release();
        cpuLock.acquire(10 * 60 * 1000L);
        nextCpuLockRenewal = now + 5 * 60 * 1000L;
    }
    private final Handler scheduler = new Handler(Looper.getMainLooper());
    private final Map<String, Long> providerIntervals = new HashMap<>();
    private static final String[] PROVIDERS = {LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER};
    private long lastMotion;
    private Location motionAnchor;
    private final Runnable refreshPolicy = new Runnable() {
        @Override public void run() {
            try {
                if (!RecordingStore.isRecording(RecordingService.this)) { stopSelf(); return; }
                renewCpuLock();
                configureRequests();
            } catch (SecurityException e) { pauseWithError("需要精确定位权限，请授权后继续"); return; }
            catch (Exception e) { RecordingStore.error(RecordingService.this, "定位请求调整失败，正在重试"); }
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
        if (checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            throw new SecurityException("Precise location permission unavailable");
        }
        org.json.JSONObject policy = SamplingPreferences.read(this);
        long interval = SamplingPolicy.requestInterval(policy.getInt("intervalSeconds"),
            policy.getBoolean("adaptive"), SystemClock.elapsedRealtime() - lastMotion);
        boolean available = false;
        for (String name : PROVIDERS) {
            try {
                if (!manager.isProviderEnabled(name)) continue;
                if (!Long.valueOf(interval).equals(providerIntervals.get(name))) {
                    // Android updates the listener/provider pair without unregistering the other provider.
                    manager.requestLocationUpdates(name, interval, 0, this);
                    providerIntervals.put(name, interval);
                }
                available = true;
            } catch (IllegalArgumentException | SecurityException unavailableProvider) {
                // Retry this provider on the next refresh while the other registration can keep recording.
                available |= providerIntervals.containsKey(name);
            }
        }
        if (!available) RecordingStore.error(this, "定位信号不可用；恢复后将自动继续");
    }
    private boolean observeMotion(Location p) {
        long now = System.currentTimeMillis();
        if (!p.hasAccuracy() || !Float.isFinite(p.getAccuracy()) || p.getAccuracy() < 0 ||
            p.getAccuracy() > RecordingPreferences.accuracy(this) || p.getTime() > now + 5000 || now - p.getTime() > 20000 ||
            !Double.isFinite(p.getLatitude()) || !Double.isFinite(p.getLongitude()) ||
            Math.abs(p.getLatitude()) > 85 || Math.abs(p.getLongitude()) > 180) return false;
        if (motionAnchor == null) { motionAnchor = new Location(p); lastMotion = SystemClock.elapsedRealtime(); return true; }
        double seconds = (p.getTime() - motionAnchor.getTime()) / 1000.0;
        float distance = motionAnchor.distanceTo(p);
        if (seconds <= 0 || distance / seconds > 80) return false;
        if (distance >= Math.max(10, motionAnchor.getAccuracy() + p.getAccuracy())) {
            motionAnchor = new Location(p); lastMotion = SystemClock.elapsedRealtime(); return true;
        }
        return false;
    }
    private void pauseWithError(String message) {
        try { if (RecordingStore.isRecording(this)) RecordingStore.command(this, "pause"); }
        catch (Exception ignored) { }
        RecordingStore.error(this, message);
        stopSelf();
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
            else if (!RecordingStore.startOrResume(this, action, intent.getStringExtra(EXPECTED_RECORDING_ID))) {
                if (RecordingStore.isRecording(this)) return START_STICKY;
                stopSelf();
                return START_NOT_STICKY;
            }
            renewCpuLock();
            lastMotion = SystemClock.elapsedRealtime(); motionAnchor = null;
            scheduler.removeCallbacks(refreshPolicy);
            scheduler.post(refreshPolicy);
        } catch (Exception e) {
            String message = e.getMessage();
            if (e instanceof SecurityException) message = "需要精确定位权限，请授权后继续";
            pauseWithError(message == null ? "记录服务未能启动，请返回应用后重试" : message);
            return START_NOT_STICKY;
        }
        return START_STICKY;
    }
    @Override public void onLocationChanged(Location p) {
        try {
            RecordingStore.add(this,p);
            if (!RecordingStore.isRecording(this)) { stopSelf(); return; }
        } catch (Exception e) { pauseWithError("记录写入失败，已暂停"); return; }
        long stationaryMillis = SystemClock.elapsedRealtime() - lastMotion;
        if (observeMotion(p) && stationaryMillis >= 60000) refreshRequestsSoon();
    }
    private void refreshRequestsSoon() {
        scheduler.removeCallbacks(refreshPolicy);
        scheduler.post(refreshPolicy);
    }
    @Override public void onProviderDisabled(String provider) { refreshRequestsSoon(); }
    @Override public void onProviderEnabled(String provider) { refreshRequestsSoon(); }
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
