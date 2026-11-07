package com.guanyun.weather;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.provider.MediaStore;
import android.webkit.ValueCallback;
import android.os.CancellationSignal;

/** Launch the installed camera and return a bounded JPEG copy through the WebView file chooser. */
final class CameraCapture {
    static final int PHOTO=4211,PERMISSION=4212;
    private final Activity activity;
    private ValueCallback<Uri[]> callback;
    private Uri output;
    private CancellationSignal processing;
    private ValueCallback<Uri[]> processingCallback;
    CameraCapture(Activity activity){this.activity=activity;}
    void start(ValueCallback<Uri[]> value){
        cancel();callback=value;
        // This app declares CAMERA for QR scanning, so Android also requires its runtime grant here.
        if(activity.checkSelfPermission(Manifest.permission.CAMERA)!=PackageManager.PERMISSION_GRANTED){activity.requestPermissions(new String[]{Manifest.permission.CAMERA},PERMISSION);return;}
        launch();
    }
    void permission(){
        if(callback==null)return;
        if(activity.checkSelfPermission(Manifest.permission.CAMERA)==PackageManager.PERMISSION_GRANTED)launch();
        else fail("相机权限未开启，标记内容保持不变");
    }
    private void launch(){
        try{
            output=CameraCaptureProvider.create(activity);
            Intent intent=new Intent(MediaStore.ACTION_IMAGE_CAPTURE).putExtra(MediaStore.EXTRA_OUTPUT,output)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            intent.setClipData(ClipData.newRawUri("山兔标记拍照",output));
            activity.startActivityForResult(intent,PHOTO);
        }catch(Exception e){fail("无法打开手机相机，请检查相机应用与权限");}
    }
    boolean result(int request,int result){
        if(request!=PHOTO)return false;
        if(callback==null){discard();return true;}
        Uri saved=output;
        boolean valid=false;
        try{valid=result==Activity.RESULT_OK&&saved!=null&&CameraCaptureProvider.resolve(activity,saved).length()>0;}catch(Exception ignored){}
        if(!valid){if(result==Activity.RESULT_OK)android.widget.Toast.makeText(activity,"相机未返回照片，请重试",0).show();cancel();return true;}
        activity.revokeUriPermission(saved,Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        ValueCallback<Uri[]> done=callback;callback=null;output=null;
        CancellationSignal cancel=new CancellationSignal();processing=cancel;
        processingCallback=done;
        new Thread(()->{
            Uri prepared=null;String error=null;
            try {
                String name="拍摄照片.jpg";
                try(android.database.Cursor cursor=activity.getContentResolver().query(saved,new String[]{android.provider.OpenableColumns.DISPLAY_NAME},null,null,null)){
                    if(cursor!=null&&cursor.moveToFirst())name=cursor.getString(0);
                }
                prepared=PhotoImportCache.prepare(activity,saved,name,cancel);
            } catch(Exception e){error=e.getMessage()==null?"照片处理失败":e.getMessage();}
            finally { try { CameraCaptureProvider.resolve(activity,saved).delete(); } catch(Exception ignored){} }
            Uri resultUri=prepared;String message=error;
            activity.runOnUiThread(()->{
                if(processing!=cancel)return;processing=null;processingCallback=null;
                if(resultUri!=null)done.onReceiveValue(new Uri[]{resultUri});
                else {done.onReceiveValue(null);if(!cancel.isCanceled())android.widget.Toast.makeText(activity,message,android.widget.Toast.LENGTH_LONG).show();}
            });
        },"shantu-camera-photo-import").start();return true;
    }
    private void fail(String text){android.widget.Toast.makeText(activity,text,android.widget.Toast.LENGTH_LONG).show();cancel();}
    private void discard(){if(output!=null){try{activity.revokeUriPermission(output,Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);CameraCaptureProvider.resolve(activity,output).delete();}catch(Exception ignored){}output=null;}}
    void cancel(){discard();if(processing!=null){processing.cancel();processing=null;}ValueCallback<Uri[]> old=callback;callback=null;if(old!=null)old.onReceiveValue(null);ValueCallback<Uri[]> active=processingCallback;processingCallback=null;if(active!=null)active.onReceiveValue(null);}
}
