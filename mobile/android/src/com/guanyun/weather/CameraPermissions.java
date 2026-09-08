package com.guanyun.weather;

import android.Manifest;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.webkit.PermissionRequest;

/** Camera only, for an explicit scanner request from the bundled foreground app. */
final class CameraPermissions {
    static final int REQUEST = 4106;
    private final MainActivity activity;
    private PermissionRequest pending;
    private boolean permissionPending;
    CameraPermissions(MainActivity activity) { this.activity = activity; }
    void request(PermissionRequest request) {
        Uri origin = request.getOrigin();
        boolean camera = false;
        for (String resource : request.getResources()) if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) camera = true;
        if (!camera || !activity.trustedForeground() || !"https".equals(origin.getScheme()) || !LocalGateway.HOST.equals(origin.getHost()) || (origin.getPort() != -1 && origin.getPort() != 443)) { request.deny(); return; }
        cancel(); pending = request;
        if (allowed()) resolve();
        else { permissionPending = true; activity.requestPermissions(new String[] {Manifest.permission.CAMERA}, REQUEST); }
    }
    private boolean allowed() { return activity.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED; }
    void resolve() {
        permissionPending = false;
        if (pending == null) return;
        if (allowed() && !activity.trustedForeground()) return;
        PermissionRequest request = pending; pending = null;
        if (allowed() && activity.trustedForeground()) request.grant(new String[] {PermissionRequest.RESOURCE_VIDEO_CAPTURE});
        else request.deny();
    }
    void resume() { if (!permissionPending && pending != null) resolve(); }
    void canceled(PermissionRequest request) { if (pending == request) pending = null; }
    void cancel() { if (pending != null) { pending.deny(); pending = null; } }
}
