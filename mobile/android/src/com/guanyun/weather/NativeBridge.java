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
    final ForegroundLocation position;
    NativeBridge(MainActivity activity,AppFiles files) { this.activity=activity;this.files=files;this.position=new ForegroundLocation(activity); }
    @JavascriptInterface public String locationState() { return position.snapshot(); }
    @JavascriptInterface public void locate(String mode) { activity.runOnUiThread(() -> position.start(mode)); }
    @JavascriptInterface public void stopLocation() { activity.runOnUiThread(() -> position.stop()); }
    @JavascriptInterface public String recordState() { return RecordingStore.snapshot(activity); }
    @JavascriptInterface public boolean photoFolders() { return true; }
    @JavascriptInterface public String routeOutput(String name, String encoded, boolean share) { return RouteOutput.file(activity, files, name, encoded, share); }
    @JavascriptInterface public String routeLinkShare(String url) { return RouteOutput.link(activity, url); }
    @JavascriptInterface public String photoOutput(String name, String encoded, boolean share) {
        if (name == null || !name.matches("(?:Shantu|Guanyun)-photo-[0-9]{1,16}\\.jpg") || encoded == null || encoded.length() > 12*1024*1024) return "分享图片过大或名称无效";
        final byte[] bytes;
        try { bytes = android.util.Base64.decode(encoded, android.util.Base64.DEFAULT); }
        catch (Exception e) { return "图片编码无效"; }
        if (bytes.length < 3 || bytes.length > 8*1024*1024 || (bytes[0]&255)!=255 || (bytes[1]&255)!=216 || (bytes[2]&255)!=255) return "请选择有效JPEG图片";
        activity.runOnUiThread(() -> {
            if (!activity.trustedForeground()) return;
            if (!share) { files.savePhoto(name, bytes); return; }
            new Thread(() -> {
                try {
                    android.net.Uri uri = PhotoShareProvider.prepare(activity, bytes);
                    activity.runOnUiThread(() -> {
                        if (!activity.trustedForeground()) return;
                        try {
                            Intent intent = new Intent(Intent.ACTION_SEND).setType("image/jpeg").putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                            intent.setClipData(android.content.ClipData.newRawUri("山兔行程照片", uri));
                            activity.startActivity(Intent.createChooser(intent, "分享行程照片"));
                        } catch (Exception e) { android.widget.Toast.makeText(activity,"无法打开系统分享，请尝试保存图片",0).show(); }
                    });
                } catch (Exception e) { activity.runOnUiThread(() -> android.widget.Toast.makeText(activity,"分享图片生成失败，请检查存储空间",0).show()); }
            }, "guanyun-photo-share").start();
        });
        return "ok";
    }
    @JavascriptInterface public int recordingAccuracy() { return RecordingPreferences.accuracy(activity); }
    @JavascriptInterface public boolean setRecordingAccuracy(double metres) {
        boolean saved = RecordingPreferences.saveAccuracy(activity, metres);
        if (saved) RecordingStore.clearQuality();
        return saved;
    }
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
