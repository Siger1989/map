package com.guanyun.weather;
public final class LocationFixPolicyCheck {
    private static void check(boolean value) { if (!value) throw new AssertionError("location policy regression"); }
    public static void main(String[] args) {
        check(LocationFixPolicy.accept(0, 900, Long.MAX_VALUE, Float.MAX_VALUE));
        check(!LocationFixPolicy.accept(0, 900, 1000, 5));
        check(LocationFixPolicy.accept(0, 900, 16000, 5));
        check(LocationFixPolicy.accept(0, 5, 1000, 900));
        check(!LocationFixPolicy.accept(30001, 5, Long.MAX_VALUE, Float.MAX_VALUE));
        check(!LocationFixPolicy.accept(-5001, 5, Long.MAX_VALUE, Float.MAX_VALUE));
        check(!LocationFixPolicy.accept(0, Float.NaN, Long.MAX_VALUE, Float.MAX_VALUE));
        check(!LocationFixPolicy.accept(0, Float.POSITIVE_INFINITY, Long.MAX_VALUE, Float.MAX_VALUE));
        check(!LocationFixPolicy.accept(2000, 5, 1000, 5));
        System.out.println("PASS: native location freshness and accuracy policy (9 checks)");
    }
}
