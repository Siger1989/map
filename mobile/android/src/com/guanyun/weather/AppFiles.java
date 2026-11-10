package com.guanyun.weather;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.webkit.ValueCallback;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/** Android document picker grants access only to files explicitly chosen by the user. */
final class AppFiles {
    static final int OPEN=4201, SAVE=4202, FOLDER=4205;
    private final Activity activity;
    private ValueCallback<Uri[]> pending;
    private byte[] output;
    private java.io.File outputFile;
    private boolean saving;
    private android.os.CancellationSignal folderScan;
    private boolean preparingPhotos;
    private boolean gpsPhotoImport;
    private boolean gpsPermissionPending;
    private boolean pickerFolder, pickerImages, pickerMultiple, pickerCapture;
    final CameraCapture camera;
    AppFiles(Activity activity) { this.activity=activity; camera=new CameraCapture(activity); }
    boolean choose(ValueCallback<Uri[]> callback, android.webkit.WebChromeClient.FileChooserParams params) {
        camera.cancel();
        gpsPermissionPending = false;
        if (folderScan != null) { folderScan.cancel(); folderScan = null; }
        if (pending != null) pending.onReceiveValue(null);
        pending = null;
        preparingPhotos = false; gpsPhotoImport = false; gpsPermissionPending = false;
        pickerFolder = pickerImages = pickerMultiple = pickerCapture = false;
        pending=callback;
        try {
            String[] accepted = params.getAcceptTypes();
            boolean folder = PhotoLocationAccess.hasAcceptType(accepted, "application/x-guanyun-photo-folder");
            gpsPhotoImport = PhotoLocationAccess.hasAcceptType(accepted, PhotoLocationAccess.GPS_PHOTO_ACCEPT);
            boolean images = java.util.Arrays.stream(params.getAcceptTypes()).anyMatch(t -> t.startsWith("image/"));
            preparingPhotos = images;
            pickerFolder = folder; pickerImages = images;
            pickerMultiple = params.getMode() == android.webkit.WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE;
            pickerCapture = images && params.isCaptureEnabled();
            if (gpsPhotoImport && pickerCapture) pickerCapture = false;
            if (PhotoLocationAccess.needsPickerPermission(android.os.Build.VERSION.SDK_INT, gpsPhotoImport) && !PhotoLocationAccess.hasPermission(activity)) {
                gpsPermissionPending = true;
                PhotoLocationAccess.request(activity);
                return true;
            }
            launchPendingPicker();
        }
        catch(Exception e) { finishPendingWithMessage("无法打开文件选择器，请从文件管理器用山兔打开路线文件"); }
        return true;
    }
    private void launchPendingPicker() throws Exception {
        gpsPermissionPending = false;
        if (pickerFolder) {
            activity.startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), FOLDER);
            return;
        }
        if (pickerCapture) { ValueCallback<Uri[]> callback = pending; pending = null; camera.start(callback); return; }
        Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(pickerImages ? "image/*" : "*/*");
        picker.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, pickerMultiple);
        activity.startActivityForResult(picker, OPEN);
    }
    void photoLocationPermissionResult(int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode != PhotoLocationAccess.REQUEST || !gpsPermissionPending) return;
        boolean granted = grantResults.length > 0 && grantResults[0] == android.content.pm.PackageManager.PERMISSION_GRANTED && PhotoLocationAccess.hasPermission(activity);
        if (!granted) {
            finishPendingWithMessage("未授予照片位置读取权限，本次未开始选择；可确认系统权限后重新尝试");
            return;
        }
        try { launchPendingPicker(); }
        catch (Exception e) { finishPendingWithMessage("无法打开照片选择器，请重试"); }
    }
    private void finishPendingWithMessage(String message) {
        gpsPermissionPending = false;
        preparingPhotos = false; gpsPhotoImport = false;
        pickerFolder = pickerImages = pickerMultiple = pickerCapture = false;
        if (pending != null) pending.onReceiveValue(null);
        pending = null;
        android.widget.Toast.makeText(activity, message, android.widget.Toast.LENGTH_LONG).show();
    }
    void save(String name,String mime,String text) {
        if (output != null || outputFile != null || saving) { android.widget.Toast.makeText(activity,"请先完成当前文件保存",0).show();return; }
        if (text.length()>8*1024*1024 || !name.matches("[a-zA-Z0-9._-]{1,80}") || !name.matches(".*\\.(json|gpx|kml)$")) return;
        output=text.getBytes(StandardCharsets.UTF_8);
        try { activity.startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/octet-stream").putExtra(Intent.EXTRA_TITLE,name),SAVE); }
        catch(Exception e) { output=null;android.widget.Toast.makeText(activity,"无法打开系统文件保存器",0).show(); }
    }
    void savePhoto(String name, byte[] bytes) {
        saveBytes(name, "image/jpeg", bytes);
    }
    void saveBytes(String name, String mime, byte[] bytes) {
        if (output != null || outputFile != null || saving) { android.widget.Toast.makeText(activity,"请先完成当前文件保存",0).show(); return; }
        output = bytes;
        try { activity.startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(mime).putExtra(Intent.EXTRA_TITLE,name),SAVE); }
        catch(Exception e) { output=null; android.widget.Toast.makeText(activity,"无法打开图片保存器",0).show(); }
    }
    void saveGenerated(String name, String mime, java.io.File file) {
        if (output != null || outputFile != null || saving) { file.delete(); android.widget.Toast.makeText(activity,"请先完成当前文件保存",0).show(); return; }
        outputFile = file;
        try { activity.startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(mime).putExtra(Intent.EXTRA_TITLE,name),SAVE); }
        catch(Exception e) { outputFile=null;file.delete();android.widget.Toast.makeText(activity,"无法打开压缩包保存器",0).show(); }
    }
    void result(int request,int result,Intent intent) {
        if(camera.result(request,result))return;
        Uri uri = result==Activity.RESULT_OK && intent!=null ? intent.getData():null;
        if (request==FOLDER && pending!=null) {
            if (uri==null) { pending.onReceiveValue(null); pending=null; preparingPhotos=false; gpsPhotoImport=false; return; }
            ValueCallback<Uri[]> callback = pending;
            boolean gpsImport = gpsPhotoImport;
            android.os.CancellationSignal cancel = new android.os.CancellationSignal();
            folderScan = cancel;
            android.widget.Toast.makeText(activity,"正在读取所选文件夹的照片…",0).show();
            new Thread(() -> {
                try {
                    Uri[] selected = PhotoDirectory.collect(activity.getContentResolver(), uri, cancel);
                    preparePhotos(callback, selected, cancel, gpsImport);
                } catch (Exception e) {
                    String message = e.getMessage()==null ? "无法读取文件夹，请重试或多选照片" : e.getMessage();
                    activity.runOnUiThread(() -> finishPhotoSelection(callback, cancel, null, message));
                }
            }, "guanyun-photo-folder").start();
            return;
        }
        if (request==OPEN && pending!=null) {
            Uri[] selected = uri==null?null:new Uri[]{uri};
            if (result==Activity.RESULT_OK && intent!=null && intent.getClipData()!=null) {
                int count=intent.getClipData().getItemCount();
                if(count>30) { selected=null;android.widget.Toast.makeText(activity,"每次最多选择30张照片",0).show(); }
                else { selected=new Uri[count]; for(int i=0;i<count;i++) selected[i]=intent.getClipData().getItemAt(i).getUri(); }
            }
            if (selected==null || selected.length==0) {
                pending.onReceiveValue(null); pending=null; preparingPhotos=false; gpsPhotoImport=false;
                if (result==Activity.RESULT_OK) android.widget.Toast.makeText(activity,"没有收到所选文件，请保存到本机后重试",android.widget.Toast.LENGTH_LONG).show();
                return;
            }
            if (preparingPhotos) {
                android.os.CancellationSignal cancel = new android.os.CancellationSignal(); folderScan = cancel;
                boolean gpsImport = gpsPhotoImport;
                preparePhotos(pending, selected, cancel, gpsImport);
            } else { pending.onReceiveValue(selected);pending=null; gpsPhotoImport=false; }
        }
        if (request==SAVE && (output!=null || outputFile!=null)) {
            final byte[] bytes=output;final java.io.File source=outputFile;output=null;outputFile=null;
            if(uri==null){if(source!=null)source.delete();return;}
            saving=true;
            new Thread(()->{
                String message="文件已保存";
                try(OutputStream stream=activity.getContentResolver().openOutputStream(uri,"wt")) {
                    if(stream==null)throw new Exception();
                    if(source==null)stream.write(bytes);
                    else try(java.io.FileInputStream input=new java.io.FileInputStream(source)) {byte[] buffer=new byte[65536];int n;while((n=input.read(buffer))!=-1)stream.write(buffer,0,n);}
                } catch(Exception e){message="文件保存失败，请重新导出";}
                finally{if(source!=null)source.delete();}
                final String resultMessage=message;
                activity.runOnUiThread(()->{saving=false;android.widget.Toast.makeText(activity,resultMessage,0).show();});
            },"shantu-save-file").start();
        }
    }
    private void preparePhotos(ValueCallback<Uri[]> callback, Uri[] selected, android.os.CancellationSignal cancel, boolean gpsImport) {
        activity.runOnUiThread(() -> android.widget.Toast.makeText(activity,"正在采样并压缩照片…",android.widget.Toast.LENGTH_SHORT).show());
        new Thread(() -> {
            java.util.ArrayList<Uri> prepared = new java.util.ArrayList<>();
            java.util.ArrayList<String> errors = new java.util.ArrayList<>();
            if (selected != null) for (int i=0; i<selected.length; i++) {
                if (cancel.isCanceled()) break;
                Uri source = selected[i]; String name = "照片" + (i+1);
                try (android.database.Cursor cursor = activity.getContentResolver().query(source, new String[]{android.provider.OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                    if (cursor != null && cursor.moveToFirst()) name = cursor.getString(0);
                } catch (Exception ignored) { }
                try { prepared.add(gpsImport ? PhotoImportCache.prepareGps(activity, source, name, cancel) : PhotoImportCache.prepare(activity, source, name, cancel)); }
                catch (PhotoLocationAccess.AccessException e) {
                    if (e.reason.equals(PhotoLocationAccess.PERMISSION_DENIED)) {
                        if (!cancel.isCanceled() && errors.size()<4) errors.add(name+"：系统权限未通过，照片原始GPS未读取");
                    } else if (!cancel.isCanceled()) {
                        // Keep processing the user's selected URI when the provider cannot expose its MediaStore original.
                        try {
                            prepared.add(PhotoImportCache.prepare(activity, source, name, cancel));
                            if (errors.size()<4) errors.add(name+"：系统未提供原图，已按所选文件读取；GPS可能缺失，原文件未修改");
                        } catch (Exception fallback) {
                            if (errors.size()<4) errors.add(name+"：系统未提供原图，照片处理失败");
                        }
                    }
                }
                catch (Exception e) { if (!cancel.isCanceled() && errors.size()<4) errors.add(name+"："+(e.getMessage()==null?"照片处理失败":e.getMessage())); }
            }
            Uri[] uris = prepared.isEmpty() ? null : prepared.toArray(new Uri[0]);
            String message = errors.isEmpty() ? null : String.join("\n", errors) + (errors.size()==4 ? "\n另有照片需要查看提示" : "");
            activity.runOnUiThread(() -> finishPhotoSelection(callback, cancel, uris, message));
        }, "shantu-photo-import").start();
    }
    void finishPhotoSelection(ValueCallback<Uri[]> callback, android.os.CancellationSignal cancel, Uri[] files, String message) {
        if (folderScan == cancel) folderScan = null;
        if (pending != callback || cancel.isCanceled()) {
            if (files != null) for (Uri file : files) PhotoShareProvider.deleteImport(activity, file);
            return;
        }
        preparingPhotos = false;
        gpsPhotoImport = false;
        pending = null;
        if (files == null || files.length == 0) {
            callback.onReceiveValue(null);
            android.widget.Toast.makeText(activity, message==null?"所选照片无法解码":message, android.widget.Toast.LENGTH_LONG).show();
            return;
        }
        if (!PhotoShareProvider.importsAvailable(activity, files)) {
            for (Uri file : files) PhotoShareProvider.deleteImport(activity, file);
            callback.onReceiveValue(null);
            android.widget.Toast.makeText(activity, "照片临时缓存不完整，请重新选择", android.widget.Toast.LENGTH_LONG).show();
            return;
        }
        callback.onReceiveValue(files);
        if (message != null) android.widget.Toast.makeText(activity, "照片导入提示：\n"+message, android.widget.Toast.LENGTH_LONG).show();
    }
    void close() { camera.cancel();if(folderScan!=null)folderScan.cancel();folderScan=null;if(pending!=null)pending.onReceiveValue(null);pending=null;preparingPhotos=false;gpsPhotoImport=false;gpsPermissionPending=false;pickerFolder=pickerImages=pickerMultiple=pickerCapture=false;output=null;if(outputFile!=null)outputFile.delete();outputFile=null; }
}
