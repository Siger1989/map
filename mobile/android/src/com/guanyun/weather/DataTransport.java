package com.guanyun.weather;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Arrays;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.GZIPInputStream;

/** Bounded native requests for the three public providers used by local API routes. */
final class DataTransport {
    private static final String[] HOSTS = { "tiles.macrostrat.org", "elevation-tiles-prod.s3.amazonaws.com", "gibs.earthdata.nasa.gov", "ipwho.is", "data.cma.cn" };
    static byte[] get(String source, int limit) throws IOException {
        URL url = new URL(source);
        if (!"https".equals(url.getProtocol()) || !Arrays.asList(HOSTS).contains(url.getHost()) || url.getUserInfo() != null) throw new IOException("Unsupported provider");
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        boolean ipLocation = "ipwho.is".equals(url.getHost());
        connection.setConnectTimeout(ipLocation ? 5000 : 15000);
        connection.setReadTimeout(ipLocation ? 5000 : 20000);
        if (ipLocation) { connection.setUseCaches(false); connection.setRequestProperty("Cache-Control", "no-cache"); }
        connection.setInstanceFollowRedirects(false);
        connection.setRequestProperty("User-Agent", "Guanyun-Android-Test/0.1");
        connection.setRequestProperty("Accept-Encoding", "gzip");
        try {
            if (connection.getResponseCode() != 200) throw new IOException("Provider unavailable");
            if (connection.getContentLengthLong() > limit) throw new IOException("Response too large");
            try (InputStream original = connection.getInputStream();
                 InputStream stream = "gzip".equalsIgnoreCase(connection.getContentEncoding()) ? new GZIPInputStream(original) : original) {
                return readLimited(stream, limit);
            }
        } finally { connection.disconnect(); }
    }
    static byte[] getRadarImage(String source, int limit) throws IOException {
        URL url = new URL(source);
        if (!"https".equals(url.getProtocol()) || !"image.data.cma.cn".equals(url.getHost()) ||
                url.getPort() != -1 || url.getUserInfo() != null || url.getQuery() != null || url.getRef() != null ||
                !url.getPath().matches("^/vis/RAD__B0_CR/\\d{8}/[A-Za-z0-9_.-]+\\.png$"))
            throw new IOException("Unsupported radar image");
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(30000);
        connection.setInstanceFollowRedirects(false);
        connection.setRequestProperty("User-Agent", "Mozilla/5.0 ShantuWeatherRadar/1.0");
        connection.setRequestProperty("Referer", "https://data.cma.cn/");
        connection.setRequestProperty("Accept", "image/png");
        try {
            if (connection.getResponseCode() != 200) throw new IOException("Radar image unavailable");
            if (connection.getContentLengthLong() > limit) throw new IOException("Response too large");
            try (InputStream stream = connection.getInputStream()) { return readLimited(stream, limit); }
        } finally { connection.disconnect(); }
    }
    static byte[] readLimited(InputStream stream, int limit) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        for (int size; (size = stream.read(chunk)) != -1;) {
            if (size > limit - output.size()) throw new IOException("Response too large");
            output.write(chunk, 0, size);
        }
        return output.toByteArray();
    }
    static boolean validTile(int z, int x, int y, int maxZoom) {
        return z >= 0 && z <= maxZoom && x >= 0 && y >= 0 && x < (1 << z) && y < (1 << z);
    }
    static String parseSatelliteDate(String xml) throws IOException {
        String id = "<ows:Identifier>VIIRS_SNPP_CorrectedReflectance_TrueColor</ows:Identifier>";
        int start = xml.indexOf(id), end = start < 0 ? -1 : xml.indexOf("</Layer>", start);
        if (start < 0 || end < 0) throw new IOException("Satellite layer unavailable");
        Matcher date = Pattern.compile("<Default>(\\d{4}-\\d{2}-\\d{2})</Default>").matcher(xml.substring(start, end));
        if (!date.find()) throw new IOException("Satellite date unavailable");
        return date.group(1);
    }
}
