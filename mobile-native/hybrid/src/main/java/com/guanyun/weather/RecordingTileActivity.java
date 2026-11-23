package com.guanyun.weather;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.location.LocationManager;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.Gravity;
import android.widget.FrameLayout;
import android.widget.TextView;

import androidx.core.location.LocationManagerCompat;

import com.shantu.nativeapp.R;

/** A short-lived visible Activity enables the while-in-use location grant for the service. */
public final class RecordingTileActivity extends Activity {
    private static final int REQUEST_LOCATION = 124;
    private static final long START_CONFIRMATION_MS = 2_500L;

    private RecordingTileService.State expected;
    private TextView status;
    private boolean requestingPermission;
    private long startDeadline;
    private final Runnable begin = this::beginWhenVisible;
    private final Runnable confirm = this::confirmStarted;

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        String phase = getIntent().getStringExtra(RecordingTileService.EXTRA_EXPECTED_PHASE);
        String id = getIntent().getStringExtra(RecordingService.EXPECTED_RECORDING_ID);
        if (id == null || !("idle".equals(phase) || "paused".equals(phase))) {
            close(0);
            return;
        }
        expected = new RecordingTileService.State(phase, id);
        if (savedInstanceState != null) {
            requestingPermission = savedInstanceState.getBoolean("requestingPermission");
            startDeadline = savedInstanceState.getLong("startDeadline");
        }

        FrameLayout root = new FrameLayout(this);
        status = new TextView(this);
        status.setText(R.string.recording_tile_wait);
        status.setTextColor(Color.WHITE);
        status.setTextSize(14);
        status.setPadding(dp(16), dp(10), dp(16), dp(10));
        GradientDrawable background = new GradientDrawable();
        background.setColor(0xff202520);
        background.setCornerRadius(dp(8));
        status.setBackground(background);
        root.addView(status, new FrameLayout.LayoutParams(-2, -2, Gravity.CENTER));
        setContentView(root);
        if (startDeadline != 0L) status.post(confirm);
    }

    @Override protected void onSaveInstanceState(Bundle outState) {
        outState.putBoolean("requestingPermission", requestingPermission);
        outState.putLong("startDeadline", startDeadline);
        super.onSaveInstanceState(outState);
    }

    @Override public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && status != null) status.postOnAnimation(begin);
    }

    private void beginWhenVisible() {
        if (isFinishing() || !hasWindowFocus() || requestingPermission || startDeadline != 0L) return;
        try {
            if (!expected.matches(RecordingTileService.readState(this))) {
                close(R.string.recording_tile_changed);
                return;
            }
            LocationManager location = getSystemService(LocationManager.class);
            if (location == null || !LocationManagerCompat.isLocationEnabled(location)
                || !(location.isProviderEnabled(LocationManager.GPS_PROVIDER)
                    || location.isProviderEnabled(LocationManager.NETWORK_PROVIDER))) {
                close(R.string.recording_tile_location_off);
                return;
            }
            if (!hasFineLocation()) {
                requestingPermission = true;
                requestPermissions(new String[] {
                    Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION
                }, REQUEST_LOCATION);
                return;
            }
            // Keep this window visible until the existing service confirms it changed phase.
            String action = "idle".equals(expected.phase) ? "start" : "resume";
            startForegroundService(new Intent(this, RecordingService.class).setAction(action)
                .putExtra(RecordingService.EXPECTED_RECORDING_ID, expected.id));
            startDeadline = SystemClock.elapsedRealtime() + START_CONFIRMATION_MS;
            status.postDelayed(confirm, 100L);
        } catch (Exception failure) {
            close(R.string.recording_tile_failed);
        }
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode != REQUEST_LOCATION) return;
        requestingPermission = false;
        if (!hasFineLocation()) close(R.string.recording_tile_fine_location);
        else status.postOnAnimation(begin);
    }

    private void confirmStarted() {
        try {
            if ("recording".equals(RecordingTileService.readState(this).phase)) {
                FloatingRecordingCoordinator.refresh();
                close(0);
                return;
            }
        } catch (Exception failure) {
            close(R.string.recording_tile_unavailable);
            return;
        }
        if (SystemClock.elapsedRealtime() >= startDeadline) close(R.string.recording_tile_failed);
        else status.postDelayed(confirm, 100L);
    }

    private boolean hasFineLocation() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void close(int message) {
        if (message != 0) RecordingTileService.notifyUser(this, message);
        finishAndRemoveTask();
    }

    @Override protected void onDestroy() {
        if (status != null) {
            status.removeCallbacks(begin);
            status.removeCallbacks(confirm);
        }
        if (isFinishing()) RecordingTileService.launchFinished();
        super.onDestroy();
    }
}
