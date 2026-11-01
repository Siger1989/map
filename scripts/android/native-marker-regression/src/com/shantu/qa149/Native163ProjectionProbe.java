package com.shantu.qa149;

import android.os.SystemClock;
import org.json.JSONArray;
import org.json.JSONObject;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

/** Read-only check that one idle frame's row-major MVP matches the SDK screen projector. */
public final class Native163ProjectionProbe {
    private static final int MAX_TEST_POINTS = 128;
    private static final long REQUIRED_QUIET_MS = 750L;
    private static final double WGS84_A = 6378137.0;
    private static final double WGS84_E2 = 0.0066943799901413165;
    private static final double MAX_ERROR_PX = 0.05;

    private static final class IdleStatus {
        final boolean idle, inflight;
        final String reason;
        IdleStatus(boolean idle, boolean inflight, String reason) {
            this.idle = idle; this.inflight = inflight; this.reason = reason;
        }
    }

    private Native163ProjectionProbe() { }

    /** Runs entirely on the existing target main thread and emits no coordinate or source data. */
    public static JSONObject run(Native149Instrumentation parent) throws Exception {
        if (parent == null) return unverified(0, 0, 0, JSONObject.NULL, false,
            "instrumentation-unavailable", "run", null, new JSONArray());
        AtomicReference<JSONObject> result = new AtomicReference<>();
        AtomicReference<Throwable> failure = new AtomicReference<>();
        AtomicReference<String> stage = new AtomicReference<>("main-sync");
        try {
            parent.runOnMainSync(() -> {
                try { result.set(probeOnMain(parent, stage)); }
                catch (Throwable error) { failure.set(error); }
            });
        } catch (Throwable error) { failure.set(error); }
        if (failure.get() != null) return unverified(0, 0, 0, JSONObject.NULL, false,
            "probe-exception", stage.get(), failure.get().getClass().getSimpleName(), new JSONArray());
        if (result.get() == null) return unverified(0, 0, 0, JSONObject.NULL, false,
            "probe-no-result", stage.get(), null, new JSONArray());
        return result.get();
    }

    private static JSONObject probeOnMain(Native149Instrumentation parent, AtomicReference<String> stage) throws Exception {
        stage.set("read-controller");
        Object entry = field(parent, "entry");
        Object controller = field(entry, "controller");
        Object worldWindow = field(controller, "worldWindow");
        Object engine = field(worldWindow, "engine");
        Object viewport = field(engine, "viewport");
        double[] matrixBefore = copyMatrix(field(controller, "lastBridgeFrameMatrix"));
        int[] viewportBefore = viewport(viewport);
        stage.set("read-tile-footprints");
        List<double[]> points = tileCorners(controller);
        long motionBefore = number(field(entry, "lastCameraMotionAt")).longValue();
        JSONArray unsupported = new JSONArray();
        stage.set("idle-check-before");
        IdleStatus idleBefore = idleState(entry, controller, matrixBefore, motionBefore, unsupported);
        if (!idleBefore.idle) return unverified(points.size(), 0, 0, JSONObject.NULL, idleBefore.inflight,
            idleBefore.reason, "idle-check-before", null, unsupported);

        stage.set("resolve-sdk-projector");
        Method projectCoordinate = findProjectCoordinate(controller.getClass());
        int valid = 0, nullMismatch = 0;
        double maxError = 0.0;
        stage.set("project-tile-corners");
        for (double[] point : points) {
            double latitude = point[1], longitude = point[0];
            Object sdkPoint = projectCoordinate.invoke(controller, latitude, longitude);
            double[] expected = projectRowMajor(matrixBefore, viewportBefore, latitude, longitude);
            double[] actual = pairPoint(sdkPoint);
            if (actual == null || expected == null) {
                if ((actual == null) != (expected == null)) nullMismatch++;
                continue;
            }
            valid++;
            maxError = Math.max(maxError, Math.hypot(actual[0] - expected[0], actual[1] - expected[1]));
        }

        double[] matrixAfter = copyMatrix(field(controller, "lastBridgeFrameMatrix"));
        int[] viewportAfter = viewport(field(field(worldWindow, "engine"), "viewport"));
        long motionAfter = number(field(entry, "lastCameraMotionAt")).longValue();
        stage.set("idle-check-after");
        IdleStatus idleAfter = idleState(entry, controller, matrixAfter, motionAfter, unsupported);
        boolean matrixOrViewportChanged = !Arrays.equals(matrixBefore, matrixAfter) || !Arrays.equals(viewportBefore, viewportAfter);
        boolean inflightChanged = matrixOrViewportChanged || motionBefore != motionAfter || idleAfter.inflight;
        String state, reason;
        if (matrixOrViewportChanged || motionBefore != motionAfter || !idleAfter.idle) {
            state = "UNVERIFIED";
            reason = matrixOrViewportChanged ? "frame-or-viewport-changed" :
                motionBefore != motionAfter ? "camera-motion-changed" : idleAfter.reason;
        } else if (points.isEmpty()) { state = "UNVERIFIED"; reason = "no-tile-footprints"; }
        else if (valid == 0) { state = "UNVERIFIED"; reason = "no-valid-projection-pairs"; }
        else if (nullMismatch != 0 || maxError > MAX_ERROR_PX) { state = "FAIL"; reason = "projection-mismatch"; }
        else { state = "PASS"; reason = "idle-frame-projection-match"; }
        return new JSONObject().put("testState", state).put("tested", points.size()).put("valid", valid)
            .put("nullMismatch", nullMismatch).put("maxPxError", valid == 0 ? JSONObject.NULL : maxError)
            .put("inflightFrameChanged", inflightChanged).put("reason", reason).put("stage", "complete")
            .put("unsupportedIdleChecks", unsupported);
    }

    private static JSONObject unverified(int tested, int valid, int nullMismatch, Object maxError, boolean inflight,
        String reason, String stage, String errorType, JSONArray unsupported) throws Exception {
        return new JSONObject().put("testState", "UNVERIFIED").put("tested", tested).put("valid", valid)
            .put("nullMismatch", nullMismatch).put("maxPxError", maxError).put("inflightFrameChanged", inflight)
            .put("reason", reason).put("stage", stage).put("errorType", errorType == null ? JSONObject.NULL : errorType)
            .put("unsupportedIdleChecks", unsupported);
    }

    private static IdleStatus idleState(Object entry, Object controller, double[] matrix, long motionAt,
        JSONArray unsupported) throws Exception {
        long now = SystemClock.elapsedRealtime();
        if (matrix == null || matrix.length != 16 || !finite(matrix)) return new IdleStatus(false, false, "frame-matrix-unavailable");
        if (now - motionAt < REQUIRED_QUIET_MS) return new IdleStatus(false, true, "camera-not-quiet");
        if (Boolean.TRUE.equals(field(controller, "disposed"))) return new IdleStatus(false, false, "controller-disposed");
        if (!Boolean.TRUE.equals(field(controller, "frameDrawn"))) return new IdleStatus(false, false, "frame-not-drawn");
        Object gate = field(entry, "frameCaptureGate");
        Object latest = field(entry, "latestFrame");
        Object pending = field(entry, "framePublishPending");
        Object notice = field(entry, "frameMetadataNoticePending");
        Object published = field(entry, "lastPublishedRenderFrame");
        Object renderedMatrix = field(entry, "lastRenderedMatrix");
        if (published == null || !(renderedMatrix instanceof double[]) || !Arrays.equals(matrix, (double[])renderedMatrix))
            return new IdleStatus(false, true, "published-frame-matrix-mismatch");
        Boolean gatePending = optionalBoolean(gate, "hasPending");
        Boolean latestPending = optionalBoolean(latest, "hasPending");
        if (gatePending == null) addUnsupported(unsupported, "frameCaptureGate.hasPending");
        if (latestPending == null) addUnsupported(unsupported, "latestFrame.hasPending");
        if (Boolean.TRUE.equals(gatePending)) return new IdleStatus(false, true, "frame-capture-gate-pending");
        if (Boolean.TRUE.equals(latestPending)) return new IdleStatus(false, true, "latest-frame-pending");
        if (Boolean.TRUE.equals(invokeNoArg(pending, "get"))) return new IdleStatus(false, true, "frame-publish-pending");
        if (Boolean.TRUE.equals(invokeNoArg(notice, "get"))) return new IdleStatus(false, true, "frame-metadata-notice-pending");
        if (field(entry, "frameCaptureTask") != null) return new IdleStatus(false, true, "frame-capture-task-pending");
        if (Boolean.TRUE.equals(field(entry, "frameWitnessPending"))) return new IdleStatus(false, true, "frame-witness-pending");
        if (field(entry, "framePublishTask") != null) return new IdleStatus(false, true, "frame-publish-task-pending");
        if (field(entry, "settledFrameTask") != null) return new IdleStatus(false, true, "settled-frame-task-pending");
        return new IdleStatus(true, false, "idle");
    }

    private static Boolean optionalBoolean(Object owner, String prefix) throws Exception {
        Method method = findOptionalNoArg(owner.getClass(), prefix);
        return method == null ? null : (Boolean)method.invoke(owner);
    }

    private static void addUnsupported(JSONArray unsupported, String value) {
        for (int i = 0; i < unsupported.length(); i++) if (value.equals(unsupported.optString(i))) return;
        unsupported.put(value);
    }

    /** Returns longitude/latitude pairs from at most 128 cached footprint corners. */
    private static List<double[]> tileCorners(Object controller) throws Exception {
        Object footprintsObject = field(controller, "tileFootprints");
        List<double[]> out = new ArrayList<>(MAX_TEST_POINTS);
        synchronized (footprintsObject) {
            if (!(footprintsObject instanceof Map)) return out;
            for (Object value : ((Map<?, ?>)footprintsObject).values()) {
                if (!(value instanceof Iterable)) continue;
                for (Object pair : (Iterable<?>)value) {
                    Object longitude = pairValue(pair, "first", "getFirst");
                    Object latitude = pairValue(pair, "second", "getSecond");
                    double lon = number(longitude).doubleValue(), lat = number(latitude).doubleValue();
                    if (Double.isFinite(lon) && Double.isFinite(lat) && lat >= -90.0 && lat <= 90.0)
                        out.add(new double[]{lon, lat});
                    if (out.size() >= MAX_TEST_POINTS) return out;
                }
            }
        }
        return out;
    }

    private static double[] projectRowMajor(double[] m, int[] viewport, double latitude, double longitude) {
        if (!Double.isFinite(latitude) || latitude < -90.0 || latitude > 90.0 || !Double.isFinite(longitude)) return null;
        double lat = Math.toRadians(latitude), lon = Math.toRadians(wrapLongitude(longitude));
        double sinLat = Math.sin(lat), cosLat = Math.cos(lat);
        double radius = WGS84_A / Math.sqrt(1.0 - WGS84_E2 * sinLat * sinLat);
        double x = radius * cosLat * Math.sin(lon);
        double y = radius * (1.0 - WGS84_E2) * sinLat;
        double z = radius * cosLat * Math.cos(lon);
        double clipX = m[0] * x + m[1] * y + m[2] * z + m[3];
        double clipY = m[4] * x + m[5] * y + m[6] * z + m[7];
        double clipZ = m[8] * x + m[9] * y + m[10] * z + m[11];
        double sw = m[12] * x + m[13] * y + m[14] * z + m[15];
        if (sw == 0.0) return null;
        double ndcX = clipX / sw, ndcY = clipY / sw, ndcZ = clipZ / sw;
        if (ndcZ < -1.0 || ndcZ > 1.0) return null;
        double screenX = (ndcX * 0.5 + 0.5) * viewport[2] + viewport[0];
        double screenY = viewport[3] - (ndcY * 0.5 + 0.5) * viewport[3] - viewport[1];
        return Double.isFinite(screenX) && Double.isFinite(screenY) ? new double[]{screenX, screenY} : null;
    }

    private static double[] pairPoint(Object pair) throws Exception {
        if (pair == null) return null;
        double x = number(pairValue(pair, "first", "getFirst")).doubleValue();
        double y = number(pairValue(pair, "second", "getSecond")).doubleValue();
        return Double.isFinite(x) && Double.isFinite(y) ? new double[]{x, y} : null;
    }

    private static int[] viewport(Object value) throws Exception {
        return new int[]{number(field(value, "x")).intValue(), number(field(value, "y")).intValue(),
            number(field(value, "width")).intValue(), number(field(value, "height")).intValue()};
    }

    private static double[] copyMatrix(Object value) {
        return value instanceof double[] ? ((double[])value).clone() : null;
    }

    private static boolean finite(double[] values) {
        for (double value : values) if (!Double.isFinite(value)) return false;
        return true;
    }

    private static double wrapLongitude(double longitude) {
        return (((longitude + 180.0) % 360.0 + 360.0) % 360.0) - 180.0;
    }

    private static Method findProjectCoordinate(Class<?> type) throws NoSuchMethodException {
        for (Class<?> current = type; current != null; current = current.getSuperclass()) {
            for (Method method : current.getDeclaredMethods()) {
                Class<?>[] parameters = method.getParameterTypes();
                if (method.getName().startsWith("projectCoordinate") && parameters.length == 2 &&
                    parameters[0] == double.class && parameters[1] == double.class) {
                    method.setAccessible(true);
                    return method;
                }
            }
        }
        throw new NoSuchMethodException("projectCoordinate(double,double)");
    }

    private static Object invokeNoArg(Object owner, String prefix) throws Exception {
        Method method = findOptionalNoArg(owner.getClass(), prefix);
        if (method == null) throw new NoSuchMethodException(prefix);
        return method.invoke(owner);
    }

    private static Method findOptionalNoArg(Class<?> type, String prefix) {
        for (Class<?> current = type; current != null; current = current.getSuperclass()) {
            for (Method method : current.getDeclaredMethods()) {
                if (method.getName().startsWith(prefix) && method.getParameterTypes().length == 0) {
                    method.setAccessible(true);
                    return method;
                }
            }
        }
        return null;
    }

    private static Object pairValue(Object pair, String fieldName, String getterName) throws Exception {
        try { return pair.getClass().getMethod(getterName).invoke(pair); }
        catch (ReflectiveOperationException ignored) { return field(pair, fieldName); }
    }

    private static Number number(Object value) {
        if (!(value instanceof Number)) throw new IllegalStateException("numeric probe value unavailable");
        return (Number)value;
    }

    private static Object field(Object owner, String name) throws Exception {
        if (owner == null) throw new IllegalStateException("probe owner unavailable");
        for (Class<?> type = owner.getClass(); type != null; type = type.getSuperclass()) {
            try {
                Field value = type.getDeclaredField(name);
                value.setAccessible(true);
                return value.get(owner);
            } catch (NoSuchFieldException ignored) { }
        }
        throw new NoSuchFieldException(name);
    }
}
