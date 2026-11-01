package com.shantu.qa149;

import org.json.JSONArray;
import org.json.JSONObject;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

/** Read-only, privacy-filtered drawing targets from the native cached road snapshot. */
public final class Native160DrawingProbe {
    private static final int MAX_LINES = 256;
    private static final int MAX_SAMPLES_PER_LINE = 40;
    private static final double MIN_ENDPOINT_DISTANCE_CSS = 20.0;
    private static final double MIN_BEND_DISTANCE_CSS = 4.0;

    private Native160DrawingProbe() { }

    /**
     * Reads the already-published real MVT snapshot and returns only map-local CSS
     * gesture targets. It never fetches tiles, writes app state, or exposes geo data.
     */
    public static JSONObject targets(Native149Instrumentation parent) {
        if (parent == null) return put(new JSONObject(), "status", "nomatch");
        AtomicReference<JSONObject> result = new AtomicReference<>();
        AtomicReference<String> failureType = new AtomicReference<>();
        try {
            parent.runOnMainSync(() -> {
                try { result.set(readTargets(parent)); }
                catch (Throwable error) { failureType.set(error.getClass().getSimpleName()); }
            });
        } catch (Throwable error) {
            failureType.set(error.getClass().getSimpleName());
        }
        if (failureType.get() != null)
            return put(put(new JSONObject(), "status", "error"), "probeErrorType", failureType.get());
        return result.get() == null ? put(new JSONObject(), "status", "nomatch") : result.get();
    }

    private static JSONObject readTargets(Native149Instrumentation parent) throws Exception {
        Object entry = field(parent, "entry");
        Object snapshotOwner = field(entry, "snapGeometry");
        Object payloadValue = field(snapshotOwner, "completedPayload");
        if (!(payloadValue instanceof JSONObject)) return noMatch("snapshot-unavailable");
        JSONObject payload = (JSONObject)payloadValue;
        JSONObject road = payload.optJSONObject("road");
        if (road == null || !"ready".equals(road.optString("status")))
            return noMatch("road-snapshot-not-ready");
        JSONArray lines = road.optJSONArray("lines");
        if (lines == null || lines.length() == 0) return noMatch("road-lines-empty");

        Object controller = field(entry, "controller");
        Method project = projectMethod(controller.getClass());
        JSONObject diagnostics = projectionDiagnostics(parent, entry, controller, project, lines);
        Method scaleMethod = parent.getClass().getDeclaredMethod("rendererCssScale");
        scaleMethod.setAccessible(true);
        Object scaleValue = scaleMethod.invoke(parent);
        if (!(scaleValue instanceof Number)) return noMatch("renderer-scale-unavailable");
        double cssScale = ((Number)scaleValue).doubleValue();
        if (!Double.isFinite(cssScale) || cssScale <= 0.0) return noMatch("renderer-scale-invalid");

        Candidate bestBent = null;
        Candidate bestFallback = null;
        double minX=Double.POSITIVE_INFINITY,minY=Double.POSITIVE_INFINITY,maxX=Double.NEGATIVE_INFINITY,maxY=Double.NEGATIVE_INFINITY;
        int checked = Math.min(lines.length(), MAX_LINES), projectedCount = 0, safeCount = 0;
        for (int sampleLine = 0; sampleLine < checked; sampleLine++) {
            int lineIndex = sampleLine * lines.length() / checked;
            JSONObject line = lines.optJSONObject(lineIndex);
            JSONArray coordinates = line == null ? null : line.optJSONArray("coordinates");
            if (coordinates == null || coordinates.length() < 3) continue;
            int sourceCount = coordinates.length();
            int stride = Math.max(1, (sourceCount - 1 + MAX_SAMPLES_PER_LINE - 2) /
                (MAX_SAMPLES_PER_LINE - 1));
            List<ProjectedPoint> sampled = new ArrayList<>();
            for (int index = 0; index < sourceCount; index += stride) {
                ProjectedPoint point = projectCoordinate(controller, project, coordinates.optJSONArray(index), index, cssScale);
                if (point != null) projectedCount++;
                if (point != null) { minX=Math.min(minX,point.x);minY=Math.min(minY,point.y);maxX=Math.max(maxX,point.x);maxY=Math.max(maxY,point.y); }
                if (insideSafeViewport(point)) safeCount++;
                sampled.add(point);
            }
            if ((sourceCount - 1) % stride != 0) {
                int lastIndex = sourceCount - 1;
                sampled.add(projectCoordinate(controller, project, coordinates.optJSONArray(lastIndex), lastIndex, cssScale));
            }
            if (sampled.size() < 3) continue;

            for (int startIndex = 0; startIndex < sampled.size() - 2; startIndex++) {
                for (int endIndex = startIndex + 2; endIndex < sampled.size(); endIndex++) {
                    int controlIndex = (startIndex + endIndex) / 2;
                    if (controlIndex == startIndex || controlIndex == endIndex) continue;
                    boolean safePath = true;
                    for (int k = startIndex; k <= endIndex; k++) {
                        if (!insideSafeViewport(sampled.get(k))) { safePath = false; break; }
                    }
                    if (!safePath) continue;
                    ProjectedPoint start = sampled.get(startIndex);
                    ProjectedPoint control = sampled.get(controlIndex);
                    ProjectedPoint end = sampled.get(endIndex);
                    double dx = end.x - start.x, dy = end.y - start.y;
                    double distance = Math.hypot(dx, dy);
                    if (distance <= MIN_ENDPOINT_DISTANCE_CSS) continue;
                    double bend = perpendicularDistance(control.x - start.x, control.y - start.y, dx, dy, distance);
                    Candidate candidate = new Candidate(start, control, end, sourceCount, bend, distance);
                    if (bend >= MIN_BEND_DISTANCE_CSS &&
                        (bestBent == null || candidate.score() > bestBent.score())) bestBent = candidate;
                    if (bestFallback == null || candidate.distance > bestFallback.distance) bestFallback = candidate;
                }
            }
        }

        Candidate chosen = bestBent != null ? bestBent : bestFallback;
        if (chosen == null) return noMatch("no-road-path-inside-safe-viewport").put("projectedSamples", projectedCount).put("safeSamples", safeCount)
            .put("cssScale",cssScale).put("projectedBoundsCss",projectedCount==0?JSONObject.NULL:new JSONArray().put(minX).put(minY).put(maxX).put(maxY)).put("projectionDiagnostics",diagnostics);
        return new JSONObject().put("status", "ready")
            .put("start", pointJson(chosen.start))
            .put("control", pointJson(chosen.control))
            .put("end", pointJson(chosen.end))
            .put("sourceVertexCount", chosen.sourceVertexCount);
    }

    private static JSONObject projectionDiagnostics(Native149Instrumentation parent,Object entry,Object controller,Method project,JSONArray lines) {
        JSONObject result=new JSONObject();
        try {
            Object maps=field(field(parent,"host"),"maps");
            result.put("isCurrentMainEntry",maps instanceof java.util.Map && ((java.util.Map<?,?>)maps).get("main")==entry);
            result.put("controllerDisposed",field(controller,"disposed"));
            android.view.View view=(android.view.View)field(controller,"worldWindow");
            result.put("viewSizePx",new JSONArray().put(view.getWidth()).put(view.getHeight()));
            result.put("viewport",field(entry,"viewport"));
            Method snapshot=controller.getClass().getDeclaredMethod("cameraSnapshot");snapshot.setAccessible(true);
            Object camera=snapshot.invoke(controller);
            double lat=((Number)field(camera,"latitude")).doubleValue(),lon=((Number)field(camera,"longitude")).doubleValue();
            Object center=project.invoke(controller,lat,lon);
            result.put("cameraCenterScreenPx",center==null?JSONObject.NULL:new JSONArray().put(pairValue(center,"getFirst","first")).put(pairValue(center,"getSecond","second")));
            double west=Double.POSITIVE_INFINITY,east=Double.NEGATIVE_INFINITY,south=Double.POSITIVE_INFINITY,north=Double.NEGATIVE_INFINITY;
            int count=0;
            for(int i=0;i<lines.length();i++) {
                JSONArray coords=lines.getJSONObject(i).optJSONArray("coordinates");if(coords==null)continue;
                for(int j=0;j<coords.length();j++){JSONArray p=coords.optJSONArray(j);if(p==null)continue;double x=p.optDouble(0,Double.NaN)-lon,y=p.optDouble(1,Double.NaN)-lat;if(!Double.isFinite(x)||!Double.isFinite(y))continue;west=Math.min(west,x);east=Math.max(east,x);south=Math.min(south,y);north=Math.max(north,y);count++;}
            }
            result.put("roadCoordinateCount",count);
            result.put("roadBoundsRelativeToCameraDegrees",count==0?JSONObject.NULL:new JSONArray().put(west).put(south).put(east).put(north));
        } catch(Throwable error){try{result.put("errorType",error.getClass().getSimpleName());}catch(Throwable ignored){}}
        return result;
    }

    private static ProjectedPoint projectCoordinate(Object controller, Method project, JSONArray coordinate, int index, double cssScale) {
        if (coordinate == null || coordinate.length() < 2) return null;
        double longitude = coordinate.optDouble(0, Double.NaN);
        double latitude = coordinate.optDouble(1, Double.NaN);
        if (!Double.isFinite(latitude) || !Double.isFinite(longitude)) return null;
        try {
            Object projected = project.invoke(controller, latitude, longitude);
            if (projected == null) return null;
            Object xValue = pairValue(projected, "getFirst", "first");
            Object yValue = pairValue(projected, "getSecond", "second");
            if (!(xValue instanceof Number) || !(yValue instanceof Number)) return null;
            double x = ((Number)xValue).doubleValue() / cssScale;
            double y = ((Number)yValue).doubleValue() / cssScale;
            return Double.isFinite(x) && Double.isFinite(y) ? new ProjectedPoint(x, y, index) : null;
        } catch (Throwable ignored) {
            return null;
        }
    }

    private static Object pairValue(Object pair, String getter, String name) throws Exception {
        try { return pair.getClass().getMethod(getter).invoke(pair); }
        catch (ReflectiveOperationException error) { return field(pair, name); }
    }

    private static Method projectMethod(Class<?> controllerClass) throws NoSuchMethodException {
        for (Class<?> type = controllerClass; type != null; type = type.getSuperclass()) {
            for (Method method : type.getDeclaredMethods()) {
                Class<?>[] parameters = method.getParameterTypes();
                if (!method.getName().startsWith("projectCoordinate") || parameters.length != 2) continue;
                if ((parameters[0] == double.class || parameters[0] == Double.class) &&
                    (parameters[1] == double.class || parameters[1] == Double.class)) {
                    method.setAccessible(true);
                    return method;
                }
            }
        }
        throw new NoSuchMethodException("projectCoordinate(double,double)");
    }

    private static boolean insideSafeViewport(ProjectedPoint point) {
        return point != null && point.x >= 60.0 && point.x <= 280.0 && point.y >= 180.0 && point.y <= 520.0;
    }

    private static double perpendicularDistance(double px, double py, double dx, double dy, double length) {
        return Math.abs(px * dy - py * dx) / length;
    }

    private static JSONObject pointJson(ProjectedPoint point) {
        return put(put(new JSONObject(), "x", point.x), "y", point.y);
    }

    private static JSONObject noMatch(String reason) {
        return put(put(new JSONObject(), "status", "nomatch"), "reason", reason);
    }

    private static JSONObject put(JSONObject object, String key, Object value) {
        try { object.put(key, value); } catch (Throwable ignored) { }
        return object;
    }

    private static Object field(Object owner, String name) throws Exception {
        if (owner == null) throw new NullPointerException("owner");
        for (Class<?> type = owner.getClass(); type != null; type = type.getSuperclass()) {
            try {
                Field field = type.getDeclaredField(name);
                field.setAccessible(true);
                return field.get(owner);
            } catch (NoSuchFieldException ignored) { }
        }
        throw new NoSuchFieldException(name);
    }

    private static final class ProjectedPoint {
        final double x, y;
        final int sourceIndex;
        ProjectedPoint(double x, double y, int sourceIndex) {
            this.x = x; this.y = y; this.sourceIndex = sourceIndex;
        }
    }

    private static final class Candidate {
        final ProjectedPoint start, control, end;
        final int sourceVertexCount;
        final double bend, distance;
        Candidate(ProjectedPoint start, ProjectedPoint control, ProjectedPoint end,
                  int sourceVertexCount, double bend, double distance) {
            this.start = start; this.control = control; this.end = end;
            this.sourceVertexCount = sourceVertexCount; this.bend = bend; this.distance = distance;
        }
        double score() { return bend * 2.0 + Math.min(distance, 160.0) * 0.25; }
    }
}
