package com.guanyun.weather;

/** No Android dependency: reject old fixes and keep recent precise GPS over coarse network fixes. */
final class LocationFixPolicy {
    static boolean accept(long age, float accuracy, long previousAge, float previousAccuracy) {
        if (age < -5000 || age > 30000 || Float.isNaN(accuracy) || Float.isInfinite(accuracy) || accuracy < 0) return false;
        if (age > previousAge) return false;
        return previousAge > 15000 || accuracy <= previousAccuracy * 1.5f;
    }
}
