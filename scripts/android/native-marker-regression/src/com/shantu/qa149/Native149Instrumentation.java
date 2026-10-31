package com.shantu.qa149;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.os.Environment;
import android.os.Looper;
import android.os.SystemClock;
import android.graphics.RectF;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.File;
import java.io.FileOutputStream;
import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** Isolated inspection/native-input QA helper for the installed private release APK. */
public final class Native149Instrumentation extends Instrumentation {
    private static final String TARGET_PACKAGE = "com.guanyun.weather.shantu.preview";
    private static final String ACTIVITY_CLASS = "com.guanyun.weather.NativeReactActivity";
    private static final String HOST_CLASS = "com.shantu.nativeapp.hybrid.NativeReactMapHost";
    private static final String STORAGE_KEY = "guanyun.annotations.v1";
    private static final long MAP_WAIT_MS = 90_000L;
    private Activity activity;
    private Object host;
    private Object entry;
    private WebView webView;
    private JSONObject originalCamera;
    private final JSONArray steps = new JSONArray();
    private final JSONArray fixtures = new JSONArray();
    private final List<String> qaIds = new ArrayList<>();
    private String runId;
    private File evidenceDir;
    private Bundle arguments;

    @Override public void onCreate(Bundle arguments) { super.onCreate(arguments); this.arguments = arguments; start(); }
    @Override public void onStart() {
        super.onStart();
        Thread worker = new Thread(() -> {
            Bundle result = new Bundle();
            int rc = Activity.RESULT_OK;
            try {
                String mode = arguments == null ? "inspect" : arguments.getString("mode", "inspect");
                JSONObject report = "native-regression".equals(mode) ? runRegression()
                    : "interactive-preview".equals(mode) ? runInteractivePreview()
                    : "raster-diagnostics".equals(mode) ? runRasterDiagnostics() : inspect();
                result.putString("qa149_json", report.toString());
            } catch (Throwable error) {
                rc = Activity.RESULT_CANCELED;
                JSONObject failure = new JSONObject();
                try {
                    failure.put("mode", arguments == null ? "inspect" : arguments.getString("mode", "inspect"))
                        .put("testState", "ERROR").put("errorType", error.getClass().getName())
                        .put("error", safeError(error.getMessage())).put("causes", errorDetails(error));
                }
                catch (JSONException ignored) { }
                result.putString("qa149_json", failure.toString());
            }
            finish(rc, result);
        }, "shantu-qa149");
        worker.start();
    }

    private long previewDownTime;
    private long previewLastInput;
    private float previewX, previewY;
    private int previewWidth, previewHeight;

    /** Loopback-only input bridge for the user's live view of the installed APK. */
    private JSONObject runInteractivePreview() throws Exception {
        attachTarget();
        // Explicit diagnostic recovery only: allow the UI to respond after a contour OOM.
        // This is never enabled by the normal preview or by the product application.
        if (argumentEnabled("pauseContours")) {
            runOnMainSync(() -> {
                try {
                    Object controller = fieldValue(entry, "controller");
                    Object options = fieldValue(controller, "terrainOverlayOptions");
                    Method method = controller.getClass().getDeclaredMethod("setTerrainOverlay", boolean.class, boolean.class, int.class, double.class);
                    method.setAccessible(true);
                    method.invoke(controller, false,
                        Boolean.TRUE.equals(fieldValue(options, "elevationColorsEnabled")),
                        ((Number)fieldValue(options, "contourIntervalMeters")).intValue(),
                        ((Number)fieldValue(options, "elevationColorsOpacity")).doubleValue());
                } catch (Exception error) { throw new IllegalStateException("explicit contour recovery failed", error); }
            });
        }
        android.util.DisplayMetrics metrics = getTargetContext().getResources().getDisplayMetrics();
        previewWidth = metrics.widthPixels;
        previewHeight = metrics.heightPixels;
        Bitmap initialScreen = getUiAutomation().takeScreenshot();
        if (initialScreen != null) {
            previewWidth = initialScreen.getWidth();
            previewHeight = initialScreen.getHeight();
            initialScreen.recycle();
        }
        boolean stop = false;
        long commands = 0;
        try (ServerSocket server = new ServerSocket(23458, 8, InetAddress.getByName("127.0.0.1"))) {
            server.setSoTimeout(1000);
            Bundle ready = new Bundle();
            ready.putString("interactive_preview", "READY");
            ready.putInt("width", previewWidth);
            ready.putInt("height", previewHeight);
            sendStatus(1, ready);
            while (!stop) {
                if (previewDownTime != 0 && SystemClock.uptimeMillis() - previewLastInput > 30_000L) previewCancel();
                try (Socket socket = server.accept()) {
                    socket.setSoTimeout(5000);
                    BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), "UTF-8"));
                    BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(socket.getOutputStream(), "UTF-8"));
                    String line;
                    while ((line = previewReadLine(reader)) != null) {
                        JSONObject reply;
                        try {
                            JSONObject request = new JSONObject(line);
                            String action = request.getString("action");
                            stop = "stop".equals(action);
                            if ("inspect".equals(action)) {
                                reply = new JSONObject().put("ok", true).put("targetVersion", targetVersionProof())
                                    .put("camera", invokeCameraJson()).put("diagnostics", inspectDiagnosticsCounters())
                                    .put("annotationCount", annotationCount(readState()))
                                    .put("visibleControls", readVisibleControls()).put("contours", contourCounters());
                                writer.write(reply.toString()); writer.newLine(); writer.flush();
                                continue;
                            }
                            previewCommand(action, request);
                            commands++;
                            reply = new JSONObject().put("ok", true).put("action", action)
                                .put("width", previewWidth).put("height", previewHeight);
                        } catch (Exception error) {
                            previewCancel();
                            reply = new JSONObject().put("ok", false).put("error", safeError(error.getMessage()));
                        }
                        writer.write(reply.toString());
                        writer.newLine();
                        writer.flush();
                        if (stop) break;
                    }
                } catch (SocketTimeoutException idle) {
                    // A disconnected browser must not finish instrumentation and kill its target app.
                } catch (java.io.IOException disconnected) {
                    // Keep serving fresh local connections after a page reload or transport interruption.
                }
            }
        } finally { previewCancel(); }
        return new JSONObject().put("mode", "interactive-preview").put("testState", "STOPPED_BY_COMMAND")
            .put("commands", commands);
    }

    private static String previewReadLine(BufferedReader reader) throws Exception {
        StringBuilder line = new StringBuilder();
        int ch;
        while ((ch = reader.read()) != -1) {
            if (ch == '\n') return line.toString();
            if (ch != '\r') line.append((char)ch);
            if (line.length() > 4096) throw new java.io.IOException("preview command exceeds 4096 characters");
        }
        return line.length() == 0 ? null : line.toString();
    }

    private JSONArray contourCounters() throws Exception {
        JSONArray out = new JSONArray();
        Object renderer = fieldValue(fieldValue(entry, "controller"), "terrainOverlayRenderer");
        if (renderer == null) return out;
        Object wrappers = fieldValue(renderer, "contourLayers");
        if (!(wrappers instanceof Iterable)) return out;
        for (Object wrapper : (Iterable<?>)wrappers) {
            Object layer = fieldValue(wrapper, "layer");
            JSONObject values = numericObjectFields(layer);
            for (String key : new String[]{"generationQueue", "priorityQueue", "tiles", "contentCache", "pendingFetches", "backoff", "viewStyle"}) {
                try {
                    Object child = fieldValue(layer, key);
                    if (child != null) values.put(key, numericObjectFields(child));
                } catch (ReflectiveOperationException absent) { }
            }
            try {
                Object cachedTiles = fieldValue(layer, "liveContent");
                Object cut = fieldValue(layer, "renderCut");
                JSONArray tileStats = new JSONArray();
                if (cachedTiles instanceof Map) for (Map.Entry<?,?> item : ((Map<?,?>)cachedTiles).entrySet()) {
                    Object content = item.getValue();
                    JSONObject tile = numericObjectFields(content);
                    String key = String.valueOf(item.getKey());
                    if (key.matches("[-0-9/,.: ]{1,80}")) tile.put("key", key);
                    tile.put("inCut", cut instanceof java.util.Collection && ((java.util.Collection<?>)cut).contains(content));
                    try {
                        Object batch = fieldValue(content, "batch");
                        if (batch != null) tile.put("batch", numericObjectFields(fieldValue(batch, "tileData")));
                    } catch (ReflectiveOperationException absent) { }
                    tileStats.put(tile);
                }
                values.put("tileStats", tileStats);
            } catch (ReflectiveOperationException absent) { }
            out.put(values);
        }
        return out;
    }

    /** Numeric fields and collection sizes only; never serializes sources, URLs or callbacks. */
    private JSONObject numericObjectFields(Object owner) throws Exception {
        JSONObject out = new JSONObject();
        if (owner instanceof Map) out.put("size", ((Map<?,?>)owner).size());
        if (owner instanceof java.util.Collection) out.put("size", ((java.util.Collection<?>)owner).size());
        if (owner.getClass().getName().startsWith("java.")) return out;
        for (Field field : allFields(owner.getClass())) {
            if (java.lang.reflect.Modifier.isStatic(field.getModifiers())) continue;
            field.setAccessible(true);
            Object value = field.get(owner);
            if (value instanceof Number || value instanceof Boolean) out.put(field.getName(), value);
            else if (value instanceof Map) out.put(field.getName()+"Count", ((Map<?,?>)value).size());
            else if (value instanceof java.util.Collection) out.put(field.getName()+"Count", ((java.util.Collection<?>)value).size());
            else if (value != null && value.getClass().isArray()) out.put(field.getName()+"Length", java.lang.reflect.Array.getLength(value));
        }
        return out;
    }

    private float previewCoordinate(JSONObject request, String key, float fallback, int limit) throws Exception {
        double value = request.has(key) ? request.getDouble(key) : fallback;
        if (!Double.isFinite(value) || value < 0 || value >= limit) throw new IllegalArgumentException("invalid " + key);
        return (float)value;
    }

    private void previewCommand(String action, JSONObject request) throws Exception {
        if ("cancel".equals(action) || "stop".equals(action)) { previewCancel(); return; }
        if ("key".equals(action)) {
            if (request.getInt("code") != android.view.KeyEvent.KEYCODE_BACK) throw new IllegalArgumentException("only Back is supported");
            previewCancel(); sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK); return;
        }
        if (!("down".equals(action) || "move".equals(action) || "up".equals(action) ||
            "tap".equals(action) || "swipe".equals(action) || "pinch".equals(action)))
            throw new IllegalArgumentException("unsupported preview action");
        float x = previewCoordinate(request, "x", previewX, previewWidth);
        float y = previewCoordinate(request, "y", previewY, previewHeight);
        if ("tap".equals(action)) {
            previewCancel(); previewBegin(x, y); SystemClock.sleep(35); previewSingle(MotionEvent.ACTION_UP, x, y); previewDownTime = 0; return;
        }
        if ("swipe".equals(action)) {
            float x2 = previewCoordinate(request, "x2", x, previewWidth);
            float y2 = previewCoordinate(request, "y2", y, previewHeight);
            int duration = request.optInt("duration", 250);
            if (duration < 50 || duration > 2000) throw new IllegalArgumentException("duration must be 50..2000ms");
            previewCancel(); previewBegin(x, y);
            int steps = Math.max(2, duration / 16);
            for (int i = 1; i <= steps; i++) {
                SystemClock.sleep(duration / steps);
                previewSingle(MotionEvent.ACTION_MOVE, x + (x2 - x) * i / steps, y + (y2 - y) * i / steps);
            }
            previewSingle(MotionEvent.ACTION_UP, x2, y2); previewDownTime = 0; return;
        }
        if ("pinch".equals(action)) { previewPinch(x, y, request.getDouble("factor")); return; }
        if ("down".equals(action)) { previewCancel(); previewBegin(x, y); return; }
        if (previewDownTime == 0) throw new IllegalStateException("gesture has no down event");
        previewSingle("move".equals(action) ? MotionEvent.ACTION_MOVE : MotionEvent.ACTION_UP, x, y);
        if ("up".equals(action)) previewDownTime = 0;
    }

    private void previewBegin(float x, float y) {
        previewDownTime = SystemClock.uptimeMillis();
        previewSingle(MotionEvent.ACTION_DOWN, x, y);
    }

    private void previewSingle(int action, float x, float y) {
        long now = SystemClock.uptimeMillis();
        MotionEvent event = MotionEvent.obtain(previewDownTime, now, action, x, y, 0);
        event.setSource(android.view.InputDevice.SOURCE_TOUCHSCREEN);
        try { sendPointerSync(event); }
        finally { event.recycle(); }
        previewX = x; previewY = y; previewLastInput = now;
    }

    private void previewCancel() {
        if (previewDownTime != 0) {
            try { previewSingle(MotionEvent.ACTION_CANCEL, previewX, previewY); }
            finally { previewDownTime = 0; }
        }
    }

    private void previewPinch(float x, float y, double factor) throws Exception {
        if (!Double.isFinite(factor) || factor < .25 || factor > 4) throw new IllegalArgumentException("factor must be .25..4");
        float available = Math.min(Math.min(x, previewWidth - 1 - x), Math.min(y, previewHeight - 1 - y));
        float start = Math.min(Math.min(previewWidth, previewHeight) * .16f, available / (float)Math.max(1, factor));
        if (start < 8) throw new IllegalArgumentException("pinch center is too near an edge");
        previewCancel(); previewBegin(x - start, y);
        try {
            previewMulti(MotionEvent.ACTION_POINTER_DOWN | (1 << MotionEvent.ACTION_POINTER_INDEX_SHIFT), x, y, start);
            for (int i = 1; i <= 14; i++) {
                SystemClock.sleep(16);
                previewMulti(MotionEvent.ACTION_MOVE, x, y, start * (1 + ((float)factor - 1) * i / 14));
            }
            float end = start * (float)factor;
            previewMulti(MotionEvent.ACTION_POINTER_UP | (1 << MotionEvent.ACTION_POINTER_INDEX_SHIFT), x, y, end);
            previewSingle(MotionEvent.ACTION_UP, x - end, y);
            previewDownTime = 0;
        } finally { previewCancel(); }
    }

    private void previewMulti(int action, float centerX, float centerY, float radius) {
        MotionEvent.PointerProperties[] properties = new MotionEvent.PointerProperties[2];
        MotionEvent.PointerCoords[] coords = new MotionEvent.PointerCoords[2];
        for (int i = 0; i < 2; i++) {
            properties[i] = new MotionEvent.PointerProperties(); properties[i].id = i;
            properties[i].toolType = MotionEvent.TOOL_TYPE_FINGER;
            coords[i] = new MotionEvent.PointerCoords(); coords[i].x = centerX + (i == 0 ? -radius : radius);
            coords[i].y = centerY; coords[i].pressure = 1; coords[i].size = 1;
        }
        long now = SystemClock.uptimeMillis();
        MotionEvent event = MotionEvent.obtain(previewDownTime, now, action, 2, properties, coords,
            0, 0, 1, 1, 0, 0, android.view.InputDevice.SOURCE_TOUCHSCREEN, 0);
        try { sendPointerSync(event); } finally { event.recycle(); }
        previewX = centerX - radius; previewY = centerY; previewLastInput = now;
    }

    private JSONObject inspect() throws Exception {
        attachTarget();
        JSONObject state = readState();
        JSONObject out = new JSONObject();
        out.put("mode", "inspect").put("targetPackage", TARGET_PACKAGE).put("mapId", "main");
        out.put("sourceId", sourceId(state)).put("camera", invokeCameraJson()).put("annotationCount", annotationCount(state));
        out.put("selectedAnnotationId", selectedId(state)).put("nativeWorldWindAttached", findWorldWindow() != null);
        out.put("visibleControlsSpace", "css-pixels").put("visibleControls", readVisibleControls());
        out.put("testState", "INSPECT_READY");
        return out;
    }

    /** Read-only native raster/cache diagnostic sweep; does not touch annotation storage. */
    private JSONObject runRasterDiagnostics() throws Exception {
        attachTarget();
        runId = UUID.randomUUID().toString().replace("-", "");
        evidenceDir = new File(getTargetContext().getExternalFilesDir(Environment.DIRECTORY_PICTURES), "native149-raster-" + runId);
        if (!evidenceDir.mkdirs() && !evidenceDir.isDirectory()) throw new IllegalStateException("evidence directory unavailable");

        originalCamera = invokeCameraJson();
        JSONObject initialState = readState();
        int initialAnnotationCount = annotationCount(initialState);
        JSONObject report = new JSONObject();
        JSONArray stages = new JSONArray();
        report.put("mode", "raster-diagnostics").put("targetPackage", TARGET_PACKAGE).put("mapId", "main")
            .put("targetVersion", targetVersionProof()).put("initialCamera", originalCamera)
            .put("initialAnnotationCount", initialAnnotationCount)
            .put("evidenceDirectory", evidenceDir.getAbsolutePath())
            .put("diagnosticScope", "allowlisted numeric cache/network counters only; URL-free");
        String testState = "RASTER_DIAGNOSTICS_COMPLETE";
        String restoreState = "NOT_STARTED";
        Throwable runError = null;
        try {
            double originalBearing = originalCamera.optDouble("bearing", 0.0);
            JSONObject originalCenter = originalCamera.optJSONObject("center");
            JSONArray originalCenterArray = originalCamera.optJSONArray("center");
            if (originalCenter == null && originalCenterArray == null) throw new IllegalStateException("original camera center unavailable");
            RasterStage[] plan = arguments != null && "true".equals(arguments.getString("rasterSweep")) ? rasterSweepPlan(originalBearing) : arguments != null && "true".equals(arguments.getString("rasterExtended")) ? new RasterStage[] {
                new RasterStage("zoom6-pitch55-original-bearing", 6.0, 55.0, originalBearing, 15),
                new RasterStage("zoom6-pitch55-bearing-plus90", 6.0, 55.0, originalBearing + 90.0, 8),
                new RasterStage("zoom6-pitch55-original-bearing-return", 6.0, 55.0, originalBearing, 8),
                new RasterStage("zoom10-pitch35-original-bearing", 10.0, 35.0, originalBearing, 15),
                new RasterStage("zoom10-pitch55-original-bearing", 10.0, 55.0, originalBearing, 20),
                new RasterStage("zoom10-pitch55-bearing-plus90", 10.0, 55.0, originalBearing + 90.0, 12),
                new RasterStage("zoom10-pitch55-original-bearing-return", 10.0, 55.0, originalBearing, 12),
                new RasterStage("zoom10-pitch75-original-bearing", 10.0, 75.0, originalBearing, 20)
            } : new RasterStage[] {
                new RasterStage("zoom6-pitch0-original-bearing", 6.0, 0.0, originalBearing, 8),
                new RasterStage("zoom6-pitch15-original-bearing", 6.0, 15.0, originalBearing, 15),
                new RasterStage("zoom6-pitch15-bearing-plus45", 6.0, 15.0, originalBearing + 45.0, 6),
                new RasterStage("zoom6-pitch15-bearing-plus90", 6.0, 15.0, originalBearing + 90.0, 6),
                new RasterStage("zoom6-pitch15-bearing-plus180", 6.0, 15.0, originalBearing + 180.0, 6),
                new RasterStage("zoom6-pitch15-original-bearing-return", 6.0, 15.0, originalBearing, 6),
                new RasterStage("zoom8-pitch15-original-bearing", 8.0, 15.0, originalBearing, 10),
                new RasterStage("zoom8-pitch15-bearing-plus90", 8.0, 15.0, originalBearing + 90.0, 6),
                new RasterStage("zoom8-pitch15-original-bearing-return", 8.0, 15.0, originalBearing, 6)
            };
            for (int i = 0; i < plan.length; i++) {
                RasterStage stage = plan[i];
                JSONObject pose = new JSONObject(originalCamera.toString())
                    .put("zoom", stage.zoom).put("pitch", stage.pitch).put("bearing", normalizeBearing(stage.bearing));
                // Keep the exact initial center; some camera snapshots encode it as an object, others as an array.
                if (originalCenter != null) pose.put("center", new JSONObject(originalCenter.toString()));
                else pose.put("center", new JSONArray(originalCenterArray.toString()));
                applyCamera(pose);
                awaitFrames(2, 10_000L);

                JSONObject stageReport = new JSONObject().put("name", stage.name).put("requestedCamera", pose)
                    .put("durationSeconds", stage.durationSeconds).put("samples", new JSONArray());
                stageReport.put("firstScreenshot", capture("raster-" + i + "-first"));
                long stageStart = SystemClock.elapsedRealtime();
                long nextSampleAt = stageStart;
                int sampleIndex = 0;
                while (true) {
                    long now = SystemClock.elapsedRealtime();
                    long elapsed = now - stageStart;
                    if (elapsed > stage.durationSeconds * 1000L) break;
                    if (now < nextSampleAt) SystemClock.sleep(nextSampleAt - now);
                    long sampleAt = SystemClock.elapsedRealtime();
                    JSONObject sample = new JSONObject().put("sampleIndex", sampleIndex++)
                        .put("elapsedMs", sampleAt - stageStart).put("camera", invokeCameraJson())
                        .put("diagnostics", inspectDiagnosticsCounters());
                    stageReport.getJSONArray("samples").put(sample);
                    nextSampleAt = stageStart + (sampleIndex * 1000L);
                    if (nextSampleAt > stageStart + stage.durationSeconds * 1000L) break;
                }
                stageReport.put("actualDurationMs", SystemClock.elapsedRealtime() - stageStart)
                    .put("lastScreenshot", capture("raster-" + i + "-last"));
                stages.put(stageReport);
            }
        } catch (Throwable error) {
            testState = "RASTER_DIAGNOSTICS_ERROR";
            runError = error;
        } finally {
            try {
                applyCamera(originalCamera);
                awaitFrames(2, 10_000L);
                restoreState = "ORIGINAL_CAMERA_RESTORED";
                report.put("restoredCameraScreenshot", capture("raster-restored-camera"));
            } catch (Throwable restoreError) {
                restoreState = "CAMERA_RESTORE_FAILED:" + restoreError.getClass().getSimpleName();
                if (runError == null) runError = restoreError;
                testState = "RASTER_DIAGNOSTICS_ERROR";
            }
        }
        JSONObject finalCamera = new JSONObject();
        int finalAnnotationCount = -1;
        try { finalCamera = invokeCameraJson(); }
        catch (Throwable cameraSnapshotError) {
            if (runError == null) runError = cameraSnapshotError;
            testState = "RASTER_DIAGNOSTICS_ERROR";
        }
        try { finalAnnotationCount = annotationCount(readState()); }
        catch (Throwable stateReadError) {
            if (runError == null) runError = stateReadError;
            testState = "RASTER_DIAGNOSTICS_ERROR";
        }
        report.put("stages", stages).put("testState", testState).put("cameraRestoreState", restoreState)
            .put("finalCamera", finalCamera).put("finalAnnotationCount", finalAnnotationCount)
            .put("annotationCountUnchanged", finalAnnotationCount >= 0 && finalAnnotationCount == initialAnnotationCount);
        if (runError != null) report.put("errorType", runError.getClass().getName()).put("error", safeError(runError.getMessage()));
        String jsonPath = new File(evidenceDir, "raster-diagnostics.json").getAbsolutePath();
        try (FileOutputStream stream = new FileOutputStream(jsonPath)) { stream.write(report.toString(2).getBytes("UTF-8")); }
        report.put("reportPath", jsonPath);
        return report;
    }

    private RasterStage[] rasterSweepPlan(double bearing) {
        List<RasterStage> stages = new ArrayList<>();
        for (double pitch : new double[]{0, 55}) for (int zoom : new int[]{9,11,13,15,17})
            stages.add(new RasterStage("sweep-z"+zoom+"-p"+(int)pitch, zoom, pitch, bearing, 8));
        return stages.toArray(new RasterStage[0]);
    }

    private static final class RasterStage {
        final String name; final double zoom; final double pitch; final double bearing; final int durationSeconds;
        RasterStage(String name, double zoom, double pitch, double bearing, int durationSeconds) {
            this.name = name; this.zoom = zoom; this.pitch = pitch; this.bearing = bearing; this.durationSeconds = durationSeconds;
        }
    }

    private static double normalizeBearing(double bearing) {
        double normalized = bearing % 360.0;
        return normalized < 0.0 ? normalized + 360.0 : normalized;
    }

    private JSONObject targetVersionProof() throws Exception {
        android.content.pm.PackageInfo info = getTargetContext().getPackageManager().getPackageInfo(TARGET_PACKAGE, 0);
        long code = android.os.Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
        return new JSONObject().put("package", TARGET_PACKAGE).put("versionName", info.versionName == null ? JSONObject.NULL : info.versionName)
            .put("versionCode", code);
    }

    private JSONObject inspectDiagnosticsCounters() throws Exception {
        AtomicReference<Object> result = new AtomicReference<>();
        AtomicReference<Throwable> failure = new AtomicReference<>();
        AtomicReference<Boolean> methodFound = new AtomicReference<>(false);
        runOnMainSync(() -> {
            try {
                if (Looper.myLooper() != Looper.getMainLooper()) throw new IllegalStateException("diagnostics call is not on main looper");
                Method method = host.getClass().getDeclaredMethod("inspectMapDiagnosticsOnMain");
                methodFound.set(true);
                method.setAccessible(true);
                result.set(method.invoke(host));
            } catch (Throwable error) { failure.set(error); }
        });
        JSONObject out = new JSONObject().put("mainThread", true).put("methodAvailable", methodFound.get());
        if (failure.get() != null) {
            out.put("diagnosticsErrorType", failure.get().getClass().getName())
                .put("availableMethodNames", diagnosticsMethodNames());
            return out;
        }
        Object value = result.get();
        if (value instanceof JSONObject) out.put("counters", safeDiagnosticsObject((JSONObject)value));
        else if (value instanceof Map) out.put("counters", safeDiagnosticsMap((Map<?, ?>)value));
        else out.put("resultType", value == null ? "null" : value.getClass().getName()).put("counters", new JSONObject());
        return out;
    }

    private JSONArray diagnosticsMethodNames() {
        JSONArray names = new JSONArray();
        for (Method method : host.getClass().getDeclaredMethods())
            if ("inspectMapDiagnosticsOnMain".equals(method.getName())) names.put(method.getName());
        return names;
    }

    private JSONObject safeDiagnosticsObject(JSONObject raw) throws JSONException {
        JSONObject safe = new JSONObject();
        java.util.Iterator<String> keys = raw.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            Object filtered = safeDiagnosticsValue(key, raw.opt(key));
            if (filtered != null) safe.put(key, filtered);
        }
        return safe;
    }

    private JSONObject safeDiagnosticsMap(Map<?, ?> raw) throws JSONException {
        JSONObject safe = new JSONObject();
        for (Map.Entry<?, ?> entry : raw.entrySet()) {
            if (!(entry.getKey() instanceof String)) continue;
            String key = (String)entry.getKey();
            Object filtered = safeDiagnosticsValue(key, entry.getValue());
            if (filtered != null) safe.put(key, filtered);
        }
        return safe;
    }

    private Object safeDiagnosticsValue(String key, Object value) throws JSONException {
        if (value == null || value == JSONObject.NULL) return null;
        if (isAllowedDiagnosticScalar(key)) return (value instanceof Number || value instanceof Boolean) ? value : null;
        if ("maps".equals(key) && value instanceof JSONArray) {
            JSONArray input = (JSONArray)value, output = new JSONArray();
            for (int i = 0; i < input.length(); i++) {
                Object item = input.opt(i);
                if (item instanceof JSONObject) output.put(safeDiagnosticsObject((JSONObject)item));
                else if (item instanceof Map) output.put(safeDiagnosticsMap((Map<?, ?>)item));
            }
            return output;
        }
        if (("network".equals(key) || "tileStages".equals(key)) && value instanceof JSONObject)
            return safeDiagnosticsObject((JSONObject)value);
        if (("network".equals(key) || "tileStages".equals(key)) && value instanceof Map)
            return safeDiagnosticsMap((Map<?, ?>)value);
        if ("decodeDurationBucketCounts".equals(key) && value instanceof JSONArray) {
            JSONArray input = (JSONArray)value, output = new JSONArray();
            for (int i = 0; i < input.length(); i++) {
                Object item = input.opt(i);
                if (item instanceof Number || item instanceof Boolean) output.put(item);
            }
            return output;
        }
        return null;
    }

    private boolean isAllowedDiagnosticScalar(String key) {
        // Explicit numeric/boolean fields from inspectMapDiagnosticsOnMain; names and identifiers are excluded.
        switch (key) {
            case "available": case "heapMaxBytes": case "heapUsedBytes": case "mapCount":
            case "actualFrames": case "lastFrameAgeMs": case "rasterBitmapDecodes":
            case "renderCacheCapacityBytes": case "renderCacheUsedBytes": case "renderCacheEntries":
            case "decodedImages": case "decodeNanos": case "decodeFailures": case "completedFrames": case "perTileDrawCount":
            case "requests": case "successes": case "errors": case "rateLimits": case "memoryHits": case "diskHits":
            case "retries": case "cancellations": case "decodeValidationMs": case "receivedBytes": case "queued":
            case "active": case "queueWaitMs": case "networkMs": case "pendingCacheWriteBytes": case "droppedCacheWrites":
            case "completedCacheWrites": case "failedCacheWrites": case "activeBackground":
                return true;
            default:
                return false;
        }
    }

    private JSONObject runRegression() throws Exception {
        attachTarget();
        runId = UUID.randomUUID().toString().replace("-", "");
        evidenceDir = new File(getTargetContext().getExternalFilesDir(Environment.DIRECTORY_PICTURES), "native149-" + runId);
        if (!evidenceDir.mkdirs() && !evidenceDir.isDirectory()) throw new IllegalStateException("evidence directory unavailable");
        JSONObject initial = readState();
        if (!selectedId(initial).isEmpty()) throw new IllegalStateException("pre-existing selection; refusing to disturb it");
        originalCamera = invokeCameraJson();
        String originalStorage = readStorage();
        JSONArray originalRecords = new JSONArray(originalStorage);
        int[] viewOrigin = new int[2];
        View wwView = worldWindowView();
        final int[] viewSize = new int[2];
            runOnMainSync(() -> { wwView.getLocationOnScreen(viewOrigin); viewSize[0] = wwView.getWidth(); viewSize[1] = wwView.getHeight(); });
        if (viewSize[0] < 200 || viewSize[1] < 200) throw new IllegalStateException("native map viewport too small");

        JSONObject report = new JSONObject();
        report.put("mode", "native-regression").put("targetPackage", TARGET_PACKAGE).put("mapId", "main");
        report.put("sourceId", sourceId(initial)).put("initialCamera", originalCamera).put("initialAnnotationCount", originalRecords.length());
        report.put("viewportPx", new JSONArray().put(viewSize[0]).put(viewSize[1]));
        report.put("evidenceDirectory", evidenceDir.getAbsolutePath());
        boolean inserted = false;
        String cleanupState = "NOT_STARTED";
        try {
            JSONObject startPose = new JSONObject(originalCamera.toString()).put("zoom", 8.4);
            applyCamera(startPose);
            awaitFrames(2, 10_000);
            double[][] screen = {{viewSize[0] * .22, viewSize[1] * .60}, {viewSize[0] * .50, viewSize[1] * .60}, {viewSize[0] * .78, viewSize[1] * .60}};
            String[] names = {"QA-PIN-A", "QA-PIN-B", "QA-PIN-C"};
            String[] colors = {"#e53935", "#1e88e5", "#43a047"};
            for (int i = 0; i < screen.length; i++) {
                double[] coord = unproject(screen[i][0], screen[i][1]);
                String id = "qa149-" + runId + "-" + (char)('A' + i);
                qaIds.add(id);
                fixtures.put(new JSONObject().put("id", id).put("kind", "pin").put("name", names[i]).put("note", "")
                    .put("color", colors[i]).put("coordinates", new JSONArray().put(coord[1]).put(coord[0]))
                    .put("groundElevation", JSONObject.NULL).put("placement", "surface").put("offset", 0)
                    .put("width", 10).put("length", 20).put("height", 10).put("heading", 0).put("pitch", 0)
                    .put("roll", 0).put("opacity", .55).put("visible", true));
            }
            inserted = true;
            writeStorageAppend(fixtures);
            awaitAnnotations(qaIds, 20_000);
            double cssScale = viewportScale();
            JSONObject fixtureReadiness = awaitVisiblePinFixtures(viewOrigin, screen, cssScale, colors, 10_000L);
            report.put("fixtureRendering", fixtureReadiness);
            steps.put(new JSONObject().put("name", "fixtures-visible").put("pass", true).put("renderedPinColorPixels", fixtureReadiness.getJSONArray("colorPixelCounts"))
                .put("screenshot", fixtureReadiness.getString("screenshot")));
            for (int i = 0; i < qaIds.size(); i++) {
                long started = SystemClock.elapsedRealtime();
                float tapX = (float)screen[i][0];
                float tapY = (float)(screen[i][1] - 11.0 * cssScale);
                JSONObject gpuProbe = probeNativePick(tapX, tapY, 22f * (float)cssScale);
                tap(viewOrigin[0] + tapX, viewOrigin[1] + tapY);
                String actual = awaitSelection(qaIds.get(i), 4_000);
                SystemClock.sleep(250L);
                JSONObject selectionTools = readSelectionTools();
                JSONObject step = new JSONObject().put("name", "tap-" + (char)('A' + i)).put("expectedId", qaIds.get(i))
                    .put("actualId", actual.isEmpty() ? JSONObject.NULL : actual).put("pass", qaIds.get(i).equals(actual))
                    .put("gpuPickProbe", gpuProbe).put("tapViewLocalPx", new JSONArray().put(tapX).put(tapY))
                    .put("selectionTools", selectionTools).put("elapsedMs", SystemClock.elapsedRealtime() - started)
                    .put("screenshot", capture("tap-" + (char)('A' + i)));
                steps.put(step);
            }
            boolean followUp = argumentEnabled("followUp");
            report.put("followUp", followUp);
            if (!followUp) {
                int[][] rapidRounds = {{2, 0, 1, 2, 1}, {2, 0, 1, 2, 1}, {2, 0, 1, 2, 1}};
                for (int round = 0; round < rapidRounds.length; round++) {
                    long rapidStart = SystemClock.elapsedRealtime();
                    for (int index : rapidRounds[round]) {
                        tap(viewOrigin[0] + (float)screen[index][0], viewOrigin[1] + (float)(screen[index][1] - 11.0 * cssScale));
                        SystemClock.sleep(65);
                    }
                    String rapidActual = awaitSelection(qaIds.get(1), 5_000);
                    SystemClock.sleep(250L);
                    steps.put(new JSONObject().put("name", "rapid-alternation-round-" + (round + 1)).put("tapOrder", "C,A,B,C,B")
                        .put("expectedId", qaIds.get(1)).put("actualId", rapidActual.isEmpty() ? JSONObject.NULL : rapidActual)
                        .put("pass", qaIds.get(1).equals(rapidActual)).put("elapsedMs", SystemClock.elapsedRealtime() - rapidStart)
                        .put("screenshot", capture("rapid-alternation-" + (round + 1))));
                }
            }
            long blankStart = SystemClock.elapsedRealtime();
            tap(viewOrigin[0] + viewSize[0] * .50f, viewOrigin[1] + viewSize[1] * .88f);
            String blankActual = awaitSelection("", 4_000);
            steps.put(new JSONObject().put("name", "blank-clear").put("expectedId", JSONObject.NULL)
                .put("actualId", blankActual.isEmpty() ? JSONObject.NULL : blankActual).put("pass", blankActual.isEmpty())
                .put("elapsedMs", SystemClock.elapsedRealtime() - blankStart).put("screenshot", capture("blank-clear")));

            boolean pickOnly = argumentEnabled("pickOnly");
            report.put("pickOnly", pickOnly);
            long refocusStart = SystemClock.elapsedRealtime();
            tap(viewOrigin[0] + (float)screen[0][0], viewOrigin[1] + (float)(screen[0][1] - 11.0 * cssScale));
            String focusedSelection = awaitSelection(qaIds.get(0), 4_000);
            SystemClock.sleep(250L);
            steps.put(new JSONObject().put("name", "refocus-A-before-zoom-sweep")
                .put("expectedId", qaIds.get(0)).put("actualId", focusedSelection.isEmpty() ? JSONObject.NULL : focusedSelection)
                .put("pass", qaIds.get(0).equals(focusedSelection)).put("selectionTools", readSelectionTools())
                .put("elapsedMs", SystemClock.elapsedRealtime() - refocusStart).put("screenshot", capture("refocus-A")));
            if (followUp) runEndpointUiFollowUp(viewOrigin, screen[0], cssScale);
            JSONArray focusCoordinate = fixtures.getJSONObject(0).getJSONArray("coordinates");
            List<Double> zooms = new ArrayList<>();
            for (int z = 2; z <= 22; z++) zooms.add((double)z);
            double[] thresholds = {7.70, 7.84, 7.86, 8.14, 8.16, 8.4, 8.84, 8.86, 9.14, 9.16, 9.4};
            for (double threshold : thresholds) zooms.add(threshold);
            Collections.sort(zooms);
            List<Double> descending = new ArrayList<>(zooms);
            Collections.reverse(descending);
            zooms.addAll(descending);
            for (int i = 0; !pickOnly && !followUp && i < zooms.size(); i++) {
                double zoom = zooms.get(i);
                JSONObject pose = new JSONObject(originalCamera.toString()).put("center", focusCoordinate).put("zoom", zoom);
                long started = SystemClock.elapsedRealtime(); applyCamera(pose); awaitFrames(1, 6_000);
                SystemClock.sleep(250L);
                steps.put(new JSONObject().put("name", "zoom-sweep-" + i).put("zoom", zoom)
                    .put("camera", invokeCameraJson()).put("markerMode", markerMode())
                    .put("selectedId", selectedId(readState()).isEmpty() ? JSONObject.NULL : selectedId(readState()))
                    .put("hasFocusedNativeMarker", markerExists(qaIds.get(0)))
                    .put("elapsedMs", SystemClock.elapsedRealtime() - started)
                    .put("screenshot", capture("zoom-" + i)));
            }
            double[][] poses = {{0, 0, 8.4}, {35, 18, 8.4}, {105, 35, 8.4}, {220, 52, 8.4}, {0, 0, 8.4}};
            for (int i = 0; !pickOnly && i < poses.length; i++) {
                JSONObject pose = new JSONObject(originalCamera.toString()).put("center", focusCoordinate).put("bearing", poses[i][0]).put("pitch", poses[i][1]).put("zoom", poses[i][2]);
                long started = SystemClock.elapsedRealtime(); applyCamera(pose); awaitFrames(1, 6_000);
                SystemClock.sleep(250L);
                steps.put(new JSONObject().put("name", "pose-" + i).put("bearing", poses[i][0]).put("pitch", poses[i][1])
                    .put("camera", invokeCameraJson()).put("elapsedMs", SystemClock.elapsedRealtime() - started).put("screenshot", capture("pose-" + i)));
            }
            report.put("testState", "NATIVE_INPUT_RUN_COMPLETE");
        } catch (Throwable runError) {
            report.put("testState", "NATIVE_INPUT_RUN_ERROR").put("errorType", runError.getClass().getName())
                .put("error", safeError(runError.getMessage()));
        } finally {
            try {
                String selectedBeforeCleanup = selectedId(readState());
                boolean qaSelection = qaIds.contains(selectedBeforeCleanup);
                report.put("qaSelectionBeforeCleanup", qaSelection);
                if (qaSelection) {
                    tapDomButton(".selection-tools button", "完成调整", viewportScale());
                    String cleared = awaitSelection("", 5_000L);
                    boolean clearedByUi = cleared.isEmpty();
                    awaitWebViewDraw();
                    steps.put(new JSONObject().put("name", "cleanup-clear-QA-selection").put("method", "actual-DOM-rect-MotionEvent")
                        .put("selectedIdBefore", selectedBeforeCleanup).put("selectedIdAfter", cleared.isEmpty() ? JSONObject.NULL : cleared)
                        .put("pass", clearedByUi).put("screenshot", capture("cleanup-selection-cleared")));
                    if (!clearedByUi) cleanupState = "QA_SELECTION_CLEAR_FAILED";
                }
            } catch (Throwable selectionCleanupError) {
                cleanupState = "QA_SELECTION_CLEAR_FAILED:" + selectionCleanupError.getClass().getSimpleName();
            }
            try {
                if (inserted) removeOnlyQaIds();
                cleanupState = cleanupState.startsWith("QA_SELECTION_CLEAR_FAILED") ? cleanupState + ";QA_IDS_REMOVED" : "QA_IDS_REMOVED";
            } catch (Throwable cleanupError) {
                String failure = "QA_ID_REMOVAL_FAILED:" + cleanupError.getClass().getSimpleName();
                cleanupState = cleanupState.startsWith("QA_SELECTION_CLEAR_FAILED") ? cleanupState + ";" + failure : failure;
            }
            try { if (originalCamera != null) { applyCamera(originalCamera); awaitFrames(2, 10_000); capture("restored-camera"); } }
            catch (Throwable cameraError) { cleanupState += ";CAMERA_RESTORE_FAILED:" + cameraError.getClass().getSimpleName(); }
            report.put("cleanupState", cleanupState).put("remainingQaIds", countQaIdsInStorage()).put("restoredCamera", originalCamera);
        }
        report.put("qaFixtureIds", new JSONArray(qaIds)).put("steps", steps).put("fixtures", fixtures);
        report.put("finalAnnotationCount", annotationCount(readState())).put("finalSelectedId", selectedId(readState()));
        String jsonPath = new File(evidenceDir, "report.json").getAbsolutePath();
        try (FileOutputStream stream = new FileOutputStream(jsonPath)) { stream.write(report.toString(2).getBytes("UTF-8")); }
        report.put("reportPath", jsonPath);
        return report;
    }

    private void attachTarget() throws Exception {
        Intent launch = getTargetContext().getPackageManager().getLaunchIntentForPackage(TARGET_PACKAGE);
        if (launch == null) throw new IllegalStateException("target launch intent missing");
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        activity = startActivitySync(launch);
        if (activity == null || !ACTIVITY_CLASS.equals(activity.getClass().getName())) throw new IllegalStateException("unexpected target activity");
        waitForIdleSync();
        host = fieldValue(activity, "maps");
        if (host == null || !HOST_CLASS.equals(host.getClass().getName())) throw new IllegalStateException("native map host missing");
        entry = waitForMainMapEntry(host);
        if (entry == null || findWorldWindow() == null) throw new IllegalStateException("native WorldWind map unavailable");
        List<WebView> webViews = new ArrayList<>();
        runOnMainSync(() -> collectWebViews(activity.getWindow().getDecorView(), webViews));
        if (webViews.isEmpty()) throw new IllegalStateException("React WebView unavailable");
        webView = webViews.get(0);
    }
    private boolean argumentEnabled(String name) {
        if (arguments == null) return false;
        Object value = arguments.get(name);
        return Boolean.TRUE.equals(value) || (value instanceof String && "true".equalsIgnoreCase((String)value));
    }

    private Object waitForMainMapEntry(Object mapHost) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + MAP_WAIT_MS;
        Object found = null;
        while (SystemClock.elapsedRealtime() < deadline) {
            Object mapsObject = fieldValue(mapHost, "maps");
            if (mapsObject instanceof Map) {
                found = ((Map<?, ?>)mapsObject).get("main");
                if (found != null && fieldValue(found, "controller") != null && fieldValue(found, "renderState") instanceof JSONObject) return found;
            }
            SystemClock.sleep(300L);
        }
        return found;
    }

    private JSONObject readState() throws Exception { return (JSONObject)fieldValue(entry, "renderState"); }
    private String selectedId(JSONObject state) { String id = state.optString("annotationSelected", ""); return id.isEmpty() || "null".equals(id) ? "" : id; }
    private int annotationCount(JSONObject state) { JSONArray array = state.optJSONArray("annotations"); return array == null ? 0 : array.length(); }
    private String sourceId(JSONObject state) { JSONObject source = state.optJSONObject("mapSource"); return source == null ? "" : source.optString("id", ""); }
    private JSONObject invokeCameraJson() throws Exception {
        AtomicReference<JSONObject> out = new AtomicReference<>(); AtomicReference<Throwable> error = new AtomicReference<>();
        runOnMainSync(() -> { try { Method m = host.getClass().getDeclaredMethod("cameraJson", entry.getClass()); m.setAccessible(true); out.set((JSONObject)m.invoke(host, entry)); } catch (Throwable t) { error.set(t); } });
        if (error.get() != null) throw new IllegalStateException("camera snapshot failed", error.get()); return out.get();
    }
    private void applyCamera(JSONObject camera) throws Exception {
        AtomicReference<Throwable> error = new AtomicReference<>();
        runOnMainSync(() -> { try { Method m = host.getClass().getDeclaredMethod("runCamera", entry.getClass(), String.class, JSONObject.class); m.setAccessible(true); m.invoke(host, entry, "applyCamera", new JSONObject().put("camera", camera)); } catch (Throwable t) { error.set(t); } });
        if (error.get() != null) throw new IllegalStateException("camera apply failed", error.get());
    }
    private View worldWindowView() throws Exception {
        Object ww = findWorldWindow();
        if (ww instanceof View) return (View)ww;
        for (Field f : allFields(ww.getClass())) if (View.class.isAssignableFrom(f.getType())) { f.setAccessible(true); Object v = f.get(ww); if (v instanceof View) return (View)v; }
        throw new IllegalStateException("WorldWindow Android view unavailable");
    }
    private Object findWorldWindow() throws Exception {
        Object controller = fieldValue(entry, "controller");
        for (Field f : allFields(controller.getClass())) if ("earth.worldwind.WorldWindow".equals(f.getType().getName())) { f.setAccessible(true); return f.get(controller); }
        return null;
    }
    private String markerMode() throws Exception { Object value=fieldValue(fieldValue(entry,"controller"),"bridgeMarkerMode"); return value==null?"":String.valueOf(value); }
    private boolean markerExists(String id) throws Exception { Object map=fieldValue(fieldValue(entry,"controller"),"markers"); return map instanceof Map && ((Map<?,?>)map).containsKey(id); }
    private double[] unproject(double x, double y) throws Exception {
        Object controller = fieldValue(entry, "controller"); AtomicReference<Object> result = new AtomicReference<>(); AtomicReference<Throwable> error = new AtomicReference<>();
        runOnMainSync(() -> { try { for (Method m : controller.getClass().getDeclaredMethods()) if (m.getName().startsWith("unprojectCoordinate") && m.getParameterTypes().length == 2 && m.getParameterTypes()[0] == float.class) { m.setAccessible(true); result.set(m.invoke(controller, (float)x, (float)y)); break; } } catch (Throwable t) { error.set(t); } });
        if (error.get() != null) throw new IllegalStateException("actual terrain unprojection failed", error.get());
        Object pair = result.get(); if (pair == null) throw new IllegalStateException("screen location did not resolve to terrain");
        double lat = pairNumber(pair, "first", "getFirst");
        double lon = pairNumber(pair, "second", "getSecond");
        return new double[]{lat, lon};
    }
    private static double pairNumber(Object pair, String fieldName, String getterName) throws Exception {
        try { return ((Number)pair.getClass().getMethod(getterName).invoke(pair)).doubleValue(); }
        catch (ReflectiveOperationException ignored) { }
        for (Class<?> t = pair.getClass(); t != null; t = t.getSuperclass()) {
            try {
                Field f = t.getDeclaredField(fieldName); f.setAccessible(true);
                Object value = f.get(pair); if (value instanceof Number) return ((Number)value).doubleValue();
            } catch (NoSuchFieldException ignored) { }
        }
        throw new NoSuchFieldException(pair.getClass().getName() + "." + fieldName);
    }
    private double viewportScale() throws Exception { JSONObject viewport = (JSONObject)fieldValue(entry, "viewport"); return viewport == null ? 1.0 : viewport.optDouble("cssScale", 1.0); }
    private long frameCount() throws Exception { Object n=fieldValue(entry,"actualFrameCount"); if(n instanceof java.util.concurrent.atomic.AtomicLong)return ((java.util.concurrent.atomic.AtomicLong)n).get(); return n instanceof Number?((Number)n).longValue():-1; }
    private void awaitFrames(int count, long timeout) throws Exception { long base=frameCount(); long end=SystemClock.elapsedRealtime()+timeout; while(SystemClock.elapsedRealtime()<end) { long now=frameCount(); if(base>=0&&now-base>=count)return; SystemClock.sleep(100); } throw new IllegalStateException("native frame did not advance"); }
    private String readStorage() throws Exception {
        String raw = evalJs("localStorage.getItem(" + JSONObject.quote(STORAGE_KEY) + ") || '[]'");
        Object parsed = new JSONTokener(raw).nextValue(); if (!(parsed instanceof JSONArray)) throw new IllegalStateException("annotation storage was not an array"); return raw;
    }
    private void writeStorageAppend(JSONArray add) throws Exception {
        String script = "(()=>{const k="+JSONObject.quote(STORAGE_KEY)+",o=localStorage.getItem(k),a=JSON.parse(o||'[]'),n="+add.toString()+";localStorage.setItem(k,JSON.stringify(a.concat(n)));const v=localStorage.getItem(k);window.dispatchEvent(new StorageEvent('storage',{key:k,oldValue:o,newValue:v,storageArea:localStorage}));window.dispatchEvent(new Event('guanyun-data-changed'));return 'ok'})()";
        if (!"ok".equals(evalJs(script))) throw new IllegalStateException("QA fixtures were not inserted");
    }
    private void removeOnlyQaIds() throws Exception {
        String ids = new JSONArray(qaIds).toString();
        String script = "(()=>{const k="+JSONObject.quote(STORAGE_KEY)+",o=localStorage.getItem(k),a=JSON.parse(o||'[]'),ids=new Set("+ids+");localStorage.setItem(k,JSON.stringify(a.filter(x=>!ids.has(x.id))));const v=localStorage.getItem(k);window.dispatchEvent(new StorageEvent('storage',{key:k,oldValue:o,newValue:v,storageArea:localStorage}));window.dispatchEvent(new Event('guanyun-data-changed'));return 'ok'})()";
        evalJs(script); long end=SystemClock.elapsedRealtime()+10_000; while(SystemClock.elapsedRealtime()<end) { boolean found=false; JSONArray a=new JSONArray(readStorage()); for(int i=0;i<a.length();i++) if(qaIds.contains(a.optJSONObject(i)==null?"":a.optJSONObject(i).optString("id")))found=true; if(!found)return; SystemClock.sleep(150); }
        throw new IllegalStateException("QA fixture cleanup did not settle");
    }
    private int countQaIdsInStorage() { try { JSONArray a=new JSONArray(readStorage()); int n=0; for(int i=0;i<a.length();i++){JSONObject x=a.optJSONObject(i);if(x!=null&&qaIds.contains(x.optString("id")))n++;}return n;}catch(Throwable t){return -1;} }
    private void awaitAnnotations(List<String> ids, long timeout) throws Exception { long end=SystemClock.elapsedRealtime()+timeout; while(SystemClock.elapsedRealtime()<end){JSONArray a=readState().optJSONArray("annotations"); boolean all=a!=null; if(all)for(String id:ids){boolean found=false;for(int i=0;i<a.length();i++)if(id.equals(a.optJSONObject(i)==null?"":a.optJSONObject(i).optString("id")))found=true;if(!found)all=false;} if(all)return;SystemClock.sleep(150);}throw new IllegalStateException("React/native annotation sync timed out"); }
    private String awaitSelection(String expected,long timeout) throws Exception { long end=SystemClock.elapsedRealtime()+timeout; String current=""; while(SystemClock.elapsedRealtime()<end){current=selectedId(readState());if(expected.equals(current))return current;SystemClock.sleep(50);}return current; }
    private void tap(float x,float y) { long t=SystemClock.uptimeMillis(); MotionEvent down=MotionEvent.obtain(t,t,MotionEvent.ACTION_DOWN,x,y,0); down.setSource(android.view.InputDevice.SOURCE_TOUCHSCREEN); sendPointerSync(down); down.recycle(); MotionEvent up=MotionEvent.obtain(t,t+45,MotionEvent.ACTION_UP,x,y,0); up.setSource(android.view.InputDevice.SOURCE_TOUCHSCREEN); sendPointerSync(up); up.recycle(); }
    private JSONObject awaitVisiblePinFixtures(int[] origin, double[][] points, double cssScale, String[] hexColors, long timeoutMs) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + timeoutMs;
        JSONArray lastCounts = new JSONArray();
        boolean nativeRenderablesReady = false;
        while (SystemClock.elapsedRealtime() < deadline) {
            nativeRenderablesReady = true;
            for (String id : qaIds) nativeRenderablesReady &= markerExists(id);
            Bitmap bitmap = getUiAutomation().takeScreenshot();
            if (bitmap != null) {
                JSONArray counts = new JSONArray();
                boolean allVisible = nativeRenderablesReady;
                for (int i = 0; i < qaIds.size(); i++) {
                    int expected = (int)Long.parseLong(hexColors[i].substring(1), 16);
                    int centerX = origin[0] + (int)Math.round(points[i][0]);
                    int centerY = origin[1] + (int)Math.round(points[i][1] - 11.0 * cssScale);
                    int radius = Math.max(80, (int)Math.ceil(56.0 * cssScale));
                    int count = countColorNear(bitmap, centerX, centerY, radius, expected, 48);
                    counts.put(count);
                    if (count < 8) allVisible = false;
                }
                lastCounts = counts;
                if (allVisible) {
                    String filename = saveScreenshot(bitmap, "fixtures-visible");
                    JSONObject ready = new JSONObject().put("state", "ALL_FIXTURE_COLORS_VISIBLE_IN_NATIVE_SCREENSHOT")
                        .put("nativeRenderableEntriesPresent", nativeRenderablesReady).put("colorPixelCounts", counts)
                        .put("minimumPixelsPerColor", 8).put("screenshot", filename).put("elapsedMs", timeoutMs - Math.max(0, deadline - SystemClock.elapsedRealtime()));
                    bitmap.recycle();
                    return ready;
                }
                bitmap.recycle();
            }
            SystemClock.sleep(180L);
        }
        throw new IllegalStateException("QA marker render readiness timeout; nativeEntries=" + nativeRenderablesReady + "; colorPixels=" + lastCounts);
    }
    private static int countColorNear(Bitmap bitmap, int centerX, int centerY, int radius, int expectedRgb, int tolerance) {
        int left = Math.max(0, centerX - radius), top = Math.max(0, centerY - radius);
        int right = Math.min(bitmap.getWidth() - 1, centerX + radius), bottom = Math.min(bitmap.getHeight() - 1, centerY + radius);
        if (left > right || top > bottom) return 0;
        int count = 0;
        int er = (expectedRgb >> 16) & 0xff, eg = (expectedRgb >> 8) & 0xff, eb = expectedRgb & 0xff;
        for (int y = top; y <= bottom; y += 2) for (int x = left; x <= right; x += 2) {
            int pixel = bitmap.getPixel(x, y);
            if (((pixel >>> 24) & 0xff) > 128 && Math.abs(((pixel >> 16) & 0xff) - er) <= tolerance &&
                Math.abs(((pixel >> 8) & 0xff) - eg) <= tolerance && Math.abs((pixel & 0xff) - eb) <= tolerance) count++;
        }
        return count;
    }
    private JSONObject probeNativePick(float x,float y,float halfExtent) throws Exception {
        JSONObject out = new JSONObject();
        out.put("pointIds", pickIds(new RectF(x, y, x, y)));
        out.put("44CssRectIds", pickIds(new RectF(x-halfExtent, y-halfExtent, x+halfExtent, y+halfExtent)));
        return out;
    }
    private JSONArray pickIds(RectF rect) throws Exception {
        Object controller = fieldValue(entry, "controller");
        Class<?> function1 = controller.getClass().getClassLoader().loadClass("kotlin.jvm.functions.Function1");
        CountDownLatch latch = new CountDownLatch(1); AtomicReference<List<?>> result = new AtomicReference<>();
        InvocationHandler handler = (proxy, method, args) -> {
            if ("invoke".equals(method.getName())) { if (args != null && args.length > 0 && args[0] instanceof List) result.set((List<?>)args[0]); latch.countDown(); }
            Class<?> unit = method.getReturnType();
            if (unit.getName().equals("kotlin.Unit")) return unit.getField("INSTANCE").get(null);
            return null;
        };
        Object callback = Proxy.newProxyInstance(function1.getClassLoader(), new Class<?>[]{function1}, handler);
        Method pick = null;
        for (Method method : controller.getClass().getDeclaredMethods()) if (method.getName().startsWith("pickObjectIds") && method.getParameterTypes().length == 2 && method.getParameterTypes()[0] == RectF.class) { pick = method; break; }
        if (pick == null) throw new NoSuchMethodException("controller.pickObjectIds(RectF, callback)");
        pick.setAccessible(true); Method selected = pick;
        AtomicReference<Throwable> invocationError = new AtomicReference<>();
        runOnMainSync(() -> { try { selected.invoke(controller, rect, callback); } catch (Throwable error) { invocationError.set(error); } });
        if (invocationError.get() != null) throw new IllegalStateException("native GPU pick invocation failed", invocationError.get());
        if (!latch.await(5, TimeUnit.SECONDS)) throw new IllegalStateException("native GPU pick timed out");
        JSONArray ids = new JSONArray(); if (result.get() != null) for (Object id : result.get()) if (id instanceof String) ids.put(id);
        return ids;
    }
    private void runEndpointUiFollowUp(int[] mapOrigin, double[] qaAPoint, double cssScale) throws Exception {
        JSONObject card = awaitSelectionTools(true, 5_000L);
        awaitWebViewDraw();
        steps.put(new JSONObject().put("name", "follow-up-card-before-start").put("selectionTools", card).put("screenshot", capture("follow-up-card-start")));

        JSONObject startButton = tapDomButton(".selection-tools-route-actions button", "设为起点", cssScale);
        JSONObject startInput = awaitRouteInput("起点", "QA-PIN-A", 10_000L);
        awaitWebViewDraw();
        steps.put(new JSONObject().put("name", "follow-up-set-start").put("button", startButton).put("routeInput", startInput)
            .put("pass", true).put("screenshot", capture("follow-up-route-start")));

        JSONObject closeStart = tapDomButton("button[aria-label='关闭面板']", "关闭面板", cssScale);
        JSONObject cardAfterStart = awaitSelectionTools(true, 5_000L);
        awaitWebViewDraw();
        steps.put(new JSONObject().put("name", "follow-up-return-after-start").put("closeButton", closeStart)
            .put("selectionTools", cardAfterStart).put("screenshot", capture("follow-up-return-start")));

        JSONObject finishFirst = tapDomButton(".selection-tools button", "完成调整", cssScale);
        awaitSelectionTools(false, 5_000L);
        tap(mapOrigin[0] + (float)qaAPoint[0], mapOrigin[1] + (float)(qaAPoint[1] - 11.0 * cssScale));
        String reselectedForEnd = awaitSelection(qaIds.get(0), 5_000L);
        SystemClock.sleep(250L);
        if (!qaIds.get(0).equals(reselectedForEnd)) throw new IllegalStateException("QA-A reselection failed before end route input");
        awaitWebViewDraw();
        steps.put(new JSONObject().put("name", "follow-up-reselect-A-for-end").put("clearedSelectionBy", finishFirst)
            .put("selectedId", reselectedForEnd).put("selectionTools", readSelectionTools()).put("screenshot", capture("follow-up-reselect-A-end")));

        JSONObject endButton = tapDomButton(".selection-tools-route-actions button", "设为终点", cssScale);
        JSONObject endInput = awaitRouteInput("终点", "QA-PIN-A", 10_000L);
        awaitWebViewDraw();
        steps.put(new JSONObject().put("name", "follow-up-set-end").put("button", endButton).put("routeInput", endInput)
            .put("pass", true).put("screenshot", capture("follow-up-route-end")));

        JSONObject closeEnd = tapDomButton("button[aria-label='关闭面板']", "关闭面板", cssScale);
        awaitSelectionTools(true, 5_000L);
        awaitWebViewDraw();
        JSONObject finishSecond = tapDomButton(".selection-tools button", "完成调整", cssScale);
        awaitSelectionTools(false, 5_000L);
        tap(mapOrigin[0] + (float)qaAPoint[0], mapOrigin[1] + (float)(qaAPoint[1] - 11.0 * cssScale));
        String finalSelection = awaitSelection(qaIds.get(0), 5_000L);
        SystemClock.sleep(250L);
        awaitWebViewDraw();
        steps.put(new JSONObject().put("name", "follow-up-return-and-reselect-A").put("closeButton", closeEnd)
            .put("clearedSelectionBy", finishSecond).put("selectedId", finalSelection)
            .put("pass", qaIds.get(0).equals(finalSelection)).put("selectionTools", readSelectionTools())
            .put("screenshot", capture("follow-up-return-reselect-A")));
    }
    private JSONObject awaitSelectionTools(boolean expectedVisible, long timeoutMs) throws Exception {
        long end = SystemClock.elapsedRealtime() + timeoutMs;
        JSONObject last = new JSONObject();
        while (SystemClock.elapsedRealtime() < end) {
            last = readSelectionTools();
            boolean exists = last.optBoolean("exists");
            boolean visible = last.optBoolean("visible");
            if (expectedVisible ? exists && visible : !exists || !visible) return last;
            SystemClock.sleep(100L);
        }
        throw new IllegalStateException("selection tools visibility did not reach " + expectedVisible + ": " + last.optBoolean("exists") + "/" + last.optBoolean("visible"));
    }
    private JSONObject tapDomButton(String selector, String exactText, double cssScale) throws Exception {
        long end = SystemClock.elapsedRealtime() + 5_000L;
        JSONObject info = new JSONObject();
        while (SystemClock.elapsedRealtime() < end) {
            String script = "(()=>{const roots=Array.from(document.querySelectorAll(" + JSONObject.quote(selector) + "));if(!roots.length)return JSON.stringify({found:false});"
                + "const candidates=[];for(const root of roots){if(root.matches('button'))candidates.push(root);candidates.push(...root.querySelectorAll('button'))}"
                + "const b=Array.from(new Set(candidates)).find(x=>(x.innerText||x.getAttribute('aria-label')||'').trim()===" + JSONObject.quote(exactText) + ");"
                + "if(!b)return JSON.stringify({found:false});const r=b.getBoundingClientRect(),s=getComputedStyle(b),x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);"
                + "return JSON.stringify({found:true,text:(b.innerText||b.getAttribute('aria-label')||'').trim(),disabled:!!b.disabled,visible:s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)!==0&&r.width>0&&r.height>0,hit:hit===b||!!hit?.closest('button')&&hit.closest('button')===b,rect:{x:r.x,y:r.y,width:r.width,height:r.height},point:{x,y}})})()";
            info = new JSONObject(evalJs(script));
            if (info.optBoolean("found") && info.optBoolean("visible")) break;
            SystemClock.sleep(100L);
        }
        if (!info.optBoolean("found") || !info.optBoolean("visible") || info.optBoolean("disabled") || !info.optBoolean("hit"))
            throw new IllegalStateException("UI button unavailable or not hit-testable: " + exactText);
        JSONObject point = info.getJSONObject("point");
        int[] webOrigin = new int[2];
        runOnMainSync(() -> webView.getLocationOnScreen(webOrigin));
        float x = webOrigin[0] + (float)(point.getDouble("x") * cssScale);
        float y = webOrigin[1] + (float)(point.getDouble("y") * cssScale);
        info.put("injectedScreenPx", new JSONArray().put(x).put(y));
        tap(x, y);
        return info;
    }
    private void awaitWebViewDraw() throws Exception {
        CountDownLatch drawLatch = new CountDownLatch(1);
        long requestId = SystemClock.uptimeMillis();
        runOnMainSync(() -> webView.postVisualStateCallback(requestId, new WebView.VisualStateCallback() {
            @Override public void onComplete(long ignored) { webView.postOnAnimation(drawLatch::countDown); }
        }));
        if (!drawLatch.await(4, TimeUnit.SECONDS)) throw new IllegalStateException("WebView visual state draw timed out");
        SystemClock.sleep(140L);
    }
    private JSONObject awaitRouteInput(String label, String expected, long timeoutMs) throws Exception {
        long end = SystemClock.elapsedRealtime() + timeoutMs;
        JSONObject last = new JSONObject();
        String script = "(()=>{const panel=document.querySelector('#map-control-panel .route-panel'),i=panel&&Array.from(panel.querySelectorAll('input')).find(x=>x.getAttribute('aria-label')==="
            + JSONObject.quote(label) + ");if(!i)return JSON.stringify({found:false});const r=i.getBoundingClientRect(),s=getComputedStyle(i);return JSON.stringify({found:true,label:i.getAttribute('aria-label'),value:i.value,visible:s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)!==0&&r.width>0&&r.height>0,rect:{x:r.x,y:r.y,width:r.width,height:r.height},routePanelVisible:!!panel})})()";
        while (SystemClock.elapsedRealtime() < end) {
            last = new JSONObject(evalJs(script));
            if (last.optBoolean("found") && last.optBoolean("visible") && expected.equals(last.optString("value"))) return last;
            SystemClock.sleep(100L);
        }
        throw new IllegalStateException("route endpoint input did not match expected marker name for " + label + ": " + last.optString("value"));
    }
    private String capture(String name) throws Exception { Bitmap bitmap=getUiAutomation().takeScreenshot(); if(bitmap==null)return "SCREENSHOT_UNAVAILABLE"; String file=saveScreenshot(bitmap,name); bitmap.recycle(); return file; }
    private String saveScreenshot(Bitmap bitmap,String name) throws Exception { File out=new File(evidenceDir,name+".png"); try(FileOutputStream stream=new FileOutputStream(out)){bitmap.compress(Bitmap.CompressFormat.PNG,100,stream);} return out.getName(); }
    private String evalJs(String script) throws Exception { CountDownLatch latch=new CountDownLatch(1); AtomicReference<String> value=new AtomicReference<>(); runOnMainSync(()->webView.evaluateJavascript(script,v->{value.set(v);latch.countDown();})); if(!latch.await(8,TimeUnit.SECONDS))throw new IllegalStateException("WebView JS timed out"); Object decoded=new JSONTokener(value.get()).nextValue(); return decoded instanceof String?(String)decoded:String.valueOf(decoded); }
    private static String safeError(String message) { if(message==null)return ""; String safe=message.replaceAll("(?i)https?://\\S+","[redacted-url]").replaceAll("(?i)(token|api.?key|tk)=?[^\\s&]+","$1=[redacted]"); return safe.substring(0,Math.min(300,safe.length())); }
    private static JSONArray errorDetails(Throwable error) {
        JSONArray out = new JSONArray();
        Throwable current = error;
        for (int depth = 0; current != null && depth < 4; depth++, current = current.getCause()) {
            JSONObject item = new JSONObject();
            try {
                item.put("type", current.getClass().getName()).put("message", safeError(current.getMessage()));
                JSONArray frames = new JSONArray();
                StackTraceElement[] stack = current.getStackTrace();
                for (int i = 0; i < Math.min(6, stack.length); i++) {
                    StackTraceElement frame = stack[i];
                    frames.put(new JSONObject().put("class", frame.getClassName()).put("method", frame.getMethodName()).put("line", frame.getLineNumber()));
                }
                item.put("frames", frames);
                out.put(item);
            } catch (JSONException ignored) { }
        }
        return out;
    }
    private JSONArray readVisibleControls() throws Exception { String script="(()=>JSON.stringify(Array.from(document.querySelectorAll('button,[role=button]')).filter(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)!==0&&r.width>0&&r.height>0}).slice(0,100).map(e=>{const r=e.getBoundingClientRect();let t=(e.innerText||e.getAttribute('aria-label')||'').trim().slice(0,60);if(/https?:\\/\\/|token|api.?key/i.test(t))t='[redacted]';return{text:t,x:r.x,y:r.y,width:r.width,height:r.height}})))()"; String raw=evalJs(script); return new JSONArray(raw); }
    private JSONObject readSelectionTools() throws Exception {
        String script = "(()=>{const e=document.querySelector('.selection-tools');if(!e)return JSON.stringify({exists:false});"
            + "const describe=n=>{if(!n)return null;const r=n.getBoundingClientRect(),s=getComputedStyle(n);return{tag:n.tagName,id:n.id||'',className:typeof n.className==='string'?n.className:'',text:(n.innerText||n.textContent||'').trim().slice(0,100),"
            + "rect:{x:r.x,y:r.y,width:r.width,height:r.height},display:s.display,visibility:s.visibility,opacity:s.opacity,zIndex:s.zIndex,clipPath:s.clipPath,transform:s.transform,overflow:s.overflow,position:s.position}};"
            + "const r=e.getBoundingClientRect(),s=getComputedStyle(e),visible=s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)!==0&&r.width>0&&r.height>0;"
            + "const text=(e.innerText||'').trim().slice(0,300),buttons=Array.from(e.querySelectorAll('button')).map(b=>({text:(b.innerText||b.getAttribute('aria-label')||'').trim().slice(0,50),disabled:!!b.disabled}));"
            + "const chain=[];for(let n=e;n&&chain.length<12;n=n.parentElement)chain.push(describe(n));"
            + "const center={x:r.left+r.width/2,y:r.top+r.height/2},title=e.querySelector('strong'),tr=title?title.getBoundingClientRect():null;"
            + "const centerHit=describe(document.elementFromPoint(center.x,center.y)),titleHit=tr?describe(document.elementFromPoint(tr.left+tr.width/2,tr.top+tr.height/2)):null;"
            + "return JSON.stringify({exists:true,visible,text,rect:{x:r.x,y:r.y,width:r.width,height:r.height},style:{display:s.display,visibility:s.visibility,opacity:s.opacity,zIndex:s.zIndex,clipPath:s.clipPath,transform:s.transform,overflow:s.overflow,position:s.position},ancestorChain:chain,elementFromPointCenter:centerHit,elementFromPointTitle:titleHit,buttons,hasStart:buttons.some(b=>b.text.includes('设为起点')),hasEnd:buttons.some(b=>b.text.includes('设为终点'))})})()";
        return new JSONObject(evalJs(script));
    }
    private static Object fieldValue(Object object,String name)throws Exception { for(Class<?> t=object.getClass();t!=null;t=t.getSuperclass())try{Field f=t.getDeclaredField(name);f.setAccessible(true);return f.get(object);}catch(NoSuchFieldException ignored){} throw new NoSuchFieldException(object.getClass().getName()+"."+name); }
    private static List<Field> allFields(Class<?> type){List<Field> out=new ArrayList<>();for(Class<?> t=type;t!=null;t=t.getSuperclass())for(Field f:t.getDeclaredFields())out.add(f);return out;}
    private static void collectWebViews(View view,List<WebView> out){if(view instanceof WebView)out.add((WebView)view);if(view instanceof ViewGroup){ViewGroup g=(ViewGroup)view;for(int i=0;i<g.getChildCount();i++)collectWebViews(g.getChildAt(i),out);}}
}
