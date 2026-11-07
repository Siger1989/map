package com.guanyun.weather;

import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Strict Google Maps URL recognition and bounded short-link expansion. */
final class GooglePlaceLinkResolver {
    static final int MAX_URL_LENGTH = 8192;
    static final int MAX_HOPS = 5;
    static final long TOTAL_TIMEOUT_MS = 12_000L;
    static final String NETWORK_HELP = "Google 短链接不含坐标，山兔暂时无法连接 Google。请让山兔可访问 Google 后重试，或改用带坐标的地点链接。";
    private static final int PER_HOP_TIMEOUT_MS = 5_000;
    private static final Pattern LINK_PATTERN = Pattern.compile("(?i)https?://[^\\s<>\"']+");
    private static final Pattern MIXED_PLACE_PATTERN = Pattern.compile("(?i)\\bgeo:|https://apis\\.map\\.qq\\.com/uri/v1/marker(?:[?#\\s]|$)");

    interface Transport {
        Response get(String url, int connectTimeoutMs, int readTimeoutMs) throws Exception;
    }

    static final class Response {
        final int status;
        final String location;
        Response(int status, String location) { this.status = status; this.location = location; }
    }

    static final class Result {
        final boolean success;
        final boolean retryable;
        final String url;
        final String reason;
        private Result(boolean success, boolean retryable, String url, String reason) {
            this.success = success; this.retryable = retryable; this.url = url; this.reason = reason;
        }
        static Result success(String url) { return new Result(true, false, url, ""); }
        static Result failure(String reason) { return new Result(false, false, "", reason); }
        static Result retry(String reason) { return new Result(false, true, "", reason); }
    }

    private final Transport transport;
    GooglePlaceLinkResolver() { this(new HttpTransport()); }
    GooglePlaceLinkResolver(Transport transport) { this.transport = transport; }

    static boolean isGoogleMapsUrl(String value) {
        Parsed parsed = parse(value);
        return parsed != null && (parsed.kind == Kind.SHORT || parsed.kind == Kind.LONG);
    }

    static String extractGoogleMapsUrl(String text) {
        if (text == null || text.length() > MAX_URL_LENGTH) return null;
        if (MIXED_PLACE_PATTERN.matcher(text).find()) return null;
        String found = null;
        Matcher matcher = LINK_PATTERN.matcher(text);
        while (matcher.find()) {
            String candidate = matcher.group();
            candidate = trimSharePunctuation(candidate);
            if (found != null || !isGoogleMapsUrl(candidate)) return null;
            found = candidate;
        }
        return found;
    }

    private static String trimSharePunctuation(String value) {
        String result = value.replaceAll("[.,;:!?，。；]+$", "");
        while (result.endsWith(")")) {
            long opens = result.chars().filter(ch -> ch == '(').count();
            long closes = result.chars().filter(ch -> ch == ')').count();
            if (closes <= opens) break;
            result = result.substring(0, result.length() - 1);
        }
        while (result.endsWith("]") || result.endsWith("}")) result = result.substring(0, result.length() - 1);
        return result;
    }

    Result resolve(String input) {
        Parsed first = parse(input);
        if (first == null) return Result.failure("Google 地点链接格式不受支持。");
        if (first.kind == Kind.LONG) return Result.success(input);
        String current = input;
        long deadline = System.nanoTime() + TOTAL_TIMEOUT_MS * 1_000_000L;
        java.util.HashSet<String> visited = new java.util.HashSet<>();
        visited.add(current);
        for (int hop = 0; hop < MAX_HOPS; hop++) {
            if (Thread.currentThread().isInterrupted()) return Result.failure("地点链接解析已取消。");
            long remainingNanos = deadline - System.nanoTime();
            if (remainingNanos <= 0) return Result.retry(NETWORK_HELP);
            int remainingMs = (int)Math.max(1, Math.min(Integer.MAX_VALUE, remainingNanos / 1_000_000L));
            int perTimeout = Math.max(1, Math.min(PER_HOP_TIMEOUT_MS, remainingMs / 2));
            int connectTimeout = perTimeout;
            int readTimeout = perTimeout;
            final Response response;
            try { response = transport.get(current, connectTimeout, readTimeout); }
            catch (Exception error) {
                if (Thread.currentThread().isInterrupted()) return Result.failure("地点链接解析已取消。");
                return Result.retry(NETWORK_HELP);
            }
            if (Thread.currentThread().isInterrupted()) return Result.failure("地点链接解析已取消。");
            if (System.nanoTime() >= deadline) return Result.retry(NETWORK_HELP);
            if (response.status < 300 || response.status >= 400) {
                if (response.status == 200) return Result.failure("Google 返回了网页而不是地点链接，无法安全确认地点。");
                String message = "Google 地点短链接返回 HTTP " + response.status + "，请重试。";
                return response.status == 429 || response.status >= 500 ? Result.retry(message) : Result.failure(message);
            }
            if (response.location == null || response.location.trim().isEmpty()) return Result.failure("Google 地点短链接缺少跳转地址。");
            final URI resolved;
            try { resolved = URI.create(current).resolve(response.location.trim()); }
            catch (RuntimeException malformed) { return Result.failure("Google 地点短链接包含无效跳转地址。"); }
            String next = resolved.toASCIIString();
            Parsed parsed = parse(next);
            if (parsed == null) return Result.failure("Google 地点短链接跳转到了不受支持的地址。");
            if (!visited.add(next)) return Result.failure("Google 地点短链接发生循环跳转。");
            if (parsed.kind == Kind.LONG) return Result.success(next);
            current = next;
        }
        return Result.failure("Google 地点短链接跳转次数过多。");
    }

    private enum Kind { SHORT, LONG }
    private static final class Parsed { final Kind kind; Parsed(Kind kind) { this.kind = kind; } }

    private static Parsed parse(String raw) {
        if (raw == null || raw.isEmpty() || raw.length() > MAX_URL_LENGTH) return null;
        try {
            URI uri = new URI(raw);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getRawUserInfo() != null) return null;
            int port = uri.getPort();
            if (port != -1 && port != 443) return null;
            String host = uri.getHost();
            if (host == null) return null;
            host = host.toLowerCase(Locale.ROOT);
            String path = uri.getRawPath();
            if (path == null || path.isEmpty()) path = "/";
            if ("maps.app.goo.gl".equals(host)) return new Parsed(Kind.SHORT);
            if ("goo.gl".equals(host)) return path.startsWith("/maps/") ? new Parsed(Kind.SHORT) : null;
            if (("google.com".equals(host) || "www.google.com".equals(host)) && isMapsPath(path)) return new Parsed(Kind.LONG);
            if ("maps.google.com".equals(host) && (isMapsPath(path) || ("/".equals(path) && hasCoordinateQuery(uri)))) return new Parsed(Kind.LONG);
            return null;
        } catch (Exception malformed) { return null; }
    }

    private static boolean isMapsPath(String path) { return "/maps".equals(path) || path.startsWith("/maps/"); }

    private static boolean hasCoordinateQuery(URI uri) {
        String query = uri.getRawQuery();
        if (query == null) return false;
        String found = null;
        try {
            for (String item : query.split("&", -1)) {
                int equals = item.indexOf('=');
                String key = URLDecoder.decode(equals < 0 ? item : item.substring(0, equals), StandardCharsets.UTF_8.name());
                if ("query".equals(key)) return false;
                if ("q".equals(key)) {
                    if (found != null || equals < 0) return false;
                    found = URLDecoder.decode(item.substring(equals + 1), StandardCharsets.UTF_8.name());
                }
            }
        } catch (Exception malformed) { return false; }
        if (found == null) return false;
        java.util.regex.Matcher coordinate = Pattern.compile("\\s*(-?\\d+(?:\\.\\d+)?)\\s*,\\s*(-?\\d+(?:\\.\\d+)?)(?:\\s*\\(([^()]*)\\))?\\s*").matcher(found);
        if (!coordinate.matches()) return false;
        try {
            double lat = Double.parseDouble(coordinate.group(1)), lon = Double.parseDouble(coordinate.group(2));
            return Double.isFinite(lat) && Double.isFinite(lon) && Math.abs(lat) <= 85 && Math.abs(lon) <= 180;
        } catch (NumberFormatException malformed) { return false; }
    }

    private static final class HttpTransport implements Transport {
        @Override public Response get(String raw, int connectTimeoutMs, int readTimeoutMs) throws Exception {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection)new URL(raw).openConnection();
                connection.setInstanceFollowRedirects(false);
                connection.setRequestMethod("GET");
                connection.setConnectTimeout(connectTimeoutMs);
                connection.setReadTimeout(readTimeoutMs);
                connection.setRequestProperty("Accept", "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1");
                connection.setRequestProperty("User-Agent", "Shantu/Android");
                int status = connection.getResponseCode();
                return new Response(status, connection.getHeaderField("Location"));
            } finally { if (connection != null) connection.disconnect(); }
        }
    }
}
