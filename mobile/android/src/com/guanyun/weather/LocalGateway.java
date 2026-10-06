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
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import org.json.JSONArray;
import org.json.JSONObject;

/** Handles only this APK's asset origin and fixed data endpoints. No arbitrary proxy URL. */
final class LocalGateway {
    static final String HOST = "appassets.androidplatform.net";
    private static final Pattern TERRAIN = Pattern.compile("^/api/terrain/(\\d{1,2})/(\\d{1,6})/(\\d{1,6})\\.png$");
    private static final Pattern GEOLOGY = Pattern.compile("^/api/geology/tiles/(\\d)/(\\d{1,3})/(\\d{1,3})$");
    private static final Pattern RADAR_DATE = Pattern.compile("^\\d{8}$");
    private static final Pattern RADAR_ID = Pattern.compile("^[A-Za-z0-9_-]{1,80}$");
    private final Context context;
    private final JSONObject coverage;
    private final JSONObject repairs;
    private final Map<String, RadarCache> radarDirectories = new HashMap<>();
    private String satelliteDate;
    private long satelliteCachedAt;

    LocalGateway(Context context) {
        this.context = context;
        JSONObject found;
        try (InputStream stream = context.getAssets().open("native/ground-coverage.json")) {
            found = new JSONObject(new String(DataTransport.readLimited(stream, 16384), StandardCharsets.UTF_8));
        } catch (Exception error) { throw new IllegalStateException("Bundled terrain coverage missing", error); }
        coverage = found;
        try (InputStream stream = context.getAssets().open("terrain/repairs-v1/coverage.json")) {
            repairs = new JSONObject(new String(DataTransport.readLimited(stream, 16384), StandardCharsets.UTF_8));
        } catch (Exception error) { throw new IllegalStateException("Bundled terrain repairs missing", error); }
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
            if ("/api/map-tile".equals(path)) {
                String source = uri.getQueryParameter("url");
                if (source == null || source.isEmpty()) return text(400, "Missing tile URL");
                String requestId = uri.getQueryParameter("requestId");
                try {
                    MapTileProxy.Tile tile = MapTileProxy.fetch(source, requestId);
                    return response(200, tile.mime, new ByteArrayInputStream(tile.bytes), "private, max-age=300");
                } catch (MapTileProxy.TileException error) {
                    return tileError(error);
                } catch (Exception error) {
                    return text(502, "Map tile unavailable");
                }
            }
            if ("/api/satellite".equals(path)) return json(200, "{\"date\":\"" + satelliteDate() + "\"}");
            if ("/api/radar".equals(path)) return radar(uri);
            if ("/api/location/ip".equals(path)) {
                JSONObject estimate = new JSONObject(new String(DataTransport.get("https://ipwho.is/", 16384), StandardCharsets.UTF_8));
                double longitude = estimate.optDouble("longitude", Double.NaN), latitude = estimate.optDouble("latitude", Double.NaN);
                if (!estimate.optBoolean("success") || !Double.isFinite(longitude) || !Double.isFinite(latitude) || Math.abs(longitude) > 180 || Math.abs(latitude) > 90)
                    return json(502, "{\"error\":\"IP定位结果无效，请重试\"}");
                JSONObject fix = new JSONObject().put("coordinates", new JSONArray().put(longitude).put(latitude))
                    .put("accuracy", 50000).put("timestamp", System.currentTimeMillis()).put("source", "network").put("provider", "ip");
                return json(200, fix.toString());
            }
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
        JSONArray corrected = repairs.optJSONArray(Integer.toString(z));
        if (corrected != null) for (int i = 0; i < corrected.length(); i++) {
            if ((x + "/" + y).equals(corrected.getString(i)))
                return response(200, "image/png", context.getAssets().open("terrain/repairs-v1/" + z + "/" + x + "/" + y + ".png"), "public, max-age=86400");
        }
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

    private WebResourceResponse radar(Uri uri) {
        try {
            for (String key : uri.getQueryParameterNames()) {
                if (!"date".equals(key) && !"frame".equals(key)) return json(400, "{\"error\":\"雷达请求参数无效\"}");
                if (uri.getQueryParameters(key).size() != 1) return json(400, "{\"error\":\"雷达请求参数无效\"}");
            }
            String suppliedDate = uri.getQueryParameter("date"), frame = uri.getQueryParameter("frame");
            if (suppliedDate != null && (suppliedDate.isEmpty() || !RADAR_DATE.matcher(suppliedDate).matches())) return json(400, "{\"error\":\"雷达日期格式无效\"}");
            if (suppliedDate != null) {
                try { LocalDate.parse(suppliedDate, DateTimeFormatter.ofPattern("uuuuMMdd").withResolverStyle(java.time.format.ResolverStyle.STRICT)); }
                catch (Exception invalid) { return json(400, "{\"error\":\"雷达日期格式无效\"}"); }
            }
            if (frame != null && (frame.isEmpty() || !RADAR_ID.matcher(frame).matches())) return json(400, "{\"error\":\"雷达帧标识无效\"}");
            LocalDate todayDate = LocalDate.now(ZoneId.of("Asia/Shanghai"));
            String today = todayDate.format(DateTimeFormatter.BASIC_ISO_DATE);
            String date = suppliedDate == null ? today : suppliedDate;
            if (date.compareTo(today) > 0) return json(400, "{\"error\":\"不能请求未来日期的雷达数据\"}");
            JSONArray rows = radarRows(date);
            if (frame != null) {
                JSONObject row = findRadarRow(rows, frame, date);
                if (row == null) return json(404, "{\"error\":\"指定雷达时次不存在\"}");
                String secureImageUrl = row.getString("fileURL").replaceFirst("^http:", "https:");
                byte[] image = DataTransport.getRadarImage(secureImageUrl, 12 * 1024 * 1024);
                byte[] signature = new byte[] {(byte)137,80,78,71,13,10,26,10};
                if (image.length < signature.length) return json(502, "{\"error\":\"国家气象数据网返回的文件不是PNG图片\"}");
                for (int i = 0; i < signature.length; i++) if (image[i] != signature[i]) return json(502, "{\"error\":\"国家气象数据网返回的文件不是PNG图片\"}");
                return response(200, "image/png", new ByteArrayInputStream(image), "public, max-age=120");
            }
            if (suppliedDate == null && rows.length() == 0) {
                date = todayDate.minusDays(1).format(DateTimeFormatter.BASIC_ISO_DATE);
                rows = radarRows(date);
            }
            java.util.List<JSONObject> sorted = new java.util.ArrayList<>();
            for (int i = 0; i < rows.length(); i++) {
                JSONObject row = rows.optJSONObject(i);
                if (row != null && radarObservedAt(row, date) != null) sorted.add(row);
            }
            sorted.sort((a, b) -> b.optString("vshijian").compareTo(a.optString("vshijian")));
            JSONArray frames = new JSONArray();
            String latestAt = null;
            for (JSONObject row : sorted) {
                String observedAt = radarObservedAt(row, date), id = row.optString("id");
                if (observedAt == null || !RADAR_ID.matcher(id).matches()) continue;
                frames.put(new JSONObject().put("id", id).put("observedAt", observedAt)
                    .put("imagePath", "/api/radar?date=" + date + "&frame=" + Uri.encode(id)));
                if (latestAt == null) latestAt = observedAt;
            }
            JSONObject result = new JSONObject().put("frames", frames).put("latestAt", latestAt == null ? JSONObject.NULL : latestAt)
                .put("source", "国家气象数据网").put("product", "全国雷达拼图 · 组合反射率").put("unit", "dBZ");
            return response(200, "application/json", new ByteArrayInputStream(result.toString().getBytes(StandardCharsets.UTF_8)), "public, max-age=15");
        } catch (Exception error) { return json(502, "{\"error\":\"国家气象数据网雷达数据暂不可用\"}"); }
    }

    private synchronized JSONArray radarRows(String date) throws Exception {
        long now = System.currentTimeMillis();
        java.util.Iterator<Map.Entry<String, RadarCache>> iterator = radarDirectories.entrySet().iterator();
        while (iterator.hasNext()) if (now - iterator.next().getValue().cachedAt >= 30_000) iterator.remove();
        RadarCache cached = radarDirectories.get(date);
        if (cached != null && now - cached.cachedAt < 30_000) return new JSONArray(cached.rows.toString());
        String endpoint = "https://data.cma.cn/api/vis/getVasData?datacode=RAD__B0_CR&dDatetime=" + date;
        byte[] bytes = DataTransport.get(endpoint, 8 * 1024 * 1024);
        JSONObject root = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
        if (root.optInt("code") != 200) throw new java.io.IOException("Radar directory unavailable");
        JSONObject data = root.optJSONObject("data");
        JSONArray rows = data == null ? null : data.optJSONArray("data");
        if (rows == null) throw new java.io.IOException("Radar directory invalid");
        RadarCache entry = new RadarCache(new JSONArray(rows.toString()), now);
        radarDirectories.put(date, entry);
        while (radarDirectories.size() > 2) radarDirectories.remove(radarDirectories.keySet().iterator().next());
        return new JSONArray(entry.rows.toString());
    }

    private static final class RadarCache {
        final JSONArray rows;
        final long cachedAt;
        RadarCache(JSONArray rows, long cachedAt) { this.rows = rows; this.cachedAt = cachedAt; }
    }

    private JSONObject findRadarRow(JSONArray rows, String id, String date) {
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.optJSONObject(i);
            if (row != null && id.equals(row.optString("id")) && radarObservedAt(row, date) != null) return row;
        }
        return null;
    }

    private String radarObservedAt(JSONObject row, String date) {
        String id = row.optString("id"), time = row.optString("vshijian"), code = row.optString("dataCode");
        if (!"RAD__B0_CR".equals(code) || !RADAR_ID.matcher(id).matches() || !time.matches("\\d{14}") || !time.startsWith(date)) return null;
        try {
            LocalDateTime beijing = LocalDateTime.parse(time, DateTimeFormatter.ofPattern("uuuuMMddHHmmss").withResolverStyle(java.time.format.ResolverStyle.STRICT));
            Instant instant = beijing.atZone(ZoneId.of("Asia/Shanghai")).toInstant();
            if (instant.isAfter(Instant.now())) return null;
            String filename = row.optString("cfname");
            java.net.URL url = new java.net.URL(row.optString("fileURL"));
            Matcher path = Pattern.compile("^/vis/RAD__B0_CR/(\\d{8})/([A-Za-z0-9_.-]+\\.png)$").matcher(url.getPath());
            boolean filenameDateMatches = false;
            if (path.matches()) {
                Matcher dates = Pattern.compile("(?:^|_)(\\d{8})(?:_|\\d)").matcher(filename);
                while (dates.find()) if (path.group(1).equals(dates.group(1))) filenameDateMatches = true;
            }
            if (!("http".equals(url.getProtocol()) || "https".equals(url.getProtocol())) || !"image.data.cma.cn".equals(url.getHost()) || url.getPort() != -1 || url.getUserInfo() != null ||
                    url.getQuery() != null || url.getRef() != null || filename.isEmpty() ||
                    !path.matches() || !path.group(2).equals(filename) || !filenameDateMatches) return null;
            return DateTimeFormatter.ISO_INSTANT.format(instant);
        } catch (Exception ignored) { return null; }
    }

    private static WebResourceResponse binary(byte[] bytes, String mime) { return response(200, mime, new ByteArrayInputStream(bytes), "public, max-age=86400"); }
    private static WebResourceResponse text(int status, String text) { return response(status, "text/plain", new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8)), "no-store"); }
    private static WebResourceResponse json(int status, String text) { return response(status, "application/json", new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8)), "no-store"); }
    private static WebResourceResponse tileError(MapTileProxy.TileException error) {
        String code = java.util.Arrays.asList("url", "dns", "blocked", "connect", "tls", "timeout", "upstream_http", "format").contains(error.diagnostic) ? error.diagnostic : "upstream_http";
        String message = error.status == 400 ? "Invalid tile URL" : "Map tile unavailable";
        return response(error.status, "text/plain", new ByteArrayInputStream(message.getBytes(StandardCharsets.UTF_8)), "no-store", code);
    }
    private static WebResourceResponse response(int status, String mime, InputStream data, String cache) {
        return response(status,mime,data,cache,null);
    }
    private static WebResourceResponse response(int status, String mime, InputStream data, String cache, String tileError) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", cache);
        headers.put("X-Content-Type-Options", "nosniff");
        if (tileError != null) headers.put("X-Shantu-Tile-Error", tileError);
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
