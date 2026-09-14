package com.guanyun.weather;

public final class SamplingPolicyCheck {
    private static void check(boolean ok, String message) { if (!ok) throw new AssertionError(message); }
    public static void main(String[] args) {
        check(!SamplingPolicy.accepts(4, 29, 4, 5, 30, false), "stationary jitter rejected");
        check(SamplingPolicy.accepts(4, 30, 4, 5, 30, false), "stationary interval accepted");
        check(!SamplingPolicy.accepts(4, 80, 4, 5, 30, true), "distance-only does not add static points");
        check(!SamplingPolicy.accepts(50, 1, 4, 5, 30, true), "interval floor remains active");
        check(SamplingPolicy.accepts(5, 4, 4, 5, 30, true), "distance and time boundary");
        check(SamplingPolicy.requestInterval(4, true, 59999) == 4000, "moving interval");
        check(SamplingPolicy.requestInterval(4, true, 60000) == 15000, "stationary throttling");
        check(SamplingPolicy.requestInterval(30, true, 60000) == 30000, "custom slower interval kept");
        check(SamplingPolicy.requestInterval(4, true, 0) == 4000, "movement recovery");
        check(SamplingPolicy.requestInterval(4, false, 60000) == 4000, "disabled adaptive");
        System.out.println("SamplingPolicy: 10 checks passed");
    }
}
