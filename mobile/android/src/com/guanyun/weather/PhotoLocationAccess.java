package com.guanyun.weather;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.DocumentsContract;
import android.provider.MediaStore;

/** Narrow access to original EXIF location for photos explicitly chosen in the GPS-photo flow. */
final class PhotoLocationAccess {
    static final int REQUEST = 4207;
    static final String GPS_PHOTO_ACCEPT = "application/x-shantu-gps-photo";
    static final String PERMISSION_DENIED = "permission-denied";
    static final String ORIGINAL_UNAVAILABLE = "original-unavailable";

    static final class AccessException extends Exception {
        final String reason;
        AccessException(String reason, String message, Throwable cause) { super(message, cause); this.reason = reason; }
        AccessException(String reason, String message) { this(reason, message, null); }
    }

    private PhotoLocationAccess() {}

    static boolean needsPickerPermission(int sdk, boolean gpsPhotoEntry) {
        return sdk >= Build.VERSION_CODES.Q && gpsPhotoEntry;
    }

    static boolean hasAcceptType(String[] accepted, String target) {
        if (accepted == null || target == null) return false;
        for (String value : accepted) if (value != null)
            for (String part : value.split(",")) if (target.equalsIgnoreCase(part.trim())) return true;
        return false;
    }

    static boolean hasPermission(Context context) {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
            context.checkSelfPermission(Manifest.permission.ACCESS_MEDIA_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    /** Returns a MediaStore URI requiring unredacted bytes only when the selected URI is MediaStore-backed. */
    static Uri requireOriginalUri(Context context, Uri source) throws AccessException {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || source == null) return source;
        Uri media = mediaStoreUri(context, source);
        if (media == null) return source; // Ordinary SAF/file providers are read exactly as selected.
        if (!hasPermission(context))
            throw new AccessException(PERMISSION_DENIED, "未获得读取照片原始拍摄位置的权限");
        try {
            return MediaStore.setRequireOriginal(media);
        } catch (RuntimeException failure) {
            throw new AccessException(ORIGINAL_UNAVAILABLE, "系统未能提供照片原始元数据", failure);
        }
    }

    static Uri mediaStoreUri(Context context, Uri source) throws AccessException {
        if (source == null || !"content".equalsIgnoreCase(source.getScheme())) return null;
        if ("media".equalsIgnoreCase(source.getAuthority())) return source;
        String authority = source.getAuthority();
        if (!"com.android.providers.media.documents".equalsIgnoreCase(authority) &&
            !"com.android.externalstorage.documents".equalsIgnoreCase(authority)) return null;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return null;
        try {
            if (!DocumentsContract.isDocumentUri(context, source))
                throw new AccessException(ORIGINAL_UNAVAILABLE, "系统无法识别所选照片的媒体原图");
            Uri media = MediaStore.getMediaUri(context, source);
            if (media == null || !"media".equalsIgnoreCase(media.getAuthority()))
                throw new AccessException(ORIGINAL_UNAVAILABLE, "系统未提供所选照片对应的媒体原图");
            return media;
        } catch (AccessException failure) {
            throw failure;
        } catch (RuntimeException failure) {
            throw new AccessException(ORIGINAL_UNAVAILABLE, "系统无法把所选照片解析为媒体原图", failure);
        }
    }

    static void request(Activity activity) {
        activity.requestPermissions(new String[]{Manifest.permission.ACCESS_MEDIA_LOCATION}, REQUEST);
    }
}
