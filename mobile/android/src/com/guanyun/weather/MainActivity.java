package com.guanyun.weather;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowInsets;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

/** A bundled client, with a narrow local recording and document bridge. */
public final class MainActivity extends Activity {
    private WebView webView;
    private LocationPermissions locationPermissions;
    private AppFiles appFiles;
    private NativeBridge nativeBridge;
    private boolean foreground;
    boolean trustedForeground() { return foreground && webView != null && webView.getUrl() != null && webView.getUrl().startsWith(START); }
    private static final String START = "https://appassets.androidplatform.net/index.html";

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(16, 33, 43));
        if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                root.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                // The native root already keeps content clear of bars/cutouts.
                // Do not apply the same inset again inside the WebView's CSS.
                return WindowInsets.CONSUMED;
            }
            return insets;
        });
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(16, 33, 43));
        WebSettings settings = webView.getSettings();
        settings.setUserAgentString(settings.getUserAgentString() + " Guanyun/0.2.1");
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setSupportZoom(false); // The map, not the whole document, handles pinch gestures.
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setGeolocationEnabled(true);
        appFiles = new AppFiles(this);
        nativeBridge = new NativeBridge(this, appFiles);
        webView.addJavascriptInterface(nativeBridge, "GuanyunNative");
        locationPermissions = new LocationPermissions(this, appFiles);
        webView.setWebChromeClient(locationPermissions);
        final LocalGateway gateway = new LocalGateway(getApplicationContext());
        webView.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return gateway.intercept(request.getUrl(), request.getMethod());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("https".equals(uri.getScheme()) && LocalGateway.HOST.equals(uri.getHost())) return false;
                if (request.isForMainFrame() && ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme()))) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) { }
                }
                return true;
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showStartupError();
            }
        });
        root.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        root.requestApplyInsets();
        android.content.pm.PackageInfo webPackage = WebView.getCurrentWebViewPackage();
        try {
            if (webPackage != null && Integer.parseInt(webPackage.versionName.split("\\.")[0]) < 120) {
                webView.loadDataWithBaseURL(START, "<meta name='viewport' content='width=device-width,initial-scale=1'><body style='background:#10212b;color:#eff6f7;padding:24px;font:18px sans-serif'><h2>需要更新系统网页组件</h2><p>请更新 Android System WebView 或 Chrome 后重新打开观云。三维地图需要 WebGL 2 和较新的网页组件。</p></body>", "text/html", "UTF-8", null);
                return;
            }
        } catch (RuntimeException ignored) { }
        webView.loadUrl(START);
    }

    private void showStartupError() {
        webView.loadDataWithBaseURL(START, "<meta name='viewport' content='width=device-width,initial-scale=1'><body style='background:#10212b;color:#eff6f7;padding:24px;font:18px sans-serif'><h2>界面暂未打开</h2><p>请重新打开应用；联网数据加载失败时可稍后刷新。</p><a style='color:#9de8c4' href='/index.html'>重新打开</a></body>", "text/html", "UTF-8", null);
    }

    @Override public void onBackPressed() {
        webView.evaluateJavascript("(function(){var p=document.querySelector('.control-dock.is-expanded')||document.querySelector('.observatory[data-section=\"true\"],.observatory[data-editing-track=\"true\"],.observatory[data-picking-route=\"true\"],.observatory[data-placing-annotation=\"true\"]');if(!p)return false;p.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return true;})()", result -> {
            if (!"true".equals(result)) MainActivity.super.onBackPressed();
        });
    }
    @Override protected void onPause() { foreground = false; webView.onPause(); webView.pauseTimers(); super.onPause(); }
    @Override protected void onResume() { super.onResume(); foreground = true; if (webView != null) { webView.resumeTimers(); webView.onResume(); } }
    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == NativeBridge.REQUEST && nativeBridge != null) nativeBridge.resolve();
        if (requestCode == LocationPermissions.REQUEST && locationPermissions != null) locationPermissions.resolve();
    }
    @Override protected void onActivityResult(int request, int result, Intent data) { super.onActivityResult(request,result,data); if(appFiles!=null)appFiles.result(request,result,data); }
    @Override protected void onDestroy() { if(appFiles!=null)appFiles.close(); if (locationPermissions != null) locationPermissions.cancel(); if (webView != null) webView.destroy(); super.onDestroy(); }
}
