package com.guanyun.weather;

import android.content.Context;
import android.location.Location;
import android.util.AtomicFile;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;

/** Atomic private checkpoint, shared by the foreground service and the bundled page. */
final class RecordingStore {
    private static JSONObject data;
    private static boolean broken;
    static synchronized JSONObject load(Context context) throws Exception {
        if (data != null) return data;
        AtomicFile file = file(context);
        try { data = new JSONObject(new String(file.readFully(), StandardCharsets.UTF_8)); }
        catch (java.io.FileNotFoundException e) { data = empty(); }
        catch (Exception e) { broken = true; throw e; }
        if ("recording".equals(data.optString("phase"))) { data.put("phase", "paused"); data.put("error", "上次记录中断，点击继续恢复"); }
        return data;
    }
    private static AtomicFile file(Context c) { return new AtomicFile(new File(c.getFilesDir(), "recording-v1.json")); }
    private static JSONObject empty() throws Exception { return new JSONObject().put("id", "").put("phase", "idle").put("startedAt", 0).put("segments", new JSONArray()).put("error", ""); }
    static synchronized String snapshot(Context c) {
        try { return load(c).toString(); }
        catch (Exception e) { try { return empty().put("error", "原生存档损坏，未覆盖原文件").toString(); } catch (Exception ignored) { return "{}"; } }
    }
    static synchronized void command(Context c, String action) throws Exception {
        JSONObject value = load(c);
        if (broken) throw new Exception("记录存档无法读取");
        String phase = value.optString("phase");
        if ("start".equals(action)) {
            if (!"idle".equals(phase)) throw new Exception("请先保存当前记录");
            data = empty().put("id", java.util.UUID.randomUUID().toString()).put("startedAt", System.currentTimeMillis());
            action = "resume";
        }
        if ("resume".equals(action)) {
            JSONArray segments = data.getJSONArray("segments");
            if (segments.length() >= 100) throw new Exception("分段已达上限，请结束保存");
            if (segments.length() == 0 || segments.getJSONArray(segments.length()-1).length() > 0) segments.put(new JSONArray());
            data.put("phase", "recording").put("error", "");
        } else if ("pause".equals(action)) data.put("phase", "paused");
        else if ("finish".equals(action)) data.put("phase", "finished");
        else if ("clear".equals(action)) { if ("recording".equals(phase)) throw new Exception("请先结束记录"); data = empty(); }
        write(c);
    }
    static synchronized void error(Context c, String message) {
        try { load(c).put("error", message); write(c); } catch (Exception ignored) { }
    }
    static synchronized void add(Context c, Location p) throws Exception {
        JSONObject value = load(c);
        if (!"recording".equals(value.optString("phase")) || !p.hasAccuracy() || p.getAccuracy() > 80 || p.getAccuracy() < 0 || Math.abs(p.getLatitude()) > 85 || Math.abs(p.getLongitude()) > 180 || p.getTime() > System.currentTimeMillis()+5000 || System.currentTimeMillis()-p.getTime() > 20000) return;
        JSONArray segments = value.getJSONArray("segments");
        int count = 0; for (int i=0;i<segments.length();i++) count += segments.getJSONArray(i).length();
        if (count >= 6000) { command(c, "pause"); error(c, "已达 6000 点，请结束保存"); return; }
        JSONArray line = segments.getJSONArray(segments.length()-1);
        if (line.length() > 0) {
            JSONObject last = line.getJSONObject(line.length()-1);
            JSONArray coord = last.getJSONArray("coordinates");
            float[] distance = new float[1]; Location.distanceBetween(coord.getDouble(1),coord.getDouble(0),p.getLatitude(),p.getLongitude(),distance);
            double seconds = (p.getTime()-last.getLong("time"))/1000.0;
            if (seconds <= 0 || distance[0]/seconds > 80 || (distance[0] < 5 && seconds < 30)) return;
            if (seconds > 120) { if (segments.length() >= 100) { command(c,"pause"); error(c,"分段已达上限，请结束保存"); return; } line = new JSONArray(); segments.put(line); }
        }
        line.put(new JSONObject().put("coordinates",new JSONArray().put(p.getLongitude()).put(p.getLatitude())).put("time",p.getTime()).put("accuracy",p.getAccuracy()).put("altitude",p.hasAltitude()?p.getAltitude():JSONObject.NULL));
        value.put("error", ""); write(c);
    }
    private static void write(Context c) throws Exception {
        AtomicFile file = file(c); FileOutputStream out = null;
        try { out = file.startWrite(); out.write(data.toString().getBytes(StandardCharsets.UTF_8)); file.finishWrite(out); }
        catch (Exception e) { file.failWrite(out); data.put("phase","paused").put("error","存储失败，记录已暂停，请导出当前轨迹"); throw e; }
    }
}
