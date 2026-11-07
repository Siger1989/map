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
import java.io.FileInputStream;

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
    static synchronized Uri prepareImport(Context context, File source, String displayName) throws Exception {
        File directory = new File(context.getCacheDir(), "photo-imports");
        if (!directory.isDirectory() && !directory.mkdirs()) throw new Exception("照片缓存不可用");
        pruneImports(directory);
        File[] images = directory.listFiles(f -> f.getName().matches("[a-f0-9-]{36}\\.jpg"));
        long total = 0;
        if (images != null) for (File image : images) total += image.length();
        if ((images != null && images.length >= 200) || total + source.length() > 200L * 1024 * 1024)
            throw new Exception("照片暂存已达200张或200MB，此照片未导入，请稍后分批再试");
        String id = java.util.UUID.randomUUID().toString();
        File target = new File(directory, id + ".jpg");
        File nameFile = new File(directory, id + ".name");
        try {
            if (!source.renameTo(target)) {
                try (FileInputStream input = new FileInputStream(source); FileOutputStream output = new FileOutputStream(target)) {
                    byte[] buffer = new byte[64 * 1024]; int n;
                    while ((n = input.read(buffer)) != -1) output.write(buffer, 0, n);
                }
                source.delete();
            }
            String safeName = displayName == null ? "照片.jpg" : displayName.replaceAll("[\\\\/:*?\"<>|]", "_").trim();
            if (safeName.isEmpty()) safeName = "照片.jpg";
            int dot = safeName.lastIndexOf('.');
            if (dot > 0 && !safeName.substring(dot).equalsIgnoreCase(".jpg") && !safeName.substring(dot).equalsIgnoreCase(".jpeg")) safeName = safeName.substring(0, dot);
            if (!safeName.toLowerCase(java.util.Locale.ROOT).endsWith(".jpg") && !safeName.toLowerCase(java.util.Locale.ROOT).endsWith(".jpeg")) safeName += ".jpg";
            if (safeName.length() > 200) safeName = safeName.substring(0, 196) + ".jpg";
            try (FileOutputStream output = new FileOutputStream(nameFile)) { output.write(safeName.getBytes(java.nio.charset.StandardCharsets.UTF_8)); }
            return new Uri.Builder().scheme("content").authority(context.getPackageName()+".photos").appendPath("import").appendPath(target.getName()).build();
        } catch (Exception e) {
            target.delete(); nameFile.delete(); source.delete(); throw e;
        }
    }
    static void deleteImport(Context context, Uri uri) {
        if (uri == null || uri.getPathSegments().size() != 2 || !"import".equals(uri.getPathSegments().get(0))) return;
        String name = uri.getLastPathSegment();
        if (name == null || !name.matches("[a-f0-9-]{36}\\.jpg")) return;
        File directory = new File(context.getCacheDir(), "photo-imports");
        new File(directory, name).delete();
        new File(directory, name.substring(0, name.length() - 4) + ".name").delete();
    }
    static boolean importsAvailable(Context context, Uri[] uris) {
        if (uris == null || uris.length == 0) return false;
        File directory = new File(context.getCacheDir(), "photo-imports");
        for (Uri uri : uris) {
            if (uri == null || !"content".equals(uri.getScheme())
                || !(context.getPackageName()+".photos").equals(uri.getAuthority())
                || uri.getPathSegments().size() != 2 || !"import".equals(uri.getPathSegments().get(0))) return false;
            String name = uri.getLastPathSegment();
            if (name == null || !name.matches("[a-f0-9-]{36}\\.jpg")) return false;
            File image = new File(directory, name);
            if (!image.isFile() || image.length() == 0) return false;
        }
        return true;
    }
    private static void pruneImports(File directory) {
        File[] images = directory.listFiles(f -> f.getName().matches("[a-f0-9-]{36}\\.jpg"));
        if (images == null) return;
        long cutoff = System.currentTimeMillis() - 86400000L;
        for (File image : images) if (image.lastModified() < cutoff) {
            String id = image.getName().substring(0, 36);
            image.delete(); new File(directory, id + ".name").delete();
        }
    }
    private File resolve(Uri uri) throws FileNotFoundException {
        if (!"content".equals(uri.getScheme()) || !(getContext().getPackageName()+".photos").equals(uri.getAuthority())) throw new FileNotFoundException("Invalid photo URI");
        File file;
        if (uri.getPathSegments().size() == 2 && "import".equals(uri.getPathSegments().get(0)) && uri.getLastPathSegment().matches("[a-f0-9-]{36}\\.jpg"))
            file = new File(new File(getContext().getCacheDir(), "photo-imports"), uri.getLastPathSegment());
        else if (uri.getPathSegments().size() == 1 && uri.getLastPathSegment().matches("[a-f0-9-]{36}\\.jpg"))
            file = new File(new File(getContext().getCacheDir(), "photo-shares"), uri.getLastPathSegment());
        else throw new FileNotFoundException("Invalid photo URI");
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
                if (OpenableColumns.DISPLAY_NAME.equals(columns[i])) {
                    String id = uri.getLastPathSegment();
                    File nameFile = uri.getPathSegments().size() == 2 && id != null
                        ? new File(new File(getContext().getCacheDir(), "photo-imports"), id.substring(0, 36) + ".name") : null;
                    values[i] = nameFile != null && nameFile.isFile() ? readName(nameFile) : "Shantu-photo.jpg";
                }
                else if (OpenableColumns.SIZE.equals(columns[i])) values[i]=file.length();
            }
            cursor.addRow(values); return cursor;
        } catch (FileNotFoundException e) { return null; }
    }
    private static String readName(File file) {
        try (java.io.FileInputStream input = new java.io.FileInputStream(file)) {
            byte[] bytes = new byte[(int)Math.min(256, file.length())]; int n = input.read(bytes);
            return n > 0 ? new String(bytes, 0, n, java.nio.charset.StandardCharsets.UTF_8) : "照片.jpg";
        } catch (Exception ignored) { return "照片.jpg"; }
    }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues values, String where, String[] args) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String where, String[] args) { throw new UnsupportedOperationException(); }
}
