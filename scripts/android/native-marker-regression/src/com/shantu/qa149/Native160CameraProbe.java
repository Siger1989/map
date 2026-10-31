package com.shantu.qa149;

import org.json.JSONObject;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.concurrent.atomic.AtomicReference;

/** Read-only WorldWind camera/terrain probe for the isolated 160 QA helper. */
public final class Native160CameraProbe {
    private Native160CameraProbe() { }

    /**
     * Samples the current camera and terrain state on the instrumentation main thread.
     * The report intentionally excludes all geographic coordinates and error messages.
     */
    public static JSONObject snapshot(Native149Instrumentation parent) {
        JSONObject report = new JSONObject();
        if (parent == null) return put(report, "probeErrorType", "NullInstrumentation");
        AtomicReference<JSONObject> result = new AtomicReference<>(report);
        AtomicReference<Throwable> failure = new AtomicReference<>();
        try {
            parent.runOnMainSync(() -> {
                try { result.set(readSnapshot(parent)); }
                catch (Throwable error) { failure.set(error); }
            });
        } catch (Throwable error) {
            failure.set(error);
        }
        if (failure.get() != null) put(report, "probeErrorType", failure.get().getClass().getName());
        return result.get();
    }

    private static JSONObject readSnapshot(Native149Instrumentation parent) {
        JSONObject out = new JSONObject();
        String stage = "entry";
        try {
            Object entry = readField(parent, "entry");
            stage = "controller";
            Object controller = readField(entry, "controller");
            stage = "worldWindow";
            Object worldWindow = findTypedField(controller, "earth.worldwind.WorldWindow");
            stage = "engine";
            Object engine = invokeGetter(worldWindow, "getEngine");
            stage = "camera";
            Object camera = invokeGetter(engine, "getCamera");
            stage = "position";
            Object position = invokeGetter(camera, "getPosition");
            stage = "globe";
            Object globe = invokeGetter(engine, "getGlobe");
            stage = "elevationModel";
            Object elevationModel = invokeGetter(globe, "getElevationModel");

            stage = "positionAngles";
            double eyeLatitudeDegrees = readAngleDegrees(position, "getLatitude");
            double eyeLongitudeDegrees = readAngleDegrees(position, "getLongitude");
            double eyeAltitude = readNumber(position, "getAltitude");
            stage = "cameraAngles";
            JSONObject cameraReport = new JSONObject();
            put(cameraReport, "eyeAltitudeMeters", eyeAltitude);
            put(out, "camera", cameraReport);
            for (String angle : new String[]{"Heading", "Tilt", "Roll"}) {
                try { put(cameraReport, angle.toLowerCase() + "Degrees", readAngleDegrees(camera, "get" + angle)); }
                catch (Exception unavailable) { put(cameraReport, angle.toLowerCase() + "ProbeUnavailable", true); }
            }
            Object mode = invokeOptionalGetter(camera, "getAltitudeMode");
            put(cameraReport, "altitudeMode", mode == null ? JSONObject.NULL : String.valueOf(mode));

            stage = "terrainState";
            Object terrainValue = readField(controller, "terrainEnabled");
            Object bridgeAnchorElevation = readField(controller, "bridgeAnchorElevation");
            Object bridgeAnchorExaggeration = readField(controller, "bridgeAnchorExaggeration");
            double verticalExaggeration = readNumber(globe, "getVerticalExaggeration");
            JSONObject state = new JSONObject();
            put(state, "terrainEnabled", terrainValue instanceof Boolean ? terrainValue : JSONObject.NULL);
            put(state, "verticalExaggeration", verticalExaggeration);
            put(state, "bridgeAnchorElevationMeters", numericOrNull(bridgeAnchorElevation));
            put(state, "bridgeAnchorExaggeration", numericOrNull(bridgeAnchorExaggeration));
            put(state, "elevationModelTimestamp", readLong(elevationModel, "getTimestamp"));
            Object globeState = invokeOptionalGetter(globe, "getState");
            put(state, "globeStateHashCode", globeState == null ? JSONObject.NULL : globeState.hashCode());
            put(out, "terrain", state);

            stage = "eyeElevation";
            JSONObject elevations = new JSONObject();
            ElevationSample eyeSample = invokeCachedElevation(controller, eyeLatitudeDegrees, eyeLongitudeDegrees);
            put(elevations, "eyeTerrainMeters", numericOrNull(eyeSample.value));
            if (eyeSample.errorType != null) put(elevations, "eyeElevationProbeErrorType", eyeSample.errorType);
            if (eyeSample.value instanceof Number) {
                put(elevations, "eyeAboveTerrainMeters", eyeAltitude - ((Number)eyeSample.value).doubleValue());
            }
            Object anchor = readField(controller, "bridgeGroundAnchor");
            stage = "anchorElevation";
            Object anchorLatitude = invokeOptionalGetter(anchor, "getLatitude");
            Object anchorLongitude = invokeOptionalGetter(anchor, "getLongitude");
            if (anchorLatitude instanceof Number && anchorLongitude instanceof Number) {
                ElevationSample anchorSample = invokeCachedElevation(controller,
                    ((Number)anchorLatitude).doubleValue(), ((Number)anchorLongitude).doubleValue());
                put(elevations, "anchorTerrainSampleMeters", numericOrNull(anchorSample.value));
                if (anchorSample.errorType != null) put(elevations, "anchorElevationProbeErrorType", anchorSample.errorType);
            }
            put(out, "elevations", elevations);
            put(out, "available", true);
        } catch (Throwable error) {
            put(out, "available", false);
            put(out, "probeErrorType", error.getClass().getName());
            put(out, "probeStage", stage);
        }
        return out;
    }

    private static ElevationSample invokeCachedElevation(Object controller, double latitude, double longitude) {
        try {
            Method method = findMethod(controller.getClass(), "getElevation", double.class, double.class, boolean.class);
            method.setAccessible(true);
            return new ElevationSample(method.invoke(controller, latitude, longitude, false), null);
        } catch (Throwable error) {
            return new ElevationSample(null, error.getClass().getName());
        }
    }

    private static final class ElevationSample {
        final Object value;
        final String errorType;
        ElevationSample(Object value, String errorType) { this.value = value; this.errorType = errorType; }
    }

    private static Object findTypedField(Object owner, String typeName) throws Exception {
        for (Class<?> type = owner.getClass(); type != null; type = type.getSuperclass()) {
            for (Field field : type.getDeclaredFields()) {
                if (!typeName.equals(field.getType().getName())) continue;
                field.setAccessible(true);
                return field.get(owner);
            }
        }
        throw new NoSuchFieldException("WorldWindow field unavailable");
    }

    private static Object readField(Object owner, String name) throws Exception {
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

    private static Object invokeGetter(Object owner, String prefix) throws Exception {
        Object value = invokeOptionalGetter(owner, prefix);
        if (value == null) throw new NoSuchMethodException(prefix);
        return value;
    }

    private static Object invokeOptionalGetter(Object owner, String prefix) {
        if (owner == null) return null;
        for (Class<?> type = owner.getClass(); type != null; type = type.getSuperclass()) {
            for (Method method : type.getDeclaredMethods()) {
                if (!method.getName().startsWith(prefix) || method.getParameterTypes().length != 0) continue;
                try {
                    method.setAccessible(true);
                    return method.invoke(owner);
                } catch (Throwable ignored) { }
            }
        }
        String fieldName = getterFieldName(prefix);
        if (fieldName == null) return null;
        try { return readField(owner, fieldName); }
        catch (Throwable ignored) { return null; }
    }

    private static String getterFieldName(String getterPrefix) {
        if (getterPrefix == null || !getterPrefix.startsWith("get") || getterPrefix.length() <= 3) return null;
        String property = getterPrefix.substring(3);
        return Character.toLowerCase(property.charAt(0)) + property.substring(1);
    }

    private static Method findMethod(Class<?> type, String name, Class<?>... parameters) throws NoSuchMethodException {
        for (Class<?> current = type; current != null; current = current.getSuperclass()) {
            try { return current.getDeclaredMethod(name, parameters); }
            catch (NoSuchMethodException ignored) { }
        }
        throw new NoSuchMethodException(name);
    }

    private static double readNumber(Object owner, String getter) throws Exception {
        Object value = invokeGetter(owner, getter);
        if (!(value instanceof Number)) throw new IllegalStateException("non-numeric getter");
        return ((Number)value).doubleValue();
    }

    private static double readAngleDegrees(Object owner, String getterPrefix) throws Exception {
        Object value = invokeGetter(owner, getterPrefix);
        // WorldWind 2.1.1 Angle is a Kotlin inline value stored as degrees.
        // fromRadians converts to this representation; the raw getter is not radians.
        if (value instanceof Number) return ((Number)value).doubleValue();
        Object degrees = invokeGetter(value, "getInDegrees");
        if (!(degrees instanceof Number)) throw new IllegalStateException("non-numeric angle");
        return ((Number)degrees).doubleValue();
    }

    private static long readLong(Object owner, String getterPrefix) {
        Object value = invokeOptionalGetter(owner, getterPrefix);
        return value instanceof Number ? ((Number)value).longValue() : -1L;
    }

    private static Object numericOrNull(Object value) {
        return value instanceof Number ? ((Number)value).doubleValue() : JSONObject.NULL;
    }

    private static JSONObject put(JSONObject object, String key, Object value) {
        try { object.put(key, value); } catch (Throwable ignored) { }
        return object;
    }
}
