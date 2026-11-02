package com.shantu.qa149;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.os.Bundle;
import android.os.Environment;
import android.os.Build;
import android.system.Os;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

/** Reversible cache-directory isolation for a dedicated cold/warm QA session. */
public final class Native163CacheScope {
    private static final String MODE = "native163-cache-scope";
    private static final String MANIFEST_DIR = "native163-cache-scope";
    private static final String BROWSE_CACHE = "shantu-map-browse-cache";
    private static final String TILE_CACHE = "shantu-native-map-tiles";
    private static final String[] LABELS = {"browse", "nativeTiles"};

    private Native163CacheScope() { }

    public static JSONObject run(Instrumentation instrumentation, Bundle arguments) {
        String action = arguments == null ? "" : arguments.getString("action", "");
        String sessionId = arguments == null ? "" : arguments.getString("sessionId", "");
        if (!isSafeSessionId(sessionId)) return report(action, sessionId, "BLOCKED", "invalid_session_id", 0, 0, new JSONArray());
        if (!"isolate".equals(action) && !"restore".equals(action))
            return report(action, sessionId, "BLOCKED", "unsupported_action", 0, 0, new JSONArray());
        if (instrumentation == null) return report(action, sessionId, "BLOCKED", "instrumentation_unavailable", 0, 0, new JSONArray());
        try {
            Context context = instrumentation.getTargetContext();
            File manifest = manifestFile(context, sessionId);
            Safety safety = inspectSafety(instrumentation, arguments);
            if (!safety.safe) return report(action, sessionId, "BLOCKED", safety.reason,
                safety.activityCount, safety.glThreadCount + safety.mapWorkerCount, new JSONArray());
            return "isolate".equals(action)
                ? isolate(context, manifest, sessionId)
                : restore(context, manifest, sessionId);
        } catch (Throwable failure) {
            return report(action, sessionId, "ERROR", "cache_scope_" + failure.getClass().getSimpleName(), 0, 0, new JSONArray());
        }
    }

    private static JSONObject isolate(Context context, File manifest, String sessionId) throws Exception {
        if (manifest.exists()) return operationReport("isolate", sessionId, "BLOCKED", "session_manifest_exists", 0, 0, new JSONArray());
        List<Entry> entries = resolveEntries(context, sessionId);
        for (Entry entry : entries) {
            if (entry.original.exists() && !entry.original.isDirectory())
                return operationReport("isolate", sessionId, "BLOCKED", "cache_path_not_directory", 0, 0, entryReports(entries, false));
            if (entry.backup.exists())
                return operationReport("isolate", sessionId, "BLOCKED", "isolation_destination_exists", 0, 0, entryReports(entries, false));
            if (entry.generated.exists())
                return operationReport("isolate", sessionId, "BLOCKED", "generated_cache_destination_exists", 0, 0, entryReports(entries, false));
        }
        ensureManifestParent(manifest);
        if (!createManifest(manifest, manifestRecord(sessionId, "prepared", entries)))
            return operationReport("isolate", sessionId, "BLOCKED", "manifest_create_failed", 0, 0, entryReports(entries, false));
        List<Move> moved = new ArrayList<>();
        for (Entry entry : entries) {
            if (!entry.original.exists()) continue;
            if (!rename(entry.original, entry.backup)) {
                boolean rolledBack = rollback(moved);
                if (rolledBack) for (Entry movedEntry : entries) movedEntry.isolated = false;
                appendManifest(manifest, manifestRecord(sessionId, rolledBack ? "isolate_rolled_back" : "partial_isolate", entries));
                return operationReport("isolate", sessionId, rolledBack ? "ROLLED_BACK" : "RECOVERY_REQUIRED",
                    rolledBack ? "rename_failed_rolled_back" : "rename_failed_partial", 0, moved.size(), entryReports(entries, false));
            }
            moved.add(new Move(entry.original, entry.backup));
            entry.isolated = true;
        }
        boolean manifestUpdated = appendManifest(manifest, manifestRecord(sessionId, "isolated", entries));
        return operationReport("isolate", sessionId, "ISOLATED", manifestUpdated ? "ok" : "manifest_state_append_failed",
            0, moved.size(), entryReports(entries, false));
    }

    private static JSONObject restore(Context context, File manifest, String sessionId) throws Exception {
        if (!manifest.isFile()) return operationReport("restore", sessionId, "BLOCKED", "session_manifest_missing", 0, 0, new JSONArray());
        JSONObject latest = readLatestManifest(manifest, sessionId);
        if (latest == null) return operationReport("restore", sessionId, "BLOCKED", "session_manifest_invalid", 0, 0, new JSONArray());
        String state = latest.optString("state", "");
        JSONArray savedEntries = latest.optJSONArray("entries");
        if ("restored".equals(state)) return operationReport("restore", sessionId, "ALREADY_RESTORED", "ok", 0, 0, savedEntries == null ? new JSONArray() : savedEntries);
        List<Entry> entries = resolveEntries(context, sessionId);
        if (!validSavedEntries(savedEntries, entries))
            return operationReport("restore", sessionId, "BLOCKED", "manifest_scope_mismatch", 0, 0, new JSONArray());
        for (int i = 0; i < entries.size(); i++) {
            Entry entry = entries.get(i);
            JSONObject savedEntry = savedEntries.getJSONObject(i);
            entry.existedAtStart = savedEntry.optBoolean("existedAtStart", false);
            entry.childCountAtStart = savedEntry.optInt("directChildCountAtStart", -1);
            if (entry.original.exists() && !entry.original.isDirectory())
                return operationReport("restore", sessionId, "BLOCKED", "cache_path_not_directory", 0, 0, savedEntries);
            if (entry.backup.exists() && !entry.backup.isDirectory())
                return operationReport("restore", sessionId, "BLOCKED", "backup_path_not_directory", 0, 0, savedEntries);
            if (entry.generated.exists() && entry.original.exists())
                return operationReport("restore", sessionId, "RECOVERY_REQUIRED", "generated_cache_and_original_both_exist", 0, 0, savedEntries);
            if (entry.existedAtStart && !entry.backup.exists() && !entry.original.exists())
                return operationReport("restore", sessionId, "RECOVERY_REQUIRED", "original_and_backup_missing", 0, 0, savedEntries);
        }

        List<Move> moved = new ArrayList<>();
        int preservedGenerated = 0;
        for (Entry entry : entries) {
            boolean hasBackup = entry.backup.exists();
            if (entry.original.exists() && (hasBackup || !entry.existedAtStart)) {
                if (!rename(entry.original, entry.generated)) {
                    boolean rolledBack = rollback(moved);
                    if (rolledBack) resetRestoreFlags(entries);
                    appendManifest(manifest, manifestRecord(sessionId, rolledBack ? "restore_rolled_back" : "partial_restore", entries));
                    return operationReport("restore", sessionId, rolledBack ? "ROLLED_BACK" : "RECOVERY_REQUIRED",
                        rolledBack ? "new_cache_preserve_failed_rolled_back" : "new_cache_preserve_failed_partial",
                        0, moved.size(), entryReports(entries, false));
                }
                moved.add(new Move(entry.original, entry.generated));
                entry.generatedPreserved = true;
                preservedGenerated++;
            }
            if (hasBackup) {
                if (!rename(entry.backup, entry.original)) {
                    boolean rolledBack = rollback(moved);
                    if (rolledBack) resetRestoreFlags(entries);
                    appendManifest(manifest, manifestRecord(sessionId, rolledBack ? "restore_rolled_back" : "partial_restore", entries));
                    return operationReport("restore", sessionId, rolledBack ? "ROLLED_BACK" : "RECOVERY_REQUIRED",
                        rolledBack ? "original_restore_failed_rolled_back" : "original_restore_failed_partial",
                        0, moved.size(), entryReports(entries, false));
                }
                moved.add(new Move(entry.backup, entry.original));
                entry.restored = true;
            }
        }
        preservedGenerated = 0;
        for (Entry entry : entries) {
            entry.restored = entry.existedAtStart
                ? entry.original.isDirectory() && !entry.backup.exists()
                : !entry.original.exists();
            entry.generatedPreserved = entry.generated.isDirectory();
            if (entry.generatedPreserved) preservedGenerated++;
        }
        boolean manifestUpdated = appendManifest(manifest, manifestRecord(sessionId, "restored", entries));
        return operationReport("restore", sessionId, "RESTORED", manifestUpdated ? "ok" : "manifest_state_append_failed",
            0, moved.size(), entryReports(entries, true)).put("newCachesPreserved", preservedGenerated);
    }

    private static Safety inspectSafety(Instrumentation instrumentation, Bundle arguments) {
        Safety safety = new Safety();
        try {
            String model = Build.MODEL == null ? "" : Build.MODEL.toLowerCase(Locale.ROOT);
            String fingerprint = Build.FINGERPRINT == null ? "" : Build.FINGERPRINT.toLowerCase(Locale.ROOT);
            boolean x86_64 = false;
            String[] supportedAbis = Build.SUPPORTED_ABIS;
            if (supportedAbis != null) for (String abi : supportedAbis) if ("x86_64".equals(abi)) x86_64 = true;
            // am instrument -e delivers strings; also accept an actual boolean from a typed harness.
            Object confirmation = arguments == null ? null : arguments.get("confirmedDedicatedEmulator");
            boolean explicitlyConfirmed = Boolean.TRUE.equals(confirmation) || "true".equals(confirmation);
            boolean simulator = model.contains("mumu") || model.contains("emulator") ||
                fingerprint.contains("generic") || fingerprint.contains("emulator") || fingerprint.contains("sdk_gphone") ||
                (explicitlyConfirmed && x86_64);
            if (!simulator) {
                safety.safe = false;
                safety.reason = "dedicated_simulator_required";
                return safety;
            }
            Object application = instrumentation.getTargetContext().getApplicationContext();
            if (application == null || !"android.app.Application".equals(application.getClass().getName())) {
                safety.safe = false;
                safety.reason = "application_startup_not_verified";
                return safety;
            }
            Object parentActivity = fieldValue(instrumentation, "activity");
            Object parentHost = fieldValue(instrumentation, "host");
            if (parentActivity != null || parentHost != null) {
                safety.safe = false;
                safety.reason = "instrumentation_already_attached";
                return safety;
            }
            AtomicReference<Integer> activeActivities = new AtomicReference<>(0);
            AtomicReference<Throwable> registryFailure = new AtomicReference<>();
            instrumentation.runOnMainSync(() -> {
                try {
                    Class<?> activityThreadClass = Class.forName("android.app.ActivityThread");
                    Method currentMethod = activityThreadClass.getDeclaredMethod("currentActivityThread");
                    currentMethod.setAccessible(true);
                    Object activityThread = currentMethod.invoke(null);
                    Object activityRecords = fieldValue(activityThread, "mActivities");
                    if (!(activityRecords instanceof Map)) throw new IllegalStateException("activity_registry_unavailable");
                    int count = 0;
                    for (Object record : ((Map<?, ?>) activityRecords).values()) {
                        Object value = fieldValue(record, "activity");
                        if (value instanceof Activity) {
                            Activity activity = (Activity) value;
                            if (!activity.isFinishing() && !activity.isDestroyed()) count++;
                        }
                    }
                    activeActivities.set(count);
                } catch (Throwable failure) { registryFailure.set(failure); }
            });
            if (registryFailure.get() != null) throw new IllegalStateException("activity_registry_unavailable");
            safety.activityCount = activeActivities.get();
            for (Thread thread : Thread.getAllStackTraces().keySet()) {
                String name = thread.getName();
                if (name.startsWith("GLThread")) safety.glThreadCount++;
                if (name.startsWith("shantu-tile-http") || name.startsWith("native-snap-geometry")) safety.mapWorkerCount++;
            }
            safety.safe = safety.activityCount == 0 && safety.glThreadCount == 0 && safety.mapWorkerCount == 0;
            safety.reason = safety.safe ? "fresh_instrumentation_no_active_map" : "active_activity_or_map_worker";
        } catch (Throwable failure) {
            safety.safe = false;
            safety.reason = "activity_safety_check_unavailable";
        }
        return safety;
    }

    private static List<Entry> resolveEntries(Context context, String sessionId) throws Exception {
        File filesRoot = context.getFilesDir().getCanonicalFile();
        File cacheRoot = context.getCacheDir().getCanonicalFile();
        List<Entry> result = new ArrayList<>();
        result.add(new Entry(LABELS[0], child(filesRoot, BROWSE_CACHE), sessionId));
        result.add(new Entry(LABELS[1], child(cacheRoot, TILE_CACHE), sessionId));
        return result;
    }

    private static File manifestFile(Context context, String sessionId) throws Exception {
        File external = context.getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS);
        if (external == null) throw new IllegalStateException("private_manifest_directory_unavailable");
        File externalRoot = external.getCanonicalFile();
        File directory = child(externalRoot, MANIFEST_DIR);
        return child(directory, sessionId + ".jsonl");
    }

    private static File child(File canonicalParent, String name) throws Exception {
        File parent = canonicalParent.getCanonicalFile();
        File candidate = new File(parent, name).getCanonicalFile();
        if (!parent.equals(candidate.getParentFile()) || !name.equals(candidate.getName()))
            throw new SecurityException("cache_scope_path_outside_fixed_parent");
        return candidate;
    }

    private static boolean isSafeSessionId(String value) {
        if (value == null || value.length() < 1 || value.length() > 48) return false;
        for (int i = 0; i < value.length(); i++) {
            char ch = value.charAt(i);
            if (!((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') ||
                (ch >= '0' && ch <= '9') || ch == '-' || ch == '_')) return false;
        }
        return true;
    }

    private static JSONObject manifestRecord(String sessionId, String state, List<Entry> entries) throws Exception {
        JSONArray rows = new JSONArray();
        for (Entry entry : entries) {
            rows.put(new JSONObject().put("label", entry.label)
                .put("existedAtStart", entry.existedAtStart)
                .put("directChildCountAtStart", entry.childCountAtStart));
        }
        return new JSONObject().put("schemaVersion", 1).put("mode", MODE)
            .put("sessionId", sessionId).put("state", state).put("entries", rows);
    }

    private static boolean validSavedEntries(JSONArray saved, List<Entry> expected) {
        if (saved == null || saved.length() != expected.size()) return false;
        for (int i = 0; i < expected.size(); i++) {
            JSONObject row = saved.optJSONObject(i);
            if (row == null || !expected.get(i).label.equals(row.optString("label", ""))) return false;
            if (!row.has("existedAtStart") || !(row.opt("existedAtStart") instanceof Boolean)) return false;
        }
        return true;
    }

    private static void ensureManifestParent(File manifest) throws Exception {
        File parent = manifest.getParentFile().getCanonicalFile();
        if (!parent.exists() && !parent.mkdirs()) throw new IllegalStateException("private_manifest_directory_unavailable");
        if (!parent.isDirectory() || !parent.equals(manifest.getCanonicalFile().getParentFile()))
            throw new SecurityException("manifest_scope_invalid");
        if (manifest.exists()) throw new IllegalStateException("session_manifest_exists");
    }

    private static boolean createManifest(File manifest, JSONObject record) {
        try {
            if (!manifest.createNewFile()) return false;
            try (FileOutputStream stream = new FileOutputStream(manifest, false);
                 BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(stream, StandardCharsets.UTF_8))) {
                writer.write(record.toString());
                writer.newLine();
                writer.flush();
                stream.getFD().sync();
                return true;
            }
        } catch (Exception ignored) { return false; }
    }

    private static boolean appendManifest(File manifest, JSONObject record) {
        try (FileOutputStream stream = new FileOutputStream(manifest, true);
             BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(stream, StandardCharsets.UTF_8))) {
            writer.write(record.toString());
            writer.newLine();
            writer.flush();
            stream.getFD().sync();
            return true;
        } catch (Exception ignored) { return false; }
    }

    private static JSONObject readLatestManifest(File manifest, String sessionId) {
        JSONObject latest = null;
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(new FileInputStream(manifest), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                try {
                    JSONObject row = new JSONObject(line);
                    if (row.optInt("schemaVersion") == 1 && MODE.equals(row.optString("mode")) &&
                        sessionId.equals(row.optString("sessionId")) && row.optJSONArray("entries") != null) latest = row;
                } catch (Exception ignored) { }
            }
        } catch (Exception ignored) { }
        return latest;
    }

    private static boolean rename(File from, File to) throws Exception {
        File source = from.getCanonicalFile(), destination = to.getCanonicalFile();
        if (!source.getParentFile().equals(destination.getParentFile()) || !source.exists() || destination.exists()) return false;
        try {
            Os.rename(source.getAbsolutePath(), destination.getAbsolutePath());
            return !source.exists() && destination.isDirectory();
        } catch (Throwable failure) { return false; }
    }

    private static boolean rollback(List<Move> moved) {
        boolean ok = true;
        for (int i = moved.size() - 1; i >= 0; i--) {
            Move move = moved.get(i);
            try { if (!rename(move.to, move.from)) ok = false; }
            catch (Throwable ignored) { ok = false; }
        }
        return ok;
    }

    private static void resetRestoreFlags(List<Entry> entries) {
        for (Entry entry : entries) {
            entry.restored = false;
            entry.generatedPreserved = false;
        }
    }

    private static JSONArray entryReports(List<Entry> entries, boolean restored) throws Exception {
        JSONArray rows = new JSONArray();
        for (Entry entry : entries) {
            rows.put(new JSONObject().put("directory", entry.label)
                .put("existedAtStart", entry.existedAtStart)
                .put("directChildCountAtStart", entry.childCountAtStart)
                .put("isolated", entry.isolated).put("restored", restored && entry.restored)
                .put("newCachePreserved", entry.generatedPreserved));
        }
        return rows;
    }

    private static JSONObject operationReport(String action, String sessionId, String state, String reason,
                                              int ignored, int renamedDirectoryCount, JSONArray entries) throws Exception {
        return report(action, sessionId, state, reason, 0, 0, entries)
            .put("renamedDirectoryCount", renamedDirectoryCount);
    }

    private static JSONObject report(String action, String sessionId, String state, String reason,
                                     int activeActivities, int activeMapThreads, JSONArray entries) {
        JSONObject result = new JSONObject();
        try {
            String safeAction = "isolate".equals(action) || "restore".equals(action) ? action : "unknown";
            Object safeSessionId = isSafeSessionId(sessionId) ? sessionId : JSONObject.NULL;
            result.put("mode", MODE).put("action", safeAction).put("sessionId", safeSessionId)
                .put("state", state).put("reason", reason).put("activeActivityCount", activeActivities)
                .put("activeMapThreadCount", activeMapThreads).put("entries", entries);
        } catch (Exception ignored) { }
        return result;
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

    private static final class Entry {
        final String label;
        final File original;
        final File backup;
        final File generated;
        boolean existedAtStart;
        int childCountAtStart;
        boolean isolated;
        boolean restored;
        boolean generatedPreserved;

        Entry(String label, File original, String sessionId) throws Exception {
            this.label = label;
            this.original = original;
            this.backup = child(original.getParentFile(), original.getName() + ".qa-isolated-" + sessionId);
            this.generated = child(original.getParentFile(), original.getName() + ".qa-generated-" + sessionId);
            this.existedAtStart = original.exists();
            this.childCountAtStart = directChildCount(original);
        }
    }

    private static final class Safety {
        boolean safe;
        String reason = "unknown";
        int activityCount;
        int glThreadCount;
        int mapWorkerCount;
    }

    private static final class Move {
        final File from;
        final File to;
        Move(File from, File to) { this.from = from; this.to = to; }
    }

    private static int directChildCount(File directory) {
        if (!directory.exists()) return 0;
        File[] children = directory.listFiles();
        return children == null ? -1 : children.length;
    }
}
