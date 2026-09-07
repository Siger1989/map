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
    private android.os.CancellationSignal folderScan;
    AppFiles(Activity activity) { this.activity=activity; }
    boolean choose(ValueCallback<Uri[]> callback, android.webkit.WebChromeClient.FileChooserParams params) {
        if (folderScan != null) { folderScan.cancel(); folderScan = null; }
        if (pending != null) pending.onReceiveValue(null);
        pending=callback;
        try {
            boolean folder = java.util.Arrays.stream(params.getAcceptTypes()).anyMatch(t -> "application/x-guanyun-photo-folder".equals(t));
            if (folder) {
                activity.startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), FOLDER);
                return true;
            }
            boolean images = java.util.Arrays.stream(params.getAcceptTypes()).anyMatch(t -> t.startsWith("image/"));
            Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(images ? "image/*" : "*/*");
            picker.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == android.webkit.WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE);
            activity.startActivityForResult(picker, OPEN);
        }
        catch(Exception e) { pending.onReceiveValue(null);pending=null; }
        return true;
    }
    void save(String name,String mime,String text) {
        if (output != null) { android.widget.Toast.makeText(activity,"请先完成当前文件保存",0).show();return; }
        if (text.length()>8*1024*1024 || !name.matches("[a-zA-Z0-9._-]{1,80}") || !name.matches(".*\\.(json|gpx|kml)$")) return;
        output=text.getBytes(StandardCharsets.UTF_8);
        try { activity.startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/octet-stream").putExtra(Intent.EXTRA_TITLE,name),SAVE); }
        catch(Exception e) { output=null;android.widget.Toast.makeText(activity,"无法打开系统文件保存器",0).show(); }
    }
    void savePhoto(String name, byte[] bytes) {
        if (output != null) { android.widget.Toast.makeText(activity,"请先完成当前文件保存",0).show(); return; }
        output = bytes;
        try { activity.startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("image/jpeg").putExtra(Intent.EXTRA_TITLE,name),SAVE); }
        catch(Exception e) { output=null; android.widget.Toast.makeText(activity,"无法打开图片保存器",0).show(); }
    }
    void result(int request,int result,Intent intent) {
        Uri uri = result==Activity.RESULT_OK && intent!=null ? intent.getData():null;
        if (request==FOLDER && pending!=null) {
            if (uri==null) { pending.onReceiveValue(null); pending=null; return; }
            ValueCallback<Uri[]> callback = pending;
            android.os.CancellationSignal cancel = new android.os.CancellationSignal();
            folderScan = cancel;
            android.widget.Toast.makeText(activity,"正在读取所选文件夹的照片…",0).show();
            new Thread(() -> {
                Uri[] selected = null; String error = null;
                try { selected = PhotoDirectory.collect(activity.getContentResolver(), uri, cancel); }
                catch (Exception e) { error = e.getMessage()==null ? "无法读取文件夹，请重试或多选照片" : e.getMessage(); }
                final Uri[] files = selected; final String message = error;
                activity.runOnUiThread(() -> {
                    if (pending != callback || cancel.isCanceled()) return;
                    pending=null; folderScan=null;
                    if (message!=null) android.widget.Toast.makeText(activity,message,android.widget.Toast.LENGTH_LONG).show();
                    callback.onReceiveValue(files);
                });
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
            pending.onReceiveValue(selected);pending=null;
        }
        if (request==SAVE && output!=null) {
            if (uri!=null) try(OutputStream stream=activity.getContentResolver().openOutputStream(uri,"wt")) { if(stream==null)throw new Exception();stream.write(output);android.widget.Toast.makeText(activity,"文件已保存",0).show(); }
            catch(Exception e) { android.widget.Toast.makeText(activity,"文件保存失败，请重试",0).show(); }
            output=null;
        }
    }
    void close() { if(folderScan!=null)folderScan.cancel();folderScan=null;if(pending!=null)pending.onReceiveValue(null);pending=null;output=null; }
}
