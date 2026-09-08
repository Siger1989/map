package com.guanyun.weather;

import android.Manifest;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import org.json.JSONObject;

/** User-started map positioning. Separate from the foreground track recorder. */
final class ForegroundLocation implements LocationListener {
    static final int REQUEST = 4107;
    private final MainActivity activity;
    private final LocationManager manager;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean wanted, permissionPending, registered;
    private String mode = "auto";
    private Location best;
    private volatile String snapshot = "{}";
    private final Runnable timeout = () -> publish("仍未收到位置，请检查系统定位与网络；室内可打开 Wi-Fi 辅助定位");

    ForegroundLocation(MainActivity activity) {
        this.activity = activity;
        manager = (LocationManager) activity.getSystemService(MainActivity.LOCATION_SERVICE);
    }
    String snapshot() { return snapshot; }
    private boolean allowed() {
        return activity.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || activity.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }
    void start(String value) {
        if (!activity.trustedForeground() || !("auto".equals(value) || "network".equals(value))) return;
        pause();
        mode = value;
        wanted = true;
        best = null;
        publish("");
        if (!allowed()) {
            if (!permissionPending) {
                permissionPending = true;
                activity.requestPermissions(new String[] {Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQUEST);
            }
        } else resume();
    }
    void resolvePermission() {
        permissionPending = false;
        if (!wanted) return;
        if (!allowed()) { wanted = false; publish("定位权限未允许，请在系统设置中开启；大致位置也可用于网络定位"); }
        else resume();
    }
    void resume() {
        if (!wanted || permissionPending || registered || !activity.trustedForeground()) return;
        if (!allowed()) { wanted = false; best = null; publish("定位权限已关闭，请重新开启"); return; }
        int count = 0;
        for (String provider : new String[] {LocationManager.NETWORK_PROVIDER, LocationManager.GPS_PROVIDER}) {
            if ("network".equals(mode) && !LocationManager.NETWORK_PROVIDER.equals(provider)) continue;
            if (LocationManager.GPS_PROVIDER.equals(provider)
                && activity.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) continue;
            try {
                if (manager == null || !manager.isProviderEnabled(provider)) continue;
                manager.requestLocationUpdates(provider, 2000, 0, this, Looper.getMainLooper());
                count++;
                Location cached = manager.getLastKnownLocation(provider);
                if (cached != null) onLocationChanged(cached);
            } catch (SecurityException | IllegalArgumentException ignored) { }
        }
        registered = count > 0;
        if (!registered) publish("network".equals(mode)
            ? "系统网络定位不可用，请开启定位与 Wi-Fi 辅助定位，或切回自动定位"
            : "系统定位不可用，请检查位置开关与权限");
        else if (best == null) handler.postDelayed(timeout, 20000);
    }
    void pause() {
        handler.removeCallbacks(timeout);
        if (manager != null) try { manager.removeUpdates(this); } catch (RuntimeException ignored) { }
        registered = false;
    }
    void stop() { wanted = false; pause(); best = null; snapshot = "{}"; }
    @Override public void onLocationChanged(Location value) {
        if (!wanted || !activity.trustedForeground() || !value.hasAccuracy()) return;
        long now = SystemClock.elapsedRealtimeNanos();
        long age = (now - value.getElapsedRealtimeNanos()) / 1000000;
        long previousAge = best == null ? Long.MAX_VALUE : (now - best.getElapsedRealtimeNanos()) / 1000000;
        if (!LocationFixPolicy.accept(age, value.getAccuracy(), previousAge, best == null ? Float.MAX_VALUE : best.getAccuracy())) return;
        if ("network".equals(mode) && !LocationManager.NETWORK_PROVIDER.equals(value.getProvider())) return;
        best = new Location(value);
        handler.removeCallbacks(timeout);
        publish("");
    }
    private void publish(String error) {
        try {
            JSONObject state = new JSONObject().put("mode", mode).put("error", error);
            if (best != null) {
                long age = Math.max(0, (SystemClock.elapsedRealtimeNanos() - best.getElapsedRealtimeNanos()) / 1000000);
                if (age <= 30000) state.put("fix", new JSONObject()
                    .put("longitude", best.getLongitude()).put("latitude", best.getLatitude())
                    .put("accuracy", best.getAccuracy()).put("timestamp", System.currentTimeMillis() - age)
                    .put("source", LocationManager.NETWORK_PROVIDER.equals(best.getProvider()) ? "network" : "gps"));
            }
            snapshot = state.toString();
        } catch (Exception ignored) { snapshot = "{\"error\":\"定位结果无效，请重试\"}"; }
    }
    @Override public void onProviderDisabled(String provider) { publish("定位服务已关闭或信号不可用，请检查系统定位设置"); }
    @Override public void onProviderEnabled(String provider) { pause(); resume(); }
    @Override public void onStatusChanged(String provider, int status, Bundle extras) { }
}
