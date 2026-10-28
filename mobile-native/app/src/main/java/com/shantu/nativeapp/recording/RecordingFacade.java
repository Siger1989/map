package com.shantu.nativeapp.recording;

import android.content.Context;
import android.content.Intent;
import org.json.JSONObject;

/** Native UI entry point; retains the existing sampling and checkpoint rules. */
public final class RecordingFacade {
    private RecordingFacade() {}
    public static JSONObject snapshot(Context context) throws Exception {
        return new JSONObject(RecordingStore.snapshot(context));
    }
    public static synchronized void command(Context context, String action) throws Exception {
        String phase = RecordingStore.load(context).optString("phase", "idle");
        if ("start".equals(action) && !"idle".equals(phase)) throw new IllegalStateException("请先保存当前记录");
        if ("resume".equals(action) && !"paused".equals(phase)) throw new IllegalStateException("当前记录不能继续");
        if ("pause".equals(action) && !"recording".equals(phase)) throw new IllegalStateException("当前没有正在记录的轨迹");
        if ("finish".equals(action) && !("recording".equals(phase) || "paused".equals(phase))) throw new IllegalStateException("当前没有可结束的记录");
        if ("start".equals(action) || "resume".equals(action)) {
            context.startForegroundService(new Intent(context, RecordingService.class).setAction(action));
        } else if ("pause".equals(action) || "finish".equals(action)) {
            RecordingStore.command(context, action);
            context.stopService(new Intent(context, RecordingService.class));
        } else if ("clear".equals(action)) RecordingStore.command(context, action);
        else throw new IllegalArgumentException("未知记录操作");
    }
    public static int accuracy(Context context) { return RecordingPreferences.accuracy(context); }
    public static boolean saveAccuracy(Context context, int value) { return RecordingPreferences.saveAccuracy(context, value); }
    public static JSONObject sampling(Context context) throws Exception { return SamplingPreferences.read(context); }
    public static boolean saveSampling(Context context, JSONObject value) { return SamplingPreferences.save(context, value.toString()); }
}
