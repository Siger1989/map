package com.guanyun.weather;

/** UI callbacks publish state; JavaScript bridge threads must never query WebView. */
final class BridgePageState {
    private static final String START = "https://appassets.androidplatform.net/index.html";
    private volatile boolean foreground;
    private volatile boolean trusted;

    void page(String url) {
        trusted = url != null && (url.equals(START) || url.startsWith(START + "?") || url.startsWith(START + "#"));
    }

    void foreground(boolean value) { foreground = value; }

    boolean trustedForeground() { return foreground && trusted; }
}
