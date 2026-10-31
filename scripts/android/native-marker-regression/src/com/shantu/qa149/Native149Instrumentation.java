package com.shantu.qa149;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.os.Environment;
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
                JSONObject report = "native-regression".equals(mode) ? runRegression() : inspect();
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
