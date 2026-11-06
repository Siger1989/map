package com.guanyun.weather;

import java.io.UnsupportedEncodingException;
import java.net.URLEncoder;

/** Pure formatter for the native AMap map-marker URI, independent of Android APIs. */
final class AmapNavigationUri {
    private AmapNavigationUri() {}

    static String build(String name, double latitude, double longitude) {
        if (name == null || !Double.isFinite(latitude) || !Double.isFinite(longitude) ||
            Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
            throw new IllegalArgumentException("Invalid AMap destination");
        }
        return "androidamap://viewMap?sourceApplication=" + encode("山兔") +
            "&poiname=" + encode(name) +
            "&lat=" + Double.toString(latitude) +
            "&lon=" + Double.toString(longitude) +
            "&dev=1";
    }

    private static String encode(String value) {
        try {
            // URLEncoder's plus-for-space encoding is valid in URI query components.
            return URLEncoder.encode(value, "UTF-8");
        } catch (UnsupportedEncodingException impossible) {
            throw new IllegalStateException("UTF-8 is unavailable", impossible);
        }
    }
}
