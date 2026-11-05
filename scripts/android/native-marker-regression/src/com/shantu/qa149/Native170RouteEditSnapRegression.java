package com.shantu.qa149;

import android.os.SystemClock;
import android.view.InputDevice;
import android.view.MotionEvent;
import android.view.View;
import org.json.JSONArray;
import org.json.JSONObject;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;

/** Real UI only: one newly drawn QA route, real node drags, and deletion of that exact ID. */
public final class Native170RouteEditSnapRegression {
    private Native170RouteEditSnapRegression() { }
    public static JSONObject run(Native149Instrumentation parent) { return new Runner(parent).run(); }

    private static final class P {
        final double x, y;
        P(double x, double y) { this.x = x; this.y = y; }
        P plus(double x, double y) { return new P(this.x + x, this.y + y); }
    }
    private static final class Segment {
        final P a, b;
        Segment(P a, P b) { this.a = a; this.b = b; }
    }
    private static final class Target {
        P roadAim, freeAim;
        P[] initial;
        List<Segment> segments;
    }
    private static final class Failure extends Exception {
        final String stage, code;
        Failure(String stage, String code) { super(code); this.stage = stage; this.code = code; }
    }
    private interface Condition { boolean ok() throws Exception; }

    private static final class Runner {
        final Native149Instrumentation parent;
        final JSONObject report = new JSONObject();
        final JSONArray cases = new JSONArray();
        String stage = "precondition", qaId = "";
        JSONObject originalCamera;
        boolean authorizedQa = false, saveInvoked = false, originalRoad, originalRiver, originalNode;
        double scale, width, height;
        int[] origin = new int[2];
        View map;
        List<double[]> expectedSavedCoordinates;
        Runner(Native149Instrumentation parent) { this.parent = parent; }

        JSONObject run() {
            put(report, "test", "native170-route-edit-snap"); put(report, "schemaVersion", 1);
            put(report, "gpsWritten", false); put(report, "existingRouteWrites", false);
            put(report, "crossRouteJoinTested", false); put(report, "wholeRouteRerouteTested", false);
            put(report, "cases", cases);
            try {
                if (parent == null) fail("instrumentation-unavailable");
                if (!Boolean.TRUE.equals(old("targetAlreadyAttached", parent))) call("attachTarget");
                JSONObject initial = state(), overlay = initial.optJSONObject("trackOverlay");
                JSONObject interaction = initial.optJSONObject("interaction");
                JSONArray annotations = initial.optJSONArray("annotations");
                JSONArray saved = overlay == null ? null : overlay.optJSONArray("saved"), draft = overlay == null ? null : overlay.optJSONArray("draft");
                if (saved == null || saved.length() != 0 || draft == null || pointCount(draft) != 0 || storageCount() != 0 ||
                    interaction == null || !interaction.optBoolean("drawingActive") || !empty(overlay.optString("movableTrackId")) ||
                    !empty(overlay.optString("selectedId")) || overlay.optBoolean("connecting") || !empty(initial.optString("annotationSelected")) ||
                    annotations == null || annotations.length() != 0 ||
                    visible(".route-edit-dock") || !visible(".track-tools") || visible(".map-comparison")) fail("requires-empty-store-and-active-empty-drawing-no-other-edit");
                originalRoad = pressed(".track-tools", "道路吸附");
                originalRiver = pressed(".track-tools", "河流吸附");
                originalNode = pressed(".track-tools", "节点吸附");
                originalCamera = (JSONObject)call("invokeCameraJson");
                map = (View)call("worldWindowView"); scale = ((Number)old("rendererCssScale", parent)).doubleValue();
                parent.runOnMainSync(() -> map.getLocationOnScreen(origin));
                width = map.getWidth() / scale; height = map.getHeight() / scale;
                if (!Double.isFinite(scale) || scale <= 0 || width < 320 || height < 700) fail("viewport-too-small");
                authorizedQa = true;
                stage = "research-camera";
                call("applyCamera", new JSONObject().put("center", new JSONArray().put(104.0668).put(30.5728))
                    .put("zoom", 17.0).put("pitch", 0.0).put("bearing", 0.0));
                call("awaitFrames", 2, 10_000L);
                setToggle(".track-tools", "河流吸附", false);
                setToggle(".track-tools", "节点吸附", false);
                setToggle(".track-tools", "道路吸附", true);
                stage = "choose-real-road-target";
                Target target = chooseTarget(projectRoads());
                put(report, "roadTarget", new JSONObject().put("roadAimCss", point(target.roadAim))
                    .put("offRoadAimCss", point(target.freeAim)).put("source", "fresh-native-MVT-rendered-ground")
                    .put("rawRoadAimOffsetCssPx", nearest(target.roadAim, target.segments)));
                setToggle(".track-tools", "道路吸附", false);
                stage = "draw-three-qa-points";
                for (int i = 0; i < target.initial.length; i++) {
                    drawPoint(target.initial[i]); final int expected = i + 1;
                    await(() -> pointCount(state().getJSONObject("trackOverlay").getJSONArray("draft")) == expected, 5_000L, "draft-point-not-committed");
                }
                stage = "save-qa-route-by-complete";
                expectedSavedCoordinates = coordinates(new JSONObject().put("segments", state().getJSONObject("trackOverlay").getJSONArray("draft")));
                saveInvoked = true; tap(".track-tools button", "完成");
                await(() -> saved().length() == 1 && storageCount() == 1, 7_000L, "qa-route-not-saved");
                if (!matchesExpected(saved().getJSONObject(0))) fail("saved-route-does-not-match-qa-drawing");
                qaId = saved().getJSONObject(0).getString("id"); assertOwned();
                put(report, "qaRouteId", qaId);
                if (coordinates(owned()).size() != 3) fail("qa-route-was-not-three-points");
                stage = "enter-real-route-editor";
                tap(".home-route-card button", "编辑");
                await(() -> visible(".route-edit-dock") && qaId.equals(state().getJSONObject("trackOverlay").optString("movableTrackId")), 5_000L, "editor-not-entered");
                setToggle(".route-edit-mode-row", "河道吸附", false);
                setToggle(".route-edit-mode-row", "节点吸附", false);
                setToggle(".route-edit-mode-row", "道路吸附", true);
                stage = "road-on";
                stage = "road-on-fresh-geometry";
                target = chooseTarget(projectRoads());
                stage = "road-on-drag";
                double[] first = coordinates(owned()).get(0);
                JSONObject road = drag(first, target.roadAim);
                double[] afterRoad = activeCoordinate(); P roadPoint = project(afterRoad);
                double roadDistance = nearest(roadPoint, target.segments), rawDistance = distance(roadPoint, target.roadAim);
                boolean roadPass = road.optBoolean("statusVisible") && road.optString("status").contains("已吸附道路") &&
                    roadDistance <= 2.0 && rawDistance >= 2.0 && !contains(owned(), first) && contains(owned(), afterRoad);
                road.put("case", "road-on").put("committedDistanceToMvtCssPx", roadDistance)
                    .put("committedDistanceToRawAimCssPx", rawDistance).put("pass", roadPass); cases.put(road);
                stage = "road-off";
                setToggle(".route-edit-mode-row", "道路吸附", false);
                JSONObject off = drag(afterRoad, target.freeAim);
                double[] afterFree = activeCoordinate(); double freeError = distance(project(afterFree), target.freeAim);
                boolean offPass = !pressed(".route-edit-mode-row", "道路吸附") && freeError <= 2.0 &&
                    !off.optString("status").contains("已吸附道路") && !contains(owned(), afterRoad);
                off.put("case", "road-off").put("committedDistanceToRawAimCssPx", freeError).put("pass", offPass); cases.put(off);
                stage = "same-route-node-snap";
                setToggle(".route-edit-mode-row", "节点吸附", true);
                double[] other = null;
                for (double[] candidate : coordinates(owned())) if (!equal(candidate, afterFree) && distance(project(candidate), project(afterFree)) > 25) { other = candidate; break; }
                if (other == null) fail("qa-route-has-no-separated-node-target");
                P nodeAim = project(other).plus(6, 0);
                JSONObject node = drag(afterFree, nodeAim);
                double[] afterNode = activeCoordinate();
                boolean nodePass = equal(afterNode, other) && !contains(owned(), afterFree) && node.optBoolean("statusVisible") &&
                    node.optString("status").contains("松手拼合");
                node.put("case", "same-route-node-coordinate-snap").put("committedCoordinateEqualsExistingNode", equal(afterNode, other))
                    .put("crossRouteJoinTested", false).put("pass", nodePass); cases.put(node);
                put(report, "testState", roadPass && offPass && nodePass ? "PASS" : "FAIL");
            } catch (Throwable error) {
                try {
                    JSONObject interactionNow = state().optJSONObject("interaction");
                    put(report, "failureInteraction", new JSONObject().put("road", interactionNow != null && interactionNow.optBoolean("roadSnapping"))
                        .put("river", interactionNow != null && interactionNow.optBoolean("riverSnapping")));
                    Object currentEntry = field(parent, "entry");
                    JSONObject freshness = (JSONObject)old("roadSnapshotFreshness", parent, field(currentEntry, "snapGeometry"), currentEntry);
                    freshness.remove("payload"); put(report, "failureFreshness", freshness);
                } catch (Throwable ignored) { }
                put(report, "testState", authorizedQa ? "ERROR" : "PRECONDITION_BLOCKED"); failure(report, "failure", error);
            } finally {
                if (authorizedQa) {
                    JSONObject cleanup = cleanup(); put(report, "cleanup", cleanup);
                    if (!cleanup.optBoolean("pass")) put(report, "testState", "FAIL");
                } else put(report, "cleanup", "NOT_STARTED");
            }
            return report;
        }

        private JSONObject cleanup() {
            JSONObject result = new JSONObject(); boolean data = false, preferences = false, camera = false;
            stage = "cleanup";
            try {
                // A save may have completed immediately before a read/await failed. Claim only
                // the sole newly created ID, with our known three-point drawing and empty initial store.
                if (qaId.isEmpty() && saveInvoked && saved().length() == 1 && storageCount() == 1 && matchesExpected(saved().getJSONObject(0)))
                    qaId = saved().getJSONObject(0).getString("id");
                if (!qaId.isEmpty()) {
                    assertOwned();
                    if (visible(".route-unsaved")) tap(".route-unsaved button", "不保存并退出");
                    else if (visible(".route-edit-dock")) {
                        tap(".route-edit-dock button", "退出编辑");
                        await(() -> visible(".route-unsaved") || !visible(".route-edit-dock"), 3_000L, "editor-exit-not-ready");
                        if (visible(".route-unsaved")) tap(".route-unsaved button", "不保存并退出");
                    }
                    await(() -> !visible(".route-edit-dock") && !visible(".route-unsaved"), 4_000L, "editor-not-closed");
                    assertOwned();
                    if (!qaId.equals(state().getJSONObject("trackOverlay").optString("selectedId"))) fail("qa-route-not-current-delete-target");
                    tap(".home-route-card button", "删除"); assertOwned();
                    tap(".home-route-delete-confirm button", "确认删除");
                    await(() -> saved().length() == 0 && storageCount() == 0, 5_000L, "qa-route-delete-not-confirmed");
                } else {
                    if (saved().length() != 0 || storageCount() != 0) fail("unknown-route-prevents-cleanup");
                    old("clearQaDraft", parent, scale, 0);
                }
                data = saved().length() == 0 && storageCount() == 0 && pointCount(state().getJSONObject("trackOverlay").getJSONArray("draft")) == 0;
                if (!data) fail("qa-data-remains");
                if (!visible(".track-tools")) tap(".home-bottom-nav button[data-panel-toggle='track']", "画线");
                await(() -> visible(".track-tools"), 4_000L, "drawing-tools-not-restored");
                setToggle(".track-tools", "道路吸附", false); setToggle(".track-tools", "河流吸附", false);
                setToggle(".track-tools", "道路吸附", originalRoad); setToggle(".track-tools", "河流吸附", originalRiver);
                setToggle(".track-tools", "节点吸附", originalNode);
                preferences = pressed(".track-tools", "道路吸附") == originalRoad && pressed(".track-tools", "河流吸附") == originalRiver &&
                    pressed(".track-tools", "节点吸附") == originalNode;
            } catch (Throwable error) { failure(result, "dataOrPreferenceFailure", error); }
            try {
                call("applyCamera", originalCamera); call("awaitFrames", 2, 10_000L);
                JSONObject actual = (JSONObject)call("invokeCameraJson");
                camera = ((Number)old("panCameraDistance", originalCamera, actual)).doubleValue() <= 0.1 &&
                    Math.abs(actual.getDouble("zoom") - originalCamera.getDouble("zoom")) <= 0.001 &&
                    Math.abs(actual.getDouble("pitch") - originalCamera.getDouble("pitch")) <= 0.001 &&
                    Math.abs(actual.getDouble("bearing") - originalCamera.getDouble("bearing")) <= 0.001;
            } catch (Throwable error) { failure(result, "cameraFailure", error); }
            put(result, "qaOnlyRouteRemovedAndDraftEmpty", data); put(result, "preferencesRestored", preferences);
            put(result, "cameraRestored", camera); put(result, "pass", data && preferences && camera); return result;
        }

        private JSONObject drag(double[] from, P aim) throws Exception {
            assertOwned(); P start = project(from); if (!safe(start) || !safe(aim) || distance(start, aim) < 5) fail("unsafe-node-drag");
            long time = SystemClock.uptimeMillis(); boolean active = true; P last = start;
            JSONObject status;
            try {
                touch(MotionEvent.ACTION_DOWN, time, start);
                await(() -> { JSONObject preview = state().getJSONObject("trackOverlay").optJSONObject("preview");
                    JSONObject node = preview == null ? null : preview.optJSONObject("node");
                    return node != null && qaId.equals(node.optString("trackId")) && node.optJSONArray("coordinate") != null && equal(pair(node.getJSONArray("coordinate")), from);
                }, 3_000L, "real-node-drag-did-not-activate");
                for (int i = 1; i <= 10; i++) {
                    last = new P(start.x + (aim.x - start.x) * i / 10, start.y + (aim.y - start.y) * i / 10);
                    touch(MotionEvent.ACTION_MOVE, time, last); SystemClock.sleep(45L);
                }
                SystemClock.sleep(180L); status = status();
                JSONObject preview = state().getJSONObject("trackOverlay").optJSONObject("preview");
                status.put("nativePreviewPresent", preview != null).put("startCss", point(start)).put("aimCss", point(aim));
                touch(MotionEvent.ACTION_UP, time, aim); active = false;
            } finally { if (active) touch(MotionEvent.ACTION_CANCEL, time, last); }
            await(() -> { JSONObject node = state().getJSONObject("trackOverlay").optJSONObject("activeNode");
                return node != null && node.optJSONArray("coordinate") != null && !equal(pair(node.getJSONArray("coordinate")), from); }, 4_000L, "drag-did-not-commit-a-new-node-position");
            assertOwned(); return status;
        }
        private void drawPoint(P aim) throws Exception {
            P finger = aim.plus(0, 44); long time = SystemClock.uptimeMillis(); boolean active = true;
            try { touch(MotionEvent.ACTION_DOWN, time, finger); SystemClock.sleep(60); touch(MotionEvent.ACTION_MOVE, time, finger);
                SystemClock.sleep(70); touch(MotionEvent.ACTION_UP, time, finger); active = false;
            } finally { if (active) touch(MotionEvent.ACTION_CANCEL, time, finger); }
        }
        private void touch(int action, long down, P p) {
            MotionEvent event = MotionEvent.obtain(down, SystemClock.uptimeMillis(), action, (float)(origin[0] + p.x * scale), (float)(origin[1] + p.y * scale), 0);
            event.setSource(InputDevice.SOURCE_TOUCHSCREEN);
            try { parent.sendPointerSync(event); } finally { event.recycle(); }
        }
        private double[] activeCoordinate() throws Exception {
            JSONObject node = state().getJSONObject("trackOverlay").getJSONObject("activeNode");
            if (!qaId.equals(node.optString("trackId"))) fail("active-node-not-owned-by-qa-route");
            return pair(node.getJSONArray("coordinate"));
        }
        private List<Segment> projectRoads() throws Exception {
            Object entry = field(parent, "entry"), owner = field(entry, "snapGeometry");
            Object ready = old("awaitReadyRoadSnapshot", parent, owner, entry, 20_000L);
            JSONObject payload = (JSONObject)field(ready, "payload");
            JSONArray lines = payload.getJSONObject("road").getJSONArray("lines");
            int total = 0; for (int i = 0; i < lines.length(); i++) total += lines.getJSONObject(i).getJSONArray("coordinates").length();
            if (total > 6000) fail("qa-projection-budget-exceeded");
            List<Segment> result = new ArrayList<>(); final Throwable[] error = new Throwable[1];
            parent.runOnMainSync(() -> { try {
                Object counts = constructOld("GroundProjectionCounts"); Object projection = old("createGroundProjectionContext", parent, counts);
                if (projection == null) throw new Failure(stage, "real-rendered-ground-unavailable");
                for (int i = 0; i < lines.length(); i++) {
                    JSONArray coordinates = lines.getJSONObject(i).getJSONArray("coordinates"); P previous = null;
                    for (int j = 0; j < coordinates.length(); j++) {
                        P next = projected(projection, pair(coordinates.getJSONArray(j)), counts);
                        if (previous != null && next != null && distance(previous, next) > 0.01) result.add(new Segment(previous, next));
                        previous = next;
                    }
                }
            } catch (Throwable failure) { error[0] = failure; } });
            if (error[0] != null) throw new IllegalStateException("real-ground-projection-failed", error[0]);
            JSONObject freshness = (JSONObject)old("roadSnapshotFreshness", parent, owner, entry);
            if (!Boolean.TRUE.equals(old("readySnapshotStillCurrent", ready, freshness))) fail("road-snapshot-changed-during-projection");
            if (result.isEmpty()) fail("no-projected-mvt-roads"); return result;
        }
        private Target chooseTarget(List<Segment> segments) throws Exception {
            Target best = null; double score = Double.POSITIVE_INFINITY;
            for (Segment s : segments) {
                double length = distance(s.a, s.b); if (length < 18) continue;
                P center = new P((s.a.x + s.b.x) / 2, (s.a.y + s.b.y) / 2);
                double tx = (s.b.x - s.a.x) / length, ty = (s.b.y - s.a.y) / length;
                for (int direction : new int[]{1, -1}) {
                    double nx = -ty * direction, ny = tx * direction;
                    Target t = new Target(); t.segments = segments;
                    t.roadAim = center.plus(nx * 6, ny * 6); t.freeAim = center.plus(nx * 28, ny * 28);
                    t.initial = new P[]{center.plus(nx * 45, ny * 45), center.plus(tx * 55 - nx * 30, ty * 55 - ny * 30), center.plus(-tx * 55 - nx * 30, -ty * 55 - ny * 30)};
                    if (!safe(t.roadAim) || !safe(t.freeAim) || !safe(t.initial[0]) || !safe(t.initial[1]) || !safe(t.initial[2])) continue;
                    double offset = nearest(t.roadAim, segments);
                    if (offset < 4 || offset > 10 || nearest(t.freeAim, segments) < 22) continue;
                    double candidate = distance(center, new P(width / 2, Math.min(310, height * 0.38)));
                    if (candidate < score) { score = candidate; best = t; }
                }
            }
            if (best == null) fail("no-isolated-road-and-off-road-target-in-safe-map-area"); return best;
        }
        private boolean safe(P p) { return p != null && p.x >= 50 && p.x <= width - 50 && p.y >= 165 && p.y <= height - 300; }
        private P project(double[] coordinate) throws Exception {
            final P[] result = new P[1]; final Throwable[] error = new Throwable[1];
            parent.runOnMainSync(() -> { try { Object counts = constructOld("GroundProjectionCounts");
                Object context = old("createGroundProjectionContext", parent, counts); result[0] = projected(context, coordinate, counts);
            } catch (Throwable failure) { error[0] = failure; } });
            if (error[0] != null) throw new IllegalStateException("point-ground-projection-failed", error[0]);
            if (result[0] == null) fail("point-ground-projection-unavailable"); return result[0];
        }
        private P projected(Object context, double[] coordinate, Object counts) throws Exception {
            Object point = old("projectRenderedGroundCss", context, coordinate[1], coordinate[0], scale, counts);
            return point == null ? null : new P(((Number)field(point, "x")).doubleValue(), ((Number)field(point, "y")).doubleValue());
        }
        private JSONObject status() throws Exception {
            return json("(()=>{const e=document.querySelector('.route-edit-status'),r=e?.getBoundingClientRect(),s=e&&getComputedStyle(e);return JSON.stringify({status:e?.textContent?.trim()||'',statusVisible:!!r&&r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'})})()");
        }
        private boolean visible(String selector) throws Exception {
            return json("(()=>{const e=document.querySelector(" + JSONObject.quote(selector) + "),r=e?.getBoundingClientRect(),s=e&&getComputedStyle(e);return JSON.stringify({v:!!r&&r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'})})()").optBoolean("v");
        }
        private boolean pressed(String root, String label) throws Exception {
            JSONObject info = json("(()=>{const e=[...document.querySelectorAll(" + JSONObject.quote(root + " button") + ")].find(e=>e.textContent.trim()===" + JSONObject.quote(label) + ");return JSON.stringify({exists:!!e,value:e?.getAttribute('aria-pressed')})})()");
            if (!info.optBoolean("exists") || !("true".equals(info.optString("value")) || "false".equals(info.optString("value")))) fail("toggle-not-ready");
            return "true".equals(info.optString("value"));
        }
        private void setToggle(String root, String label, boolean value) throws Exception {
            if (pressed(root, label) != value) tap(root + " button", label);
            await(() -> pressed(root, label) == value, 2_000L, "toggle-not-applied");
        }
        private void tap(String selector, String label) throws Exception { call("tapDomButton", selector, label, scale); SystemClock.sleep(130L); }
        private JSONArray saved() throws Exception { return state().getJSONObject("trackOverlay").getJSONArray("saved"); }
        private JSONObject owned() throws Exception { assertOwned(); return saved().getJSONObject(0); }
        private boolean matchesExpected(JSONObject record) throws Exception {
            List<double[]> actual = coordinates(record);
            if (expectedSavedCoordinates == null || expectedSavedCoordinates.size() != 3 || actual.size() != expectedSavedCoordinates.size()) return false;
            for (int i = 0; i < actual.size(); i++) if (!equal(actual.get(i), expectedSavedCoordinates.get(i))) return false;
            return true;
        }
        private void assertOwned() throws Exception {
            JSONArray records = saved(); JSONObject persisted = json("(()=>{try{const a=JSON.parse(localStorage.getItem('guanyun.manual-tracks.v1')||'[]');return JSON.stringify({count:Array.isArray(a)?a.length:-1,id:Array.isArray(a)&&a.length===1?a[0].id:null})}catch{return JSON.stringify({count:-1})}})()");
            if (qaId.isEmpty() || records.length() != 1 || !qaId.equals(records.getJSONObject(0).optString("id")) ||
                persisted.optInt("count", -1) != 1 || !qaId.equals(persisted.optString("id"))) fail("qa-id-ownership-check-failed");
        }
        private int storageCount() throws Exception { return json("(()=>{try{const a=JSON.parse(localStorage.getItem('guanyun.manual-tracks.v1')||'[]');return JSON.stringify({count:Array.isArray(a)?a.length:-1})}catch{return JSON.stringify({count:-1})}})()").optInt("count", -1); }
        private JSONObject state() throws Exception { return new JSONObject(call("readState").toString()); }
        private JSONObject json(String script) throws Exception { return new JSONObject(String.valueOf(call("evalJs", script))); }
        private Object call(String name, Object... args) throws Exception { return invoke(parent, parent.getClass(), name, args); }
        private void await(Condition condition, long timeout, String code) throws Exception {
            long end = SystemClock.elapsedRealtime() + timeout;
            do { if (condition.ok()) return; SystemClock.sleep(90L); } while (SystemClock.elapsedRealtime() < end); fail(code);
        }
        private void fail(String code) throws Failure { throw new Failure(stage, code); }
        private void failure(JSONObject out, String key, Throwable error) {
            JSONObject value = new JSONObject(); put(value, "stage", error instanceof Failure ? ((Failure)error).stage : stage);
            put(value, "reasonCode", error instanceof Failure ? ((Failure)error).code : "operation-failed");
            JSONArray types = new JSONArray(); for (Throwable t = error; t != null && types.length() < 6; t = t.getCause()) types.put(t.getClass().getName());
            // This probe uses only its public, isolated research coordinates. Keep diagnostics
            // limited to fixed test failure codes, never arbitrary network/user exception text.
            String detail = error.getMessage();
            if (detail != null && (detail.startsWith("native-road-snapshot-not-ready:") || detail.startsWith("point-ground-projection-failed")))
                put(value, "probeDetail", detail.substring(0, Math.min(180, detail.length())));
            put(value, "causeClasses", types); put(out, key, value);
        }
    }

    private static Object old(String method, Object... args) throws Exception { return invoke(null, Native163DrawingRegression.class, method, args); }
    private static Object constructOld(String name) throws Exception {
        Class<?> type = Class.forName(Native163DrawingRegression.class.getName() + "$" + name);
        Constructor<?> constructor = type.getDeclaredConstructor(); constructor.setAccessible(true); return constructor.newInstance();
    }
    private static Object invoke(Object target, Class<?> type, String name, Object... args) throws Exception {
        for (Class<?> c = type; c != null; c = c.getSuperclass()) for (Method m : c.getDeclaredMethods()) if (m.getName().equals(name) && m.getParameterTypes().length == args.length) {
            m.setAccessible(true); try { return m.invoke(target, args); } catch (java.lang.reflect.InvocationTargetException e) {
                Throwable cause = e.getCause(); if (cause instanceof Exception) throw (Exception)cause; throw e;
            }
        }
        throw new NoSuchMethodException(name);
    }
    private static Object field(Object object, String name) throws Exception {
        for (Class<?> c = object.getClass(); c != null; c = c.getSuperclass()) try { Field f = c.getDeclaredField(name); f.setAccessible(true); return f.get(object); } catch (NoSuchFieldException ignored) { }
        throw new NoSuchFieldException(name);
    }
    private static boolean empty(String value) { return value.isEmpty() || "null".equals(value) || "draft".equals(value); }
    private static int pointCount(JSONArray lines) { int n = 0; for (int i = 0; i < lines.length(); i++) if (lines.optJSONArray(i) != null) n += lines.optJSONArray(i).length(); return n; }
    private static List<double[]> coordinates(JSONObject track) throws Exception {
        List<double[]> out = new ArrayList<>(); JSONArray lines = track.getJSONArray("segments");
        for (int i = 0; i < lines.length(); i++) { JSONArray line = lines.getJSONArray(i); for (int j = 0; j < line.length(); j++) out.add(pair(line.getJSONArray(j))); } return out;
    }
    private static boolean contains(JSONObject track, double[] point) throws Exception { for (double[] p : coordinates(track)) if (equal(p, point)) return true; return false; }
    private static boolean equal(double[] a, double[] b) { return Math.abs(a[0] - b[0]) <= 1e-9 && Math.abs(a[1] - b[1]) <= 1e-9; }
    private static double[] pair(JSONArray pair) throws Exception { return new double[]{pair.getDouble(0), pair.getDouble(1)}; }
    private static JSONArray point(P point) throws Exception { return new JSONArray().put(point.x).put(point.y); }
    private static double distance(P a, P b) { return Math.hypot(a.x - b.x, a.y - b.y); }
    private static double nearest(P p, List<Segment> segments) {
        double best = Double.POSITIVE_INFINITY;
        for (Segment s : segments) { double dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
            double t = Math.max(0, Math.min(1, ((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / (dx * dx + dy * dy)));
            best = Math.min(best, Math.hypot(p.x - s.a.x - t * dx, p.y - s.a.y - t * dy)); }
        return best;
    }
    private static void put(JSONObject object, String key, Object value) { try { object.put(key, value); } catch (Exception ignored) { } }
}
