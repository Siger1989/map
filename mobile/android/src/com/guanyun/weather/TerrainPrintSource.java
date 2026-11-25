package com.guanyun.weather;

import android.net.Uri;
import android.webkit.WebResourceResponse;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class TerrainPrintSource {
    static final String PATH = "/api/terrain-print-source";
    private static final String CATALOG = "https://cmr.earthdata.nasa.gov/search/granules.json?";
    private static final String FILE_SERVER = "https://data.nsidc.earthdatacloud.nasa.gov";
    private static final Pattern FILE = Pattern.compile(
        "^/nsidc-cumulus-prod-protected/HMA/HMA_DEM8m_MOS/1/[0-9]{4}/[0-9]{2}/[0-9]{2}/HMA_DEM8m_MOS_[0-9]{8}_tile-[0-9]{3}\\.tif$");
    private static final Pattern RANGE = Pattern.compile("^bytes=([0-9]{1,10})-([0-9]{1,10})$");
    private static final int MAX_RANGE = 16 * 1024 * 1024;

    static WebResourceResponse fetch(Uri request, Map<String, String> headers) {
        String query = request.getQueryParameter("catalog");
        String path = request.getQueryParameter("file");
        boolean catalog = query != null && path == null;
        String upstream;
        String range = null;
        String authorization = null;
        if (catalog) {
            if (query.length() > 460 || !query.matches("[a-zA-Z0-9._%+,=&-]+") ||
                !query.matches("collection_concept_id=C3249536691-NSIDC_CPRD&bounding_box=[0-9.%-]+(?:%2C[0-9.%-]+){3}&page_size=9")) {
                return respond(400, "text/plain", null, null);
            }
            upstream = CATALOG + query;
        } else {
            if (path == null || query != null || !FILE.matcher(path).matches()) {
                return respond(400, "text/plain", null, null);
            }
            Matcher bytes = RANGE.matcher(header(headers, "Range"));
            if (!bytes.matches()) return respond(416, "text/plain", null, null);
            long start = Long.parseLong(bytes.group(1)), end = Long.parseLong(bytes.group(2));
            if (start > end || end - start >= MAX_RANGE) return respond(416, "text/plain", null, null);
            range = bytes.group();
            authorization = header(headers, "Authorization");
            if (authorization.length() > 4096 || !authorization.matches("Bearer [A-Za-z0-9._~-]+")) {
                return respond(401, "text/plain", null, null);
            }
            upstream = FILE_SERVER + path;
        }

        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(upstream).openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setUseCaches(false);
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(25000);
            connection.setRequestProperty("Accept-Encoding", "identity");
            if (!catalog) {
                connection.setRequestProperty("Range", range);
                connection.setRequestProperty("Authorization", authorization);
            }
            int status = connection.getResponseCode();
            if (!catalog && (status == 401 || status == 403 || status == 301 || status == 302 || status == 303 || status == 307 || status == 308)) {
                return respond(401, "text/plain", null, null);
            }
            if (status == 429) return respond(429, "text/plain", null, null);
            if (status != (catalog ? 200 : 206)) return respond(502, "text/plain", null, null);
            String contentRange = catalog ? null : connection.getHeaderField("Content-Range");
            if (!catalog && (contentRange == null || !contentRange.matches("bytes [0-9]+-[0-9]+/[0-9]+"))) {
                return respond(502, "text/plain", null, null);
            }
            try (InputStream stream = connection.getInputStream()) {
                byte[] body = DataTransport.readLimited(stream, catalog ? 1024 * 1024 : MAX_RANGE);
                return respond(status, catalog ? "application/json" : "image/tiff", body, contentRange);
            }
        } catch (Exception error) {
            return respond(502, "text/plain", null, null);
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static String header(Map<String, String> headers, String name) {
        for (Map.Entry<String, String> entry : headers.entrySet()) {
            if (name.equalsIgnoreCase(entry.getKey()) && entry.getValue() != null) return entry.getValue();
        }
        return "";
    }

    private static WebResourceResponse respond(int status, String mime, byte[] body, String contentRange) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        headers.put("X-Content-Type-Options", "nosniff");
        if (contentRange != null) {
            headers.put("Content-Range", contentRange);
            headers.put("Content-Length", String.valueOf(body.length));
        }
        return new WebResourceResponse(mime, mime.equals("application/json") ? "UTF-8" : null, status,
            status == 200 ? "OK" : status == 206 ? "Partial Content" : "Unavailable", headers,
            new ByteArrayInputStream(body == null ? new byte[0] : body));
    }

    private TerrainPrintSource() {}
}
