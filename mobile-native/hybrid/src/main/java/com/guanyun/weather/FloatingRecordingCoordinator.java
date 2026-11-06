package com.guanyun.weather;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.widget.Toast;

import com.shantu.nativeapp.floating.FloatingNavigationService;

import org.json.JSONObject;

import java.lang.ref.WeakReference;
import java.util.Objects;

import kotlin.Unit;

/**
 * Connects the floating view to the existing, persistent recording backend.
 * RecordingStore and RecordingService remain the sole owners of recording data/GPS.
 */
public final class FloatingRecordingCoordinator {
    private static final int REQUEST_RECORDING_FINE_LOCATION = 4607;
    private static final long SNAPSHOT_INTERVAL_MS = 1_000L;
    private static final String EXTRA_PERMISSION_ACTION = "shantu.floating-recording.permission-action";
    private static final Handler MAIN_HANDLER = new Handler(android.os.Looper.getMainLooper());

    private static final Object LOCK = new Object();
    private static volatile Context appContext;
    private static volatile WeakReference<Activity> hostActivity = new WeakReference<>(null);
    private static volatile HandlerThread pollThread;
    private static volatile Handler pollHandler;
    private static volatile String pendingPermissionAction;
    private static volatile boolean permissionRequestOutstanding;
    private static volatile boolean permissionLaunchRequested;
    private static volatile boolean recordingStartPending;
    private static String lastSnapshot;
    private static boolean lastFloatingEnabled;
    private static final Runnable CLEAR_PENDING_START = () -> recordingStartPending = false;

    private static final Runnable POLL = new Runnable() {
        @Override public void run() {
            Context context = appContext;
            if (context == null) return;
            pollSnapshot(context);
            Handler handler = pollHandler;
            if (handler != null) handler.postDelayed(this, SNAPSHOT_INTERVAL_MS);
        }
    };

    private FloatingRecordingCoordinator() { }

    /** Install once from the hybrid host. Only application context is retained. */
    public static void install(Context context) {
        if (context == null) return;
        Context application = context.getApplicationContext();
        synchronized (LOCK) {
            appContext = application != null ? application : context;
            if (context instanceof Activity) hostActivity = new WeakReference<>((Activity) context);
            FloatingNavigationService.Companion.setRecordingActionListener(action -> {
                Handler main = new Handler(android.os.Looper.getMainLooper());
                main.post(() -> handleFloatingAction(action));
                return Unit.INSTANCE;
            });
            ensurePollerLocked();
        }
        refresh();
    }

    /** Request one immediate state pass after the floating or recording service starts. */
    public static void refresh() {
        Handler handler = pollHandler;
        if (handler != null) handler.post(() -> {
            Context context = appContext;
            if (context != null) pollSnapshot(context);
        });
    }

    /** Clear the coordinator only when the owner is actually shutting it down. */
    public static void stop() {
        synchronized (LOCK) {
            FloatingNavigationService.Companion.setRecordingActionListener(null);
            Handler handler = pollHandler;
            if (handler != null) handler.removeCallbacksAndMessages(null);
            HandlerThread thread = pollThread;
            pollHandler = null;
            pollThread = null;
            if (thread != null) thread.quitSafely();
            hostActivity = new WeakReference<>(null);
            appContext = null;
            pendingPermissionAction = null;
            permissionRequestOutstanding = false;
            permissionLaunchRequested = false;
            recordingStartPending = false;
            lastSnapshot = null;
            lastFloatingEnabled = false;
        }
    }

    /** Host lifecycle hook; call from the hybrid Activity's onResume(). */
    public static void onHostResume(Activity activity) {
        if (activity == null) return;
        hostActivity = new WeakReference<>(activity);
        String action = pendingPermissionAction;
        if (action == null) return;
        if (hasFineLocation(activity)) {
            clearPermissionRequest();
            startRecording(activity.getApplicationContext(), action);
            return;
        }
        requestFineLocation(activity);
    }

    /** Host lifecycle hook; call from onPause() to avoid retaining even a weak stale host. */
    public static void onHostPause(Activity activity) {
        WeakReference<Activity> reference = hostActivity;
        if (reference != null && reference.get() == activity) hostActivity = new WeakReference<>(null);
    }

    /** Host permission callback hook; return true when this coordinator handled the request. */
    public static boolean onRequestPermissionsResult(int requestCode) {
        if (requestCode != REQUEST_RECORDING_FINE_LOCATION) return false;
        Activity activity = hostActivity == null ? null : hostActivity.get();
        Context context = activity != null ? activity.getApplicationContext() : appContext;
        String action = pendingPermissionAction;
        clearPermissionRequest();
        if (context == null || action == null) return true;
        if (hasFineLocation(context)) startRecording(context, action);
        else showMessage(context, "未获得精确定位权限，悬浮记录未启动；可从应用定位权限中授权后重试");
        return true;
    }

    private static void ensurePollerLocked() {
        if (pollThread != null && pollThread.isAlive() && pollHandler != null) return;
        HandlerThread thread = new HandlerThread("floating-recording-snapshot");
        thread.start();
        pollThread = thread;
        pollHandler = new Handler(thread.getLooper());
        pollHandler.post(POLL);
    }

    private static void pollSnapshot(Context context) {
        final boolean enabled;
        try {
            enabled = FloatingNavigationService.Companion.status().optBoolean("enabled", false);
        } catch (Exception ignored) {
            return;
        }
        if (!enabled) { lastFloatingEnabled = false; return; }
        final String serialized = RecordingStore.snapshot(context);

        boolean changed = !Objects.equals(lastSnapshot, serialized);
        boolean newlyEnabled = enabled && !lastFloatingEnabled;
        lastSnapshot = serialized;
        lastFloatingEnabled = enabled;
        if (!enabled || (!changed && !newlyEnabled)) return;

        try {
            JSONObject snapshot = new JSONObject(serialized);
            String phase = snapshot.optString("phase", "");
            if (!("idle".equals(phase) || "recording".equals(phase) || "paused".equals(phase) || "finished".equals(phase))) return;
            FloatingNavigationService.Companion.updateRecordingSnapshot(snapshot);
            if ("recording".equals(phase)) {
                recordingStartPending = false;
                MAIN_HANDLER.removeCallbacks(CLEAR_PENDING_START);
            }
        } catch (Exception ignored) {
            // Invalid/corrupt snapshots are left untouched and never replace existing data.
        }
    }

    private static void handleFloatingAction(String action) {
        Context context = appContext;
        if (context == null || action == null) return;
        if (!("start".equals(action) || "pause".equals(action) || "resume".equals(action))) return;
        try {
            JSONObject floatingStatus = FloatingNavigationService.Companion.status();
            JSONObject lockscreen = floatingStatus.optJSONObject("lockscreen");
            boolean lockscreenVisible = lockscreen != null && lockscreen.optBoolean("attached", false) &&
                lockscreen.optBoolean("screenOn", false) && lockscreen.optBoolean("locked", false);
            if (!floatingStatus.optBoolean("enabled", false) ||
                !(floatingStatus.optBoolean("visible", false) || lockscreenVisible)) {
                showMessage(context, "悬浮地图当前不可见，未更改记录状态");
                return;
            }
        } catch (Exception failure) {
            showMessage(context, "悬浮导航状态暂不可读，未更改记录状态");
            return;
        }

        final JSONObject current;
        try { current = new JSONObject(RecordingStore.snapshot(context)); }
        catch (Exception failure) {
            showMessage(context, "原生记录状态暂不可读；现有记录保持不变");
            return;
        }
        String phase = current.optString("phase", "");

        if ("start".equals(action)) {
            if (!"idle".equals(phase)) {
                showMessage(context, "当前已有记录或未保存草稿；先保存或清理后再开始");
                return;
            }
            if (recordingStartPending) return;
            if (!hasFineLocation(context)) {
                requestPermissionThroughHost(context, action);
                return;
            }
            recordingStartPending = true;
            startRecording(context, action);
            return;
        }

        if ("resume".equals(action)) {
            if (!"paused".equals(phase)) {
                showMessage(context, "当前记录不是暂停状态；未更改现有草稿");
                return;
            }
            if (recordingStartPending) return;
            if (!hasFineLocation(context)) {
                requestPermissionThroughHost(context, action);
                return;
            }
            recordingStartPending = true;
            startRecording(context, action);
            return;
        }

        if (!"recording".equals(phase)) {
            showMessage(context, "当前没有正在记录的轨迹");
            return;
        }
        try {
            RecordingStore.command(context, "pause");
            context.stopService(new Intent(context, RecordingService.class));
            refresh();
        } catch (Exception failure) {
            RecordingStore.error(context, "无法暂停记录；现有数据保持不变");
            refresh();
        }
    }

    private static void requestPermissionThroughHost(Context context, String action) {
        pendingPermissionAction = action;
        Activity activity = hostActivity == null ? null : hostActivity.get();
        if (activity != null && !activity.isFinishing() && (Build.VERSION.SDK_INT < 17 || !activity.isDestroyed()) && activity.hasWindowFocus()) {
            requestFineLocation(activity);
            return;
        }
        if (permissionLaunchRequested) return;
        permissionLaunchRequested = true;
        showMessage(context, "需要精确定位权限，正在返回应用授权");
        Intent intent = new Intent(context, NativeReactActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA_PERMISSION_ACTION, action);
        try { context.startActivity(intent); }
        catch (Exception failure) {
            permissionLaunchRequested = false;
            showMessage(context, "需要精确定位权限；请返回山兔应用的定位权限设置后重试");
        }
    }

    private static void requestFineLocation(Activity activity) {
        if (permissionRequestOutstanding || hasFineLocation(activity)) return;
        permissionRequestOutstanding = true;
        activity.runOnUiThread(() -> {
            try {
                activity.requestPermissions(
                    new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION},
                    REQUEST_RECORDING_FINE_LOCATION
                );
            } catch (Exception failure) {
                permissionRequestOutstanding = false;
                showMessage(activity.getApplicationContext(), "无法打开定位授权，请从应用权限设置中允许精确定位");
            }
        });
    }

    private static void startRecording(Context context, String action) {
        final String requiredPhase = "start".equals(action) ? "idle" : "paused";
        try {
            String phase = new JSONObject(RecordingStore.snapshot(context)).optString("phase", "");
            if (!requiredPhase.equals(phase)) {
                recordingStartPending = false;
                showMessage(context, "记录状态已变化；现有记录保持不变，请返回悬浮地图重试");
                return;
            }
        } catch (Exception failure) {
            recordingStartPending = false;
            showMessage(context, "原生记录状态暂不可读；现有记录保持不变");
            return;
        }
        if (!hasFineLocation(context)) {
            showMessage(context, "需要精确定位权限，悬浮记录未启动");
            recordingStartPending = false;
            return;
        }
        recordingStartPending = true;
        MAIN_HANDLER.removeCallbacks(CLEAR_PENDING_START);
        MAIN_HANDLER.postDelayed(CLEAR_PENDING_START, 15_000L);
        try {
            Intent intent = new Intent(context, RecordingService.class).setAction(action);
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent);
            else context.startService(intent);
            refresh();
        } catch (Exception failure) {
            recordingStartPending = false;
            MAIN_HANDLER.removeCallbacks(CLEAR_PENDING_START);
            RecordingStore.error(context, "记录服务未能启动，请返回应用后重试");
            showMessage(context, "记录服务未能启动；现有记录保持不变");
            refresh();
        }
    }

    private static boolean hasFineLocation(Context context) {
        return Build.VERSION.SDK_INT < 23 || context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private static void clearPermissionRequest() {
        pendingPermissionAction = null;
        permissionRequestOutstanding = false;
        permissionLaunchRequested = false;
    }

    private static void showMessage(Context context, String message) {
        Handler main = new Handler(android.os.Looper.getMainLooper());
        main.post(() -> Toast.makeText(context.getApplicationContext(), message, Toast.LENGTH_SHORT).show());
    }
}
