package com.shantu.qa149;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.app.Activity;
import android.graphics.Rect;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewTreeObserver;
import android.view.accessibility.AccessibilityNodeInfo;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.io.File;
import java.io.FileOutputStream;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;

/** Bounded UI regression for the 163 marker card, coordinate search, and comparison source menu. */
public final class Native163UiRegression {
    private static final String SOURCE_GROUPS_KEY = "shantu-map-comparison-source-groups-v1";
    private static final String SOURCE_GROUPS_EVENT = "shantu-map-comparison-source-groups-changed";
    private static final String SEARCH_HISTORY_KEY = "shantu.place-search-history.v1";
    private static final String SEARCH_SELECTOR = "input[aria-label='搜索地点']";
    private static final String QA_MARKER_NAME = "QA-163-UI";
    private static final String OSM_CHOICE_ID = "public:builtin-osm";
    private static final String OSM_SOURCE_ID = "builtin-osm";
    private static final String[] SOURCE_GROUPS = {"常用", "当前", "内置", "我的图源", "公共库"};
    private static final double CSS_SIZE_ROUNDING_TOLERANCE = 0.25;

    private Native163UiRegression() { }

    /** Invoked by the parent instrumentation mode dispatch; this class never launches a second app. */
    public static JSONObject run(Native149Instrumentation parent) {
        return new Runner(parent).execute();
    }

    private static final class Runner {
        private final Native149Instrumentation parent;
        private final JSONObject report = new JSONObject();
        private final JSONArray steps = new JSONArray();
        private final JSONArray screenshots = new JSONArray();
        private File screenshotDirectory;
        private File progressFile;
        private final String qaId = "qa163-ui-" + UUID.randomUUID().toString().replace("-", "");
        private final List<MapCamera> originalCameras = new ArrayList<>();
        private List<String> parentQaIds;
        private String originalSelectedId = "";
        private JSONArray originalSelectedCoordinates;
        private int originalAnnotationCount = -1;
        private ClipData originalClipboard;
        private String originalSearchHistory;
        private String originalSourceGroups;
        private String originalSearchText = "";
        private boolean clipboardCaptured;
        private boolean fixtureInserted;
        private boolean targetWasComparing;
        private boolean testEnteredComparison;
        private boolean sourceMenuWasOpen;
        private boolean sourceGroupsCaptured;
        private boolean searchHistoryCaptured;
        private boolean comparisonOriginalSourcesCaptured;
        private final String[] originalComparisonChoices = new String[2];
        private final String[] workflowComparisonChoices = new String[2];
        private boolean sourceWasChanged;
        private double cssScale = 1.0;
        private View mapView;
        private int[] mapOrigin = new int[2];
        private int mapWidth;
        private int mapHeight;
        private double qaLatitude;
        private double qaLongitude;
        private Map<?, ?> mapEntries;

        Runner(Native149Instrumentation parent) {
            this.parent = parent;
        }

        JSONObject execute() {
            String testState = "FAILED";
            String error = "";
            try {
                if (parent == null) throw new IllegalArgumentException("parent instrumentation required");
                initializeScreenshotDirectory("ui");
                progress("before-attach");
                boolean existingTargetReused = targetAlreadyAttached(parent);
                if (!existingTargetReused) callParent("attachTarget");
                progress("after-attach");
                report.put("existingInteractiveTargetReused", existingTargetReused);
                progress("before-capture-initial-state");
                captureInitialState();
                progress("after-capture-initial-state");
                progress("before-preflight");
                preflight();
                progress("after-preflight");
                boolean viewportMatches = inspectViewport();
                report.put("viewportMatchesRequested", viewportMatches);
                report.put("marker", runMarkerWorkflow());

                if (targetWasComparing) leaveComparison();
                enterComparison();
                testEnteredComparison = true;
                report.put("comparison", runComparisonWorkflow());
                if (!targetWasComparing) report.put("comparisonExit", leaveComparison());
                else restoreOriginalComparisonChoices();

                boolean allPass = viewportMatches && report.optJSONObject("marker") != null &&
                    report.getJSONObject("marker").optBoolean("pass") &&
                    report.optJSONObject("comparison") != null && report.getJSONObject("comparison").optBoolean("pass") &&
                    (targetWasComparing || report.optJSONObject("comparisonExit") != null && report.getJSONObject("comparisonExit").optBoolean("pass"));
                testState = allPass ? "PASS" : "FAIL";
            } catch (Throwable failure) {
                if (failure instanceof ObservationUnavailable) {
                    error = failure.getMessage();
                    testState = "INCONCLUSIVE";
                } else if (failure instanceof Unverified) {
                    error = failure.getMessage();
                    testState = "UNVERIFIED";
                } else {
                    error = safeError(failure);
                    testState = "ERROR";
                }
            } finally {
                progress("before-cleanup");
                String cleanup = cleanup();
                progress("after-cleanup");
                try {
                JSONObject cleanupReport = new JSONObject(cleanup);
                boolean cleanupPassed = cleanupPass(cleanupReport);
                report.put("cleanup", cleanupReport).put("cleanupPassed", cleanupPassed);
                if (!cleanupPassed && "PASS".equals(testState)) testState = "FAIL";
                    report.put("mode", "native163-ui-regression").put("testState", testState)
                        .put("steps", steps).put("screenshots", screenshots);
                    if (screenshotDirectory != null) report.put("evidenceDirectory", screenshotDirectory.getAbsolutePath());
                    if (!error.isEmpty()) report.put("error", error);
                } catch (Exception ignored) { }
            }
            return report;
        }

        private void captureInitialState() throws Exception {
            JSONObject state = (JSONObject)callParent("readState");
            originalSelectedId = selectedId(state);
            originalAnnotationCount = annotationCount(state);
            originalSelectedCoordinates = annotationCoordinates(state, originalSelectedId);
            JSONObject camera = (JSONObject)callParent("invokeCameraJson");
            report.put("initialAnnotationCount", originalAnnotationCount);
            report.put("initiallySelected", !originalSelectedId.isEmpty());
            report.put("initialCameraCaptured", camera != null);
            captureAllMapCameras();
            if (originalCameras.isEmpty()) throw new IllegalStateException("map camera state could not be captured for restoration");
            Object parentIds = field(parent, "qaIds");
            if (!(parentIds instanceof List)) throw new IllegalStateException("QA identifier list unavailable");
            @SuppressWarnings("unchecked") List<String> ids = (List<String>)parentIds;
            if (!ids.isEmpty()) throw new IllegalStateException("parent already owns QA fixtures");
            parentQaIds = ids;
            Object args = field(parent, "arguments");
            Bundle bundle = args instanceof Bundle ? (Bundle)args : null;
            int expected = parseExpectedCssWidth(bundle);
            report.put("expectedCssWidth", expected > 0 ? expected : JSONObject.NULL);
            if (expected != 360 && expected != 390) throw new IllegalStateException("expectedCssWidth must be explicitly 360 or 390");
            originalClipboard = clipboard();
            clipboardCaptured = true;
            originalSearchHistory = localStorageValue(SEARCH_HISTORY_KEY);
            searchHistoryCaptured = true;
            originalSourceGroups = localStorageValue(SOURCE_GROUPS_KEY);
            sourceGroupsCaptured = true;
            sourceMenuWasOpen = domBoolean("!!document.querySelector('.comparison-source-popup')");
            targetWasComparing = domBoolean("document.querySelector('.observatory.home-map')?.getAttribute('data-comparing')==='true'");
            if (targetWasComparing) {
                if (domBoolean("!!document.querySelector('#comparison-layer-window,.map-comparison-property')"))
                    throw new IllegalStateException("comparison layer/property window is open; close it before QA");
                if (sourceMenuWasOpen) throw new IllegalStateException("comparison source menu is already open; close it before QA");
                captureComparisonChoices();
                if (!comparisonOriginalSourcesCaptured) throw new IllegalStateException("could not safely capture both original comparison sources");
            }
            Object entries = field(field(parent, "host"), "maps");
            if (!(entries instanceof Map)) throw new IllegalStateException("native map registry unavailable");
            mapEntries = (Map<?, ?>)entries;
        }

        private int parseExpectedCssWidth(Bundle bundle) {
            if (bundle == null) return 0;
            Object raw = bundle.get("expectedCssWidth");
            if (raw instanceof Number) {
                double number = ((Number)raw).doubleValue();
                return Double.isFinite(number) && number == Math.rint(number) && number >= Integer.MIN_VALUE && number <= Integer.MAX_VALUE
                    ? (int)number : 0;
            }
            if (raw instanceof String) {
                try { return Integer.parseInt(((String)raw).trim()); }
                catch (NumberFormatException ignored) { return 0; }
            }
            return 0;
        }

        private void preflight() throws Exception {
            if (originalSearchHistory == null) originalSearchHistory = null;
            originalSearchText = domString("document.querySelector(" + JSONObject.quote(SEARCH_SELECTOR) + ")?.value||''");
            if (!originalSearchText.isEmpty()) throw new IllegalStateException("search field is already in use; refusing to replace its query");
            if (domBoolean("!!document.querySelector('#map-control-panel,.place-search-results[open],.comparison-layer-window')"))
                throw new IllegalStateException("close active panel/search before UI QA");
            JSONObject state = (JSONObject)callParent("readState");
            JSONObject interaction = state.optJSONObject("interaction");
            if (interaction != null && interaction.optBoolean("drawingActive"))
                throw new IllegalStateException("drawing is active; refusing to alter the user's draft");
            JSONObject tracks = state.optJSONObject("trackOverlay");
            if (tracks != null && (tracks.optBoolean("editing") || tracks.optBoolean("drawing")))
                throw new IllegalStateException("track editing/drawing is active; refusing to alter the user's draft");
            JSONObject geometry = state.optJSONObject("renderGeometry");
            if (geometry != null && geometry.optJSONObject("nodeSelection") != null)
                throw new IllegalStateException("track node selection is active; refusing to alter it");
            if (domBoolean("!!document.querySelector('.guidance-card,.record-console')"))
                throw new IllegalStateException("navigation/recording UI is active; refusing to change its camera state");
            if (originalSelectedId.isEmpty() && domBoolean("!!document.querySelector('.selection-tools')"))
                throw new IllegalStateException("a non-marker map selection is active; refusing to disturb it");
            if (originalSelectedId != null && !originalSelectedId.isEmpty()) {
                if (originalSelectedCoordinates == null) throw new IllegalStateException("selected marker coordinates unavailable for safe restoration");
                refreshMapView();
                double[] xy = project(originalSelectedCoordinates.getDouble(1), originalSelectedCoordinates.getDouble(0));
                if (xy == null || xy[0] < 0 || xy[0] >= mapWidth || xy[1] < 0 || xy[1] >= mapHeight)
                    throw new IllegalStateException("selected marker is outside the current viewport; refusing to lose selection");
            }
        }

        private boolean inspectViewport() throws Exception {
            JSONObject viewport = new JSONObject(domString("JSON.stringify({width:innerWidth,height:innerHeight})"));
            int width = viewport.optInt("width"), height = viewport.optInt("height");
            int expectedWidth = report.optInt("expectedCssWidth");
            int expectedHeight = expectedWidth == 390 ? 857 : 780;
            boolean matches = width == expectedWidth && height == expectedHeight;
            report.put("actualCssViewport", new JSONObject().put("width", width).put("height", height))
                .put("expectedCssViewport", new JSONObject().put("width", expectedWidth).put("height", expectedHeight));
            return matches;
        }

        private JSONObject runMarkerWorkflow() throws Exception {
            if (targetWasComparing) leaveComparison();
            ensureNoSelectionForQa();
            refreshMapView();
            double x = mapWidth * .50;
            double y = mapHeight * .48;
            double[] coordinate = unproject(x, y);
            qaLatitude = coordinate[0];
            qaLongitude = coordinate[1];
            JSONArray markerCoordinates = new JSONArray().put(qaLongitude).put(qaLatitude);
            JSONObject fixture = new JSONObject().put("id", qaId).put("kind", "pin").put("name", QA_MARKER_NAME)
                .put("note", "").put("color", "#36a36b").put("coordinates", markerCoordinates)
                .put("groundElevation", JSONObject.NULL).put("placement", "surface").put("offset", 0)
                .put("width", 10).put("length", 20).put("height", 10).put("heading", 0)
                .put("pitch", 0).put("roll", 0).put("opacity", .55).put("visible", true);
            JSONArray fixtures = new JSONArray().put(fixture);
            parentQaIds.add(qaId);
            progress("before-write-qa-marker-fixture");
            callParent("writeStorageAppend", fixtures);
            fixtureInserted = true;
            callParent("awaitAnnotations", parentQaIds, 20_000L);
            progress("after-write-qa-marker-fixture");
            cssScale = ((Number)callParent("viewportScale")).doubleValue();
            callParent("awaitFrames", 2, 15_000L);
            JSONObject fixtureRendering = awaitVisibleQaMarker(mapOrigin, x, y, cssScale);
            double expectedTapLocalX = x;
            double expectedTapLocalY = y - 11.0 * cssScale;
            JSONObject observedMarker = locateQaMarkerPixels(mapOrigin, expectedTapLocalX, expectedTapLocalY, cssScale);
            report.put("qaMarkerNativeRendering", new JSONObject()
                .put("nativeRenderableEntryPresent", fixtureRendering.optBoolean("nativeRenderableEntriesPresent"))
                .put("visibleColorPixelCounts", fixtureRendering.optJSONArray("colorPixelCounts"))
                .put("observedPixelTarget", observedMarker)
                .put("placementOffsetNote", "observed rendered QA color is used for pick; expected projection remains diagnostic only"));
            awaitWebViewDraw(3_000L);
            captureScreenshot("qa-marker-before-pick");
            float actualLocalX = (float)observedMarker.getDouble("localX");
            float actualLocalY = (float)observedMarker.getDouble("localY");
            float tapX = mapOrigin[0] + actualLocalX;
            float tapY = mapOrigin[1] + actualLocalY;
            JSONObject rawPickProbe = (JSONObject)callParent("probeNativePick", actualLocalX,
                actualLocalY, 22f * (float)cssScale);
            JSONObject pickProbe = new JSONObject()
                .put("pointContainsQaMarker", containsString(rawPickProbe.optJSONArray("pointIds"), qaId))
                .put("44CssRectContainsQaMarker", containsString(rawPickProbe.optJSONArray("44CssRectIds"), qaId))
                .put("nativeRenderableEntryPresent", fixtureRendering.optBoolean("nativeRenderableEntriesPresent"));
            report.put("nativePickProbe", pickProbe);
            report.put("actualTapPx", new JSONObject().put("x", tapX).put("y", tapY)
                .put("expectedTapLocalPx", new JSONObject().put("x", expectedTapLocalX).put("y", expectedTapLocalY))
                .put("observedTapLocalPx", new JSONObject().put("x", actualLocalX).put("y", actualLocalY))
                .put("44CssProbeRect", new JSONObject().put("left", tapX - 22f * cssScale)
                    .put("top", tapY - 22f * cssScale).put("right", tapX + 22f * cssScale)
                    .put("bottom", tapY + 22f * cssScale)));
            progress("before-pick-qa-marker");
            tap(tapX, tapY);
            String selected = awaitSelection(qaId, 8_000L);
            progress("after-pick-qa-marker");
            if (!qaId.equals(selected)) throw new IllegalStateException("QA marker could not be selected by actual touch");

            JSONObject card = markerCardProbe();
            captureScreenshot("marker-card");
            boolean cardPass = card.optBoolean("deleteAtTopRight") && card.optBoolean("compactTargets");
            JSONObject selection = (JSONObject)callParent("readSelectionTools");
            progress("before-coordinate-copy");
            JSONObject copyButton = tapButton(".selection-tools.is-annotation .annotation-coordinate-info-values button", "复制坐标");
            CopyRead copyRead = awaitCoordinateCopy();
            String copied = copyRead.text;
            progress("after-coordinate-copy");
            captureScreenshot("marker-coordinate-copy");
            boolean copyExact = copyRead.success;
            report.put("coordinateCopyProbe", new JSONObject().put("uiStatus", copyRead.uiStatus)
                .put("clipboardValueExact", copyRead.exact).put("stableMatchingReads", copyRead.stableMatchingReads)
                .put("settled", copyRead.settled).put("uiReportedFailure", copyRead.uiReportedFailure));
            if (!copyRead.settled) throw new ObservationUnavailable("coordinate-copy-completion-not-observed");
            if (copyRead.uiReportedFailure) throw new IllegalStateException("coordinate-copy-ui-reported-failure");
            if (!copyExact) throw new ObservationUnavailable("coordinate-copy-value-did-not-settle-to-expected-value");

            tapElement(SEARCH_SELECTOR);
            progress("before-coordinate-search-paste");
            parent.sendKeyDownUpSync(KeyEvent.KEYCODE_PASTE);
            boolean pasted = waitForSearchValue(copied, 3_000L);
            if (!pasted) pasted = accessibilityPaste(copied);
            progress("after-coordinate-search-paste");
            if (!pasted) throw new IllegalStateException("system clipboard could not be pasted into the coordinate search field");
            JSONObject pasteProbe = new JSONObject(domString("(()=>{const i=document.querySelector(" + JSONObject.quote(SEARCH_SELECTOR) + ");return JSON.stringify({value:i?.value||'',coordinatePlace:document.querySelector('.place-search-results')?.textContent?.includes('坐标位置')||false})})()"));
            tapButton("button[aria-label='搜索地点并显示结果']", "搜索地点并显示结果");
            boolean samePoint = waitForSearchCenter(qaLatitude, qaLongitude, 10_000L);
            if (!samePoint) throw new IllegalStateException("pasted coordinates did not return the same map point");
            captureScreenshot("coordinate-search-result");

            tapButton("button[aria-label='关闭地点搜索']", "关闭地点搜索");
            if (domBoolean("!!document.querySelector('button[aria-label=\"清空地点搜索\"]')"))
                tapButton("button[aria-label='清空地点搜索']", "清空地点搜索");
            restoreLocalStorage(SEARCH_HISTORY_KEY, originalSearchHistory, null);
            boolean searchCleared = domString("document.querySelector(" + JSONObject.quote(SEARCH_SELECTOR) + ")?.value||''").isEmpty();

            // Coordinate search moves the camera and can replace the active map hit target.
            // Return through the normal search UI, restore the captured camera, wait for
            // fresh native frames/pixels, and select the same QA-only marker by touch again.
            progress("before-restore-camera-and-repick-qa-marker");
            restoreCameras();
            callParent("awaitFrames", 2, 15_000L);
            refreshMapView();
            cssScale = ((Number)callParent("viewportScale")).doubleValue();
            double repickX = mapWidth * .50;
            double repickY = mapHeight * .48;
            JSONObject repickRendering = awaitVisibleQaMarker(mapOrigin, repickX, repickY, cssScale);
            double repickExpectedLocalX = repickX;
            double repickExpectedLocalY = repickY - 11.0 * cssScale;
            JSONObject repickObservedMarker = locateQaMarkerPixels(mapOrigin, repickExpectedLocalX, repickExpectedLocalY, cssScale);
            report.put("qaMarkerAfterSearchRendering", new JSONObject()
                .put("nativeRenderableEntryPresent", repickRendering.optBoolean("nativeRenderableEntriesPresent"))
                .put("visibleColorPixelCounts", repickRendering.optJSONArray("colorPixelCounts"))
                .put("observedPixelTarget", repickObservedMarker)
                .put("placementOffsetNote", "observed rendered QA color is used for repick; expected projection remains diagnostic only"));
            awaitWebViewDraw(3_000L);
            captureScreenshot("qa-marker-after-search-before-repick");
            float repickLocalX = (float)repickObservedMarker.getDouble("localX");
            float repickLocalY = (float)repickObservedMarker.getDouble("localY");
            JSONObject repickRawProbe = (JSONObject)callParent("probeNativePick", repickLocalX,
                repickLocalY, 22f * (float)cssScale);
            JSONObject repickProbe = new JSONObject()
                .put("pointContainsQaMarker", containsString(repickRawProbe.optJSONArray("pointIds"), qaId))
                .put("44CssRectContainsQaMarker", containsString(repickRawProbe.optJSONArray("44CssRectIds"), qaId))
                .put("nativeRenderableEntryPresent", repickRendering.optBoolean("nativeRenderableEntriesPresent"));
            report.put("postSearchNativePickProbe", repickProbe);
            float repickTapX = mapOrigin[0] + repickLocalX;
            float repickTapY = mapOrigin[1] + repickLocalY;
            report.put("postSearchActualTapPx", new JSONObject().put("x", repickTapX).put("y", repickTapY)
                .put("expectedTapLocalPx", new JSONObject().put("x", repickExpectedLocalX).put("y", repickExpectedLocalY))
                .put("observedTapLocalPx", new JSONObject().put("x", repickLocalX).put("y", repickLocalY))
                .put("44CssProbeRect", new JSONObject().put("left", repickTapX - 22f * cssScale)
                    .put("top", repickTapY - 22f * cssScale).put("right", repickTapX + 22f * cssScale)
                    .put("bottom", repickTapY + 22f * cssScale)));
            tap(repickTapX, repickTapY);
            String repicked = awaitSelection(qaId, 8_000L);
            progress("after-restore-camera-and-repick-qa-marker");
            report.put("postSearchTouchReselectedQaMarker", qaId.equals(repicked));
            if (!qaId.equals(repicked)) throw new IllegalStateException("QA marker not reselected by real touch after coordinate search");
            if (!waitForDom(".selection-tools.is-annotation .selection-tools-delete", 3_000L))
                throw new IllegalStateException("QA marker selection state returned but delete control did not render");
            captureScreenshot("qa-marker-after-search-repicked");

            progress("before-open-delete-confirm");
            tapButton(".selection-tools.is-annotation .selection-tools-delete", "删除");
            JSONObject confirm = deleteConfirmProbe();
            progress("after-open-delete-confirm");
            boolean confirmGeometryPass = confirm.optBoolean("visible") && confirm.optBoolean("geometryPass");
            if (!confirm.optBoolean("visible")) throw new IllegalStateException("delete confirmation did not open");
            captureScreenshot("marker-delete-confirm");
            tapButton(".selection-tools-delete-confirm button", "取消");
            boolean cancelKeptSelection = qaId.equals(awaitSelection(qaId, 2_000L)) && annotationExists(qaId);
            if (!cancelKeptSelection) throw new IllegalStateException("cancel changed or removed the selected QA marker");
            tapButton(".selection-tools.is-annotation .selection-tools-delete", "删除");
            tapButton(".selection-tools-delete-confirm button", "确认删除");
            boolean confirmedRemoved = waitUntil(() -> !annotationExists(qaId) && selectedId((JSONObject)callParent("readState")).isEmpty(), 8_000L);
            if (!confirmedRemoved) throw new IllegalStateException("confirmed QA marker deletion did not settle");

            JSONObject report = new JSONObject();
            report.put("pass", cardPass && confirmGeometryPass && cancelKeptSelection && confirmedRemoved && copyExact && pasted && samePoint && searchCleared)
                .put("card", card).put("buttons", selection.optJSONArray("buttons"))
                .put("copyButton", copyButton).put("cardLayoutPass", cardPass).put("clipboardRoundTripExact", copyExact)
                .put("pasteInputMatchedClipboard", pasted)
                .put("coordinateSearchSamePoint", samePoint)
                .put("postSearchTouchReselectedQaMarker", qaId.equals(repicked)).put("postSearchNativePickProbe", repickProbe)
                .put("searchQueryCleared", searchCleared)
                .put("delete", new JSONObject().put("confirmShown", confirm.optBoolean("visible"))
                    .put("confirmGeometryPass", confirmGeometryPass)
                    .put("cancelPreservedQaMarkerAndSelection", cancelKeptSelection)
                    .put("confirmedDeleteRemovedOnlyQaMarker", confirmedRemoved));
            steps.put(new JSONObject().put("name", "marker-copy-paste-confirm-cancel-delete")
                .put("selectedQaMarker", true).put("pasteValueMatchesCopiedValue", pasteProbe.optString("value").equals(copied))
                .put("deleteConfirmGeometry", confirm.optJSONObject("geometry")));
            return report;
        }

        private JSONObject runComparisonWorkflow() throws Exception {
            JSONObject result = new JSONObject();
            report.put("comparison", result);
            boolean sourceMappingVerified = OSM_CHOICE_ID.startsWith("public:") &&
                OSM_SOURCE_ID.equals(OSM_CHOICE_ID.substring("public:".length()));
            if (!sourceMappingVerified) throw new IllegalStateException("public choice/native source mapping mismatch");
            result.put("choiceToNativeSourceIdMappingVerified", true);
            cssScale = ((Number)callParent("viewportScale")).doubleValue();
            progress("before-open-lower-source-menu");
            tapElement(".comparison-source-picker[data-pane='1'] .comparison-source-trigger");
            if (!waitForDom(".comparison-source-popup", 4_000L)) throw new IllegalStateException("lower-pane source menu did not open");
            expandAllGroups("1");
            String choiceId = readSelectedChoice("1");
            if (choiceId == null || choiceId.isEmpty()) throw new IllegalStateException("lower-pane original source choice was unavailable");
            workflowComparisonChoices[1] = choiceId;
            String[] categories = readSourceCategories();
            boolean categoriesPass = categories.length == SOURCE_GROUPS.length;
            for (int i = 0; i < Math.min(categories.length, SOURCE_GROUPS.length); i++) categoriesPass &= SOURCE_GROUPS[i].equals(categories[i]);
            result.put("categories", new JSONArray(categories)).put("allFiveCategoriesPresentInOrder", categoriesPass);
            JSONObject initialMenu = sourceMenuProbe();
            result.put("initialGeometry", initialMenu);
            ensureSourceGroupOpen(4, "公共库");
            JSONObject expandedMenu = sourceMenuProbe();
            result.put("expandedMenuGeometry", expandedMenu);
            swipePublicSourceIntoView(OSM_CHOICE_ID);
            JSONObject publicOption = sourceOptionProbe(OSM_CHOICE_ID);
            result.put("publicOption", publicOption);
            if (!publicOption.optBoolean("fullyVisible") || !publicOption.optBoolean("hitTestable"))
                throw new IllegalStateException("public-library option is not visible and touchable inside the scroller");
            captureScreenshot("comparison-public-library-last-option");
            progress("after-public-library-menu-option-visible");
            sourceWasChanged = true;
            progress("before-select-public-source");
            tapChoice(OSM_CHOICE_ID);
            progress("after-select-public-source");
            Object lowerEntry = mapEntry("aux-1");
            if (lowerEntry == null) throw new IllegalStateException("lower comparison map entry is missing");
            Object controller = field(lowerEntry, "controller");
            boolean publicRasterDecoded = waitForPublicTiles(controller, OSM_SOURCE_ID, 5_000L);
            boolean publicNativeSourceMatches = report.optBoolean("publicRasterSourceMatchesExpected");
            result.put("publicRasterDecoded", publicRasterDecoded)
                .put("publicSourceSelectedNativeMatch", publicNativeSourceMatches)
                .put("publicRasterMapMatched", report.optBoolean("publicRasterMapMatched"))
                .put("publicRasterTilesDecoded", report.optLong("publicRasterTilesDecoded"));
            captureScreenshot("comparison-public-source-selected");
            progress("after-public-source-loaded");

            JSONObject layerX = exerciseLayerWindowClose();
            result.put("layerWindowX", layerX);
            JSONObject propertiesX = exercisePropertiesWindowClose();
            result.put("linePropertiesX", propertiesX);
            JSONObject headingExit = exitButtonProbe();
            double topInsetDelta = Math.abs(layerX.optDouble("topInset", Double.NaN) - propertiesX.optDouble("topInset", Double.NaN));
            double rightInsetDelta = Math.abs(layerX.optDouble("rightInset", Double.NaN) - propertiesX.optDouble("rightInset", Double.NaN));
            JSONObject layerWindowStyle = layerX.optJSONObject("windowStyle");
            JSONObject propertiesWindowStyle = propertiesX.optJSONObject("windowStyle");
            JSONObject xInsetEvidence = new JSONObject()
                .put("toleranceCssPx", 0.5)
                .put("topInsetDeltaCssPx", topInsetDelta)
                .put("rightInsetDeltaCssPx", rightInsetDelta)
                .put("layerWindowPaddingTop", layerWindowStyle == null ? JSONObject.NULL : layerWindowStyle.opt("paddingTop"))
                .put("propertiesWindowPaddingTop", propertiesWindowStyle == null ? JSONObject.NULL : propertiesWindowStyle.opt("paddingTop"));
            boolean xInsetsConsistent = topInsetDelta <= 0.5 && rightInsetDelta <= 0.5;
            restoreSourceChoice("1", choiceId);
            boolean sourceRestored = waitForSelectedChoice("1", choiceId, 5_000L);
            if (sourceRestored) sourceWasChanged = false;
            closeSourcePopupIfOpen();
            restoreLocalStorage(SOURCE_GROUPS_KEY, originalSourceGroups, SOURCE_GROUPS_EVENT);
            boolean scrollBounded = initialMenu.optBoolean("insideSafeViewport") &&
                expandedMenu.optBoolean("scrollable") && expandedMenu.optInt("scrollHeight") > expandedMenu.optInt("clientHeight") &&
                publicOption.optBoolean("insideScroller");
            boolean menuPass = categoriesPass && scrollBounded && publicOption.optBoolean("fullyVisible") &&
                publicOption.optBoolean("hitTestable") && publicNativeSourceMatches && sourceRestored &&
                layerX.optBoolean("pass") && propertiesX.optBoolean("pass") && xInsetsConsistent &&
                headingExit.optBoolean("sizePass") && headingExit.optBoolean("insideHeading") && headingExit.optBoolean("hitTestable");
            result.put("pass", menuPass).put("categories", new JSONArray(categories))
                .put("allFiveCategoriesPresentInOrder", categoriesPass).put("initialGeometry", initialMenu)
                .put("publicOption", publicOption).put("publicRasterDecoded", publicRasterDecoded)
                .put("publicSourceSelectedNativeMatch", publicNativeSourceMatches)
                .put("publicSourceRestored", sourceRestored).put("layerWindowX", layerX)
                .put("linePropertiesX", propertiesX).put("xInsetsConsistent", xInsetsConsistent)
                .put("xInsetEvidence", xInsetEvidence).put("headingExit", headingExit);
            steps.put(new JSONObject().put("name", "comparison-public-source-scroll-and-window-x")
                .put("publicRasterDecoded", publicRasterDecoded).put("nativeSourceMatched", publicNativeSourceMatches)
                .put("sourceRestored", sourceRestored)
                .put("layerXTargetHit", layerX.optBoolean("pass"))
                .put("propertyXTargetHit", propertiesX.optBoolean("pass")));
            if (!menuPass) throw new IllegalStateException("comparison UI source/close control validation failed");
            return result;
        }

        private JSONObject exerciseLayerWindowClose() throws Exception {
            boolean wasOpen = domBoolean("document.querySelector('button[aria-label=\"对比图层\"]')?.getAttribute('aria-expanded')==='true'");
            if (wasOpen) throw new IllegalStateException("comparison layer panel unexpectedly open before close-button QA");
            tapElement("button[aria-label='对比图层']");
            if (!waitForDom("#comparison-layer-window", 3_000L)) throw new IllegalStateException("comparison layer window did not open");
            JSONObject geometry = closeGeometry("#comparison-layer-window", "button[aria-label='关闭对比图层']");
            captureScreenshot("comparison-layer-window-x");
            JSONObject tap = tapButton(".comparison-layer-window .dock-heading button[aria-label='关闭对比图层']", "关闭对比图层");
            boolean closed = waitForDomAbsent("#comparison-layer-window", 1_500L);
            return geometry.put("tap", tap).put("closedAfterTouch", closed).put("pass", closed && geometry.optBoolean("sizePass") && geometry.optBoolean("insetPass") && tap.optBoolean("hit"));
        }

        private JSONObject exercisePropertiesWindowClose() throws Exception {
            boolean wasOpen = domBoolean("!!document.querySelector('.map-comparison-property')");
            if (wasOpen) throw new IllegalStateException("comparison property window unexpectedly open before close-button QA");
            tapElement("button[aria-label='画线属性']");
            if (!waitForDom(".comparison-line-properties", 3_000L)) throw new IllegalStateException("comparison line properties window did not open");
            JSONObject geometry = closeGeometry(".comparison-line-properties", "button[aria-label='关闭路线样式']");
            JSONObject comparison = report.optJSONObject("comparison");
            if (comparison != null) comparison.put("linePropertiesXGeometry", geometry);
            awaitWebViewDraw(3_000L);
            captureScreenshot("comparison-line-properties-x");
            JSONObject tap = tapElement(".comparison-line-properties button[aria-label='关闭路线样式']");
            boolean closed = waitForDomAbsent(".comparison-line-properties", 1_500L);
            return geometry.put("tap", tap).put("closedAfterTouch", closed).put("pass", closed && geometry.optBoolean("sizePass") && geometry.optBoolean("insetPass") && tap.optBoolean("hit"));
        }

        private JSONObject closeGeometry(String windowSelector, String buttonSelector) throws Exception {
            String script = "(()=>{let phase='init';try{phase='lookup';const w=document.querySelector(" + JSONObject.quote(windowSelector) + "),b=w?.querySelector(" + JSONObject.quote(buttonSelector) + ");if(!w||!b)return JSON.stringify({found:false,qaError:{phase:'lookup',type:'ElementMissing'}});phase='measure';const metric=e=>{if(!e)return null;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {tag:e.tagName,id:e.id||'',className:typeof e.className==='string'?e.className:'',rect:{x:r.x,y:r.y,width:r.width,height:r.height,top:r.top,right:r.right,bottom:r.bottom,left:r.left},style:{display:s.display,visibility:s.visibility,position:s.position,top:s.top,right:s.right,bottom:s.bottom,left:s.left,width:s.width,height:s.height,minWidth:s.minWidth,minHeight:s.minHeight,maxWidth:s.maxWidth,maxHeight:s.maxHeight,flex:s.flex,flexBasis:s.flexBasis,flexGrow:s.flexGrow,flexShrink:s.flexShrink,margin:s.margin,marginTop:s.marginTop,marginRight:s.marginRight,marginBottom:s.marginBottom,marginLeft:s.marginLeft,padding:s.padding,paddingTop:s.paddingTop,paddingRight:s.paddingRight,paddingBottom:s.paddingBottom,paddingLeft:s.paddingLeft,alignItems:s.alignItems,alignSelf:s.alignSelf,boxSizing:s.boxSizing,transform:s.transform,zIndex:s.zIndex}}};const a=w.getBoundingClientRect(),r=b.getBoundingClientRect(),s=getComputedStyle(b),ws=getComputedStyle(w),p=w.parentElement,pr=p?.getBoundingClientRect(),ps=p?getComputedStyle(p):null,root=w.closest('.observatory.home-map'),rs=root?getComputedStyle(root):null,heading=w.querySelector('.dock-heading,.comparison-property-heading');const chain=[];let node=b;while(node&&chain.length<8){chain.push(metric(node));if(node===w)break;node=node.parentElement}const outerChain=[];node=w.parentElement;while(node&&outerChain.length<8){outerChain.push(metric(node));if(node===root)break;node=node.parentElement}phase='styleRules';const matchedRules=[],layout=['display','position','top','right','bottom','left','width','height','min-width','min-height','max-width','max-height','flex','flex-basis','flex-grow','flex-shrink','margin','margin-top','margin-right','margin-bottom','margin-left','padding','padding-top','padding-right','padding-bottom','padding-left','align-items','align-self','box-sizing','transform'];const collect=rules=>{for(const rule of Array.from(rules||[])){const selector=rule.selectorText||'';if(selector&&(/comparison-layer-window|comparison-property-heading/.test(selector)||selector.includes('.dock-heading'))&&matchedRules.length<30){const declarations={};for(const name of layout){const value=rule.style?.getPropertyValue(name);if(value)declarations[name]=value.trim()}matchedRules.push({selector,declarations})}if(rule.cssRules)try{collect(rule.cssRules)}catch(_){}}};for(const sheet of Array.from(document.styleSheets||[]))try{collect(sheet.cssRules)}catch(_){}phase='serialize';const x=r.left+r.width/2,y=r.top+r.height/2,h=document.elementFromPoint(x,y);return JSON.stringify({found:true,window:{x:a.x,y:a.y,width:a.width,height:a.height,top:a.top,bottom:a.bottom,left:a.left,right:a.right},windowStyle:metric(w).style,heading:metric(heading),button:{x:r.x,y:r.y,width:r.width,height:r.height,top:r.top,bottom:r.bottom},buttonStyle:metric(b).style,buttonAncestorChain:chain,outerAncestorChain:outerChain,matchedStyleRules:matchedRules,parentRect:pr?{x:pr.x,y:pr.y,width:pr.width,height:pr.height,top:pr.top,bottom:pr.bottom}:null,parentStyle:ps?{position:ps.position,overflow:ps.overflow}:null,cssVars:{windowHomeBottom:ws.getPropertyValue('--home-bottom').trim(),windowHomeTop:ws.getPropertyValue('--home-top').trim(),windowCompareTop:ws.getPropertyValue('--compare-top').trim(),rootHomeBottom:rs?.getPropertyValue('--home-bottom').trim()||'',rootHomeTop:rs?.getPropertyValue('--home-top').trim()||''},viewport:{width:innerWidth,height:innerHeight},rightInset:a.right-r.right,topInset:r.top-a.top,hit:h===b||h?.closest('button')===b})}catch(error){return JSON.stringify({found:false,qaError:{phase,type:error?.name||'Error'}})}})()";
            JSONObject geometry = new JSONObject(domString(script));
            JSONObject window = geometry.optJSONObject("window"), button = geometry.optJSONObject("button");
            boolean sizePass = button != null && button.optDouble("width") >= 36 - CSS_SIZE_ROUNDING_TOLERANCE &&
                button.optDouble("height") >= 36 - CSS_SIZE_ROUNDING_TOLERANCE;
            boolean insetPass = window != null && button != null && geometry.optDouble("rightInset", -1) >= 0 &&
                geometry.optDouble("rightInset", Double.MAX_VALUE) <= 8 && geometry.optDouble("topInset", -1) >= 0 &&
                geometry.optDouble("topInset", Double.MAX_VALUE) <= 8 && button.optDouble("x") >= window.optDouble("x") &&
                button.optDouble("y") >= window.optDouble("y");
            geometry.put("sizePass", sizePass).put("insetPass", insetPass);
            return geometry;
        }

        private void ensureNoSelectionForQa() throws Exception {
            if (originalSelectedId.isEmpty()) return;
            JSONObject card = (JSONObject)callParent("readSelectionTools");
            if (!card.optBoolean("visible")) throw new IllegalStateException("existing marker selection cannot be safely cleared from the UI");
            tapButton(".selection-tools button", "完成调整");
            if (!"".equals(awaitSelection("", 4_000L))) throw new IllegalStateException("could not clear selection before QA fixture");
        }

        private void restoreOriginalSelection() throws Exception {
            if (originalSelectedId == null || originalSelectedId.isEmpty()) {
                if (!selectedId((JSONObject)callParent("readState")).isEmpty()) {
                    try { tapButton(".selection-tools button", "完成调整"); } catch (Exception ignored) { }
                }
                return;
            }
            refreshMapView();
            double longitude = originalSelectedCoordinates.getDouble(0);
            double latitude = originalSelectedCoordinates.getDouble(1);
            double[] point = project(latitude, longitude);
            if (point == null || point[0] < 0 || point[0] >= mapWidth || point[1] < 0 || point[1] >= mapHeight)
                throw new IllegalStateException("original selection moved outside the restored viewport");
            tap((float)(mapOrigin[0] + point[0]), (float)(mapOrigin[1] + point[1] - 11.0 * cssScale));
            String restored = awaitSelection(originalSelectedId, 5_000L);
            if (!originalSelectedId.equals(restored)) throw new IllegalStateException("original marker selection was not restored");
        }

        private void captureComparisonChoices() throws Exception {
            if (!domBoolean("!!document.querySelector('.comparison-source-picker[data-pane=\"0\"]')")) return;
            for (int pane = 0; pane <= 1; pane++) {
                tapElement(".comparison-source-picker[data-pane='" + pane + "'] .comparison-source-trigger");
                waitForDom(".comparison-source-popup", 3_000L);
                expandAllGroups(String.valueOf(pane));
                originalComparisonChoices[pane] = readSelectedChoice(String.valueOf(pane));
                closeSourcePopupIfOpen();
            }
            comparisonOriginalSourcesCaptured = originalComparisonChoices[0] != null && originalComparisonChoices[1] != null;
        }

        private void restoreOriginalComparisonChoices() throws Exception {
            if (!comparisonOriginalSourcesCaptured) return;
            for (int pane = 0; pane <= 1; pane++) restoreSourceChoice(String.valueOf(pane), originalComparisonChoices[pane]);
        }

        private void enterComparison() throws Exception {
            if (domBoolean("document.querySelector('.observatory.home-map')?.getAttribute('data-comparing')==='true'")) return;
            tapElement(".control-dock [data-panel-toggle='tools']");
            tapButton("#map-control-panel .tool-grid button", "双图源对比");
            if (!waitForDom(".map-comparison-ui", 15_000L)) throw new IllegalStateException("comparison UI did not open");
            long end = SystemClock.elapsedRealtime() + 20_000L;
            while (SystemClock.elapsedRealtime() < end && mapEntry("aux-1") == null) SystemClock.sleep(150L);
            if (mapEntry("aux-1") == null) throw new IllegalStateException("secondary native map did not attach");
            testEnteredComparison = true;
        }

        private JSONObject leaveComparison() throws Exception {
            if (!domBoolean("document.querySelector('.observatory.home-map')?.getAttribute('data-comparing')==='true'"))
                return new JSONObject().put("alreadyClosed", true).put("pass", true);
            JSONObject heading = exitButtonProbe();
            JSONObject touch = tapButton("button[aria-label='退出双图源对比']", "退出双图源对比");
            boolean closed = waitForDomAbsent(".map-comparison-ui", 8_000L);
            boolean pass = heading.optBoolean("sizePass") && heading.optBoolean("insideHeading") && heading.optBoolean("hitTestable") &&
                touch.optBoolean("hit") && closed;
            if (closed) refreshParentMainEntry();
            return new JSONObject().put("headingExit", heading).put("actualTouch", touch)
                .put("returnedToMainMap", closed).put("pass", pass);
        }

        private void refreshParentMainEntry() throws Exception {
            Object host = field(parent, "host");
            Object currentMain = callParent("waitForMainMapEntry", host);
            if (currentMain == null || field(currentMain, "controller") == null || !(field(currentMain, "renderState") instanceof JSONObject))
                throw new IllegalStateException("current main map entry unavailable after comparison exit");
            Field entryField = findField(parent.getClass(), "entry");
            entryField.setAccessible(true);
            entryField.set(parent, currentMain);
            Object entries = field(host, "maps");
            if (!(entries instanceof Map)) throw new IllegalStateException("current map registry unavailable after comparison exit");
            mapEntries = (Map<?, ?>)entries;
            refreshMapView();
            cssScale = ((Number)callParent("viewportScale")).doubleValue();
        }

        private JSONObject exitButtonProbe() throws Exception {
            JSONObject probe = new JSONObject(domString("(()=>{const h=document.querySelector('.map-comparison-heading'),b=h?.querySelector('button[aria-label=\"退出双图源对比\"]');if(!h||!b)return JSON.stringify({found:false});const a=h.getBoundingClientRect(),r=b.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,e=document.elementFromPoint(x,y);return JSON.stringify({found:true,heading:{x:a.x,y:a.y,width:a.width,height:a.height},button:{x:r.x,y:r.y,width:r.width,height:r.height},insideHeading:r.left>=a.left&&r.right<=a.right&&r.top>=a.top&&r.bottom<=a.bottom,hitTestable:e===b||b.contains(e)})})()"));
            JSONObject button = probe.optJSONObject("button");
            boolean sizePass = button != null && button.optDouble("width") >= 36 - CSS_SIZE_ROUNDING_TOLERANCE &&
                button.optDouble("height") >= 36 - CSS_SIZE_ROUNDING_TOLERANCE;
            return probe.put("sizePass", sizePass);
        }

        private JSONObject sourceMenuProbe() throws Exception {
            return new JSONObject(domString("(()=>{const u=document.querySelector('.map-comparison-ui'),p=document.querySelector('.comparison-source-picker[data-pane=\"1\"]'),m=p?.querySelector('.comparison-source-popup');if(!u||!p||!m)return JSON.stringify({found:false});const ur=u.getBoundingClientRect(),mr=m.getBoundingClientRect(),s=getComputedStyle(m),ui=getComputedStyle(u),top=ur.top+(parseFloat(ui.paddingTop)||0)+8,bottom=ur.bottom-(parseFloat(ui.paddingBottom)||0)-8;return JSON.stringify({found:true,popup:{x:mr.x,y:mr.y,width:mr.width,height:mr.height},viewport:{width:innerWidth,height:innerHeight},scrollHeight:m.scrollHeight,clientHeight:m.clientHeight,scrollTop:m.scrollTop,overflowY:s.overflowY,insideSafeViewport:mr.top>=top-1&&mr.bottom<=bottom+1,scrollable:s.overflowY==='auto'||s.overflowY==='scroll'})})()"));
        }

        private JSONObject sourceOptionProbe(String choiceId) throws Exception {
            String quoted = JSONObject.quote(choiceId);
            return new JSONObject(domString("(()=>{const m=document.querySelector('.comparison-source-picker[data-pane=\"1\"] .comparison-source-popup'),b=Array.from(m?.querySelectorAll('[role=option]')||[]).find(x=>x.getAttribute('data-choice-id')===" + quoted + ");if(!m||!b)return JSON.stringify({found:false});const r=b.getBoundingClientRect(),p=m.getBoundingClientRect(),h=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return JSON.stringify({found:true,option:{x:r.x,y:r.y,width:r.width,height:r.height},popup:{x:p.x,y:p.y,width:p.width,height:p.height},fullyVisible:r.top>=p.top&&r.bottom<=p.bottom,insideScroller:m.contains(b),hitTestable:h===b||h?.closest('[role=option]')===b})})()"))
                .put("insideScroller", domBoolean("(()=>{const m=document.querySelector('.comparison-source-picker[data-pane=\"1\"] .comparison-source-popup'),b=Array.from(m?.querySelectorAll('[role=option]')||[]).find(x=>x.getAttribute('data-choice-id')===" + quoted + ");return !!m&&!!b&&m.scrollHeight>=m.clientHeight})()"));
        }

        private void swipePublicSourceIntoView(String choiceId) throws Exception {
            for (int attempt = 0; attempt < 12; attempt++) {
                JSONObject option = sourceOptionProbe(choiceId);
                if (option.optBoolean("fullyVisible") && option.optBoolean("hitTestable")) return;
                JSONObject menu = sourceMenuProbe();
                JSONObject mr = menu.optJSONObject("popup");
                JSONObject or = option.optJSONObject("option");
                if (mr == null || or == null) break;
                float centerX = (float)(mr.getDouble("x") + mr.getDouble("width") * .70);
                float centerY = (float)(mr.getDouble("y") + mr.getDouble("height") * .72);
                float delta = (float)Math.max(30, mr.getDouble("height") * .42);
                boolean optionBelow = or.getDouble("y") + or.getDouble("height") > mr.getDouble("y") + mr.getDouble("height");
                swipeCss(centerX, centerY, centerX, centerY + (optionBelow ? -delta : delta), 260L);
                SystemClock.sleep(120L);
            }
        }

        private boolean waitForPublicTiles(Object controller, String expectedSourceId, long timeoutMs) throws Exception {
            if (!expectedSourceId.equals(OSM_SOURCE_ID)) throw new IllegalArgumentException("unexpected public raster source");
            long deadline = SystemClock.elapsedRealtime() + timeoutMs;
            JSONObject lastState = null;
            while (SystemClock.elapsedRealtime() < deadline) {
                JSONObject state = publicRasterState(controller);
                lastState = state;
                if (state.optBoolean("sourceMatchesExpected") && state.optLong("decoded") > 0) {
                    report.put("publicRasterTilesDecoded", state.optLong("decoded"));
                    report.put("publicRasterMapMatched", state.optBoolean("mapMatched"));
                    report.put("publicRasterSourceMatchesExpected", true);
                    report.put("publicRasterPendingLoadsKnown", false);
                    return true;
                }
                SystemClock.sleep(200L);
            }
            if (lastState == null) lastState = publicRasterState(controller);
            report.put("publicRasterTilesDecoded", lastState.optLong("decoded"));
            report.put("publicRasterMapMatched", lastState.optBoolean("mapMatched"));
            report.put("publicRasterSourceMatchesExpected", lastState.optBoolean("sourceMatchesExpected"));
            report.put("publicRasterPendingLoadsKnown", false);
            return false;
        }

        private JSONObject publicRasterState(Object controller) throws Exception {
            AtomicReference<JSONObject> result = new AtomicReference<>();
            AtomicReference<Throwable> error = new AtomicReference<>();
            parent.runOnMainSync(() -> {
                try {
                    Object host = field(parent, "host");
                    Object mounted = field(host, "maps");
                    if (!(mounted instanceof Map)) throw new Unverified("native-map-registry-unavailable");
                    String mapId = null;
                    for (Map.Entry<?, ?> mountedEntry : ((Map<?, ?>)mounted).entrySet()) {
                        if (field(mountedEntry.getValue(), "controller") == controller) {
                            Object entryId = field(mountedEntry.getValue(), "id");
                            mapId = entryId == null ? null : String.valueOf(entryId);
                            break;
                        }
                    }
                    if (mapId == null) throw new Unverified("native-map-entry-not-mounted");

                    Method diagnostics = host.getClass().getDeclaredMethod("inspectMapDiagnosticsOnMain");
                    diagnostics.setAccessible(true);
                    Object rawValue = diagnostics.invoke(host);
                    if (!(rawValue instanceof JSONObject)) throw new Unverified("native-map-diagnostics-unavailable");
                    JSONArray maps = ((JSONObject)rawValue).optJSONArray("maps");
                    if (maps == null) throw new Unverified("native-map-diagnostics-maps-unavailable");
                    JSONObject matched = null;
                    for (int i = 0; i < maps.length(); i++) {
                        JSONObject candidate = maps.optJSONObject(i);
                        if (candidate != null && mapId.equals(candidate.optString("mapId"))) {
                            matched = candidate;
                            break;
                        }
                    }
                    if (matched == null) throw new Unverified("native-map-diagnostics-entry-unavailable");
                    Object sourceValue = matched.opt("sourceId");
                    Object decodedValue = matched.opt("rasterBitmapDecodes");
                    if (!(sourceValue instanceof String) || !(decodedValue instanceof Number))
                        throw new Unverified("native-raster-diagnostic-fields-unavailable");
                    result.set(new JSONObject().put("mapMatched", true)
                        .put("sourceMatchesExpected", OSM_SOURCE_ID.equals(sourceValue))
                        .put("decoded", ((Number)decodedValue).longValue())
                        .put("pending", JSONObject.NULL).put("pendingKnown", false)
                        .put("evidence", "host.inspectMapDiagnosticsOnMain.maps"));
                } catch (Throwable failure) { error.set(failure); }
            });
            if (error.get() instanceof Unverified) throw (Unverified)error.get();
            if (error.get() != null) throw new IllegalStateException("comparison raster state read failed: " + error.get().getClass().getSimpleName());
            if (result.get() == null) throw new IllegalStateException("comparison raster state unavailable");
            return result.get();
        }

        private void restoreSourceChoice(String pane, String choiceId) throws Exception {
            if (choiceId == null || choiceId.isEmpty()) throw new IllegalStateException("original comparison choice unavailable for restoration");
            if (!sourcePopupVisible(pane))
                tapElement(".comparison-source-picker[data-pane='" + pane + "'] .comparison-source-trigger");
            if (!waitForVisible(".comparison-source-picker[data-pane=\"" + pane + "\"] .comparison-source-popup", 3_000L))
                throw new IllegalStateException("comparison source popup did not become visible for restore");
            expandAllGroups(pane);
            String group = choiceGroup(choiceId, pane);
            if (group == null) throw new IllegalStateException("original source choice no longer exists");
            int index = groupIndex(group);
            ensureSourceGroupOpen(index, group);
            for (int attempt = 0; attempt < 12; attempt++) {
                JSONObject target = choiceProbe(pane, choiceId);
                if (target.optBoolean("fullyVisible") && target.optBoolean("hitTestable")) break;
                JSONObject popup = popupProbe(pane);
                JSONObject rect = target.optJSONObject("option");
                if (rect == null || popup.optJSONObject("rect") == null) throw new IllegalStateException("source choice geometry unavailable during restore");
                JSONObject p = popup.getJSONObject("rect");
                float x = (float)(p.getDouble("x") + p.getDouble("width") * .7);
                float y = (float)(p.getDouble("y") + p.getDouble("height") * .72);
                float dy = (float)Math.max(30, p.getDouble("height") * .4);
                swipeCss(x, y, x, y + (rect.getDouble("y") > p.getDouble("y") + p.getDouble("height") ? -dy : dy), 220L);
            }
            if (!choiceProbe(pane, choiceId).optBoolean("fullyVisible")) throw new IllegalStateException("original source choice could not be scrolled into view");
            tapChoice(pane, choiceId);
            if (!waitForSelectedChoice(pane, choiceId, 6_000L)) throw new IllegalStateException("original source choice did not restore");
        }

        private void tapChoice(String choiceId) throws Exception { tapChoice("1", choiceId); }
        private void tapChoice(String pane, String choiceId) throws Exception {
            JSONObject probe = choiceProbe(pane, choiceId);
            if (!probe.optBoolean("fullyVisible") || !probe.optBoolean("hitTestable")) throw new IllegalStateException("source option is outside the visible scroll window");
            JSONObject point = probe.getJSONObject("option");
            tapCss((float)(point.getDouble("x") + point.getDouble("width") / 2), (float)(point.getDouble("y") + point.getDouble("height") / 2));
        }

        private JSONObject choiceProbe(String pane, String choiceId) throws Exception {
            String q = JSONObject.quote(choiceId);
            return new JSONObject(domString("(()=>{const m=document.querySelector('.comparison-source-picker[data-pane=\"" + pane + "\"] .comparison-source-popup'),b=Array.from(m?.querySelectorAll('[role=option]')||[]).find(x=>x.getAttribute('data-choice-id')===" + q + ");if(!m||!b)return JSON.stringify({found:false});const r=b.getBoundingClientRect(),p=m.getBoundingClientRect(),h=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return JSON.stringify({found:true,option:{x:r.x,y:r.y,width:r.width,height:r.height},popup:{x:p.x,y:p.y,width:p.width,height:p.height},fullyVisible:r.top>=p.top&&r.bottom<=p.bottom,hitTestable:h===b||h?.closest('[role=option]')===b})})()"));
        }

        private JSONObject popupProbe(String pane) throws Exception {
            return new JSONObject(domString("(()=>{const m=document.querySelector('.comparison-source-picker[data-pane=\"" + pane + "\"] .comparison-source-popup');if(!m)return JSON.stringify({found:false});const r=m.getBoundingClientRect();return JSON.stringify({found:true,rect:{x:r.x,y:r.y,width:r.width,height:r.height}})})()"));
        }

        private String[] readSourceCategories() throws Exception {
            JSONArray array = new JSONArray(domString("JSON.stringify(Array.from(document.querySelectorAll('.comparison-source-popup .comparison-source-group-heading')).map(e=>e.querySelector('span')?.textContent?.trim()||''))"));
            String[] values = new String[array.length()];
            for (int i = 0; i < array.length(); i++) values[i] = array.optString(i);
            return values;
        }

        private String readSelectedChoice(String pane) throws Exception {
            return domString("(()=>{const m=document.querySelector('.comparison-source-picker[data-pane=\"" + pane + "\"] .comparison-source-popup');if(!m)return '';const b=m.querySelector('[role=option][aria-selected=\"true\"]');return b?.getAttribute('data-choice-id')||''})()" );
        }

        private boolean sourcePopupVisible(String pane) throws Exception {
            return domBoolean("(()=>{const e=document.querySelector('.comparison-source-picker[data-pane=\"" + pane + "\"] .comparison-source-popup');if(!e)return false;const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)!==0&&r.width>0&&r.height>0})()");
        }

        private String choiceGroup(String choiceId, String pane) throws Exception {
            return domString("(()=>{const m=document.querySelector('.comparison-source-picker[data-pane=\"" + pane + "\"] .comparison-source-popup'),b=Array.from(m?.querySelectorAll('[role=option]')||[]).find(x=>x.getAttribute('data-choice-id')===" + JSONObject.quote(choiceId) + ");return b?.closest('.comparison-source-group')?.querySelector('.comparison-source-group-heading span')?.textContent?.trim()||''})()" );
        }

        private int groupIndex(String groupName) {
            for (int i = 0; i < SOURCE_GROUPS.length; i++) if (SOURCE_GROUPS[i].equals(groupName)) return i;
            return -1;
        }

        private void ensureSourceGroupOpen(int index, String name) throws Exception {
            ensureSourceGroupOpen("1", index, name);
        }

        private void ensureSourceGroupOpen(String pane, int index, String name) throws Exception {
            if (index < 0) throw new IllegalStateException("unknown comparison source group");
            boolean expanded = domBoolean("document.querySelector('.comparison-source-picker[data-pane=\"" + pane + "\"] .comparison-source-group-" + index + " .comparison-source-group-heading')?.getAttribute('aria-expanded')==='true'");
            if (!expanded) {
                String selector = ".comparison-source-picker[data-pane='" + pane + "'] .comparison-source-group-" + index + " .comparison-source-group-heading";
                scrollMenuElementIntoView(pane, selector);
                tapElement(selector);
                long end = SystemClock.elapsedRealtime() + 2_000L;
                while (SystemClock.elapsedRealtime() < end &&
                    !domBoolean("document.querySelector('.comparison-source-picker[data-pane=\"" + pane + "\"] .comparison-source-group-" + index + " .comparison-source-group-heading')?.getAttribute('aria-expanded')==='true'"))
                    SystemClock.sleep(80L);
            }
        }

        private void expandAllGroups(String pane) throws Exception {
            for (int i = 0; i < SOURCE_GROUPS.length; i++) {
                ensureSourceGroupOpen(pane, i, SOURCE_GROUPS[i]);
            }
        }

        private void scrollMenuElementIntoView(String pane, String selector) throws Exception {
            for (int attempt = 0; attempt < 10; attempt++) {
                JSONObject value = new JSONObject(domString("(()=>{const m=document.querySelector('.comparison-source-picker[data-pane=\"" + pane + "\"] .comparison-source-popup'),e=document.querySelector(" + JSONObject.quote(selector) + ");if(!m||!e)return JSON.stringify({found:false});const a=m.getBoundingClientRect(),r=e.getBoundingClientRect();return JSON.stringify({found:true,menu:{x:a.x,y:a.y,width:a.width,height:a.height},element:{x:r.x,y:r.y,width:r.width,height:r.height},visible:r.top>=a.top&&r.bottom<=a.bottom})})()"));
                if (!value.optBoolean("found")) throw new IllegalStateException("menu group heading disappeared");
                if (value.optBoolean("visible")) return;
                JSONObject menu = value.getJSONObject("menu"), element = value.getJSONObject("element");
                float x = (float)(menu.getDouble("x") + menu.getDouble("width") * .7);
                float y = (float)(menu.getDouble("y") + menu.getDouble("height") * .7);
                float delta = (float)Math.max(28, menu.getDouble("height") * .35);
                boolean below = element.getDouble("y") > menu.getDouble("y") + menu.getDouble("height");
                swipeCss(x, y, x, y + (below ? -delta : delta), 200L);
            }
            throw new IllegalStateException("menu group heading could not be scrolled into view");
        }

        private boolean waitForSelectedChoice(String pane, String choiceId, long timeout) throws Exception {
            boolean openedHere = !sourcePopupVisible(pane);
            if (openedHere) tapElement(".comparison-source-picker[data-pane='" + pane + "'] .comparison-source-trigger");
            if (!waitForVisible(".comparison-source-picker[data-pane=\"" + pane + "\"] .comparison-source-popup", 3_000L)) return false;
            expandAllGroups(pane);
            long end = SystemClock.elapsedRealtime() + timeout;
            boolean found = false;
            while (SystemClock.elapsedRealtime() < end) {
                if (choiceId.equals(readSelectedChoice(pane))) { found = true; break; }
                SystemClock.sleep(100L);
            }
            if (openedHere) closeSourcePopupIfOpen();
            return found;
        }

        private void closeSourcePopupIfOpen() throws Exception {
            if (sourcePopupVisible("1") || sourcePopupVisible("0")) tapElement(".map-comparison-heading > strong");
        }

        private void refreshMapView() throws Exception {
            mapView = (View)callParent("worldWindowView");
            parent.runOnMainSync(() -> {
                mapView.getLocationOnScreen(mapOrigin);
                mapWidth = mapView.getWidth();
                mapHeight = mapView.getHeight();
            });
            if (mapWidth < 100 || mapHeight < 100) throw new IllegalStateException("main map viewport is unavailable");
        }

        private double[] unproject(double x, double y) throws Exception {
            Object result = callParent("unproject", x, y);
            if (!(result instanceof double[]) || ((double[])result).length < 2) throw new IllegalStateException("map center could not be unprojected");
            return (double[])result;
        }

        private double[] project(double latitude, double longitude) throws Exception {
            Object controller = field(field(parent, "entry"), "controller");
            AtomicValue holder = new AtomicValue();
            parent.runOnMainSync(() -> {
                try {
                    Method method = null;
                    for (Method candidate : controller.getClass().getDeclaredMethods()) {
                        Class<?>[] parameters = candidate.getParameterTypes();
                        if (candidate.getName().startsWith("projectCoordinate") && parameters.length == 2 &&
                            parameters[0] == double.class && parameters[1] == double.class) {
                            method = candidate;
                            break;
                        }
                    }
                    if (method == null) throw new NoSuchMethodException("projectCoordinate(double,double)");
                    method.setAccessible(true);
                    holder.value = method.invoke(controller, latitude, longitude);
                } catch (Throwable failure) { holder.error = failure; }
            });
            if (holder.error != null) throw new IllegalStateException("marker projection failed", holder.error);
            if (holder.value == null) return null;
            Object pair = holder.value;
            return new double[]{((Number)pair.getClass().getMethod("getFirst").invoke(pair)).doubleValue(),
                ((Number)pair.getClass().getMethod("getSecond").invoke(pair)).doubleValue()};
        }

        private boolean containsString(JSONArray values, String expected) {
            if (values == null || expected == null) return false;
            for (int i = 0; i < values.length(); i++) if (expected.equals(values.optString(i))) return true;
            return false;
        }

        private JSONObject awaitVisibleQaMarker(int[] origin, double x, double y, double scale) throws Exception {
            Field directoryField = findField(parent.getClass(), "evidenceDir");
            directoryField.setAccessible(true);
            Object previousDirectory = directoryField.get(parent);
            try {
                directoryField.set(parent, screenshotDirectory);
                return (JSONObject)callParent("awaitVisiblePinFixtures", origin, new double[][]{{x, y}}, scale,
                    new String[]{"#36a36b"}, 15_000L);
            } finally {
                directoryField.set(parent, previousDirectory);
            }
        }

        private JSONObject locateQaMarkerPixels(int[] origin, double expectedLocalX, double expectedLocalY, double scale) throws Exception {
            Bitmap bitmap = parent.getUiAutomation().takeScreenshot();
            if (bitmap == null) throw new ObservationUnavailable("qa-marker-pixel-scan-screenshot-unavailable");
            try {
                int expectedScreenX = origin[0] + (int)Math.round(expectedLocalX);
                int expectedScreenY = origin[1] + (int)Math.round(expectedLocalY);
                int radius = Math.max(24, (int)Math.ceil(96.0 * scale));
                int left = Math.max(origin[0], Math.max(0, expectedScreenX - radius));
                int top = Math.max(origin[1], Math.max(0, expectedScreenY - radius));
                int right = Math.min(bitmap.getWidth() - 1, Math.min(origin[0] + mapWidth - 1, expectedScreenX + radius));
                int bottom = Math.min(bitmap.getHeight() - 1, Math.min(origin[1] + mapHeight - 1, expectedScreenY + radius));
                if (left > right || top > bottom) throw new ObservationUnavailable("qa-marker-pixel-scan-outside-map-viewport");

                int expected = 0x36a36b;
                int er = (expected >> 16) & 0xff, eg = (expected >> 8) & 0xff, eb = expected & 0xff;
                int minX = Integer.MAX_VALUE, minY = Integer.MAX_VALUE, maxX = -1, maxY = -1;
                long sumX = 0L, sumY = 0L;
                int count = 0;
                for (int py = top; py <= bottom; py++) for (int px = left; px <= right; px++) {
                    long dx = px - expectedScreenX, dy = py - expectedScreenY;
                    if (dx * dx + dy * dy > (long)radius * radius) continue;
                    int pixel = bitmap.getPixel(px, py);
                    if (((pixel >>> 24) & 0xff) <= 128 ||
                        Math.abs(((pixel >> 16) & 0xff) - er) > 8 ||
                        Math.abs(((pixel >> 8) & 0xff) - eg) > 8 ||
                        Math.abs((pixel & 0xff) - eb) > 8) continue;
                    minX = Math.min(minX, px); minY = Math.min(minY, py);
                    maxX = Math.max(maxX, px); maxY = Math.max(maxY, py);
                    sumX += px; sumY += py; count++;
                }
                if (count < 32 || maxX < minX || maxY < minY)
                    throw new ObservationUnavailable("qa-marker-color-bounds-not-observed");
                double boundsWidthCss = (maxX - minX + 1) / scale;
                double boundsHeightCss = (maxY - minY + 1) / scale;
                if (boundsWidthCss < 16 || boundsWidthCss > 160 || boundsHeightCss < 8 || boundsHeightCss > 70)
                    throw new ObservationUnavailable("qa-marker-color-bounds-outside-expected-label-size");

                double observedScreenX = (minX + maxX) / 2.0;
                double observedScreenY = (minY + maxY) / 2.0;
                double localX = observedScreenX - origin[0];
                double localY = observedScreenY - origin[1];
                double offsetCssX = (localX - expectedLocalX) / scale;
                double offsetCssY = (localY - expectedLocalY) / scale;
                if (Math.hypot(offsetCssX, offsetCssY) > 96.0)
                    throw new ObservationUnavailable("qa-marker-color-outside-bounded-search-radius");
                return new JSONObject().put("found", true).put("method", "QA color pixel bounding-box center")
                    .put("pixelCount", count)
                    .put("colorTolerance", 8).put("minimumPixels", 32)
                    .put("boundsScreenPx", new JSONObject().put("left", minX).put("top", minY).put("right", maxX).put("bottom", maxY))
                    .put("boundsCss", new JSONObject().put("width", boundsWidthCss).put("height", boundsHeightCss))
                    .put("expectedScreenPx", new JSONObject().put("x", expectedScreenX).put("y", expectedScreenY))
                    .put("observedScreenPx", new JSONObject().put("x", observedScreenX).put("y", observedScreenY))
                    .put("localX", localX).put("localY", localY)
                    .put("offsetCss", new JSONObject().put("x", offsetCssX).put("y", offsetCssY))
                    .put("matchCentroidScreenPx", new JSONObject().put("x", sumX / (double)count).put("y", sumY / (double)count))
                    .put("searchRadiusCss", 96.0);
            } finally { bitmap.recycle(); }
        }

        private JSONObject markerCardProbe() throws Exception {
            return new JSONObject(domString("(()=>{const e=document.querySelector('.selection-tools.is-annotation'),b=e?.querySelector('.selection-tools-delete'),c=e?.querySelector('.annotation-coordinate-info-values button');const r=n=>{if(!n)return null;const x=n.getBoundingClientRect();return{x:x.x,y:x.y,width:x.width,height:x.height}};return JSON.stringify({exists:!!e,card:r(e),delete:r(b),copy:r(c),deleteAtTopRight:!!e&&!!b&&b.getBoundingClientRect().top<=e.getBoundingClientRect().top+55&&b.getBoundingClientRect().right<=e.getBoundingClientRect().right,compactTargets:!!b&&b.getBoundingClientRect().width>=27.75&&b.getBoundingClientRect().height>=27.75&&!!c&&c.getBoundingClientRect().width>=27.75&&c.getBoundingClientRect().height>=27.75})})()"));
        }

        private JSONObject deleteConfirmProbe() throws Exception {
            JSONObject value = new JSONObject(domString("(()=>{const d=document.querySelector('.selection-tools-delete-confirm'),r=n=>{if(!n)return null;const x=n.getBoundingClientRect();return{x:x.x,y:x.y,width:x.width,height:x.height}};return JSON.stringify({visible:!!d&&getComputedStyle(d).display!=='none'&&d.getBoundingClientRect().width>0,geometry:{dialog:r(d),cancel:r(d?.querySelector('button')),confirm:r(d?.querySelector('.is-danger'))}})})()"));
            JSONObject geometry = value.optJSONObject("geometry");
            JSONObject cancel = geometry == null ? null : geometry.optJSONObject("cancel");
            JSONObject confirm = geometry == null ? null : geometry.optJSONObject("confirm");
            boolean geometryPass = cancel != null && confirm != null &&
                cancel.optDouble("width") >= 28 - CSS_SIZE_ROUNDING_TOLERANCE && cancel.optDouble("height") >= 28 - CSS_SIZE_ROUNDING_TOLERANCE &&
                confirm.optDouble("width") >= 28 - CSS_SIZE_ROUNDING_TOLERANCE && confirm.optDouble("height") >= 28 - CSS_SIZE_ROUNDING_TOLERANCE;
            return value.put("geometryPass", geometryPass);
        }

        private boolean annotationExists(String id) throws Exception {
            JSONObject state = (JSONObject)callParent("readState");
            JSONArray annotations = state.optJSONArray("annotations");
            if (annotations == null) return false;
            for (int i = 0; i < annotations.length(); i++) {
                JSONObject item = annotations.optJSONObject(i);
                if (item != null && id.equals(item.optString("id"))) return true;
            }
            return false;
        }

        private String awaitSelection(String expected, long timeout) throws Exception {
            long end = SystemClock.elapsedRealtime() + timeout;
            String current = "";
            while (SystemClock.elapsedRealtime() < end) {
                current = selectedId((JSONObject)callParent("readState"));
                if (expected.equals(current)) return current;
                SystemClock.sleep(80L);
            }
            return current;
        }

        private boolean waitForSearchValue(String expected, long timeout) throws Exception {
            long end = SystemClock.elapsedRealtime() + timeout;
            while (SystemClock.elapsedRealtime() < end) {
                if (expected.equals(domString("document.querySelector(" + JSONObject.quote(SEARCH_SELECTOR) + ")?.value||''"))) return true;
                SystemClock.sleep(80L);
            }
            return false;
        }

        private boolean accessibilityPaste(String expected) throws Exception {
            longPressElement(SEARCH_SELECTOR);
            long end = SystemClock.elapsedRealtime() + 2_000L;
            while (SystemClock.elapsedRealtime() < end) {
                AccessibilityNodeInfo root = parent.getUiAutomation().getRootInActiveWindow();
                if (root != null) {
                    for (String label : new String[]{"粘贴", "Paste"}) {
                        List<AccessibilityNodeInfo> nodes = root.findAccessibilityNodeInfosByText(label);
                        if (nodes == null) continue;
                        for (AccessibilityNodeInfo node : nodes) {
                            Rect rect = new Rect(); node.getBoundsInScreen(rect);
                            if (!rect.isEmpty() && node.isVisibleToUser()) {
                                tap((rect.left + rect.right) / 2f, (rect.top + rect.bottom) / 2f);
                                if (waitForSearchValue(expected, 2_000L)) return true;
                            }
                        }
                    }
                }
                SystemClock.sleep(100L);
            }
            return false;
        }

        private boolean waitForSearchCenter(double latitude, double longitude, long timeout) throws Exception {
            long end = SystemClock.elapsedRealtime() + timeout;
            while (SystemClock.elapsedRealtime() < end) {
                JSONObject camera = (JSONObject)callParent("invokeCameraJson");
                JSONArray center = camera.optJSONArray("center");
                boolean result = domBoolean("document.querySelector('.place-search-results')?.textContent?.includes('坐标位置')===true");
                if (result && center != null && center.length() >= 2 &&
                    Math.abs(center.optDouble(0, Double.NaN) - longitude) < 1e-7 &&
                    Math.abs(center.optDouble(1, Double.NaN) - latitude) < 1e-7) return true;
                SystemClock.sleep(120L);
            }
            return false;
        }

        private JSONObject tapButton(String selector, String text) throws Exception {
            JSONObject result = (JSONObject)callParent("tapDomButton", selector, text, cssScale);
            if (!result.optBoolean("hit") || result.optBoolean("disabled")) throw new IllegalStateException("actual touch failed for button: " + text);
            return result;
        }

        private JSONObject tapElement(String selector) throws Exception {
            JSONObject point = new JSONObject(domString("(()=>{const e=document.querySelector(" + JSONObject.quote(selector) + ");if(!e)return JSON.stringify({found:false});const r=e.getBoundingClientRect(),s=getComputedStyle(e),x=r.left+r.width/2,y=r.top+r.height/2,h=document.elementFromPoint(x,y);return JSON.stringify({found:true,visible:s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)!==0&&r.width>0&&r.height>0,hit:h===e||e.contains(h),x,y})})()"));
            if (!point.optBoolean("found") || !point.optBoolean("visible") || !point.optBoolean("hit")) throw new IllegalStateException("element is not visible/hit-testable: " + selector);
            tapCss((float)point.getDouble("x"), (float)point.getDouble("y"));
            return point.put("touched", true);
        }

        private void awaitWebViewDraw(long timeoutMs) throws Exception {
            WebView webView = (WebView)field(parent, "webView");
            CountDownLatch drawn = new CountDownLatch(1);
            AtomicReference<ViewTreeObserver> observer = new AtomicReference<>();
            ViewTreeObserver.OnDrawListener listener = drawn::countDown;
            parent.runOnMainSync(() -> {
                ViewTreeObserver current = webView.getViewTreeObserver();
                if (!current.isAlive()) throw new IllegalStateException("WebView draw observer is unavailable");
                observer.set(current);
                current.addOnDrawListener(listener);
                webView.postInvalidate();
            });
            boolean completed = drawn.await(timeoutMs, TimeUnit.MILLISECONDS);
            parent.runOnMainSync(() -> {
                ViewTreeObserver current = observer.get();
                if (current != null && current.isAlive()) current.removeOnDrawListener(listener);
            });
            if (!completed) throw new IllegalStateException("WebView did not draw before QA screenshot");
        }

        private void longPressElement(String selector) throws Exception {
            JSONObject point = new JSONObject(domString("(()=>{const e=document.querySelector(" + JSONObject.quote(selector) + ");if(!e)return JSON.stringify({found:false});const r=e.getBoundingClientRect();return JSON.stringify({found:true,x:r.left+r.width/2,y:r.top+r.height/2})})()"));
            if (!point.optBoolean("found")) throw new IllegalStateException("search input unavailable for paste");
            float[] screen = cssToScreen((float)point.getDouble("x"), (float)point.getDouble("y"));
            long downTime = SystemClock.uptimeMillis();
            sendMotion(MotionEvent.ACTION_DOWN, downTime, downTime, screen[0], screen[1]);
            SystemClock.sleep(750L);
            long now = SystemClock.uptimeMillis();
            sendMotion(MotionEvent.ACTION_UP, downTime, now, screen[0], screen[1]);
        }

        private void tapCss(float x, float y) throws Exception {
            float[] screen = cssToScreen(x, y);
            tap(screen[0], screen[1]);
        }

        private float[] cssToScreen(float x, float y) throws Exception {
            WebView webView = (WebView)field(parent, "webView");
            int[] origin = new int[2];
            parent.runOnMainSync(() -> webView.getLocationOnScreen(origin));
            return new float[]{origin[0] + x * (float)cssScale, origin[1] + y * (float)cssScale};
        }

        private void swipeCss(float x1, float y1, float x2, float y2, long duration) throws Exception {
            float[] start = cssToScreen(x1, y1), end = cssToScreen(x2, y2);
            long down = SystemClock.uptimeMillis();
            sendMotion(MotionEvent.ACTION_DOWN, down, down, start[0], start[1]);
            int count = Math.max(3, (int)(duration / 30));
            for (int i = 1; i <= count; i++) {
                SystemClock.sleep(duration / count);
                float t = i / (float)count;
                sendMotion(MotionEvent.ACTION_MOVE, down, SystemClock.uptimeMillis(), start[0] + (end[0] - start[0]) * t,
                    start[1] + (end[1] - start[1]) * t);
            }
            sendMotion(MotionEvent.ACTION_UP, down, SystemClock.uptimeMillis(), end[0], end[1]);
        }

        private void sendMotion(int action, long downTime, long eventTime, float x, float y) {
            MotionEvent event = MotionEvent.obtain(downTime, eventTime, action, x, y, 0);
            event.setSource(InputDevice.SOURCE_TOUCHSCREEN);
            try { parent.sendPointerSync(event); } finally { event.recycle(); }
        }

        private void tap(float x, float y) { invokeParentQuiet("tap", x, y); }

        private Object call(Object owner, String name, Object... args) throws Exception {
            return invoke(owner, name, args);
        }

        private Object mapEntry(String id) throws Exception {
            AtomicReference<Object> value = new AtomicReference<>();
            parent.runOnMainSync(() -> { if (mapEntries != null) value.set(mapEntries.get(id)); });
            return value.get();
        }

        private void captureAllMapCameras() throws Exception {
            AtomicReference<Throwable> failure = new AtomicReference<>();
            parent.runOnMainSync(() -> {
                try {
                    Object host = field(parent, "host");
                    Object maps = field(host, "maps");
                    if (!(maps instanceof Map)) throw new IllegalStateException("map registry unavailable");
                    Method cameraMethod = findMethod(host.getClass(), "cameraJson", 1);
                    cameraMethod.setAccessible(true);
                    for (Map.Entry<?, ?> item : ((Map<?, ?>)maps).entrySet()) {
                        Object entry = item.getValue();
                        JSONObject value = (JSONObject)cameraMethod.invoke(host, entry);
                        if (value == null) throw new IllegalStateException("camera snapshot unavailable");
                        originalCameras.add(new MapCamera(String.valueOf(item.getKey()), new JSONObject(value.toString())));
                    }
                } catch (Throwable error) { failure.set(error); }
            });
            if (failure.get() != null) {
                Throwable error = failure.get();
                Throwable cause = error instanceof java.lang.reflect.InvocationTargetException && error.getCause() != null ? error.getCause() : error;
                try { report.put("cameraCaptureFailureType", cause.getClass().getSimpleName()); } catch (Exception ignored) { }
                throw new IllegalStateException("camera-capture-failed-" + cause.getClass().getSimpleName());
            }
            if (originalCameras.isEmpty()) {
                try { report.put("cameraCaptureFailureType", "NoCameraSnapshots"); } catch (Exception ignored) { }
                throw new IllegalStateException("camera-capture-failed-NoCameraSnapshots");
            }
        }

        private void restoreCameras() throws Exception {
            for (MapCamera snapshot : originalCameras) {
                AtomicReference<Throwable> failure = new AtomicReference<>();
                parent.runOnMainSync(() -> {
                    try {
                        Object host = field(parent, "host"), maps = field(host, "maps");
                        if (!(maps instanceof Map)) throw new IllegalStateException("map registry unavailable");
                        Object entry = ((Map<?, ?>)maps).get(snapshot.mapId);
                        if (entry == null) return;
                        Method runCamera = findMethod(host.getClass(), "runCamera", 3);
                        runCamera.setAccessible(true);
                        runCamera.invoke(host, entry, "applyCamera", new JSONObject().put("camera", snapshot.camera));
                    } catch (Throwable error) { failure.set(error); }
                });
                if (failure.get() != null) throw new IllegalStateException("camera restore failed: " + failure.get().getClass().getSimpleName());
            }
            Object main = mapEntry("main");
            if (main != null) {
                Object count = field(main, "actualFrameCount");
                if (count instanceof java.util.concurrent.atomic.AtomicLong) {
                    long base = ((java.util.concurrent.atomic.AtomicLong)count).get();
                    long end = SystemClock.elapsedRealtime() + 8_000L;
                    while (SystemClock.elapsedRealtime() < end && ((java.util.concurrent.atomic.AtomicLong)count).get() <= base) {
                        parent.runOnMainSync(() -> { try { field(field(main, "controller"), "worldWindow").getClass().getMethod("requestRedraw").invoke(field(field(main, "controller"), "worldWindow")); } catch (Exception ignored) { } });
                        SystemClock.sleep(100L);
                    }
                }
            }
        }

        private void restoreLocalStorage(String key, String value, String eventName) throws Exception {
            String quotedKey = JSONObject.quote(key);
            String val = value == null ? "null" : JSONObject.quote(value);
            String event = eventName == null ? "" : "window.dispatchEvent(new Event(" + JSONObject.quote(eventName) + "));";
            String script = "(()=>{const k=" + quotedKey + ",o=localStorage.getItem(k),v=" + val + ";if(v===null)localStorage.removeItem(k);else localStorage.setItem(k,v);const n=localStorage.getItem(k);window.dispatchEvent(new StorageEvent('storage',{key:k,oldValue:o,newValue:n,storageArea:localStorage}));" + event + "return 'ok'})()";
            callParent("evalJs", script);
        }

        private String localStorageValue(String key) throws Exception {
            String encoded = domString("JSON.stringify({value:localStorage.getItem(" + JSONObject.quote(key) + ")})");
            JSONObject value = new JSONObject(encoded);
            return value.isNull("value") ? null : value.getString("value");
        }

        private ClipData clipboard() throws Exception {
            final ClipData[] clip = new ClipData[1];
            parent.runOnMainSync(() -> {
                ClipboardManager manager = (ClipboardManager)parent.getTargetContext().getSystemService(Context.CLIPBOARD_SERVICE);
                clip[0] = manager == null ? null : manager.getPrimaryClip();
            });
            return clip[0];
        }

        private String clipboardText() throws Exception {
            final String[] text = new String[1];
            parent.runOnMainSync(() -> {
                ClipboardManager manager = (ClipboardManager)parent.getTargetContext().getSystemService(Context.CLIPBOARD_SERVICE);
                ClipData clip = manager == null ? null : manager.getPrimaryClip();
                if (clip != null && clip.getItemCount() > 0) text[0] = String.valueOf(clip.getItemAt(0).coerceToText(parent.getTargetContext()));
            });
            return text[0];
        }

        private CopyRead awaitCoordinateCopy() throws Exception {
            long deadline = SystemClock.elapsedRealtime() + 6_000L;
            String previous = null;
            int matchingReads = 0;
            boolean exact = false;
            String status = "";
            boolean uiFailed = false;
            while (SystemClock.elapsedRealtime() < deadline) {
                status = domString("document.querySelector('.annotation-coordinate-info [role=status]')?.textContent?.trim()||''");
                String current = clipboardText();
                exact = current != null && exactCoordinateRoundTrip(current, qaLatitude, qaLongitude);
                if (exact && current.equals(previous)) matchingReads++;
                else matchingReads = exact ? 1 : 0;
                previous = current;
                if ("复制失败，请检查剪贴板权限".equals(status)) {
                    uiFailed = true;
                    return new CopyRead(current, status, exact, matchingReads, true, true);
                }
                if ("已复制，可粘贴到 Google Maps".equals(status) && exact && matchingReads >= 2)
                    return new CopyRead(current, status, true, matchingReads, true, false);
                SystemClock.sleep(120L);
            }
            return new CopyRead(null, status, exact, matchingReads, false, uiFailed);
        }

        private void restoreClipboard() throws Exception {
            if (!clipboardCaptured) return;
            parent.runOnMainSync(() -> {
                ClipboardManager manager = (ClipboardManager)parent.getTargetContext().getSystemService(Context.CLIPBOARD_SERVICE);
                if (manager == null) return;
                if (originalClipboard == null) manager.clearPrimaryClip();
                else manager.setPrimaryClip(originalClipboard);
            });
            clipboardCaptured = false;
        }

        private boolean exactCoordinateRoundTrip(String text, double latitude, double longitude) {
            String[] parts = text.trim().split("\\s*,\\s*");
            if (parts.length != 2 || parts[0].length() < 8 || parts[1].length() < 8) return false;
            try {
                return Double.doubleToLongBits(Double.parseDouble(parts[0])) == Double.doubleToLongBits(latitude) &&
                    Double.doubleToLongBits(Double.parseDouble(parts[1])) == Double.doubleToLongBits(longitude) &&
                    new BigDecimal(parts[0]).compareTo(BigDecimal.valueOf(latitude)) == 0 &&
                    new BigDecimal(parts[1]).compareTo(BigDecimal.valueOf(longitude)) == 0;
            } catch (Exception ignored) { return false; }
        }

        private double domNumber(String selector, String property) throws Exception {
            return Double.parseDouble(domString("(()=>{const e=document.querySelector(" + JSONObject.quote(selector) + ");if(!e)return '0';const r=e.getBoundingClientRect();return String(" + ("width".equals(property) ? "r.width" : "height".equals(property) ? "r.height" : "0") + ")})()"));
        }

        private boolean waitForDom(String selector, long timeout) throws Exception {
            long end = SystemClock.elapsedRealtime() + timeout;
            while (SystemClock.elapsedRealtime() < end) {
                if (domBoolean("!!document.querySelector(" + JSONObject.quote(selector) + ")")) return true;
                SystemClock.sleep(80L);
            }
            return false;
        }

        private boolean waitForVisible(String selector, long timeout) throws Exception {
            String expression = "(()=>{const e=document.querySelector(" + JSONObject.quote(selector) + ");if(!e)return false;const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)!==0&&r.width>0&&r.height>0})()";
            long end = SystemClock.elapsedRealtime() + timeout;
            while (SystemClock.elapsedRealtime() < end) {
                if (domBoolean(expression)) return true;
                SystemClock.sleep(80L);
            }
            return false;
        }

        private boolean waitForDomAbsent(String selector, long timeout) throws Exception {
            String exists = "!!document.querySelector(" + JSONObject.quote(selector) + ")";
            long end = SystemClock.elapsedRealtime() + timeout;
            while (SystemClock.elapsedRealtime() < end) {
                if (!domBoolean(exists)) return true;
                SystemClock.sleep(80L);
            }
            return !domBoolean(exists);
        }

        private boolean waitUntil(CheckedBoolean condition, long timeout) throws Exception {
            long end = SystemClock.elapsedRealtime() + timeout;
            while (SystemClock.elapsedRealtime() < end) {
                if (condition.get()) return true;
                SystemClock.sleep(100L);
            }
            return false;
        }

        private boolean domBoolean(String expression) throws Exception { return "true".equals(domString(expression)); }
        private String domString(String expression) throws Exception { return (String)callParent("evalJs", expression); }

        private Object callParent(String name, Object... args) throws Exception { return invoke(parent, name, args); }
        private void invokeParentQuiet(String name, Object... args) {
            try { callParent(name, args); } catch (Exception failure) { throw new IllegalStateException(failure); }
        }

        private String cleanup() {
            JSONObject values = new JSONObject();
            boolean comparing = false;
            try { comparing = domBoolean("document.querySelector('.observatory.home-map')?.getAttribute('data-comparing')==='true'"); }
            catch (Throwable failure) { putFailure(values, "comparisonStateError", failure); }
            if (targetWasComparing && !comparing) {
                try { enterComparison(); comparing = true; }
                catch (Throwable failure) { putFailure(values, "comparisonRestoreError", failure); }
            }
            try {
                if (domBoolean("!!document.querySelector('#comparison-layer-window')"))
                    tapButton("#comparison-layer-window button[aria-label='关闭对比图层']", "关闭对比图层");
            } catch (Throwable failure) { putFailure(values, "layerWindowCleanupError", failure); }
            try {
                if (domBoolean("!!document.querySelector('.comparison-line-properties')"))
                    tapElement(".comparison-line-properties button[aria-label='关闭路线样式']");
            } catch (Throwable failure) { putFailure(values, "propertyWindowCleanupError", failure); }
            try {
                if (domBoolean("!!document.querySelector('.place-search-results[open]')")) tapButton("button[aria-label='关闭地点搜索']", "关闭地点搜索");
                if (domBoolean("!!document.querySelector('button[aria-label=\"清空地点搜索\"]')")) tapButton("button[aria-label='清空地点搜索']", "清空地点搜索");
            } catch (Throwable ignored) { }
            try { if (domBoolean("!!document.querySelector('.comparison-source-popup')")) closeSourcePopupIfOpen(); }
            catch (Throwable failure) { putFailure(values, "sourcePopupCleanupError", failure); }

            if (comparing) {
                try {
                    if (targetWasComparing && comparisonOriginalSourcesCaptured) restoreOriginalComparisonChoices();
                    else if (workflowComparisonChoices[1] != null && (sourceWasChanged || targetWasComparing))
                        restoreSourceChoice("1", workflowComparisonChoices[1]);
                    values.put("sourceRestored", true);
                } catch (Throwable failure) { putFailure(values, "sourceRestoreError", failure); }
            }
            try {
                if (!targetWasComparing && domBoolean("document.querySelector('.observatory.home-map')?.getAttribute('data-comparing')==='true'")) {
                    leaveComparison();
                    comparing = false;
                }
            } catch (Throwable failure) { putFailure(values, "comparisonExitError", failure); }
            try {
                if (searchHistoryCaptured) {
                    restoreLocalStorage(SEARCH_HISTORY_KEY, originalSearchHistory, null);
                    values.put("searchHistoryRestored", equalLocalStorage(SEARCH_HISTORY_KEY, originalSearchHistory));
                }
            }
            catch (Throwable failure) { putFailure(values, "searchHistoryRestoreError", failure); }
            try {
                if (sourceGroupsCaptured) {
                    restoreLocalStorage(SOURCE_GROUPS_KEY, originalSourceGroups, SOURCE_GROUPS_EVENT);
                    values.put("sourceGroupsRestored", equalLocalStorage(SOURCE_GROUPS_KEY, originalSourceGroups));
                }
            }
            catch (Throwable failure) { putFailure(values, "sourceGroupsRestoreError", failure); }

            try {
                JSONObject state = (JSONObject)callParent("readState");
                if (qaId.equals(selectedId(state)) && domBoolean("!!document.querySelector('.selection-tools.is-annotation')"))
                    tapButton(".selection-tools.is-annotation button", "完成调整");
            } catch (Throwable failure) { putFailure(values, "qaSelectionCleanupError", failure); }
            try {
                if (fixtureInserted) {
                    callParent("removeOnlyQaIds");
                    if (parentQaIds != null) parentQaIds.remove(qaId);
                }
                values.put("qaIdsRemaining", callParent("countQaIdsInStorage"));
            }
            catch (Throwable failure) { putFailure(values, "qaIdCleanupError", failure); }

            try { if (!originalCameras.isEmpty()) restoreCameras(); values.put("cameraRestored", true); }
            catch (Throwable failure) { putFailure(values, "cameraRestoreError", failure); }
            try { restoreOriginalSelection(); values.put("selectionRestored", originalSelectedId.isEmpty() || selectedId((JSONObject)callParent("readState")).equals(originalSelectedId)); }
            catch (Throwable failure) { putFailure(values, "selectionRestoreError", failure); }
            try { restoreClipboard(); values.put("clipboardRestored", true); }
            catch (Throwable failure) { putFailure(values, "clipboardRestoreError", failure); }
            try {
                boolean modeRestored = domBoolean("document.querySelector('.observatory.home-map')?.getAttribute('data-comparing')==='true'") == targetWasComparing;
                values.put("comparisonModeRestored", modeRestored);
            } catch (Throwable failure) { putFailure(values, "comparisonModeRestoreError", failure); }
            try {
                int finalCount = annotationCount((JSONObject)callParent("readState"));
                values.put("finalAnnotationCount", finalCount)
                    .put("annotationCountRestored", originalAnnotationCount < 0 || originalAnnotationCount == finalCount);
            }
            catch (Throwable failure) { putFailure(values, "finalStateError", failure); }
            return values.toString();
        }

        private boolean equalLocalStorage(String key, String value) throws Exception {
            String current = localStorageValue(key);
            return value == null ? current == null : value.equals(current);
        }

        private boolean cleanupPass(JSONObject state) {
            boolean pass = state.optInt("qaIdsRemaining", -1) == 0 && state.optBoolean("cameraRestored") &&
                state.optBoolean("selectionRestored") && state.optBoolean("clipboardRestored") &&
                state.optBoolean("comparisonModeRestored") && state.optBoolean("annotationCountRestored");
            if (searchHistoryCaptured) pass &= state.optBoolean("searchHistoryRestored");
            if (sourceGroupsCaptured) pass &= state.optBoolean("sourceGroupsRestored");
            if (targetWasComparing || sourceWasChanged) pass &= state.optBoolean("sourceRestored");
            return pass;
        }

        private void putFailure(JSONObject out, String key, Throwable failure) {
            try { out.put(key, safeError(failure)); } catch (Exception ignored) { }
        }

        private void initializeScreenshotDirectory(String suite) throws Exception {
            File base = parent.getTargetContext().getExternalFilesDir(null);
            if (base == null) throw new IllegalStateException("private screenshot storage unavailable");
            File canonicalBase = base.getCanonicalFile();
            File directory = new File(canonicalBase, "Pictures/native163-ui/" + suite + "-" + UUID.randomUUID()).getCanonicalFile();
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
            awaitWebViewDraw(3_000L);
            // WebView DOM commit and Android OnDraw can precede SurfaceFlinger composition.
            // This QA-only settle interval is excluded from all performance measurements.
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

    }

    private interface CheckedBoolean { boolean get() throws Exception; }
    private static final class CopyRead {
        final String text;
        final String uiStatus;
        final boolean exact;
        final int stableMatchingReads;
        final boolean settled;
        final boolean uiReportedFailure;
        final boolean success;
        CopyRead(String text, String uiStatus, boolean exact, int reads, boolean settled, boolean uiReportedFailure) {
            this.text = text; this.uiStatus = uiStatus; this.exact = exact; this.stableMatchingReads = reads;
            this.settled = settled; this.uiReportedFailure = uiReportedFailure;
            this.success = settled && exact && !uiReportedFailure && "已复制，可粘贴到 Google Maps".equals(uiStatus);
        }
    }
    private static final class ObservationUnavailable extends RuntimeException {
        ObservationUnavailable(String reason) { super(reason); }
    }
    private static final class Unverified extends RuntimeException {
        Unverified(String reason) { super(reason); }
    }
    private static final class AtomicValue { Object value; Throwable error; }
    private static final class MapCamera {
        final String mapId;
        final JSONObject camera;
        MapCamera(String mapId, JSONObject camera) { this.mapId = mapId; this.camera = camera; }
    }

    private static Object invoke(Object owner, String name, Object... args) throws Exception {
        Method method = null;
        for (Class<?> type = owner.getClass(); type != null && method == null; type = type.getSuperclass()) {
            for (Method candidate : type.getDeclaredMethods()) {
                if (!candidate.getName().equals(name) || candidate.getParameterTypes().length != args.length) continue;
                boolean compatible = true;
                Class<?>[] params = candidate.getParameterTypes();
                for (int i = 0; i < params.length; i++) if (!compatible(params[i], args[i])) { compatible = false; break; }
                if (compatible) { method = candidate; break; }
            }
        }
        if (method == null) throw new NoSuchMethodException(owner.getClass().getName() + "." + name);
        method.setAccessible(true);
        return method.invoke(owner, args);
    }

    private static Method findMethod(Class<?> type, String name, int arity) throws NoSuchMethodException {
        for (Class<?> current = type; current != null; current = current.getSuperclass())
            for (Method method : current.getDeclaredMethods()) if (method.getName().equals(name) && method.getParameterTypes().length == arity) return method;
        throw new NoSuchMethodException(type.getName() + "." + name);
    }

    private static boolean compatible(Class<?> type, Object value) {
        if (value == null) return !type.isPrimitive();
        if (type.isInstance(value)) return true;
        if (!type.isPrimitive()) return false;
        return (type == double.class && value instanceof Double) || (type == float.class && value instanceof Float) ||
            (type == long.class && value instanceof Long) || (type == int.class && value instanceof Integer) ||
            (type == boolean.class && value instanceof Boolean);
    }

    private static Object field(Object owner, String name) throws Exception {
        for (Class<?> type = owner.getClass(); type != null; type = type.getSuperclass()) {
            try { Field field = type.getDeclaredField(name); field.setAccessible(true); return field.get(owner); }
            catch (NoSuchFieldException ignored) { }
        }
        throw new NoSuchFieldException(owner.getClass().getName() + "." + name);
    }

    private static Field findField(Class<?> type, String name) throws NoSuchFieldException {
        for (Class<?> current = type; current != null; current = current.getSuperclass()) {
            try { return current.getDeclaredField(name); }
            catch (NoSuchFieldException ignored) { }
        }
        throw new NoSuchFieldException(type.getName() + "." + name);
    }

    private static String selectedId(JSONObject state) {
        String id = state.optString("annotationSelected", "");
        return id.isEmpty() || "null".equals(id) ? "" : id;
    }

    private static int annotationCount(JSONObject state) {
        JSONArray array = state.optJSONArray("annotations");
        return array == null ? 0 : array.length();
    }

    private static JSONArray annotationCoordinates(JSONObject state, String id) {
        if (id == null || id.isEmpty()) return null;
        JSONArray annotations = state.optJSONArray("annotations");
        if (annotations == null) return null;
        for (int i = 0; i < annotations.length(); i++) {
            JSONObject item = annotations.optJSONObject(i);
            if (item != null && id.equals(item.optString("id"))) return item.optJSONArray("coordinates");
        }
        return null;
    }

    private static String safeError(Throwable failure) {
        Throwable cause = failure;
        while (cause.getCause() != null && cause.getCause() != cause) cause = cause.getCause();
        String message = cause.getClass().getSimpleName() + ":" + String.valueOf(cause.getMessage());
        String safe = message.replaceAll("(?i)https?://\\S+", "[redacted-url]")
            .replaceAll("(?i)(token|api.?key|tk)=?[^\\s&]+", "$1=[redacted]")
            .replaceAll("[\\r\\n]", " ");
        return safe.substring(0, Math.min(240, safe.length()));
    }
}
