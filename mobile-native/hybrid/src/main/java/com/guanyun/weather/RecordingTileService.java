package com.guanyun.weather;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;
import android.widget.Toast;

import com.shantu.nativeapp.R;

import org.json.JSONObject;

public final class RecordingTileService extends TileService {
    public static final String ACTION_OPEN_RECORDING = "com.guanyun.weather.action.OPEN_RECORDING";
    static final String EXTRA_EXPECTED_PHASE = "recording.expectedPhase";

    private static final long TAP_DEBOUNCE_MS = 900L;
    private static final long LAUNCH_TIMEOUT_MS = 4_000L;
    private static long nextTapAt;
    private static long launchUntil;
    private static long tapSequence;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private State displayedState;
    private final Runnable poll = new Runnable() {
        @Override public void run() {
            updateTile();
            handler.postDelayed(this, 1_000L);
        }
    };

    @Override public void onStartListening() {
        displayedState = null;
        handler.removeCallbacks(poll);
        poll.run();
    }

    @Override public void onStopListening() {
        handler.removeCallbacks(poll);
        displayedState = null;
    }

    @Override public void onDestroy() {
        handler.removeCallbacks(poll);
        super.onDestroy();
    }

    @Override public void onTileAdded() {
        updateTile();
    }

    @Override public void onClick() {
        if (SystemClock.elapsedRealtime() < Math.max(nextTapAt, launchUntil)) return;
        try {
            State expected = readState(this);
            // Never act on an old label, including a draft changed elsewhere.
            if (displayedState != null && !displayedState.matches(expected)) {
                updateTile();
                return;
            }
            nextTapAt = SystemClock.elapsedRealtime() + TAP_DEBOUNCE_MS;
            long tap = ++tapSequence;
            if (isLocked()) unlockAndRun(() -> execute(tap, expected));
            else execute(tap, expected);
        } catch (Exception failure) {
            notifyUser(this, R.string.recording_tile_unavailable);
            updateTile();
        }
    }

    private void execute(long tap, State expected) {
        if (tap != tapSequence || SystemClock.elapsedRealtime() < launchUntil) return;
        try {
            if (!expected.matches(readState(this))) {
                notifyUser(this, R.string.recording_tile_changed);
                updateTile();
                return;
            }
            switch (expected.phase) {
                case "recording":
                    synchronized (RecordingStore.class) {
                        if (!expected.matches(readState(this))) {
                            notifyUser(this, R.string.recording_tile_changed);
                            updateTile();
                            return;
                        }
                        RecordingStore.command(this, "pause");
                        stopService(new Intent(this, RecordingService.class));
                    }
                    FloatingRecordingCoordinator.refresh();
                    updateTile();
                    break;
                case "idle":
                case "paused":
                    launchUntil = SystemClock.elapsedRealtime() + LAUNCH_TIMEOUT_MS;
                    open(new Intent(this, RecordingTileActivity.class)
                        .putExtra(EXTRA_EXPECTED_PHASE, expected.phase)
                        .putExtra(RecordingService.EXPECTED_RECORDING_ID, expected.id));
                    break;
                case "finished":
                    open(new Intent(this, NativeReactActivity.class).setAction(ACTION_OPEN_RECORDING));
                    break;
                default:
                    notifyUser(this, R.string.recording_tile_unavailable);
                    break;
            }
        } catch (Exception failure) {
            launchFinished();
            notifyUser(this, R.string.recording_tile_failed);
            updateTile();
        }
    }

    @SuppressWarnings("deprecation")
    private void open(Intent intent) {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        if (Build.VERSION.SDK_INT >= 34) {
            PendingIntent launch = PendingIntent.getActivity(this, 0, intent,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_CANCEL_CURRENT | PendingIntent.FLAG_ONE_SHOT);
            startActivityAndCollapse(launch);
        } else {
            startActivityAndCollapse(intent);
        }
    }

    private void updateTile() {
        Tile tile = getQsTile();
        if (tile == null) return;
        State state;
        try { state = readState(this); }
        catch (Exception failure) { state = new State("", ""); }
        if (displayedState != null && displayedState.matches(state)) return;
        displayedState = state;
        String phase = state.phase;
        int subtitle;
        switch (phase) {
            case "idle": subtitle = R.string.recording_tile_start; break;
            case "recording": subtitle = R.string.recording_tile_pause; break;
            case "paused": subtitle = R.string.recording_tile_resume; break;
            case "finished": subtitle = R.string.recording_tile_save; break;
            default: subtitle = R.string.recording_tile_unavailable; break;
        }
        if ("recording".equals(phase)) tile.setState(Tile.STATE_ACTIVE);
        else tile.setState(phase.isEmpty() ? Tile.STATE_UNAVAILABLE : Tile.STATE_INACTIVE);
        String label = getString(R.string.recording_tile_label);
        tile.setLabel(label);
        tile.setIcon(Icon.createWithResource(this, R.drawable.ic_recording_tile));
        if (Build.VERSION.SDK_INT >= 29) tile.setSubtitle(getString(subtitle));
        tile.setContentDescription(getString(R.string.recording_tile_description, label, getString(subtitle)));
        tile.updateTile();
    }

    static State readState(Context context) throws Exception {
        synchronized (RecordingStore.class) {
            JSONObject current = RecordingStore.load(context);
            return new State(current.getString("phase"), current.optString("id"));
        }
    }

    static void launchFinished() {
        launchUntil = 0L;
        nextTapAt = SystemClock.elapsedRealtime() + TAP_DEBOUNCE_MS;
    }

    static void notifyUser(Context context, int message) {
        Toast.makeText(context, message, Toast.LENGTH_SHORT).show();
    }

    static final class State {
        final String phase;
        final String id;

        State(String phase, String id) {
            this.phase = phase;
            this.id = id;
        }

        boolean matches(State current) {
            return phase.equals(current.phase) && id.equals(current.id);
        }
    }
}
