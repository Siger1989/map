package com.guanyun.weather;

import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;
import android.os.CancellationSignal;
import android.provider.DocumentsContract;
import java.io.IOException;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Locale;

/** Reads only the tree granted by the system picker; no filesystem or media-library scan. */
final class PhotoDirectory {
    private static final int MAX_PHOTOS = 200, MAX_ENTRIES = 4000;
    static Uri[] collect(ContentResolver resolver, Uri tree, CancellationSignal cancel) throws Exception {
        ArrayDeque<String> queue = new ArrayDeque<>();
        HashSet<String> seen = new HashSet<>();
        ArrayList<Uri> photos = new ArrayList<>();
        queue.add(DocumentsContract.getTreeDocumentId(tree));
        int entries = 0;
        while (!queue.isEmpty()) {
            cancel.throwIfCanceled();
            String parent = queue.remove();
            if (!seen.add(parent)) continue;
            Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parent);
            String[] columns = { DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.COLUMN_DISPLAY_NAME };
            try (Cursor cursor = resolver.query(children, columns, null, null, null, cancel)) {
                if (cursor == null) throw new IOException("无法读取该文件夹，请选择本机的具体照片目录");
                while (cursor.moveToNext()) {
                    cancel.throwIfCanceled();
                    if (++entries > MAX_ENTRIES) throw new IOException("文件夹内容过多，请选择更小的行程目录");
                    String id = cursor.getString(0), mime = cursor.getString(1), name = cursor.getString(2);
                    if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) queue.add(id);
                    else if (isPhoto(mime, name)) {
                        photos.add(DocumentsContract.buildDocumentUriUsingTree(tree, id));
                        if (photos.size() > MAX_PHOTOS) throw new IOException("文件夹超过200张照片，请选择更小的行程目录或分批选照片");
                    }
                }
            }
        }
        if (photos.isEmpty()) throw new IOException("文件夹中没有支持的照片，请选择 JPEG/PNG/WebP/HEIC 原片目录");
        return photos.toArray(new Uri[0]);
    }
    static boolean isPhoto(String mime, String name) {
        String type = mime == null ? "" : mime.toLowerCase(Locale.ROOT);
        if (type.matches("image/(jpeg|png|webp|heic|heif)")) return true;
        return (type.isEmpty() || "application/octet-stream".equals(type)) && name != null
            && name.toLowerCase(Locale.ROOT).matches(".*\\.(jpg|jpeg|png|webp|heic|heif)$");
    }
}
