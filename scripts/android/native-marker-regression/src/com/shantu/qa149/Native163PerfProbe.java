package com.shantu.qa149;

import android.app.Instrumentation;
import android.app.Activity;
import android.os.Debug;
import android.os.Environment;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.os.Process;
import android.os.SystemClock;
import android.view.FrameMetrics;
import android.view.Window;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedWriter;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.lang.reflect.Field;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Bounded, URL-free performance sampler for the installed native-map QA build.
 * It observes the host and native caches only; it does not trigger map redraws.
 */
public final class Native163PerfProbe {
    private static final long SAMPLE_PERIOD_MS = 500L;
    private static final long MAX_DURATION_MS = 15L * 60L * 1000L;
    private static final int MAX_SAMPLES = 1800;
    private static final int MAX_MARKS = 128;
    private static final Object LOCK = new Object();
    private static Probe current;
    private final Native149Instrumentation parent;
    private final Object host;
    private final Window window;

    public Native163PerfProbe(Native149Instrumentation parent) {
        if (parent == null) throw new IllegalArgumentException("parent instrumentation is required");
        this.parent = parent;
        try {
            this.host = fieldValue(parent, "host");
            Activity activity = (Activity) fieldValue(parent, "activity");
            this.window = activity == null ? null : activity.getWindow();
        } catch (Exception failure) {
            throw new IllegalStateException("native host/window reflection unavailable", failure);
        }
    }

    /** Fixed action entry for the loopback QA bridge; it does not accept arbitrary code or paths. */
    public JSONObject action(String action, JSONObject request) {
        if ("perf-start".equals(action)) return start(parent, host, window);
        if ("perf-mark".equals(action)) return mark(request == null ? null : request.optString("label", null));
        if ("perf-snapshot".equals(action)) return snapshot();
        if ("perf-stop".equals(action)) return stop();
        return error("unsupported_perf_action");
    }

    /** Starts one sampler. A repeated start returns the existing run summary. */
    public static JSONObject start(Instrumentation parent, Object host, Window window) {
        if (parent == null || host == null) return error("parent_and_host_required");
        synchronized (LOCK) {
            if (current != null && current.isRunning()) {
                try { return current.summary(); }
                catch (Throwable failure) { return error("snapshot_failed:" + failure.getClass().getSimpleName()); }
            }
            try {
                current = new Probe(parent, host, window);
                current.start();
                return current.summary();
            } catch (Exception failure) {
                current = null;
                return error("start_failed:" + failure.getClass().getSimpleName());
            }
        }
    }

    /** Adds a short, non-sensitive timeline marker. Free-form text and coordinates are rejected. */
    public static JSONObject mark(String label) {
        synchronized (LOCK) {
            try { return current == null ? error("not_started") : current.mark(label); }
            catch (Throwable failure) { return error("mark_failed:" + failure.getClass().getSimpleName()); }
        }
    }

    /** Returns the latest sample plus run counters; it never serializes map state or coordinates. */
    public static JSONObject snapshot() {
        synchronized (LOCK) {
            try { return current == null ? error("not_started") : current.snapshot(); }
            catch (Throwable failure) { return error("snapshot_failed:" + failure.getClass().getSimpleName()); }
        }
    }

    /** Stops sampling and returns the bounded JSONL path and aggregate summary. */
    public static JSONObject stop() {
        synchronized (LOCK) {
            if (current == null) return error("not_started");
            Probe old = current;
            current = null;
            try { return old.stop(); }
            catch (Throwable failure) { return error("stop_failed:" + failure.getClass().getSimpleName()); }
        }
    }

    private static JSONObject error(String reason) {
        JSONObject out = new JSONObject();
        try { out.put("available", false).put("reason", reason); }
        catch (Exception ignored) { }
        return out;
    }

    private static final class Probe {
        private final Instrumentation instrumentation;
        private final Object host;
        private final Window window;
        private final Handler main = new Handler(Looper.getMainLooper());
        private final AtomicBoolean mapSnapshotPending = new AtomicBoolean();
        private HandlerThread frameThread;
        private Handler frameHandler;
        private final ScheduledExecutorService sampler = Executors.newSingleThreadScheduledExecutor(runnable -> {
            Thread thread = new Thread(runnable, "shantu-native163-perf");
            thread.setDaemon(true);
            return thread;
        });
        private final FrameSummary frameSummary = new FrameSummary();
        private final IdentityHashMap<Object, NativeFrameMetricsTap> frameMetricsTaps = new IdentityHashMap<>();
        private final long startedWall = SystemClock.elapsedRealtime();
        private final long startedCpu = Process.getElapsedCpuTime();
        private final File outputFile;
        private final Object writerLock = new Object();
        private final AtomicReference<JSONObject> latest = new AtomicReference<>();
        private volatile BufferedWriter writer;
        private volatile boolean running = true;
        private volatile String stopReason = "requested";
        private volatile int sampleCount;
        private volatile int markCount;
        private int slowStackSamples;
        private long previousSampleWall = startedWall;
        private long previousSampleCpu = startedCpu;
        private Window.OnFrameMetricsAvailableListener frameListener;

        Probe(Instrumentation instrumentation, Object host, Window window) throws Exception {
            this.instrumentation = instrumentation;
            this.host = host;
            this.window = window;
            File external = instrumentation.getTargetContext().getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS);
            if (external == null) throw new IllegalStateException("app_external_files_unavailable");
            File directory = new File(external, "native163-perf");
            if (!directory.mkdirs() && !directory.isDirectory()) throw new IllegalStateException("output_directory_unavailable");
            String runId = Long.toString(System.currentTimeMillis()) + "-" + UUID.randomUUID().toString().substring(0, 8);
            outputFile = new File(directory, "native163-perf-" + runId + ".jsonl");
            writer = new BufferedWriter(new OutputStreamWriter(new FileOutputStream(outputFile, false), StandardCharsets.UTF_8));
        }

        void start() throws Exception {
            installFrameMetrics();
            // Optimized release merges the SDK frame hook type; collect actual frame counts
            // and Window/HWUI metrics without attempting to mutate its private hook.
            append(record("start").put("periodMs", SAMPLE_PERIOD_MS).put("maximumDurationMs", MAX_DURATION_MS)
                .put("frameMetrics", frameSummary.descriptor()));
            sampler.scheduleWithFixedDelay(this::sampleSafely, 0L, SAMPLE_PERIOD_MS, TimeUnit.MILLISECONDS);
        }

        boolean isRunning() { return running; }

        JSONObject mark(String label) throws Exception {
            if (!running) return error("stopped");
            if (label == null || !label.matches("[A-Za-z0-9_.-]{1,32}")) return error("invalid_mark_label");
            synchronized (writerLock) {
                if (markCount >= MAX_MARKS) return error("mark_limit_reached");
                markCount++;
            }
            JSONObject event = record("mark").put("mark", label);
            append(event);
            return new JSONObject().put("available", true).put("markCount", markCount).put("elapsedMs", elapsed());
        }

        JSONObject snapshot() throws Exception {
            JSONObject out = summary();
            JSONObject sample = latest.get();
            if (sample != null) out.put("latest", new JSONObject(sample.toString()));
            out.put("frameMetrics", frameSummary.snapshot());
            return out;
        }

        JSONObject summary() throws Exception {
            return new JSONObject().put("available", true).put("running", running)
                .put("sampleCount", sampleCount).put("maximumSamples", MAX_SAMPLES)
                .put("elapsedMs", elapsed()).put("maximumDurationMs", MAX_DURATION_MS)
                .put("file", outputFile.getAbsolutePath());
        }

        JSONObject stop() throws Exception {
            if (running) {
                stopReason = "requested";
                running = false;
                sampler.shutdownNow();
                uninstallFrameMetrics();
                restoreNativeFrameMetrics();
                append(record("stop").put("reason", stopReason));
                closeWriter();
            }
            return summary().put("frameMetrics", frameSummary.snapshot());
        }

        private void installFrameMetrics() {
            if (window == null) {
                frameSummary.unavailable("window_not_supplied");
                return;
            }
            if (android.os.Build.VERSION.SDK_INT < 24) {
                frameSummary.unavailable("api_below_24");
                return;
            }
            frameListener = (target, metrics, dropCount) -> frameSummary.record(metrics, dropCount);
            main.post(() -> {
                if (!running) return;
                try {
                    frameThread = new HandlerThread("shantu-native163-frame-metrics");
                    frameThread.start();
                    frameHandler = new Handler(frameThread.getLooper());
                    window.addOnFrameMetricsAvailableListener(frameListener, frameHandler);
                    frameSummary.available();
                } catch (Throwable failure) {
                    frameSummary.unavailable("register_failed:" + failure.getClass().getSimpleName());
                }
            });
        }

        private void uninstallFrameMetrics() {
            Window.OnFrameMetricsAvailableListener listener = frameListener;
            if (listener == null || window == null || android.os.Build.VERSION.SDK_INT < 24) return;
            main.post(() -> {
                try { window.removeOnFrameMetricsAvailableListener(listener); }
                catch (Throwable failure) { frameSummary.unavailable("remove_failed:" + failure.getClass().getSimpleName()); }
                HandlerThread thread = frameThread;
                frameThread = null;
                frameHandler = null;
                if (thread != null) thread.quitSafely();
            });
        }

        private void sampleSafely() {
            if (!running) return;
            long now = SystemClock.elapsedRealtime();
            if (now - startedWall >= MAX_DURATION_MS || sampleCount >= MAX_SAMPLES) {
                stopReason = "duration_or_sample_limit";
                running = false;
                sampler.shutdown();
                uninstallFrameMetrics();
                restoreNativeFrameMetrics();
                try { append(record("stop").put("reason", stopReason)); }
                catch (Throwable ignored) { }
                closeWriter();
                return;
            }
            try {
                JSONObject sample = collectSample(now);
                latest.set(sample);
                append(sample);
                sampleCount++;
            } catch (Throwable failure) {
                try { append(record("sample_error").put("errorType", failure.getClass().getSimpleName())); }
                catch (Throwable ignored) { }
            }
        }

        private JSONObject collectSample(long now) throws Exception {
            Runtime runtime = Runtime.getRuntime();
            long cpu = Process.getElapsedCpuTime();
            long wallDelta = Math.max(1L, now - previousSampleWall);
            long cpuDelta = Math.max(0L, cpu - previousSampleCpu);
            previousSampleWall = now;
            previousSampleCpu = cpu;
            Long gcCountBefore = runtimeStatLong("art.gc.gc-count");
            long committedBefore = runtime.totalMemory();
            long heapFree = runtime.freeMemory();
            long committedAfter = runtime.totalMemory();
            long heapMax = runtime.maxMemory();
            Long gcCountAfter = runtimeStatLong("art.gc.gc-count");
            long usedHeap = committedAfter - heapFree;
            boolean gcCountObservedStable = gcCountBefore != null && gcCountAfter != null && gcCountBefore.equals(gcCountAfter);
            boolean heapConsistent = committedBefore == committedAfter && gcCountObservedStable && usedHeap >= 0 && usedHeap <= heapMax;

            JSONObject memory = memorySnapshot();
            JSONObject maps = snapshotMapsOnMain();
            if (!maps.optBoolean("available") && slowStackSamples++ < 20) {
                JSONArray stacks = new JSONArray();
                for (Map.Entry<Thread, StackTraceElement[]> st : Thread.getAllStackTraces().entrySet()) {
                    String name = st.getKey().getName();
                    if (!name.equals("main") && !name.startsWith("GLThread")) continue;
                    JSONArray frames = new JSONArray();
                    for (StackTraceElement f : st.getValue()) {
                        if (frames.length() >= 60) break;
                        frames.put(new JSONObject().put("class", f.getClassName()).put("method", f.getMethodName()).put("line", f.getLineNumber()));
                    }
                    stacks.put(new JSONObject().put("thread", name).put("state", st.getKey().getState().name()).put("frames", frames));
                }
                append(record("slow_main_stacks").put("threads", stacks));
            }
            JSONObject cpuJson = new JSONObject().put("processCpuDeltaMs", cpuDelta)
                .put("wallDeltaMs", wallDelta).put("processCpuPercentOfOneCore", 100.0 * cpuDelta / wallDelta);
            JSONObject heap = new JSONObject().put("javaUsedBytes", usedHeap).put("javaSnapshotConsistent", heapConsistent)
                .put("javaCommittedBytes", committedAfter).put("javaCommittedBeforeBytes", committedBefore).put("javaFreeBytes", heapFree).put("javaMaxBytes", heapMax)
                .put("javaGcCountBefore", gcCountBefore == null ? JSONObject.NULL : gcCountBefore)
                .put("javaGcCountAfter", gcCountAfter == null ? JSONObject.NULL : gcCountAfter)
                .put("javaGcCountObservedStable", gcCountObservedStable)
                .put("javaConsistencyRule", "committed_match_and_gc_count_unchanged; runtime counters remain approximate")
                .put("nativeHeapAllocatedBytes", Debug.getNativeHeapAllocatedSize())
                .put("nativeHeapSizeBytes", Debug.getNativeHeapSize())
                .put("nativeHeapFreeBytes", Debug.getNativeHeapFreeSize());
            return record("sample").put("memory", memory).put("heap", heap).put("processCpu", cpuJson)
                .put("maps", maps.getJSONArray("maps")).put("mapSnapshotAvailable", maps.optBoolean("available"))
                .put("mapSnapshotReason", maps.optString("reason", "")).put("mainDispatchDelayMs", maps.optLong("mainDispatchDelayMs", -1))
                .put("renderCache", maps.optJSONObject("renderCache") == null ? JSONObject.NULL : maps.optJSONObject("renderCache"))
                .put("frameMetrics", frameSummary.snapshot());
        }

        /** ART runtime counters bracket the heap read to flag collections that overlap it. */
        private Long runtimeStatLong(String name) {
            try {
                String value = Debug.getRuntimeStat(name);
                return value == null ? null : Long.parseLong(value);
            } catch (Throwable ignored) {
                return null;
            }
        }

        private JSONObject memorySnapshot() {
            JSONObject out = new JSONObject();
            try {
                Debug.MemoryInfo info = new Debug.MemoryInfo();
                Debug.getMemoryInfo(info);
                out.put("pssKiB", reported(info.getTotalPss()));
                putMemoryStat(out, info, "javaHeapKiB", "summary.java-heap");
                putMemoryStat(out, info, "nativeHeapKiB", "summary.native-heap");
                putMemoryStat(out, info, "graphicsKiB", "summary.graphics");
            } catch (Throwable failure) {
                putJson(out, "pssKiB", unavailable("memory_info_failed:" + failure.getClass().getSimpleName()));
                putJson(out, "javaHeapKiB", unavailable("memory_info_failed"));
                putJson(out, "nativeHeapKiB", unavailable("memory_info_failed"));
                putJson(out, "graphicsKiB", unavailable("memory_info_failed"));
            }
            return out;
        }

        private void putMemoryStat(JSONObject out, Debug.MemoryInfo info, String key, String stat) throws Exception {
            try {
                String raw = info.getMemoryStat(stat);
                long value = raw == null ? -1L : Long.parseLong(raw);
                out.put(key, value < 0L ? unavailable("not_reported") : reported(value));
            } catch (Throwable failure) {
                out.put(key, unavailable("not_reported"));
            }
        }

        private JSONObject snapshotMapsOnMain() throws Exception {
            if (!mapSnapshotPending.compareAndSet(false, true)) return new JSONObject().put("available", false).put("reason", "main_snapshot_still_pending").put("maps", new JSONArray());
            long requestedAt = SystemClock.elapsedRealtime();
            CountDownLatch latch = new CountDownLatch(1);
            AtomicReference<JSONObject> result = new AtomicReference<>();
            main.post(() -> {
                try { result.set(readMaps().put("mainDispatchDelayMs", SystemClock.elapsedRealtime() - requestedAt)); }
                catch (Throwable failure) {
                    JSONObject unavailable = new JSONObject();
                    putJson(unavailable, "available", false);
                    putJson(unavailable, "reason", failure.getClass().getSimpleName());
                    putJson(unavailable, "maps", new JSONArray());
                    result.set(unavailable);
                } finally { mapSnapshotPending.set(false); latch.countDown(); }
            });
            if (!latch.await(400L, TimeUnit.MILLISECONDS)) {
                return new JSONObject().put("available", false).put("reason", "main_snapshot_timeout")
                    .put("maps", new JSONArray());
            }
            JSONObject value = result.get();
            return value == null ? new JSONObject().put("available", false).put("reason", "empty_snapshot")
                .put("maps", new JSONArray()) : value;
        }

        private JSONObject readMaps() throws Exception {
            Object mapObject = fieldValue(host, "maps");
            if (!(mapObject instanceof Map)) return new JSONObject().put("available", false)
                .put("reason", "host_maps_unavailable").put("maps", new JSONArray());
            List<Object> entries = new ArrayList<>(((Map<?, ?>) mapObject).values());
            JSONArray rows = new JSONArray();
            IdentityHashMap<Object, Integer> seen = new IdentityHashMap<>();
            long capacity = 0L, used = 0L;
            int uniqueCaches = 0;
            for (int i = 0; i < entries.size() && i < 4; i++) {
                Object entry = entries.get(i);
                JSONObject row = new JSONObject().put("mapIndex", i + 1);
                row.put("sdkFrameMetrics", new JSONObject().put("available", false)
                    .put("reason", "optimized_sdk_frame_hook_not_collected"));
                try {
                    Object frames = fieldValue(entry, "actualFrameCount");
                    Object lastFrame = fieldValue(entry, "lastActualFrameAt");
                    long count = atomicLongValue(frames);
                    long last = atomicLongValue(lastFrame);
                    row.put("actualFrameCount", count)
                        .put("lastFrameAgeMs", last > 0L ? Math.max(0L, SystemClock.elapsedRealtime() - last) : JSONObject.NULL);
                } catch (Throwable failure) {
                    row.put("frameStatsAvailable", false).put("frameStatsReason", failure.getClass().getSimpleName());
                }
                try {
                    Object controller = fieldValue(entry, "controller");
                    Object worldWindow = fieldValue(controller, "worldWindow");
                    Object engine = fieldValue(worldWindow, "engine");
                    Object cache = fieldValue(engine, "renderResourceCache");
                    Integer cacheId = seen.get(cache);
                    if (cacheId == null) {
                        cacheId = ++uniqueCaches;
                        seen.put(cache, cacheId);
                        long c = numberValue(cache, "capacity");
                        long u = numberValue(cache, "usedCapacity");
                        capacity += Math.max(0L, c);
                        used += Math.max(0L, u);
                    }
                    row.put("renderCacheGroup", cacheId);
                } catch (Throwable failure) {
                    row.put("renderCacheAvailable", false).put("renderCacheReason", failure.getClass().getSimpleName());
                }
                rows.put(row);
            }
            JSONObject cache = new JSONObject().put("identityDeduplicated", true)
                .put("uniqueCacheCount", uniqueCaches).put("logicalCapacityBytes", capacity)
                .put("logicalUsedBytes", used).put("available", uniqueCaches > 0);
            return new JSONObject().put("available", true).put("mapCount", entries.size())
                .put("maps", rows).put("renderCache", cache);
        }

        private JSONObject record(String type) throws Exception {
            return new JSONObject().put("type", type).put("elapsedMs", elapsed())
                .put("wallTimeMs", System.currentTimeMillis());
        }

        /** Called on main: map ownership is main-thread confined by NativeReactMapHost. */
        private void installCurrentMapProxies() {
            try {
                Object value = fieldValue(host, "maps");
                if (!(value instanceof Map)) return;
                for (Object entry : new ArrayList<>(((Map<?, ?>) value).values())) {
                    try { installFrameMetricsProxy(entry); } catch (Throwable ignored) { }
                }
            } catch (Throwable ignored) { }
        }

        /** Wraps the existing SDK hook so the controller's frame witness and demand callbacks remain active. */
        private NativeFrameMetricsTap installFrameMetricsProxy(Object entry) throws Exception {
            Object controller = fieldValue(entry, "controller");
            Object worldWindow = fieldValue(controller, "worldWindow");
            Object engine = fieldValue(worldWindow, "engine");
            Object currentMetrics = fieldValue(engine, "frameMetrics");
            NativeFrameMetricsTap existing = frameMetricsTaps.get(engine);
            if (existing != null && currentMetrics == existing.proxy) return existing;
            if (currentMetrics != null && Proxy.isProxyClass(currentMetrics.getClass())) {
                InvocationHandler handler = Proxy.getInvocationHandler(currentMetrics);
                if (handler instanceof NativeFrameMetricsHandler) {
                    NativeFrameMetricsTap tap = ((NativeFrameMetricsHandler) handler).tap;
                    frameMetricsTaps.put(engine, tap);
                    return tap;
                }
            }

            Class<?> metricsType = fieldType(engine, "frameMetrics");
            NativeFrameMetricsTap tap = new NativeFrameMetricsTap(currentMetrics);
            NativeFrameMetricsHandler handler = new NativeFrameMetricsHandler(tap);
            Object proxy = Proxy.newProxyInstance(metricsType.getClassLoader(), new Class<?>[]{metricsType}, handler);
            tap.proxy = proxy;
            setFieldValue(engine, "frameMetrics", proxy);
            frameMetricsTaps.put(engine, tap);
            return tap;
        }

        private void restoreNativeFrameMetrics() {
            Runnable restore = () -> {
                for (Map.Entry<Object, NativeFrameMetricsTap> item : new ArrayList<>(frameMetricsTaps.entrySet())) {
                    try {
                        Object currentMetrics = fieldValue(item.getKey(), "frameMetrics");
                        if (currentMetrics == item.getValue().proxy)
                            setFieldValue(item.getKey(), "frameMetrics", item.getValue().delegate);
                    } catch (Throwable ignored) { }
                }
                frameMetricsTaps.clear();
            };
            if (Looper.myLooper() == Looper.getMainLooper()) { restore.run(); return; }
            CountDownLatch latch = new CountDownLatch(1);
            main.post(() -> { try { restore.run(); } finally { latch.countDown(); } });
            try { latch.await(400L, TimeUnit.MILLISECONDS); } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
        }

        private long elapsed() { return Math.max(0L, SystemClock.elapsedRealtime() - startedWall); }

        private void append(JSONObject row) {
            synchronized (writerLock) {
                BufferedWriter active = writer;
                if (active == null) return;
                try { active.write(row.toString()); active.newLine(); active.flush(); }
                catch (Exception ignored) { }
            }
        }

        private void closeWriter() {
            synchronized (writerLock) {
                if (writer == null) return;
                try { writer.close(); } catch (Exception ignored) { }
                writer = null;
            }
        }
    }

    private static final class FrameSummary {
        private final AtomicLong count = new AtomicLong();
        private final AtomicLong dropped = new AtomicLong();
        private final AtomicLong over50 = new AtomicLong(), over100 = new AtomicLong();
        private final AtomicLong totalNs = new AtomicLong();
        private final AtomicLong drawNs = new AtomicLong();
        private final AtomicLong syncNs = new AtomicLong();
        private final AtomicLong commandNs = new AtomicLong();
        private final AtomicLong swapNs = new AtomicLong();
        private final AtomicLong inputNs = new AtomicLong();
        private final AtomicLong maxTotalNs = new AtomicLong();
        private volatile boolean available;
        private volatile String reason = "pending";

        void available() { available = true; reason = ""; }
        void unavailable(String why) { available = false; reason = why; }

        void record(FrameMetrics metrics, int dropCount) {
            try {
                long total = metrics.getMetric(FrameMetrics.TOTAL_DURATION);
                long draw = metrics.getMetric(FrameMetrics.DRAW_DURATION);
                long sync = metrics.getMetric(FrameMetrics.SYNC_DURATION);
                long command = metrics.getMetric(FrameMetrics.COMMAND_ISSUE_DURATION);
                long swap = metrics.getMetric(FrameMetrics.SWAP_BUFFERS_DURATION);
                long input = metrics.getMetric(FrameMetrics.INPUT_HANDLING_DURATION);
                count.incrementAndGet(); dropped.addAndGet(Math.max(0, dropCount));
                if (total > 50_000_000L) over50.incrementAndGet();
                if (total > 100_000_000L) over100.incrementAndGet();
                totalNs.addAndGet(Math.max(0L, total)); drawNs.addAndGet(Math.max(0L, draw));
                syncNs.addAndGet(Math.max(0L, sync)); commandNs.addAndGet(Math.max(0L, command));
                swapNs.addAndGet(Math.max(0L, swap)); inputNs.addAndGet(Math.max(0L, input));
                maxTotalNs.accumulateAndGet(Math.max(0L, total), Math::max);
            } catch (Throwable failure) { unavailable("sample_failed:" + failure.getClass().getSimpleName()); }
        }

        JSONObject descriptor() throws Exception {
            return new JSONObject().put("available", available).put("reason", reason)
                .put("scope", "Android Window FrameMetrics/HWUI; not WorldWind GLSurfaceView render time");
        }

        JSONObject snapshot() throws Exception {
            long n = count.get();
            return descriptor().put("frameCount", n).put("droppedReports", dropped.get())
                .put("meanTotalMs", meanMs(totalNs.get(), n)).put("meanDrawMs", meanMs(drawNs.get(), n))
                .put("meanSyncMs", meanMs(syncNs.get(), n)).put("meanCommandIssueMs", meanMs(commandNs.get(), n))
                .put("meanSwapBuffersMs", meanMs(swapNs.get(), n)).put("meanInputHandlingMs", meanMs(inputNs.get(), n))
                .put("maxTotalMs", maxTotalNs.get() / 1_000_000.0).put("over50ms", over50.get()).put("over100ms", over100.get());
        }

        private double meanMs(long total, long n) { return n == 0L ? 0.0 : (double) total / n / 1_000_000.0; }
    }

    private static final class NativeFrameMetricsTap {
        final Object delegate;
        final StageTimer renderWall = new StageTimer();
        final StageTimer drawSubmissionWall = new StageTimer();
        Object proxy;

        NativeFrameMetricsTap(Object delegate) { this.delegate = delegate; }

        JSONObject snapshot() throws Exception {
            return new JSONObject().put("available", true)
                .put("sdkRenderWall", renderWall.snapshot())
                .put("sdkDrawSubmissionWall", drawSubmissionWall.snapshot())
                .put("meaning", "SDK CPU wall durations; draw duration is GL command submission, not GPU execution time");
        }
    }

    private static final class NativeFrameMetricsHandler implements InvocationHandler {
        final NativeFrameMetricsTap tap;
        NativeFrameMetricsHandler(NativeFrameMetricsTap tap) { this.tap = tap; }

        @Override public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
            String name = method.getName();
            if (method.getDeclaringClass() == Object.class) {
                if (tap.delegate == null) {
                    if ("equals".equals(name)) return proxy == (args == null ? null : args[0]);
                    if ("hashCode".equals(name)) return System.identityHashCode(proxy);
                    if ("toString".equals(name)) return "Native163FrameMetricsProxy(no-delegate)";
                } else {
                    try { return method.invoke(tap.delegate, args); }
                    catch (InvocationTargetException failure) { throw failure.getCause(); }
                }
            }

            StageTimer beginTimer = null, endTimer = null;
            if ("beginRendering".equals(name)) beginTimer = tap.renderWall;
            else if ("endRendering".equals(name)) endTimer = tap.renderWall;
            else if ("beginDrawing".equals(name)) beginTimer = tap.drawSubmissionWall;
            else if ("endDrawing".equals(name)) endTimer = tap.drawSubmissionWall;
            if (beginTimer != null) beginTimer.begin();
            try {
                if (tap.delegate != null) return method.invoke(tap.delegate, args);
                return null;
            } catch (InvocationTargetException failure) {
                if (beginTimer != null) beginTimer.cancel();
                throw failure.getCause();
            } catch (Throwable failure) {
                if (beginTimer != null) beginTimer.cancel();
                throw failure;
            } finally {
                if (endTimer != null) endTimer.end();
            }
        }
    }

    /** Atomic per-map durations; wall time intentionally includes waits and is not labelled CPU time. */
    private static final class StageTimer {
        private final ThreadLocal<Long> startNs = new ThreadLocal<>();
        private final AtomicLong count = new AtomicLong();
        private final AtomicLong totalNs = new AtomicLong();
        private final AtomicLong maxNs = new AtomicLong();
        private final AtomicLong over50 = new AtomicLong();
        private final AtomicLong over100 = new AtomicLong();

        void begin() { startNs.set(SystemClock.elapsedRealtimeNanos()); }
        void cancel() { startNs.remove(); }
        void end() {
            Long started = startNs.get();
            startNs.remove();
            if (started == null) return;
            long elapsed = Math.max(0L, SystemClock.elapsedRealtimeNanos() - started);
            count.incrementAndGet();
            totalNs.addAndGet(elapsed);
            maxNs.accumulateAndGet(elapsed, Math::max);
            if (elapsed > 50_000_000L) over50.incrementAndGet();
            if (elapsed > 100_000_000L) over100.incrementAndGet();
        }

        JSONObject snapshot() throws Exception {
            long n = count.get(), total = totalNs.get();
            return new JSONObject().put("count", n).put("totalWallMs", total / 1_000_000.0)
                .put("meanWallMs", n == 0L ? 0.0 : (double) total / n / 1_000_000.0)
                .put("maxWallMs", maxNs.get() / 1_000_000.0)
                .put("over50ms", over50.get()).put("over100ms", over100.get());
        }
    }

    private static Class<?> fieldType(Object owner, String name) throws Exception {
        Class<?> type = owner.getClass();
        while (type != null) {
            try { return type.getDeclaredField(name).getType(); }
            catch (NoSuchFieldException absent) { type = type.getSuperclass(); }
        }
        throw new NoSuchFieldException(name);
    }

    private static Object fieldValue(Object owner, String name) throws Exception {
        if (owner == null) throw new NoSuchFieldException(name);
        Class<?> type = owner.getClass();
        while (type != null) {
            try {
                Field field = type.getDeclaredField(name);
                field.setAccessible(true);
                return field.get(owner);
            } catch (NoSuchFieldException absent) { type = type.getSuperclass(); }
        }
        throw new NoSuchFieldException(name);
    }

    private static void setFieldValue(Object owner, String name, Object value) throws Exception {
        if (owner == null) throw new NoSuchFieldException(name);
        Class<?> type = owner.getClass();
        while (type != null) {
            try {
                Field field = type.getDeclaredField(name);
                field.setAccessible(true);
                field.set(owner, value);
                return;
            } catch (NoSuchFieldException absent) { type = type.getSuperclass(); }
        }
        throw new NoSuchFieldException(name);
    }

    private static long atomicLongValue(Object value) throws Exception {
        if (value instanceof AtomicLong) return ((AtomicLong) value).get();
        if (value instanceof Number) return ((Number) value).longValue();
        throw new IllegalStateException("not_numeric");
    }

    private static long numberValue(Object owner, String property) throws Exception {
        String getter = "get" + Character.toUpperCase(property.charAt(0)) + property.substring(1);
        try {
            Method method = owner.getClass().getMethod(getter);
            Object value = method.invoke(owner);
            if (value instanceof Number) return ((Number) value).longValue();
        } catch (ReflectiveOperationException ignored) { }
        Object value = fieldValue(owner, property);
        if (value instanceof Number) return ((Number) value).longValue();
        throw new IllegalStateException("not_numeric:" + property);
    }

    private static JSONObject reported(long value) {
        JSONObject out = new JSONObject();
        try { out.put("valueKiB", value).put("reported", true); } catch (Exception ignored) { }
        return out;
    }
    private static JSONObject unavailable(String reason) {
        JSONObject out = new JSONObject();
        try { out.put("valueKiB", JSONObject.NULL).put("reported", false).put("reason", reason); } catch (Exception ignored) { }
        return out;
    }
    private static JSONObject putJson(JSONObject target, String key, Object value) {
        try { target.put(key, value); } catch (Exception ignored) { }
        return target;
    }
}
