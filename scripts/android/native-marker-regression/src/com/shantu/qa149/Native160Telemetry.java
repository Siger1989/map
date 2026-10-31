package com.shantu.qa149;

import android.app.Instrumentation;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;

/** Fixed-action drawing telemetry; it never accepts caller-provided JavaScript. */
public final class Native160Telemetry {
    private static final String ASSET = "drawing-telemetry.js";
    private static final String GLOBAL = "__shantuNative160DrawingTelemetry";
    private final Instrumentation parent;
    private final Method evalJs;
    private boolean installed;

    public Native160Telemetry(Instrumentation parent) {
        if (parent == null) throw new IllegalArgumentException("parent instrumentation is required");
        this.parent = parent;
        try {
            evalJs = parent.getClass().getDeclaredMethod("evalJs", String.class);
            evalJs.setAccessible(true);
        } catch (ReflectiveOperationException error) {
            throw new IllegalStateException("parent instrumentation evalJs entry is unavailable", error);
        }
    }

    /** Only these fixed interactive actions are accepted. */
    public synchronized JSONObject action(String action) {
        if ("telemetry-start".equals(action)) return run("start");
        if ("telemetry-stop".equals(action)) return run("stop");
        if ("telemetry-snapshot".equals(action)) return run("snapshot");
        throw new IllegalArgumentException("unsupported drawing telemetry action");
    }

    private JSONObject run(String method) {
        try {
            installIfNeeded();
            String result = invoke("(()=>window." + GLOBAL + "." + method + "())()");
            return new JSONObject(result);
        } catch (Exception error) {
            throw new IllegalStateException("drawing telemetry action failed", error);
        }
    }

    private void installIfNeeded() throws Exception {
        if (installed) return;
        String source = readTrustedAsset();
        invoke("(()=>{" + source + ";return 'telemetry-installed'})()");
        String ready = invoke("(()=>window." + GLOBAL + " ? 'ready' : '')()");
        if (!"ready".equals(ready)) throw new IllegalStateException("drawing telemetry asset did not install");
        installed = true;
    }

    private String readTrustedAsset() throws Exception {
        try (InputStream input = parent.getContext().getAssets().open(ASSET);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            return new String(output.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    private String invoke(String fixedScript) throws Exception {
        Object result = evalJs.invoke(parent, fixedScript);
        return result == null ? "" : String.valueOf(result);
    }
}
