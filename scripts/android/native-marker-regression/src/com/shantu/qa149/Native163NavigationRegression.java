package com.shantu.qa149;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Rect;
import android.os.Bundle;
import android.os.Build;
import android.os.SystemClock;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.WindowInsets;
import android.view.accessibility.AccessibilityWindowInfo;
import android.view.accessibility.AccessibilityNodeInfo;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Real-UI navigation camera-mode regression using one isolated offline QA graph. */
public final class Native163NavigationRegression {
    private static final String FIXTURE_NAME = "offline158-qa.json";
    private static final String DATABASE = "shantu-offline-routing-v1";
    private static final String ROUTING_MODE_KEY = "shantu.routing-mode.v1";
    private static final String SAMPLING_KEY = "shantu.recording-sampling.v1";
    private static final long ROUTE_TIMEOUT_MS = 45_000L;

    private Native163NavigationRegression() { }

    public static JSONObject run(Native149Instrumentation parent) {
        return new Runner(parent).run();
    }

    private static final class Runner {
        private final Native149Instrumentation parent;
        private final JSONObject report = new JSONObject();
        private final JSONArray steps = new JSONArray();
        private final JSONArray screenshots = new JSONArray();
        private File screenshotDirectory;
        private File progressFile;
        private final String runId = UUID.randomUUID().toString().replace("-", "");
        private final String graphId = "qa163-nav-" + UUID.randomUUID().toString().replace("-", "");
        private final String graphName = "QA163 navigation " + runId;
        private Object host;
        private Object entry;
        private WebView webView;
        private Map<?, ?> mapEntries;
        private ClipData originalClipboard;
        private JSONObject originalCamera;
        private JSONObject originalState;
        private JSONObject graphFixture;
        private JSONObject lastNativeOptionScan;
        private int originalUiAutomationFlags;
        private boolean uiAutomationServiceInfoCaptured;
        private boolean nativeSelectPopupObserved;
        private String originalRoutingMode;
        private String originalSamplingRaw;
        private boolean originalSamplingNative;
        private boolean samplingCaptured;
        private boolean originalAutoRecord;
        private boolean samplingTemporarilyChanged;
        private boolean routingModeCaptured;
        private boolean graphWriteAttempted;
        private boolean targetAttached;
        private boolean routePanelOpened;
        private boolean guidanceStarted;
        private boolean clipboardCaptured;
        private boolean cameraCaptured;
        private double cssScale = 1.0;
        private String originalDirection = "";
        private JSONObject originalFollow;
        private int originalTrackCount = -1;
        private String failedStage = "setup";

        Runner(Native149Instrumentation parent) { this.parent = parent; }

        JSONObject run() {
            put("mode", "native163-navigation-camera-regression");
            put("uniqueQaGraph", true);
            put("motionFollowVerified", false);
            try {
                failedStage = "attach";
                if (parent == null) throw new IllegalArgumentException("parent instrumentation required");
                configureUiAutomationAccessibility();
                initializeScreenshotDirectory();
                progress("before-attach");
                boolean existingTargetReused = targetAlreadyAttached(parent);
                if (!existingTargetReused) callParent("attachTarget");
                targetAttached = true;
                progress("after-attach");
                put("existingInteractiveTargetReused", existingTargetReused);
                progress("before-capture-initial-state");
                host = field(parent, "host");
                entry = field(parent, "entry");
                webView = (WebView)field(parent, "webView");
                mapEntries = (Map<?, ?>)field(host, "maps");
                cssScale = ((Number)callParent("viewportScale")).doubleValue();
                originalState = (JSONObject)callParent("readState");
                originalCamera = new JSONObject(((JSONObject)callParent("invokeCameraJson")).toString());
                cameraCaptured = true;
                originalTrackCount = trackCount(originalState);
                originalClipboard = readClipboard();
                clipboardCaptured = true;
                originalDirection = readDirectionMode();
                originalFollow = readFollowButton();
                capturePreferences();
                progress("after-capture-initial-state");
                failedStage = "preflight";
                progress("before-preflight");
                preflight();
                progress("after-preflight");

                failedStage = "prepare-qa-graph";
                graphFixture = readFixture();
                ensureQaIdVacant();
                progress("before-write-qa-graph-fixture");
                seedQaGraph();
                progress("after-write-qa-graph-fixture");
                setRoutingMode("offline");
                if (originalAutoRecord) setAutoRecordThroughUi(false);

                failedStage = "route-panel";
                progress("before-open-route-panel");
                tapButton(".home-bottom-nav", "路线");
                routePanelOpened = true;
                waitForVisible("#map-control-panel .route-panel:not(.route-summary)", 8_000L, "route planner did not open");
                captureScreenshot("route-panel-open");
                chooseCoordinateEndpoint("起点", "52.5201631, 13.4048063");
                chooseCoordinateEndpoint("终点", "52.5205732, 13.4042511");
                progress("after-select-route-coordinate-endpoints");
                failedStage = "route-plan-dismiss-keyboard";
                progress(failedStage);
                dismissImeIfVisible();
                captureScreenshot("route-plan-ready");
                failedStage = "route-plan-button";
                progress(failedStage);
                tapButton("#map-control-panel .route-panel", "规划路线");

                failedStage = "await-native-route";
                JSONObject routeEvidence = awaitNativeRoute();
                report.put("route", routeEvidence);
                steps.put(new JSONObject().put("step", "real-route-ui-coordinate-input-and-plan")
                    .put("bothCoordinateResultsSelectedByTouch", true).put("offlineRouteAndNativePath", true));

                failedStage = "route-style-controls";
                JSONObject styleEvidence = testRouteStyleControls();
                report.put("routeStyleControls", styleEvidence);

                failedStage = "start-guidance";
                tapButton(".route-summary", "开始导航");
                JSONObject startEvidence = awaitGuidanceStart();
                guidanceStarted = true;
                report.put("guidanceStart", startEvidence);

                failedStage = "compact-follow";
                callParent("awaitWebViewDraw");
                JSONObject follow = readFollowStatusInCard();
                JSONObject followEvidence = new JSONObject().put("before", follow).put("status", "RUNNING");
                report.put("compactFollow", followEvidence);
                if (!follow.optBoolean("pressed")) tapFollowStatus(followEvidence);
                JSONObject followAfter = awaitFollowIntent(true, 4_000L, followEvidence);
                followEvidence.put("after", followAfter).put("status", "PASS");
                steps.put(new JSONObject().put("step", "compact-follow-resumed-through-real-touch")
                    .put("alreadyFollowing", follow.optBoolean("pressed"))
                    .put("followPressedAfter", followAfter.optBoolean("pressed")));

                failedStage = "first-person-toggle";
                progress("before-first-person-toggle");
                JSONObject topBefore = firstPersonProbe();
                if (!topBefore.optBoolean("compact") || !topBefore.optBoolean("visible") || topBefore.optBoolean("pressed"))
                    throw new IllegalStateException("compact top-view first-person control precondition failed");
                captureScreenshot("compact-first-person-off-before");
                tapElement(".guidance-card .guidance-first-person");
                JSONObject forward = waitCameraMode("forward", true, 4_000L);
                captureScreenshot("compact-first-person-on");
                tapElement(".guidance-card .guidance-first-person");
                JSONObject top = waitCameraMode("top", false, 4_000L);
                captureScreenshot("compact-first-person-off-after");
                progress("after-first-person-toggle");
                boolean waiting = forward.optBoolean("waiting");
                report.put("firstPerson", new JSONObject().put("topToForwardPressed", forward.optBoolean("pressed"))
                    .put("forwardToTopPressedOff", !top.optBoolean("pressed"))
                    .put("compactControlVisible", topBefore.optBoolean("visible"))
                    .put("positionWaiting", waiting)
                    .put("cameraModeTogglePass", forward.optBoolean("pass") && top.optBoolean("pass"))
                    .put("motionFollowVerified", false));
                steps.put(new JSONObject().put("step", "compact-first-person-on-off")
                    .put("forwardPressed", forward.optBoolean("pressed"))
                    .put("topPressedOff", !top.optBoolean("pressed"))
                    .put("positionWaiting", waiting));

                if ("true".equals(String.valueOf(callParent("evalJs", "Boolean(window.ShantuFloatingNavigation)")))) {
                    failedStage = "floating-navigation";
                    JSONObject floating = Native171FloatingNavigationRegression.run(parent);
                    report.put("floatingNavigation", floating);
                    if (!"PASS".equals(floating.optString("testState")))
                        throw new IllegalStateException("floating-navigation-regression-" + floating.optString("testState"));
                }
                failedStage = "end-guidance-ui";
                endGuidanceThroughUi();
                boolean routeCleared = waitForRouteAndGuidanceClear(8_000L);
                if (!routeCleared) throw new IllegalStateException("navigation route did not clear after real end-navigation action");
                guidanceStarted = false;
                progress("after-end-guidance");
                report.put("endedThroughOriginalUi", true).put("routeAndGuidanceCleared", true);
                put("testState", "PASS");
            } catch (Throwable error) {
                put("testState", error instanceof PreconditionBlocked ? "BLOCKED" : "ERROR");
                put("failedStage", failedStage);
                put("errorType", error.getClass().getSimpleName());
                if (error instanceof PreconditionBlocked) put("blockedReason", ((PreconditionBlocked)error).getMessage());
                else put("error", safeMessage(error));
                put("exceptionEvidence", exceptionEvidence(error));
                if (lastNativeOptionScan != null) put("lastNativeOptionScan", lastNativeOptionScan);
                try { captureScreenshot("failure-" + safeScreenshotStage(failedStage)); }
                catch (Throwable captureError) { put("failureScreenshotErrorType", captureError.getClass().getSimpleName()); }
            } finally {
                progress("before-cleanup");
                JSONObject cleanup = cleanup();
                progress("after-cleanup");
                put("cleanup", cleanup);
                put("cleanupPassed", cleanup.optBoolean("pass"));
                if (!cleanup.optBoolean("pass") && "PASS".equals(report.optString("testState"))) put("testState", "FAIL");
                put("steps", steps);
                put("screenshots", screenshots);
                if (screenshotDirectory != null) put("evidenceDirectory", screenshotDirectory.getAbsolutePath());
            }
            return report;
        }

        private void capturePreferences() throws Exception {
            JSONObject prefs = new JSONObject(domString("(()=>{const mode=localStorage.getItem(" + JSONObject.quote(ROUTING_MODE_KEY) + ");const bridge=window.GuanyunNative;const nativeSampling=!!bridge?.recordingSampling;const sampling=nativeSampling?bridge.recordingSampling():localStorage.getItem(" + JSONObject.quote(SAMPLING_KEY) + ");return JSON.stringify({routingMode:mode,sampling:sampling,nativeSampling})})()"));
            originalRoutingMode = prefs.isNull("routingMode") ? null : prefs.getString("routingMode");
            routingModeCaptured = true;
            originalSamplingNative = prefs.optBoolean("nativeSampling");
            originalSamplingRaw = prefs.isNull("sampling") ? null : prefs.getString("sampling");
            samplingCaptured = true;
            JSONObject policy = originalSamplingRaw == null ? null : new JSONObject(originalSamplingRaw);
            originalAutoRecord = policy != null && policy.optBoolean("recordOnNavigation", false);
            report.put("autoRecordInitiallyEnabled", originalAutoRecord);
        }

        private void preflight() throws Exception {
            JSONObject routeOverlay = originalState.optJSONObject("routeOverlay");
            if (hasActiveRoute(routeOverlay) || (routeOverlay != null && hasValue(routeOverlay, "start")) ||
                (routeOverlay != null && hasValue(routeOverlay, "end")))
                throw new PreconditionBlocked("existing route/navigation task");
            JSONObject guidanceActivity = guidanceActivityEvidence(originalState);
            report.put("guidanceActivityPreflight", guidanceActivity);
            if (guidanceActivity.optBoolean("active"))
                throw new PreconditionBlocked("guidance already active");
            JSONObject interaction = originalState.optJSONObject("interaction");
            JSONObject tracks = originalState.optJSONObject("trackOverlay");
            if ((interaction != null && interaction.optBoolean("drawingActive")) ||
                (tracks != null && (tracks.optBoolean("drawing") || tracks.optBoolean("editing") || tracks.optBoolean("connecting") ||
                    hasDraft(tracks.optJSONArray("draft")) || hasLiveRecording(tracks.optJSONArray("saved")))))
                throw new PreconditionBlocked("drawing/editing/recording task exists");
            if (!selectedId(originalState).isEmpty() || domBoolean("!!document.querySelector('.selection-tools')"))
                throw new PreconditionBlocked("map selection exists");
            JSONObject dom = new JSONObject(domString("(()=>{const visible=e=>{if(!e)return false;const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};const record=document.querySelector('.home-recording-toggle');return JSON.stringify({route:visible(document.querySelector('#map-control-panel .route-panel')),recordPanel:visible(document.querySelector('.record-console')),recordLabel:record?.getAttribute('aria-label')||'',recording:document.querySelector('.record-console-stats')?.textContent||'',position:document.querySelector('.position-locate-button')?.getAttribute('aria-label')||''})})()"));
            if (dom.optBoolean("route") || dom.optBoolean("recordPanel")) throw new PreconditionBlocked("route or recording panel is already open");
            String recordingLabel = dom.optString("recordLabel");
            if (!recordingLabel.isEmpty() && !"开始轨迹记录".equals(recordingLabel)) throw new PreconditionBlocked("recording is not idle");
            if (tracks != null && tracks.optString("phase", "idle").matches("recording|paused|finished"))
                throw new PreconditionBlocked("recording state is not idle");
            if ("device".equals(originalDirection)) throw new PreconditionBlocked("device-heading mode requires sensor permission and is not altered by QA");
            if (originalAutoRecord) {
                if (originalSamplingRaw == null || !samplingSupported()) throw new PreconditionBlocked("auto-record preference cannot be safely toggled through supported UI");
                if (tracks != null && tracks.optJSONArray("saved") != null && hasLiveRecording(tracks.optJSONArray("saved")))
                    throw new PreconditionBlocked("live recording exists");
            }
            originalFollow.put("locating", "定位中".equals(dom.optString("position")) || "重试定位".equals(dom.optString("position")));
            report.put("precondition", "PASS").put("trackCountBefore", originalTrackCount)
                .put("originalFollowPressed", originalFollow.optBoolean("pressed"))
                .put("originalDirectionMode", originalDirection);
        }

        private JSONObject readFixture() throws Exception {
            File root = parent.getTargetContext().getExternalFilesDir(null);
            if (root == null) throw new IllegalStateException("offline QA fixture storage unavailable");
            File canonicalRoot = root.getCanonicalFile();
            File file = new File(canonicalRoot, FIXTURE_NAME).getCanonicalFile();
            if (!canonicalRoot.equals(file.getParentFile()) || !file.isFile() || file.length() <= 0 || file.length() > 4L * 1024L * 1024L)
                throw new IllegalStateException("offline QA fixture missing or invalid");
            StringBuilder text = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(new FileInputStream(file), "UTF-8"))) {
                char[] buffer = new char[8192]; int read;
                while ((read = reader.read(buffer)) >= 0) {
                    text.append(buffer, 0, read);
                    if (text.length() > 4 * 1024 * 1024) throw new IllegalStateException("offline QA fixture exceeds size limit");
                }
            }
            Object parsed = new JSONTokener(text.toString()).nextValue();
            if (!(parsed instanceof JSONObject)) throw new IllegalStateException("offline QA fixture must be an object");
            JSONObject graph = ((JSONObject)parsed).optJSONObject("motorcar");
            if (graph == null || !"shantu-offline-routing".equals(graph.optString("format")) || graph.optInt("version") != 2 ||
                !"motorcar".equals(graph.optString("profile")) || graph.optJSONArray("nodes") == null || graph.optJSONArray("nodes").length() < 2 ||
                graph.optJSONArray("edges") == null || graph.optJSONArray("edges").length() < 1 || graph.optJSONArray("bounds") == null ||
                graph.optJSONArray("turnRestrictions") == null) throw new IllegalArgumentException("offline motorcar graph fixture invalid");
            return graph;
        }

        private void ensureQaIdVacant() throws Exception {
            String script = "(async()=>{const id=" + q(graphId) + ";const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(" + q(DATABASE) + ",1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('graphs'))r.result.createObjectStore('graphs',{keyPath:'id'});if(!r.result.objectStoreNames.contains('manifests'))r.result.createObjectStore('manifests',{keyPath:'id'})};r.onerror=()=>reject(r.error);r.onsuccess=()=>resolve(r.result)});try{const tx=db.transaction(['graphs','manifests'],'readonly'),a=await Promise.all(['graphs','manifests'].map(n=>new Promise((resolve,reject)=>{const x=tx.objectStore(n).get(id);x.onsuccess=()=>resolve(x.result);x.onerror=()=>reject(x.error)})));return JSON.stringify({vacant:!a.some(Boolean)})}finally{db.close()}})()";
            if (!new JSONObject(evalAsync(script, 10_000L)).optBoolean("vacant")) throw new PreconditionBlocked("unique QA graph ID collision");
        }

        private void seedQaGraph() throws Exception {
            graphWriteAttempted = true;
            String script = "(async()=>{const input=JSON.parse(" + q(graphFixture.toString()) + "),g=JSON.parse(JSON.stringify(input));g.id=" + q(graphId) + ";g.name=" + q(graphName) + ";const bytes=new TextEncoder().encode(JSON.stringify(g)),digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');const m={id:g.id,name:g.name,bounds:g.bounds,createdAt:g.createdAt,attribution:g.attribution,profile:g.profile,nodes:g.nodes.length,edges:g.edges.length,bytes:bytes.length,digest};const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(" + q(DATABASE) + ",1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});try{const tx=db.transaction(['graphs','manifests'],'readwrite');tx.objectStore('graphs').put(g);tx.objectStore('manifests').put(m);await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error)});window.dispatchEvent(new Event('shantu-offline-graphs-changed'));return JSON.stringify({ok:true})}finally{db.close()}})()";
            if (!new JSONObject(evalAsync(script, 15_000L)).optBoolean("ok")) throw new IllegalStateException("QA graph seed failed");
        }

        private void chooseCoordinateEndpoint(String label, String query) throws Exception {
            String endpoint = "起点".equals(label) ? "route-start" : "route-end";
            String selector = "#map-control-panel .route-panel input[aria-label=" + q(label) + "]";
            failedStage = endpoint + "-dismiss-keyboard-before-focus";
            progress(failedStage);
            dismissImeIfVisible();
            failedStage = endpoint + "-focus-input";
            progress(failedStage);
            captureScreenshot(endpoint + "-before-focus");
            tapElement(selector);
            captureScreenshot(endpoint + "-focused");
            failedStage = endpoint + "-paste-query";
            progress(failedStage);
            progress("before-coordinate-clipboard-paste");
            writeClipboard(query);
            parent.sendKeyDownUpSync(KeyEvent.KEYCODE_PASTE);
            if (!waitInputValue(selector, query, 3_000L)) {
                if (!accessibilityPaste(selector, query)) throw new IllegalStateException("coordinate query paste failed");
            }
            progress("after-coordinate-clipboard-paste");
            captureScreenshot(endpoint + "-query-pasted");
            failedStage = endpoint + "-wait-coordinate-result";
            progress(failedStage);
            String resultSelector = ".route-place-results[aria-label=" + q(label + "搜索结果") + "] [data-place-result]";
            JSONObject result = waitCoordinateResult(resultSelector, 5_000L);
            captureScreenshot(endpoint + "-result-visible");
            failedStage = endpoint + "-touch-coordinate-result";
            progress(failedStage);
            progress("before-pick-route-coordinate-result");
            tapRect(result.getJSONObject("rect"));
            failedStage = endpoint + "-await-selection";
            progress(failedStage);
            if (!waitInputValue(selector, "坐标位置", 4_000L)) throw new IllegalStateException("coordinate result did not populate route endpoint");
            captureScreenshot(endpoint + "-selected");
            failedStage = endpoint + "-dismiss-keyboard-after-selection";
            progress(failedStage);
            dismissImeIfVisible();
            progress("after-pick-route-coordinate-result");
            steps.put(new JSONObject().put("step", "endpoint-coordinate-result-selected").put("endpoint", "起点".equals(label) ? "start" : "end")
                .put("actualResultTouch", true));
        }

        private boolean imeVisible() throws Exception {
            if (Build.VERSION.SDK_INT >= 30) {
                WebView view = (WebView)field(parent, "webView");
                final boolean[] visible = {false};
                parent.runOnMainSync(() -> {
                    WindowInsets insets = view.getRootWindowInsets();
                    visible[0] = insets != null && insets.isVisible(WindowInsets.Type.ime());
                });
                return visible[0];
            }
            List<AccessibilityWindowInfo> windows = parent.getUiAutomation().getWindows();
            if (windows != null) for (AccessibilityWindowInfo window : windows)
                if (window != null && window.getType() == AccessibilityWindowInfo.TYPE_INPUT_METHOD && window.isActive()) return true;
            return false;
        }

        private void dismissImeIfVisible() throws Exception {
            if (!imeVisible()) return;
            parent.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
            long end = SystemClock.elapsedRealtime() + 2_000L;
            while (SystemClock.elapsedRealtime() < end) {
                if (!imeVisible()) return;
                SystemClock.sleep(80L);
            }
            throw new IllegalStateException("Android keyboard did not close after Back");
        }

        private JSONObject waitCoordinateResult(String selector, long timeout) throws Exception {
            String expression = "(()=>{const e=document.querySelector(" + q(selector) + ");if(!e)return JSON.stringify({found:false});const r=e.getBoundingClientRect(),s=getComputedStyle(e),x=r.left+r.width/2,y=r.top+r.height/2,h=document.elementFromPoint(x,y);return JSON.stringify({found:true,text:(e.innerText||'').trim(),visible:s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0,hit:h===e||e.contains(h),rect:{x:r.x,y:r.y,width:r.width,height:r.height}})})()";
            long end = SystemClock.elapsedRealtime() + timeout;
            JSONObject last = new JSONObject();
            while (SystemClock.elapsedRealtime() < end) {
                last = new JSONObject(domString(expression));
                if (last.optBoolean("found") && last.optBoolean("visible") && last.optBoolean("hit") && last.optString("text").contains("坐标位置")) return last;
                SystemClock.sleep(100L);
            }
            throw new IllegalStateException("local coordinate search result did not appear or hit-test");
        }

        private JSONObject awaitNativeRoute() throws Exception {
            long end = SystemClock.elapsedRealtime() + ROUTE_TIMEOUT_MS;
            while (SystemClock.elapsedRealtime() < end) {
                JSONObject state = (JSONObject)callParent("readState");
                JSONObject overlay = state.optJSONObject("routeOverlay"), route = overlay == null ? null : overlay.optJSONObject("route");
                boolean summary = domBoolean("(()=>{const e=document.querySelector('#map-control-panel .route-summary');if(!e)return false;const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0})()");
                JSONObject source = route == null ? null : route.optJSONObject("routingSource");
                if (route != null && summary && renderedRoutePresent() && source != null && "offline".equals(source.optString("kind"))) {
                    if (!graphName.equals(source.optString("name"))) throw new IllegalStateException("route was computed from an unexpected offline graph");
                    JSONArray coordinates = route.optJSONArray("coordinates");
                    if (coordinates == null || coordinates.length() < 2 || route.optDouble("distance", 0) <= 0)
                        throw new IllegalStateException("offline route has incomplete geometry");
                    return new JSONObject().put("plannedByRouteUi", true).put("offlineGraphMatched", true)
                        .put("nativeRoutePathPresent", true).put("coordinateCount", coordinates.length())
                        .put("distanceMeters", route.optDouble("distance"));
                }
                SystemClock.sleep(150L);
            }
            throw new IllegalStateException("real route planner did not produce the QA offline route");
        }

        /** Uses the shared in-app color picker and the existing native width select through real touches. */
        private JSONObject testRouteStyleControls() throws Exception {
            JSONObject evidence = new JSONObject().put("status", "RUNNING");
            String colorSelector = ".route-style-quick-controls input[type='color'][aria-label='路线颜色']";
            String widthSelector = ".route-style-quick-controls select[aria-label='路线粗细']";
            try {
                captureScreenshot("route-style-controls-before");
                JSONObject before = routeStyleControlProbe(colorSelector, widthSelector);
                evidence.put("before", before);
                if (!before.optBoolean("found") || !before.optBoolean("visible"))
                    throw new IllegalStateException("route style controls are missing or not visible");
                JSONObject nativeBefore = nativeRouteStyle();
                evidence.put("nativeBefore", nativeBefore);

                JSONObject colorBefore = before.optJSONObject("color");
                if (colorBefore == null || !nativeBefore.optString("color").equalsIgnoreCase(colorBefore.optString("value")))
                    throw new IllegalStateException("route color input and native route style are not synchronized before selection");
                String previousColor = colorBefore.optString("value");
                String color = "#e41a1c".equalsIgnoreCase(previousColor) ? "#377eb8" : "#e41a1c";
                String colorLabel = "#e41a1c".equalsIgnoreCase(color) ? "红" : "蓝";
                evidence.put("requestedColor", new JSONObject().put("value", color).put("label", colorLabel));
                failedStage = "route-style-color-tap-input";
                progress("before-open-route-color-picker");
                tapControlCenter(colorSelector, "color-input");
                failedStage = "route-style-color-await-picker";
                JSONObject pickerOpen = awaitColorPicker(true, color, 3_000L);
                evidence.put("colorPickerOpened", pickerOpen);
                captureScreenshot("route-style-color-picker-open");
                failedStage = "route-style-color-tap-palette-option";
                tapControlCenter(".app-color-picker button[data-color='" + color + "']", "color-picker-option");
                failedStage = "route-style-color-await-picker-close";
                JSONObject pickerClosed = awaitColorPicker(false, color, 3_000L);
                evidence.put("colorPickerClosedAfterSelection", pickerClosed);
                nativeSelectPopupObserved = false;
                failedStage = "route-style-color-verify-dom-native";
                JSONObject colorDom = awaitRouteStyleDom(colorSelector, widthSelector, color, null, 4_000L);
                JSONObject nativeAfterColor = awaitNativeRouteStyle(color, null, 4_000L);
                boolean colorFocusFramePass = recordColorFocusFrame(colorDom, "color");
                evidence.put("afterColor", colorDom).put("nativeAfterColor", nativeAfterColor)
                    .put("colorSingleFocusFramePass", colorFocusFramePass);
                captureScreenshot("route-style-color-selected");
                if (pickerClosed.optBoolean("visible")) throw new IllegalStateException("shared color picker remained open after selection");
                progress("after-select-route-color");

                JSONObject widthChoice = differentOption(widthSelector);
                if (widthChoice == null || widthChoice.optString("value").isEmpty() || widthChoice.optString("text").isEmpty())
                    throw new IllegalStateException("no alternate route width option");
                String width = widthChoice.getString("value");
                evidence.put("requestedWidthOption", widthChoice);
                failedStage = "route-style-width-tap-select";
                progress("before-open-route-width-select");
                tapControlCenter(widthSelector, "width-select");
                failedStage = "route-style-width-await-native-option";
                JSONObject widthOption = awaitNativeOption(widthChoice.getString("text"), 3_000L);
                evidence.put("nativeWidthOption", widthOption);
                captureScreenshot("route-style-width-options-open");
                failedStage = "route-style-width-tap-native-option";
                tapNativeOption(widthOption);
                nativeSelectPopupObserved = false;
                failedStage = "route-style-width-verify-dom-native";
                JSONObject selected = awaitRouteStyleDom(colorSelector, widthSelector, color, width, 4_000L);
                JSONObject nativeSelected = awaitNativeRouteStyle(color, width, 4_000L);
                selected.put("nativeRouteStyle", nativeSelected);
                boolean widthFocusFramePass = recordSingleFocusFrame(selected, "width");
                evidence.put("afterColorAndWidth", selected);
                evidence.put("colorSingleFocusFramePass", colorFocusFramePass)
                    .put("widthSingleFocusFramePass", widthFocusFramePass);
                captureScreenshot("route-style-color-and-width-selected");
                if (!colorFocusFramePass || !widthFocusFramePass) {
                    failedStage = "route-style-focus-frame";
                    throw new IllegalStateException("route style controls do not show exactly one outer focus frame");
                }
                JSONObject customEvidence = new JSONObject().put("status", "RUNNING");
                evidence.put("customAndCancel", customEvidence);
                String customColor = "#12ab34";
                failedStage = "route-style-custom-reopen-picker";
                tapControlCenter(colorSelector, "custom-reopen-color-input");
                customEvidence.put("paletteOpened", awaitColorPicker(true, null, 3_000L));
                callParent("awaitWebViewDraw");
                failedStage = "route-style-custom-enter-mode";
                tapControlCenter(".app-color-custom", "custom-mode-button");
                failedStage = "route-style-custom-await-hex-input";
                JSONObject customInput = awaitCustomColorInput(3_000L);
                customEvidence.put("customInput", customInput);
                callParent("awaitWebViewDraw");
                JSONObject pickerGeometry = customInput.optJSONObject("picker");
                if (pickerGeometry == null || pickerGeometry.optDouble("height", Double.MAX_VALUE) > 200.5) {
                    customEvidence.put("status", "FAIL").put("pickerHeightLimitPx", 200);
                    throw new IllegalStateException("shared color picker exceeded 200px height");
                }
                customEvidence.put("pickerHeightLimitPx", 200).put("pickerHeightPass", true);
                captureScreenshot("route-style-custom-color-input");
                failedStage = "route-style-custom-focus-hex-input";
                tapControlCenter(".app-color-picker input[aria-label='自定义颜色值']", "custom-hex-input");
                JSONObject focusedInput = awaitCustomColorInputFocused(3_000L);
                customEvidence.put("focusedInputBeforeTyping", focusedInput);
                if (!focusedInput.optBoolean("activeElement")) throw new IllegalStateException("custom HEX field did not receive focus");
                callParent("awaitWebViewDraw");
                JSONObject focusedAfterDraw = customColorInputState();
                customEvidence.put("focusedInputAfterWebViewDraw", focusedAfterDraw);
                if (!focusedAfterDraw.optBoolean("activeElement")) throw new IllegalStateException("custom HEX field lost focus before keyboard input");
                customEvidence.put("keyboardTextRequested", "12ab34");
                failedStage = "route-style-custom-type-hex";
                parent.sendStringSync("12ab34");
                customEvidence.put("afterKeyboardInput", customColorInputState());
                failedStage = "route-style-custom-await-auto-close";
                JSONObject customPickerClosed;
                try {
                    customPickerClosed = awaitColorPicker(false, null, 3_000L);
                } catch (Throwable closeFailure) {
                    customEvidence.put("afterKeyboardInput", customColorInputState())
                        .put("inputFailureType", closeFailure.getClass().getSimpleName());
                    throw closeFailure;
                }
                customEvidence.put("pickerClosedAfterValidHex", customPickerClosed);
                failedStage = "route-style-custom-verify-dom-native";
                JSONObject customDom = awaitRouteStyleDom(colorSelector, widthSelector, customColor, null, 4_000L);
                JSONObject customNative = awaitNativeRouteStyle(customColor, null, 4_000L);
                customEvidence.put("afterCustomInput", customDom).put("nativeAfterCustomInput", customNative)
                    .put("routeInputValueLengthAfterApply", customDom.optJSONObject("color").optString("value").length())
                    .put("closedAutomatically", !customPickerClosed.optBoolean("visible"));
                captureScreenshot("route-style-custom-color-applied");

                failedStage = "route-style-cancel-reopen-picker";
                tapControlCenter(colorSelector, "cancel-reopen-color-input");
                customEvidence.put("pickerReopenedForCancel", awaitColorPicker(true, null, 3_000L));
                callParent("awaitWebViewDraw");
                failedStage = "route-style-cancel-tap-close";
                tapControlCenter(".app-color-picker button[aria-label='关闭颜色选择']", "cancel-color-picker-close");
                failedStage = "route-style-cancel-await-close";
                JSONObject cancelledPicker = awaitColorPicker(false, null, 3_000L);
                failedStage = "route-style-cancel-verify-unchanged";
                JSONObject afterCancel = awaitRouteStyleDom(colorSelector, widthSelector, customColor, null, 4_000L);
                JSONObject nativeAfterCancel = awaitNativeRouteStyle(customColor, null, 4_000L);
                customEvidence.put("pickerClosedByX", cancelledPicker).put("afterCancel", afterCancel)
                    .put("nativeAfterCancel", nativeAfterCancel).put("selectionUnchanged", true)
                    .put("status", "PASS");
                captureScreenshot("route-style-custom-color-cancel");
                evidence.put("status", "PASS");
                steps.put(new JSONObject().put("step", "route-color-and-width-selected-through-real-controls")
                    .put("colorChangedByTouch", true).put("widthChangedByTouch", true)
                    .put("customHexAppliedAndClosed", true).put("cancelPreservedColor", true)
                    .put("domAndNativeStyleSynchronized", true));
                progress("after-route-style-controls");
                return evidence;
            } catch (Throwable failure) {
                evidence.put("status", "FAIL").put("failedAction", failedStage)
                    .put("errorType", failure.getClass().getSimpleName()).put("error", safeMessage(failure))
                    .put("exceptionEvidence", exceptionEvidence(failure));
                if (lastNativeOptionScan != null) evidence.put("lastNativeOptionScan", lastNativeOptionScan);
                report.put("routeStyleControls", evidence);
                steps.put(new JSONObject().put("step", "route-color-and-width-real-control-test")
                    .put("status", "FAIL").put("failedAction", failedStage));
                if (failure instanceof Exception) throw (Exception)failure;
                throw new IllegalStateException("route style control test failed", failure);
            }
        }

        private JSONObject routeStyleControlProbe(String colorSelector, String widthSelector) throws Exception {
            String script = "(()=>{const color=document.querySelector(" + q(colorSelector) + "),width=document.querySelector(" + q(widthSelector) + ");" +
                "const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}};" +
                "const outline=e=>{const s=getComputedStyle(e);return{style:s.outlineStyle,width:s.outlineWidth,color:s.outlineColor,offset:s.outlineOffset,boxShadow:s.boxShadow,backgroundColor:s.backgroundColor,borderStyle:s.borderStyle,borderWidth:s.borderWidth}};" +
                "const doubleOutline=e=>{const p=outline(e?.closest('label')),c=outline(e);return p.style!=='none'&&parseFloat(p.width)>0&&c.style!=='none'&&parseFloat(c.width)>0};" +
                "const label=e=>e?.closest('label');const hit=e=>{if(!e)return null;const r=e.getBoundingClientRect();return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)};" +
                "return JSON.stringify({found:!!color&&!!width,visible:[color,width].every(e=>{if(!e)return false;const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0})," +
                "color:{tag:color?.tagName||'',type:color?.type||'',value:color?.value||'',rect:color?rect(color):null,labelRect:color?rect(label(color)):null,parentOutline:color?outline(label(color)):null,controlOutline:color?outline(color):null,hitTag:hit(color)?.tagName||''}," +
                "width:{tag:width?.tagName||'',value:width?.value||'',options:width?Array.from(width.options,o=>({value:o.value,text:(o.textContent||'').trim()})):[],rect:width?rect(width):null,labelRect:width?rect(label(width)):null,parentOutline:width?outline(label(width)):null,selectOutline:width?outline(width):null,doubleOutline:doubleOutline(width)}})})()";
            return new JSONObject(domString(script));
        }

        private JSONObject differentOption(String selector) throws Exception {
            String script = "(()=>{const e=document.querySelector(" + q(selector) + ");if(!e)return JSON.stringify({});const o=Array.from(e.options).find(x=>x.value!==e.value);return JSON.stringify(o?{value:o.value,text:(o.textContent||'').trim()}:{})})()";
            String value = domString(script);
            return new JSONObject(value);
        }

        private void tapControlCenter(String selector, String evidenceKey) throws Exception {
            JSONObject rect = new JSONObject(domString("(()=>{const e=document.querySelector(" + q(selector) + ");if(!e)return JSON.stringify({found:false});const r=e.getBoundingClientRect(),s=getComputedStyle(e),x=r.left+r.width/2,y=r.top+r.height/2,h=document.elementFromPoint(x,y),l=e.matches('input[type=color]')&&e.closest('label'),hit=h===e||e.contains(h)||(!!l&&l.contains(h));return JSON.stringify({found:true,visible:s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0,hit,hitThroughLabel:!!l&&l.contains(h),hitTag:h?.tagName||'',hitClass:typeof h?.className==='string'?h.className:'',selectTag:e.tagName,selectClass:typeof e.className==='string'?e.className:'',rect:{x:r.x,y:r.y,width:r.width,height:r.height},x,y})})()"));
            int[] origin = new int[2];
            parent.runOnMainSync(() -> webView.getLocationOnScreen(origin));
            float injectedX = origin[0] + (float)rect.optDouble("x", 0) * (float)cssScale;
            float injectedY = origin[1] + (float)rect.optDouble("y", 0) * (float)cssScale;
            put("routeStyleHitEvidence-" + evidenceKey, new JSONObject()
                .put("staticStage", failedStage).put("cssScale", cssScale)
                .put("webViewOriginScreen", new JSONArray().put(origin[0]).put(origin[1]))
                .put("webViewSizePx", new JSONArray().put(webView.getWidth()).put(webView.getHeight()))
                .put("cssRect", rect.optJSONObject("rect")).put("cssCenter", new JSONArray().put(rect.optDouble("x")).put(rect.optDouble("y")))
                .put("injectedScreenPx", new JSONArray().put(injectedX).put(injectedY))
                .put("found", rect.optBoolean("found")).put("visible", rect.optBoolean("visible"))
                .put("hit", rect.optBoolean("hit")).put("hitTag", rect.optString("hitTag")).put("hitClass", rect.optString("hitClass"))
                .put("hitThroughLabel", rect.optBoolean("hitThroughLabel"))
                .put("elementTag", rect.optString("selectTag")).put("elementClass", rect.optString("selectClass")));
            if (!rect.optBoolean("found") || !rect.optBoolean("visible") || !rect.optBoolean("hit"))
                throw new IllegalStateException("route style control is not visible and hit-testable: " + selector);
            callParent("tap", injectedX, injectedY);
        }

        private JSONObject awaitColorPicker(boolean expectedVisible, String targetColor, long timeout) throws Exception {
            long end = SystemClock.elapsedRealtime() + timeout;
            JSONObject last = new JSONObject();
            String target = targetColor == null ? "null" : q(targetColor);
            String script = "(()=>{const e=document.querySelector('dialog.app-color-picker,.app-color-picker[role=dialog],.app-color-picker');if(!e)return JSON.stringify({found:false,visible:false,targetOptionVisible:false});const s=getComputedStyle(e),r=e.getBoundingClientRect();const visible=s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)!==0&&r.width>0&&r.height>0;const target=" + target + ";const targetOptionVisible=target!==null&&Array.from(e.querySelectorAll('button[data-color]')).some(b=>{const q=b.getBoundingClientRect(),z=getComputedStyle(b);return b.dataset.color.toLowerCase()===target.toLowerCase()&&z.display!=='none'&&z.visibility!=='hidden'&&q.width>0&&q.height>0});return JSON.stringify({found:true,visible,targetOptionVisible,tag:e.tagName,rect:{x:r.x,y:r.y,width:r.width,height:r.height}})})()";
            while (SystemClock.elapsedRealtime() < end) {
                last = new JSONObject(domString(script));
                if (last.optBoolean("visible") == expectedVisible && (!expectedVisible || targetColor == null || last.optBoolean("targetOptionVisible"))) return last;
                SystemClock.sleep(80L);
            }
            throw new IllegalStateException(expectedVisible ? "shared color picker did not open" : "shared color picker did not close");
        }

        private JSONObject awaitCustomColorInput(long timeout) throws Exception {
            long end = SystemClock.elapsedRealtime() + timeout;
            JSONObject last = new JSONObject();
            String script = "(()=>{const e=document.querySelector('.app-color-picker input[aria-label=\"自定义颜色值\"]'),p=document.querySelector('.app-color-picker');if(!e||!p)return JSON.stringify({found:false,visible:false});const s=getComputedStyle(e),r=e.getBoundingClientRect(),pr=p.getBoundingClientRect(),h=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return JSON.stringify({found:true,visible:s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0,hit:h===e||e.contains(h),tag:e.tagName,type:e.type,rect:{x:r.x,y:r.y,width:r.width,height:r.height},cssCenter:[r.left+r.width/2,r.top+r.height/2],picker:{x:pr.x,y:pr.y,width:pr.width,height:pr.height}})})()";
            while (SystemClock.elapsedRealtime() < end) {
                last = new JSONObject(domString(script));
                if (last.optBoolean("found") && last.optBoolean("visible") && last.optBoolean("hit")) return last;
                SystemClock.sleep(80L);
            }
            throw new IllegalStateException("custom HEX input did not become visible and hit-testable");
        }

        private JSONObject customColorInputState() throws Exception {
            String script = "(()=>{const e=document.querySelector('.app-color-picker input[aria-label=\"自定义颜色值\"]'),p=document.querySelector('.app-color-picker');" +
                "const r=e?.getBoundingClientRect(),s=e&&getComputedStyle(e);return JSON.stringify({pickerVisible:!!p&&(()=>{const z=getComputedStyle(p),q=p.getBoundingClientRect();return z.display!=='none'&&z.visibility!=='hidden'&&q.width>0&&q.height>0})()," +
                "inputFound:!!e,inputVisible:!!e&&s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0,activeElement:!!e&&document.activeElement===e," +
                "inputValueLength:e?(e.value||'').length:-1,rect:r?{x:r.x,y:r.y,width:r.width,height:r.height}:null})})()";
            return new JSONObject(domString(script));
        }

        private JSONObject awaitCustomColorInputFocused(long timeout) throws Exception {
            long end = SystemClock.elapsedRealtime() + timeout;
            JSONObject last = new JSONObject();
            while (SystemClock.elapsedRealtime() < end) {
                last = customColorInputState();
                if (last.optBoolean("inputFound") && last.optBoolean("inputVisible") && last.optBoolean("activeElement")) return last;
                SystemClock.sleep(80L);
            }
            throw new IllegalStateException("custom HEX field did not become the active visible input");
        }

        private boolean recordColorFocusFrame(JSONObject probe, String control) throws Exception {
            JSONObject item = probe.optJSONObject(control), parentOutline = item == null ? null : item.optJSONObject("parentOutline");
            JSONObject controlOutline = item == null ? null : item.optJSONObject("controlOutline");
            boolean parentRing = parentOutline != null && "solid".equals(parentOutline.optString("style")) &&
                Math.abs(parseCssPixels(parentOutline.optString("width")) - 2.0) < 0.01 && "-2px".equals(parentOutline.optString("offset"));
            boolean noInnerOutline = controlOutline != null && ("none".equals(controlOutline.optString("style")) ||
                parseCssPixels(controlOutline.optString("width")) == 0.0);
            boolean noShadow = controlOutline != null && "none".equals(controlOutline.optString("boxShadow"));
            item.put("singleOuterFocusRing", parentRing).put("noInnerOutline", noInnerOutline).put("noInnerShadow", noShadow)
                .put("controlBackgroundAllowed", true).put("controlBorderAllowed", true);
            return parentRing && noInnerOutline && noShadow;
        }

        private boolean recordSingleFocusFrame(JSONObject probe, String control) throws Exception {
            JSONObject item = probe.optJSONObject(control), parentOutline = item == null ? null : item.optJSONObject("parentOutline");
            JSONObject selectOutline = item == null ? null : item.optJSONObject("selectOutline");
            boolean parentRing = parentOutline != null && "solid".equals(parentOutline.optString("style")) &&
                Math.abs(parseCssPixels(parentOutline.optString("width")) - 2.0) < 0.01 && "-2px".equals(parentOutline.optString("offset"));
            boolean noInnerOutline = selectOutline != null && ("none".equals(selectOutline.optString("style")) ||
                parseCssPixels(selectOutline.optString("width")) == 0.0);
            boolean noShadow = selectOutline != null && "none".equals(selectOutline.optString("boxShadow"));
            boolean noBackground = selectOutline != null && isTransparentCss(selectOutline.optString("backgroundColor"));
            boolean noBorder = selectOutline != null && ("none".equals(selectOutline.optString("borderStyle")) ||
                parseCssPixels(selectOutline.optString("borderWidth")) == 0.0);
            item.put("singleOuterFocusRing", parentRing).put("noInnerOutline", noInnerOutline)
                .put("noInnerShadow", noShadow).put("noInnerBackground", noBackground).put("noInnerBorder", noBorder);
            return parentRing && noInnerOutline && noShadow && noBackground && noBorder;
        }

        private double parseCssPixels(String value) {
            if (value == null || !value.endsWith("px")) return Double.NaN;
            try { return Double.parseDouble(value.substring(0, value.length() - 2)); }
            catch (NumberFormatException ignored) { return Double.NaN; }
        }

        private boolean isTransparentCss(String value) {
            if (value == null) return false;
            String normalized = value.toLowerCase(java.util.Locale.ROOT).replace(" ", "");
            return "transparent".equals(normalized) || "rgba(0,0,0,0)".equals(normalized) ||
                "rgba(0,0,0,0.0)".equals(normalized);
        }

        private JSONObject awaitNativeOption(String text, long timeout) throws Exception {
            long end = SystemClock.elapsedRealtime() + timeout;
            while (SystemClock.elapsedRealtime() < end) {
                lastNativeOptionScan = scanNativeOptions(text);
                JSONObject option = lastNativeOptionScan.optJSONObject("option");
                if (option != null) return option;
                SystemClock.sleep(80L);
            }
            throw new IllegalStateException("NATIVE_SELECT_OPTION_NOT_FOUND");
        }

        private JSONObject scanNativeOptions(String text) throws Exception {
            JSONObject scan = new JSONObject().put("stage", failedStage)
                .put("targetLabel", safeOptionLabel(text));
            JSONArray visibleLabels = new JSONArray();
            JSONArray rootClasses = new JSONArray(), windowsEvidence = new JSONArray();
            int[] rootCount = {0}, targetNodeCount = {0}, visibleTargetCount = {0};
            JSONObject found = null;
            AccessibilityNodeInfo activeRoot = parent.getUiAutomation().getRootInActiveWindow();
            scan.put("activeRootPresent", activeRoot != null);
            String activeRootClass = safeClassName(activeRoot);
            if (!activeRootClass.isEmpty()) rootClasses.put(activeRootClass);
            if (activeRootClass.contains("Popup")) nativeSelectPopupObserved = true;
            found = optionInRoot(activeRoot, text, -1, rootCount, targetNodeCount, visibleTargetCount, visibleLabels);
            List<AccessibilityWindowInfo> windows = parent.getUiAutomation().getWindows();
            scan.put("windowCount", windows == null ? 0 : windows.size());
            if (windows != null) for (AccessibilityWindowInfo window : windows) {
                if (window == null) continue;
                AccessibilityNodeInfo windowRoot = window.getRoot();
                String windowRootClass = safeClassName(windowRoot);
                if (!windowRootClass.isEmpty()) rootClasses.put(windowRootClass);
                if (windowRootClass.contains("Popup")) nativeSelectPopupObserved = true;
                windowsEvidence.put(new JSONObject().put("type", window.getType()).put("rootClass", windowRootClass));
                JSONObject option = optionInRoot(windowRoot, text, window.getType(), rootCount,
                    targetNodeCount, visibleTargetCount, visibleLabels);
                if (found == null) found = option;
            }
            if (found != null || visibleTargetCount[0] > 0) nativeSelectPopupObserved = true;
            scan.put("rootsScanned", rootCount[0]).put("targetNodeCount", targetNodeCount[0])
                .put("visibleTargetCount", visibleTargetCount[0]).put("visibleSafeOptionLabels", visibleLabels)
                .put("rootClasses", rootClasses).put("windows", windowsEvidence)
                .put("nativeSelectPopupObserved", nativeSelectPopupObserved);
            if (found != null) scan.put("option", found);
            return scan;
        }

        private String safeClassName(AccessibilityNodeInfo node) {
            if (node == null || node.getClassName() == null) return "";
            String value = node.getClassName().toString();
            return value.matches("[A-Za-z0-9_.$]{1,160}") ? value : "[other-class]";
        }

        private void configureUiAutomationAccessibility() throws Exception {
            android.app.UiAutomation automation = parent.getUiAutomation();
            AccessibilityServiceInfo current = automation.getServiceInfo();
            if (current == null) throw new IllegalStateException("UI_AUTOMATION_SERVICE_INFO_UNAVAILABLE");
            originalUiAutomationFlags = current.flags;
            uiAutomationServiceInfoCaptured = true;
            AccessibilityServiceInfo configured = current;
            configured.flags |= AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS |
                AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS |
                AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS;
            automation.setServiceInfo(configured);
            report.put("uiAutomationAccessibilityConfigured", true)
                .put("uiAutomationFlagsAdded", new JSONArray()
                    .put(AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS)
                    .put(AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS)
                    .put(AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS));
        }

        private void restoreUiAutomationAccessibility(JSONObject target) {
            if (!uiAutomationServiceInfoCaptured) return;
            try {
                AccessibilityServiceInfo current = parent.getUiAutomation().getServiceInfo();
                if (current == null) throw new IllegalStateException("UI_AUTOMATION_SERVICE_INFO_UNAVAILABLE");
                current.flags = originalUiAutomationFlags;
                parent.getUiAutomation().setServiceInfo(current);
                target.put("uiAutomationServiceInfoRestored", true);
                uiAutomationServiceInfoCaptured = false;
            } catch (Throwable error) {
                putError(target, "uiAutomationServiceInfoRestoreError", error);
                try { target.put("uiAutomationServiceInfoRestoreExceptionEvidence", exceptionEvidence(error)); }
                catch (JSONException ignored) { }
            }
        }

        private JSONObject optionInRoot(AccessibilityNodeInfo root, String text, int windowType,
            int[] rootCount, int[] targetNodeCount, int[] visibleTargetCount, JSONArray visibleLabels) throws Exception {
            if (root == null) return null;
            rootCount[0]++;
            collectVisibleSafeOptionLabels(root, visibleLabels);
            List<AccessibilityNodeInfo> nodes = root.findAccessibilityNodeInfosByText(text);
            if (nodes == null) return null;
            targetNodeCount[0] += nodes.size();
            JSONObject found = null;
            for (AccessibilityNodeInfo node : nodes) {
                if (node == null || !node.isVisibleToUser()) continue;
                CharSequence label = node.getText();
                if (label == null || !text.equals(label.toString().trim())) continue;
                Rect rect = new Rect(); node.getBoundsInScreen(rect);
                if (rect.isEmpty()) continue;
                visibleTargetCount[0]++;
                if (found == null) found = new JSONObject().put("text", safeOptionLabel(label.toString().trim()))
                    .put("boundsScreen", new JSONObject().put("left", rect.left).put("top", rect.top)
                        .put("right", rect.right).put("bottom", rect.bottom))
                    .put("windowType", windowType);
            }
            return found;
        }

        private void collectVisibleSafeOptionLabels(AccessibilityNodeInfo root, JSONArray labels) throws Exception {
            String[] allowed = {"红", "蓝", "绿", "紫", "橙", "粉", "0.5", "1", "1.5", "2", "2.5", "3", "3.5", "4", "4.5", "5"};
            for (String allowedLabel : allowed) {
                List<AccessibilityNodeInfo> nodes = root.findAccessibilityNodeInfosByText(allowedLabel);
                if (nodes == null) continue;
                for (AccessibilityNodeInfo node : nodes) {
                    if (node == null || !node.isVisibleToUser()) continue;
                    CharSequence value = node.getText();
                    if (value == null || !allowedLabel.equals(value.toString().trim())) continue;
                    boolean duplicate = false;
                    for (int i = 0; i < labels.length(); i++) if (allowedLabel.equals(labels.optString(i))) duplicate = true;
                    if (!duplicate) labels.put(allowedLabel);
                }
                }
        }

        private String safeOptionLabel(String value) {
            if (value == null) return "";
            String safe = value.trim();
            return safe.matches("[红蓝绿紫橙粉]") || safe.matches("(?:0\\.5|[1-5](?:\\.5)?)") || safe.matches("#[0-9a-fA-F]{6}")
                ? safe : "[other-option]";
        }

        private void tapNativeOption(JSONObject option) throws Exception {
            JSONObject rect = option.optJSONObject("boundsScreen");
            if (rect == null) throw new IllegalStateException("native select option has no observed screen bounds");
            callParent("tap", (float)((rect.getDouble("left") + rect.getDouble("right")) / 2),
                (float)((rect.getDouble("top") + rect.getDouble("bottom")) / 2));
        }

        private JSONObject awaitRouteStyleDom(String colorSelector, String widthSelector, String color, String width, long timeout) throws Exception {
            long end = SystemClock.elapsedRealtime() + timeout;
            JSONObject last = new JSONObject();
            while (SystemClock.elapsedRealtime() < end) {
                last = routeStyleControlProbe(colorSelector, widthSelector);
                JSONObject actual = last.optJSONObject("color");
                JSONObject actualWidth = last.optJSONObject("width");
                boolean colorMatches = actual != null && color.equalsIgnoreCase(actual.optString("value"));
                boolean widthMatches = width == null || (actualWidth != null && Double.compare(Double.parseDouble(width), Double.parseDouble(actualWidth.optString("value", "NaN"))) == 0);
                if (colorMatches && widthMatches) return last;
                SystemClock.sleep(80L);
            }
            throw new IllegalStateException("route style DOM value or color swatch did not update: " + last);
        }

        private JSONObject nativeRouteStyle() throws Exception {
            JSONObject state = (JSONObject)callParent("readState");
            JSONObject geometry = state.optJSONObject("renderGeometry");
            JSONObject routes = geometry == null ? null : geometry.optJSONObject("routes");
            JSONArray features = routes == null ? null : routes.optJSONArray("features");
            if (features != null) for (int i = 0; i < features.length(); i++) {
                JSONObject feature = features.optJSONObject(i), properties = feature == null ? null : feature.optJSONObject("properties");
                if (properties != null && "routePath".equals(properties.optString("role")))
                    return new JSONObject().put("color", properties.optString("color", properties.optString("routeColor")))
                        .put("width", properties.optDouble("width", properties.optDouble("routeWidth", Double.NaN)));
            }
            throw new IllegalStateException("native render geometry has no routePath style");
        }

        private JSONObject awaitNativeRouteStyle(String color, String width, long timeout) throws Exception {
            long end = SystemClock.elapsedRealtime() + timeout;
            JSONObject last = new JSONObject();
            while (SystemClock.elapsedRealtime() < end) {
                try {
                    last = nativeRouteStyle();
                    boolean colorMatches = color.equalsIgnoreCase(last.optString("color"));
                    boolean widthMatches = width == null || Math.abs(Double.parseDouble(width) - last.optDouble("width", Double.NaN)) < 0.0001;
                    if (colorMatches && widthMatches) return last;
                } catch (IllegalStateException waitingForRenderGeometry) {
                    // A bridge revision may briefly publish before the route feature geometry.
                }
                SystemClock.sleep(80L);
            }
            throw new IllegalStateException("native route render style did not synchronize: " + last);
        }

        private JSONObject awaitGuidanceStart() throws Exception {
            long end = SystemClock.elapsedRealtime() + 15_000L;
            while (SystemClock.elapsedRealtime() < end) {
                JSONObject state = (JSONObject)callParent("readState");
                JSONObject dom = new JSONObject(domString("(()=>{const e=document.querySelector('.guidance-card'),b=e?.querySelector('.guidance-first-person');if(!e)return JSON.stringify({visible:false});const s=getComputedStyle(e),r=e.getBoundingClientRect();return JSON.stringify({visible:s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0,compact:e.getAttribute('data-compact')==='true',cameraMode:e.getAttribute('data-camera-mode')||'',positionWaiting:b?.getAttribute('data-waiting')==='true'})})()"));
                JSONObject evidence = guidanceActivityEvidence(state);
                if (evidence.optBoolean("active") && dom.optBoolean("visible")) {
                    if (!dom.optBoolean("compact")) throw new IllegalStateException("guidance did not enter collapsed main-screen mode");
                    return new JSONObject().put("guidanceActive", true).put("compactMainScreen", true)
                        .put("cameraMode", dom.optString("cameraMode")).put("positionWaiting", dom.optBoolean("positionWaiting"))
                        .put("activityEvidence", evidence);
                }
                SystemClock.sleep(120L);
            }
            throw new IllegalStateException("starting navigation did not activate the real guidance UI");
        }

        private JSONObject guidanceActivityEvidence(JSONObject state) throws Exception {
            boolean cardVisible = domBoolean("(()=>{const e=document.querySelector('.guidance-card');if(!e)return false;const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)!==0&&r.width>0&&r.height>0})()");
            boolean positionNavigating = state != null && state.optBoolean("positionNavigating", false);
            JSONObject cues = state == null ? null : state.optJSONObject("navigationCues");
            String cueKind = cues == null || cues == JSONObject.NULL ? "" : cues.optString("kind", "");
            JSONObject overlay = state == null ? null : state.optJSONObject("guidanceOverlay");
            boolean rejoinOverlayPresent = overlay != null && overlay != JSONObject.NULL &&
                overlay.optJSONArray("coordinates") != null && overlay.opt("target") != null && overlay.opt("target") != JSONObject.NULL;
            boolean cuesIndicateActiveNavigation = "rejoin".equals(cueKind) || ("route".equals(cueKind) && positionNavigating);
            boolean active = cardVisible || positionNavigating || cuesIndicateActiveNavigation || rejoinOverlayPresent;
            return new JSONObject().put("active", active).put("cardVisible", cardVisible)
                .put("positionNavigating", positionNavigating).put("navigationCueKind", cueKind)
                .put("guidanceRejoinOverlayPresent", rejoinOverlayPresent);
        }

        private JSONObject firstPersonProbe() throws Exception {
            return new JSONObject(domString("(()=>{const c=document.querySelector('.guidance-card'),b=c?.querySelector('.guidance-first-person');if(!c||!b)return JSON.stringify({visible:false});const r=b.getBoundingClientRect(),s=getComputedStyle(b),x=r.left+r.width/2,y=r.top+r.height/2,h=document.elementFromPoint(x,y);return JSON.stringify({visible:s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0,compact:c.getAttribute('data-compact')==='true',pressed:b.getAttribute('aria-pressed')==='true',cameraMode:c.getAttribute('data-camera-mode')||'',waiting:b.getAttribute('data-waiting')==='true',hit:h===b||b.contains(h),rect:{x:r.x,y:r.y,width:r.width,height:r.height}})})()"));
        }

        private JSONObject waitCameraMode(String mode, boolean pressed, long timeout) throws Exception {
            long end = SystemClock.elapsedRealtime() + timeout;
            JSONObject last = new JSONObject();
            while (SystemClock.elapsedRealtime() < end) {
                last = firstPersonProbe();
                if (last.optBoolean("visible") && last.optBoolean("compact") && last.optBoolean("hit") &&
                    mode.equals(last.optString("cameraMode")) && last.optBoolean("pressed") == pressed)
                    return last.put("pass", true);
                SystemClock.sleep(80L);
            }
            return last.put("pass", false);
        }

        private JSONObject readFollowStatusInCard() throws Exception {
            String script = "(()=>{const b=document.querySelector('.guidance-card .guidance-follow-status'),c=document.querySelector('.guidance-card');" +
                "const r=b?.getBoundingClientRect(),s=b&&getComputedStyle(b),x=r?r.left+r.width/2:0,y=r?r.top+r.height/2:0,h=b?document.elementFromPoint(x,y):null;" +
                "const safe=new Set(['请先退出当前选点或编辑任务。','等待准确定位，当前可手动查看路线。','正在重新获取准确定位，恢复后继续跟随','等待定位','正在获取当前位置…','等待当前位置…']);" +
                "const hints=Array.from(c?.querySelectorAll('[role=status],.guidance-inline-status,.guidance-compact-state')||[]).filter(e=>{const z=getComputedStyle(e),q=e.getBoundingClientRect();return z.display!=='none'&&z.visibility!=='hidden'&&q.width>0&&q.height>0}).map(e=>(e.innerText||e.textContent||'').trim()).filter(Boolean).map(t=>safe.has(t)?t:'[other-status]');" +
                "return JSON.stringify({found:!!b,pressed:b?.getAttribute('aria-pressed')==='true',text:(b?.innerText||'').trim(),visible:!!b&&s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0,hit:!!b&&(h===b||b.contains(h)),hitTag:h?.tagName||'',hitClass:typeof h?.className==='string'?h.className:'',buttonClass:b?.className||'',rect:r?{x:r.x,y:r.y,width:r.width,height:r.height}:null,cssCenter:[x,y],safeNavigationNotices:[...new Set(hints)]})})()";
            return new JSONObject(domString(script));
        }

        private void tapFollowStatus(JSONObject evidence) throws Exception {
            JSONObject point = readFollowStatusInCard();
            if (!point.optBoolean("found") || !point.optBoolean("visible") || !point.optBoolean("hit"))
                throw new IllegalStateException("FOLLOW_CONTROL_NOT_VISIBLE_OR_HIT_TESTABLE");
            JSONObject rect = point.optJSONObject("rect");
            if (rect == null) throw new IllegalStateException("FOLLOW_CONTROL_RECT_UNAVAILABLE");
            int[] origin = new int[2];
            parent.runOnMainSync(() -> webView.getLocationOnScreen(origin));
            float x = origin[0] + (float)point.getJSONArray("cssCenter").getDouble(0) * (float)cssScale;
            float y = origin[1] + (float)point.getJSONArray("cssCenter").getDouble(1) * (float)cssScale;
            JSONObject tap = new JSONObject().put("cssScale", cssScale)
                .put("webViewOriginScreen", new JSONArray().put(origin[0]).put(origin[1]))
                .put("webViewSizePx", new JSONArray().put(webView.getWidth()).put(webView.getHeight()))
                .put("cssRect", rect).put("cssCenter", point.getJSONArray("cssCenter"))
                .put("injectedScreenPx", new JSONArray().put(x).put(y))
                .put("hit", point.optBoolean("hit")).put("hitTag", point.optString("hitTag"))
                .put("hitClass", point.optString("hitClass"));
            evidence.put("tap", tap);
            callParent("tap", x, y);
        }

        private JSONObject awaitFollowIntent(boolean expected, long timeout, JSONObject evidence) throws Exception {
            long end = SystemClock.elapsedRealtime() + timeout;
            JSONObject last = new JSONObject();
            while (SystemClock.elapsedRealtime() < end) {
                last = readFollowStatusInCard();
                evidence.put("lastObserved", last);
                if (last.optBoolean("found") && last.optBoolean("pressed") == expected) return last;
                SystemClock.sleep(80L);
            }
            evidence.put("status", "FAIL").put("expectedPressed", expected).put("lastObserved", last);
            throw new IllegalStateException("continue-navigation button did not update its pressed state");
        }

        private void endGuidanceThroughUi() throws Exception {
            if (!guidanceActivityEvidence((JSONObject)callParent("readState")).optBoolean("cardVisible")) return;
            JSONObject compact = firstPersonProbe();
            if (compact.optBoolean("compact")) {
                tapElement(".guidance-card button[aria-label='展开导航详情']");
                waitForVisible(".guidance-card .guidance-content", 3_000L, "navigation details did not expand");
                captureScreenshot("guidance-details-expanded");
            }
            failedStage = "end-guidance-scroll-button";
            progress(failedStage);
            scrollEndNavigationButtonIntoView();
            captureScreenshot("guidance-end-button-visible");
            failedStage = "end-guidance-touch-button";
            progress(failedStage);
            tapButton(".guidance-card .guidance-actions", "结束导航");
        }

        private void scrollEndNavigationButtonIntoView() throws Exception {
            String expression = "(()=>{const c=document.querySelector('.guidance-card .guidance-content'),b=Array.from(c?.querySelectorAll('.guidance-actions button')||[]).find(e=>e.textContent.trim()==='结束导航');if(!c||!b)return JSON.stringify({found:false});const cr=c.getBoundingClientRect(),br=b.getBoundingClientRect(),s=getComputedStyle(c),x=br.left+br.width/2,y=br.top+br.height/2,h=document.elementFromPoint(x,y);return JSON.stringify({found:true,container:{x:cr.x,y:cr.y,width:cr.width,height:cr.height,scrollHeight:c.scrollHeight,clientHeight:c.clientHeight,scrollTop:c.scrollTop},button:{x:br.x,y:br.y,width:br.width,height:br.height,top:br.top,bottom:br.bottom},fullyVisible:br.top>=cr.top&&br.bottom<=cr.bottom,hit:h===b||h?.closest('button')===b,overflowY:s.overflowY})})()";
            long deadline = SystemClock.elapsedRealtime() + 8_000L;
            while (SystemClock.elapsedRealtime() < deadline) {
                JSONObject probe = new JSONObject(domString(expression));
                if (!probe.optBoolean("found")) throw new IllegalStateException("navigation end button unavailable in guidance content");
                JSONObject container = probe.getJSONObject("container"), button = probe.getJSONObject("button");
                if (probe.optBoolean("fullyVisible") && probe.optBoolean("hit")) return;
                if (!"auto".equals(probe.optString("overflowY")) && !"scroll".equals(probe.optString("overflowY")))
                    throw new IllegalStateException("navigation details content is not scrollable");
                double x = container.getDouble("x") + container.getDouble("width") * .65;
                boolean buttonBelow = button.getDouble("bottom") > container.getDouble("y") + container.getDouble("height");
                double startY = container.getDouble("y") + container.getDouble("height") * (buttonBelow ? .82 : .25);
                double endY = container.getDouble("y") + container.getDouble("height") * (buttonBelow ? .38 : .72);
                swipeCss((float)x, (float)startY, (float)x, (float)endY, 260L);
                SystemClock.sleep(120L);
            }
            throw new IllegalStateException("navigation end button did not become visible after scrolling details");
        }

        private boolean waitForRouteAndGuidanceClear(long timeout) throws Exception {
            long end = SystemClock.elapsedRealtime() + timeout;
            while (SystemClock.elapsedRealtime() < end) {
                JSONObject state = (JSONObject)callParent("readState");
                JSONObject routeOverlay = state.optJSONObject("routeOverlay");
                JSONObject evidence = guidanceActivityEvidence(state);
                boolean noGuidance = !evidence.optBoolean("active");
                boolean noRoute = !hasActiveRoute(routeOverlay);
                if (noGuidance && noRoute && !evidence.optBoolean("cardVisible")) return true;
                SystemClock.sleep(100L);
            }
            return false;
        }

        private JSONObject closeSharedColorPickerThroughUi() throws Exception {
            JSONObject result = new JSONObject().put("status", "RUNNING");
            String stage = "inspect";
            try {
                boolean visible = domBoolean("(()=>{const e=document.querySelector('.app-color-picker');if(!e)return false;const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)!==0&&r.width>0&&r.height>0})()");
                result.put("wasVisible", visible);
                if (!visible) return result.put("status", "PASS");

                stage = "dismiss-keyboard-if-custom-input-focused";
                boolean customInputFocused = domBoolean("document.activeElement===document.querySelector('.app-color-picker input[aria-label=\"自定义颜色值\"]')");
                result.put("customInputFocusedAtCleanup", customInputFocused);
                if (customInputFocused) {
                    parent.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
                    callParent("awaitWebViewDraw");
                }
                if (!domBoolean("(()=>{const e=document.querySelector('.app-color-picker');if(!e)return false;const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0})()"))
                    return result.put("closedByKeyboardBack", true).put("status", "PASS");

                stage = "return-from-custom-mode";
                boolean customMode = domBoolean("!!document.querySelector('.app-color-picker input[aria-label=\"自定义颜色值\"]')");
                if (customMode) {
                    tapControlCenter(".app-color-picker button[aria-label='返回常用颜色']", "cleanup-color-picker-return");
                    result.put("returnedToPalette", true);
                    long end = SystemClock.elapsedRealtime() + 3_000L;
                    while (SystemClock.elapsedRealtime() < end && !domBoolean("!!document.querySelector('.app-color-picker button[aria-label=\"关闭颜色选择\"]')"))
                        SystemClock.sleep(80L);
                }

                stage = "tap-close-button";
                if (!domBoolean("!!document.querySelector('.app-color-picker button[aria-label=\"关闭颜色选择\"]')"))
                    throw new IllegalStateException("shared color picker close button unavailable");
                tapControlCenter(".app-color-picker button[aria-label='关闭颜色选择']", "cleanup-color-picker-close");
                JSONObject closed = awaitColorPicker(false, null, 3_000L);
                return result.put("closedByRealButton", true).put("closedState", closed).put("status", "PASS");
            } catch (Throwable error) {
                result.put("status", "FAIL").put("failedStage", stage)
                    .put("errorType", error.getClass().getSimpleName()).put("exceptionEvidence", exceptionEvidence(error));
                return result;
            }
        }

        private void setAutoRecordThroughUi(boolean enabled) throws Exception {
            if (!domBoolean("!!document.querySelector('.record-console')")) tapButton(".home-bottom-nav", "记录");
            waitForVisible(".record-console", 5_000L, "record settings panel did not open");
            String summary = ".record-console details.record-group-settings > summary";
            if (!domBoolean("document.querySelector(" + q(summary) + ")?.parentElement?.open")) tapElement(summary);
            String selector = ".record-console input[type='checkbox']";
            JSONObject state = checkboxProbe(selector);
            if (!state.optBoolean("found")) throw new IllegalStateException("auto-record checkbox missing from recording settings");
            if (state.optBoolean("checked") != enabled) {
                tapRect(state.getJSONObject("rect"));
                long end = SystemClock.elapsedRealtime() + 3_000L;
                while (SystemClock.elapsedRealtime() < end) {
                    state = checkboxProbe(selector);
                    if (state.optBoolean("checked") == enabled) break;
                    SystemClock.sleep(80L);
                }
            }
            if (state.optBoolean("checked") != enabled) throw new IllegalStateException("auto-record setting did not update through its UI");
            if (!enabled) samplingTemporarilyChanged = true;
            tapButton(".home-bottom-nav", "记录");
            waitForAbsent(".record-console", 5_000L);
        }

        private JSONObject checkboxProbe(String selector) throws Exception {
            return new JSONObject(domString("(()=>{const e=document.querySelector(" + q(selector) + ");if(!e)return JSON.stringify({found:false});const r=e.getBoundingClientRect(),p=e.closest('label')?.getBoundingClientRect()||r;return JSON.stringify({found:true,checked:!!e.checked,rect:{x:p.left+p.width/2,y:p.top+p.height/2,width:p.width,height:p.height}})})()"));
        }

        private boolean samplingSupported() throws Exception {
            return domBoolean("(()=>{const b=window.GuanyunNative;return !b||!!(b.recordingSampling&&b.setRecordingSampling)})()");
        }

        private void setRoutingMode(String value) throws Exception {
            String script = "(()=>{const k=" + q(ROUTING_MODE_KEY) + ",old=localStorage.getItem(k),v=" + q(value) + ";localStorage.setItem(k,v);window.dispatchEvent(new Event('shantu-routing-mode-changed'));return JSON.stringify({set:localStorage.getItem(k)===v,old})})()";
            if (!new JSONObject(domString(script)).optBoolean("set")) throw new IllegalStateException("offline routing preference did not apply");
        }

        private void restoreRoutingMode() throws Exception {
            String val = originalRoutingMode == null ? "null" : q(originalRoutingMode);
            String script = "(()=>{const k=" + q(ROUTING_MODE_KEY) + ",v=" + val + ";if(v===null)localStorage.removeItem(k);else localStorage.setItem(k,v);window.dispatchEvent(new Event('shantu-routing-mode-changed'));return JSON.stringify({ok:localStorage.getItem(k)===(v===null?null:v)})})()";
            if (!new JSONObject(domString(script)).optBoolean("ok")) throw new IllegalStateException("routing preference did not restore");
        }

        private void ensureDirectionRestored() throws Exception {
            String current = readDirectionMode();
            if (originalDirection.isEmpty() || current.equals(originalDirection)) return;
            if ("device".equals(originalDirection)) throw new IllegalStateException("cannot restore original device-heading mode without changing sensor permission");
            tapElement(".position-direction-button");
            String label = "motion".equals(originalDirection) ? "运动方向朝上" : "north".equals(originalDirection) ? "正北朝上" : "自由转向";
            tapButton(".direction-menu", label);
            long end = SystemClock.elapsedRealtime() + 3_000L;
            while (SystemClock.elapsedRealtime() < end && !originalDirection.equals(readDirectionMode())) SystemClock.sleep(80L);
            if (!originalDirection.equals(readDirectionMode())) throw new IllegalStateException("position direction mode did not restore through UI");
        }

        private void restoreFollowIntent() throws Exception {
            JSONObject current = readFollowButton();
            boolean initial = originalFollow.optBoolean("pressed");
            if (current.optBoolean("pressed") == initial &&
                originalFollow.optString("label").equals(current.optString("label")) &&
                originalFollow.optString("text").equals(current.optString("text"))) return;
            String label = current.optString("label");
            if ("重试定位".equals(label) || "定位中".equals(current.optString("text")))
                throw new IllegalStateException("follow intent is still waiting for a real location; cleanup cannot safely force it");
            if ("关闭位置跟随".equals(label) && !initial) tapElement(".position-locate-button");
            else if ("开启位置跟随".equals(label) && initial) tapElement(".position-locate-button");
            long end = SystemClock.elapsedRealtime() + 5_000L;
            while (SystemClock.elapsedRealtime() < end) {
                current = readFollowButton();
                if (current.optBoolean("pressed") == initial &&
                    originalFollow.optString("label").equals(current.optString("label")) &&
                    originalFollow.optString("text").equals(current.optString("text"))) return;
                SystemClock.sleep(100L);
            }
            throw new IllegalStateException("follow control did not return to its original visible state");
        }

        private JSONObject readFollowButton() throws Exception {
            return new JSONObject(domString("(()=>{const b=document.querySelector('.position-locate-button');return JSON.stringify({found:!!b,label:b?.getAttribute('aria-label')||'',pressed:b?.getAttribute('aria-pressed')==='true',text:(b?.innerText||'').trim()})})()"));
        }

        private String readDirectionMode() throws Exception {
            return domString("(()=>{const b=document.querySelector('.position-direction-button');return b?.title==='运动方向朝上'?'motion':b?.title==='手机朝向朝上'?'device':b?.title==='正北朝上'?'north':b?'free':''})()");
        }

        private JSONObject cleanup() {
            JSONObject result = new JSONObject();
            String cleanupStage = "start";
            try {
                JSONObject pickerCleanup = closeSharedColorPickerThroughUi();
                result.put("colorPickerCleanup", pickerCleanup)
                    .put("sharedColorPickerClosedThroughUi", "PASS".equals(pickerCleanup.optString("status")));
            } catch (Throwable error) {
                putError(result, "colorPickerCleanupError", error);
                try { result.put("colorPickerCleanupExceptionEvidence", exceptionEvidence(error)); }
                catch (JSONException ignored) { }
            }
            try {
                cleanupStage = "end-guidance";
                boolean hadGuidance = guidanceStarted || guidanceActivityEvidence((JSONObject)callParent("readState")).optBoolean("active");
                if (hadGuidance) endGuidanceThroughUi();
                boolean routeCleared = !hadGuidance || waitForRouteAndGuidanceClear(8_000L);
                result.put("guidanceEndedThroughUi", routeCleared);
            } catch (Throwable error) { putError(result, "guidanceCleanupError", error); }
            try {
                if (!result.optBoolean("sharedColorPickerClosedThroughUi"))
                    throw new IllegalStateException("route UI cleanup skipped because shared color picker remains open");
                if (nativeSelectPopupObserved) {
                    cleanupStage = "dismiss-confirmed-native-select-popup";
                    boolean dismissed = parent.getUiAutomation().performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK);
                    if (!dismissed) {
                        long now = SystemClock.uptimeMillis();
                        parent.getUiAutomation().injectInputEvent(new KeyEvent(now, now, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_BACK, 0), true);
                        parent.getUiAutomation().injectInputEvent(new KeyEvent(now + 20L, now + 20L, KeyEvent.ACTION_UP, KeyEvent.KEYCODE_BACK, 0), true);
                    }
                    result.put("confirmedNativeSelectPopupDismissRequested", true)
                        .put("nativeSelectPopupDismissGlobalActionAccepted", dismissed);
                    SystemClock.sleep(300L);
                    nativeSelectPopupObserved = false;
                }
                cleanupStage = "inspect-route-ui";
                boolean routePanelVisible = domBoolean("(()=>{const e=document.querySelector('#map-control-panel .route-panel:not(.route-summary)');if(!e)return false;const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0})()");
                boolean summaryVisible = routeSummaryVisible();
                result.put("routePanelVisibleBeforeCleanup", routePanelVisible).put("routeSummaryVisibleBeforeCleanup", summaryVisible);
                if (routePanelOpened && (routePanelVisible || summaryVisible)) {
                    JSONObject state = (JSONObject)callParent("readState");
                    JSONObject overlay = state.optJSONObject("routeOverlay");
                    if (hasActiveRoute(overlay) || summaryVisible) {
                        cleanupStage = "expand-route-summary-details";
                        if (!domBoolean("document.querySelector('.route-summary-details-toggle')?.getAttribute('aria-expanded')==='true'")) {
                            tapButton(".route-summary", "详情");
                            waitForVisible(".route-summary-detail", 5_000L, "route summary details did not expand");
                        }
                        cleanupStage = "cancel-route-summary";
                        tapButton(".route-summary-detail", "取消路线");
                        cleanupStage = "wait-route-summary-clear";
                        if (!waitForRouteSummaryHidden(8_000L)) throw new IllegalStateException("route summary did not close after cancel action");
                        if (!waitForRouteAndGuidanceClear(8_000L)) throw new IllegalStateException("route state did not clear after cancel action");
                    }
                    cleanupStage = "close-route-planner-if-still-open";
                    boolean plannerStillVisible = domBoolean("(()=>{const e=document.querySelector('#map-control-panel .route-panel:not(.route-summary)');if(!e)return false;const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0})()");
                    if (plannerStillVisible) tapButton(".home-bottom-nav", "路线");
                }
            } catch (Throwable error) {
                putError(result, "routeUiCleanupError", error);
                try { result.put("routeUiCleanupStage", cleanupStage).put("routeUiCleanupExceptionEvidence", exceptionEvidence(error)); }
                catch (JSONException ignored) { }
            }
            try { ensureDirectionRestored(); result.put("directionRestored", true); }
            catch (Throwable error) { putError(result, "directionRestoreError", error); }
            try { restoreFollowIntent(); result.put("followIntentRestored", true); }
            catch (Throwable error) { putError(result, "followRestoreError", error); }
            try {
                if (cameraCaptured) {
                    callParent("applyCamera", originalCamera);
                    result.put("cameraRestored", true);
                }
            } catch (Throwable error) { putError(result, "cameraRestoreError", error); }
            try { if (routingModeCaptured) { restoreRoutingMode(); result.put("routingModeRestored", true); } }
            catch (Throwable error) { putError(result, "routingModeRestoreError", error); }
            try { if (samplingTemporarilyChanged) { setAutoRecordThroughUiRestore(); result.put("autoRecordRestoredThroughUi", true); } }
            catch (Throwable error) { putError(result, "autoRecordRestoreError", error); }
            try { if (samplingTemporarilyChanged) restoreSamplingExact(); result.put("samplingPreferenceRestored", true); }
            catch (Throwable error) { putError(result, "samplingPreferenceRestoreError", error); }
            try { removeQaGraph(); result.put("qaGraphRemoved", !graphWriteAttempted || graphAbsent()); }
            catch (Throwable error) { putError(result, "qaGraphCleanupError", error); }
            try { restoreClipboard(); result.put("clipboardRestored", true); }
            catch (Throwable error) { putError(result, "clipboardRestoreError", error); }
            try {
                restoreUiAutomationAccessibility(result);
            } catch (Throwable error) { putError(result, "uiAutomationServiceInfoRestoreError", error); }
            try {
                JSONObject finalState = (JSONObject)callParent("readState");
                JSONObject route = finalState.optJSONObject("routeOverlay");
                boolean summaryStillVisible = routeSummaryVisible();
                boolean noRoute = !hasActiveRoute(route) && !summaryStillVisible;
                boolean noGuidance = !guidanceActivityEvidence(finalState).optBoolean("active");
                boolean noRecord = finalState.optJSONObject("trackOverlay") == null || !hasLiveRecording(finalState.optJSONObject("trackOverlay").optJSONArray("saved"));
                result.put("routeSummaryVisibleAfterCleanup", summaryStillVisible)
                    .put("routeAndGuidanceClear", noRoute && noGuidance).put("recordingStillIdle", noRecord)
                    .put("trackCountAfter", trackCount(finalState)).put("trackCountUnchanged", originalTrackCount < 0 || originalTrackCount == trackCount(finalState))
                    .put("selectionUnchanged", selectedId(finalState).equals(selectedId(originalState)));
            } catch (Throwable error) { putError(result, "finalStateError", error); }
            try { result.put("pass", cleanupPass(result)); } catch (JSONException ignored) { }
            return result;
        }

        private void restoreSamplingExact() throws Exception {
            if (!samplingCaptured) return;
            if (originalSamplingNative) {
                if (originalSamplingRaw != null) {
                    String script = "(()=>{const b=window.GuanyunNative;if(!b?.setRecordingSampling)return JSON.stringify({ok:false});return JSON.stringify({ok:!!b.setRecordingSampling(" + q(originalSamplingRaw) + ")})})()";
                    if (!new JSONObject(domString(script)).optBoolean("ok")) throw new IllegalStateException("native sampling preference did not restore");
                }
            } else {
                String value = originalSamplingRaw == null ? "null" : q(originalSamplingRaw);
                String script = "(()=>{const k=" + q(SAMPLING_KEY) + ",v=" + value + ";if(v===null)localStorage.removeItem(k);else localStorage.setItem(k,v);return JSON.stringify({ok:localStorage.getItem(k)===(v===null?null:v)})})()";
                if (!new JSONObject(domString(script)).optBoolean("ok")) throw new IllegalStateException("sampling preference text did not restore");
            }
        }

        private boolean cleanupPass(JSONObject state) {
            return state.optBoolean("guidanceEndedThroughUi") && state.optBoolean("directionRestored") &&
                state.optBoolean("followIntentRestored") && state.optBoolean("cameraRestored") &&
                state.optBoolean("routingModeRestored") && state.optBoolean("samplingPreferenceRestored") &&
                state.optBoolean("sharedColorPickerClosedThroughUi") &&
                state.optBoolean("qaGraphRemoved") && state.optBoolean("clipboardRestored") &&
                state.optBoolean("routeAndGuidanceClear") && state.optBoolean("recordingStillIdle") &&
                state.optBoolean("trackCountUnchanged") && state.optBoolean("selectionUnchanged") &&
                (!uiAutomationServiceInfoCaptured || state.optBoolean("uiAutomationServiceInfoRestored")) &&
                (!samplingTemporarilyChanged || state.optBoolean("autoRecordRestoredThroughUi"));
        }

        private void removeQaGraph() throws Exception {
            if (!graphWriteAttempted) return;
            String script = "(async()=>{const id=" + q(graphId) + ",db=await new Promise((resolve,reject)=>{const r=indexedDB.open(" + q(DATABASE) + ",1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});try{const tx=db.transaction(['graphs','manifests'],'readwrite');tx.objectStore('graphs').delete(id);tx.objectStore('manifests').delete(id);await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error)});window.dispatchEvent(new Event('shantu-offline-graphs-changed'));return JSON.stringify({removed:true})}finally{db.close()}})()";
            if (!new JSONObject(evalAsync(script, 10_000L)).optBoolean("removed")) throw new IllegalStateException("QA graph remove failed");
        }

        private boolean graphAbsent() throws Exception {
            String script = "(async()=>{const id=" + q(graphId) + ",db=await new Promise((resolve,reject)=>{const r=indexedDB.open(" + q(DATABASE) + ",1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});try{const s=db.transaction(['graphs','manifests'],'readonly'),a=await Promise.all(['graphs','manifests'].map(n=>new Promise((resolve,reject)=>{const r=s.objectStore(n).get(id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})));return JSON.stringify({absent:!a.some(Boolean)})}finally{db.close()}})()";
            return new JSONObject(evalAsync(script, 8_000L)).optBoolean("absent");
        }

        private boolean renderedRoutePresent() throws Exception {
            final boolean[] result = {false};
            final Throwable[] error = {null};
            parent.runOnMainSync(() -> {
                try {
                    Object renderer = field(entry, "overlayRenderer"), groups = field(renderer, "groups");
                    if (!(groups instanceof Map)) return;
                    for (Map.Entry<?, ?> group : ((Map<?, ?>)groups).entrySet())
                        if (String.valueOf(group.getKey()).startsWith("routes:") && containsPath(group.getValue(), 0)) { result[0] = true; return; }
                } catch (Throwable failure) { error[0] = failure; }
            });
            if (error[0] != null) throw new IllegalStateException("native route overlay read failed: " + error[0].getClass().getSimpleName());
            return result[0];
        }

        private boolean containsPath(Object value, int depth) {
            if (value == null || depth > 3) return false;
            for (Class<?> type = value.getClass(); type != null; type = type.getSuperclass()) if ("Path".equals(type.getSimpleName())) return true;
            if (value instanceof Iterable) for (Object item : (Iterable<?>)value) if (containsPath(item, depth + 1)) return true;
            return false;
        }

        private void tapButton(String selector, String text) throws Exception {
            Object info = callParent("tapDomButton", selector, text, cssScale);
            if (!(info instanceof JSONObject) || !((JSONObject)info).optBoolean("hit")) throw new IllegalStateException("button touch missed: " + text);
        }

        private void tapElement(String selector) throws Exception {
            JSONObject point = new JSONObject(domString("(()=>{const e=document.querySelector(" + q(selector) + ");if(!e)return JSON.stringify({found:false});const r=e.getBoundingClientRect(),s=getComputedStyle(e),x=r.left+r.width/2,y=r.top+r.height/2,h=document.elementFromPoint(x,y);return JSON.stringify({found:true,visible:s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)!==0&&r.width>0&&r.height>0,hit:h===e||e.contains(h),x,y})})()"));
            if (!point.optBoolean("found") || !point.optBoolean("visible") || !point.optBoolean("hit")) throw new IllegalStateException("element is not visible/hit-testable: " + selector);
            tapCss((float)point.getDouble("x"), (float)point.getDouble("y"));
        }

        private void tapRect(JSONObject rect) throws Exception { tapCss((float)(rect.getDouble("x") + rect.getDouble("width") / 2), (float)(rect.getDouble("y") + rect.getDouble("height") / 2)); }

        private void tapCss(float x, float y) throws Exception {
            int[] origin = new int[2];
            parent.runOnMainSync(() -> webView.getLocationOnScreen(origin));
            callParent("tap", origin[0] + x * (float)cssScale, origin[1] + y * (float)cssScale);
        }

        private void swipeCss(float startX, float startY, float endX, float endY, long durationMs) throws Exception {
            int[] origin = new int[2];
            parent.runOnMainSync(() -> webView.getLocationOnScreen(origin));
            float x1 = origin[0] + startX * (float)cssScale;
            float y1 = origin[1] + startY * (float)cssScale;
            float x2 = origin[0] + endX * (float)cssScale;
            float y2 = origin[1] + endY * (float)cssScale;
            long down = SystemClock.uptimeMillis();
            sendMotion(MotionEvent.ACTION_DOWN, down, down, x1, y1);
            int moves = Math.max(3, (int)(durationMs / 40L));
            for (int i = 1; i <= moves; i++) {
                SystemClock.sleep(Math.max(1L, durationMs / moves));
                float fraction = i / (float)moves;
                sendMotion(MotionEvent.ACTION_MOVE, down, SystemClock.uptimeMillis(),
                    x1 + (x2 - x1) * fraction, y1 + (y2 - y1) * fraction);
            }
            sendMotion(MotionEvent.ACTION_UP, down, SystemClock.uptimeMillis(), x2, y2);
        }

        private boolean accessibilityPaste(String selector, String expected) throws Exception {
            tapElement(selector);
            longPressCss(selector);
            long end = SystemClock.elapsedRealtime() + 2_000L;
            while (SystemClock.elapsedRealtime() < end) {
                AccessibilityNodeInfo root = parent.getUiAutomation().getRootInActiveWindow();
                if (root != null) for (String label : new String[]{"粘贴", "Paste"}) {
                    List<AccessibilityNodeInfo> nodes = root.findAccessibilityNodeInfosByText(label);
                    if (nodes == null) continue;
                    for (AccessibilityNodeInfo node : nodes) {
                        Rect rect = new Rect(); node.getBoundsInScreen(rect);
                        if (!rect.isEmpty() && node.isVisibleToUser()) {
                            callParent("tap", (rect.left + rect.right) / 2f, (rect.top + rect.bottom) / 2f);
                            if (waitInputValue(selector, expected, 1_500L)) return true;
                        }
                    }
                }
                SystemClock.sleep(100L);
            }
            return false;
        }

        private void longPressCss(String selector) throws Exception {
            JSONObject point = new JSONObject(domString("(()=>{const e=document.querySelector(" + q(selector) + ");if(!e)return JSON.stringify({found:false});const r=e.getBoundingClientRect();return JSON.stringify({found:true,x:r.left+r.width/2,y:r.top+r.height/2})})()"));
            if (!point.optBoolean("found")) return;
            int[] origin = new int[2]; parent.runOnMainSync(() -> webView.getLocationOnScreen(origin));
            float x = origin[0] + (float)point.getDouble("x") * (float)cssScale;
            float y = origin[1] + (float)point.getDouble("y") * (float)cssScale;
            long down = SystemClock.uptimeMillis();
            sendMotion(MotionEvent.ACTION_DOWN, down, down, x, y);
            SystemClock.sleep(750L);
            sendMotion(MotionEvent.ACTION_UP, down, SystemClock.uptimeMillis(), x, y);
        }

        private void sendMotion(int action, long down, long time, float x, float y) {
            MotionEvent event = MotionEvent.obtain(down, time, action, x, y, 0);
            event.setSource(InputDevice.SOURCE_TOUCHSCREEN);
            try { parent.sendPointerSync(event); } finally { event.recycle(); }
        }

        private boolean waitInputValue(String selector, String expected, long timeout) throws Exception {
            String script = "(()=>{const e=document.querySelector(" + q(selector) + ");return JSON.stringify({found:!!e,value:e?.value||''})})()";
            long end = SystemClock.elapsedRealtime() + timeout;
            while (SystemClock.elapsedRealtime() < end) {
                JSONObject value = new JSONObject(domString(script));
                if (value.optBoolean("found") && expected.equals(value.optString("value"))) return true;
                SystemClock.sleep(80L);
            }
            return false;
        }

        private void writeClipboard(String text) throws Exception {
            parent.runOnMainSync(() -> {
                ClipboardManager manager = (ClipboardManager)parent.getTargetContext().getSystemService(Context.CLIPBOARD_SERVICE);
                if (manager == null) throw new IllegalStateException("clipboard unavailable");
                manager.setPrimaryClip(ClipData.newPlainText("QA coordinate", text));
            });
        }

        private ClipData readClipboard() throws Exception {
            final ClipData[] result = new ClipData[1];
            parent.runOnMainSync(() -> {
                ClipboardManager manager = (ClipboardManager)parent.getTargetContext().getSystemService(Context.CLIPBOARD_SERVICE);
                result[0] = manager == null ? null : manager.getPrimaryClip();
            });
            return result[0];
        }

        private void restoreClipboard() throws Exception {
            if (!clipboardCaptured) return;
            parent.runOnMainSync(() -> {
                ClipboardManager manager = (ClipboardManager)parent.getTargetContext().getSystemService(Context.CLIPBOARD_SERVICE);
                if (manager != null) {
                    if (originalClipboard == null) manager.clearPrimaryClip();
                    else manager.setPrimaryClip(originalClipboard);
                }
            });
            clipboardCaptured = false;
        }

        private void waitForVisible(String selector, long timeout, String message) throws Exception {
            long end = SystemClock.elapsedRealtime() + timeout;
            while (SystemClock.elapsedRealtime() < end) {
                if (domBoolean("(()=>{const e=document.querySelector(" + q(selector) + ");if(!e)return false;const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0})()")) return;
                SystemClock.sleep(100L);
            }
            throw new IllegalStateException(message);
        }

        private void waitForAbsent(String selector, long timeout) throws Exception {
            long end = SystemClock.elapsedRealtime() + timeout;
            while (SystemClock.elapsedRealtime() < end) {
                if (!domBoolean("!!document.querySelector(" + q(selector) + ")")) return;
                SystemClock.sleep(80L);
            }
            throw new IllegalStateException("temporary panel did not close");
        }

        private boolean routeSummaryVisible() throws Exception {
            return domBoolean("(()=>{const e=document.querySelector('#map-control-panel .route-summary');if(!e)return false;const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)!==0&&r.width>0&&r.height>0})()");
        }

        private boolean waitForRouteSummaryHidden(long timeout) throws Exception {
            long end = SystemClock.elapsedRealtime() + timeout;
            while (SystemClock.elapsedRealtime() < end) {
                if (!routeSummaryVisible()) return true;
                SystemClock.sleep(100L);
            }
            return false;
        }

        private void setAutoRecordThroughUiRestore() throws Exception {
            JSONObject policy = originalSamplingRaw == null ? null : new JSONObject(originalSamplingRaw);
            boolean desired = policy != null && policy.optBoolean("recordOnNavigation", false);
            if (samplingTemporarilyChanged) setAutoRecordThroughUi(desired);
        }

        private void putError(JSONObject object, String key, Throwable error) {
            try { object.put(key, safeMessage(error)); } catch (JSONException ignored) { }
        }

        private int trackCount(JSONObject state) {
            JSONObject tracks = state == null ? null : state.optJSONObject("trackOverlay");
            JSONArray saved = tracks == null ? null : tracks.optJSONArray("saved");
            return saved == null ? 0 : saved.length();
        }

        private boolean hasDraft(JSONArray draft) {
            if (draft == null) return false;
            for (int i = 0; i < draft.length(); i++) { JSONArray segment = draft.optJSONArray(i); if (segment != null && segment.length() > 0) return true; }
            return false;
        }

        private boolean hasLiveRecording(JSONArray saved) {
            if (saved == null) return false;
            for (int i = 0; i < saved.length(); i++) { JSONObject item = saved.optJSONObject(i); if (item != null && "live-recording".equals(item.optString("id"))) return true; }
            return false;
        }

        private boolean hasValue(JSONObject object, String key) { Object value = object.opt(key); return value != null && value != JSONObject.NULL; }
        private boolean hasActiveRoute(JSONObject overlay) {
            if (overlay == null || overlay == JSONObject.NULL) return false;
            Object value = overlay.opt("route");
            if (value == null || value == JSONObject.NULL) return false;
            if (value instanceof JSONObject) return ((JSONObject)value).length() > 0;
            return true;
        }
        private String selectedId(JSONObject state) {
            if (state == null) return "";
            Object value = state.opt("annotationSelected");
            if (value == null || value == JSONObject.NULL) return "";
            String id = String.valueOf(value);
            return id.isEmpty() || "null".equals(id) ? "" : id;
        }
        private String q(String value) { return JSONObject.quote(value); }
        private String domString(String script) throws Exception { return String.valueOf(callParent("evalJs", script)); }
        private boolean domBoolean(String script) throws Exception { return "true".equals(domString(script)); }
        private Object callParent(String name, Object... args) throws Exception { return invoke(parent, name, args); }

        private String evalAsync(String expression, long timeout) throws Exception {
            String token = "n" + UUID.randomUUID().toString().replace("-", "");
            String key = q(token);
            String start = "(()=>{window.__qa163Async=window.__qa163Async||{};window.__qa163Async[" + key + "]=null;Promise.resolve().then(()=>" + expression + ").then(v=>window.__qa163Async[" + key + "]=JSON.stringify({ok:true,value:v}),e=>window.__qa163Async[" + key + "]=JSON.stringify({ok:false}));return true})()";
            if (!domBoolean(start)) throw new IllegalStateException("async operation did not start");
            long end = SystemClock.elapsedRealtime() + timeout;
            while (SystemClock.elapsedRealtime() < end) {
                String raw = domString("(()=>window.__qa163Async&&window.__qa163Async[" + key + "]||'')()");
                if (raw != null && !raw.isEmpty()) {
                    JSONObject value = new JSONObject(raw);
                    domString("(()=>{delete window.__qa163Async[" + key + "];return true})()");
                    if (!value.optBoolean("ok")) throw new IllegalStateException("async operation failed");
                    Object result = value.opt("value");
                    return result == null || result == JSONObject.NULL ? "null" : String.valueOf(result);
                }
                SystemClock.sleep(100L);
            }
            domString("(()=>{delete window.__qa163Async[" + key + "];return true})()");
            throw new IllegalStateException("async operation timed out");
        }

        private String safeMessage(Throwable error) {
            return error.getClass().getSimpleName();
        }

        private JSONObject exceptionEvidence(Throwable error) {
            JSONArray causes = new JSONArray(), frames = new JSONArray();
            try {
                Throwable current = error;
                for (int depth = 0; current != null && depth < 6; depth++, current = current.getCause())
                    causes.put(current.getClass().getName());
                StackTraceElement[] trace = error == null ? new StackTraceElement[0] : error.getStackTrace();
                for (int i = 0; i < trace.length && i < 6; i++) {
                    StackTraceElement frame = trace[i];
                    frames.put(new JSONObject().put("class", frame.getClassName()).put("method", frame.getMethodName()).put("line", frame.getLineNumber()));
                }
                return new JSONObject().put("causes", causes).put("topFrames", frames);
            } catch (JSONException ignored) {
                return new JSONObject();
            }
        }

        private void initializeScreenshotDirectory() throws Exception {
            File base = parent.getTargetContext().getExternalFilesDir(null);
            if (base == null) throw new IllegalStateException("private screenshot storage unavailable");
            File canonicalBase = base.getCanonicalFile();
            File directory = new File(canonicalBase, "Pictures/native163-ui/navigation-" + UUID.randomUUID()).getCanonicalFile();
            if (!directory.toPath().startsWith(canonicalBase.toPath())) throw new IllegalStateException("private screenshot path escaped app storage");
            if (!directory.mkdirs() && !directory.isDirectory()) throw new IllegalStateException("private screenshot directory could not be created");
            screenshotDirectory = directory;
            progressFile = new File(directory, "progress.txt");
        }

        private void progress(String stage) {
            if (progressFile == null || stage == null || !stage.matches("[a-z0-9-]{1,80}")) return;
            try (FileOutputStream stream = new FileOutputStream(progressFile, false)) {
                stream.write((stage + "\n").getBytes(java.nio.charset.StandardCharsets.UTF_8));
                stream.flush();
            } catch (Exception ignored) { }
        }

        private void captureScreenshot(String name) throws Exception {
            if (screenshotDirectory == null) throw new IllegalStateException("private screenshot directory was not initialized");
            if (name == null || !name.matches("[a-z0-9-]{1,64}")) throw new IllegalArgumentException("invalid QA screenshot name");
            // Allow WebView's committed UI frame to reach the display compositor.
            SystemClock.sleep(750L);
            Bitmap image = parent.getUiAutomation().takeScreenshot();
            if (image == null) throw new IllegalStateException("native screenshot capture returned no image");
            File output = new File(screenshotDirectory, name + ".png").getCanonicalFile();
            if (!screenshotDirectory.equals(output.getParentFile())) {
                image.recycle();
                throw new IllegalStateException("QA screenshot path escaped private evidence directory");
            }
            try (FileOutputStream stream = new FileOutputStream(output, false)) {
                if (!image.compress(Bitmap.CompressFormat.PNG, 100, stream)) throw new IllegalStateException("PNG screenshot encoding failed");
                stream.flush();
            } finally { image.recycle(); }
            screenshots.put(new JSONObject().put("name", name).put("path", output.getAbsolutePath()));
        }

        private String safeScreenshotStage(String stage) {
            if (stage == null) return "unknown";
            String safe = stage.toLowerCase(java.util.Locale.ROOT).replaceAll("[^a-z0-9-]", "-");
            return safe.substring(0, Math.min(50, safe.length()));
        }

        private static boolean targetAlreadyAttached(Native149Instrumentation parent) {
            try {
                Object activity = field(parent, "activity"), host = field(parent, "host"), entry = field(parent, "entry");
                Object maps = host == null ? null : field(host, "maps");
                return activity instanceof Activity && !((Activity)activity).isFinishing() && !((Activity)activity).isDestroyed() &&
                    "com.guanyun.weather.NativeReactActivity".equals(activity.getClass().getName()) && host != null &&
                    "com.shantu.nativeapp.hybrid.NativeReactMapHost".equals(host.getClass().getName()) &&
                    maps instanceof Map && ((Map<?, ?>)maps).get("main") == entry && entry != null &&
                    field(entry, "controller") != null && field(entry, "renderState") instanceof JSONObject;
            } catch (Throwable ignored) { return false; }
        }

        private void put(String key, Object value) { try { report.put(key, value); } catch (JSONException ignored) { } }
    }

    private static final class PreconditionBlocked extends RuntimeException {
        PreconditionBlocked(String message) { super(message); }
    }

    private static Object invoke(Object owner, String name, Object... args) throws Exception {
        for (Class<?> type = owner.getClass(); type != null; type = type.getSuperclass()) {
            for (Method method : type.getDeclaredMethods()) {
                if (!method.getName().equals(name) || method.getParameterTypes().length != args.length) continue;
                boolean valid = true;
                Class<?>[] parameters = method.getParameterTypes();
                for (int i = 0; i < parameters.length; i++) if (!compatible(parameters[i], args[i])) { valid = false; break; }
                if (!valid) continue;
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

    private static boolean compatible(Class<?> type, Object value) {
        if (value == null) return !type.isPrimitive();
        if (type.isInstance(value)) return true;
        if (!type.isPrimitive()) return false;
        return (type == float.class && value instanceof Float) || (type == double.class && value instanceof Double) ||
            (type == int.class && value instanceof Integer) || (type == long.class && value instanceof Long) || (type == boolean.class && value instanceof Boolean);
    }

    private static Object field(Object owner, String name) throws Exception {
        for (Class<?> type = owner.getClass(); type != null; type = type.getSuperclass()) {
            try { Field field = type.getDeclaredField(name); field.setAccessible(true); return field.get(owner); }
            catch (NoSuchFieldException ignored) { }
        }
        throw new NoSuchFieldException(owner.getClass().getName() + "." + name);
    }
}
