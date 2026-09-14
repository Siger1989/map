package com.guanyun.weather;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONObject;

/** Native capability boundary: strict validation and independent, versioned preferences. */
final class SamplingPreferences {
    private static final String DEFAULT = "{\"mode\":\"standard\",\"intervalSeconds\":4,\"distanceMetres\":5,\"stationarySeconds\":30,\"adaptive\":false,\"distanceOnly\":false,\"recordOnNavigation\":false}";
    private static SharedPreferences prefs(Context c) { return c.getSharedPreferences("recording-sampling-v1", Context.MODE_PRIVATE); }
    private static boolean integer(JSONObject p, String key, int min, int max) throws Exception {
        Object value = p.get(key);
        if (!(value instanceof Number)) return false;
        double n = ((Number)value).doubleValue();
        return Double.isFinite(n) && n == Math.rint(n) && n >= min && n <= max;
    }
    static boolean valid(JSONObject p) {
        try {
            return java.util.Arrays.asList("power", "standard", "accuracy", "custom").contains(p.getString("mode")) &&
                integer(p, "intervalSeconds", 1, 30) && integer(p, "distanceMetres", 1, 100) &&
                integer(p, "stationarySeconds", 10, 90) && p.getInt("stationarySeconds") >= p.getInt("intervalSeconds") &&
                p.get("adaptive") instanceof Boolean && p.get("distanceOnly") instanceof Boolean && p.get("recordOnNavigation") instanceof Boolean;
        } catch (Exception e) { return false; }
    }
    static synchronized JSONObject read(Context c) {
        try { JSONObject p = new JSONObject(prefs(c).getString("policy", DEFAULT)); if (valid(p)) return p; } catch (Exception ignored) { }
        try { return new JSONObject(DEFAULT); } catch (Exception impossible) { throw new IllegalStateException(impossible); }
    }
    static synchronized boolean save(Context c, String raw) {
        if (raw == null || raw.length() > 1024) return false;
        try {
            JSONObject p = new JSONObject(raw);
            if (!valid(p)) return false;
            SharedPreferences prefs = prefs(c);
            String previous = prefs.getString("policy", DEFAULT);
            if (prefs.edit().putString("policy", p.toString()).commit()) return true;
            prefs.edit().putString("policy", previous).commit();
        } catch (Exception ignored) { }
        return false;
    }
}
