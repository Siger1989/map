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
import java.io.FileOutputStream;

/** Only generated route copies, read-only through explicit temporary system share grants. */
public final class RouteShareProvider extends ContentProvider {
    static String mime(String name) {
        return name.endsWith(".zip") ? "application/zip" : name.endsWith(".jpg") ? "image/jpeg" : name.endsWith(".gpx") ? "application/gpx+xml" : name.endsWith(".kml") ? "application/vnd.google-earth.kml+xml" : name.endsWith(".xlsx") ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/json";
    }
    static Uri prepare(Context context, byte[] bytes, String extension) throws Exception {
        File file = target(context, extension);
        try(FileOutputStream out=new FileOutputStream(file)){out.write(bytes);}
        return uri(context, file);
    }
    static Uri prepareFile(Context context, File source, String extension) throws Exception {
        if (!source.getCanonicalFile().getParentFile().equals(new File(context.getCacheDir(), "archive-pending").getCanonicalFile()) || !source.isFile() || source.length() > ArchiveTransfer.LIMIT) throw new Exception("Invalid archive");
        File file = target(context, extension);
        if (!source.renameTo(file)) throw new Exception("Archive unavailable");
        return uri(context, file);
    }
    private static Uri uri(Context context, File file) {
        return new Uri.Builder().scheme("content").authority(context.getPackageName()+".routes").appendPath(file.getName()).build();
    }
    private static File target(Context context, String extension) throws Exception {
        File directory = new File(context.getCacheDir(), "route-shares");
        if (!directory.isDirectory() && !directory.mkdirs()) throw new Exception("Cache unavailable");
        File[] old = directory.listFiles(f -> f.getName().matches("[a-f0-9-]{36}\\.(jpg|gpx|kml|json|xlsx|zip)"));
        if (old != null) {
            java.util.Arrays.sort(old, java.util.Comparator.comparingLong(File::lastModified));
            for (int i=0;i<old.length;i++) if(old[i].lastModified()<System.currentTimeMillis()-86400000L || i<old.length-15) old[i].delete();
        }
        if (!extension.matches("jpg|gpx|kml|json|xlsx|zip")) throw new Exception("Invalid route type");
        return new File(directory,java.util.UUID.randomUUID()+"."+extension);
    }
    private File resolve(Uri uri) throws FileNotFoundException {
        if(!"content".equals(uri.getScheme()) || !(getContext().getPackageName()+".routes").equals(uri.getAuthority()) || uri.getPathSegments().size()!=1 || !uri.getLastPathSegment().matches("[a-f0-9-]{36}\\.(jpg|gpx|kml|json|xlsx|zip)")) throw new FileNotFoundException("Invalid route URI");
        File file=new File(new File(getContext().getCacheDir(),"route-shares"),uri.getLastPathSegment());
        if(!file.isFile())throw new FileNotFoundException("Route expired");return file;
    }
    @Override public boolean onCreate(){return true;}
    @Override public String getType(Uri uri){return mime(uri.getLastPathSegment());}
    @Override public ParcelFileDescriptor openFile(Uri uri,String mode)throws FileNotFoundException {
        if(!"r".equals(mode))throw new FileNotFoundException("Read only");return ParcelFileDescriptor.open(resolve(uri),ParcelFileDescriptor.MODE_READ_ONLY);
    }
    @Override public Cursor query(Uri uri,String[] projection,String selection,String[] args,String sort){
        try{File file=resolve(uri);String[] columns=projection==null?new String[]{OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE}:projection;MatrixCursor cursor=new MatrixCursor(columns,1);Object[] values=new Object[columns.length];
            for(int i=0;i<columns.length;i++){if(OpenableColumns.DISPLAY_NAME.equals(columns[i]))values[i]="Shantu-route."+file.getName().substring(37);else if(OpenableColumns.SIZE.equals(columns[i]))values[i]=file.length();}
            cursor.addRow(values);return cursor;
        }catch(FileNotFoundException e){return null;}
    }
    @Override public Uri insert(Uri uri,ContentValues values){throw new UnsupportedOperationException();}
    @Override public int update(Uri uri,ContentValues values,String where,String[] args){throw new UnsupportedOperationException();}
    @Override public int delete(Uri uri,String where,String[] args){throw new UnsupportedOperationException();}
}
