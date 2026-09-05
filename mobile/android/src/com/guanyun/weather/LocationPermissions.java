package com.guanyun.weather;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.webkit.GeolocationPermissions;
import android.webkit.WebChromeClient;

/** Location is requested only for the bundled HTTPS app after its Locate button. */
final class LocationPermissions extends WebChromeClient {
    static final int REQUEST = 4101;
    private final Activity activity;
    private GeolocationPermissions.Callback pending;
    private String origin;
    LocationPermissions(Activity activity) { this.activity = activity; }
    @Override public void onGeolocationPermissionsShowPrompt(String value, GeolocationPermissions.Callback callback) {
        Uri uri = Uri.parse(value);
        if (!"https".equals(uri.getScheme()) || !LocalGateway.HOST.equals(uri.getHost()) || (uri.getPort() != -1 && uri.getPort() != 443)) { callback.invoke(value, false, false); return; }
        if (allowed()) { callback.invoke(value, true, false); return; }
        cancel(); pending = callback; origin = value;
        activity.requestPermissions(new String[] { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }, REQUEST);
    }
    private boolean allowed() {
        return activity.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED || activity.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }
    void resolve() { if (pending != null) { pending.invoke(origin, allowed(), false); pending = null; origin = null; } }
    void cancel() { if (pending != null) { pending.invoke(origin, false, false); pending = null; origin = null; } }
    @Override public void onGeolocationPermissionsHidePrompt() { cancel(); }
}
