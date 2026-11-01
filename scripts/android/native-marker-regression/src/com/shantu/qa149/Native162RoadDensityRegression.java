package com.shantu.qa149;

import android.os.Environment;
import android.os.SystemClock;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Captures same-source ordinary-road density and render-cut evidence without touching user data. */
public final class Native162RoadDensityRegression {
    private static final long ROAD_READY_TIMEOUT_MS = 25_000L;
    private static final Pattern TILE_KEY = Pattern.compile("^(\\d+)\\.(\\d+)\\.(\\d+)$");
    private Native162RoadDensityRegression() { }

    public static JSONObject run(Native149Instrumentation parent) throws Exception {
        JSONObject report = new JSONObject().put("mode", "road-density-regression")
            .put("testState", "RUNNING").put("visualReviewRequired", true)
            .put("automaticVisualPass", false).put("networkFullyLoadedNotAsserted", true)
            .put("gpsWritten", false).put("storageWritten", false);
        JSONArray stages = new JSONArray(); report.put("stages", stages);
        call(parent, "attachTarget");
        SystemClock.sleep(6000L); call(parent, "awaitWebViewDraw");
        final Object entry = field(parent, "entry");
        final Object controller = field(entry, "controller");
        final Object cartography = field(controller, "cartography");
        final Object roads = field(cartography, "nativeRoadLayer");
        final Object roadNames = field(cartography, "roadNamesLayer");
        final Object rasterLabels = field(cartography, "tiandituLabelRenderLayer");
        final JSONObject originalCamera = new JSONObject(((JSONObject)call(parent, "invokeCameraJson")).toString());
        final JSONObject originalState = new JSONObject(((JSONObject)call(parent, "readState")).toString());
        final long originalRevision = originalState.optLong("revision", 0L);
        long qaRevision = originalRevision + 100_000L;
        final String originalSourceId = sourceId(originalState);
        final boolean originalRoadsEnabled = boolProperty(roads, "isEnabled", "isEnabled");
        final boolean originalRoadNamesEnabled = boolProperty(roadNames, "isEnabled", "isEnabled");
        final boolean originalRasterLabelsEnabled = boolProperty(rasterLabels, "isEnabled", "isEnabled");
        final Object overlayOptions = field(controller, "terrainOverlayOptions");
        final boolean originalContours = bool(overlayOptions, "contoursEnabled");
        final boolean originalElevationColors = bool(overlayOptions, "elevationColorsEnabled");
        final int originalContourInterval = number(overlayOptions, "contourIntervalMeters").intValue();
        final double originalElevationOpacity = number(overlayOptions, "elevationColorsOpacity").doubleValue();
        boolean renderStateChanged = false;
        boolean overlayTemporarilyChanged = false;
        String runId = UUID.randomUUID().toString().replace("-", "");
        File dir = new File(parent.getTargetContext().getExternalFilesDir(Environment.DIRECTORY_PICTURES), "native162-road-density-" + runId);
        if (!dir.mkdirs()) throw new IllegalStateException("evidence-directory-create-failed");
        set(parent, "evidenceDir", dir); set(parent, "runId", runId);
        report.put("evidenceDirectory", dir.getAbsolutePath())
            .put("targetVersion", call(parent, "targetVersionProof"))
            .put("sourceIdBefore", safeSourceIdValue(originalSourceId));
        JSONObject fixture = (JSONObject)call(parent, "readLinePositionFixture");
        boolean requireMatrixCoverage = fixtureBoolean(fixture, "requireMatrixCoverage", true);
        boolean isolation = fixtureBoolean(fixture, "isolation", true);
        JSONArray poses = validatePoses(parent, fixture, requireMatrixCoverage, isolation);
        long minimumWarmupMs = fixtureMinimumWarmup(fixture);
        report.put("fixtureFileReadOnly", true).put("fixturePoseCount", poses.length())
            .put("fixtureZooms", poseZooms(poses)).put("minimumWarmupMs", minimumWarmupMs)
            .put("coverageScope", !requireMatrixCoverage && !isolation ? "near-only" : requireMatrixCoverage ? "full-matrix" : "fixture-poses")
            .put("isolationScope", isolation ? "chengdu-and-vector-isolation" : "vector-fixture-only")
            .put("chengduIsolationExecuted", isolation);
        Throwable failure = null;
        boolean restorationVerified = false;
        try {
            JSONObject chengduCamera = null;
            if (isolation) {
                JSONObject chengdu = new JSONObject().put("center", new JSONArray().put(104.0668).put(30.5728))
                    .put("zoom", 9).put("pitch", 0).put("bearing", 0);
                chengduCamera = safeCamera(parent, chengdu);

                JSONObject currentRoadsOn = withSettings(originalState, "roadsEnabled", true, ++qaRevision);
                renderStateChanged = true;
                applyState(parent, currentRoadsOn, "native162-chengdu-roads-on-" + runId);
                applyCameraAndWait(parent, chengduCamera);
                assertSourceUnchanged(originalSourceId, (JSONObject)call(parent, "readState"));
                RoadCutStats initialReady = awaitRoadContent(parent, roads, ROAD_READY_TIMEOUT_MS, minimumWarmupMs);
                stages.put(withReadiness(snapshot(parent, entry, roads, "chengdu-current-source-roads-on", originalSourceId), initialReady));

                JSONObject currentRoadsOff = withSettings(currentRoadsOn, "roadsEnabled", false, ++qaRevision);
                applyState(parent, currentRoadsOff, "native162-chengdu-roads-off-" + runId);
                applyCameraAndWait(parent, chengduCamera);
                stages.put(withReadiness(snapshot(parent, entry, roads, "chengdu-current-source-roads-off", originalSourceId), initialReady));

                currentRoadsOn = withSettings(originalState, "roadsEnabled", true, ++qaRevision);
                applyState(parent, currentRoadsOn, "native162-chengdu-roads-restore-" + runId);
                applyCameraAndWait(parent, chengduCamera);
                RoadCutStats chengduReady = awaitRoadContent(parent, roads, ROAD_READY_TIMEOUT_MS, minimumWarmupMs);
                setEnabled(parent, rasterLabels, false); requestRedraw(parent, controller); call(parent, "awaitFrames", 2, 10_000L);
                stages.put(withReadiness(snapshot(parent, entry, roads, "chengdu-raster-label-layer-hidden", originalSourceId), chengduReady));
                setEnabled(parent, rasterLabels, originalRasterLabelsEnabled);
                setEnabled(parent, roadNames, false); requestRedraw(parent, controller); call(parent, "awaitFrames", 2, 10_000L);
                stages.put(withReadiness(snapshot(parent, entry, roads, "chengdu-road-names-layer-hidden", originalSourceId), chengduReady));
                setEnabled(parent, roadNames, originalRoadNamesEnabled);
                setEnabled(parent, roads, true); requestRedraw(parent, controller);
            }

            JSONObject vectorState = vectorSettings(originalState, ++qaRevision);
            renderStateChanged = true;
            applyState(parent, vectorState, "native162-vector-label-settings-" + runId);
            if (isolation) applyCameraAndWait(parent, chengduCamera);
            assertSourceUnchanged(originalSourceId, (JSONObject)call(parent, "readState"));
            overlayTemporarilyChanged = true;
            setTerrainOverlay(parent, controller, false, originalElevationColors, originalContourInterval, originalElevationOpacity);
            setEnabled(parent, roads, true);

            int poseIndex = 0;
            for (int i = 0; i < poses.length(); i++) {
                JSONObject pose = poses.getJSONObject(i);
                String name = safeName(pose.optString("name", "pose-" + i));
                JSONObject camera = safeCamera(parent, pose.getJSONObject("camera"));
                call(parent, "applyCamera", camera);
                RoadCutStats ready = awaitRoadContent(parent, roads, ROAD_READY_TIMEOUT_MS, minimumWarmupMs);

                stages.put(withReadiness(snapshot(parent, entry, roads, "vector-baseline-" + name, originalSourceId), ready)
                    .put("poseIndex", poseIndex).put("requestedCamera", camera));
                setEnabled(parent, roads, false); requestRedraw(parent, controller); call(parent, "awaitFrames", 2, 10_000L);
                stages.put(withReadiness(snapshot(parent, entry, roads, "vector-road-layer-off-" + name, originalSourceId), ready)
                    .put("poseIndex", poseIndex).put("requestedCamera", camera).put("roadCutReadyBeforeIsolation", ready.hasFeatures()));
                setEnabled(parent, roads, true); requestRedraw(parent, controller); call(parent, "awaitFrames", 2, 10_000L);
                stages.put(withReadiness(snapshot(parent, entry, roads, "vector-road-layer-on-" + name, originalSourceId), ready)
                    .put("poseIndex", poseIndex).put("requestedCamera", camera).put("roadCutReadyBeforeIsolation", ready.hasFeatures()));
                poseIndex++;
            }
            report.put("testState", "CAPTURED_REQUIRES_VISUAL_REVIEW");
        } catch (Throwable error) {
            failure = error;
            report.put("testState", "ERROR").put("errorDetails", call(parent, "errorDetails", error));
        } finally {
            JSONObject restoration = new JSONObject();
            try {
                if (renderStateChanged) {
                    JSONObject restore = new JSONObject(originalState.toString()).put("revision", ++qaRevision);
                    applyState(parent, restore, "native162-restore-" + runId);
                    call(parent, "restoreRevisionBaseline", originalState, originalRevision);
                    restoration.put("renderStateAndRevision", currentRevision(parent) == originalRevision);
                } else restoration.put("renderStateAndRevision", currentRevision(parent) == originalRevision);
            } catch (Throwable error) { restoration.put("renderStateAndRevision", false).put("renderStateRestoreError", error.getClass().getSimpleName()); }
            try {
                if (overlayTemporarilyChanged || originalContours || originalElevationColors)
                    setTerrainOverlay(parent, controller, originalContours, originalElevationColors, originalContourInterval, originalElevationOpacity);
                restoration.put("terrainOverlayOptions", overlayOptionsMatch(controller, originalContours, originalElevationColors, originalContourInterval, originalElevationOpacity));
            } catch (Throwable error) { restoration.put("terrainOverlayOptions", false).put("terrainOverlayRestoreError", error.getClass().getSimpleName()); }
            try {
                setEnabled(parent, rasterLabels, originalRasterLabelsEnabled);
                setEnabled(parent, roadNames, originalRoadNamesEnabled);
                setEnabled(parent, roads, originalRoadsEnabled);
                call(parent, "applyCamera", originalCamera);
                requestRedraw(parent, controller); call(parent, "awaitFrames", 2, 10_000L);
                restoration.put("layerFlags", boolProperty(roads, "isEnabled", "isEnabled") == originalRoadsEnabled &&
                    boolProperty(roadNames, "isEnabled", "isEnabled") == originalRoadNamesEnabled &&
                    boolProperty(rasterLabels, "isEnabled", "isEnabled") == originalRasterLabelsEnabled);
                restoration.put("camera", (Boolean)call(parent, "cameraMatches", originalCamera, call(parent, "invokeCameraJson")));
                restoration.put("sourceId", originalSourceId.equals(sourceId((JSONObject)call(parent, "readState"))));
            } catch (Throwable error) { restoration.put("layerFlags", false).put("camera", false).put("sourceId", false).put("viewportRestoreError", error.getClass().getSimpleName()); }
            restorationVerified = restoration.optBoolean("renderStateAndRevision") && restoration.optBoolean("terrainOverlayOptions") &&
                restoration.optBoolean("layerFlags") && restoration.optBoolean("camera") && restoration.optBoolean("sourceId");
            report.put("restoration", restoration).put("restorationVerified", restorationVerified);
            if (restorationVerified && failure == null) report.put("testState", "COMPLETE_RESTORE_VERIFIED_VISUAL_REVIEW_REQUIRED");
            else if (!restorationVerified) report.put("testState", "ERROR_RESTORATION_NOT_VERIFIED");
            report.put("sourceIdAfter", safeSourceIdValue(safeSourceId(parent)));
            try (FileOutputStream out = new FileOutputStream(new File(dir, "road-density-regression.json"))) {
                out.write(report.toString(2).getBytes("UTF-8"));
            } catch (Throwable writeError) {
                if (failure == null) failure = writeError;
                report.put("reportWriteError", writeError.getClass().getSimpleName());
            }
        }
        if (failure != null && !"ERROR".equals(report.optString("testState")) && !"ERROR_RESTORATION_NOT_VERIFIED".equals(report.optString("testState")))
            report.put("testState", "ERROR");
        return report;
    }

    private static JSONArray validatePoses(Native149Instrumentation p, JSONObject fixture, boolean requireMatrixCoverage, boolean isolation) throws Exception {
        JSONArray input = fixture.optJSONArray("poses");
        if (input == null || input.length() < (requireMatrixCoverage ? 11 : 1) || input.length() > (requireMatrixCoverage ? 11 : 32))
            throw new IllegalArgumentException(requireMatrixCoverage ? "matrix fixture poses must contain the 11 requested zooms" : "non-matrix fixture poses must contain 1..32 poses");
        if (!isolation && requireMatrixCoverage)
            throw new IllegalArgumentException("isolation=false requires explicit requireMatrixCoverage=false");
        int[] expected = new int[]{8, 8, 9, 10, 10, 11, 11, 12, 12, 15, 15};
        int[] actual = new int[input.length()];
        Set<String> names = new LinkedHashSet<>();
        for (int i = 0; i < input.length(); i++) {
            JSONObject pose = input.optJSONObject(i);
            if (pose == null) throw new IllegalArgumentException("every fixture pose must be an object");
            String name = safeName(pose.optString("name", ""));
            if (name.isEmpty() || !names.add(name)) throw new IllegalArgumentException("fixture pose names must be unique safe identifiers");
            JSONObject camera = safeCamera(p, pose.optJSONObject("camera"));
            actual[i] = (int)Math.round(camera.getDouble("zoom"));
            if (Math.abs(camera.getDouble("zoom") - actual[i]) > 0.001) throw new IllegalArgumentException("fixture zooms must be integer levels");
            if (!isolation && (input.length() != 1 || actual[i] != 15 ||
                !name.toLowerCase(java.util.Locale.ROOT).contains("city") || !name.toLowerCase(java.util.Locale.ROOT).contains("15")))
                throw new IllegalArgumentException("isolation=false requires exactly one city-z15 pose");
        }
        if (requireMatrixCoverage) {
            java.util.Arrays.sort(actual); java.util.Arrays.sort(expected);
            if (!java.util.Arrays.equals(actual, expected)) throw new IllegalArgumentException("fixture zooms must cover city 8/9/10/11/12/15 and mountain 8/10/11/12/15");
        }
        return input;
    }

    private static boolean fixtureBoolean(JSONObject fixture, String key, boolean defaultValue) {
        Object value = fixture.opt(key);
        if (value == null) return defaultValue;
        if (!(value instanceof Boolean)) throw new IllegalArgumentException(key + " must be an explicit boolean");
        return ((Boolean)value).booleanValue();
    }

    private static JSONObject safeCamera(Native149Instrumentation p, JSONObject camera) throws Exception {
        return (JSONObject)call(p, "safeRequestedCamera", camera);
    }

    private static void applyCameraAndWait(Native149Instrumentation p, JSONObject camera) throws Exception {
        call(p, "applyCamera", camera);
        call(p, "awaitFrames", 2, 10_000L);
    }

    private static long fixtureMinimumWarmup(JSONObject fixture) {
        Object raw = fixture.opt("minimumWarmupMs");
        if (raw == null) return 3_000L;
        if (!(raw instanceof Number)) throw new IllegalArgumentException("minimumWarmupMs must be a number");
        long value = ((Number)raw).longValue();
        if (value < 0L || value > 10_000L || Math.abs(((Number)raw).doubleValue() - value) > 0.001)
            throw new IllegalArgumentException("minimumWarmupMs must be an integer from 0 to 10000");
        return value;
    }

    private static JSONObject withSettings(JSONObject source, String key, Object value, long revision) throws Exception {
        JSONObject copy = new JSONObject(source.toString());
        JSONObject settings = new JSONObject(copy.optJSONObject("settings") == null ? "{}" : copy.getJSONObject("settings").toString());
        settings.put(key, value); copy.put("settings", settings).put("revision", revision); return copy;
    }

    private static JSONObject vectorSettings(JSONObject source, long revision) throws Exception {
        JSONObject copy = new JSONObject(source.toString());
        JSONObject settings = new JSONObject(copy.optJSONObject("settings") == null ? "{}" : copy.getJSONObject("settings").toString());
        settings.put("tiandituLabels", "vector").put("roadsEnabled", true).put("labelsEnabled", true);
        copy.put("settings", settings).put("revision", revision); return copy;
    }

    private static void applyState(Native149Instrumentation p, JSONObject state, String requestId) throws Exception {
        call(p, "applyRenderStateThroughBridge", "main", state, requestId);
    }

    private static void assertSourceUnchanged(String expected, JSONObject state) throws Exception {
        if (!expected.equals(sourceId(state))) throw new IllegalStateException("sourceId changed while applying road settings");
    }

    private static String sourceId(JSONObject state) {
        JSONObject source = state.optJSONObject("mapSource");
        if (source == null) return "";
        return source.optString("id", "");
    }

    private static String safeSourceId(Native149Instrumentation p) {
        try { return sourceId((JSONObject)call(p, "readState")); } catch (Throwable ignored) { return "unavailable"; }
    }

    private static String safeSourceIdValue(String value) {
        return value != null && value.matches("[A-Za-z0-9_.:-]{1,80}") ? value : "[opaque-source-id]";
    }

    private static JSONObject snapshot(Native149Instrumentation p, Object entry, Object roads, String name, String originalSourceId) throws Exception {
        JSONObject state = (JSONObject)call(p, "readState");
        Object controller = field(entry, "controller"), cartography = field(controller, "cartography");
        Object roadNames = field(cartography, "roadNamesLayer"), rasterLabels = field(cartography, "tiandituLabelRenderLayer");
        JSONObject out = new JSONObject().put("stage", name).put("camera", call(p, "invokeCameraJson"))
            .put("sourceId", safeSourceIdValue(sourceId(state))).put("sourceIdUnchanged", originalSourceId.equals(sourceId(state)))
            .put("roadsLayerEnabled", boolProperty(roads, "isEnabled", "isEnabled"))
            .put("roadNamesLayerEnabled", boolProperty(roadNames, "isEnabled", "isEnabled"))
            .put("rasterLabelLayerEnabled", boolProperty(rasterLabels, "isEnabled", "isEnabled"))
            .put("cssScale", call(p, "rendererCssScale"));
        Object planValue = field(cartography, "plan"); JSONObject plan = new JSONObject();
        for (String key : new String[]{"roads", "roadNames", "placeLabels", "tiandituLabels", "effectiveBase", "rasterLabelOpacity"})
            { Object value = field(planValue, key); plan.put(key, value == null ? JSONObject.NULL : value); }
        out.put("cartographyPlan", plan).put("nativeRoadLayer", roadCutSnapshot(roads));
        out.put("screenshot", call(p, "capture", name));
        return out;
    }

    /** Copies the mutable render cut and live-content map before inspection; output omits URL/key data. */
    private static JSONObject roadCutSnapshot(Object layer) throws Exception {
        Object[] copiedCut = new Object[0]; Map<?, ?> copiedLive = new HashMap<>(); boolean consistent = false;
        Collection<?> cut = (Collection<?>)field(layer, "renderCut"); Map<?, ?> live = (Map<?, ?>)field(layer, "liveContent");
        for (int attempt = 0; attempt < 3; attempt++) {
            try {
                int cutBefore = cut.size(), liveBefore = live.size();
                copiedCut = cut.toArray(); copiedLive = new HashMap<>(live);
                consistent = cutBefore == cut.size() && liveBefore == live.size() && copiedCut.length == cutBefore && copiedLive.size() == liveBefore;
                if (consistent) break;
            } catch (RuntimeException concurrentMutation) { SystemClock.sleep(10L); }
        }
        IdentityHashMap<Object, String> keyByContent = new IdentityHashMap<>();
        for (Map.Entry<?, ?> item : copiedLive.entrySet()) keyByContent.put(item.getValue(), String.valueOf(item.getKey()));
        JSONArray tileRows = new JSONArray(); LinkedHashMap<String, int[]> groups = new LinkedHashMap<>();
        LinkedHashSet<Integer> sourceZooms = new LinkedHashSet<>(); List<TileCoordinate> activeTiles = new ArrayList<>();
        double styleZoom = Double.NaN;
        try { styleZoom = ((Number)field(field(layer, "viewStyle"), "zoom")).doubleValue(); } catch (Throwable ignored) { }
        int renderableCount = 0, featureCount = 0, keyedCutTiles = 0;
        for (Object tileObject : copiedCut) {
            if (!(tileObject instanceof Collection)) continue;
            Object[] renderables = ((Collection<?>)tileObject).toArray();
            String tileKey = keyByContent.get(tileObject);
            TileCoordinate coordinate = parseTile(tileKey);
            if (coordinate != null) { activeTiles.add(coordinate); sourceZooms.add(coordinate.z); keyedCutTiles++; }
            JSONObject tileRow = new JSONObject().put("renderableCount", renderables.length);
            if (tileKey != null && tileKey.matches("[0-9.]{1,24}")) tileRow.put("tileKey", tileKey);
            if (coordinate != null) tileRow.put("sourceZoom", coordinate.z);
            for (Object renderable : renderables) {
                if (renderable == null) continue;
                renderableCount++;
                Object group = groupProperty(renderable, field(layer, "groupKey"));
                String groupName = safeGroup(group);
                int[] counts = groups.get(groupName); if (counts == null) { counts = new int[2]; groups.put(groupName, counts); }
                counts[0]++;
                int features = countFeatures(renderable);
                counts[1] += features; featureCount += features;
            }
            tileRows.put(tileRow);
        }
        JSONArray groupCounts = new JSONArray();
        for (Map.Entry<String, int[]> group : groups.entrySet()) {
            JSONObject item = new JSONObject().put("group", group.getKey()).put("renderableCount", group.getValue()[0])
                .put("featureCount", group.getValue()[1]);
            if (Double.isFinite(styleZoom)) {
                Boolean visible = styleGroupVisible(group.getKey(), styleZoom);
                item.put("styleGroupVisibleAtUiZoom", visible == null ? JSONObject.NULL : visible);
            } else item.put("styleGroupVisibleAtUiZoom", JSONObject.NULL);
            groupCounts.put(item);
        }
        JSONArray zValues = new JSONArray(); for (Integer z : sourceZooms) zValues.put(z);
        JSONArray overlaps = new JSONArray(); int overlapCount = 0;
        for (int i = 0; i < activeTiles.size(); i++) for (int j = i + 1; j < activeTiles.size(); j++) {
            TileCoordinate a = activeTiles.get(i), b = activeTiles.get(j);
            TileCoordinate parent = isAncestor(a, b) ? a : isAncestor(b, a) ? b : null;
            TileCoordinate child = parent == a ? b : parent == b ? a : null;
            if (parent != null) {
                overlapCount++;
                if (overlaps.length() < 64) overlaps.put(new JSONObject().put("ancestor", parent.key).put("descendant", child.key));
            }
        }
        int pendingTileCount = pendingTileCount(layer);
        return new JSONObject().put("renderCutTileCount", copiedCut.length).put("cutTilesWithKey", keyedCutTiles)
            .put("liveContentTileCount", copiedLive.size()).put("renderableCount", renderableCount)
            .put("featureCount", featureCount).put("groups", groupCounts).put("sourceZooms", zValues)
            .put("tiles", tileRows).put("ancestorOverlapCount", overlapCount).put("ancestorOverlapPairs", overlaps)
            .put("ancestorOverlapPairsTruncated", overlapCount > overlaps.length())
            .put("snapshotConsistent", consistent).put("pendingTileCount", pendingTileCount);
    }

    private static Object groupProperty(Object renderable, Object key) {
        try {
            Object value = call(renderable, "getUserProperty", key);
            if (value != null) return value;
        } catch (Throwable getterUnavailable) { }
        try {
            Object properties = field(renderable, "userProperties");
            return properties instanceof Map ? ((Map<?, ?>)properties).get(key) : null;
        } catch (Throwable fieldUnavailable) { return null; }
    }

    /** Optional policy-only visibility; null means R8/API reflection did not expose the rule. */
    private static Boolean styleGroupVisible(String groupName, double zoom) {
        try {
            Class<?> owner = Class.forName("com.shantu.nativeapp.map.NativeRoadStyle");
            Field instanceField = owner.getDeclaredField("INSTANCE"); instanceField.setAccessible(true);
            Object instance = instanceField.get(null);
            Class<?> enumType = Class.forName("com.shantu.nativeapp.map.NativeRoadStyle$Group");
            Object group = null;
            Object[] values = enumType.getEnumConstants();
            if (values != null) for (Object candidate : values) if (groupName.equals(String.valueOf(candidate))) { group = candidate; break; }
            if (group == null) return null;
            Method visible = method(owner, "visible", 2);
            Object result = visible.invoke(instance, group, zoom);
            return result instanceof Boolean ? (Boolean)result : null;
        } catch (Throwable unavailable) { return null; }
    }

    private static int pendingTileCount(Object layer) {
        try {
            Object value = method(layer.getClass(), "getPendingTileCount", 0).invoke(layer);
            if (value instanceof Number) return ((Number)value).intValue();
        } catch (Throwable ignored) { }
        try {
            Object inFlight = field(layer, "inFlight");
            if (inFlight instanceof Map) return ((Map<?, ?>)inFlight).size();
        } catch (Throwable ignored) { }
        return -1;
    }

    private static int countFeatures(Object renderable) {
        try {
            Object features = field(renderable, "features");
            return features instanceof Collection ? ((Collection<?>)features).size() : 0;
        } catch (Throwable ignored) { return 0; }
    }

    private static String safeGroup(Object group) {
        String value = group == null ? "unknown" : String.valueOf(group);
        return value.matches("[A-Za-z0-9_-]{1,48}") ? value : "other-enum-value";
    }

    private static TileCoordinate parseTile(String key) {
        if (key == null) return null;
        Matcher match = TILE_KEY.matcher(key);
        if (!match.matches()) return null;
        try { return new TileCoordinate(Integer.parseInt(match.group(1)), Integer.parseInt(match.group(2)), Integer.parseInt(match.group(3)), key); }
        catch (NumberFormatException ignored) { return null; }
    }

    private static boolean isAncestor(TileCoordinate a, TileCoordinate b) {
        if (a.z >= b.z || b.z > 30) return false;
        int shift = b.z - a.z;
        return (b.row >> shift) == a.row && (b.column >> shift) == a.column;
    }

    private static RoadCutStats awaitRoadContent(Native149Instrumentation p, Object roads, long timeoutMs, long minimumWarmupMs) throws Exception {
        long started = SystemClock.elapsedRealtime(), deadline = started + timeoutMs;
        int stableReads = 0; String priorSignature = "";
        RoadCutStats last = new RoadCutStats(0, 0, "", -1, false, 0, 0L);
        while (SystemClock.elapsedRealtime() < deadline) {
            requestRedraw(p, field(field(p, "entry"), "controller"));
            JSONObject cut = roadCutSnapshot(roads);
            JSONArray tileRows = cut.optJSONArray("tiles"), zValues = cut.optJSONArray("sourceZooms");
            String signature = String.valueOf(tileRows) + "|" + String.valueOf(zValues) + "|" + cut.optInt("ancestorOverlapCount");
            int pending = cut.optInt("pendingTileCount", -1);
            long elapsed = SystemClock.elapsedRealtime() - started;
            boolean consistent = cut.optBoolean("snapshotConsistent", false);
            int tileCount = cut.optInt("renderCutTileCount"), featureCount = cut.optInt("featureCount");
            boolean hasFeatures = tileCount > 0 && featureCount > 0;
            if (consistent && hasFeatures && signature.equals(priorSignature)) stableReads++;
            else stableReads = consistent && hasFeatures ? 1 : 0;
            boolean warmed = elapsed >= minimumWarmupMs;
            last = new RoadCutStats(tileCount, featureCount, signature, pending, consistent, stableReads, elapsed);
            if (warmed && hasFeatures && stableReads >= 5) return last;
            priorSignature = signature; SystemClock.sleep(300L);
        }
        return last;
    }

    private static JSONObject withReadiness(JSONObject stage, RoadCutStats ready) throws Exception {
        JSONObject currentCut = stage.optJSONObject("nativeRoadLayer");
        return stage.put("roadCutReady", ready.stable && ready.hasFeatures())
            .put("captureUnsettled", !ready.stable || !ready.hasFeatures())
            .put("roadContentPresent", ready.hasFeatures()).put("pendingTileCountAtReadiness", ready.pendingTileCount)
            .put("pendingTileCountAtCapture", currentCut == null ? JSONObject.NULL : currentCut.opt("pendingTileCount"))
            .put("pendingCountAvailable", ready.pendingTileCount >= 0).put("queueSettled", ready.pendingTileCount == 0)
            .put("stableReadCount", ready.stableReads)
            .put("readinessSnapshotConsistent", ready.snapshotConsistent).put("readinessWaitMs", ready.elapsedMs);
    }

    private static JSONArray poseZooms(JSONArray poses) throws Exception {
        JSONArray out = new JSONArray(); for (int i = 0; i < poses.length(); i++) out.put(poses.getJSONObject(i).getJSONObject("camera").optDouble("zoom")); return out;
    }

    private static String safeName(String input) {
        if (input == null) return "";
        String value = input.replaceAll("[^A-Za-z0-9_-]", "-");
        return value.length() > 48 ? value.substring(0, 48) : value;
    }

    private static void setTerrainOverlay(Native149Instrumentation p, Object controller, boolean contours, boolean colors, int interval, double opacity) throws Exception {
        Method method = method(controller.getClass(), "setTerrainOverlay", 4);
        java.util.concurrent.atomic.AtomicReference<Throwable> failure = new java.util.concurrent.atomic.AtomicReference<>();
        p.runOnMainSync(() -> { try { method.invoke(controller, contours, colors, interval, opacity); }
            catch (Throwable error) { failure.set(error); } });
        if (failure.get() != null) throw new IllegalStateException("terrain overlay isolation update failed", failure.get());
        requestRedraw(p, controller);
    }

    private static boolean overlayOptionsMatch(Object controller, boolean contours, boolean colors, int interval, double opacity) throws Exception {
        Object options = field(controller, "terrainOverlayOptions");
        return bool(options, "contoursEnabled") == contours && bool(options, "elevationColorsEnabled") == colors &&
            number(options, "contourIntervalMeters").intValue() == interval && Math.abs(number(options, "elevationColorsOpacity").doubleValue() - opacity) < 1e-9;
    }

    private static long currentRevision(Native149Instrumentation p) throws Exception { return ((Number)call(p, "currentRenderRevision")).longValue(); }
    private static void requestRedraw(Native149Instrumentation p, Object controller) throws Exception {
        Object world = field(controller, "worldWindow"); method(world.getClass(), "requestRedraw", 0).invoke(world);
    }

    private static boolean boolProperty(Object value, String fieldName, String getter) throws Exception {
        try { return bool(value, fieldName); } catch (NoSuchFieldException absent) { return (Boolean)call(value, getter); }
    }

    private static void setEnabled(Native149Instrumentation p, Object layer, boolean enabled) throws Exception {
        Field field = findField(layer.getClass(), "isEnabled");
        p.runOnMainSync(() -> { try { field.set(layer, enabled); } catch (Exception error) { throw new IllegalStateException(error); } });
    }

    private static boolean bool(Object object, String name) throws Exception { return ((Boolean)field(object, name)).booleanValue(); }
    private static Number number(Object object, String name) throws Exception { return (Number)field(object, name); }
    private static Object call(Object object, String name, Object... args) throws Exception {
        Method method = method(object.getClass(), name, args.length);
        try { return method.invoke(object, args); }
        catch (java.lang.reflect.InvocationTargetException error) {
            Throwable cause = error.getCause(); if (cause instanceof Exception) throw (Exception)cause; throw error;
        }
    }
    private static Method method(Class<?> type, String name, int arity) throws NoSuchMethodException {
        for (Class<?> current = type; current != null; current = current.getSuperclass())
            for (Method method : current.getDeclaredMethods()) if (method.getName().equals(name) && method.getParameterTypes().length == arity) {
                method.setAccessible(true); return method;
            }
        throw new NoSuchMethodException(name);
    }
    private static Object field(Object object, String name) throws Exception { return findField(object.getClass(), name).get(object); }
    private static Field findField(Class<?> type, String name) throws Exception {
        for (Class<?> current = type; current != null; current = current.getSuperclass()) try {
            Field field = current.getDeclaredField(name); field.setAccessible(true); return field;
        } catch (NoSuchFieldException ignored) { }
        throw new NoSuchFieldException(name);
    }
    private static void set(Object object, String name, Object value) throws Exception {
        Field field = findField(object.getClass(), name); field.set(object, value);
    }

    private static final class RoadCutStats {
        final int tileCount, featureCount, pendingTileCount; final String signature;
        final boolean snapshotConsistent; final int stableReads; final long elapsedMs; final boolean stable;
        RoadCutStats(int tileCount, int featureCount, String signature, int pendingTileCount, boolean snapshotConsistent, int stableReads, long elapsedMs) {
            this.tileCount = tileCount; this.featureCount = featureCount; this.signature = signature; this.pendingTileCount = pendingTileCount;
            this.snapshotConsistent = snapshotConsistent; this.stableReads = stableReads; this.elapsedMs = elapsedMs;
            this.stable = snapshotConsistent && tileCount > 0 && featureCount > 0 && stableReads >= 5;
        }
        boolean hasFeatures() { return tileCount > 0 && featureCount > 0; }
    }
    private static final class TileCoordinate {
        final int z, row, column; final String key;
        TileCoordinate(int z, int row, int column, String key) { this.z = z; this.row = row; this.column = column; this.key = key; }
    }
}
