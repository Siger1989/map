package com.guanyun.weather;

import android.content.Intent;
import android.net.Uri;
import org.json.JSONObject;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.Future;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

/** Volatile receiver for narrowly recognized place links; never persists or creates a marker. */
final class IncomingPlaces {
    private static final int LIMIT = 8192;
    private static final Pattern GEO_TEXT = Pattern.compile("(?i)\\bgeo:");
    private static final Pattern TENCENT_MARKER_TEXT = Pattern.compile("(?i)https://apis\\.map\\.qq\\.com/uri/v1/marker(?:[?#\\s]|$)");
    interface Notifier { void notifyIncomingPlace(); }

    private final Notifier notifier;
    private final GooglePlaceLinkResolver resolver;
    private final ThreadPoolExecutor executor;
    private Future<?> resolving;
    private String token = "", raw = "", reason = "", state = "empty", title = "";
    private boolean retryable, closed;

    IncomingPlaces(MainActivity activity) { this(activity::notifyIncomingPlace, new GooglePlaceLinkResolver()); }

    IncomingPlaces(Notifier notifier, GooglePlaceLinkResolver resolver) {
        this.notifier = notifier;
        this.resolver = resolver;
        this.executor = new ThreadPoolExecutor(1, 1, 0L, TimeUnit.MILLISECONDS,
            new ArrayBlockingQueue<>(1), task -> { Thread thread = new Thread(task, "shantu-google-place-resolver"); thread.setDaemon(true); return thread; },
            new ThreadPoolExecutor.AbortPolicy());
    }

    /** Returns true only for supported place content, preserving file imports otherwise. */
    boolean accept(Intent intent) {
        if (intent == null) return false;
        String action = intent.getAction();
        String candidate = null;
        String unsupportedReason = null;
        String candidateTitle = "";
        boolean google = false;
        if (Intent.ACTION_VIEW.equals(action)) {
            Uri uri = intent.getData();
            if (uri == null) return false;
            if ("geo".equalsIgnoreCase(uri.getScheme()) || isTencentMarker(uri)) candidate = intent.getDataString();
            else if (GooglePlaceLinkResolver.isGoogleMapsUrl(intent.getDataString())) {
                candidate = intent.getDataString(); google = true;
            } else return false;
        } else if (Intent.ACTION_SEND.equals(action)) {
            CharSequence text;
            try { text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT); }
            catch (RuntimeException malformed) { return false; }
            String mime = intent.getType();
            String textValue = text == null ? "" : text.toString();
            String googleUrl = GooglePlaceLinkResolver.extractGoogleMapsUrl(textValue);
            boolean placeText = googleUrl != null || looksLikeSupportedPlace(textValue);
            boolean placeGoogle = googleUrl != null;
            boolean plainText = mime == null || "text/plain".equalsIgnoreCase(mime);
            // Text shares can attach ClipData solely for the Sharesheet's
            // thumbnail. An explicit stream still belongs to file import.
            boolean hasFile = hasDocumentUri(intent)
                && !(placeGoogle && plainText && !hasExplicitStream(intent));
            if (placeText && (!placeGoogle || plainText) && !(placeGoogle && hasFile) && (plainText || !hasFile)) {
                candidate = !placeGoogle ? textValue : googleUrl;
                google = placeGoogle;
                if (google) candidateTitle = sharedTitle(intent, textValue, googleUrl);
            } else {
                if (mime != null && mime.toLowerCase(java.util.Locale.ROOT).startsWith("image/")) {
                    candidate = "";
                    unsupportedReason = "暂不支持从图片识别地点。请分享带坐标的 geo 位置或地图地点链接。";
                } else if (hasDocumentUri(intent)) {
                    return false;
                } else if (text != null && text.length() > 0 && (mime == null || "text/plain".equalsIgnoreCase(mime))) {
                    candidate = "";
                    unsupportedReason = "无法从此分享确认地点，请分享 Google 地图中的单个地点，或带坐标的位置链接。";
                } else return false;
            }
        } else return false;

        final String id;
        final boolean resolveShort;
        synchronized (this) {
            if (closed) return false;
            cancelResolutionLocked();
            token = id = UUID.randomUUID().toString();
            title = candidateTitle;
            raw = candidate.length() <= LIMIT ? candidate : "";
            reason = "";
            retryable = false;
            if (candidate.length() > LIMIT) {
                reason = "分享内容超过安全读取长度，无法处理。";
                state = "unsupported";
            } else if (unsupportedReason != null) {
                reason = unsupportedReason;
                state = "unsupported";
            } else if (google && isShortGoogleUrl(candidate)) {
                raw = "";
                state = "resolving";
                retryUrl = candidate;
            } else {
                state = "received";
            }
            resolveShort = "resolving".equals(state);
        }
        if (resolveShort) scheduleResolve(id, candidate);
        notifier.notifyIncomingPlace();
        return true;
    }

    private void scheduleResolve(String id, String url) {
        synchronized (this) {
            if (closed || !id.equals(token) || !"resolving".equals(state)) return;
            try {
                resolving = executor.submit(() -> {
                    GooglePlaceLinkResolver.Result result = resolver.resolve(url);
                    synchronized (IncomingPlaces.this) {
                        if (closed || !id.equals(token) || !"resolving".equals(state)) return;
                        if (result.success) { raw = result.url; state = "received"; reason = ""; retryable = false; }
                        else { raw = ""; state = "failed"; reason = result.reason; retryable = result.retryable; }
                        resolving = null;
                    }
                    notifier.notifyIncomingPlace();
                });
            } catch (RuntimeException saturated) {
                state = "failed"; reason = "地点链接处理中，请稍后重试。"; retryable = true; resolving = null;
                notifier.notifyIncomingPlace();
            }
        }
    }

    private static boolean isShortGoogleUrl(String value) {
        Uri uri = Uri.parse(value);
        String host = uri.getHost();
        return "maps.app.goo.gl".equalsIgnoreCase(host) || "goo.gl".equalsIgnoreCase(host);
    }

    private static String sharedTitle(Intent intent, String text, String url) {
        String subject = "";
        try {
            CharSequence value = intent.getCharSequenceExtra(Intent.EXTRA_SUBJECT);
            if (value != null) subject = cleanTitle(value.toString());
        } catch (RuntimeException ignored) { }
        if (isUsefulTitle(subject)) return subject;
        try {
            CharSequence value = intent.getCharSequenceExtra(Intent.EXTRA_TITLE);
            String previewTitle = value == null ? "" : cleanTitle(value.toString());
            if (isUsefulTitle(previewTitle)) return previewTitle;
        } catch (RuntimeException ignored) { }
        int at = text.indexOf(url);
        if (at >= 0) {
            String prefix = cleanTitle(text.substring(0, at));
            if (isUsefulTitle(prefix)) {
                int line = prefix.indexOf('\n');
                if (line >= 0) prefix = cleanTitle(prefix.substring(0, line));
                if (isUsefulTitle(prefix)) return prefix;
            }
        }
        return "";
    }

    private static String cleanTitle(String value) {
        if (value == null) return "";
        String cleaned = value.replaceAll("[\\r\\n\\u0000-\\u001f\\u007f]", " ").trim().replaceAll("\\s+", " ");
        return cleaned.length() > 120 ? cleaned.substring(0, 120).trim() : cleaned;
    }

    private static boolean isUsefulTitle(String value) {
        if (value == null || value.isEmpty()) return false;
        String normalized = value.toLowerCase(java.util.Locale.ROOT).replaceAll("[\\s·•_-]+", "");
        return !java.util.Arrays.asList("googlemaps", "googlemap", "maps", "谷歌地图", "google地点", "谷歌地点", "分享google地点", "分享谷歌地点", "分享google地图", "分享谷歌地图").contains(normalized);
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

    private static boolean hasExplicitStream(Intent intent) {
        try { return intent.getParcelableExtra(Intent.EXTRA_STREAM) != null; }
        catch (RuntimeException malformed) { return true; }
    }

    synchronized String info() {
        try {
            return new JSONObject().put("token", token).put("raw", raw).put("state", state).put("reason", reason)
                .put("title", title).put("retryable", retryable).toString();
        } catch (Exception ignored) { return "{}"; }
    }

    synchronized boolean hasPending() { return !closed && !token.isEmpty(); }

    boolean retry(String id) {
        final String url;
        synchronized (this) {
            if (closed || id == null || id.length() > 64 || !token.equals(id) || !retryable || !"failed".equals(state)) return false;
            url = retryUrl;
            if (url == null || url.isEmpty()) return false;
            state = "resolving"; raw = ""; reason = ""; retryable = false;
        }
        scheduleResolve(id, url);
        notifier.notifyIncomingPlace();
        return true;
    }

    private String retryUrl = "";

    private void cancelResolutionLocked() {
        if (resolving != null) resolving.cancel(true);
        resolving = null;
        executor.getQueue().clear();
        retryUrl = "";
    }

    synchronized void dismiss(String id) {
        if (token.equals(id)) {
            cancelResolutionLocked(); token = ""; raw = ""; reason = ""; title = ""; state = "empty"; retryable = false;
        }
    }

    synchronized void close() {
        closed = true; cancelResolutionLocked(); executor.shutdownNow();
        token = ""; raw = ""; reason = ""; title = ""; state = "empty"; retryable = false;
    }
}
