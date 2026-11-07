package com.guanyun.weather;

import android.content.ContentResolver;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.ImageDecoder;
import android.graphics.Matrix;
import android.net.Uri;
import android.os.Build;
import android.os.CancellationSignal;
import android.provider.OpenableColumns;
import android.media.ExifInterface;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.Locale;

/** Prepares private, bounded JPEG copies for the WebView photo importer. Source URIs are read-only. */
final class PhotoImportCache {
    private static final long MAX_SOURCE_BYTES = 100L * 1024 * 1024;
    private static final long MAX_SOURCE_PIXELS = 250_000_000L;
    private static final int MAX_SIDE = 2560;
    private static final int MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
    private PhotoImportCache() {}

    static Uri prepare(Context context, Uri source, String name, CancellationSignal cancel) throws Exception {
        ContentResolver resolver = context.getContentResolver();
        cancel.throwIfCanceled();
        long length = sourceLength(resolver, source);
        if (length > MAX_SOURCE_BYTES) throw new Exception("原照片超过100MB，请先在相册另存较小副本");
        String hash = sha256(resolver, source, cancel);
        ExifInterface exif = null;
        try (InputStream input = resolver.openInputStream(source)) {
            if (input == null) throw new Exception("无法读取所选照片");
            try { exif = new ExifInterface(input); }
            catch (java.io.IOException | IllegalArgumentException ignored) {
                // Some valid image formats have no EXIF block, and some providers expose malformed metadata.
            }
            catch (SecurityException e) { throw e; }
            catch (RuntimeException ignored) { /* Fall back to ordinary orientation for malformed metadata. */ }
        }
        cancel.throwIfCanceled();
        Bitmap bitmap = decode(resolver, source, exif, cancel);
        File work = new File(context.getCacheDir(), "photo-import-work");
        if (!work.isDirectory() && !work.mkdirs()) { bitmap.recycle(); throw new Exception("照片临时目录不可用"); }
        pruneWork(work);
        File output = new File(work, java.util.UUID.randomUUID() + ".jpg");
        try {
            encode(bitmap, output, cancel);
            bitmap.recycle(); bitmap = null;
            cancel.throwIfCanceled();
            preserveMetadata(exif, output, hash);
            cancel.throwIfCanceled();
            Uri prepared = PhotoShareProvider.prepareImport(context, output, name);
            output = null;
            return prepared;
        } finally {
            if (bitmap != null && !bitmap.isRecycled()) bitmap.recycle();
            if (output != null) output.delete();
        }
    }

    private static long sourceLength(ContentResolver resolver, Uri uri) {
        try (android.database.Cursor cursor = resolver.query(uri, new String[]{OpenableColumns.SIZE}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) return cursor.getLong(0);
        } catch (Exception ignored) { }
        return -1;
    }

    private static String sha256(ContentResolver resolver, Uri uri, CancellationSignal cancel) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        long total = 0;
        try (InputStream input = resolver.openInputStream(uri)) {
            if (input == null) throw new Exception("无法读取所选照片");
            byte[] buffer = new byte[64 * 1024]; int n;
            while ((n = input.read(buffer)) != -1) {
                cancel.throwIfCanceled(); total += n;
                if (total > MAX_SOURCE_BYTES) throw new Exception("原照片超过100MB，请先在相册另存较小副本");
                digest.update(buffer, 0, n);
            }
        }
        if (total == 0) throw new Exception("照片文件为空");
        StringBuilder result = new StringBuilder(64);
        for (byte b : digest.digest()) result.append(String.format(Locale.ROOT, "%02x", b & 0xff));
        return result.toString();
    }

    private static Bitmap decode(ContentResolver resolver, Uri uri, ExifInterface exif, CancellationSignal cancel) throws Exception {
        if (Build.VERSION.SDK_INT >= 28) {
            try {
                ImageDecoder.Source source = ImageDecoder.createSource(resolver, uri);
                Bitmap result = ImageDecoder.decodeBitmap(source, (decoder, info, ignored) -> {
                    int width = info.getSize().getWidth(), height = info.getSize().getHeight();
                    validateSize(width, height);
                    double factor = Math.min(1.0, MAX_SIDE / (double)Math.max(width, height));
                    decoder.setTargetSize(Math.max(1, (int)Math.round(width * factor)), Math.max(1, (int)Math.round(height * factor)));
                    decoder.setAllocator(ImageDecoder.ALLOCATOR_SOFTWARE);
                });
                if (cancel.isCanceled()) { result.recycle(); cancel.throwIfCanceled(); }
                // ImageDecoder applies EXIF orientation while decoding.
                return result;
            } catch (OutOfMemoryError e) { throw e; }
            catch (UnsafePhotoSizeException e) { throw e; }
            catch (Exception e) {
                if (cancel.isCanceled()) throw e;
                /* Try the sampled legacy decoder below. */
            }
        }
        BitmapFactory.Options bounds = new BitmapFactory.Options(); bounds.inJustDecodeBounds = true;
        try (InputStream input = resolver.openInputStream(uri)) {
            if (input == null) throw new Exception("无法读取所选照片");
            BitmapFactory.decodeStream(input, null, bounds);
        }
        validateSize(bounds.outWidth, bounds.outHeight);
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = sampleSize(bounds.outWidth, bounds.outHeight);
        options.inPreferredConfig = Bitmap.Config.ARGB_8888;
        Bitmap decoded;
        try (InputStream input = resolver.openInputStream(uri)) {
            if (input == null) throw new Exception("无法读取所选照片");
            decoded = BitmapFactory.decodeStream(input, null, options);
        }
        if (decoded == null) throw new Exception("此设备无法解码该照片格式或编码配置");
        if (cancel.isCanceled()) { decoded.recycle(); cancel.throwIfCanceled(); }
        int orientation = exif == null ? ExifInterface.ORIENTATION_NORMAL
            : exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
        Bitmap oriented = orient(decoded, orientation);
        if (oriented != decoded) decoded.recycle();
        return oriented;
    }

    private static void validateSize(int width, int height) {
        if (width <= 0 || height <= 0) throw new IllegalArgumentException("设备无法读取照片尺寸或不支持此照片格式");
        if (width > 50_000 || height > 50_000 || (long)width * height > MAX_SOURCE_PIXELS) throw new UnsafePhotoSizeException();
    }

    private static final class UnsafePhotoSizeException extends IllegalArgumentException {
        UnsafePhotoSizeException() { super("照片像素尺寸过大"); }
    }

    private static int sampleSize(int width, int height) {
        int sample = 1;
        while (Math.max(width / sample, height / sample) > MAX_SIDE && sample < 128) sample *= 2;
        return sample;
    }

    private static Bitmap orient(Bitmap source, int value) {
        Matrix matrix = new Matrix();
        switch (value) {
            case ExifInterface.ORIENTATION_FLIP_HORIZONTAL: matrix.setScale(-1f, 1f); break;
            case ExifInterface.ORIENTATION_ROTATE_180: matrix.setRotate(180f); break;
            case ExifInterface.ORIENTATION_FLIP_VERTICAL: matrix.setRotate(180f); matrix.postScale(-1f, 1f); break;
            case ExifInterface.ORIENTATION_TRANSPOSE: matrix.setRotate(90f); matrix.postScale(-1f, 1f); break;
            case ExifInterface.ORIENTATION_ROTATE_90: matrix.setRotate(90f); break;
            case ExifInterface.ORIENTATION_TRANSVERSE: matrix.setRotate(-90f); matrix.postScale(-1f, 1f); break;
            case ExifInterface.ORIENTATION_ROTATE_270: matrix.setRotate(-90f); break;
            default: return source;
        }
        return Bitmap.createBitmap(source, 0, 0, source.getWidth(), source.getHeight(), matrix, true);
    }

    private static void encode(Bitmap initial, File output, CancellationSignal cancel) throws Exception {
        Bitmap current = initial; boolean owned = false;
        try {
            for (int pass = 0; pass < 7; pass++) {
                cancel.throwIfCanceled();
                Bitmap opaque = Bitmap.createBitmap(current.getWidth(), current.getHeight(), Bitmap.Config.ARGB_8888);
                Canvas canvas = new Canvas(opaque); canvas.drawColor(Color.WHITE); canvas.drawBitmap(current, 0, 0, null);
                try {
                    try (FileOutputStream stream = new FileOutputStream(output, false)) {
                        for (int quality : new int[]{88, 78, 68, 58, 48, 38}) {
                            stream.getChannel().position(0); stream.getChannel().truncate(0);
                            if (!opaque.compress(Bitmap.CompressFormat.JPEG, quality, stream)) throw new Exception("照片JPEG压缩失败");
                            stream.flush();
                            if (output.length() <= MAX_OUTPUT_BYTES) return;
                        }
                    }
                } finally { canvas.setBitmap(null); opaque.recycle(); }
                if (Math.max(current.getWidth(), current.getHeight()) <= 320) break;
                Bitmap smaller = Bitmap.createScaledBitmap(current, Math.max(1, (int)(current.getWidth() * .82)), Math.max(1, (int)(current.getHeight() * .82)), true);
                if (owned) current.recycle();
                current = smaller; owned = true;
            }
            throw new Exception("照片无法压缩至4MB");
        } finally { if (owned && !current.isRecycled()) current.recycle(); }
    }

    private static void preserveMetadata(ExifInterface source, File output, String hash) throws Exception {
        ExifInterface target = new ExifInterface(output.getAbsolutePath());
        String[] tags = {
            ExifInterface.TAG_DATETIME, ExifInterface.TAG_DATETIME_ORIGINAL, ExifInterface.TAG_DATETIME_DIGITIZED,
            "OffsetTime", "OffsetTimeOriginal", "OffsetTimeDigitized", ExifInterface.TAG_SUBSEC_TIME,
            ExifInterface.TAG_SUBSEC_TIME_ORIGINAL, ExifInterface.TAG_SUBSEC_TIME_DIGITIZED,
            ExifInterface.TAG_GPS_ALTITUDE, ExifInterface.TAG_GPS_ALTITUDE_REF,
            ExifInterface.TAG_GPS_LATITUDE, ExifInterface.TAG_GPS_LATITUDE_REF,
            ExifInterface.TAG_GPS_LONGITUDE, ExifInterface.TAG_GPS_LONGITUDE_REF,
            ExifInterface.TAG_GPS_TIMESTAMP, ExifInterface.TAG_GPS_DATESTAMP, ExifInterface.TAG_MAKE,
            ExifInterface.TAG_GPS_PROCESSING_METHOD, ExifInterface.TAG_GPS_SPEED, ExifInterface.TAG_GPS_SPEED_REF,
            ExifInterface.TAG_GPS_IMG_DIRECTION, ExifInterface.TAG_GPS_IMG_DIRECTION_REF,
            ExifInterface.TAG_MODEL, "LensMake", "LensModel",
            ExifInterface.TAG_IMAGE_DESCRIPTION, ExifInterface.TAG_ARTIST, ExifInterface.TAG_COPYRIGHT,
            ExifInterface.TAG_SOFTWARE, "ExposureTime", "FNumber", "PhotographicSensitivity", "ExposureProgram",
            "MeteringMode", "Flash", "FocalLength", "WhiteBalance", "ColorSpace",
        };
        if (source != null) for (String tag : tags) {
            String value = source.getAttribute(tag);
            if (value != null) target.setAttribute(tag, value);
        }
        target.setAttribute(ExifInterface.TAG_ORIENTATION, String.valueOf(ExifInterface.ORIENTATION_NORMAL));
        BitmapFactory.Options dimensions = new BitmapFactory.Options(); dimensions.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(output.getAbsolutePath(), dimensions);
        if (dimensions.outWidth > 0 && dimensions.outHeight > 0) {
            target.setAttribute(ExifInterface.TAG_PIXEL_X_DIMENSION, String.valueOf(dimensions.outWidth));
            target.setAttribute(ExifInterface.TAG_PIXEL_Y_DIMENSION, String.valueOf(dimensions.outHeight));
        }
        target.setAttribute(ExifInterface.TAG_IMAGE_UNIQUE_ID, hash);
        target.setAttribute(ExifInterface.TAG_USER_COMMENT, "SHANTU_NATIVE_PHOTO_V1:" + hash);
        target.saveAttributes();
    }

    private static void pruneWork(File directory) {
        File[] old = directory.listFiles(f -> f.getName().endsWith(".jpg"));
        if (old == null) return;
        long cutoff = System.currentTimeMillis() - 86400000L;
        for (File file : old) if (file.lastModified() < cutoff) file.delete();
    }
}
