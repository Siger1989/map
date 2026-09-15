package com.guanyun.weather;

import android.Manifest;
import android.app.Activity;
import android.content.ContentUris;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.CancellationSignal;
import android.provider.MediaStore;
import java.io.IOException;
import java.util.ArrayList;

/** Explicit picker action only. Query the granted media index by capture time before reading images. */
final class PhotoLibrary {
    static final int PERMISSION = 4211;
    static boolean allowed(Activity a) {
        return a.checkSelfPermission(Build.VERSION.SDK_INT >= 33 ? Manifest.permission.READ_MEDIA_IMAGES : Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
            || (Build.VERSION.SDK_INT >= 34 && a.checkSelfPermission(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED) == PackageManager.PERMISSION_GRANTED);
    }
    static void request(Activity a) {
        ArrayList<String> permissions = new ArrayList<>();
        permissions.add(Build.VERSION.SDK_INT >= 33 ? Manifest.permission.READ_MEDIA_IMAGES : Manifest.permission.READ_EXTERNAL_STORAGE);
        if (Build.VERSION.SDK_INT >= 34) permissions.add(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED);
        if (Build.VERSION.SDK_INT >= 29) permissions.add(Manifest.permission.ACCESS_MEDIA_LOCATION);
        a.requestPermissions(permissions.toArray(new String[0]), PERMISSION);
    }
    static Uri[] collect(Activity a, long start, long end, CancellationSignal cancel) throws Exception {
        if (start <= 0 || end < start) throw new IOException("请先选择有记录时间的行程");
        Uri collection = MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
        String date = MediaStore.Images.Media.DATE_TAKEN;
        // DATE_TAKEN is a coarse candidate index. Unknown times remain candidates for EXIF confirmation.
        String selection = "(" + date + " >= ? AND " + date + " <= ?) OR " + date + " IS NULL OR " + date + " = 0";
        ArrayList<Uri> result = new ArrayList<>();
        boolean original = Build.VERSION.SDK_INT >= 29 && a.checkSelfPermission(Manifest.permission.ACCESS_MEDIA_LOCATION) == PackageManager.PERMISSION_GRANTED;
        try (Cursor c = a.getContentResolver().query(collection, new String[]{MediaStore.Images.Media._ID}, selection,
            new String[]{String.valueOf(start),String.valueOf(end)}, date + " ASC", cancel)) {
            if (c == null) throw new IOException("无法读取已授权相册");
            while(c.moveToNext()) {
                cancel.throwIfCanceled();
                Uri uri = ContentUris.withAppendedId(collection,c.getLong(0));
                if (original) uri = MediaStore.setRequireOriginal(uri);
                result.add(uri);
                if(result.size()>5000) throw new IOException("该时间范围及未知时间候选超过5000张，请选具体照片文件夹筛选");
            }
        }
        if(result.isEmpty())throw new IOException("已授权照片中没有此行程的时间候选；可重新授权照片或选择文件夹");
        return result.toArray(new Uri[0]);
    }
}
