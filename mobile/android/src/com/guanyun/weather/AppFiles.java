package com.guanyun.weather;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.webkit.ValueCallback;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/** Android document picker grants access only to files explicitly chosen by the user. */
final class AppFiles {
    static final int OPEN=4201, SAVE=4202;
    private final Activity activity;
    private ValueCallback<Uri[]> pending;
    private byte[] output;
    AppFiles(Activity activity) { this.activity=activity; }
    boolean choose(ValueCallback<Uri[]> callback) {
        if (pending != null) pending.onReceiveValue(null);
        pending=callback;
        try { activity.startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*"),OPEN); }
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
    void result(int request,int result,Intent intent) {
        Uri uri = result==Activity.RESULT_OK && intent!=null ? intent.getData():null;
        if (request==OPEN && pending!=null) { pending.onReceiveValue(uri==null?null:new Uri[]{uri});pending=null; }
        if (request==SAVE && output!=null) {
            if (uri!=null) try(OutputStream stream=activity.getContentResolver().openOutputStream(uri,"wt")) { if(stream==null)throw new Exception();stream.write(output);android.widget.Toast.makeText(activity,"文件已保存",0).show(); }
            catch(Exception e) { android.widget.Toast.makeText(activity,"文件保存失败，请重试",0).show(); }
            output=null;
        }
    }
    void close() { if(pending!=null)pending.onReceiveValue(null);pending=null;output=null; }
}
