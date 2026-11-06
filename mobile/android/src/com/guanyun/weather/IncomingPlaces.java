package com.guanyun.weather;

import android.content.Intent;
import android.net.Uri;
import org.json.JSONObject;
import java.util.UUID;
import java.util.regex.Pattern;

/** Volatile receiver for narrowly recognized, coordinate-bearing place shares. */
final class IncomingPlaces {
    private static final int LIMIT = 8192;
    private static final Pattern GEO_TEXT = Pattern.compile("(?i)\\bgeo:");
    private static final Pattern TENCENT_MARKER_TEXT = Pattern.compile("(?i)https://apis\\.map\\.qq\\.com/uri/v1/marker(?:[?#\\s]|$)");
    private final MainActivity activity;
    private String token = "", raw = "", reason = "";
    private boolean closed;

    IncomingPlaces(MainActivity activity) { this.activity = activity; }

    /** Returns true only for geo: or Tencent's documented marker URI, preserving file imports otherwise. */
    boolean accept(Intent intent) {
        if (intent == null) return false;
        String action = intent.getAction();
        String candidate = null;
        String unsupportedReason = null;
        if (Intent.ACTION_VIEW.equals(action)) {
            Uri uri = intent.getData();
            if (uri == null) return false;
            if ("geo".equalsIgnoreCase(uri.getScheme()) || isTencentMarker(uri)) candidate = intent.getDataString();
            else return false;
        } else if (Intent.ACTION_SEND.equals(action)) {
            CharSequence text;
            try { text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT); }
            catch (RuntimeException malformed) { return false; }
            String mime = intent.getType();
            boolean placeText = text != null && looksLikeSupportedPlace(text.toString());
            boolean plainText = mime == null || "text/plain".equalsIgnoreCase(mime);
            if (placeText && (plainText || !hasDocumentUri(intent))) {
                candidate = text.toString();
            } else {
                if (mime != null && mime.toLowerCase(java.util.Locale.ROOT).startsWith("image/")) {
                    candidate = "";
                    unsupportedReason = "暂不支持从图片识别地点。请分享带坐标的 geo 位置或腾讯地图地点标注链接。";
                } else if (hasDocumentUri(intent)) {
                    return false;
                } else if (text != null && text.length() > 0 && (mime == null || "text/plain".equalsIgnoreCase(mime))) {
                    candidate = "";
                    unsupportedReason = "分享内容只有名称或文本，没有可确认的坐标；请分享地点坐标链接。";
                } else return false;
            }
        } else return false;

        synchronized (this) {
            if (closed) return false;
            token = UUID.randomUUID().toString();
            raw = candidate.length() <= LIMIT ? candidate : "";
            if (candidate.length() > LIMIT) reason = "分享内容超过安全读取长度，无法处理。";
            else reason = unsupportedReason == null ? "" : unsupportedReason;
        }
        activity.notifyIncomingPlace();
        return true;
    }

    private static boolean isTencentMarker(Uri uri) {
        return "https".equalsIgnoreCase(uri.getScheme())
            && "apis.map.qq.com".equalsIgnoreCase(uri.getHost())
            && "/uri/v1/marker".equals(uri.getPath())
            && uri.getUserInfo() == null;
    }

    private static boolean looksLikeSupportedPlace(String text) {
        if (text == null) return false;
        String bounded = text.length() > LIMIT ? text.substring(0, LIMIT) : text;
        return GEO_TEXT.matcher(bounded).find() || TENCENT_MARKER_TEXT.matcher(bounded).find();
    }

    private static boolean hasDocumentUri(Intent intent) {
        try {
            Uri stream = (Uri) intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (stream != null && "content".equalsIgnoreCase(stream.getScheme())) return true;
            if (intent.getClipData() != null) {
                for (int i = 0; i < intent.getClipData().getItemCount(); i++) {
                    Uri item = intent.getClipData().getItemAt(i).getUri();
                    if (item != null && "content".equalsIgnoreCase(item.getScheme())) return true;
                }
            }
        } catch (RuntimeException ignored) { return true; }
        return false;
    }

    synchronized String info() {
        try {
            String state = token.isEmpty() ? "empty" : (raw.isEmpty() ? "unsupported" : "received");
            return new JSONObject().put("token", token).put("raw", raw).put("state", state).put("reason", reason).toString();
        } catch (Exception ignored) { return "{}"; }
    }

    synchronized boolean hasPending() { return !closed && !token.isEmpty(); }

    synchronized void dismiss(String id) {
        if (token.equals(id)) { token = ""; raw = ""; reason = ""; }
    }

    synchronized void close() { closed = true; token = ""; raw = ""; reason = ""; }
}
