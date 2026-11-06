package com.shantu.qa149;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.os.Environment;
import android.os.SystemClock;
import android.view.View;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;

/** Synthetic terrain presentation probe for the existing floating View; never starts a service or uses location APIs. */
public final class Native178FloatingTerrainDiagnostics {
    private static final String VIEW_CLASS = "com.shantu.nativeapp.floating.FloatingNavigationView";
    private static final String COORDINATE_CLASS = "com.shantu.nativeapp.floating.FloatingCoordinate";
    private static final String TILE_CLASS = "com.shantu.nativeapp.floating.FloatingTerrainTile";
    private static final String SCENE_CLASS = "com.shantu.nativeapp.floating.FloatingTerrainScene";
    private static final double CENTER_LON = 103.7;
    private static final double CENTER_LAT = 30.7;
    private static final int ZOOM = 14;
    private static final int SIDE = 33;
    private static final int ROUTE_COLOR = 0xff48a9ff;

    private Native178FloatingTerrainDiagnostics() {}

    public static JSONObject render(Native149Instrumentation parent) throws Exception {
        if (parent == null) throw new IllegalArgumentException("instrumentation required");
        Context context = parent.getTargetContext();
        String runId = UUID.randomUUID().toString().replace("-", "");
        File pictures = context.getExternalFilesDir(Environment.DIRECTORY_PICTURES);
        if (pictures == null) pictures = context.getFilesDir();
        File evidence = new File(pictures, "native178-floating-terrain-" + runId);
        if (!evidence.mkdirs() && !evidence.isDirectory()) throw new IllegalStateException("diagnostic evidence directory unavailable");

        int windowWidth = Math.max(220, Math.round(220 * context.getResources().getDisplayMetrics().density));
        int windowHeight = Math.max(240, Math.round(240 * context.getResources().getDisplayMetrics().density));
        int lockWidth = Math.max(390, Math.round(390 * context.getResources().getDisplayMetrics().density));
        int lockHeight = Math.max(520, Math.round(520 * context.getResources().getDisplayMetrics().density));
        float density = context.getResources().getDisplayMetrics().density;
        JSONObject[] result = new JSONObject[1];
        Throwable[] failure = new Throwable[1];
        final File output = evidence;
        parent.runOnMainSync(() -> {
            try { result[0] = renderOnMain(context, output, windowWidth, windowHeight, lockWidth, lockHeight, density); }
            catch (Throwable error) { failure[0] = error; }
        });
        if (failure[0] != null) throw new IllegalStateException("synthetic terrain render failed: " + failure[0].getClass().getSimpleName(), failure[0]);
        return result[0];
    }

    private static JSONObject renderOnMain(Context context, File evidence, int windowWidth, int windowHeight,
                                           int lockWidth, int lockHeight, float density) throws Exception {
        ClassLoader loader = context.getClassLoader();
        Class<?> viewType = Class.forName(VIEW_CLASS, false, loader);
        Constructor<?> viewConstructor = viewType.getDeclaredConstructor(Context.class);
        viewConstructor.setAccessible(true);
        View view = (View) viewConstructor.newInstance(context);

        Object center = coordinate(loader, CENTER_LON, CENTER_LAT);
        Object scene = scene(loader);
        double north = 125.0 / 111_320.0;
        double south = 110.0 / 111_320.0;
        List<Object> route = Arrays.asList(center,
            coordinate(loader, CENTER_LON, CENTER_LAT + north),
            coordinate(loader, CENTER_LON, CENTER_LAT + north * 2.0));
        List<List<Object>> recorded = Arrays.asList(Arrays.asList(center,
            coordinate(loader, CENTER_LON, CENTER_LAT - south),
            coordinate(loader, CENTER_LON, CENTER_LAT - south * 2.0)));

        set(view, "setCenter", center);
        set(view, "setZoom", ZOOM);
        set(view, "setKind", "route");
        set(view, "setLabel", "合成山谷路线");
        set(view, "setHasRealLocation", true); // Presentation fixture only; no GPS/location API is accessed.
        set(view, "setOutdoorContours", true);
        set(view, "setTerrainScene", scene);
        set(view, "setTerrainLoading", false);
        set(view, "setRoute", route);
        set(view, "setRouteColor", ROUTE_COLOR);
        set(view, "setRecordedSegments", recorded);
        set(view, "setRecordingPhase", "recording");
        set(view, "setStateText", "合成诊断数据");

        String[] caseNames = {"north", "motion-45", "motion-90", "compass-90", "compass-180", "compass-waiting"};
        String[] modes = {"north", "motion", "motion", "compass", "compass", "compass"};
        Double[] bearings = {null, 45.0, 90.0, 90.0, 180.0, null};
        Double[] headings = {45.0, 45.0, 90.0, 90.0, 180.0, null};
        JSONArray cases = new JSONArray();
        boolean allPass = true;
        boolean allTerrainCasesPass = true;
        boolean allWaitingCasesPass = true;
        boolean anyGlyphOcclusionVerified = false;
        for (int sizeIndex = 0; sizeIndex < 2; sizeIndex++) {
            int width = sizeIndex == 0 ? windowWidth : lockWidth;
            int height = sizeIndex == 0 ? windowHeight : lockHeight;
            boolean lockscreen = sizeIndex == 1;
            measure(view, width, height);
            set(view, "setLockscreenPresentation", lockscreen);
            for (int i = 0; i < caseNames.length; i++) {
                set(view, "setMode", modes[i]);
                set(view, "setMapBearing", bearings[i]);
                set(view, "setHeading", headings[i]);
                if ("compass-waiting".equals(caseNames[i])) set(view, "setStateText", "等待罗盘方向");
                else set(view, "setStateText", "合成诊断数据");
                // The renderer deliberately rate-limits preparation when a pane reuses the same bounds.
                SystemClock.sleep(210L);
                long drawStarted = SystemClock.elapsedRealtimeNanos();
                Bitmap bitmap = draw(view, width, height);
                double drawMillis = (SystemClock.elapsedRealtimeNanos() - drawStarted) / 1_000_000.0;
                String image = (lockscreen ? "lockscreen" : "window") + "-" + caseNames[i] + ".png";
                writePng(bitmap, new File(evidence, image));
                int contourPixels = countContourPixels(bitmap, lockscreen, density);
                int routePixels = countRoutePixels(bitmap, lockscreen, density);
                int recordedPixels = countYellowPixels(bitmap, lockscreen, density);
                int centerArrowPixels = countCenterArrow(bitmap, lockscreen, density);
                int waitingTextPixels = countWaitingText(bitmap, lockscreen, density);
                bitmap.recycle();

                boolean waiting = "compass-waiting".equals(caseNames[i]);
                int yellowPixelsWithoutGlyph = -1;
                boolean trackOccludedByLocationGlyph = false;
                String withoutGlyphImage = null;
                if (!waiting && recordedPixels == 0) {
                    set(view, "setHasRealLocation", false);
                    Bitmap withoutGlyph = null;
                    try {
                        // Same scene, pose, route and recording; only the synthetic center glyph is hidden.
                        withoutGlyph = draw(view, width, height);
                        yellowPixelsWithoutGlyph = countYellowPixels(withoutGlyph, lockscreen, density);
                        int extension = image.lastIndexOf('.');
                        withoutGlyphImage = image.substring(0, extension) + "-without-glyph" + image.substring(extension);
                        writePng(withoutGlyph, new File(evidence, withoutGlyphImage));
                    } finally {
                        if (withoutGlyph != null) withoutGlyph.recycle();
                        set(view, "setHasRealLocation", true);
                    }
                    trackOccludedByLocationGlyph = yellowPixelsWithoutGlyph > 0 && centerArrowPixels > 0;
                    anyGlyphOcclusionVerified |= trackOccludedByLocationGlyph;
                }
                boolean passed = waiting
                    ? waitingTextPixels > 0 && contourPixels == 0 && routePixels == 0 && recordedPixels == 0
                    : contourPixels > 0 && routePixels > 0 && centerArrowPixels > 0 &&
                        (recordedPixels > 0 || trackOccludedByLocationGlyph);
                if (waiting) allWaitingCasesPass &= passed; else allTerrainCasesPass &= passed;
                allPass &= passed;
                cases.put(new JSONObject()
                    .put("case", caseNames[i]).put("view", lockscreen ? "lockscreenPresentation" : "floatingWindow")
                    .put("canvasPx", new JSONObject().put("width", width).put("height", height))
                    .put("mode", modes[i]).put("mapBearingDeg", bearings[i] == null ? JSONObject.NULL : bearings[i])
                    .put("trustedSyntheticHeadingDeg", headings[i] == null ? JSONObject.NULL : headings[i])
                    .put("pixelSampleRegion", "full map content; excludes toolbar, resize grip, and lock-screen attribution")
                    .put("greenContourPixels", contourPixels).put("routeColorPixels", routePixels)
                    .put("yellowRecordedTrackPixels", recordedPixels).put("centerArrowPixels", centerArrowPixels)
                    .put("yellowRecordedTrackPixelsWithoutGlyph", yellowPixelsWithoutGlyph < 0 ? JSONObject.NULL : yellowPixelsWithoutGlyph)
                    .put("trackOccludedByLocationGlyph", trackOccludedByLocationGlyph)
                    .put("glyphOcclusionVerified", trackOccludedByLocationGlyph)
                    .put("withoutGlyphImage", withoutGlyphImage == null ? JSONObject.NULL : withoutGlyphImage)
                    .put("waitingDirectionTextPixels", waitingTextPixels).put("pass", passed).put("image", image));
                cases.getJSONObject(cases.length() - 1).put("syntheticSoftwareDrawMillis", drawMillis);
            }
        }

        JSONObject report = new JSONObject()
            .put("mode", "native178-floating-terrain-render")
            .put("testState", !allPass ? "FAIL_SYNTHETIC_RENDER_CHECK" :
                anyGlyphOcclusionVerified ? "PASS_SYNTHETIC_WITH_GLYPH_OCCLUSION" : "PASS_SYNTHETIC_ONLY")
            .put("syntheticFixture", true).put("demFixture", "SYNTHETIC 3x3 XYZ valley DEM, 33x33 samples per tile")
            .put("sampleLayout", "row-major; row 0 north; sample centers match FloatingTerrainSource; no-data represented by NaN")
            .put("syntheticNoDataSampleCount", 4)
            .put("requestedWindowLayoutDp", new JSONObject().put("width", 220).put("height", 240))
            .put("requestedLockscreenPresentationDp", new JSONObject().put("width", 390).put("height", 520))
            .put("displayDensity", context.getResources().getDisplayMetrics().density)
            .put("center", "synthetic-only")
            .put("routeFixture", "synthetic center to north 250m in two segments")
            .put("recordedFixture", "synthetic center to south 220m in two segments; yellow")
            .put("hasRealLocation", true).put("presentationFixtureOnly", true)
            .put("gpsOrLocationProviderUsed", false).put("recordingStoreWritten", false).put("serviceStarted", false)
            .put("testedCases", cases).put("terrainCasesPass", allTerrainCasesPass)
            .put("waitingCasesPass", allWaitingCasesPass).put("trackOcclusionVerifiedAny", anyGlyphOcclusionVerified)
            .put("evidenceDirectory", evidence.getAbsolutePath())
            .put("note", "Synthetic View rendering only. Does not prove live terrain coverage, device heading, navigation, or lock-screen Activity fade.");
        try (FileOutputStream output = new FileOutputStream(new File(evidence, "report.json"))) {
            output.write(report.toString(2).getBytes("UTF-8"));
        }
        return report;
    }

    private static Object scene(ClassLoader loader) throws Exception {
        Class<?> tileType = Class.forName(TILE_CLASS, false, loader);
        Constructor<?> tileConstructor = tileType.getDeclaredConstructor(int.class, int.class, int.class, int.class, double[].class);
        tileConstructor.setAccessible(true);
        Class<?> sceneType = Class.forName(SCENE_CLASS, false, loader);
        Constructor<?> sceneConstructor = sceneType.getDeclaredConstructor(List.class, long.class);
        sceneConstructor.setAccessible(true);
        int n = 1 << ZOOM;
        int centerX = (int) Math.floor((CENTER_LON + 180.0) / 360.0 * n);
        int centerY = (int) Math.floor((1.0 - Math.log(Math.tan(Math.toRadians(CENTER_LAT)) +
            1.0 / Math.cos(Math.toRadians(CENTER_LAT))) / Math.PI) / 2.0 * n);
        List<Object> tiles = new ArrayList<>(9);
        for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
            int tileX = Math.floorMod(centerX + dx, n);
            int tileY = centerY + dy;
            double[] heights = new double[SIDE * SIDE];
            for (int row = 0; row < SIDE; row++) for (int column = 0; column < SIDE; column++) {
                int index = row * SIDE + column;
                if (dx == -1 && dy == -1 && row < 2 && column < 2) { heights[index] = Double.NaN; continue; }
                double worldX = (tileX + (column + .5) / SIDE) / n;
                double worldY = (tileY + (row + .5) / SIDE) / n;
                double longitude = worldX * 360.0 - 180.0;
                double latitude = Math.toDegrees(Math.atan(Math.sinh(Math.PI * (1.0 - 2.0 * worldY))));
                double east = (longitude - CENTER_LON) * 111_320.0 * Math.cos(Math.toRadians(CENTER_LAT));
                double north = (latitude - CENTER_LAT) * 111_320.0;
                // Synthetic valley floor with rising side slopes and shallow cross-ridges to yield contour paths.
                heights[index] = 260.0 + .000035 * east * east + .00010 * north * north +
                    42.0 * Math.sin(east / 240.0) + 24.0 * Math.sin(north / 170.0);
            }
            tiles.add(tileConstructor.newInstance(ZOOM, tileX, tileY, SIDE, heights));
        }
        return sceneConstructor.newInstance(tiles, 1L);
    }

    private static Object coordinate(ClassLoader loader, double longitude, double latitude) throws Exception {
        Class<?> type = Class.forName(COORDINATE_CLASS, false, loader);
        Constructor<?> constructor = type.getDeclaredConstructor(double.class, double.class);
        constructor.setAccessible(true);
        return constructor.newInstance(longitude, latitude);
    }

    private static void set(Object target, String methodName, Object value) throws Exception {
        Method selected = null;
        for (Method method : target.getClass().getMethods()) {
            if (!method.getName().equals(methodName) || method.getParameterTypes().length != 1) continue;
            Class<?> parameter = wrap(method.getParameterTypes()[0]);
            if (value == null ? !method.getParameterTypes()[0].isPrimitive() : parameter.isAssignableFrom(value.getClass())) {
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

    private static void measure(View view, int width, int height) {
        view.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY));
        view.layout(0, 0, width, height);
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

    private static int countContourPixels(Bitmap bitmap, boolean lockscreen, float density) {
        int count = 0;
        for (int y = 0; y < bitmap.getHeight(); y++) for (int x = 0; x < bitmap.getWidth(); x++)
            if (isMapContent(bitmap, x, y, lockscreen, density) && isContour(bitmap.getPixel(x, y))) count++;
        return count;
    }

    private static boolean isContour(int color) {
        int r = (color >>> 16) & 255, g = (color >>> 8) & 255, b = color & 255;
        return r >= 80 && r <= 225 && g >= 125 && g <= 250 && b <= 145 &&
            g > r * 1.08 && g > b * 1.3 && g < b * 2.45;
    }

    private static int countRoutePixels(Bitmap bitmap, boolean lockscreen, float density) {
        int count = 0;
        for (int y = 0; y < bitmap.getHeight(); y++) for (int x = 0; x < bitmap.getWidth(); x++) {
            if (!isMapContent(bitmap, x, y, lockscreen, density)) continue;
            int color = bitmap.getPixel(x, y);
            int r = (color >>> 16) & 255, g = (color >>> 8) & 255, b = color & 255;
            if (r > 30 && r < 150 && g > 95 && b > 170 && b > g * 1.25 && r < g * .75) count++;
        }
        return count;
    }

    private static int countYellowPixels(Bitmap bitmap, boolean lockscreen, float density) {
        int count = 0;
        for (int y = 0; y < bitmap.getHeight(); y++) for (int x = 0; x < bitmap.getWidth(); x++) {
            if (!isMapContent(bitmap, x, y, lockscreen, density)) continue;
            int color = bitmap.getPixel(x, y);
            int r = (color >>> 16) & 255, g = (color >>> 8) & 255, b = color & 255;
            if (r > 190 && g > 135 && b < 130 && r > g * .95) count++;
        }
        return count;
    }

    private static int countCenterArrow(Bitmap bitmap, boolean lockscreen, float density) {
        int cx = bitmap.getWidth() / 2;
        int cy = mapContentCenterY(bitmap, lockscreen, density);
        int radius = Math.max(12, Math.min(bitmap.getWidth(), bitmap.getHeight()) / 12);
        int count = 0;
        for (int y = Math.max(0, cy - radius); y < Math.min(bitmap.getHeight(), cy + radius); y++) {
            for (int x = Math.max(0, cx - radius); x < Math.min(bitmap.getWidth(), cx + radius); x++) {
                if (!isMapContent(bitmap, x, y, lockscreen, density)) continue;
                int color = bitmap.getPixel(x, y);
                int r = (color >>> 16) & 255, g = (color >>> 8) & 255, b = color & 255;
                if (r > 90 && r < 205 && g > 190 && b > 205) count++;
            }
        }
        return count;
    }

    private static int countWaitingText(Bitmap bitmap, boolean lockscreen, float density) {
        int count = 0;
        int top = mapContentTop(bitmap, lockscreen, density);
        int height = bitmap.getHeight() - top;
        int y0 = top + (int) (height * .62f), y1 = top + (int) (height * .82f);
        for (int y = y0; y < y1; y++) for (int x = 0; x < bitmap.getWidth(); x++) {
            if (!isMapContent(bitmap, x, y, lockscreen, density)) continue;
            int color = bitmap.getPixel(x, y);
            int r = (color >>> 16) & 255, g = (color >>> 8) & 255, b = color & 255;
            if (r > 120 && g > 135 && b > 95 && g >= r && g > b) count++;
        }
        return count;
    }

    private static int mapContentTop(Bitmap bitmap, boolean lockscreen, float density) {
        // FloatingNavigationView places its toolbar above a 32dp map viewport; lockscreen mode has no toolbar.
        return lockscreen ? 0 : Math.min(bitmap.getHeight(), Math.round(32f * density));
    }

    private static int mapContentCenterY(Bitmap bitmap, boolean lockscreen, float density) {
        return (mapContentTop(bitmap, lockscreen, density) + bitmap.getHeight()) / 2;
    }

    private static boolean isMapContent(Bitmap bitmap, int x, int y, boolean lockscreen, float density) {
        if (y < mapContentTop(bitmap, lockscreen, density)) return false;
        // Exclude only the small 28x20dp resize-grip corner, preserving the rest of the map's full route area.
        int gripWidth = Math.round(28f * density), gripHeight = Math.round(20f * density);
        if (!lockscreen && x >= bitmap.getWidth() - gripWidth && y >= bitmap.getHeight() - gripHeight) return false;
        if (lockscreen) {
            // Ignore the centered attribution label, not a broad horizontal stripe of terrain.
            int baseline = Math.round(bitmap.getHeight() * .18f);
            int labelHalfWidth = Math.round(bitmap.getWidth() * .30f);
            int labelTop = baseline - Math.round(15f * density);
            int labelBottom = baseline + Math.round(3f * density);
            if (x >= bitmap.getWidth() / 2 - labelHalfWidth && x <= bitmap.getWidth() / 2 + labelHalfWidth &&
                y >= labelTop && y <= labelBottom) return false;
        }
        return true;
    }
}
