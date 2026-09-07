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

/** Framework-only, private provider. Exposes only generated JPEG copies via temporary read grants. */
public final class PhotoShareProvider extends ContentProvider {
    static Uri prepare(Context context, byte[] bytes) throws Exception {
        File directory = new File(context.getCacheDir(), "photo-shares");
        if (!directory.isDirectory() && !directory.mkdirs()) throw new Exception("Cache unavailable");
        File[] old = directory.listFiles(f -> f.getName().matches("[a-f0-9-]{36}\\.jpg"));
        if (old != null) {
            java.util.Arrays.sort(old, java.util.Comparator.comparingLong(File::lastModified));
            for (int i=0; i<old.length; i++) if (old[i].lastModified() < System.currentTimeMillis()-86400000L || i < old.length-15) old[i].delete();
        }
        File file = new File(directory, java.util.UUID.randomUUID()+".jpg");
        try (FileOutputStream out = new FileOutputStream(file)) { out.write(bytes); }
        return new Uri.Builder().scheme("content").authority(context.getPackageName()+".photos").appendPath(file.getName()).build();
    }
    private File resolve(Uri uri) throws FileNotFoundException {
        if (!"content".equals(uri.getScheme()) || !(getContext().getPackageName()+".photos").equals(uri.getAuthority()) || uri.getPathSegments().size()!=1 || !uri.getLastPathSegment().matches("[a-f0-9-]{36}\\.jpg")) throw new FileNotFoundException("Invalid photo URI");
        File file = new File(new File(getContext().getCacheDir(), "photo-shares"), uri.getLastPathSegment());
        if (!file.isFile()) throw new FileNotFoundException("Photo expired");
        return file;
    }
    @Override public boolean onCreate() { return true; }
    @Override public String getType(Uri uri) { return "image/jpeg"; }
    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode)) throw new FileNotFoundException("Read only");
        return ParcelFileDescriptor.open(resolve(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }
    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) {
        try {
            File file = resolve(uri);
            String[] columns = projection == null ? new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE} : projection;
            MatrixCursor cursor = new MatrixCursor(columns, 1);
            Object[] values = new Object[columns.length];
            for (int i=0; i<columns.length; i++) {
                if (OpenableColumns.DISPLAY_NAME.equals(columns[i])) values[i]="Guanyun-photo.jpg";
                else if (OpenableColumns.SIZE.equals(columns[i])) values[i]=file.length();
            }
            cursor.addRow(values); return cursor;
        } catch (FileNotFoundException e) { return null; }
    }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues values, String where, String[] args) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String where, String[] args) { throw new UnsupportedOperationException(); }
}
