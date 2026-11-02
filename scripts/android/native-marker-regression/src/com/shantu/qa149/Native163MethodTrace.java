package com.shantu.qa149;

import android.content.Context;
import android.os.Debug;
import android.os.Environment;
import android.os.SystemClock;
import org.json.JSONObject;
import java.io.File;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/** Explicit, bounded ART sampling for attribution only; not a speed benchmark. */
final class Native163MethodTrace implements AutoCloseable {
    private final Context context;
    private final ScheduledExecutorService timer = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "qa-method-trace-timeout"); t.setDaemon(true); return t;
    });
    private ScheduledFuture<?> timeout;
    private File file;
    private boolean running;
    private long startedAt;
    private long stoppedAt;
    Native163MethodTrace(Context context) { this.context = context; }

    synchronized JSONObject start(int intervalUs) throws Exception {
        if (running) throw new IllegalStateException("QA method trace already active");
        if (intervalUs < 5000 || intervalUs > 100000) throw new IllegalArgumentException("sampling interval out of range");
        File dir = new File(context.getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS), "native163-method-trace");
        if (!dir.mkdirs() && !dir.isDirectory()) throw new IllegalStateException("private trace directory unavailable");
        if (dir.getUsableSpace() < 64L * 1024 * 1024) throw new IllegalStateException("insufficient private trace space");
        file = new File(dir, UUID.randomUUID().toString() + ".trace");
        Debug.startMethodTracingSampling(file.getAbsolutePath(), 16 * 1024 * 1024, intervalUs);
        startedAt = SystemClock.elapsedRealtime(); stoppedAt = 0; running = true;
        timeout = timer.schedule(() -> { try { stop(); } catch (Exception ignored) {} }, 30, TimeUnit.SECONDS);
        return snapshot().put("samplingIntervalUs", intervalUs).put("maximumDurationMs", 30000);
    }

    synchronized JSONObject stop() throws Exception {
        if (running) {
            try { Debug.stopMethodTracing(); }
            finally { running = false; stoppedAt = SystemClock.elapsedRealtime(); }
        }
        if (timeout != null) { timeout.cancel(false); timeout = null; }
        return snapshot();
    }

    private JSONObject snapshot() throws Exception {
        return new JSONObject().put("running", running).put("file", file == null ? JSONObject.NULL : file.getAbsolutePath())
            .put("bytes", file == null ? 0 : file.length())
            .put("elapsedMs", startedAt == 0 ? 0 : (running ? SystemClock.elapsedRealtime() : stoppedAt) - startedAt)
            .put("performanceMeasurement", false).put("samplingPerturbsRuntime", true);
    }

    public synchronized void close() {
        try { stop(); } catch (Exception ignored) {} finally { timer.shutdownNow(); }
    }
}
