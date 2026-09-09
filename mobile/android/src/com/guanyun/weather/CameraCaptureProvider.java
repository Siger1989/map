package com.guanyun.weather;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;

/** Private, narrowly scoped JPEG output for the system camera's temporary URI grant. */
public final class CameraCaptureProvider extends ContentProvider {
    static File directory(Context context) { return new File(context.getCacheDir(), "camera-captures"); }
    static Uri create(Context context) throws Exception {
        File dir=directory(context);
        if(!dir.isDirectory()&&!dir.mkdirs())throw new Exception("拍照存储不可用");
        File[] old=dir.listFiles(f->f.getName().matches("[a-f0-9-]{36}\\.jpg"));
        if(old!=null)for(File file:old)if(file.lastModified()<System.currentTimeMillis()-86400000L)file.delete();
        File file=new File(dir,java.util.UUID.randomUUID()+".jpg");
        if(!file.createNewFile())throw new Exception("无法创建照片");
        return new Uri.Builder().scheme("content").authority(context.getPackageName()+".capture").appendPath(file.getName()).build();
    }
    static File resolve(Context context,Uri uri) throws FileNotFoundException {
        if(uri==null||!"content".equals(uri.getScheme())||!(context.getPackageName()+".capture").equals(uri.getAuthority())||uri.getPathSegments().size()!=1||!uri.getLastPathSegment().matches("[a-f0-9-]{36}\\.jpg"))throw new FileNotFoundException("Invalid camera URI");
        File file=new File(directory(context),uri.getLastPathSegment());
        if(!file.isFile())throw new FileNotFoundException("Camera output unavailable");
        return file;
    }
    @Override public boolean onCreate(){return true;}
    @Override public String getType(Uri uri){return "image/jpeg";}
    @Override public ParcelFileDescriptor openFile(Uri uri,String mode)throws FileNotFoundException {
        int access;
        if("r".equals(mode))access=ParcelFileDescriptor.MODE_READ_ONLY;
        else if("w".equals(mode)||"wt".equals(mode))access=ParcelFileDescriptor.MODE_WRITE_ONLY|ParcelFileDescriptor.MODE_TRUNCATE;
        else if("rw".equals(mode))access=ParcelFileDescriptor.MODE_READ_WRITE;
        else if("rwt".equals(mode))access=ParcelFileDescriptor.MODE_READ_WRITE|ParcelFileDescriptor.MODE_TRUNCATE;
        else throw new FileNotFoundException("Unsupported mode");
        return ParcelFileDescriptor.open(resolve(getContext(),uri),access);
    }
    @Override public Cursor query(Uri uri,String[] projection,String selection,String[] args,String sort){
        try{
            File file=resolve(getContext(),uri);
            String[] columns=projection==null?new String[]{OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE}:projection;
            Object[] values=new Object[columns.length];
            for(int i=0;i<columns.length;i++){
                if(OpenableColumns.DISPLAY_NAME.equals(columns[i]))values[i]="Shantu-camera-"+file.getName();
                else if(OpenableColumns.SIZE.equals(columns[i]))values[i]=file.length();
            }
            MatrixCursor cursor=new MatrixCursor(columns,1);cursor.addRow(values);return cursor;
        }catch(Exception e){return null;}
    }
    @Override public Uri insert(Uri u,ContentValues v){throw new UnsupportedOperationException();}
    @Override public int update(Uri u,ContentValues v,String w,String[] a){throw new UnsupportedOperationException();}
    @Override public int delete(Uri u,String w,String[] a){throw new UnsupportedOperationException();}
}
