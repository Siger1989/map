package com.guanyun.weather;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.StatFs;
import android.webkit.JavascriptInterface;
import java.io.File;

/** Narrow recording/export API; only bundled main-frame navigation is permitted. */
final class NativeBridge {
    static final int REQUEST=4203;
    private final MainActivity activity;
    private final AppFiles files;
    private String pending;
    @JavascriptInterface public String incomingRouteInfo() { return activity.incomingRoutes == null ? "{}" : activity.incomingRoutes.info(); }
    @JavascriptInterface public String incomingRouteChunk(String token, int offset) { return activity.incomingRoutes == null ? "" : activity.incomingRoutes.chunk(token, offset); }
    @JavascriptInterface public void incomingRouteDismiss(String token) { if(activity.incomingRoutes != null) activity.incomingRoutes.dismiss(token); }
    @JavascriptInterface public String incomingPlaceInfo() { return activity.trustedForeground() && activity.incomingPlaces != null ? activity.incomingPlaces.info() : "{}"; }
    @JavascriptInterface public void incomingPlaceDismiss(String token) { if (activity.trustedForeground() && token != null && token.length() <= 64 && activity.incomingPlaces != null) activity.incomingPlaces.dismiss(token); }
    final ForegroundLocation position;
    final CompassSensor compass;
    final MotionSensor motion;
    final ArchiveOutput archive;
    NativeBridge(MainActivity activity,AppFiles files) { this.activity=activity;this.files=files;this.position=new ForegroundLocation(activity);this.compass=new CompassSensor(activity);this.motion=new MotionSensor(activity);this.archive=new ArchiveOutput(activity,files); }
    @JavascriptInterface public String archiveBegin(String name, int size) { return archive.transfer.begin(name, size); }
    @JavascriptInterface public String archiveAppend(String token, int offset, String encoded) { return archive.transfer.append(token, offset, encoded); }
    @JavascriptInterface public String archiveFinish(String token, boolean share) { return archive.finish(token, share); }
    @JavascriptInterface public void archiveCancel(String token) { archive.transfer.cancel(token); }
    @JavascriptInterface public void cancelMapTile(String requestId) { MapTileProxy.cancel(requestId); }
    /** Foreground bundled UI only; clipboard writes require no additional Android permission. */
    @JavascriptInterface public boolean clipboardWrite(String text) {
        if (!activity.trustedForeground() || text == null || text.length() > 1024 * 1024) return false;
        try {
            android.content.ClipboardManager clipboard = (android.content.ClipboardManager)activity.getSystemService(android.content.Context.CLIPBOARD_SERVICE);
            if (clipboard == null) return false;
            clipboard.setPrimaryClip(android.content.ClipData.newPlainText("山兔", text));
            return true;
        } catch (RuntimeException failure) { return false; }
    }
    @JavascriptInterface public boolean locationPermissionGranted() { return position.locationPermissionGranted(); }
    @JavascriptInterface public String locationState() { return position.snapshot(); }
    @JavascriptInterface public void locate(String mode) { activity.runOnUiThread(() -> position.start(mode)); }
    @JavascriptInterface public void stopLocation() { activity.runOnUiThread(() -> position.stop()); }
    @JavascriptInterface public String compassState() { return compass.snapshot(); }
    @JavascriptInterface public String motionState() { return motion.snapshot(); }
    @JavascriptInterface public void motionEnabled(boolean enabled) { activity.runOnUiThread(() -> { if(enabled && activity.trustedForeground()) motion.start(); else motion.stop(); }); }
    @JavascriptInterface public void compassEnabled(boolean enabled) { activity.runOnUiThread(() -> { if(enabled && activity.trustedForeground()) compass.start(); else compass.stop(); }); }
    @JavascriptInterface public void setKeepScreenOn(boolean enabled) {
        activity.runOnUiThread(() -> {
            activity.requestScreenOn(enabled);
        });
    }
    @JavascriptInterface public String offlineCapabilities() { return "{\"version\":2,\"imported\":true,\"chunked\":true,\"legacyArchiveExport\":true}"; }
    /** Exports this installed app's real private OfflineStore through the user-selected SAF destination. */
    @JavascriptInterface public String offlineExportLegacyArchive() {
        if(!activity.trustedForeground())return "请保持山兔在前台后导出离线归档";
        if(OfflineDownloadService.running)return "请先暂停或完成离线下载，再导出旧版缓存";
        new Thread(()->{
            File archive=null;
            try {
                archive=OfflineStore.exportLegacyArchive(activity);
                File completed=archive;
                activity.runOnUiThread(()->{
                    if(!activity.trustedForeground()){completed.delete();return;}
                    files.saveGenerated("Shantu-legacy-offline.zip","application/zip",completed);
                });
            } catch(Exception error) {
                if(archive!=null)archive.delete();
                activity.runOnUiThread(()->android.widget.Toast.makeText(activity,error.getMessage()==null?"旧版离线缓存导出失败":error.getMessage(),android.widget.Toast.LENGTH_LONG).show());
            }
        },"shantu-offline-archive-export").start();
        return "started";
    }
    @JavascriptInterface public double offlineAvailableBytes() { try{return new StatFs(activity.getFilesDir().getAbsolutePath()).getAvailableBytes();}catch(Exception e){return 0;} }
    private boolean offlineReady() {
        if(!activity.trustedForeground())return false;
        if(Build.VERSION.SDK_INT>=33&&activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED){activity.runOnUiThread(()->activity.requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},4204));return false;}
        return true;
    }
    @JavascriptInterface public String offlineBegin(String id,String name,int total) { if(!offlineReady())return activity.trustedForeground()?"请允许通知权限后再开始缓存":"请保持山兔在前台后开始缓存";return OfflineStore.begin(activity,id,name,total); }
    @JavascriptInterface public String offlineAppend(String id,int offset,String rawUrls) { return OfflineStore.append(activity,id,offset,rawUrls); }
    @JavascriptInterface public void offlineDiscard(String id) { OfflineStore.discard(activity,id); }
    @JavascriptInterface public String offlineCommit(String id) {
        if(!offlineReady())return activity.trustedForeground()?"请允许通知权限后再开始缓存":"请保持山兔在前台后开始缓存";
        String result=OfflineStore.commit(activity,id);if(!"ok".equals(result))return result;
        try {Intent intent=new Intent(activity,OfflineDownloadService.class).putExtra("offlineId",id);if(Build.VERSION.SDK_INT>=26)activity.startForegroundService(intent);else activity.startService(intent);return "ok";}
        catch(Exception e){OfflineStore.status(activity,id,"paused","后台服务暂不可用，请返回应用后重试");OfflineDownloadService.releaseReservation(id);return "后台服务暂不可用，请返回应用后重试";}
    }
    @JavascriptInterface public String offlineStart(String raw) {
        if(!offlineReady())return activity.trustedForeground()?"请允许通知权限后再开始缓存":"请保持山兔在前台后开始缓存";
        String result=OfflineStore.prepare(activity,raw);if(!"ok".equals(result))return result;
        try { Intent intent=new Intent(activity,OfflineDownloadService.class).putExtra("offlineId",OfflineStore.activeId(activity));if(Build.VERSION.SDK_INT>=26)activity.startForegroundService(intent);else activity.startService(intent);return "ok"; }
        catch(Exception e){try{String id=OfflineStore.activeId(activity);OfflineStore.status(activity,id,"paused","后台服务暂不可用，请返回应用后重试");OfflineDownloadService.releaseReservation(id);}catch(Exception ignored){}return "后台服务暂不可用，请返回应用后重试";}
    }
    @JavascriptInterface public String offlineState() { return OfflineStore.snapshot(activity); }
    @JavascriptInterface public void offlinePause() { activity.startService(new Intent(activity,OfflineDownloadService.class).setAction("pause")); }
    @JavascriptInterface public void offlineCancel() { activity.startService(new Intent(activity,OfflineDownloadService.class).setAction("cancel")); }
    @JavascriptInterface public boolean offlineHas(String url) { return OfflineStore.has(activity,url); }
    @JavascriptInterface public String offlineVerify(String id) { return OfflineStore.verify(activity,id); }
    @JavascriptInterface public boolean offlineRemove(String id) { return OfflineStore.remove(activity,id); }
    @JavascriptInterface public String recordState() { return RecordingStore.snapshot(activity); }
    @JavascriptInterface public boolean photoFolders() { return true; }
    @JavascriptInterface public String routeOutput(String name, String encoded, boolean share) { return RouteOutput.file(activity, files, name, encoded, share); }
    @JavascriptInterface public String routeLinkShare(String url) { return RouteOutput.link(activity, url); }
    @JavascriptInterface public String placeTextShare(String text) { return PlaceOutput.share(activity, text); }
    /** Opens only a validated WGS84 AMap marker destination in the AMap app. */
    @JavascriptInterface public String openAmapMarker(String rawUrl) {
        if (!activity.trustedForeground()) return "请保持山兔在前台后打开高德";
        if (rawUrl == null || rawUrl.length() > 2048) return "地点链接无效";
        try {
            android.net.Uri uri = android.net.Uri.parse(rawUrl);
            if (!"https".equals(uri.getScheme()) || !"uri.amap.com".equals(uri.getHost()) ||
                uri.getUserInfo() != null || uri.getPort() != -1 || uri.getFragment() != null ||
                !"/marker".equals(uri.getPath()) || uri.getQueryParameters("position").size() != 1 ||
                uri.getQueryParameters("coordinate").size() != 1 || uri.getQueryParameters("callnative").size() != 1 ||
                !"wgs84".equals(uri.getQueryParameter("coordinate")) ||
                !"1".equals(uri.getQueryParameter("callnative"))) return "地点链接无效";
            String position = uri.getQueryParameter("position");
            if (position == null) return "地点链接无效";
            String[] pair = position.split(",", -1);
            if (pair.length != 2) return "地点链接无效";
            double lon = Double.parseDouble(pair[0]), lat = Double.parseDouble(pair[1]);
            if (!Double.isFinite(lon) || !Double.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90)
                return "地点链接无效";
            if (uri.getQueryParameters("name").size() > 1) return "地点链接无效";
            String name = uri.getQueryParameter("name");
            if (name == null) name = "地图位置";
            name = name.replaceAll("[\\r\\n\\u0000-\\u001f\\u007f]", " ").trim();
            if (name.length() > 120) name = name.substring(0, 120);
            if (name.isEmpty()) name = "地图位置";
            android.net.Uri navigationUri = android.net.Uri.parse(AmapNavigationUri.build(name, lat, lon));
            Intent intent = new Intent(Intent.ACTION_VIEW, navigationUri).setPackage("com.autonavi.minimap");
            if (intent.resolveActivity(activity.getPackageManager()) == null) return "unavailable";
            activity.runOnUiThread(() -> {
                if (!activity.trustedForeground()) return;
                try { activity.startActivity(intent); }
                catch (Exception failure) { android.widget.Toast.makeText(activity,"高德地图未能打开，请使用已复制的地点链接",android.widget.Toast.LENGTH_SHORT).show(); }
            });
            return "requested";
        } catch (Exception failure) {
            return "高德地图未能打开";
        }
    }
    @JavascriptInterface public String photoOutput(String name, String encoded, boolean share) {
        if (name == null || !name.matches("(?:Shantu|Guanyun)-(?:(?:photo|measurement)-[0-9]{1,16}|section-[0-9]{1,16}-[1-9][0-9]{0,3})\\.jpg") || encoded == null || encoded.length() > 12*1024*1024) return "分享图片过大或名称无效";
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
    @JavascriptInterface public String recordingSampling() { return SamplingPreferences.read(activity).toString(); }
    @JavascriptInterface public boolean setRecordingSampling(String raw) { return SamplingPreferences.save(activity, raw); }
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
