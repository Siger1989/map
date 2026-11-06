package com.shantu.qa149;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.os.Environment;
import android.view.View;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Synthetic, in-process rendering probe for the existing floating navigation View.
 * It never starts the service, accesses location providers, or writes navigation state.
 */
public final class Native174FloatingDiagnostics {
    private static final String VIEW_CLASS = "com.shantu.nativeapp.floating.FloatingNavigationView";
    private static final String COORDINATE_CLASS = "com.shantu.nativeapp.floating.FloatingCoordinate";
    private static final String TILE_CLASS = "com.shantu.nativeapp.floating.FloatingTileGeometry";
    private static final String FEATURE_CLASS = "com.shantu.nativeapp.geology.NativeMvtFeature";
    private static final double CENTER_LON = 103.70;
    private static final double CENTER_LAT = 30.70;

    private Native174FloatingDiagnostics() {}

    public static JSONObject state(Native149Instrumentation parent) throws Exception {
        String runId = UUID.randomUUID().toString().replace("-", "");
        File pictures = parent.getTargetContext().getExternalFilesDir(Environment.DIRECTORY_PICTURES);
        if (pictures == null) pictures = parent.getTargetContext().getFilesDir();
        File evidence = new File(pictures, "native174-floating-state-" + runId);
        if (!evidence.mkdirs() && !evidence.isDirectory()) throw new IllegalStateException("status evidence directory unavailable");
        JSONObject report = new JSONObject()
            .put("mode", "native174-floating-state")
            .put("testState", "READ_ONLY_STATUS")
            .put("serviceStatusAvailable", false)
            .put("routeOrLocationValuesRead", false)
            .put("recordingPhaseAvailable", false)
            .put("evidenceDirectory", evidence.getAbsolutePath());
        try {
            Class<?> service = Class.forName("com.shantu.nativeapp.floating.FloatingNavigationService", false,
                parent.getTargetContext().getClassLoader());
            Field companionField = service.getDeclaredField("Companion");
            companionField.setAccessible(true);
            Object companion = companionField.get(null);
            Method statusMethod = companion.getClass().getDeclaredMethod("status");
            statusMethod.setAccessible(true);
            Object value = statusMethod.invoke(companion);
            if (!(value instanceof JSONObject)) throw new IllegalStateException("status contract unavailable");
            JSONObject raw = (JSONObject) value;
            JSONObject safe = new JSONObject()
                .put("enabled", raw.optBoolean("enabled"))
                .put("visible", raw.optBoolean("visible"))
                .put("mode", safeEnum(raw.optString("mode"), "north", "motion"))
                .put("kind", safeEnum(raw.optString("kind"), "position", "route"))
                .put("zoom", raw.optInt("zoom", -1));
            JSONObject lockscreen = raw.optJSONObject("lockscreen");
            if (lockscreen != null) {
                safe.put("lockscreen", new JSONObject()
                    .put("screenOn", lockscreen.optBoolean("screenOn"))
                    .put("locked", lockscreen.optBoolean("locked"))
                    .put("launchPending", lockscreen.optBoolean("launchPending"))
                    .put("attached", lockscreen.optBoolean("attached"))
                    .put("launchAttempted", lockscreen.optBoolean("launchAttempted")));
            }
            report.put("serviceStatusAvailable", true).put("safeStatus", safe);
        } catch (Throwable error) {
            report.put("statusUnavailableReason", error.getClass().getSimpleName());
        }
        try (FileOutputStream output = new FileOutputStream(new File(evidence, "report.json"))) {
            output.write(report.toString(2).getBytes("UTF-8"));
        }
        return report;
    }

    public static JSONObject render(Native149Instrumentation parent) throws Exception {
        if (parent == null) throw new IllegalArgumentException("instrumentation required");
        Context context = parent.getTargetContext();
        String runId = UUID.randomUUID().toString().replace("-", "");
        File pictures = context.getExternalFilesDir(Environment.DIRECTORY_PICTURES);
        if (pictures == null) pictures = context.getFilesDir();
        File evidence = new File(pictures, "native174-floating-" + runId);
        if (!evidence.mkdirs() && !evidence.isDirectory()) throw new IllegalStateException("diagnostic evidence directory unavailable");

        android.util.DisplayMetrics metrics = context.getResources().getDisplayMetrics();
        int width = Math.max(360, Math.min(640, metrics.widthPixels));
        int height = Math.max(620, Math.min(1000, metrics.heightPixels));
        AtomicReference<JSONObject> result = new AtomicReference<>();
        AtomicReference<Throwable> failure = new AtomicReference<>();
        parent.runOnMainSync(() -> {
            try {
                result.set(renderOnMain(context, evidence, width, height));
            } catch (Throwable error) {
                failure.set(error);
            }
        });
        if (failure.get() != null) {
            Throwable error = failure.get();
            throw new IllegalStateException("synthetic render probe failed: " + error.getClass().getSimpleName(), error);
        }
        return result.get();
    }

    private static JSONObject renderOnMain(Context context, File evidence, int width, int height) throws Exception {
        ClassLoader loader = context.getClassLoader();
        Class<?> viewType = Class.forName(VIEW_CLASS, false, loader);
        Constructor<?> viewConstructor = viewType.getDeclaredConstructor(Context.class);
        viewConstructor.setAccessible(true);
        View view = (View) viewConstructor.newInstance(context);

        Object center = coordinate(loader, CENTER_LON, CENTER_LAT);
        List<Object> route = Arrays.asList(
            coordinate(loader, CENTER_LON - .0020, CENTER_LAT - .0012),
            coordinate(loader, CENTER_LON - .0006, CENTER_LAT + .0004),
            coordinate(loader, CENTER_LON + .0008, CENTER_LAT - .0005),
            coordinate(loader, CENTER_LON + .0020, CENTER_LAT + .0012));
        List<List<Object>> segments = Arrays.asList(
            Arrays.asList(coordinate(loader, CENTER_LON - .0020, CENTER_LAT - .0010),
                coordinate(loader, CENTER_LON - .0006, CENTER_LAT - .0003),
                coordinate(loader, CENTER_LON + .0008, CENTER_LAT + .0004),
                coordinate(loader, CENTER_LON + .0020, CENTER_LAT + .0010)));

        set(view, "setLockscreenPresentation", false);
        set(view, "setCenter", center);
        set(view, "setZoom", 14);
        set(view, "setHasRealLocation", true); // Synthetic presentation input; no location API is used.
        set(view, "setKind", "position");
        set(view, "setRoute", route);
        set(view, "setRouteColor", 0xff48a9ff);
        set(view, "setRecordedSegments", segments);
        set(view, "setRecordingPhase", "paused");
        set(view, "setStateText", "合成诊断数据");
        set(view, "setLabel", "合成路线");
        set(view, "setRouteRemainingMeters", 860.0);

        view.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY));
        view.layout(0, 0, width, height);

        JSONObject report = new JSONObject()
            .put("mode", "native174-floating-render")
            .put("testState", "SYNTHETIC_RENDER")
            .put("syntheticFixture", true)
            .put("realNavigationOrPhoneMotion", false)
            .put("gpsOrLocationProviderUsed", false)
            .put("recordingStoreWritten", false)
            .put("center", "synthetic-only")
            .put("viewSizePx", new JSONObject().put("width", width).put("height", height))
            .put("evidenceDirectory", evidence.getAbsolutePath());

        JSONArray directionReports = new JSONArray();
        boolean directionChecksPass = true;
        int trackPixels = 0;
        String[] names = {"north", "motion-0", "motion-45", "motion-90", "motion-180", "motion-270"};
        double[] bearings = {Double.NaN, 0, 45, 90, 180, 270};
        for (int i = 0; i < names.length; i++) {
            String mode = i == 0 ? "north" : "motion";
            Double bearing = Double.isNaN(bearings[i]) ? null : bearings[i];
            set(view, "setMode", mode);
            set(view, "setMapBearing", bearing);
            set(view, "setHeading", bearing);
            Bitmap bitmap = draw(view, width, height);
            int cyan = countCyanNearCenter(bitmap);
            int yellow = countYellowNearCenter(bitmap);
            String imageName = names[i] + ".png";
            writePng(bitmap, new File(evidence, imageName));
            bitmap.recycle();
            boolean visible = cyan > 0;
            directionChecksPass &= visible;
            if (i == 1) trackPixels = yellow;
            directionReports.put(new JSONObject().put("case", names[i]).put("centerGlyphPixels", cyan)
                .put("yellowTrackPixelsNearCenter", yellow).put("glyphVisible", visible).put("image", imageName));
        }
        report.put("directionCases", directionReports)
            .put("directionCasesPass", directionChecksPass)
            .put("syntheticYellowTrackPixels", trackPixels)
            .put("trackVisible", trackPixels > 0);

        // Exercise the actual MVT-consuming draw path under each orientation.
        set(view, "setHasRealLocation", false);
        set(view, "setHeading", null);
        set(view, "setRoute", Collections.emptyList());
        set(view, "setRecordedSegments", Collections.emptyList());
        set(view, "setKind", "route");
        set(view, "setMode", "north");
        set(view, "setMapBearing", null);
        TilePosition tilePosition = tilePosition(CENTER_LON, CENTER_LAT, 14);
        Object labelFeature = feature(loader, "place", 1, 4096,
            Collections.singletonMap("name", "CURRENT TILE"),
            Collections.singletonList(Collections.singletonList(pair(loader, tilePosition.localX, tilePosition.localY))));
        Object currentTile = tile(loader, 14, tilePosition.x, tilePosition.y, Collections.singletonList(labelFeature));

        ArrayList<Object> farFeatures = new ArrayList<>();
        farFeatures.add(highVertexRoadFeature(loader, tilePosition.localX, tilePosition.localY));
        Object farTile = tile(loader, 14, Math.floorMod(tilePosition.x + 1, 1 << 14), tilePosition.y, farFeatures);
        JSONArray mvtOrientationReports = new JSONArray();
        boolean currentTileSurvives = true;
        int firstBaselinePixels = 0;
        int firstStressPixels = 0;
        for (int i = 0; i < names.length; i++) {
            String mode = i == 0 ? "north" : "motion";
            Double bearing = Double.isNaN(bearings[i]) ? null : bearings[i];
            set(view, "setMode", mode);
            set(view, "setMapBearing", bearing);
            set(view, "setTiles", Collections.singletonList(currentTile));
            Bitmap baseline = draw(view, width, height);
            int baselinePixels = countNeutralNearCenter(baseline);
            String baselineName = "mvt-" + names[i] + "-baseline.png";
            writePng(baseline, new File(evidence, baselineName));
            baseline.recycle();

            // The adjacent 8,000-vertex feature is first in supplied order to
            // stress whether viewport priority/culling preserves the live tile label.
            set(view, "setTiles", Arrays.asList(farTile, currentTile));
            Bitmap stressed = draw(view, width, height);
            int stressPixels = countNeutralNearCenter(stressed);
            String stressName = "mvt-" + names[i] + "-far-high-vertex.png";
            writePng(stressed, new File(evidence, stressName));
            stressed.recycle();

            boolean baselineVisible = baselinePixels > 0;
            boolean stressVisible = stressPixels > 0;
            currentTileSurvives &= baselineVisible && stressVisible;
            if (i == 0) { firstBaselinePixels = baselinePixels; firstStressPixels = stressPixels; }
            mvtOrientationReports.put(new JSONObject()
                .put("case", names[i])
                .put("currentTileLabelPixelsBaseline", baselinePixels)
                .put("currentTileLabelPixelsWithFarTile", stressPixels)
                .put("baselineVisible", baselineVisible)
                .put("stressVisible", stressVisible)
                .put("images", new JSONArray().put(baselineName).put(stressName)));
        }
        report.put("mvtStress", new JSONObject()
            .put("syntheticTileOrder", new JSONArray().put("far-high-vertex").put("current"))
            .put("farFeatureVertices", 8000)
            .put("currentTileLabelPixelsBaseline", firstBaselinePixels)
            .put("currentTileLabelPixelsWithFarTile", firstStressPixels)
            .put("currentTileSurvives", currentTileSurvives)
            .put("orientationCases", mvtOrientationReports));

        JSONObject lockscreenFairBudget = renderLockscreenFairBudgetCases(view, context, evidence, loader);
        report.put("lockscreenFairBudget", lockscreenFairBudget);

        boolean pass = directionChecksPass && trackPixels > 0 && currentTileSurvives &&
            lockscreenFairBudget.optBoolean("pass", false);
        report.put("testState", pass ? "PASS_SYNTHETIC_ONLY" : "FAIL_SYNTHETIC_RENDER_CHECK")
            .put("note", "Synthetic View rendering only; does not prove live navigation, location, or device behavior.");
        try (FileOutputStream output = new FileOutputStream(new File(evidence, "report.json"))) {
            output.write(report.toString(2).getBytes("UTF-8"));
        }
        return report;
    }

    private static Object coordinate(ClassLoader loader, double longitude, double latitude) throws Exception {
        Class<?> type = Class.forName(COORDINATE_CLASS, false, loader);
        Constructor<?> constructor = type.getDeclaredConstructor(double.class, double.class);
        constructor.setAccessible(true);
        return constructor.newInstance(longitude, latitude);
    }

    private static Object tile(ClassLoader loader, int z, int x, int y, List<?> features) throws Exception {
        Class<?> type = Class.forName(TILE_CLASS, false, loader);
        Constructor<?> constructor = type.getDeclaredConstructor(int.class, int.class, int.class, List.class);
        constructor.setAccessible(true);
        return constructor.newInstance(z, x, y, features);
    }

    private static Object feature(ClassLoader loader, String layer, int type, int extent,
                                  Map<String, String> properties, List<?> paths) throws Exception {
        Class<?> featureType = Class.forName(FEATURE_CLASS, false, loader);
        for (Constructor<?> constructor : featureType.getDeclaredConstructors()) {
            Class<?>[] p = constructor.getParameterTypes();
            if (p.length == 5 && p[0] == String.class && p[1] == int.class && p[2] == int.class) {
                constructor.setAccessible(true);
                return constructor.newInstance(layer, type, extent, properties, paths);
            }
        }
        throw new NoSuchMethodException("NativeMvtFeature constructor");
    }

    private static Object pair(ClassLoader loader, int x, int y) throws Exception {
        Class<?> type = Class.forName("kotlin.Pair", false, loader);
        Constructor<?> constructor = type.getDeclaredConstructor(Object.class, Object.class);
        constructor.setAccessible(true);
        return constructor.newInstance(x, y);
    }

    private static Object highVertexRoadFeature(ClassLoader loader, int currentLocalX, int currentLocalY) throws Exception {
        // The adjacent tile extrapolates just across its west edge into the center tile.
        int x = currentLocalX - 4096;
        ArrayList<Object> path = new ArrayList<>(8000);
        for (int i = 0; i < 8000; i++) {
            int dx = (i % 11) - 5;
            path.add(pair(loader, x + dx, currentLocalY + ((i / 11) % 9) - 4));
        }
        List<List<Object>> paths = Collections.singletonList(path);
        Map<String, String> properties = new HashMap<>();
        properties.put("class", "residential");
        return feature(loader, "transportation", 2, 4096, properties, paths);
    }

    /** Lockscreen-only dense tile fixture; no service or persisted state is involved. */
    private static JSONObject renderLockscreenFairBudgetCases(View view, Context context, File evidence,
                                                               ClassLoader loader) throws Exception {
        final int z = 14;
        final int n = 1 << z;
        int cxTile = (int) Math.floor((CENTER_LON + 180.0) / 360.0 * n);
        int cyTile = (int) Math.floor((1.0 - Math.log(Math.tan(Math.toRadians(CENTER_LAT)) +
            1.0 / Math.cos(Math.toRadians(CENTER_LAT))) / Math.PI) / 2.0 * n);
        double centerLat = Math.toDegrees(Math.atan(Math.sinh(Math.PI * (1.0 - 2.0 * (cyTile + .5) / n))));
        double centerLon = ((cxTile + .5) / n) * 360.0 - 180.0;
        Object center = coordinate(loader, centerLon, centerLat);

        int width = Math.max(1200, view.getWidth());
        int height = Math.max(1200, view.getHeight());
        view.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY));
        view.layout(0, 0, width, height);
        set(view, "setLockscreenPresentation", true);
        set(view, "setCenter", center);
        set(view, "setZoom", 14); // z14 is the supported base scale; neighbors fit in the large synthetic canvas.
        set(view, "setHasRealLocation", false);
        set(view, "setHeading", null);
        set(view, "setMode", "compass");
        set(view, "setRoute", Collections.emptyList());
        set(view, "setRecordedSegments", Collections.emptyList());
        set(view, "setStateText", "合成锁屏预算测试");

        ArrayList<Object> labelFeatures = new ArrayList<>();
        labelFeatures.add(feature(loader, "place", 1, 4096, Collections.singletonMap("name", "LOCK MAP"),
            Collections.singletonList(Collections.singletonList(pair(loader, 2048, 2048)))));
        ArrayList<Object> densePath = new ArrayList<>(8000);
        for (int i = 0; i < 8000; i++) {
            int offset = i - 4000;
            densePath.add(pair(loader, 3500 + offset / 10, 500 + ((i % 5) - 2)));
        }
        Map<String, String> residential = Collections.singletonMap("class", "residential");
        labelFeatures.add(feature(loader, "transportation", 2, 4096, residential,
            Collections.singletonList(densePath)));
        ArrayList<Object> fixtureTiles = new ArrayList<>(5);
        fixtureTiles.add(tile(loader, z, cxTile, cyTile, labelFeatures));

        String[] neighborNames = {"north", "east", "south", "west"};
        int[] dxs = {0, 1, 0, -1};
        int[] dys = {-1, 0, 1, 0};
        int[] localXs = {2048, 8, 2048, 4088};
        int[] localYs = {4088, 2048, 8, 2048};
        for (int i = 0; i < neighborNames.length; i++) {
            ArrayList<Object> path = new ArrayList<>(100);
            for (int j = 0; j < 100; j++) {
                int delta = j * 3 - 148;
                int px = localXs[i] + (dxs[i] == 0 ? delta : 0);
                int py = localYs[i] + (dys[i] == 0 ? delta : 0);
                path.add(pair(loader, px, py));
            }
            Object road = feature(loader, "transportation", 2, 4096, residential,
                Collections.singletonList(path));
            fixtureTiles.add(tile(loader, z, Math.floorMod(cxTile + dxs[i], n), cyTile + dys[i],
                Collections.singletonList(road)));
        }

        JSONArray orientations = new JSONArray();
        boolean allOrientationsPass = true;
        for (int bearing : new int[]{0, 45, 90, 180, 270}) {
            set(view, "setMapBearing", (double) bearing);
            set(view, "setTiles", fixtureTiles);
            Bitmap bitmap = draw(view, width, height);
            JSONObject counters = readRenderCounters(view);
            JSONObject neighborPixels = new JSONObject();
            boolean everyNeighborVisible = true;
            for (int i = 0; i < neighborNames.length; i++) {
                JSONArray samples = new JSONArray();
                int pixels = 0;
                int[] sampleVertexIndices = {5, 28, 50, 72, 94};
                boolean allPathSamplesVisible = true;
                for (int sampleIndex : sampleVertexIndices) {
                    int delta = sampleIndex * 3 - 148;
                    int sampleX = localXs[i] + (dxs[i] == 0 ? delta : 0);
                    int sampleY = localYs[i] + (dys[i] == 0 ? delta : 0);
                    double localX = (sampleX + 1.5) / 4096.0;
                    double localY = (sampleY + 1.5) / 4096.0;
                    double tileDx = dxs[i] + localX - .5;
                    double tileDy = dys[i] + localY - .5;
                    double scale = 256.0 * context.getResources().getDisplayMetrics().density;
                    double x = tileDx * scale, y = tileDy * scale;
                    double radians = Math.toRadians(-bearing);
                    int sx = (int) Math.round(width / 2.0 + x * Math.cos(radians) - y * Math.sin(radians));
                    int sy = (int) Math.round(height / 2.0 + x * Math.sin(radians) + y * Math.cos(radians));
                    int samplePixels = countResidentialNear(bitmap, sx, sy, 8);
                    pixels += samplePixels;
                    boolean sampleVisible = samplePixels > 0;
                    allPathSamplesVisible &= sampleVisible;
                    samples.put(new JSONObject().put("vertexIndex", sampleIndex)
                        .put("visiblePixels", samplePixels).put("visible", sampleVisible));
                }
                boolean visible = allPathSamplesVisible;
                everyNeighborVisible &= visible;
                neighborPixels.put(neighborNames[i], new JSONObject()
                    .put("visiblePathPixels", pixels).put("sampledPathSections", samples).put("visible", visible));
            }
            int labelPixels = countNeutralNearCenter(bitmap);
            boolean underBudget = counters.optBoolean("available", false) &&
                counters.optInt("acceptedVertices", Integer.MAX_VALUE) <= 8000;
            boolean passed = underBudget && everyNeighborVisible && labelPixels > 0;
            allOrientationsPass &= passed;
            String image = "lockscreen-dense-compass-" + bearing + ".png";
            writePng(bitmap, new File(evidence, image));
            bitmap.recycle();
            orientations.put(new JSONObject().put("compassDegrees", bearing)
                .put("neighborRoads", neighborPixels).put("labelPixels", labelPixels)
                .put("renderCounters", counters).put("within8000VertexBudget", underBudget)
                .put("allNeighborRoadsVisible", everyNeighborVisible).put("pass", passed).put("image", image));
        }
        return new JSONObject().put("syntheticFixture", true).put("lockscreenPresentation", true)
            .put("tileFixture", "dense center residential path plus four neighboring residential paths")
            .put("centerPathVertices", 8000).put("eachNeighborPathVertices", 100)
            .put("canvasPx", new JSONObject().put("width", width).put("height", height))
            .put("globalVertexBudget", 8000).put("orientationCases", orientations)
            .put("pass", allOrientationsPass);
    }

    private static JSONObject readRenderCounters(View view) throws Exception {
        Object counters = null;
        String counterSource = null;
        for (Method method : view.getClass().getMethods()) {
            if (method.getName().startsWith("getRenderCounters") && method.getParameterTypes().length == 0) {
                try {
                    counters = method.invoke(view);
                    counterSource = "getter";
                    break;
                } catch (Throwable ignored) { /* Try the retained data-class field below. */ }
            }
        }
        JSONObject json = new JSONObject();
        if (counters == null) {
            for (Field field : view.getClass().getDeclaredFields()) {
                try {
                    field.setAccessible(true);
                    Object candidate = field.get(view);
                    String text = String.valueOf(candidate);
                    if (text.contains("visibleTiles=") && text.contains("acceptedVertices=")) {
                        counters = candidate;
                        counterSource = "view-field";
                        break;
                    }
                } catch (Throwable ignored) { /* Optimized builds may hide the field; try rendering toString. */ }
            }
        }
        String printable = counters == null ? null : String.valueOf(counters);
        if (counterSource == null && counters != null) counterSource = "toString";
        for (String property : new String[]{"visibleTiles", "candidatePaths", "acceptedPaths", "acceptedVertices",
            "pathsSkippedByBudget", "pathsSkippedByCandidateLimit"}) {
            Integer value = null;
            if (counters != null) {
                String expected = "get" + Character.toUpperCase(property.charAt(0)) + property.substring(1);
                for (Method method : counters.getClass().getMethods()) {
                    if (!method.getName().startsWith(expected) || method.getParameterTypes().length != 0) continue;
                    try { value = ((Number) method.invoke(counters)).intValue(); break; }
                    catch (Throwable ignored) { /* Continue to field/string fallback. */ }
                }
                if (value == null) {
                    try {
                        Field field = counters.getClass().getDeclaredField(property);
                        field.setAccessible(true);
                        Object raw = field.get(counters);
                        if (raw instanceof Number) value = ((Number) raw).intValue();
                    } catch (Throwable ignored) { /* R8 can remove the access path; parse data-class toString. */ }
                }
            }
            if (value == null && printable != null) value = parseCounter(printable, property);
            json.put(property, value == null ? JSONObject.NULL : value);
        }
        boolean complete = true;
        for (String property : new String[]{"visibleTiles", "candidatePaths", "acceptedPaths", "acceptedVertices",
            "pathsSkippedByBudget", "pathsSkippedByCandidateLimit"}) complete &= json.opt(property) instanceof Number;
        json.put("available", complete).put("source", counterSource == null ? "unavailable" : counterSource);
        return json;
    }

    private static Integer parseCounter(String text, String name) {
        String token = name + "=";
        int at = text.indexOf(token);
        if (at < 0 || (at > 0 && Character.isLetterOrDigit(text.charAt(at - 1)))) return null;
        at += token.length();
        int end = at;
        while (end < text.length() && Character.isDigit(text.charAt(end))) end++;
        if (end == at) return null;
        try { return Integer.parseInt(text.substring(at, end)); }
        catch (NumberFormatException ignored) { return null; }
    }

    private static int countResidentialNear(Bitmap bitmap, int cx, int cy, int radius) {
        int count = 0;
        for (int y = Math.max(0, cy - radius); y <= Math.min(bitmap.getHeight() - 1, cy + radius); y++) {
            for (int x = Math.max(0, cx - radius); x <= Math.min(bitmap.getWidth() - 1, cx + radius); x++) {
                int color = bitmap.getPixel(x, y);
                int r = (color >>> 16) & 255, g = (color >>> 8) & 255, b = color & 255;
                // The line color is #4d6651, drawn at 0.8dp. On lockscreen black,
                // pixel-center antialiasing contributes roughly half-strength RGB.
                // Test the muted-green hue and minimum channel energy, not generic nonblack pixels.
                if (r >= 20 && r <= 105 && g >= 30 && g <= 135 && b >= 18 &&
                    g >= r * 1.12 && g <= r * 1.75 && b >= r * .78 && b <= g * 1.12) count++;
            }
        }
        return count;
    }

    private static void set(Object target, String methodName, Object value) throws Exception {
        Method selected = null;
        for (Method method : target.getClass().getMethods()) {
            if (!method.getName().equals(methodName) || method.getParameterTypes().length != 1) continue;
            Class<?> parameter = method.getParameterTypes()[0];
            if (value == null) {
                if (!parameter.isPrimitive()) { selected = method; break; }
            } else if (wrap(parameter).isAssignableFrom(value.getClass())) {
                selected = method; break;
            }
        }
        if (selected == null) throw new NoSuchMethodException(methodName);
        selected.invoke(target, value);
    }

    private static Class<?> wrap(Class<?> type) {
        if (!type.isPrimitive()) return type;
        if (type == int.class) return Integer.class;
        if (type == boolean.class) return Boolean.class;
        if (type == double.class) return Double.class;
        if (type == float.class) return Float.class;
        if (type == long.class) return Long.class;
        return type;
    }

    private static Bitmap draw(View view, int width, int height) {
        Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        view.draw(new Canvas(bitmap));
        return bitmap;
    }

    private static void writePng(Bitmap bitmap, File destination) throws Exception {
        try (FileOutputStream output = new FileOutputStream(destination)) {
            if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)) throw new IllegalStateException("PNG compression failed");
        }
    }

    private static int countCyanNearCenter(Bitmap bitmap) {
        int cx = bitmap.getWidth() / 2, cy = bitmap.getHeight() / 2, count = 0;
        int radius = Math.max(24, Math.min(bitmap.getWidth(), bitmap.getHeight()) / 12);
        for (int y = Math.max(0, cy - radius); y < Math.min(bitmap.getHeight(), cy + radius); y++) {
            for (int x = Math.max(0, cx - radius); x < Math.min(bitmap.getWidth(), cx + radius); x++) {
                int dx = x - cx, dy = y - cy;
                if (dx * dx + dy * dy > radius * radius) continue;
                int color = bitmap.getPixel(x, y);
                if (((color >>> 16) & 255) > 40 && ((color >>> 8) & 255) > 175 && (color & 255) > 185) count++;
            }
        }
        return count;
    }

    private static int countYellowNearCenter(Bitmap bitmap) {
        int cx = bitmap.getWidth() / 2, cy = bitmap.getHeight() / 2, count = 0;
        int radius = Math.max(60, Math.min(bitmap.getWidth(), bitmap.getHeight()) / 7);
        for (int y = Math.max(0, cy - radius); y < Math.min(bitmap.getHeight(), cy + radius); y++) {
            for (int x = Math.max(0, cx - radius); x < Math.min(bitmap.getWidth(), cx + radius); x++) {
                int dx = x - cx, dy = y - cy;
                if (dx * dx + dy * dy > radius * radius) continue;
                int color = bitmap.getPixel(x, y);
                if (((color >>> 16) & 255) > 210 && ((color >>> 8) & 255) > 145 && (color & 255) < 140) count++;
            }
        }
        return count;
    }

    private static int countNeutralNearCenter(Bitmap bitmap) {
        int cx = bitmap.getWidth() / 2, cy = bitmap.getHeight() / 2, count = 0;
        int radius = Math.max(42, Math.min(bitmap.getWidth(), bitmap.getHeight()) / 10);
        for (int y = Math.max(0, cy - radius); y < Math.min(bitmap.getHeight(), cy + radius); y++) {
            for (int x = Math.max(0, cx - radius); x < Math.min(bitmap.getWidth(), cx + radius); x++) {
                int dx = x - cx, dy = y - cy;
                if (dx * dx + dy * dy > radius * radius) continue;
                int color = bitmap.getPixel(x, y);
                int r = (color >>> 16) & 255, g = (color >>> 8) & 255, b = color & 255;
                if (r > 145 && g > 155 && b > 145 && Math.abs(r - g) < 55 && Math.abs(g - b) < 55) count++;
            }
        }
        return count;
    }

    private static String safeEnum(String value, String... allowed) {
        for (String item : allowed) if (item.equals(value)) return value;
        return "unknown";
    }

    private static TilePosition tilePosition(double lon, double lat, int z) {
        int n = 1 << z;
        double worldX = (lon + 180.0) / 360.0 * n;
        double radians = Math.toRadians(Math.max(-85.05112878, Math.min(85.05112878, lat)));
        double worldY = (1.0 - Math.log(Math.tan(radians) + 1.0 / Math.cos(radians)) / Math.PI) / 2.0 * n;
        int x = (int) Math.floor(worldX), y = (int) Math.floor(worldY);
        return new TilePosition(x, y, (int) Math.round((worldX - x) * 4096), (int) Math.round((worldY - y) * 4096));
    }

    private static final class TilePosition {
        final int x, y, localX, localY;
        TilePosition(int x, int y, int localX, int localY) { this.x = x; this.y = y; this.localX = localX; this.localY = localY; }
    }
}
