package com.guanyun.weather;

import android.content.Context;
import android.net.Uri;
import android.net.http.HttpResponseCache;
import android.webkit.WebResourceResponse;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

/** Handles only this APK's asset origin and fixed data endpoints. No arbitrary proxy URL. */
final class LocalGateway {
    static final String HOST = "appassets.androidplatform.net";
    private static final Pattern TERRAIN = Pattern.compile("^/api/terrain/(\\d{1,2})/(\\d{1,6})/(\\d{1,6})\\.png$");
    private static final Pattern GEOLOGY = Pattern.compile("^/api/geology/tiles/(\\d)/(\\d{1,3})/(\\d{1,3})$");
    private final Context context;
    private final JSONObject coverage;
    private String satelliteDate;
    private long satelliteCachedAt;

    LocalGateway(Context context) {
        this.context = context;
        JSONObject found;
        try (InputStream stream = context.getAssets().open("native/ground-coverage.json")) {
            found = new JSONObject(new String(DataTransport.readLimited(stream, 16384), StandardCharsets.UTF_8));
        } catch (Exception error) { throw new IllegalStateException("Bundled terrain coverage missing", error); }
        coverage = found;
        try { if (HttpResponseCache.getInstalled() == null) HttpResponseCache.install(new File(context.getCacheDir(), "map-http"), 64L * 1024 * 1024); }
        catch (Exception ignored) { }
    }

    WebResourceResponse intercept(Uri uri, String method) {
        if (!HOST.equals(uri.getHost())) return null; // Public providers use their normal HTTPS/CORS policy.
        if (!"https".equals(uri.getScheme()) || !"GET".equals(method)) return text(405, "Method not allowed");
        String path = uri.getPath();
        if (path == null || path.length() > 512 || path.contains("..") || path.contains("\\")) return text(400, "Invalid path");
        try {
            Matcher terrain = TERRAIN.matcher(path);
            if (terrain.matches()) return terrain(terrain);
            Matcher geology = GEOLOGY.matcher(path);
            if (geology.matches()) {
                int z = Integer.parseInt(geology.group(1)), x = Integer.parseInt(geology.group(2)), y = Integer.parseInt(geology.group(3));
                if (!DataTransport.validTile(z, x, y, 5)) return text(400, "Invalid geology tile");
                return binary(DataTransport.get("https://tiles.macrostrat.org/carto/" + z + "/" + x + "/" + y + ".mvt", 4 * 1024 * 1024), "application/vnd.mapbox-vector-tile");
            }
            if ("/api/satellite".equals(path)) return json(200, "{\"date\":\"" + satelliteDate() + "\"}");
            if ("/api/geology/geocloud".equals(path)) return json(503, "{\"message\":\"安卓测试版尚未配置地质云授权服务；可切换世界概览。\"}");
            if (path.startsWith("/api/")) return text(404, "Unknown endpoint");
            String asset = path.equals("/") ? "index.html" : path.substring(1);
            return response(200, mime(asset), context.getAssets().open(asset), "no-cache");
        } catch (java.io.FileNotFoundException error) {
            return text(404, "Asset not found");
        } catch (Exception error) {
            return json(502, "{\"message\":\"数据暂时无法连接，请检查网络后重试\"}");
        }
    }

    private WebResourceResponse terrain(Matcher tile) throws Exception {
        int z = Integer.parseInt(tile.group(1)), x = Integer.parseInt(tile.group(2)), y = Integer.parseInt(tile.group(3));
        if (!DataTransport.validTile(z, x, y, 14)) return text(400, "Invalid terrain tile");
        JSONArray range = coverage.optJSONArray(Integer.toString(z));
        boolean local = range != null && x >= range.getInt(0) && x <= range.getInt(1) && y >= range.getInt(2) && y <= range.getInt(3);
        if (local) return response(200, "image/png", context.getAssets().open("terrain/fabdem-v1-2/" + z + "/" + x + "/" + y + ".png"), "public, max-age=86400");
        return binary(DataTransport.get("https://elevation-tiles-prod.s3.amazonaws.com/terrarium/" + z + "/" + x + "/" + y + ".png", 4 * 1024 * 1024), "image/png");
    }

    private synchronized String satelliteDate() throws Exception {
        long now = System.currentTimeMillis();
        if (satelliteDate != null && now - satelliteCachedAt < 30 * 60_000) return satelliteDate;
        String xml = new String(DataTransport.get("https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml", 16 * 1024 * 1024), StandardCharsets.UTF_8);
        satelliteDate = DataTransport.parseSatelliteDate(xml);
        satelliteCachedAt = now;
        return satelliteDate;
    }

    private static WebResourceResponse binary(byte[] bytes, String mime) { return response(200, mime, new ByteArrayInputStream(bytes), "public, max-age=86400"); }
    private static WebResourceResponse text(int status, String text) { return response(status, "text/plain", new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8)), "no-store"); }
    private static WebResourceResponse json(int status, String text) { return response(status, "application/json", new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8)), "no-store"); }
    private static WebResourceResponse response(int status, String mime, InputStream data, String cache) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", cache);
        headers.put("X-Content-Type-Options", "nosniff");
        return new WebResourceResponse(mime, mime.startsWith("text/") || mime.equals("application/json") ? "UTF-8" : null, status, status == 200 ? "OK" : "Unavailable", headers, data);
    }
    private static String mime(String name) {
        if (name.endsWith(".html")) return "text/html";
        if (name.endsWith(".js") || name.endsWith(".mjs")) return "text/javascript";
        if (name.endsWith(".css")) return "text/css";
        if (name.endsWith(".json")) return "application/json";
        if (name.endsWith(".png")) return "image/png";
        if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
        if (name.endsWith(".svg")) return "image/svg+xml";
        if (name.endsWith(".woff2")) return "font/woff2";
        if (name.endsWith(".wasm")) return "application/wasm";
        return "application/octet-stream";
    }
}
