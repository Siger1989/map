package com.guanyun.weather;

import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.Locale;
import java.util.UUID;

/** Receives only explicitly opened content documents. Never navigates the WebView to an external URI. */
final class IncomingRoutes {
    private static final int LIMIT = 8 * 1024 * 1024, CHUNK = 48 * 1024;
    private final MainActivity activity;
    private String token = "", name = "", state = "", error = "";
    private byte[] bytes;
    private boolean closed;
    IncomingRoutes(MainActivity activity) { this.activity = activity; }
    void accept(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (!Intent.ACTION_VIEW.equals(action) && !Intent.ACTION_SEND.equals(action)) return;
        Uri uri;
        try {
            uri = Intent.ACTION_VIEW.equals(action) ? intent.getData() : (Uri) intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (uri == null && intent.getClipData() != null && intent.getClipData().getItemCount() == 1)
                uri = intent.getClipData().getItemAt(0).getUri();
        } catch (Exception e) { toast("无法读取分享文件，请先保存到本机，再从路线导入"); return; }
        if (uri == null || !"content".equals(uri.getScheme())) { toast("请打开路线文件，或保存到本机后从路线导入"); return; }
        final String id;
        synchronized (this) {
            if (closed) return;
            if (!token.isEmpty()) { toast("请先确认或关闭已收到的路线文件"); return; }
            token = id = UUID.randomUUID().toString(); state = "loading"; name = ""; error = "";
        }
        activity.notifyIncomingRoute();
        final Uri document = uri;
        Thread thread = new Thread(() -> {
            try {
                String filename = "";
                try (Cursor cursor = activity.getContentResolver().query(document, new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE}, null, null, null)) {
                    if (cursor != null && cursor.moveToFirst()) {
                        int ni = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME), si = cursor.getColumnIndex(OpenableColumns.SIZE);
                        if (ni >= 0) filename = cursor.getString(ni);
                        if (si >= 0 && !cursor.isNull(si) && cursor.getLong(si) > LIMIT) throw new Exception("文件超过 8 MB，请先拆分");
                    }
                }
                if (filename == null || filename.trim().isEmpty()) filename = document.getLastPathSegment();
                if (filename == null) filename = "";
                filename = filename.replaceAll("[\\\\/\\r\\n]", "_");
                if (!filename.toLowerCase(Locale.ROOT).matches(".*\\.(gpx|kml|kmz|ovkml|ovkmz|json|geojson|tcx|fit|csv|tsv|ovjsn|ovobj)$")) {
                    String mime = activity.getContentResolver().getType(document);
                    if ("application/gpx+xml".equals(mime)) filename = "路线.gpx";
                    else if ("application/vnd.google-earth.kml+xml".equals(mime)) filename = "路线.kml";
                    else if ("application/vnd.google-earth.kmz".equals(mime)) filename = "路线.kmz";
                    else if ("application/json".equals(mime)) filename = "路线.json";
                    else if ("application/geo+json".equals(mime)) filename = "路线.geojson";
                    else if ("text/csv".equals(mime)) filename = "路线.csv";
                    else if ("text/tab-separated-values".equals(mime)) filename = "路线.tsv";
                    else if ("application/vnd.garmin.tcx+xml".equals(mime)) filename = "路线.tcx";
                    else if ("application/vnd.ant.fit".equals(mime)) filename = "路线.fit";
                    else throw new Exception("请选择带格式后缀的路线文件（如 GPX、KML、OVOBJ、FIT）；ZIP 请先解压");
                }
                if (filename.length() > 180) filename = filename.substring(filename.length()-180);
                byte[] data;
                try (InputStream input = activity.getContentResolver().openInputStream(document); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    if (input == null) throw new Exception("无法读取文件，请保存到本机后重试");
                    byte[] buffer = new byte[16384]; int count;
                    while ((count = input.read(buffer)) != -1) {
                        synchronized (this) { if (closed || !id.equals(token)) return; }
                        if (output.size() + count > LIMIT) throw new Exception("文件超过 8 MB，请先拆分");
                        output.write(buffer, 0, count);
                    }
                    data = output.toByteArray();
                }
                if (data.length == 0) throw new Exception("路线文件为空");
                synchronized (this) { if (closed || !id.equals(token)) return; bytes = data; name = filename; state = "ready"; }
            } catch (Exception e) {
                synchronized (this) {
                    if (closed || !id.equals(token)) return;
                    state = "error"; error = e instanceof SecurityException ? "微信未授予读取权限，请保存到本机后从路线导入" :
                        e.getMessage() != null && !e.getMessage().contains("://") ? e.getMessage() : "文件读取失败，请保存到本机后重试";
                }
            }
            activity.notifyIncomingRoute();
        }, "shantu-incoming-route");
        thread.setDaemon(true); thread.start();
    }
    synchronized String info() {
        try { return new JSONObject().put("token", token).put("name", name).put("state", state).put("error", error).put("size", bytes == null ? 0 : bytes.length).toString(); }
        catch (Exception e) { return "{}"; }
    }
    synchronized String chunk(String id, int offset) {
        if (!token.equals(id) || bytes == null || offset < 0 || offset >= bytes.length) return "";
        return Base64.encodeToString(bytes, offset, Math.min(CHUNK, bytes.length-offset), Base64.NO_WRAP);
    }
    synchronized void dismiss(String id) { if (token.equals(id)) { token = ""; bytes = null; name = ""; state = ""; error = ""; } }
    synchronized void close() { closed = true; bytes = null; token = ""; }
    private void toast(String message) { activity.runOnUiThread(() -> android.widget.Toast.makeText(activity, message, android.widget.Toast.LENGTH_LONG).show()); }
}
