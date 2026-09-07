package com.guanyun.weather;

import android.content.Context;
import android.content.SharedPreferences;

/** Device-local acceptance threshold, independent of historical recording data. */
final class RecordingPreferences {
    static final int DEFAULT_ACCURACY = 20;
    static boolean valid(double metres) { return !Double.isNaN(metres) && !Double.isInfinite(metres) && metres == Math.rint(metres) && metres >= 5 && metres <= 80; }
    private static SharedPreferences prefs(Context context) { return context.getSharedPreferences("recording-preferences-v1", Context.MODE_PRIVATE); }
    static int accuracy(Context context) {
        try { int value = prefs(context).getInt("maximum-accuracy", DEFAULT_ACCURACY); return valid(value) ? value : DEFAULT_ACCURACY; }
        catch (ClassCastException e) { return DEFAULT_ACCURACY; }
    }
    static synchronized boolean saveAccuracy(Context context, double metres) {
        if (!valid(metres)) return false;
        SharedPreferences prefs = prefs(context);
        int previous = accuracy(context);
        if (prefs.edit().putInt("maximum-accuracy", (int)metres).commit()) return true;
        // A failed disk commit can still change the in-memory preference; restore that value too.
        prefs.edit().putInt("maximum-accuracy", previous).commit();
        return false;
    }
}
