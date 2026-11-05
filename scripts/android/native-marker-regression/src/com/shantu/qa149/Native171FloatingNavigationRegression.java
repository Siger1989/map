package com.shantu.qa149;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Rect;
import android.os.SystemClock;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.List;
import java.util.UUID;

/** Real-UI and cross-app lifecycle probe for the optional floating navigation window. */
public final class Native171FloatingNavigationRegression {
    private static final String CONTROLS = ".floating-navigation-controls";
    private final Native149Instrumentation parent;
    private final JSONObject report = new JSONObject();
    private final JSONArray steps = new JSONArray();
    private final JSONArray screenshots = new JSONArray();
    private final String runId = UUID.randomUUID().toString();
    private WebView webView;
    private File evidenceDirectory;
    private float cssScale = 1f;
    private float density = 1f;
    private String failedStage = "setup";
    private boolean fullyVerified;
    private boolean appInBackground;

    private Native171FloatingNavigationRegression(Native149Instrumentation parent) { this.parent = parent; }

    public static JSONObject run(Native149Instrumentation parent) { return new Native171FloatingNavigationRegression(parent).run(); }

    private JSONObject run() {
        try {
            if (parent == null) throw new IllegalArgumentException("parent instrumentation required");
            webView = (WebView)field(parent, "webView");
            cssScale = ((Number)invoke(parent, "viewportScale")).floatValue();
            density = parent.getTargetContext().getResources().getDisplayMetrics().density;
            initializeEvidenceDirectory();
            report.put("mode", "native171-floating-navigation-regression")
                .put("runId", runId).put("steps", steps).put("screenshots", screenshots)
                .put("evidenceDirectory", evidenceDirectory.getAbsolutePath())
                .put("routeContentsRecorded", false).put("otherAppTextRecorded", false);

            failedStage = "foreground-permission-precondition";
            JSONObject precondition = readBridgeStatus();
            report.put("precondition", safeStatus(precondition));
            if (!precondition.optBoolean("available") || !precondition.optBoolean("locationAllowed") ||
                !precondition.optBoolean("overlayAllowed") || !precondition.optBoolean("notificationAllowed")) {
                report.put("testState", "PRECONDITION_BLOCKED");
                report.put("blockedReason", "悬浮导航桥接或定位、通知、悬浮窗权限未全部就绪");
                return report;
            }

            failedStage = "expand-navigation-details";
            if (elementExists(".guidance-card button[aria-label='展开导航详情']")) {
                tapElement(".guidance-card button[aria-label='展开导航详情']");
                waitForVisible(".guidance-card .guidance-content", 3_000L);
            }
            waitForVisible(CONTROLS, 4_000L);
            captureScreenshot("guidance-controls-expanded");
            steps.put(new JSONObject().put("step", "real-navigation-details-expanded").put("status", "PASS"));

            failedStage = "select-north-mode";
            tapElement(CONTROLS + "__modes button:first-child");
            if (!elementExists(CONTROLS + "__modes button:first-child[aria-pressed='true']"))
                throw new IllegalStateException("north mode UI was not selected");
            steps.put(new JSONObject().put("step", "north-mode-selected-by-touch").put("status", "PASS"));

            failedStage = "start-floating-navigation";
            tapButtonByText(CONTROLS + "__action", "开启悬浮");
            JSONObject northStarted = waitBridgeEnabled(true, 8_000L);
            if (!"north".equals(northStarted.optString("mode"))) throw new IllegalStateException("foreground bridge did not report north mode");
            captureScreenshot("foreground-floating-north-enabled");
            steps.put(new JSONObject().put("step", "floating-navigation-started-from-real-ui-tap")
                .put("status", "PASS").put("enabled", true).put("mode", "north"));

            failedStage = "background-north-overlay";
            goHome();
            JSONObject northBackground = waitServiceState(true, true, "north", 8_000L);
            OverlayWindow northWindow = waitForOverlayWindow(6_000L);
            if (northWindow == null) northWindow = overlayWindowFromStatus(northBackground);
            if (northWindow == null) {
                steps.put(new JSONObject().put("step", "background-north-overlay-visible").put("status", "UNVERIFIED")
                    .put("serviceStatus", safeStatus(northBackground)).put("reason", "未能从AccessibilityWindowInfo取得悬浮窗边界"));
                captureScreenshot("background-north-overlay-window-unverified");
                return finishUnverified("系统未提供可用于验证实际悬浮窗点击的窗口边界");
            }
            captureScreenshot("background-north-overlay-visible");
            steps.put(new JSONObject().put("step", "background-north-overlay-visible").put("status", "PASS")
                .put("serviceStatus", safeStatus(northBackground)).put("window", northWindow.toJson()));

            failedStage = "return-app-hides-overlay";
            returnToApp();
            JSONObject hidden = waitServiceState(true, false, "north", 8_000L);
            if (!waitForNoOverlayWindow(4_000L)) throw new IllegalStateException("floating window remained visible over the foreground app");
            captureScreenshot("foreground-overlay-hidden");
            steps.put(new JSONObject().put("step", "return-to-app-hides-overlay").put("status", "PASS")
                .put("serviceStatus", safeStatus(hidden)));

            failedStage = "switch-motion-mode";
            waitBridgeEnabled(true, 4_000L);
            tapElement(CONTROLS + "__modes button:last-child");
            waitBridgeMode("motion", 4_000L);
            JSONObject motionForeground = waitServiceState(true, false, "motion", 5_000L);
            steps.put(new JSONObject().put("step", "motion-mode-selected-and-updated").put("status", "PASS")
                .put("serviceStatus", safeStatus(motionForeground)));

            failedStage = "background-motion-overlay";
            goHome();
            JSONObject motionBackground = waitServiceState(true, true, "motion", 8_000L);
            OverlayWindow motionWindow = waitForOverlayWindow(6_000L);
            if (motionWindow == null) motionWindow = overlayWindowFromStatus(motionBackground);
            if (motionWindow == null) {
                steps.put(new JSONObject().put("step", "background-motion-overlay-visible").put("status", "UNVERIFIED")
                    .put("serviceStatus", safeStatus(motionBackground)).put("reason", "悬浮窗边界不可读"));
                captureScreenshot("background-motion-overlay-window-unverified");
                return finishUnverified("运动朝上状态已切换，但无法安全定位实际悬浮窗关闭按钮");
            }
            captureScreenshot("background-motion-overlay-visible");
            steps.put(new JSONObject().put("step", "background-motion-overlay-visible").put("status", "PASS")
                .put("serviceStatus", safeStatus(motionBackground)).put("window", motionWindow.toJson()));

            failedStage = "close-floating-window-by-touch";
            tapOverlayClose(motionWindow);
            JSONObject stopped = waitServiceState(false, false, null, 8_000L);
            captureScreenshot("background-overlay-closed");
            steps.put(new JSONObject().put("step", "overlay-close-control-real-touch").put("status", "PASS")
                .put("serviceStatus", safeStatus(stopped)).put("touchTarget", "actual-window-close-glyph"));

            failedStage = "guidance-remains-active";
            returnToApp();
            JSONObject guidance = waitGuidanceActive(6_000L);
            captureScreenshot("foreground-guidance-remains-active");
            steps.put(new JSONObject().put("step", "closing-floating-window-preserves-main-guidance")
                .put("status", "PASS").put("guidance", guidance));
            fullyVerified = true;
            report.put("testState", "PASS").put("enabledBeforeClose", true).put("enabledAfterClose", false)
                .put("mainGuidancePreserved", true);
        } catch (Throwable error) {
            try {
                String state = error instanceof StatusUnavailableException ? "UNVERIFIED" : "ERROR";
                report.put("testState", state).put("failedStage", failedStage)
                    .put("errorType", error.getClass().getSimpleName());
                if (error instanceof StatusUnavailableException) report.put("unverifiedReason", "后台无法读取服务状态方法；未推断悬浮窗成功");
            } catch (JSONException ignored) { }
            try {
                steps.put(new JSONObject().put("step", failedStage)
                    .put("status", error instanceof StatusUnavailableException ? "UNVERIFIED" : "FAIL")
                    .put("errorType", error.getClass().getSimpleName()));
            } catch (JSONException ignored) { }
            if (appInBackground) {
                try { returnToApp(); report.put("foregroundRestoredAfterFailure", true); }
                catch (Throwable restoreError) { try { report.put("foregroundRestoredAfterFailure", false); } catch (JSONException ignored) { } }
            }
        }
        if (!fullyVerified && !report.has("testState")) {
            try { report.put("testState", "UNVERIFIED"); } catch (JSONException ignored) { }
        }
        return report;
    }

    private JSONObject readBridgeStatus() throws Exception {
        String raw = evalJs("(()=>{const b=window.ShantuFloatingNavigation;if(!b)return JSON.stringify({available:false});try{return JSON.stringify(JSON.parse(b.status()))}catch(_){return JSON.stringify({available:false})}})()");
        return new JSONObject(raw);
    }

    private JSONObject waitBridgeEnabled(boolean expected, long timeoutMs) throws Exception {
        long until = SystemClock.elapsedRealtime() + timeoutMs;
        JSONObject last = new JSONObject();
        while (SystemClock.elapsedRealtime() < until) {
            last = readBridgeStatus();
            if (last.optBoolean("enabled") == expected) return last;
            SystemClock.sleep(100L);
        }
        throw new IllegalStateException("foreground floating-navigation enabled state timed out");
    }

    private JSONObject waitBridgeMode(String mode, long timeoutMs) throws Exception {
        long until = SystemClock.elapsedRealtime() + timeoutMs;
        JSONObject last = new JSONObject();
        while (SystemClock.elapsedRealtime() < until) {
            last = readBridgeStatus();
            if (mode.equals(last.optString("mode"))) return last;
            SystemClock.sleep(100L);
        }
        throw new IllegalStateException("foreground bridge did not report requested mode");
    }

    private JSONObject waitServiceState(boolean enabled, boolean visible, String mode, long timeoutMs) throws Exception {
        long until = SystemClock.elapsedRealtime() + timeoutMs;
        JSONObject last = new JSONObject();
        while (SystemClock.elapsedRealtime() < until) {
            last = serviceStatus();
            if (last.optBoolean("enabled") == enabled && last.optBoolean("visible") == visible &&
                (mode == null || mode.equals(last.optString("mode")))) return last;
            SystemClock.sleep(120L);
        }
        throw new IllegalStateException("service status did not reach expected enabled/visible/mode state");
    }

    private JSONObject serviceStatus() throws Exception {
        // Background WebView bridge access is deliberately avoided because its
        // trust gate correctly rejects an app that is not foregrounded. Root
        // keeps this public QA status method through R8 for this regression.
        Object value;
        try {
            Class<?> service = Class.forName("com.shantu.nativeapp.floating.FloatingNavigationService", false,
                parent.getTargetContext().getClassLoader());
            Field companionField = service.getDeclaredField("Companion");
            companionField.setAccessible(true);
            Object companion = companionField.get(null);
            Method status = companion.getClass().getDeclaredMethod("status");
            status.setAccessible(true);
            value = status.invoke(companion);
        } catch (Throwable unavailable) { throw new StatusUnavailableException(); }
        if (!(value instanceof JSONObject)) throw new StatusUnavailableException();
        JSONObject raw = (JSONObject)value;
        // Keep only the documented status contract; never read route data.
        JSONObject safe = new JSONObject().put("enabled", raw.optBoolean("enabled"))
            .put("visible", raw.optBoolean("visible")).put("mode", raw.optString("mode"))
            .put("message", raw.optString("message"));
        JSONObject bounds = raw.optJSONObject("windowBounds");
        if (bounds != null) safe.put("windowBounds", new JSONObject().put("x", bounds.optInt("x"))
            .put("y", bounds.optInt("y")).put("width", bounds.optInt("width")).put("height", bounds.optInt("height")));
        return safe;
    }

    private JSONObject waitGuidanceActive(long timeoutMs) throws Exception {
        long until = SystemClock.elapsedRealtime() + timeoutMs;
        while (SystemClock.elapsedRealtime() < until) {
            JSONObject state = (JSONObject)invoke(parent, "readState");
            JSONObject cues = state.optJSONObject("navigationCues");
            String cueKind = cues == null ? "" : cues.optString("kind");
            JSONObject guidanceOverlay = state.optJSONObject("guidanceOverlay");
            JSONArray routeCoordinates = guidanceOverlay == null ? null : guidanceOverlay.optJSONArray("coordinates");
            boolean rejoinOverlay = routeCoordinates != null && guidanceOverlay.opt("target") != null && guidanceOverlay.opt("target") != JSONObject.NULL;
            boolean navigating = state.optBoolean("positionNavigating") || rejoinOverlay ||
                "rejoin".equals(cueKind) || ("route".equals(cueKind) && state.optBoolean("positionNavigating"));
            boolean card = jsBoolean("(()=>{const e=document.querySelector('.guidance-card');if(!e)return false;const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0})()");
            if (navigating || card) return new JSONObject().put("active", true).put("cardVisible", card)
                .put("positionNavigating", state.optBoolean("positionNavigating"));
            SystemClock.sleep(120L);
        }
        throw new IllegalStateException("main guidance was not active after closing the floating window");
    }

    private void goHome() throws Exception {
        if (!parent.getUiAutomation().performGlobalAction(AccessibilityService.GLOBAL_ACTION_HOME))
            throw new IllegalStateException("HOME action failed");
        appInBackground = true;
        SystemClock.sleep(800L);
    }

    private void returnToApp() throws Exception {
        Intent launch = parent.getTargetContext().getPackageManager()
            .getLaunchIntentForPackage(parent.getTargetContext().getPackageName());
        if (launch == null) throw new IllegalStateException("target app launcher activity unavailable");
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        parent.runOnMainSync(() -> parent.getTargetContext().startActivity(launch));
        long until = SystemClock.elapsedRealtime() + 8_000L;
        while (SystemClock.elapsedRealtime() < until) {
            JSONObject status = readBridgeStatus();
            if (status.optBoolean("available")) { appInBackground = false; return; }
            SystemClock.sleep(120L);
        }
        throw new IllegalStateException("target app did not return to a trusted foreground page");
    }

    private OverlayWindow waitForOverlayWindow(long timeoutMs) throws Exception {
        long until = SystemClock.elapsedRealtime() + timeoutMs;
        while (SystemClock.elapsedRealtime() < until) {
            OverlayWindow found = findOverlayWindow();
            if (found != null) return found;
            SystemClock.sleep(160L);
        }
        return null;
    }

    private boolean waitForNoOverlayWindow(long timeoutMs) throws Exception {
        long until = SystemClock.elapsedRealtime() + timeoutMs;
        while (SystemClock.elapsedRealtime() < until) {
            if (findOverlayWindow() == null) return true;
            SystemClock.sleep(160L);
        }
        return false;
    }

    private OverlayWindow findOverlayWindow() {
        List<AccessibilityWindowInfo> windows = parent.getUiAutomation().getWindows();
        float expectedW = 184f * density, expectedH = 216f * density;
        for (AccessibilityWindowInfo window : windows) {
            AccessibilityNodeInfo root = null;
            try {
                root = window.getRoot();
                if (root == null) continue;
                CharSequence packageName = root.getPackageName();
                if (packageName == null || !parent.getTargetContext().getPackageName().contentEquals(packageName)) continue;
                Rect bounds = new Rect();
                root.getBoundsInScreen(bounds);
                if (Math.abs(bounds.width() - expectedW) > 34f * density || Math.abs(bounds.height() - expectedH) > 34f * density) continue;
                return new OverlayWindow(new Rect(bounds), window.getType(), density);
            } catch (Throwable ignored) {
                // Window contents can disappear during task transitions.
            } finally {
                if (root != null) root.recycle();
                try { window.recycle(); } catch (Throwable ignored) { }
            }
        }
        return null;
    }

    private void tapOverlayClose(OverlayWindow window) throws Exception {
        float x = window.bounds.right - 14f * window.density;
        float y = window.bounds.top + 21f * window.density;
        invoke(parent, "tap", x, y);
    }

    private void waitForVisible(String selector, long timeoutMs) throws Exception {
        long until = SystemClock.elapsedRealtime() + timeoutMs;
        while (SystemClock.elapsedRealtime() < until) {
            if (elementVisible(selector)) return;
            SystemClock.sleep(80L);
        }
        throw new IllegalStateException("expected UI element did not become visible");
    }

    private boolean elementExists(String selector) throws Exception {
        return jsBoolean("!!document.querySelector(" + JSONObject.quote(selector) + ")");
    }

    private boolean elementVisible(String selector) throws Exception {
        return jsBoolean("(()=>{const e=document.querySelector(" + JSONObject.quote(selector) + ");if(!e)return false;const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)!==0&&r.width>0&&r.height>0})()");
    }

    private void tapButtonByText(String selector, String text) throws Exception {
        String q = JSONObject.quote(text);
        String root = "document.querySelector(" + JSONObject.quote(selector) + ")";
        String match = "(()=>{const r=" + root + ";if(!r)return null;const a=r.matches('button')?[r]:Array.from(r.querySelectorAll('button'));return a.find(e=>e.textContent.trim().includes(" + q + "))})()";
        tapElementExpression(match);
    }

    private void tapElement(String selector) throws Exception {
        tapElementExpression("document.querySelector(" + JSONObject.quote(selector) + ")");
    }

    private void tapElementExpression(String expression) throws Exception {
        ensureVisibleByGesture(expression);
        JSONObject point = new JSONObject(jsString("(()=>{const e=" + expression + ";if(!e)return JSON.stringify({found:false});const r=e.getBoundingClientRect(),h=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return JSON.stringify({found:true,x:r.left+r.width/2,y:r.top+r.height/2,hit:h===e||e.contains(h)})})()"));
        if (!point.optBoolean("found") || !point.optBoolean("hit")) throw new IllegalStateException("real UI touch target unavailable");
        tapCss((float)point.getDouble("x"), (float)point.getDouble("y"));
    }

    private void ensureVisibleByGesture(String expression) throws Exception {
        String qContainer = JSONObject.quote(".guidance-card .guidance-content");
        for (int attempt = 0; attempt < 6; attempt++) {
            JSONObject p = new JSONObject(jsString("(()=>{const e=" + expression + ",c=document.querySelector(" + qContainer + ");if(!e)return JSON.stringify({found:false});const r=e.getBoundingClientRect(),cr=c?.getBoundingClientRect(),h=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return JSON.stringify({found:true,x:r.left+r.width/2,y:r.top+r.height/2,top:r.top,bottom:r.bottom,insideContent:!!c&&c.contains(e),containerTop:cr?.top,containerBottom:cr?.bottom,hit:!!h&&(h===e||e.contains(h)||h.closest('button')===e),scrollable:!!c&&c.scrollHeight>c.clientHeight+1})})()"));
            if (!p.optBoolean("found")) throw new IllegalStateException("UI control is missing");
            boolean within = p.optDouble("top") >= p.optDouble("containerTop") && p.optDouble("bottom") <= p.optDouble("containerBottom");
            if ((!p.optBoolean("insideContent") || within) && p.optBoolean("hit")) return;
            if (!p.optBoolean("scrollable")) throw new IllegalStateException("UI control is not reachable in the navigation details panel");
            boolean down = p.optDouble("bottom") > p.optDouble("containerBottom");
            float x = (float)p.optDouble("x");
            float containerTop = (float)p.optDouble("containerTop");
            float containerBottom = (float)p.optDouble("containerBottom");
            float startY = down ? containerBottom - 18f : containerTop + 18f;
            float endY = down ? containerTop + 24f : containerBottom - 24f;
            swipeCss(x, startY, x, endY, 220L);
            SystemClock.sleep(100L);
        }
        throw new IllegalStateException("UI control did not become reachable after scrolling details");
    }

    private void tapCss(float x, float y) throws Exception {
        int[] origin = new int[2];
        parent.runOnMainSync(() -> webView.getLocationOnScreen(origin));
        invoke(parent, "tap", origin[0] + x * cssScale, origin[1] + y * cssScale);
    }

    private void swipeCss(float x1, float y1, float x2, float y2, long durationMs) throws Exception {
        int[] origin = new int[2];
        parent.runOnMainSync(() -> webView.getLocationOnScreen(origin));
        long down = android.os.SystemClock.uptimeMillis();
        int count = Math.max(4, (int)(durationMs / 40));
        injectMotion(android.view.MotionEvent.ACTION_DOWN, down, down,
            origin[0] + x1 * cssScale, origin[1] + y1 * cssScale);
        for (int i = 1; i <= count; i++) {
            SystemClock.sleep(Math.max(1L, durationMs / count));
            float f = i / (float)count;
            injectMotion(android.view.MotionEvent.ACTION_MOVE, down, android.os.SystemClock.uptimeMillis(),
                origin[0] + (x1 + (x2 - x1) * f) * cssScale, origin[1] + (y1 + (y2 - y1) * f) * cssScale);
        }
        injectMotion(android.view.MotionEvent.ACTION_UP, down, android.os.SystemClock.uptimeMillis(),
            origin[0] + x2 * cssScale, origin[1] + y2 * cssScale);
    }

    private void injectMotion(int action, long downTime, long eventTime, float x, float y) {
        android.view.MotionEvent event = android.view.MotionEvent.obtain(downTime, eventTime, action, x, y, 0);
        event.setSource(android.view.InputDevice.SOURCE_TOUCHSCREEN);
        parent.sendPointerSync(event);
        event.recycle();
    }

    private String jsString(String expression) throws Exception {
        return String.valueOf(invoke(parent, "evalJs", expression));
    }

    private boolean jsBoolean(String expression) throws Exception { return "true".equals(jsString(expression)); }

    private String evalJs(String expression) throws Exception { return jsString(expression); }

    private void captureScreenshot(String name) throws Exception {
        SystemClock.sleep(500L);
        Bitmap image = parent.getUiAutomation().takeScreenshot();
        if (image == null) throw new IllegalStateException("UiAutomation screenshot returned null");
        File file = new File(evidenceDirectory, name + ".png").getCanonicalFile();
        if (!evidenceDirectory.equals(file.getParentFile())) { image.recycle(); throw new IllegalStateException("screenshot path escaped QA directory"); }
        try (FileOutputStream out = new FileOutputStream(file, false)) {
            if (!image.compress(Bitmap.CompressFormat.PNG, 100, out)) throw new IllegalStateException("screenshot encoding failed");
            out.flush();
        } finally { image.recycle(); }
        screenshots.put(new JSONObject().put("name", name).put("path", file.getAbsolutePath()));
    }

    private void initializeEvidenceDirectory() throws Exception {
        File base = parent.getTargetContext().getExternalFilesDir(null);
        if (base == null) throw new IllegalStateException("private screenshot storage unavailable");
        File canonicalBase = base.getCanonicalFile();
        evidenceDirectory = new File(canonicalBase, "Pictures/native171-floating/" + runId).getCanonicalFile();
        if (!evidenceDirectory.toPath().startsWith(canonicalBase.toPath())) throw new IllegalStateException("QA evidence path escaped app storage");
        if (!evidenceDirectory.mkdirs() && !evidenceDirectory.isDirectory()) throw new IllegalStateException("QA evidence directory could not be created");
    }

    private JSONObject safeStatus(JSONObject status) throws JSONException {
        return new JSONObject().put("available", status.optBoolean("available"))
            .put("enabled", status.optBoolean("enabled")).put("visible", status.optBoolean("visible"))
            .put("mode", status.optString("mode")).put("message", status.optString("message"))
            .put("locationAllowed", status.optBoolean("locationAllowed"))
            .put("overlayAllowed", status.optBoolean("overlayAllowed"))
            .put("notificationAllowed", status.optBoolean("notificationAllowed"));
    }

    private JSONObject finishUnverified(String reason) throws JSONException {
        report.put("testState", "UNVERIFIED").put("unverifiedReason", reason).put("mainGuidancePreserved", "not yet checked");
        if (appInBackground) {
            try { returnToApp(); report.put("foregroundRestored", true); }
            catch (Exception ignored) { report.put("foregroundRestored", false); }
        }
        return report;
    }

    private OverlayWindow overlayWindowFromStatus(JSONObject status) {
        JSONObject bounds = status.optJSONObject("windowBounds");
        if (bounds == null) return null;
        int x = bounds.optInt("x"), y = bounds.optInt("y"), width = bounds.optInt("width"), height = bounds.optInt("height");
        if (width < 120 * density || height < 140 * density || width > 260 * density || height > 300 * density) return null;
        return new OverlayWindow(new Rect(x, y, x + width, y + height), -1, density);
    }

    private static Object invoke(Object owner, String name, Object... args) throws Exception {
        for (Class<?> type = owner.getClass(); type != null; type = type.getSuperclass()) {
            for (Method method : type.getDeclaredMethods()) {
                if (!method.getName().equals(name) || method.getParameterTypes().length != args.length) continue;
                Class<?>[] types = method.getParameterTypes();
                boolean compatible = true;
                for (int i = 0; i < types.length; i++) if (!isCompatible(types[i], args[i])) { compatible = false; break; }
                if (!compatible) continue;
                method.setAccessible(true);
                try { return method.invoke(owner, args); }
                catch (java.lang.reflect.InvocationTargetException error) {
                    Throwable cause = error.getCause();
                    if (cause instanceof Exception) throw (Exception)cause;
                    if (cause instanceof Error) throw (Error)cause;
                    throw error;
                }
            }
        }
        throw new NoSuchMethodException(owner.getClass().getName() + "." + name);
    }

    private static boolean isCompatible(Class<?> type, Object value) {
        if (value == null) return !type.isPrimitive();
        if (type.isInstance(value)) return true;
        return (type == float.class && value instanceof Float) || (type == double.class && value instanceof Double) ||
            (type == int.class && value instanceof Integer) || (type == long.class && value instanceof Long) ||
            (type == boolean.class && value instanceof Boolean);
    }

    private static Object field(Object owner, String name) throws Exception {
        for (Class<?> type = owner.getClass(); type != null; type = type.getSuperclass()) {
            try { Field field = type.getDeclaredField(name); field.setAccessible(true); return field.get(owner); }
            catch (NoSuchFieldException ignored) { }
        }
        throw new NoSuchFieldException(owner.getClass().getName() + "." + name);
    }

    private static final class OverlayWindow {
        final Rect bounds;
        final int type;
        final float density;
        OverlayWindow(Rect bounds, int type, float density) { this.bounds = bounds; this.type = type; this.density = density; }
        JSONObject toJson() throws JSONException {
            return new JSONObject().put("x", bounds.left).put("y", bounds.top).put("width", bounds.width())
                .put("height", bounds.height()).put("windowType", type)
                .put("expectedWidthDp", 184).put("expectedHeightDp", 216);
        }
    }

    private static final class StatusUnavailableException extends Exception { }
}
