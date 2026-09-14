package com.guanyun.weather;

/** Pure policy shared by the recorder's acceptance and service request scheduling. */
final class SamplingPolicy {
    static boolean accepts(double distance, double seconds, int interval, int metres, int stationary, boolean distanceOnly) {
        return seconds >= interval && (distance >= metres || (!distanceOnly && seconds >= stationary));
    }
    static long requestInterval(int intervalSeconds, boolean adaptive, long stationaryMillis) {
        return (adaptive && stationaryMillis >= 60000 ? Math.max(intervalSeconds, 15) : intervalSeconds) * 1000L;
    }
}
