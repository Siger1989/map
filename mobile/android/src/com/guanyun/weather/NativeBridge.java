package com.guanyun.weather;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.webkit.JavascriptInterface;

/** Narrow recording/export API; only bundled main-frame navigation is permitted. */
final class NativeBridge {
    static final int REQUEST=4203;
    private final MainActivity activity;
    private final AppFiles files;
    private String pending;
    NativeBridge(MainActivity activity,AppFiles files) { this.activity=activity;this.files=files; }
    @JavascriptInterface public String recordState() { return RecordingStore.snapshot(activity); }
    @JavascriptInterface public void saveFile(String name,String mime,String text) { activity.runOnUiThread(()->{ if(activity.trustedForeground())files.save(name,mime,text); }); }
    @JavascriptInterface public void record(String action) {
        if (!java.util.Arrays.asList("start","resume","pause","finish","clear").contains(action)) return;
        activity.runOnUiThread(()->{
            if(!activity.trustedForeground())return;
            if ("start".equals(action)||"resume".equals(action)) {
                if(activity.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED) {
                    pending=action;activity.requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION},REQUEST);return;
                }
                if(Build.VERSION.SDK_INT>=33 && activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED) {
                    activity.requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},4204);
                }
                try { activity.startForegroundService(new Intent(activity,RecordingService.class).setAction(action)); }
                catch(Exception e) { RecordingStore.error(activity,"记录服务未能启动，请保持应用在前台后重试"); }
            } else {
                try { RecordingStore.command(activity,action);activity.stopService(new Intent(activity,RecordingService.class)); }
                catch(Exception e) { RecordingStore.error(activity,e.getMessage()); }
            }
        });
    }
    void resolve() {
        String action=pending;pending=null;
        if(action==null)return;
        if(activity.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED)record(action);
        else RecordingStore.error(activity,"需要精确定位权限才能记录轨迹");
    }
}
