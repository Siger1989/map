package com.shantu.qa149;

import android.os.Environment;
import android.os.SystemClock;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStreamReader;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.Set;
import java.util.UUID;

/** Two real-UI, offline-only vehicle routing checks for the native map host. */
public final class Native158OfflineRegression {
    private static final String FIXTURE_NAME = "offline158-qa.json";
    private static final String DATABASE = "shantu-offline-routing-v1";
    private static final String MODE_KEY = "shantu.routing-mode.v1";
    private static final long ROUTE_TIMEOUT_MS = 45_000L;

    private Native158OfflineRegression() { }

    public static JSONObject run(Native149Instrumentation parent) {
        return new Runner(parent).run();
    }

    private static final class Runner {
        final Native149Instrumentation parent;
        final JSONObject report = new JSONObject();
        final JSONArray modes = new JSONArray();
        final String runId = UUID.randomUUID().toString().replace("-", "");
        final String motorcarId = "qa158-" + runId + "-motorcar";
        final String motorcycleId = "qa158-" + runId + "-motorcycle";
        Object host;
        Object entry;
        Object webView;
        File evidenceDir;
        JSONObject originalCamera;
        JSONObject originalMode;
        JSONObject graphs = new JSONObject();
        double cssScale = 1.0;
        boolean targetAttached;
        boolean idsReserved;
        boolean modeCaptured;
        boolean networkBlockAttempted;
        boolean routePanelOpened;
        Throwable failure;
        String failedStage = "setup";
        String cleanup = "not-started";

        Runner(Native149Instrumentation parent) { this.parent = parent; }

        JSONObject run() {
            put("mode", "native158-offline-vehicle-regression");
            put("runId", runId);
            put("networkBoundary", "应用内window.fetch拦截并设置navigator.onLine=false；操作系统和NativeMap网络未断开");
            put("mapPickBoundary", "通过地图桥接客户端合成touch gate与tap事件注入fixture坐标；不是GPS，也不是用户在屏幕上的真实地图触摸");
            put("sourceFixture", FIXTURE_NAME);
            put("routeModes", modes);
            try {
                failedStage = "attach-target";
                invokeParent("attachTarget");
                targetAttached = true;
                host = getParentField("host");
                entry = getParentField("entry");
                webView = getParentField("webView");
                runParentField("runId", runId);
                evidenceDir = createEvidenceDirectory();
                runParentField("evidenceDir", evidenceDir);
                originalCamera = copyObject(invokeParentObject("invokeCameraJson"));
                JSONObject before = invokeParentObject("readState");
                cssScale = viewportScale();
                refuseExistingTask(before);

                failedStage = "read-fixture";
                graphs = readFixture();
                failedStage = "seed-offline-fixture";
                prepareQaIds();
                idsReserved = true;
                seedGraphs();
                originalMode = parseObject(evalJs("(()=>JSON.stringify({value:localStorage.getItem(" + quote(MODE_KEY) + ")}))()"));
                modeCaptured = true;
                evalJs("(()=>{localStorage.setItem(" + quote(MODE_KEY) + ",'offline');window.dispatchEvent(new Event('shantu-routing-mode-changed'));return 'offline'})()");
                failedStage = "install-fetch-block";
                networkBlockAttempted = true;
                installNetworkBlock();

                failedStage = "open-route-planner";
                routePanelOpened = true;
                tapDomButton(".home-bottom-nav", "路线");
                awaitRoutePlanner();
                tapDomButton(".route-modes", "驾车");
                setEndpoint("start", 13.4048063, 52.5201631);
                setEndpoint("end", 13.4042511, 52.5205732);
                tapDomButton("#map-control-panel .route-panel", "规划路线");
                modes.put(awaitMode("auto", "native158-motorcar"));

                failedStage = "switch-to-motorcycle-planner";
                tapDomButton(".route-summary", "编辑");
                awaitRoutePlanner();
                tapDomButton(".route-modes", "摩托车（离线）");
                modes.put(awaitMode("motorcycle", "native158-motorcycle"));
                put("testState", "PASS");
            } catch (Throwable error) {
                failure = error;
                put("testState", "ERROR");
                put("failedStage", failedStage);
                put("errorType", error.getClass().getName());
                try { put("errorDetails", invokeParent("errorDetails", error)); } catch (Throwable ignored) { }
                String code = error.getMessage();
                put("errorCode", code != null && code.matches("[A-Za-z0-9:_-]{1,120}") ? code : "operation-failed");
            } finally {
                restoreBrowserState();
                removeQaGraphs();
                clearQaRouteUi();
                restoreCamera();
                put("cleanup", cleanup);
                put("qaFixtureIds", new JSONArray().put(motorcarId).put(motorcycleId));
                put("steps", modes);
                if (cleanup.contains("error") || cleanup.contains("incomplete")) put("testState", "ERROR");
                writeReport();
            }
            return report;
        }

        private void refuseExistingTask(JSONObject state) throws Exception {
            JSONObject routeOverlay = state.optJSONObject("routeOverlay");
            JSONObject route = routeOverlay == null ? null : routeOverlay.optJSONObject("route");
            if (route != null || (routeOverlay != null && (routeOverlay.opt("start") != null && routeOverlay.opt("start") != JSONObject.NULL || routeOverlay.opt("end") != null && routeOverlay.opt("end") != JSONObject.NULL)))
                throw new IllegalStateException("existing-route-task");
            JSONObject interaction = state.optJSONObject("interaction");
            JSONObject tracks = state.optJSONObject("trackOverlay");
            if ((interaction != null && interaction.optBoolean("drawingActive")) ||
                (tracks != null && (tracks.optBoolean("drawing") || tracks.optBoolean("editing") || tracks.optBoolean("connecting") || hasDraft(tracks.optJSONArray("draft")) || hasLiveRecording(tracks.optJSONArray("saved")))))
                throw new IllegalStateException("existing-drawing-or-recording-task");
            JSONObject guidance = state.optJSONObject("guidanceOverlay");
            if (guidance != null && guidance != JSONObject.NULL && guidance.optBoolean("active", true))
                throw new IllegalStateException("existing-guidance-task");
            JSONObject dom = parseObject(evalJs("(()=>{const b=document.querySelector('.home-recording-toggle');const p=document.querySelector('#map-control-panel .route-panel');return JSON.stringify({record:b?b.getAttribute('aria-label'):'',routePanel:!!p})})()"));
            String recordingLabel = dom.optString("record", "");
            if (!recordingLabel.isEmpty() && !"开始轨迹记录".equals(recordingLabel))
                throw new IllegalStateException("existing-recording-task");
            if (dom.optBoolean("routePanel")) throw new IllegalStateException("existing-route-panel");
            put("initialTaskGuard", "PASS");
        }

        private boolean hasDraft(JSONArray draft) {
            if (draft == null) return false;
            for (int i = 0; i < draft.length(); i++) {
                JSONArray segment = draft.optJSONArray(i);
                if (segment != null && segment.length() > 0) return true;
            }
            return false;
        }

        private boolean hasLiveRecording(JSONArray saved) {
            if (saved == null) return false;
            for (int i = 0; i < saved.length(); i++) {
                JSONObject track = saved.optJSONObject(i);
                if (track != null && "live-recording".equals(track.optString("id"))) return true;
            }
            return false;
        }

        private JSONObject readFixture() throws Exception {
            File root = parent.getTargetContext().getExternalFilesDir(null);
            if (root == null) throw new IllegalStateException("fixture-root-unavailable");
            File canonicalRoot = root.getCanonicalFile();
            File file = new File(canonicalRoot, FIXTURE_NAME).getCanonicalFile();
            if (!canonicalRoot.equals(file.getParentFile()) || !file.isFile() || file.length() <= 0 || file.length() > 4L * 1024L * 1024L)
                throw new IllegalStateException("offline158-qa.json-missing-or-invalid-size");
            StringBuilder text = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(new FileInputStream(file), "UTF-8"))) {
                char[] buffer = new char[8192]; int read;
                while ((read = reader.read(buffer)) >= 0) {
                    text.append(buffer, 0, read);
                    if (text.length() > 4 * 1024 * 1024) throw new IllegalStateException("fixture-too-large");
                }
            }
            Object parsed = new JSONTokener(text.toString()).nextValue();
            if (!(parsed instanceof JSONObject)) throw new IllegalStateException("fixture-root-must-be-object");
            JSONObject rootObject = (JSONObject)parsed;
            JSONObject car = rootObject.optJSONObject("motorcar");
            JSONObject moto = rootObject.optJSONObject("motorcycle");
            validateGraph(car, "motorcar");
            validateGraph(moto, "motorcycle");
            return new JSONObject().put("motorcar", car).put("motorcycle", moto);
        }

        private void validateGraph(JSONObject graph, String profile) {
            if (graph == null || !"shantu-offline-routing".equals(graph.optString("format")) || graph.optInt("version") != 2 || !profile.equals(graph.optString("profile")) ||
                graph.optJSONArray("nodes") == null || graph.optJSONArray("nodes").length() < 2 || graph.optJSONArray("edges") == null || graph.optJSONArray("edges").length() < 1 || graph.optJSONArray("bounds") == null || graph.optJSONArray("turnRestrictions") == null)
                throw new IllegalArgumentException("fixture-graph-invalid:" + profile);
        }

        private void prepareQaIds() throws Exception {
            String script = "(async()=>{const ids=" + jsonArray(motorcarId, motorcycleId) + ";const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(" + quote(DATABASE) + ",1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('graphs'))r.result.createObjectStore('graphs',{keyPath:'id'});if(!r.result.objectStoreNames.contains('manifests'))r.result.createObjectStore('manifests',{keyPath:'id'})};r.onerror=()=>reject(r.error);r.onsuccess=()=>resolve(r.result)});try{const tx=db.transaction('graphs','readonly'),s=tx.objectStore('graphs');const requests=ids.map(id=>new Promise((resolve,reject)=>{const q=s.get(id);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)}));const existing=await Promise.all(requests);if(existing.some(Boolean))throw new Error('qa-id-collision');return JSON.stringify({ok:true})}finally{db.close()}})()";
            JSONObject value = parseObject(evalAsyncJs(script, 10_000L));
            if (!value.optBoolean("ok")) throw new IllegalStateException("qa-id-preflight-failed");
        }

        private void seedGraphs() throws Exception {
            String script = "(async()=>{const inputs=JSON.parse(" + quote(graphs.toString()) + ");const run=" + quote(runId) + ";const specs=[['motorcar'," + quote(motorcarId) + "],['motorcycle'," + quote(motorcycleId) + "]];const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(" + quote(DATABASE) + ",1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('graphs'))r.result.createObjectStore('graphs',{keyPath:'id'});if(!r.result.objectStoreNames.contains('manifests'))r.result.createObjectStore('manifests',{keyPath:'id'})};r.onerror=()=>reject(r.error);r.onsuccess=()=>resolve(r.result)});try{const prepared=[];for(const [profile,id] of specs){const g=JSON.parse(JSON.stringify(inputs[profile]));if(g.profile!==profile||g.format!=='shantu-offline-routing'||g.version!==2)throw new Error('graph-profile-mismatch');g.id=id;g.name='QA158 '+profile+' '+run;const bytes=new TextEncoder().encode(JSON.stringify(g));const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');const m={id:g.id,name:g.name,bounds:g.bounds,createdAt:g.createdAt,attribution:g.attribution,profile:g.profile,nodes:g.nodes.length,edges:g.edges.length,bytes:bytes.length,digest};prepared.push([g,m])}const tx=db.transaction(['graphs','manifests'],'readwrite'),gs=tx.objectStore('graphs'),ms=tx.objectStore('manifests');for(const [g,m] of prepared){gs.put(g);ms.put(m)}await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||new Error('seed-aborted'));tx.onerror=()=>reject(tx.error)});window.dispatchEvent(new Event('shantu-offline-graphs-changed'));return JSON.stringify({ok:true,profiles:specs.map(x=>x[0])})}finally{db.close()}})()";
            JSONObject result = parseObject(evalAsyncJs(script, 15_000L));
            if (!result.optBoolean("ok")) throw new IllegalStateException("offline-fixture-seed-failed");
        }

        private void installNetworkBlock() throws Exception {
            String script = "(()=>{if(window.__qa158NetworkBlock)throw new Error('already-installed');const desc=Object.getOwnPropertyDescriptor(navigator,'onLine');window.__qa158NetworkBlock={fetch:window.fetch,descriptor:desc,count:0};window.fetch=function(){window.__qa158NetworkBlock.count++;return Promise.reject(new TypeError('Failed to fetch (QA offline gate)'))};Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});return JSON.stringify({fetchBlocked:true,onLine:navigator.onLine})})()";
            JSONObject result = parseObject(evalJs(script));
            if (!result.optBoolean("fetchBlocked") || result.optBoolean("onLine")) throw new IllegalStateException("application-fetch-block-install-failed");
        }

        private void setEndpoint(String slot, double lon, double lat) throws Exception {
            String label = "start".equals(slot) ? "起点" : "终点";
            tapDomButton("button[aria-label='在地图选择" + label + "']", "选点");
            awaitPicking(label);
            emitSyntheticTap(lon, lat);
            awaitEndpoint(label);
        }

        private void emitSyntheticTap(double lon, double lat) throws Exception {
            String gestureId = "qa158-" + runId + "-tap-" + SystemClock.uptimeMillis();
            JSONObject point = new JSONObject().put("x", 150).put("y", 200);
            JSONObject pointer = new JSONObject().put("x", 150).put("y", 200).put("pointerId", 0);
            JSONObject down = new JSONObject().put("action", 0).put("gestureId", gestureId).put("pointerCount", 1)
                .put("x", 150).put("y", 200).put("eventTime", SystemClock.uptimeMillis()).put("pointers", new JSONArray().put(pointer));
            JSONObject up = new JSONObject().put("action", 1).put("gestureId", gestureId).put("pointerCount", 1)
                .put("x", 150).put("y", 200).put("eventTime", SystemClock.uptimeMillis() + 1).put("pointers", new JSONArray().put(pointer));
            JSONObject tap = new JSONObject().put("gestureId", gestureId).put("eventTime", SystemClock.uptimeMillis() + 2)
                .put("point", point).put("coordinate", new JSONArray().put(lon).put(lat)).put("ids", new JSONArray()).put("exactIds", new JSONArray());
            emitHostEvent("touch", down);
            emitHostEvent("touch", up);
            emitHostEvent("tap", tap);
        }

        private void emitHostEvent(String name, JSONObject value) throws Exception {
            // The optimized host inlines its private emitter. Use the documented
            // client event envelope, retaining the live session only in memory.
            JSONObject envelope = new JSONObject().put("version", 1)
                .put("sessionId", getField(host, "sessionId")).put("type", "event").put("mapId", "main")
                .put("payload", new JSONObject().put("name", name).put("value", value));
            evalJs("(()=>{window.dispatchEvent(new CustomEvent('shantu:native-map',{detail:" + envelope.toString() + "}));return 'sent'})()");
        }

        private JSONObject awaitMode(String expectedMode, String screenshotName) throws Exception {
            long end = SystemClock.elapsedRealtime() + ROUTE_TIMEOUT_MS;
            JSONObject state = new JSONObject();
            boolean summary = false;
            while (SystemClock.elapsedRealtime() < end) {
                state = invokeParentObject("readState");
                JSONObject overlay = state.optJSONObject("routeOverlay");
                JSONObject route = overlay == null ? null : overlay.optJSONObject("route");
                JSONObject dom = parseObject(evalJs("(()=>{const e=document.querySelector('#map-control-panel .route-summary');return JSON.stringify({visible:!!e&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).visibility!=='hidden'})})()"));
                summary = dom.optBoolean("visible");
                if (route != null && expectedMode.equals(route.optString("mode")) && summary && renderedRoutePresent()) {
                    JSONObject metrics = routeMetrics(route, expectedMode, screenshotName);
                    String profile = "auto".equals(expectedMode) ? "motorcar" : "motorcycle";
                    if (!"offline".equals(metrics.optString("routingSource")) || !("QA158 " + profile + " " + runId).equals(metrics.optString("offlineGraphName")) || metrics.optInt("coordinateCount") < 2 || metrics.optDouble("distanceMeters") <= 0)
                        throw new IllegalStateException("route-result-not-offline-or-incomplete:" + expectedMode);
                    return metrics;
                }
                SystemClock.sleep(200L);
            }
            throw new IllegalStateException("route-summary-or-native-overlay-timeout:" + expectedMode + ":summary=" + summary);
        }

        private JSONObject routeMetrics(JSONObject route, String expectedMode, String screenshotName) throws Exception {
            JSONObject source = route.optJSONObject("routingSource");
            JSONArray coordinates = route.optJSONArray("coordinates");
            String screenshot = invokeParentString("capture", screenshotName);
            if (screenshot.isEmpty() || "SCREENSHOT_UNAVAILABLE".equals(screenshot)) throw new IllegalStateException("native-result-screenshot-unavailable:" + expectedMode);
            int fetchCount = parseObject(evalJs("(()=>JSON.stringify({count:window.__qa158NetworkBlock?.count||0}))()" )).optInt("count");
            return new JSONObject().put("mode", expectedMode)
                .put("routingSource", source == null ? "" : source.optString("kind", ""))
                .put("offlineGraphName", source == null ? "" : source.optString("name", ""))
                .put("distanceMeters", route.optDouble("distance", 0.0))
                .put("coordinateCount", coordinates == null ? 0 : coordinates.length())
                .put("nativeRoutePathPresent", renderedRoutePresent())
                .put("routeSummaryVisible", true)
                .put("applicationFetchRejectCount", fetchCount)
                .put("screenshot", screenshot);
        }

        private boolean renderedRoutePresent() throws Exception {
            Object renderer = getField(entry, "overlayRenderer");
            Object groups = getField(renderer, "groups");
            if (!(groups instanceof java.util.Map)) return false;
            for (java.util.Map.Entry<?, ?> group : ((java.util.Map<?, ?>)groups).entrySet())
                if (String.valueOf(group.getKey()).startsWith("routes:") && containsNativePath(group.getValue(), 0)) return true;
            return false;
        }

        private boolean containsNativePath(Object value, int depth) {
            if (value == null || depth > 3) return false;
            for (Class<?> type = value.getClass(); type != null; type = type.getSuperclass())
                if ("Path".equals(type.getSimpleName())) return true;
            if (value instanceof Iterable) for (Object item : (Iterable<?>)value)
                if (containsNativePath(item, depth + 1)) return true;
            return false;
        }

        private void awaitRoutePlanner() throws Exception {
            waitForDom("#map-control-panel .route-panel:not(.route-summary)", 8_000L, "route-planner-not-visible");
        }

        private void awaitPicking(String label) throws Exception {
            long end = SystemClock.elapsedRealtime() + 5_000L;
            while (SystemClock.elapsedRealtime() < end) {
                JSONObject result = parseObject(evalJs("(()=>{const p=document.querySelector('#map-control-panel .route-panel');return JSON.stringify({picking:p?.getAttribute('data-picking')==='true',label:p?.querySelector('.route-picking-help strong')?.textContent||''})})()"));
                if (result.optBoolean("picking") && result.optString("label").contains(label)) return;
                SystemClock.sleep(100L);
            }
            throw new IllegalStateException("endpoint-picking-not-active:" + label);
        }

        private void awaitEndpoint(String label) throws Exception {
            String script = "(()=>{const i=Array.from(document.querySelectorAll('#map-control-panel .route-panel input')).find(x=>x.getAttribute('aria-label')===" + quote(label) + ");return JSON.stringify({found:!!i,value:i?.value||''})})()";
            long end = SystemClock.elapsedRealtime() + 6_000L;
            while (SystemClock.elapsedRealtime() < end) {
                JSONObject result = parseObject(evalJs(script));
                if (result.optBoolean("found") && !result.optString("value").trim().isEmpty()) return;
                SystemClock.sleep(100L);
            }
            throw new IllegalStateException("map-pick-did-not-fill-endpoint:" + label);
        }

        private void waitForDom(String selector, long timeout, String error) throws Exception {
            String script = "(()=>JSON.stringify({visible:Array.from(document.querySelectorAll(" + quote(selector) + ")).some(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0})}))()";
            long end = SystemClock.elapsedRealtime() + timeout;
            while (SystemClock.elapsedRealtime() < end) {
                if (parseObject(evalJs(script)).optBoolean("visible")) return;
                SystemClock.sleep(100L);
            }
            throw new IllegalStateException(error);
        }

        private void restoreBrowserState() {
            if (!targetAttached) return;
            try {
                if (!networkBlockAttempted && !modeCaptured) return;
                String mode = originalMode == null ? null : originalMode.optString("value", "");
                String script = "(()=>{const b=window.__qa158NetworkBlock;if(b){window.fetch=b.fetch;if(b.descriptor)Object.defineProperty(navigator,'onLine',b.descriptor);else delete navigator.onLine;delete window.__qa158NetworkBlock}";
                if (modeCaptured) script += mode == null || mode.isEmpty() || "null".equals(mode)
                    ? ";localStorage.removeItem(" + quote(MODE_KEY) + ")"
                    : ";localStorage.setItem(" + quote(MODE_KEY) + "," + quote(mode) + ")";
                script += ";window.dispatchEvent(new Event('shantu-routing-mode-changed'));return JSON.stringify({restored:true})})()";
                evalJs(script);
                cleanup = append(cleanup, "browser-restored");
            } catch (Throwable error) { cleanup = append(cleanup, "browser-restore-error"); }
        }

        private void removeQaGraphs() {
            if (!targetAttached || !idsReserved) return;
            try {
                String script = "(async()=>{const ids=" + jsonArray(motorcarId, motorcycleId) + ";const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(" + quote(DATABASE) + ",1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});try{const tx=db.transaction(['graphs','manifests'],'readwrite');for(const id of ids){tx.objectStore('graphs').delete(id);tx.objectStore('manifests').delete(id)}await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error)});window.dispatchEvent(new Event('shantu-offline-graphs-changed'));return JSON.stringify({removed:true})}finally{db.close()}})()";
                JSONObject result = parseObject(evalAsyncJs(script, 10_000L));
                cleanup = append(cleanup, result.optBoolean("removed") ? "qa-graphs-removed" : "qa-graph-remove-error");
            } catch (Throwable error) { cleanup = append(cleanup, "qa-graph-remove-error"); }
        }

        private void clearQaRouteUi() {
            if (!targetAttached || !routePanelOpened) return;
            try {
                JSONObject state = invokeParentObject("readState");
                JSONObject overlay = state.optJSONObject("routeOverlay");
                boolean hasRoute = overlay != null && overlay.optJSONObject("route") != null;
                if (hasRoute) {
                    JSONObject details = parseObject(evalJs("(()=>{const b=document.querySelector('#map-control-panel .route-summary-details-toggle');return JSON.stringify({exists:!!b,expanded:b?.getAttribute('aria-expanded')==='true'})})()"));
                    if (details.optBoolean("exists") && !details.optBoolean("expanded")) tapDomButton(".route-summary", "详情");
                    tapDomButton(".route-summary-detail", "取消路线");
                }
                JSONObject panel = parseObject(evalJs("(()=>JSON.stringify({open:!!document.querySelector('#map-control-panel .route-panel')}))()"));
                if (panel.optBoolean("open")) tapDomButton(".home-bottom-nav", "路线");
                long end = SystemClock.elapsedRealtime() + 5_000L;
                while (SystemClock.elapsedRealtime() < end) {
                    JSONObject after = invokeParentObject("readState");
                    JSONObject afterOverlay = after.optJSONObject("routeOverlay");
                    if (afterOverlay == null || afterOverlay.optJSONObject("route") == null) break;
                    SystemClock.sleep(100L);
                }
                JSONObject after = invokeParentObject("readState");
                JSONObject afterOverlay = after.optJSONObject("routeOverlay");
                if (afterOverlay != null && afterOverlay.optJSONObject("route") != null) throw new IllegalStateException("qa-route-remains");
                cleanup = append(cleanup, "qa-route-ui-cleared");
            } catch (Throwable error) { cleanup = append(cleanup, "qa-route-ui-clear-incomplete"); }
        }

        private void restoreCamera() {
            if (!targetAttached || originalCamera == null || !routePanelOpened) return;
            try {
                invokeParent("applyCamera", originalCamera);
                cleanup = append(cleanup, "camera-restore-requested");
            } catch (Throwable error) { cleanup = append(cleanup, "camera-restore-error"); }
        }

        private double viewportScale() throws Exception {
            Object viewport = getField(entry, "viewport");
            return viewport instanceof JSONObject ? ((JSONObject)viewport).optDouble("cssScale", 1.0) : 1.0;
        }

        private void tapDomButton(String selector, String exactText) throws Exception {
            invokeParent("tapDomButton", selector, exactText, cssScale);
        }

        private String evalJs(String script) throws Exception { return invokeParentString("evalJs", script); }
        private JSONObject invokeParentObject(String method) throws Exception { Object value = invokeParent(method); return value instanceof JSONObject ? (JSONObject)value : new JSONObject(String.valueOf(value)); }

        private String invokeParentString(String method, Object... args) throws Exception {
            Object value = invokeParent(method, args);
            return value == null ? "" : String.valueOf(value);
        }

        private Object invokeParent(String methodName, Object... args) throws Exception {
            Method method = findMethod(parent.getClass(), methodName, args.length);
            if (method == null) throw new NoSuchMethodException("Native149Instrumentation." + methodName + "/" + args.length);
            method.setAccessible(true);
            try { return method.invoke(parent, args); }
            catch (java.lang.reflect.InvocationTargetException error) {
                Throwable cause = error.getCause();
                if (cause instanceof Exception) throw (Exception)cause;
                if (cause instanceof Error) throw (Error)cause;
                throw error;
            }
        }

        private Object getParentField(String name) throws Exception { return getField(parent, name); }
        private void runParentField(String name, Object value) throws Exception { setField(parent, name, value); }

        private File createEvidenceDirectory() throws Exception {
            File pictures = parent.getTargetContext().getExternalFilesDir(Environment.DIRECTORY_PICTURES);
            if (pictures == null) throw new IllegalStateException("evidence-directory-unavailable");
            File dir = new File(pictures, "native158-offline-" + runId);
            if (!dir.mkdirs() && !dir.isDirectory()) throw new IllegalStateException("evidence-directory-create-failed");
            return dir;
        }

        private void writeReport() {
            if (evidenceDir == null) return;
            try {
                File file = new File(evidenceDir, "native158-offline-report.json");
                put("reportFile", file.getName());
                try (java.io.FileOutputStream stream = new java.io.FileOutputStream(file)) {
                    stream.write(report.toString(2).getBytes("UTF-8"));
                }
            } catch (Throwable error) { put("reportWrite", "ERROR"); }
        }

        private JSONObject parseObject(String value) throws Exception {
            Object parsed = new JSONTokener(value).nextValue();
            if (parsed instanceof JSONObject) return (JSONObject)parsed;
            throw new JSONException("expected-object-result");
        }

        private String evalAsyncJs(String expression, long timeoutMs) throws Exception {
            String token = "r" + UUID.randomUUID().toString().replace("-", "");
            String key = quote(token);
            String start = "(()=>{window.__qa158AsyncResults=window.__qa158AsyncResults||{};window.__qa158AsyncResults[" + key + "]=null;Promise.resolve().then(()=>" + expression + ").then(v=>{window.__qa158AsyncResults[" + key + "]=JSON.stringify({ok:true,value:v})},e=>{window.__qa158AsyncResults[" + key + "]=JSON.stringify({ok:false,errorType:String(e&&e.name||'Error')})});return JSON.stringify({started:true})})()";
            if (!parseObject(evalJs(start)).optBoolean("started")) throw new IllegalStateException("async-webview-operation-did-not-start");
            long end = SystemClock.elapsedRealtime() + timeoutMs;
            while (SystemClock.elapsedRealtime() < end) {
                String raw = evalJs("(()=>window.__qa158AsyncResults&&window.__qa158AsyncResults[" + key + "]||'')()");
                if (raw != null && !raw.isEmpty()) {
                    JSONObject result = parseObject(raw);
                    evalJs("(()=>{if(window.__qa158AsyncResults)delete window.__qa158AsyncResults[" + key + "];return 'done'})()");
                    if (!result.optBoolean("ok")) throw new IllegalStateException("async-webview-operation-failed:" + result.optString("errorType", "Error"));
                    Object value = result.opt("value");
                    return value instanceof String ? (String)value : value == null || value == JSONObject.NULL ? "null" : String.valueOf(value);
                }
                SystemClock.sleep(100L);
            }
            evalJs("(()=>{if(window.__qa158AsyncResults)delete window.__qa158AsyncResults[" + key + "];return 'timeout'})()");
            throw new IllegalStateException("async-webview-operation-timeout");
        }

        private JSONObject copyObject(JSONObject value) throws Exception { return new JSONObject(value.toString()); }
        private String quote(String value) { return JSONObject.quote(value); }
        private String jsonArray(String first, String second) { return new JSONArray().put(first).put(second).toString(); }
        private void put(String key, Object value) { try { report.put(key, value); } catch (JSONException ignored) { } }
        private String append(String current, String next) { return "not-started".equals(current) ? next : current + ";" + next; }

        private static Method findMethod(Class<?> type, String name, int count) {
            for (Class<?> current = type; current != null; current = current.getSuperclass()) {
                for (Method method : current.getDeclaredMethods())
                    if (method.getName().equals(name) && method.getParameterTypes().length == count && !method.getName().endsWith("$default")) return method;
            }
            return null;
        }

        private static Object getField(Object owner, String name) throws Exception {
            for (Class<?> type = owner.getClass(); type != null; type = type.getSuperclass()) {
                try { Field field = type.getDeclaredField(name); field.setAccessible(true); return field.get(owner); }
                catch (NoSuchFieldException ignored) { }
            }
            throw new NoSuchFieldException(name);
        }

        private static void setField(Object owner, String name, Object value) throws Exception {
            for (Class<?> type = owner.getClass(); type != null; type = type.getSuperclass()) {
                try { Field field = type.getDeclaredField(name); field.setAccessible(true); field.set(owner, value); return; }
                catch (NoSuchFieldException ignored) { }
            }
            throw new NoSuchFieldException(name);
        }
    }
}
