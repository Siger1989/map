package com.shantu.qa149;

import android.app.Activity;
import android.os.Environment;
import android.os.SystemClock;
import android.view.InputDevice;
import android.view.MotionEvent;
import android.view.View;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** Actual MotionEvent drawing QA. Never saves a route or edits an existing draft. */
public final class Native163DrawingRegression {
    private static final int MAX_SOURCE_POINTS = 6000;
    private static final int MAX_GESTURE_WAYPOINTS = 16;
    private static final int CAMERA_PAN_STEPS = 24;
    private static final float CAMERA_PAN_STEP_CSS = 1.5f;
    private static final int CAMERA_PINCH_STEPS = 10;
    private static final float CAMERA_PINCH_RADIAL_STEP_CSS = 2.0f;
    private static final int MAX_LOCAL_SUBPATH_VERTICES = 16;
    private static final double AIM_OFFSET_CSS = 44.0;
    private static final double ROAD_RELEASE_CSS = 22.0;
    private static final double TARGET_PATH_TOLERANCE_CSS = 3.0;
    private static final double TARGET_ENDPOINT_TOLERANCE_CSS = 3.0;
    private static final double MAX_TARGET_PATH_LENGTH_RATIO = 1.25;
    private static final double MAX_SOURCE_PROGRESS_BACKTRACK_METERS = 1.0;
    private static final double MAX_NODE_GAP_METERS = 2.0;
    private static final double COLOCATED_SOURCE_NODE_TOLERANCE_METERS = 0.001;
    private Native163DrawingRegression() { }

    private static final class ScreenPoint {
        final double x, y;
        ScreenPoint(double x, double y) { this.x = x; this.y = y; }
    }

    private static final class ProjectedVertex {
        final int sourceIndex;
        final double longitude, latitude;
        final ScreenPoint screen;
        ProjectedVertex(int index, double lon, double lat, ScreenPoint screen) {
            sourceIndex = index; longitude = lon; latitude = lat; this.screen = screen;
        }
    }

    private static final class SourceProgress {
        final double distanceMeters;
        final double offsetMeters;
        SourceProgress(double distanceMeters, double offsetMeters) {
            this.distanceMeters = distanceMeters;
            this.offsetMeters = offsetMeters;
        }
    }

    private static final class RoadTarget {
        String lineHash;
        String secondLineHash;
        int lineIndex, secondLineIndex, startIndex, endIndex, nodeIndex;
        int featurePairSharedNodeCount;
        int groundMeshSamples, groundFallbackSamples;
        boolean connectedLines;
        boolean sameRoadName, roadNamePresent, differentRoadNamesAtConnection;
        int roadLevel;
        double chordPx, bendPx, score;
        double nodeGapMeters, nodeGapCssPx, nodeTurnDegrees;
        List<ProjectedVertex> firstLineCoordinates, secondLineCoordinates;
        List<ProjectedVertex> vertices;
    }

    private static final class ReadyRoadSnapshot {
        final JSONObject payload;
        final String keyFingerprint;
        final String payloadFingerprint;
        ReadyRoadSnapshot(JSONObject payload, String keyFingerprint) {
            this.payload = payload;
            this.keyFingerprint = keyFingerprint;
            this.payloadFingerprint = sha256(payload.toString());
        }
    }

    private static final class InputTrace {
        final JSONArray events = new JSONArray();
        long startTime = Long.MIN_VALUE;

        void record(MotionEvent event, int[] mapOrigin, double scale) throws Exception {
            if (startTime == Long.MIN_VALUE) startTime = event.getDownTime();
            String action = actionName(event.getActionMasked());
            events.put(new JSONObject().put("action", action)
                .put("eventTimeMs", Math.max(0L, event.getEventTime() - startTime))
                .put("downTimeMs", Math.max(0L, event.getDownTime() - startTime))
                .put("xCss", (event.getX() - mapOrigin[0]) / scale)
                .put("yCss", (event.getY() - mapOrigin[1]) / scale)
                .put("pointerCount", event.getPointerCount()));
        }

        JSONObject toJson(String gesture) throws Exception {
            return new JSONObject().put("gesture", gesture).put("coordinateSpace", "map-local-css")
                .put("timeBase", "gesture-down-time-ms").put("events", new JSONArray(events.toString()));
        }
    }

    private static final class GroundProjectionCounts {
        int attempted, meshAnchors, fallbackAnchors, screenPoints;
        boolean geoidOffsetMethodAvailable;
        int sharedNodePairsWithin2m, exactColocatedPairs, rejectedNonColocatedPairs,
            rejectedUnsafeNodePairs, turnChecks, acceptedTurns, rejectedTurns,
            sufficientPathPairs, rejectedShortPaths, uniqueEdgePairs, rejectedDuplicateEdges,
            safeJoinedPaths, rejectedUnsafePaths, chordPasses, rejectedShortChords,
            curvePasses, rejectedFlatPaths, connectedTargets, singleCurveTargets;
        String failureStage = "none", failureType = "none";
        boolean matrixUnchanged, viewportUnchanged, cameraUnchanged;
        double minX = Double.POSITIVE_INFINITY, minY = Double.POSITIVE_INFINITY;
        double maxX = Double.NEGATIVE_INFINITY, maxY = Double.NEGATIVE_INFINITY;
        double safeMinLon = Double.POSITIVE_INFINITY, safeMinLat = Double.POSITIVE_INFINITY;
        double safeMaxLon = Double.NEGATIVE_INFINITY, safeMaxLat = Double.NEGATIVE_INFINITY;
        int terrainMapCandidates;
        boolean terrainMapUnique;
        void record(double x, double y) {
            screenPoints++; minX = Math.min(minX, x); minY = Math.min(minY, y);
            maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        }
        void recordSafePath(List<ProjectedVertex> path) {
            for (ProjectedVertex vertex : path) {
                safeMinLon = Math.min(safeMinLon, vertex.longitude); safeMinLat = Math.min(safeMinLat, vertex.latitude);
                safeMaxLon = Math.max(safeMaxLon, vertex.longitude); safeMaxLat = Math.max(safeMaxLat, vertex.latitude);
            }
        }
        JSONObject toJson() throws Exception {
            return new JSONObject().put("attempted", attempted).put("meshAnchors", meshAnchors)
                .put("clampToGroundElevationFallbackAnchors", fallbackAnchors).put("screenPoints", screenPoints)
                .put("terrainMapCandidates", terrainMapCandidates).put("terrainMapUnique", terrainMapUnique)
                .put("matrixUnchanged", matrixUnchanged).put("viewportUnchanged", viewportUnchanged)
                .put("cameraUnchanged", cameraUnchanged)
                .put("candidateRejections", new JSONObject()
                    .put("sharedNodePairsWithin2m", sharedNodePairsWithin2m)
                    .put("exactColocatedPairsUnder1mm", exactColocatedPairs)
                    .put("rejectedNonColocatedPairs", rejectedNonColocatedPairs)
                    .put("rejectedUnsafeNodePairs", rejectedUnsafeNodePairs)
                    .put("turnChecks", turnChecks).put("acceptedTurns30to150", acceptedTurns)
                    .put("rejectedTurns", rejectedTurns)
                    .put("sufficientPathPairs", sufficientPathPairs).put("rejectedShortPaths", rejectedShortPaths)
                    .put("uniqueEdgePairs", uniqueEdgePairs).put("rejectedDuplicateEdges", rejectedDuplicateEdges)
                    .put("safeJoinedPaths", safeJoinedPaths).put("rejectedUnsafePaths", rejectedUnsafePaths)
                    .put("chordPasses24CssPx", chordPasses).put("rejectedShortChords", rejectedShortChords)
                    .put("curvePasses5CssPx", curvePasses).put("rejectedFlatPaths", rejectedFlatPaths)
                    .put("connectedTargets", connectedTargets).put("singleCurveTargets", singleCurveTargets))
                .put("failureStage", failureStage).put("failureType", failureType)
                .put("clippedOrUnavailable", Math.max(0, attempted - screenPoints))
                .put("screenBoundsCss", screenPoints == 0 ? JSONObject.NULL :
                    new JSONArray().put(minX).put(minY).put(maxX).put(maxY))
                .put("safeCandidateGeographicBounds", safeMinLon == Double.POSITIVE_INFINITY ? JSONObject.NULL :
                    new JSONArray().put(safeMinLon).put(safeMinLat).put(safeMaxLon).put(safeMaxLat));
        }
    }

    private static final class GroundProjectionContext {
        final Object engine, globe, terrainMap;
        final Class<?> vec3Class;
        final double[] mvp;
        final int[] viewport;
        GroundProjectionContext(Object engine, Object globe, Object terrainMap, Class<?> vec3Class, double[] mvp, int[] viewport) {
            this.engine = engine; this.globe = globe; this.terrainMap = terrainMap;
            this.vec3Class = vec3Class; this.mvp = mvp; this.viewport = viewport;
        }
    }

    private static final class ProjectionFrameSnapshot {
        final GroundProjectionContext projection;
        final long publishedSequence, sequenceCounter;
        final double verticalExaggeration, cssScale;
        final boolean verticalExaggerationKnown, cssScaleKnown;
        ProjectionFrameSnapshot(GroundProjectionContext projection, long publishedSequence,
            long sequenceCounter, double verticalExaggeration, boolean verticalExaggerationKnown,
            double cssScale, boolean cssScaleKnown) {
            this.projection = projection; this.publishedSequence = publishedSequence;
            this.sequenceCounter = sequenceCounter; this.verticalExaggeration = verticalExaggeration;
            this.verticalExaggerationKnown = verticalExaggerationKnown; this.cssScale = cssScale;
            this.cssScaleKnown = cssScaleKnown;
        }
    }

    private static final class ProjectedRoadLine {
        final int lineIndex, level;
        final String id, name;
        final List<ProjectedVertex> vertices;
        ProjectedRoadLine(int lineIndex, String id, String name, int level, List<ProjectedVertex> vertices) {
            this.lineIndex = lineIndex; this.id = id; this.name = name; this.level = level; this.vertices = vertices;
        }
    }

    private static final class VertexRef {
        final ProjectedRoadLine line;
        final int index;
        final ProjectedVertex vertex;
        VertexRef(ProjectedRoadLine line, int index, ProjectedVertex vertex) {
            this.line = line; this.index = index; this.vertex = vertex;
        }
    }

    /** Root wires this as instrumentation mode "native163-drawing-regression". */
    public static JSONObject run(Native149Instrumentation parent) throws Exception {
        JSONObject report = new JSONObject().put("mode", "native163-drawing-regression")
            .put("testState", "RUNNING").put("deviceInput", "MotionEvent via Instrumentation.sendPointerSync")
            .put("productDrawingMode", "points")
            .put("savedRouteWrites", false).put("userDraftOverwrite", false).put("onlyQaDraftUsed", true);
        if (parent == null) return report.put("testState", "PRECONDITION_BLOCKED").put("reason", "instrumentation-unavailable");
        boolean existingTargetReused = targetAlreadyAttached(parent);
        if (!existingTargetReused) call(parent, "attachTarget");
        report.put("existingInteractiveTargetReused", existingTargetReused);
        Object entry = field(parent, "entry");
        JSONObject initialState = (JSONObject)call(parent, "readState");
        JSONObject initialProbe = (JSONObject)call(parent, "inspectDrawingMagnifier");
        JSONObject interaction = initialState.optJSONObject("interaction");
        JSONObject trackOverlay = initialState.optJSONObject("trackOverlay");
        int initialDraftPoints = initialProbe.optInt("draftPoints", -1);
        int initialSavedTracks = initialProbe.optInt("savedTrackCount", -1);
        boolean drawingActive = initialProbe.optBoolean("native_drawingActive",
            interaction != null && interaction.optBoolean("drawingActive"));
        boolean roadSnapping = initialProbe.optBoolean("native_roadSnapping",
            interaction != null && interaction.optBoolean("roadSnapping"));
        // composeTrackOverlay.editing is also true for ordinary fresh drawing.
        // Existing edit sessions instead publish a movable track or a connecting branch.
        Object movableTrack = trackOverlay == null ? null : trackOverlay.opt("movableTrackId");
        Object selectedTrack = trackOverlay == null ? null : trackOverlay.opt("selectedId");
        boolean editing = trackOverlay == null || trackOverlay.optBoolean("connecting") ||
            (movableTrack != null && movableTrack != JSONObject.NULL && !String.valueOf(movableTrack).isEmpty() && !"draft".equals(String.valueOf(movableTrack))) ||
            (selectedTrack != null && selectedTrack != JSONObject.NULL && !String.valueOf(selectedTrack).isEmpty() && !"draft".equals(String.valueOf(selectedTrack)));
        Object selectedValue = initialState.opt("annotationSelected");
        String selected = selectedValue == null || selectedValue == JSONObject.NULL ? "" : String.valueOf(selectedValue);
        if ("null".equals(selected)) selected = "";
        report.put("precondition", new JSONObject().put("drawingActive", drawingActive)
            .put("roadSnapping", roadSnapping).put("draftPoints", initialDraftPoints)
            .put("editing", editing).put("selectedAnnotation", selected.isEmpty() ? JSONObject.NULL : "present")
            .put("trackOverlayAvailable", trackOverlay != null));
        report.put("sourceIdentityCheck", sourceIdentitySummary(parent, entry, initialState));
        if (!drawingActive || !roadSnapping || initialDraftPoints != 0 || (editing && initialSavedTracks != 0) || initialSavedTracks < 0 ||
            !selected.isEmpty() || trackOverlay == null) {
            return report.put("testState", "PRECONDITION_BLOCKED")
                .put("reason", "requires-empty-qa-draft-active-drawing-road-snap-no-edit-or-selection")
                .put("userDataTouched", false);
        }

        JSONObject originalCamera = (JSONObject)call(parent, "invokeCameraJson");
        Object geometryOwner = field(entry, "snapGeometry");
        View mapView = (View)call(parent, "worldWindowView");
        double cssScale = rendererCssScale(parent);
        int[] mapOrigin = new int[2];
        parent.runOnMainSync(() -> mapView.getLocationOnScreen(mapOrigin));
        JSONObject cssViewportFixture = captureCssViewport(parent, mapView, cssScale);
        String runId = UUID.randomUUID().toString().replace("-", "");
        File evidence = new File(parent.getTargetContext().getExternalFilesDir(Environment.DIRECTORY_PICTURES), "native163-drawing-" + runId);
        if (!evidence.mkdirs() && !evidence.isDirectory()) throw new IllegalStateException("evidence-directory-unavailable");
        set(parent, "runId", runId); set(parent, "evidenceDir", evidence);
        report.put("evidenceDirectory", evidence.getAbsolutePath()).put("initialCamera", originalCamera)
            .put("mapViewPx", new JSONArray().put(mapView.getWidth()).put(mapView.getHeight()))
            .put("cssScale", cssScale).put("initialSavedTracks", initialSavedTracks);

        boolean qaDraftCreated = false;
        boolean cameraRestoreOk = false;
        String cleanup = "NOT_NEEDED";
        JSONArray snapStages = new JSONArray();
        InputTrace anchorTrace = new InputTrace(), continuationTrace = new InputTrace();
        try {
            report.put("roadSnapshotFreshnessBeforeWait", summarizeRoadSnapshotFreshness(roadSnapshotFreshness(parent, geometryOwner, entry)));
            ReadyRoadSnapshot snapshot = awaitReadyRoadSnapshot(parent, geometryOwner, entry, 12_000L);
            JSONObject probeTargets = Native160DrawingProbe.targets(parent);
            report.put("initialRoadSnapshotStatus", roadStatus(snapshot.payload)).put("legacyAlt0TargetProbeDiagnosticOnly", probeTargets);
            snapStages.put(snapStage("before-drawing", initialProbe, "not-applicable"));

            JSONObject multitouch = runMultitouch(parent, mapView, mapOrigin, cssScale);
            report.put("multitouch", multitouch);
            if (draftPointCount((JSONObject)call(parent, "readState")) != 0)
                throw new IllegalStateException("multitouch-created-draft-data");

            call(parent, "applyCamera", originalCamera);
            call(parent, "awaitFrames", 2, 10_000L);
            report.put("roadSnapshotFreshnessAfterCameraRestore", summarizeRoadSnapshotFreshness(roadSnapshotFreshness(parent, geometryOwner, entry)));
            snapshot = awaitReadyRoadSnapshot(parent, geometryOwner, entry, 18_000L);
            report.put("decodedSourceZoomHistogram", decodedSourceZoomHistogram(geometryOwner));
            try {
                writeReadyRoadSnapshotGeoJson(evidence, snapshot.payload);
                report.put("readyRoadSnapshotArtifact", "ready-road-snapshot.geojson");
            } catch (Throwable snapshotWriteError) {
                report.put("readyRoadSnapshotArtifact", "WRITE_FAILED:" + snapshotWriteError.getClass().getSimpleName());
            }
            GroundProjectionCounts targetProjectionCounts = null;
            RoadTarget target = null;
            JSONObject targetFreshness = null;
            int targetSnapshotAttempts = 0;
            boolean targetSnapshotStable = false;
            for (int attempt = 0; attempt < 3; attempt++) {
                targetSnapshotAttempts = attempt + 1;
                targetProjectionCounts = new GroundProjectionCounts();
                JSONObject targetCameraBefore = (JSONObject)call(parent, "invokeCameraJson");
                target = chooseConnectedCurvedRoadTarget(parent, mapView, snapshot.payload, cssScale, targetProjectionCounts);
                JSONObject targetCameraAfter = (JSONObject)call(parent, "invokeCameraJson");
                targetProjectionCounts.cameraUnchanged = targetCameraBefore.toString().equals(targetCameraAfter.toString());
                targetFreshness = roadSnapshotFreshness(parent, geometryOwner, entry);
                targetSnapshotStable = readySnapshotStillCurrent(snapshot, targetFreshness);
                if (targetSnapshotStable) break;
                if (attempt == 2) break;
                snapshot = awaitReadyRoadSnapshot(parent, geometryOwner, entry, 8_000L);
                try { writeReadyRoadSnapshotGeoJson(evidence, snapshot.payload); }
                catch (Throwable snapshotWriteError) { report.put("readyRoadSnapshotArtifactRefresh", "WRITE_FAILED:" + snapshotWriteError.getClass().getSimpleName()); }
            }
            report.put("roadSnapshotFreshnessForTarget", summarizeRoadSnapshotFreshness(targetFreshness))
                .put("targetSnapshotAttempts", targetSnapshotAttempts)
                .put("targetSnapshotMatchedAtProjection", targetSnapshotStable);
            report.put("roadTargetGroundProjection", targetProjectionCounts.toJson());
            if (!targetSnapshotStable) {
                report.put("complexRoadTarget", new JSONObject().put("status", "INCONCLUSIVE_SNAPSHOT_CHANGED_DURING_TARGET_SELECTION")
                    .put("requiredForPass", true));
                throw new IllegalStateException("native-road-snapshot-changed-during-target-selection");
            }
            if (!targetProjectionCounts.matrixUnchanged || !targetProjectionCounts.viewportUnchanged || !targetProjectionCounts.cameraUnchanged) {
                report.put("complexRoadTarget", new JSONObject().put("status", "INCONCLUSIVE_PROJECTION_FRAME_CHANGED")
                    .put("requiredForPass", true));
                throw new IllegalStateException("road-target-projection-frame-changed");
            }
            if (target == null) {
                report.put("complexRoadTarget", new JSONObject().put("status", "NO_CONNECTED_CURVED_CHAIN")
                    .put("requiredForPass", true));
                throw new IllegalStateException("no-connected-curved-road-chain-inside-safe-viewport");
            }
            if (target.connectedLines) {
                report.put("complexRoadTarget", new JSONObject().put("status", "ready")
                    .put("sourceLineCount", 2).put("firstLineHash", target.lineHash)
                    .put("secondLineHash", target.secondLineHash).put("firstLineIndex", target.lineIndex)
                    .put("secondLineIndex", target.secondLineIndex).put("nodeVertexIndex", target.nodeIndex)
                    .put("featurePairSharedNodeCount", target.featurePairSharedNodeCount)
                    .put("firstSubpathSourceStart", target.startIndex).put("firstSubpathSourceEnd", target.firstLineCoordinates.get(target.firstLineCoordinates.size() - 1).sourceIndex)
                    .put("secondSubpathSourceStart", target.secondLineCoordinates.get(0).sourceIndex).put("secondSubpathSourceEnd", target.endIndex)
                    .put("sameRoadName", target.sameRoadName).put("roadNamePresent", target.roadNamePresent)
                    .put("differentRoadNamesAtConnection", target.differentRoadNamesAtConnection)
                    .put("matchingRoadLevel", target.roadLevel).put("endpointGapMeters", target.nodeGapMeters)
                    .put("nodeTurnDegrees", target.nodeTurnDegrees).put("endpointGapCssPx", target.nodeGapCssPx)
                    .put("renderedTerrainMeshProjectionSamples", target.groundMeshSamples)
                    .put("clampToGroundElevationFallbackSamples", target.groundFallbackSamples));
            } else {
                report.put("complexRoadTarget", new JSONObject().put("status", "NO_CONNECTED_CURVED_CHAIN")
                    .put("requiredForPass", true).put("singleRoadCurveFallback", true));
                report.put("singleRoadCurveTarget", new JSONObject().put("status", "ready")
                    .put("sourceLineCount", 1).put("lineHash", target.lineHash).put("lineIndex", target.lineIndex)
                    .put("sourceVertexStart", target.startIndex).put("sourceVertexEnd", target.endIndex)
                    .put("sourceVertexCount", target.vertices.size()).put("roadLevel", target.roadLevel)
                    .put("chordCssPx", target.chordPx).put("maxSourceCurveDeviationCssPx", target.bendPx)
                    .put("renderedTerrainMeshProjectionSamples", target.groundMeshSamples)
                    .put("clampToGroundElevationFallbackSamples", target.groundFallbackSamples));
            }
            JSONObject targetJson = new JSONObject().put("lineIdSha256", target.lineHash)
                .put("sourceLineIndex", target.lineIndex).put("sourceStartVertex", target.startIndex)
                .put("sourceEndVertex", target.endIndex).put("sourceVertexCount", target.vertices.size())
                .put("chordCssPx", target.chordPx).put("maxSourceCurveDeviationCssPx", target.bendPx)
                .put("connectedLines", target.connectedLines).put("realNativeGroundProjection", true)
                .put("roadSnapshotStatus", roadStatus(snapshot.payload));
            if (target.connectedLines) targetJson.put("connectedLineIdSha256", target.secondLineHash)
                .put("connectedLineIndex", target.secondLineIndex).put("nodeVertexIndex", target.nodeIndex)
                .put("featurePairSharedNodeCount", target.featurePairSharedNodeCount)
                .put("firstSubpathSourceStart", target.startIndex).put("firstSubpathSourceEnd", target.firstLineCoordinates.get(target.firstLineCoordinates.size() - 1).sourceIndex)
                .put("secondSubpathSourceStart", target.secondLineCoordinates.get(0).sourceIndex).put("secondSubpathSourceEnd", target.endIndex)
                .put("endpointGapMeters", target.nodeGapMeters).put("matchingRoadLevel", target.roadLevel)
                .put("nodeTurnDegrees", target.nodeTurnDegrees).put("sameRoadName", target.sameRoadName)
                .put("roadNamePresent", target.roadNamePresent).put("differentRoadNamesAtConnection", target.differentRoadNamesAtConnection);
            else targetJson.put("singleLine", true).put("roadLevel", target.roadLevel);
            report.put("roadTarget", targetJson);

            List<ScreenPoint> aimPath = new ArrayList<>();
            if (target.connectedLines) {
                List<ScreenPoint> firstLineWaypoints = evenlySample(
                    screens(target.vertices.subList(0, target.nodeIndex + 1)), MAX_GESTURE_WAYPOINTS / 2);
                List<ScreenPoint> secondLineWaypoints = evenlySample(
                    screens(target.vertices.subList(target.nodeIndex, target.vertices.size())), MAX_GESTURE_WAYPOINTS / 2);
                aimPath.addAll(firstLineWaypoints);
                for (int i = 1; i < secondLineWaypoints.size(); i++) aimPath.add(secondLineWaypoints.get(i));
            } else aimPath.addAll(evenlySample(screens(target.vertices), MAX_GESTURE_WAYPOINTS));
            if (aimPath.size() > MAX_GESTURE_WAYPOINTS) aimPath = evenlySample(aimPath, MAX_GESTURE_WAYPOINTS);
            report.put("gestureWaypointCount", aimPath.size()).put("nodeIncludedInGesture", true);
            JSONObject groundProjection = verifyBridgeGroundProjection(parent, mapView, cssScale, aimPath);
            report.put("groundProjection", groundProjection);
            boolean groundProjectionWithinTolerance = groundProjection.optBoolean("allFinite") &&
                groundProjection.optDouble("maxRoundTripCssPx", Double.POSITIVE_INFINITY) <= 3.0;
            report.put("groundProjectionWithinTolerance", groundProjectionWithinTolerance)
                .put("groundProjectionUsedAsHardPrecondition", false);
            if (!groundProjection.optBoolean("allFinite"))
                throw new IllegalStateException("native-ground-projection-did-not-round-trip");

            JSONObject beforeTouchFreshness = roadSnapshotFreshness(parent, geometryOwner, entry);
            boolean snapshotStillFreshBeforeTouch = readySnapshotStillCurrent(snapshot, beforeTouchFreshness);
            report.put("roadSnapshotFreshnessBeforeTouch", summarizeRoadSnapshotFreshness(beforeTouchFreshness))
                .put("targetSnapshotMatchedBeforeTouch", snapshotStillFreshBeforeTouch);
            if (!snapshotStillFreshBeforeTouch)
                throw new IllegalStateException("native-road-snapshot-changed-before-touch");

            qaDraftCreated = true;
            JSONObject anchorSnapEvidence = injectPointTap(parent, mapOrigin, cssScale, aimPath.get(0), anchorTrace);
            int afterStartPoints = awaitDraftPoints(parent, 1, 6_000L);
            if (afterStartPoints < 1) throw new IllegalStateException("QA-road-anchor-not-created");
            snapStages.put(snapStage("after-anchor-tap", (JSONObject)call(parent, "inspectDrawingMagnifier"), anchorSnapEvidence));
            List<ScreenPoint> continuation = aimPath.subList(1, aimPath.size());
            if (continuation.isEmpty()) throw new IllegalStateException("road-target-has-no-continuation");
            // Product drawing is points mode: each real vertex is a fresh tap.
            // Do not model this workflow as a freehand drag.
            for (int i = 0; i < continuation.size(); i++) {
                JSONObject snapEvidence = injectPointTap(parent, mapOrigin, cssScale, continuation.get(i), continuationTrace);
                snapStages.put(snapStage("continuation-point-" + (i + 1),
                    (JSONObject)call(parent, "inspectDrawingMagnifier"), snapEvidence));
            }
            JSONObject afterRoad = awaitDrawingProbe(parent, 2, 8_000L);
            JSONObject stateAfterRoad = (JSONObject)call(parent, "readState");
            JSONObject geometryResult = analyzeDraftAgainstTarget(parent, stateAfterRoad, target, cssScale);
            geometryResult.put("freshDownAfterMultitouch", afterStartPoints >= 1)
                .put("freshDownCreatedQaAnchor", afterStartPoints >= 1)
                .put("groundProjectionWithinTolerance", groundProjectionWithinTolerance);
            JSONObject continuationStatusAudit = summarizeContinuationSnapStages(snapStages);
            report.put("continuationSnapStatusAudit", continuationStatusAudit);
            boolean roadPass = geometryResult.optBoolean("sameRoadWithinReleaseRadius") &&
                geometryResult.optBoolean("exactTargetPathWithinTolerance") &&
                geometryResult.optBoolean("retainsCurve") && geometryResult.optInt("draftPointCount") >= 3 &&
                geometryResult.optBoolean("draftStartCommittedAtTarget") && geometryResult.optBoolean("draftEndCommittedAtTarget") &&
                geometryResult.optBoolean("sourceProgressMonotonic") && geometryResult.optBoolean("routeLengthWithinBudget") &&
                geometryResult.optBoolean("connectedNodeWithinReleaseRadius") &&
                geometryResult.optInt("firstLineDraftPoints") >= 2 && geometryResult.optInt("secondLineDraftPoints") >= 2 &&
                geometryResult.optBoolean("sameNativeRoadSnapshotChain") &&
                geometryResult.optBoolean("freshDownAfterMultitouch") && groundProjectionWithinTolerance &&
                continuationStatusAudit.optBoolean("allContinuationStagesAccepted");
            boolean singleRoadCurvePass = !target.connectedLines &&
                geometryResult.optBoolean("sameRoadWithinReleaseRadius") && geometryResult.optBoolean("retainsCurve") &&
                geometryResult.optBoolean("exactTargetPathWithinTolerance") &&
                geometryResult.optInt("draftPointCount") >= 3 && geometryResult.optInt("firstLineDraftPoints") >= 2 &&
                geometryResult.optBoolean("draftStartCommittedAtTarget") && geometryResult.optBoolean("draftEndCommittedAtTarget") &&
                geometryResult.optBoolean("sourceProgressMonotonic") && geometryResult.optBoolean("routeLengthWithinBudget") &&
                geometryResult.optBoolean("freshDownAfterMultitouch") && groundProjectionWithinTolerance &&
                continuationStatusAudit.optBoolean("allContinuationStagesAccepted");
            report.put("roadContinuation", new JSONObject().put("draftProbe", afterRoad)
                .put("geometry", geometryResult).put("pass", roadPass)
                .put("singleRoadCurvePass", singleRoadCurvePass));
            report.put("complexRoadNodeContinuation", new JSONObject()
                .put("twoConnectedNativeSnapshotLines", target.connectedLines)
                .put("nodeIncludedInGesture", true)
                .put("firstLineDraftPoints", geometryResult.optInt("firstLineDraftPoints"))
                .put("secondLineDraftPoints", geometryResult.optInt("secondLineDraftPoints"))
                .put("nodeWithinReleaseRadius", geometryResult.optBoolean("connectedNodeWithinReleaseRadius"))
                .put("pass", roadPass));
            report.put("singleRoadCurve", new JSONObject().put("targetSourceVertexCount", target.connectedLines ? 0 : target.vertices.size())
                .put("sameRoadWithinReleaseRadius", geometryResult.optBoolean("sameRoadWithinReleaseRadius"))
                .put("retainsCurve", geometryResult.optBoolean("retainsCurve"))
                .put("draftPointCount", geometryResult.optInt("draftPointCount"))
                .put("freshDownAfterMultitouch", geometryResult.optBoolean("freshDownAfterMultitouch"))
                .put("pass", singleRoadCurvePass).put("assessment", target.connectedLines ? "not-used-connected-target" : "QA-limited-single-feature"));

            JSONObject referenceFixture = buildReferenceFixture(runId, originalCamera, cssViewportFixture, initialProbe,
                roadSnapping, aimPath, target, anchorTrace, continuationTrace, snapStages, stateAfterRoad, geometryResult);
            writeReferenceFixture(evidence, referenceFixture);
            report.put("referenceFixtureWritten", true).put("referenceFixtureFile", "reference-fixture.json");
            report.put("draftScreenshotFile", call(parent, "capture", "native163-draft-before-cleanup"));

            JSONObject draftCleanup = clearQaDraft(parent, cssScale, initialSavedTracks);
            cleanup = draftCleanup.optString("status", "QA_DRAFT_CLEANUP_UNKNOWN");
            report.put("qaDraftCleanup", draftCleanup);
            qaDraftCreated = false;
            JSONObject finalProbe = (JSONObject)call(parent, "inspectDrawingMagnifier");
            report.put("postCleanupDraftPoints", finalProbe.optInt("draftPoints", -1))
                .put("postCleanupSavedTracks", finalProbe.optInt("savedTrackCount", -1));
            if (finalProbe.optInt("draftPoints", -1) != 0 || finalProbe.optInt("savedTrackCount", -1) != initialSavedTracks)
                throw new IllegalStateException("qa-draft-cleanup-or-saved-track-invariant-failed");

            report.put("testState", multitouch.optBoolean("pass") && roadPass ? "PASS"
                    : multitouch.optBoolean("pass") && singleRoadCurvePass ? "LIMITED" : "FAIL")
                .put("cleanup", cleanup).put("userDraftOverwrite", false);
        } catch (Throwable error) {
            report.put("testState", "ERROR").put("errorType", error.getClass().getSimpleName())
                .put("error", safeError(error.getMessage())).put("cleanup", cleanup);
        } finally {
            if (qaDraftCreated) {
                try {
                    JSONObject draftCleanup = clearQaDraft(parent, cssScale, initialSavedTracks);
                    cleanup = draftCleanup.optString("status", "QA_DRAFT_CLEANUP_UNKNOWN");
                    report.put("qaDraftCleanup", draftCleanup);
                }
                catch (Throwable cleanupError) { cleanup = "QA_DRAFT_CLEAR_FAILED:" + cleanupError.getClass().getSimpleName(); }
                report.put("cleanup", cleanup);
            }
            try {
                call(parent, "applyCamera", originalCamera);
                call(parent, "awaitFrames", 2, 10_000L);
                cameraRestoreOk = true;
            } catch (Throwable restoreError) { report.put("cameraRestoreErrorType", restoreError.getClass().getSimpleName()); }
            report.put("cameraRestored", cameraRestoreOk);
            if (("PASS".equals(report.optString("testState")) || "LIMITED".equals(report.optString("testState"))) &&
                (!cameraRestoreOk || cleanup.startsWith("QA_DRAFT_CLEAR_FAILED")))
                report.put("testState", "FAIL");
            try (FileOutputStream output = new FileOutputStream(new File(evidence, "native163-drawing-regression.json"))) {
                output.write(report.toString(2).getBytes("UTF-8"));
            } catch (Throwable writeError) { report.put("reportWriteErrorType", writeError.getClass().getSimpleName()); }
        }
        return report;
    }

    /** Reports actual camera response to small real inputs; deliberately has no new-version speed assertion. */
    public static JSONObject runPanResponse(Native149Instrumentation parent) throws Exception {
        try { return runPanResponseChecked(parent); }
        catch (Throwable error) {
            JSONObject report = new JSONObject().put("schemaVersion", 2).put("test", "editor-two-finger-pan-response")
                .put("testState", "ERROR").put("gpsWritten", false).put("savedRouteWrites", false);
            putPanProbeFailure(report, "failure", error, "precondition", "runPanResponseChecked");
            return report;
        }
    }

    private static JSONObject runPanResponseChecked(Native149Instrumentation parent) throws Exception {
        JSONObject report = new JSONObject().put("schemaVersion", 2).put("test", "editor-two-finger-pan-response")
            .put("gpsWritten", false).put("savedRouteWrites", false).put("userDraftOverwrite", false)
            .put("measurement", "native-main-thread-camera-after-real-MotionEvent; not display latency or phone acceptance");
        if (parent == null) return report.put("testState", "PRECONDITION_BLOCKED").put("reason", "instrumentation-unavailable");
        if (!targetAlreadyAttached(parent)) panProbeCall(parent, "attach", "attachTarget");
        JSONObject state = (JSONObject)panProbeCall(parent, "precondition-state", "readState");
        JSONObject probe = (JSONObject)panProbeCall(parent, "precondition-draft", "inspectDrawingMagnifier");
        JSONObject interaction = state.optJSONObject("interaction"), overlay = state.optJSONObject("trackOverlay");
        int savedTracks = probe.optInt("savedTrackCount", -1);
        String movable = overlay == null ? "unknown" : overlay.optString("movableTrackId", "");
        String selected = overlay == null ? "unknown" : overlay.optString("selectedId", "");
        String annotation = state.optString("annotationSelected", "");
        boolean drawing = probe.optBoolean("native_drawingActive", interaction != null && interaction.optBoolean("drawingActive"));
        boolean emptySelection = selected.isEmpty() || "null".equals(selected) || "draft".equals(selected);
        boolean freshDraft = movable.isEmpty() || "null".equals(movable) || "draft".equals(movable);
        boolean noAnnotation = annotation.isEmpty() || "null".equals(annotation);
        if (!drawing || probe.optInt("draftPoints", -1) != 0 || draftPointCount(state) != 0 || savedTracks < 0 ||
            overlay == null || overlay.optJSONArray("draft") == null || overlay.optJSONArray("saved") == null ||
            overlay.optBoolean("connecting") || !freshDraft || !emptySelection || !noAnnotation) {
            return report.put("testState", "PRECONDITION_BLOCKED")
                .put("reason", "requires-active-empty-drawing-draft-no-route-edit-or-selected-feature");
        }
        JSONObject originalCamera = (JSONObject)panProbeCall(parent, "initial-camera", "invokeCameraJson");
        View view = (View)panProbeCall(parent, "map-view", "worldWindowView");
        double scale = rendererCssScale(parent);
        int[] origin = new int[2]; parent.runOnMainSync(() -> view.getLocationOnScreen(origin));
        if (!Double.isFinite(scale) || scale <= 0 || view.getWidth() / scale < 240 || view.getHeight() / scale < 320)
            return report.put("testState", "PRECONDITION_BLOCKED").put("reason", "map-viewport-too-small-or-unknown");
        JSONObject pose = new JSONObject().put("center", new JSONArray().put(104.0668).put(30.5728))
            .put("zoom", 16.0).put("pitch", 0.0).put("bearing", 0.0);
        report.put("requestedResearchCamera", pose).put("viewport", captureCssViewport(parent, view, scale))
            .put("density", view.getResources().getDisplayMetrics().density)
            .put("touchSlopPx", android.view.ViewConfiguration.get(view.getContext()).getScaledTouchSlop())
            .put("initialSavedTracks", savedTracks).put("roadSnapping", interaction != null && interaction.optBoolean("roadSnapping"))
            .put("riverSnapping", interaction != null && interaction.optBoolean("riverSnapping"));
        JSONArray cases = new JSONArray(); report.put("cases", cases);
        boolean untouchedDraft = true, cameraRestored = false, cleanupOk = false;
        try {
            report.put("initialCameraStability", awaitPanProbeStable(parent, "initial-camera-stability"));
            for (boolean jitter : new boolean[]{false, true}) {
                String stage = jitter ? "jitter" : "parallel";
                panProbeCall(parent, stage + "/apply-camera", "applyCamera", pose);
                panProbeCall(parent, stage + "/await-frames", "awaitFrames", 2, 10_000L);
                JSONObject stableBefore = awaitPanProbeStable(parent, stage + "/before-input");
                JSONObject result = measurePanResponse(parent, view, origin, scale, jitter).put("cameraStabilityBefore", stableBefore);
                cases.put(result);
                if (result.optInt("draftPointsAfter", -1) != 0) {
                    untouchedDraft = false;
                    throw new IllegalStateException("two-finger-input-created-draft-data");
                }
            }
            report.put("testState", "MEASURED");
        } catch (Throwable error) {
            report.put("testState", "ERROR");
            putPanProbeFailure(report, "failure", error, "measurement", "runPanResponseChecked");
        } finally {
            try {
                JSONObject after = (JSONObject)panProbeCall(parent, "draft-cleanup/check", "inspectDrawingMagnifier");
                if (after.optInt("draftPoints", -1) != 0) untouchedDraft = false;
                JSONObject cleanup = clearQaDraft(parent, scale, savedTracks);
                report.put("qaDraftCleanup", cleanup); cleanupOk = cleanup.optInt("finalDraftPoints", -1) == 0;
            } catch (Throwable error) { putPanProbeFailure(report, "cleanupFailure", error, "draft-cleanup", "clearQaDraft"); }
            try { report.put("beforeRestoreCameraStability", awaitPanProbeStable(parent, "restore/before-apply")); }
            catch (Throwable error) {
                putPanProbeFailure(report, "beforeRestoreStabilityFailure", error, "restore/before-apply", "awaitPanProbeStable");
                report.put("testState", "ERROR");
            }
            try {
                panProbeCall(parent, "restore/apply-camera", "applyCamera", originalCamera);
                panProbeCall(parent, "restore/await-frames", "awaitFrames", 2, 10_000L);
                report.put("restoredCameraStability", awaitPanProbeStable(parent, "restore/after-apply"));
                JSONObject restored = (JSONObject)panProbeCall(parent, "restore/verify-camera", "invokeCameraJson");
                cameraRestored = panCameraDistance(originalCamera, restored) <= 0.1 &&
                    Math.abs(cameraZoom(originalCamera) - cameraZoom(restored)) <= 0.001 &&
                    Math.abs(originalCamera.optDouble("pitch") - restored.optDouble("pitch")) <= 0.001 &&
                    Math.abs(originalCamera.optDouble("bearing") - restored.optDouble("bearing")) <= 0.001;
            } catch (Throwable error) { putPanProbeFailure(report, "cameraRestoreFailure", error, "restore", "runPanResponseChecked"); }
            report.put("cameraRestored", cameraRestored).put("noDraftPointsCreated", untouchedDraft)
                .put("strictCleanupEmptyDraft", cleanupOk);
            if (!cameraRestored || !cleanupOk || !untouchedDraft) report.put("testState", "FAIL");
        }
        return report;
    }

    private static JSONObject measurePanResponse(Native149Instrumentation parent, View view, int[] origin, double scale,
        boolean jitter) throws Exception {
        String scenario = jitter ? "jitter" : "parallel";
        JSONObject before = (JSONObject)panProbeCall(parent, scenario + "/initial-camera", "invokeCameraJson");
        double lat = before.getJSONArray("center").getDouble(1);
        double metersPerCssPixel = 40075016.6856 * Math.cos(Math.toRadians(lat)) / (512.0 * Math.pow(2.0, cameraZoom(before)));
        if (!Double.isFinite(metersPerCssPixel) || metersPerCssPixel <= 0) throw new IllegalStateException("camera-scale-unavailable");
        double cx = view.getWidth() / scale * 0.5, cy = view.getHeight() / scale * 0.5;
        ScreenPoint first = new ScreenPoint(origin[0] + (cx - 24) * scale, origin[1] + cy * scale);
        ScreenPoint second = new ScreenPoint(origin[0] + (cx + 24) * scale, origin[1] + cy * scale);
        long downTime = SystemClock.uptimeMillis(), started = SystemClock.elapsedRealtime();
        int pointers = 0, firstNumerical = -1, firstQuarterPixel = -1;
        JSONArray samples = new JSONArray(); JSONObject previous = before;
        String stage = scenario + "/down", operation = "Instrumentation.sendPointerSync";
        PanProbeFailure inputFailure = null;
        try {
            pointers = 1; injectSingle(parent, MotionEvent.ACTION_DOWN, downTime, first);
            stage = scenario + "/pointer-down";
            pointers = 2; injectMulti(parent, MotionEvent.ACTION_POINTER_DOWN | (1 << MotionEvent.ACTION_POINTER_INDEX_SHIFT), downTime, first, second);
            for (int i = 1; i <= 24; i++) {
                SystemClock.sleep(16L);
                double radial = jitter && i > 4 ? (i % 2 == 0 ? 1.5 : -1.5) : 0.0;
                first = new ScreenPoint(origin[0] + (cx - 24 - radial) * scale, origin[1] + (cy + i) * scale);
                second = new ScreenPoint(origin[0] + (cx + 24 + radial) * scale, origin[1] + (cy + i) * scale);
                long sentAt = SystemClock.elapsedRealtimeNanos();
                stage = scenario + "/step-" + i + "/move";
                operation = "Instrumentation.sendPointerSync";
                injectMulti(parent, MotionEvent.ACTION_MOVE, downTime, first, second);
                long deliveredAt = SystemClock.elapsedRealtimeNanos();
                // invokeCameraJson itself marshals the real controller read to Android's main thread.
                JSONObject camera = (JSONObject)panProbeCall(parent, scenario + "/step-" + i + "/camera", "invokeCameraJson");
                long readAt = SystemClock.elapsedRealtimeNanos();
                stage = scenario + "/step-" + i + "/measure";
                operation = "Native163DrawingRegression.measurePanResponse";
                double totalMeters = panCameraDistance(before, camera), stepMeters = panCameraDistance(previous, camera);
                if (firstNumerical < 0 && totalMeters > 0.001) firstNumerical = i;
                if (firstQuarterPixel < 0 && totalMeters / metersPerCssPixel >= 0.25) firstQuarterPixel = i;
                samples.put(new JSONObject().put("inputCumulativeCssPx", i).put("inputStepCssPx", 1)
                    .put("radialJitterPerFingerCssPx", radial).put("elapsedMs", SystemClock.elapsedRealtime() - started)
                    .put("sendPointerSyncMs", (deliveredAt - sentAt) / 1e6).put("cameraSnapshotMs", (readAt - deliveredAt) / 1e6)
                    .put("centerStepMeters", stepMeters).put("centerTotalMeters", totalMeters)
                    .put("centerStepEquivalentCssPx", stepMeters / metersPerCssPixel)
                    .put("centerTotalEquivalentCssPx", totalMeters / metersPerCssPixel).put("camera", camera));
                previous = camera;
            }
            // End the real input stream with CANCEL. Unlike UP, the SDK's active pan
            // cancellation does not start fling; no reflection into optimized SDK methods.
            stage = scenario + "/cancel";
            operation = "Instrumentation.sendPointerSync";
            injectMulti(parent, MotionEvent.ACTION_CANCEL, downTime, first, second); pointers = 0;
        } catch (Throwable error) {
            inputFailure = error instanceof PanProbeFailure ? (PanProbeFailure)error :
                new PanProbeFailure(stage, operation, "input-failed", error);
            throw inputFailure;
        } finally {
            try {
                if (pointers == 2) injectMulti(parent, MotionEvent.ACTION_CANCEL, downTime, first, second);
                else if (pointers == 1) injectSingle(parent, MotionEvent.ACTION_CANCEL, downTime, first);
            } catch (Throwable error) {
                PanProbeFailure cancellation = new PanProbeFailure(scenario + "/finally-cancel", operation, "cancel-failed", error);
                if (inputFailure != null) inputFailure.addSuppressed(cancellation); else throw cancellation;
            }
        }
        JSONObject stableAfter = awaitPanProbeStable(parent, scenario + "/after-cancel");
        JSONObject afterProbe = (JSONObject)panProbeCall(parent, scenario + "/final-draft", "inspectDrawingMagnifier");
        return new JSONObject().put("name", jitter ? "parallel-with-small-span-jitter" : "parallel-one-css-pixel-steps")
            .put("sampleCount", samples.length()).put("cameraBefore", before).put("metersPerCssPixelAtStart", metersPerCssPixel)
            .put("firstNumericalResponseAtCssPx", firstNumerical < 0 ? JSONObject.NULL : firstNumerical)
            .put("firstQuarterPixelResponseAtCssPx", firstQuarterPixel < 0 ? JSONObject.NULL : firstQuarterPixel)
            .put("responseThresholdEquivalentCssPx", 0.25).put("samples", samples)
            .put("termination", "real-two-pointer-ACTION_CANCEL").put("cameraStabilityAfter", stableAfter)
            .put("draftPointsAfter", afterProbe.optInt("draftPoints", -1));
    }

    private static double panCameraDistance(JSONObject a, JSONObject b) throws Exception {
        JSONArray ac = a.getJSONArray("center"), bc = b.getJSONArray("center");
        return centerDistanceMeters(ac.getDouble(0), ac.getDouble(1), bc.getDouble(0), bc.getDouble(1));
    }

    private static JSONObject awaitPanProbeStable(Native149Instrumentation parent, String stage) throws Exception {
        long started = SystemClock.elapsedRealtime(), deadline = started + 3_000L;
        JSONObject anchor = (JSONObject)panProbeCall(parent, stage + "/camera", "invokeCameraJson");
        int stableIntervals = 0, samples = 1;
        double largestStepMeters = 0.0;
        JSONObject previous = anchor;
        while (SystemClock.elapsedRealtime() < deadline) {
            SystemClock.sleep(80L);
            JSONObject camera = (JSONObject)panProbeCall(parent, stage + "/camera", "invokeCameraJson");
            samples++;
            largestStepMeters = Math.max(largestStepMeters, panCameraDistance(previous, camera));
            boolean stable = panCameraDistance(anchor, camera) <= 0.05 &&
                Math.abs(cameraZoom(anchor) - cameraZoom(camera)) <= 0.0001 &&
                Math.abs(anchor.optDouble("pitch") - camera.optDouble("pitch")) <= 0.001 &&
                Math.abs(anchor.optDouble("bearing") - camera.optDouble("bearing")) <= 0.001;
            if (stable) stableIntervals++; else { stableIntervals = 0; anchor = camera; }
            previous = camera;
            if (stableIntervals >= 3) return new JSONObject().put("stable", true).put("samples", samples)
                .put("windowIntervals", 3).put("minimumIntervalMs", 80).put("centerToleranceMeters", 0.05)
                .put("elapsedMs", SystemClock.elapsedRealtime() - started).put("largestObservedStepMeters", largestStepMeters)
                .put("method", "Native149Instrumentation.invokeCameraJson");
        }
        throw new PanProbeFailure(stage, "Native149Instrumentation.invokeCameraJson", "camera-not-stable-within-3000ms", null);
    }

    private static final class PanProbeFailure extends Exception {
        final String stage, method, reason;
        PanProbeFailure(String stage, String method, String reason, Throwable cause) {
            super(reason, cause); this.stage = stage; this.method = method; this.reason = reason;
        }
    }

    private static Object panProbeCall(Native149Instrumentation parent, String stage, String method, Object... args) throws Exception {
        try { return call(parent, method, args); }
        catch (Throwable error) { throw new PanProbeFailure(stage, "Native149Instrumentation." + method, "operation-failed", error); }
    }

    private static void putPanProbeFailure(JSONObject output, String key, Throwable error, String stage, String method) throws Exception {
        PanProbeFailure known = error instanceof PanProbeFailure ? (PanProbeFailure)error : null;
        JSONArray causes = new JSONArray(), suppressed = new JSONArray();
        for (Throwable cause = error; cause != null && causes.length() < 8; cause = cause.getCause()) causes.put(cause.getClass().getName());
        for (Throwable failure : error.getSuppressed()) {
            JSONObject detail = new JSONObject();
            putPanProbeFailure(detail, "failure", failure, stage + "/cleanup", method);
            suppressed.put(detail.getJSONObject("failure"));
        }
        output.put(key, new JSONObject().put("stage", known == null ? stage : known.stage)
            .put("method", known == null ? method : known.method).put("reasonCode", known == null ? "operation-failed" : known.reason)
            .put("causeClasses", causes).put("suppressed", suppressed));
    }

    /** Read-only same-frame comparison of the live JS MapHandle and rendered native terrain. */
    public static JSONObject compareProjection(Native149Instrumentation parent, JSONArray coordinates) throws Exception {
        JSONObject report = new JSONObject().put("mode", "native163-projection-comparison")
            .put("status", "INCONCLUSIVE").put("coordinatesReturned", false);
        if (parent == null || coordinates == null || coordinates.length() < 1 || coordinates.length() > 8)
            return report.put("failureStage", "input-count");
        JSONArray safeCoordinates = new JSONArray();
        for (int i = 0; i < coordinates.length(); i++) {
            JSONArray coordinate = coordinates.optJSONArray(i);
            if (coordinate == null || coordinate.length() < 2) return report.put("failureStage", "input-coordinate");
            double lon = coordinate.optDouble(0, Double.NaN), lat = coordinate.optDouble(1, Double.NaN);
            if (!Double.isFinite(lon) || !Double.isFinite(lat) || lon < -180.0 || lon > 180.0 || lat < -90.0 || lat > 90.0)
                return report.put("failureStage", "input-range");
            safeCoordinates.put(new JSONArray().put(lon).put(lat));
        }
        try {
            JSONObject cameraBefore = (JSONObject)call(parent, "invokeCameraJson");
            GroundProjectionCounts beforeCounts = new GroundProjectionCounts();
            AtomicHolder<ProjectionFrameSnapshot> beforeHolder = new AtomicHolder<>();
            AtomicHolder<Throwable> beforeFailure = new AtomicHolder<>();
            parent.runOnMainSync(() -> {
                try { beforeHolder.value = captureProjectionFrame(parent, beforeCounts); }
                catch (Throwable failure) { beforeFailure.value = failure; }
            });
            if (beforeFailure.value != null || beforeHolder.value == null || beforeHolder.value.projection == null)
                return report.put("failureStage", beforeCounts.failureStage == null ? "frame-before" : beforeCounts.failureStage)
                    .put("failureType", beforeFailure.value == null ? "unavailable" : beforeFailure.value.getClass().getSimpleName());

            String jsScript = "(()=>{const coords=" + safeCoordinates.toString() + ";"
                + "const el=document.querySelector('[data-native-map-id=\\\"main\\\"]');if(!el)return JSON.stringify({ok:false,reason:'map-element'});"
                + "const fiberKey=Object.keys(el).find(k=>k.startsWith('__reactFiber$'));if(!fiberKey)return JSON.stringify({ok:false,reason:'react-fiber'});"
                + "let handle=null;for(let f=el[fiberKey];f&&!handle;f=f.return){const refs=[f.ref,f.memoizedProps&&f.memoizedProps.ref];"
                + "for(const ref of refs){const candidate=ref&&typeof ref==='object'?ref.current:null;"
                + "if(candidate&&typeof candidate.toScreen==='function'&&typeof candidate.groundElevation==='function'&&typeof candidate.inspect==='function'){handle=candidate;break}}}"
                + "if(!handle)return JSON.stringify({ok:false,reason:'map-handle'});let state;try{state=handle.inspect()}catch(e){return JSON.stringify({ok:false,reason:'handle-inspect'})}"
                + "const samples=coords.map((c,index)=>{let p=null,h=null;try{p=handle.toScreen(c)}catch(e){}try{h=handle.groundElevation(c)}catch(e){}"
                + "return {index:index,x:p&&Number.isFinite(p.x)?p.x:null,y:p&&Number.isFinite(p.y)?p.y:null,height:Number.isFinite(h)?h:null}});"
                + "return JSON.stringify({ok:true,mapId:state&&state.mapId,frameSequence:state&&Number.isSafeInteger(state.frameSequence)?state.frameSequence:null,ready:!!(state&&state.ready),samples})})()";
            String jsRaw = String.valueOf(call(parent, "evalJs", jsScript));
            JSONObject js = new JSONObject(jsRaw);
            if (!js.optBoolean("ok") || !"main".equals(js.optString("mapId")))
                return report.put("failureStage", js.optString("reason", "js-map-handle"))
                    .put("jsMapIdIsMain", "main".equals(js.optString("mapId")));
            JSONArray jsSamples = js.optJSONArray("samples");
            if (jsSamples == null || jsSamples.length() != safeCoordinates.length())
                return report.put("failureStage", "js-sample-count");

            GroundProjectionCounts nativeCounts = new GroundProjectionCounts();
            AtomicHolder<ProjectionFrameSnapshot> afterHolder = new AtomicHolder<>();
            AtomicHolder<JSONArray> sampleResults = new AtomicHolder<>();
            AtomicHolder<double[]> matrixAfterSampling = new AtomicHolder<>();
            AtomicHolder<int[]> viewportAfterSampling = new AtomicHolder<>();
            AtomicHolder<Long> sequenceAfterSampling = new AtomicHolder<>();
            AtomicHolder<Throwable> afterFailure = new AtomicHolder<>();
            parent.runOnMainSync(() -> {
                try {
                    ProjectionFrameSnapshot after = captureProjectionFrame(parent, nativeCounts);
                    afterHolder.value = after;
                    if (after == null || after.projection == null) return;
                    sampleResults.value = compareProjectionSamples(after, safeCoordinates, jsSamples, nativeCounts);
                    Object entry = field(parent, "entry"), controller = field(entry, "controller");
                    matrixAfterSampling.value = copyMatrix(field(controller, "lastBridgeFrameMatrix"));
                    viewportAfterSampling.value = viewport(field(after.projection.engine, "viewport"));
                    sequenceAfterSampling.value = publishedFrameSequence(entry);
                } catch (Throwable failure) { afterFailure.value = failure; }
            });
            if (afterFailure.value != null || afterHolder.value == null || afterHolder.value.projection == null)
                return report.put("failureStage", nativeCounts.failureStage == null ? "frame-after" : nativeCounts.failureStage)
                    .put("failureType", afterFailure.value == null ? "unavailable" : afterFailure.value.getClass().getSimpleName());
            JSONObject cameraAfter = (JSONObject)call(parent, "invokeCameraJson");
            ProjectionFrameSnapshot before = beforeHolder.value, after = afterHolder.value;
            long jsSequence = js.has("frameSequence") && !js.isNull("frameSequence") ? js.optLong("frameSequence", -1L) : -1L;
            boolean sequenceStable = before.publishedSequence >= 0 && before.publishedSequence == after.publishedSequence &&
                jsSequence == before.publishedSequence && before.sequenceCounter == after.sequenceCounter;
            boolean matrixStable = Arrays.equals(before.projection.mvp, after.projection.mvp);
            boolean viewportStable = Arrays.equals(before.projection.viewport, after.projection.viewport);
            boolean matrixStableAfterSampling = Arrays.equals(after.projection.mvp, matrixAfterSampling.value);
            boolean viewportStableAfterSampling = Arrays.equals(after.projection.viewport, viewportAfterSampling.value);
            boolean sequenceStableAfterSampling = after.publishedSequence == (sequenceAfterSampling.value == null ? -1L : sequenceAfterSampling.value);
            boolean cameraStable = cameraBefore.toString().equals(cameraAfter.toString());
            report.put("jsFrameSequence", jsSequence < 0 ? JSONObject.NULL : jsSequence)
                .put("hostPublishedFrameSequenceBefore", before.publishedSequence < 0 ? JSONObject.NULL : before.publishedSequence)
                .put("hostPublishedFrameSequenceAfter", after.publishedSequence < 0 ? JSONObject.NULL : after.publishedSequence)
                .put("hostFrameSequenceCounterBefore", before.sequenceCounter < 0 ? JSONObject.NULL : before.sequenceCounter)
                .put("hostFrameSequenceCounterAfter", after.sequenceCounter < 0 ? JSONObject.NULL : after.sequenceCounter)
                .put("hostPublishedFrameSequenceAfterSampling", sequenceAfterSampling.value == null || sequenceAfterSampling.value < 0 ? JSONObject.NULL : sequenceAfterSampling.value)
                .put("samePublishedFrameSequence", sequenceStable)
                .put("matrixStable", matrixStable && matrixStableAfterSampling)
                .put("viewportStable", viewportStable && viewportStableAfterSampling).put("cameraStable", cameraStable)
                .put("sequenceStableAfterSampling", sequenceStableAfterSampling)
                .put("verticalExaggeration", after.verticalExaggeration)
                .put("verticalExaggerationKnown", after.verticalExaggerationKnown)
                .put("cssToNativeScale", after.cssScale).put("cssToNativeScaleKnown", after.cssScaleKnown)
                .put("frameStable", sequenceStable && matrixStable && viewportStable && cameraStable &&
                    matrixStableAfterSampling && viewportStableAfterSampling && sequenceStableAfterSampling)
                .put("jsMapHandleReady", js.optBoolean("ready"))
                .put("sampleCount", safeCoordinates.length()).put("samples", sampleResults.value == null ? new JSONArray() : sampleResults.value)
                .put("terrainMapCandidates", nativeCounts.terrainMapCandidates).put("terrainMapUnique", nativeCounts.terrainMapUnique)
                .put("meshProjectionSamples", nativeCounts.meshAnchors).put("elevationFallbackSamples", nativeCounts.fallbackAnchors)
                .put("projectionFailureStage", nativeCounts.failureStage == null ? "none" : nativeCounts.failureStage)
                .put("projectionFailureType", nativeCounts.failureType == null ? "none" : nativeCounts.failureType)
                .put("geoidOffsetMethodAvailable", nativeCounts.geoidOffsetMethodAvailable);
            report.put("status", sequenceStable && matrixStable && viewportStable && cameraStable &&
                matrixStableAfterSampling && viewportStableAfterSampling && sequenceStableAfterSampling
                ? "MEASURED_STABLE_FRAME" : "MEASURED_FRAME_CHANGED");
            return report;
        } catch (Throwable failure) {
            return report.put("failureStage", "projection-comparison")
                .put("failureType", failure.getClass().getSimpleName());
        }
    }

    private static ProjectionFrameSnapshot captureProjectionFrame(Native149Instrumentation parent,
        GroundProjectionCounts counts) throws Exception {
        Object entry = field(parent, "entry"), controller = field(entry, "controller");
        Object worldWindow = field(controller, "worldWindow"), engine = field(worldWindow, "engine");
        GroundProjectionContext projection = createGroundProjectionContext(parent, counts);
        long sequence = publishedFrameSequence(entry), counter = -1L;
        double exaggeration = 1.0, cssScale = 1.0; boolean exaggerationKnown = false, cssScaleKnown = false;
        try { counter = ((Number)field(entry, "renderFrameSequence")).longValue(); } catch (Throwable ignored) { }
        try {
            Object published = field(entry, "lastPublishedRenderFrame");
            Object metadata = field(published, "metadata");
            Object value = field(metadata, "exaggeration");
            if (value instanceof Number) { exaggeration = ((Number)value).doubleValue(); exaggerationKnown = Double.isFinite(exaggeration); }
            Object scale = field(metadata, "cssScale");
            if (scale instanceof Number) { cssScale = ((Number)scale).doubleValue(); cssScaleKnown = Double.isFinite(cssScale) && cssScale > 0.0; }
        } catch (Throwable ignored) { }
        return new ProjectionFrameSnapshot(projection, sequence, counter, exaggeration, exaggerationKnown, cssScale, cssScaleKnown);
    }

    private static long publishedFrameSequence(Object entry) {
        try {
            Object published = field(entry, "lastPublishedRenderFrame");
            Object sequence = field(published, "sequence");
            return sequence instanceof Number ? ((Number)sequence).longValue() : -1L;
        } catch (Throwable ignored) { return -1L; }
    }

    private static JSONArray compareProjectionSamples(ProjectionFrameSnapshot frame, JSONArray coordinates,
        JSONArray jsSamples, GroundProjectionCounts counts) throws Exception {
        JSONArray results = new JSONArray();
        GroundProjectionContext context = frame.projection;
        Method toCartesian = methodByGlobeSignature(context.globe.getClass(), context.vec3Class);
        if (toCartesian != null) toCartesian.setAccessible(true);
        Object geoid = null; Method getOffset = null;
        try { geoid = field(context.globe, "geoid"); } catch (Throwable ignored) { }
        if (geoid != null) getOffset = methodByGeoidSignature(geoid.getClass());
        counts.geoidOffsetMethodAvailable = getOffset != null;
        if (getOffset != null) getOffset.setAccessible(true);
        double scale = frame.cssScaleKnown ? frame.cssScale : 1.0;
        for (int i = 0; i < coordinates.length(); i++) {
            JSONArray coordinate = coordinates.optJSONArray(i);
            JSONObject js = jsSamples.optJSONObject(i);
            double lon = coordinate.optDouble(0, Double.NaN), lat = coordinate.optDouble(1, Double.NaN);
            ScreenPoint jsPoint = js != null && finiteJson(js, "x") && finiteJson(js, "y")
                ? new ScreenPoint(js.optDouble("x"), js.optDouble("y")) : null;
            ScreenPoint meshPoint = projectRenderedGroundCss(context, lat, lon, scale, counts);
            JSONObject sample = new JSONObject().put("index", i)
                .put("jsScreenValid", jsPoint != null).put("nativeMeshScreenValid", meshPoint != null);
            putScreenDifference(sample, "nativeMeshMinusJs", meshPoint, jsPoint);
            if (js != null && finiteJson(js, "height")) {
                double rawHeight = js.optDouble("height");
                double ve = frame.verticalExaggerationKnown ? frame.verticalExaggeration : 1.0;
                ScreenPoint rawPoint = toCartesian == null ? null : projectGlobeAltitude(context, toCartesian, lat, lon, rawHeight * ve, scale);
                sample.put("rawDemHeightMeters", rawHeight).put("rawHeightProjectionAvailable", rawPoint != null);
                putScreenDifference(sample, "rawDemHeightMinusJs", rawPoint, jsPoint);
                putScreenDifference(sample, "rawDemHeightMinusMesh", rawPoint, meshPoint);
                if (getOffset != null) {
                    try {
                        Object value = getOffset.invoke(geoid, lat, lon);
                        if (value instanceof Number && Double.isFinite(((Number)value).doubleValue())) {
                            double offset = ((Number)value).doubleValue();
                            ScreenPoint adjusted = toCartesian == null ? null : projectGlobeAltitude(context, toCartesian, lat, lon,
                                (rawHeight + offset) * ve, scale);
                            sample.put("geoidOffsetMeters", offset).put("geoidCorrectedProjectionAvailable", adjusted != null);
                            putScreenDifference(sample, "rawDemPlusGeoidMinusJs", adjusted, jsPoint);
                            putScreenDifference(sample, "rawDemPlusGeoidMinusMesh", adjusted, meshPoint);
                            putScreenDifference(sample, "geoidCorrectionShift", adjusted, rawPoint);
                        } else sample.put("geoidOffsetStatus", "non-numeric");
                    } catch (Throwable ignored) { sample.put("geoidOffsetStatus", "call-failed"); }
                } else sample.put("geoidOffsetStatus", "unsupported");
            } else sample.put("rawDemHeightStatus", "unavailable");
            results.put(sample);
        }
        return results;
    }

    private static boolean finiteJson(JSONObject value, String key) {
        return value.has(key) && !value.isNull(key) && Double.isFinite(value.optDouble(key, Double.NaN));
    }

    private static void putScreenDifference(JSONObject output, String prefix, ScreenPoint a, ScreenPoint b) throws Exception {
        if (a == null || b == null) {
            output.put(prefix + "DxCssPx", JSONObject.NULL).put(prefix + "DyCssPx", JSONObject.NULL)
                .put(prefix + "DistanceCssPx", JSONObject.NULL);
            return;
        }
        double dx = a.x - b.x, dy = a.y - b.y;
        output.put(prefix + "DxCssPx", dx).put(prefix + "DyCssPx", dy)
            .put(prefix + "DistanceCssPx", Math.hypot(dx, dy));
    }

    private static ScreenPoint projectGlobeAltitude(GroundProjectionContext context, Method toCartesian,
        double lat, double lon, double altitude, double scale) {
        try {
            Object cartesian = context.vec3Class.getDeclaredConstructor().newInstance();
            toCartesian.invoke(context.globe, lat, lon, altitude, cartesian);
            double x = ((Number)field(cartesian, "x")).doubleValue();
            double y = ((Number)field(cartesian, "y")).doubleValue();
            double z = ((Number)field(cartesian, "z")).doubleValue();
            return projectCartesianCss(context.mvp, context.viewport, x, y, z, scale);
        } catch (Throwable ignored) { return null; }
    }

    private static Method methodByGeoidSignature(Class<?> type) {
        for (Class<?> current = type; current != null; current = current.getSuperclass()) {
            for (Method method : current.getDeclaredMethods()) {
                Class<?>[] p = method.getParameterTypes();
                if (method.getName().startsWith("getOffset") && p.length == 2 && p[0] == double.class && p[1] == double.class &&
                    Number.class.isAssignableFrom(box(method.getReturnType()))) return method;
            }
        }
        return null;
    }


    private static JSONObject runMultitouch(Native149Instrumentation parent, View view, int[] origin, double scale) throws Exception {
        JSONObject before = (JSONObject)call(parent, "invokeCameraJson");
        float cx = (float)(view.getWidth() / scale * 0.5), cy = (float)(view.getHeight() / scale * 0.5);
        float firstX = cx - 24, secondX = cx + 24, y = cy;
        long downTime = SystemClock.uptimeMillis();
        ScreenPoint currentFirst = new ScreenPoint(origin[0] + firstX * scale, origin[1] + y * scale);
        ScreenPoint currentSecond = new ScreenPoint(origin[0] + secondX * scale, origin[1] + y * scale);
        int activePointers = 0;
        JSONObject afterPan, afterPinch, afterPanAgain;
        int residualDraftPoints;
        try {
            injectSingle(parent, MotionEvent.ACTION_DOWN, downTime, currentFirst);
            activePointers = 1;
            injectMulti(parent, MotionEvent.ACTION_POINTER_DOWN | (1 << MotionEvent.ACTION_POINTER_INDEX_SHIFT), downTime, currentFirst, currentSecond);
            activePointers = 2;
            // WorldWind's SDK pan recognizer needs >20dp of centroid movement. The CSS
            // movement below therefore spans well past that threshold after the router
            // starts its synthetic one-pointer pan, including on density-3+ phones.
            for (int i = 1; i <= CAMERA_PAN_STEPS; i++) {
                SystemClock.sleep(24L);
                float currentY = y + i * CAMERA_PAN_STEP_CSS;
                currentFirst = new ScreenPoint(origin[0] + firstX * scale, origin[1] + currentY * scale);
                currentSecond = new ScreenPoint(origin[0] + secondX * scale, origin[1] + currentY * scale);
                injectMulti(parent, MotionEvent.ACTION_MOVE, downTime, currentFirst, currentSecond);
            }
            SystemClock.sleep(120L);
            afterPan = (JSONObject)call(parent, "invokeCameraJson");
            float panY = y + CAMERA_PAN_STEPS * CAMERA_PAN_STEP_CSS;
            // The router hands back to WorldWind as soon as radial distance changes by
            // 6 native pixels. Continue far enough after that reset for the SDK pinch
            // recognizer's separate >20dp threshold to be crossed with margin.
            for (int i = 1; i <= CAMERA_PINCH_STEPS; i++) {
                SystemClock.sleep(24L);
                double radial = CAMERA_PINCH_RADIAL_STEP_CSS * i;
                currentFirst = new ScreenPoint(origin[0] + (firstX - radial) * scale, origin[1] + panY * scale);
                currentSecond = new ScreenPoint(origin[0] + (secondX + radial) * scale, origin[1] + panY * scale);
                injectMulti(parent, MotionEvent.ACTION_MOVE, downTime, currentFirst, currentSecond);
            }
            SystemClock.sleep(300L);
            afterPinch = (JSONObject)call(parent, "invokeCameraJson");
            float pinchRadial = CAMERA_PINCH_STEPS * CAMERA_PINCH_RADIAL_STEP_CSS;
            float pinchFirstX = firstX - pinchRadial, pinchSecondX = secondX + pinchRadial;
            // Also exceed the SDK pan threshold after pinch-to-pan handoff; a short
            // accumulated translation can be correctly routed but remain below the
            // recognizer's interpretation distance and leave the camera unchanged.
            for (int i = 1; i <= CAMERA_PAN_STEPS; i++) {
                SystemClock.sleep(24L);
                double deltaY = CAMERA_PAN_STEP_CSS * i;
                currentFirst = new ScreenPoint(origin[0] + pinchFirstX * scale, origin[1] + (panY + deltaY) * scale);
                currentSecond = new ScreenPoint(origin[0] + pinchSecondX * scale, origin[1] + (panY + deltaY) * scale);
                injectMulti(parent, MotionEvent.ACTION_MOVE, downTime, currentFirst, currentSecond);
            }
            SystemClock.sleep(300L);
            afterPanAgain = (JSONObject)call(parent, "invokeCameraJson");
            float finalY = panY + CAMERA_PAN_STEPS * CAMERA_PAN_STEP_CSS;
            currentFirst = new ScreenPoint(origin[0] + pinchFirstX * scale, origin[1] + finalY * scale);
            currentSecond = new ScreenPoint(origin[0] + pinchSecondX * scale, origin[1] + finalY * scale);
            injectMulti(parent, MotionEvent.ACTION_POINTER_UP | (1 << MotionEvent.ACTION_POINTER_INDEX_SHIFT), downTime, currentFirst, currentSecond);
            activePointers = 1;
            SystemClock.sleep(30L);
            currentFirst = new ScreenPoint(origin[0] + pinchFirstX * scale, origin[1] + (finalY + 18) * scale);
            injectSingle(parent, MotionEvent.ACTION_MOVE, downTime, currentFirst);
            residualDraftPoints = draftPointCount((JSONObject)call(parent, "readState"));
            injectSingle(parent, MotionEvent.ACTION_UP, downTime, currentFirst);
            activePointers = 0;
        } finally {
            if (activePointers == 2) {
                try { injectMulti(parent, MotionEvent.ACTION_CANCEL, downTime, currentFirst, currentSecond); } catch (Throwable ignored) { }
            } else if (activePointers == 1) {
                try { injectSingle(parent, MotionEvent.ACTION_CANCEL, downTime, currentFirst); } catch (Throwable ignored) { }
            }
        }
        int finalDraftPoints = draftPointCount((JSONObject)call(parent, "readState"));
        JSONObject report = new JSONObject().put("cameraBefore", before).put("cameraAfterFirstPan", afterPan)
            .put("cameraAfterPinch", afterPinch).put("cameraAfterSecondPan", afterPanAgain)
            .put("firstPanChangedCenter", cameraCenterMoved(before, afterPan))
            .put("pinchChangedZoom", Math.abs(cameraZoom(afterPinch) - cameraZoom(afterPan)) > 0.01)
            .put("secondPanChangedCenter", cameraCenterMoved(afterPinch, afterPanAgain))
            .put("residualPointerUpDraftPoints", residualDraftPoints).put("finalDraftPoints", finalDraftPoints)
            .put("residualPointerDidNotDraw", residualDraftPoints == 0 && finalDraftPoints == 0);
        report.put("pass", report.optBoolean("firstPanChangedCenter") && report.optBoolean("pinchChangedZoom") &&
            report.optBoolean("secondPanChangedCenter") && report.optBoolean("residualPointerDidNotDraw"));
        return report;
    }

    private static JSONObject injectPointTap(Native149Instrumentation parent, int[] origin, double scale, ScreenPoint aim, InputTrace trace) throws Exception {
        long downTime = SystemClock.uptimeMillis();
        ScreenPoint finger = new ScreenPoint(origin[0] + aim.x * scale, origin[1] + (aim.y + AIM_OFFSET_CSS) * scale);
        boolean active = true;
        JSONObject snapEvidence = new JSONObject().put("snapOutcome", "unknown");
        try {
            injectSingle(parent, MotionEvent.ACTION_DOWN, downTime, finger, trace, origin, scale);
            SystemClock.sleep(45L);
            injectSingle(parent, MotionEvent.ACTION_MOVE, downTime, finger, trace, origin, scale);
            snapEvidence = readPointSnapOutcome(parent);
            SystemClock.sleep(90L);
            injectSingle(parent, MotionEvent.ACTION_UP, downTime, finger, trace, origin, scale);
            active = false;
            SystemClock.sleep(180L);
        } finally { if (active) try { injectSingle(parent, MotionEvent.ACTION_CANCEL, downTime, finger, trace, origin, scale); } catch (Throwable ignored) { } }
        return snapEvidence;
    }

    private static void injectRoadContinuation(Native149Instrumentation parent, int[] origin, double scale,
        List<ScreenPoint> aims, InputTrace trace, JSONArray snapStages) throws Exception {
        if (aims.isEmpty()) throw new IllegalArgumentException("empty-road-continuation");
        ScreenPoint first = aims.get(0);
        long downTime = SystemClock.uptimeMillis();
        ScreenPoint firstFinger = new ScreenPoint(origin[0] + first.x * scale, origin[1] + (first.y + AIM_OFFSET_CSS) * scale);
        ScreenPoint last = aims.get(aims.size() - 1);
        ScreenPoint lastFinger = new ScreenPoint(origin[0] + last.x * scale, origin[1] + (last.y + AIM_OFFSET_CSS) * scale);
        boolean active = true;
        int moveIndex = 0;
        try {
            injectSingle(parent, MotionEvent.ACTION_DOWN, downTime, firstFinger, trace, origin, scale);
            snapStages.put(snapStage("continuation-down", (JSONObject)call(parent, "inspectDrawingMagnifier")));
            for (ScreenPoint aim : aims) {
                SystemClock.sleep(38L);
                lastFinger = new ScreenPoint(origin[0] + aim.x * scale, origin[1] + (aim.y + AIM_OFFSET_CSS) * scale);
                injectSingle(parent, MotionEvent.ACTION_MOVE, downTime, lastFinger, trace, origin, scale);
                snapStages.put(snapStage("continuation-move-" + (++moveIndex),
                    (JSONObject)call(parent, "inspectDrawingMagnifier")));
            }
            SystemClock.sleep(100L);
            injectSingle(parent, MotionEvent.ACTION_UP, downTime, lastFinger, trace, origin, scale);
            active = false;
            SystemClock.sleep(250L);
            snapStages.put(snapStage("continuation-up", (JSONObject)call(parent, "inspectDrawingMagnifier")));
        } finally { if (active) try { injectSingle(parent, MotionEvent.ACTION_CANCEL, downTime, lastFinger, trace, origin, scale); } catch (Throwable ignored) { } }
    }

    private static void injectSingle(Native149Instrumentation parent, int action, long downTime, ScreenPoint screen) {
        try { injectSingle(parent, action, downTime, screen, null, null, 1.0); }
        catch (Exception error) { throw new IllegalStateException("motion-event-delivery-failed", error); }
    }

    private static void injectSingle(Native149Instrumentation parent, int action, long downTime, ScreenPoint screen,
        InputTrace trace, int[] origin, double scale) throws Exception {
        long eventTime = SystemClock.uptimeMillis();
        MotionEvent event = MotionEvent.obtain(downTime, eventTime, action,
            (float)screen.x, (float)screen.y, 0);
        event.setSource(InputDevice.SOURCE_TOUCHSCREEN);
        try {
            parent.sendPointerSync(event);
            if (trace != null) trace.record(event, origin, scale);
        } finally { event.recycle(); }
    }

    private static void injectMulti(Native149Instrumentation parent, int action, long downTime, ScreenPoint first, ScreenPoint second) {
        MotionEvent.PointerProperties[] properties = new MotionEvent.PointerProperties[2];
        MotionEvent.PointerCoords[] coords = new MotionEvent.PointerCoords[2];
        ScreenPoint[] points = { first, second };
        for (int i = 0; i < 2; i++) {
            properties[i] = new MotionEvent.PointerProperties(); properties[i].id = i; properties[i].toolType = MotionEvent.TOOL_TYPE_FINGER;
            coords[i] = new MotionEvent.PointerCoords(); coords[i].x = (float)points[i].x; coords[i].y = (float)points[i].y;
            coords[i].pressure = 1f; coords[i].size = 1f;
        }
        MotionEvent event = MotionEvent.obtain(downTime, SystemClock.uptimeMillis(), action, 2, properties, coords,
            0, 0, 1f, 1f, 0, 0, InputDevice.SOURCE_TOUCHSCREEN, 0);
        try { parent.sendPointerSync(event); } finally { event.recycle(); }
    }

    private static ReadyRoadSnapshot awaitReadyRoadSnapshot(Native149Instrumentation parent, Object owner, Object entry, long timeout) throws Exception {
        long end = SystemClock.elapsedRealtime() + timeout;
        JSONObject last = null;
        JSONObject lastFreshness = null;
        while (SystemClock.elapsedRealtime() < end) {
            JSONObject freshness = roadSnapshotFreshness(parent, owner, entry);
            lastFreshness = freshness;
            Object payload = freshness.opt("payload");
            if (payload instanceof JSONObject) {
                last = new JSONObject(payload.toString());
                boolean current = freshness.optBoolean("keysMatch") && freshness.optBoolean("payloadRevisionMatches") &&
                    freshness.optBoolean("isCurrentMainEntry");
                if (current && "ready".equals(roadStatus(last)) && last.optJSONObject("road") != null &&
                    last.getJSONObject("road").optJSONArray("lines") != null && last.getJSONObject("road").getJSONArray("lines").length() > 0)
                    return new ReadyRoadSnapshot(last, freshness.optString("completedKeyFingerprint", ""));
            }
            SystemClock.sleep(150L);
        }
        throw new IllegalStateException("native-road-snapshot-not-ready:" + roadStatus(last) + ":" +
            (lastFreshness == null ? "no-freshness" : lastFreshness.optString("failureReason", "unknown")));
    }

    /** Captures only redacted freshness facts; opaque tile/request keys must never enter QA output. */
    private static JSONObject roadSnapshotFreshness(Native149Instrumentation parent, Object owner, Object entry) throws Exception {
        AtomicHolder<JSONObject> result = new AtomicHolder<>();
        parent.runOnMainSync(() -> {
            try {
                Object lock = field(owner, "stateLock");
                synchronized (lock) {
                    Object completed = field(owner, "completedKey"), latest = field(owner, "latestKey");
                    Object payloadValue = field(owner, "completedPayload");
                    JSONObject payload = payloadValue instanceof JSONObject ? new JSONObject(payloadValue.toString()) : null;
                    long entryRevision = ((Number)field(entry, "snapRevision")).longValue();
                    long payloadRevision = payload == null ? Long.MIN_VALUE : payload.optLong("cameraRevision", Long.MIN_VALUE);
                    Object mapEntries = field(field(parent, "host"), "maps");
                    boolean currentMain = mapEntries instanceof Map && ((Map<?, ?>)mapEntries).get("main") == entry;
                    boolean keysMatch = completed != null && completed.equals(latest);
                    boolean payloadMatches = payloadRevision == entryRevision;
                    String reason = !currentMain ? "entry-not-current-main" : !keysMatch ? "completed-key-not-latest" :
                        !payloadMatches ? "payload-revision-not-current" : "fresh";
                    result.value = new JSONObject().put("keysMatch", keysMatch)
                        .put("payloadRevisionMatches", payloadMatches).put("entrySnapRevision", entryRevision)
                        .put("payloadCameraRevision", payload == null ? JSONObject.NULL : payloadRevision)
                        .put("completedKeyFingerprint", completed == null ? "" : sha256(String.valueOf(completed)))
                        .put("isCurrentMainEntry", currentMain).put("roadStatus", roadStatus(payload))
                        .put("lineCount", roadLineCount(payload)).put("failureReason", reason)
                        .put("payload", payload == null ? JSONObject.NULL : payload);
                }
            } catch (Throwable failure) {
                try {
                    result.value = new JSONObject().put("keysMatch", false).put("payloadRevisionMatches", false)
                        .put("isCurrentMainEntry", false).put("failureReason", "read-" + failure.getClass().getSimpleName())
                        .put("payload", JSONObject.NULL);
                } catch (Throwable ignored) { }
            }
        });
        return result.value == null ? new JSONObject().put("keysMatch", false).put("payloadRevisionMatches", false)
            .put("isCurrentMainEntry", false).put("failureReason", "main-sync-no-result") : result.value;
    }

    private static boolean readySnapshotStillCurrent(ReadyRoadSnapshot snapshot, JSONObject freshness) throws Exception {
        if (snapshot == null || freshness == null || !freshness.optBoolean("keysMatch") ||
            !freshness.optBoolean("payloadRevisionMatches") || !freshness.optBoolean("isCurrentMainEntry")) return false;
        if (snapshot.keyFingerprint.isEmpty() || !snapshot.keyFingerprint.equals(freshness.optString("completedKeyFingerprint", ""))) return false;
        Object currentPayload = freshness.opt("payload");
        return currentPayload instanceof JSONObject && snapshot.payloadFingerprint.equals(sha256(currentPayload.toString()));
    }

    private static int roadLineCount(JSONObject payload) {
        JSONObject road = payload == null ? null : payload.optJSONObject("road");
        JSONArray lines = road == null ? null : road.optJSONArray("lines");
        return lines == null ? 0 : lines.length();
    }

    private static JSONObject summarizeRoadSnapshotFreshness(JSONObject freshness) throws Exception {
        return new JSONObject().put("keysMatch", freshness.optBoolean("keysMatch"))
            .put("payloadRevisionMatches", freshness.optBoolean("payloadRevisionMatches"))
            .put("entrySnapRevision", freshness.opt("entrySnapRevision"))
            .put("payloadCameraRevision", freshness.opt("payloadCameraRevision"))
            .put("isCurrentMainEntry", freshness.optBoolean("isCurrentMainEntry"))
            .put("roadStatus", freshness.optString("roadStatus", "missing"))
            .put("lineCount", freshness.optInt("lineCount"))
            .put("failureReason", freshness.optString("failureReason", "unknown"));
    }

    /** Reports only zoom histogram and counts; never emits opaque z/x/y cache keys. */
    private static JSONObject decodedSourceZoomHistogram(Object owner) throws Exception {
        JSONObject out = new JSONObject().put("stable", false).put("freshCompletedSnapshot", false);
        try {
            Object lock = field(owner, "stateLock");
            synchronized (lock) {
                Object latest = field(owner, "latestKey"), completed = field(owner, "completedKey");
                Object scheduled = field(owner, "scheduledKey");
                if (latest == null || !latest.equals(completed) || scheduled != null)
                    return out.put("reason", "snapshot-not-stable");
                out.put("freshCompletedSnapshot", true);
            }
            Object value = field(owner, "decoded");
            if (!(value instanceof Map)) return out.put("reason", "decoded-map-unavailable");
            Map<?, ?> decoded = (Map<?, ?>)value;
            int sizeBefore = decoded.size();
            Map<Integer, Integer> histogram = new java.util.TreeMap<>();
            for (Object key : new ArrayList<>(decoded.keySet())) {
                if (!(key instanceof String)) continue;
                String[] pieces = ((String)key).split("/", 3);
                if (pieces.length != 3) continue;
                int zoom = Integer.parseInt(pieces[0]);
                histogram.put(zoom, histogram.getOrDefault(zoom, 0) + 1);
            }
            int sizeAfter = decoded.size();
            Object latestAfter = field(owner, "latestKey"), completedAfter = field(owner, "completedKey");
            boolean stable = sizeBefore == sizeAfter && latestAfter != null && latestAfter.equals(completedAfter);
            JSONObject counts = new JSONObject();
            for (Map.Entry<Integer, Integer> entry : histogram.entrySet()) counts.put(String.valueOf(entry.getKey()), entry.getValue());
            return out.put("stable", stable).put("reason", stable ? "stable" : "decoded-map-changed")
                .put("decodedTileCount", sizeAfter).put("zoomCounts", counts);
        } catch (Throwable failure) {
            return out.put("reason", "decoded-map-read-" + failure.getClass().getSimpleName());
        }
    }

    /** Compares a built-in Tianditu identity in memory and emits booleans only. */
    private static JSONObject sourceIdentitySummary(Native149Instrumentation parent, Object entry, JSONObject state) throws Exception {
        AtomicHolder<JSONObject> result = new AtomicHolder<>();
        parent.runOnMainSync(() -> {
            try {
                Object host = field(parent, "host");
                Method diagnostics = findMethod(host.getClass(), "inspectMapDiagnosticsOnMain", 0);
                diagnostics.setAccessible(true);
                Object value = diagnostics.invoke(host);
                JSONObject mapsDiagnostics = value instanceof JSONObject ? (JSONObject)value : null;
                JSONArray maps = mapsDiagnostics == null ? null : mapsDiagnostics.optJSONArray("maps");
                JSONObject main = null;
                if (maps != null) for (int i = 0; i < maps.length(); i++) {
                    JSONObject candidate = maps.optJSONObject(i);
                    if (candidate != null && "main".equals(candidate.optString("mapId"))) { main = candidate; break; }
                }
                String sourceId = main == null ? "" : main.optString("sourceId", "");
                result.value = new JSONObject().put("nativeMainDiagnosticAvailable", mapsDiagnostics != null && mapsDiagnostics.optBoolean("available"))
                    .put("nativeMainFound", main != null).put("nativeSourcePresent", !sourceId.isEmpty())
                    .put("nativeSourceIsBuiltinTianditu", sourceId.startsWith("tianditu"))
                    .put("renderStateMapSourcePresent", state.opt("mapSource") != null && state.opt("mapSource") != JSONObject.NULL)
                    .put("currentMainEntry", field(field(parent, "host"), "maps") instanceof Map &&
                        ((Map<?, ?>)field(field(parent, "host"), "maps")).get("main") == entry);
            } catch (Throwable failure) {
                try { result.value = new JSONObject().put("nativeMainDiagnosticAvailable", false)
                    .put("nativeSourcePresent", false).put("nativeSourceIsBuiltinTianditu", false)
                    .put("renderStateMapSourcePresent", state.opt("mapSource") != null && state.opt("mapSource") != JSONObject.NULL)
                    .put("currentMainEntry", false).put("failureReason", failure.getClass().getSimpleName()); }
                catch (Throwable ignored) { }
            }
        });
        return result.value == null ? new JSONObject().put("nativeMainDiagnosticAvailable", false)
            .put("nativeSourcePresent", false).put("nativeSourceIsBuiltinTianditu", false)
            .put("renderStateMapSourcePresent", state.opt("mapSource") != null && state.opt("mapSource") != JSONObject.NULL)
            .put("currentMainEntry", false) : result.value;
    }

    private static RoadTarget chooseCurvedRoadTarget(Native149Instrumentation parent, View view, Object owner, double cssScale) throws Exception {
        Object payloadValue = field(owner, "completedPayload");
        if (!(payloadValue instanceof JSONObject)) return null;
        JSONArray lines = ((JSONObject)payloadValue).optJSONObject("road").optJSONArray("lines");
        if (lines == null) return null;
        Object entry = field(parent, "entry"), controller = field(entry, "controller");
        Method project = findMethod(controller.getClass(), "projectCoordinate", 2);
        project.setAccessible(true);
        AtomicHolder<RoadTarget> best = new AtomicHolder<>();
        parent.runOnMainSync(() -> {
            int projected = 0;
            double width = view.getWidth() / cssScale, height = view.getHeight() / cssScale;
            for (int lineIndex = 0; lineIndex < lines.length() && projected < MAX_SOURCE_POINTS; lineIndex++) {
                JSONObject line = lines.optJSONObject(lineIndex);
                JSONArray coords = line == null ? null : line.optJSONArray("coordinates");
                if (coords == null || coords.length() < 3 || coords.length() > MAX_SOURCE_POINTS - projected) continue;
                List<ProjectedVertex> vertices = new ArrayList<>(coords.length());
                boolean validLine = true;
                for (int i = 0; i < coords.length(); i++) {
                    JSONArray coordinate = coords.optJSONArray(i);
                    if (coordinate == null || coordinate.length() < 2) { validLine = false; break; }
                    double lon = coordinate.optDouble(0, Double.NaN), lat = coordinate.optDouble(1, Double.NaN);
                    ScreenPoint screen = projectCss(controller, project, lat, lon, cssScale);
                    if (screen == null) { validLine = false; break; }
                    vertices.add(new ProjectedVertex(i, lon, lat, screen));
                }
                projected += coords.length();
                if (!validLine) continue;
                for (int start = 0; start < vertices.size() - 2; start++) {
                    if (!safe(vertices.get(start).screen, width, height)) continue;
                    int maxEnd = Math.min(vertices.size() - 1, start + 32);
                    for (int finish = start + 2; finish <= maxEnd; finish++) {
                        ProjectedVertex a = vertices.get(start), b = vertices.get(finish);
                        if (!safe(b.screen, width, height)) break;
                        double chord = distance(a.screen, b.screen);
                        if (chord < 24.0) continue;
                        double bend = 0;
                        boolean inside = true;
                        for (int k = start + 1; k < finish; k++) {
                            ProjectedVertex point = vertices.get(k);
                            if (!safe(point.screen, width, height)) { inside = false; break; }
                            bend = Math.max(bend, pointSegmentDistance(point.screen, a.screen, b.screen));
                        }
                        if (!inside || bend < 5.0) continue;
                        double score = chord * Math.min(bend, 80.0);
                        if (best.value == null || score > best.value.score) {
                            RoadTarget target = new RoadTarget();
                            target.lineHash = sha256(line.optString("id", "line-" + lineIndex));
                            target.lineIndex = lineIndex; target.startIndex = start; target.endIndex = finish;
                            target.chordPx = chord; target.bendPx = bend; target.score = score;
                            target.vertices = new ArrayList<>(vertices.subList(start, finish + 1));
                            best.value = target;
                        }
                    }
                }
            }
        });
        return best.value;
    }

    /** Selects a real, visibly curved continuation across two connected cached road features. */
    private static RoadTarget chooseConnectedCurvedRoadTarget(Native149Instrumentation parent, View view, JSONObject snapshot, double cssScale,
        GroundProjectionCounts projectionCounts) throws Exception {
        JSONObject road = snapshot == null ? null : snapshot.optJSONObject("road");
        JSONArray lines = road == null ? null : road.optJSONArray("lines");
        if (lines == null || lines.length() < 2) return null;
        Object controller = field(field(parent, "entry"), "controller");
        AtomicHolder<List<ProjectedRoadLine>> projectedLines = new AtomicHolder<>();
        final double[] viewportSize = new double[2];
        parent.runOnMainSync(() -> {
          try {
            List<ProjectedRoadLine> projected = new ArrayList<>();
            int projectedCount = 0;
            viewportSize[0] = view.getWidth() / cssScale;
            viewportSize[1] = view.getHeight() / cssScale;
            GroundProjectionContext projection = createGroundProjectionContext(parent, projectionCounts);
            if (projection == null) { projectedLines.value = projected; return; }
            int lineLimit = Math.min(lines.length(), 256);
            for (int lineIndex = 0; lineIndex < lineLimit && projectedCount < MAX_SOURCE_POINTS; lineIndex++) {
                JSONObject line = lines.optJSONObject(lineIndex);
                JSONArray coordinates = line == null ? null : line.optJSONArray("coordinates");
                if (coordinates == null || coordinates.length() < 2 || coordinates.length() > MAX_SOURCE_POINTS - projectedCount) continue;
                List<ProjectedVertex> vertices = new ArrayList<>(coordinates.length());
                boolean valid = true;
                for (int vertexIndex = 0; vertexIndex < coordinates.length(); vertexIndex++) {
                    JSONArray coordinate = coordinates.optJSONArray(vertexIndex);
                    if (coordinate == null || coordinate.length() < 2) { valid = false; break; }
                    double lon = coordinate.optDouble(0, Double.NaN), lat = coordinate.optDouble(1, Double.NaN);
                    if (!Double.isFinite(lon) || !Double.isFinite(lat)) { valid = false; break; }
                    ScreenPoint screen = projectRenderedGroundCss(projection, lat, lon, cssScale, projectionCounts);
                    vertices.add(new ProjectedVertex(vertexIndex, lon, lat, screen));
                }
                projectedCount += coordinates.length();
                if (valid && vertices.size() >= 2) projected.add(new ProjectedRoadLine(lineIndex,
                    line.optString("id", "line-" + lineIndex), line.optString("name", ""),
                    line.optInt("level", -1), vertices));
            }
            double[] matrixAfter = copyMatrix(field(controller, "lastBridgeFrameMatrix"));
            int[] viewportAfter = viewport(field(projection.engine, "viewport"));
            projectionCounts.matrixUnchanged = Arrays.equals(projection.mvp, matrixAfter);
            projectionCounts.viewportUnchanged = Arrays.equals(projection.viewport, viewportAfter);
            projectedLines.value = projected;
          } catch (Throwable failure) {
            projectionCounts.failureStage = "road-target-projection";
            projectionCounts.failureType = failure.getClass().getSimpleName();
            projectedLines.value = new ArrayList<>();
          }
        });
        double width = viewportSize[0], height = viewportSize[1];
        List<ProjectedRoadLine> candidates = projectedLines.value;
        if (candidates == null || candidates.isEmpty()) return null;

        double meanLatitude = 0.0;
        int vertexCount = 0;
        for (ProjectedRoadLine line : candidates) for (ProjectedVertex vertex : line.vertices) {
            meanLatitude += vertex.latitude; vertexCount++;
        }
        meanLatitude = vertexCount == 0 ? 0.0 : meanLatitude / vertexCount;
        double latCellDegrees = 2.0 / 111_320.0;
        double lonCellDegrees = latCellDegrees / Math.max(0.1, Math.cos(Math.toRadians(meanLatitude)));
        Map<Long, List<VertexRef>> spatial = new HashMap<>();
        Map<String, Set<Integer>> edgeOwners = new HashMap<>();
        for (ProjectedRoadLine line : candidates) {
            if (line.level < 0) continue;
            for (int i = 0; i < line.vertices.size(); i++) {
                ProjectedVertex vertex = line.vertices.get(i);
                int cellX = (int)Math.floor(vertex.longitude / lonCellDegrees);
                int cellY = (int)Math.floor(vertex.latitude / latCellDegrees);
                long key = spatialCellKey(cellX, cellY);
                spatial.computeIfAbsent(key, ignored -> new ArrayList<>()).add(new VertexRef(line, i, vertex));
                if (i > 0) edgeOwners.computeIfAbsent(sourceEdgeKey(line.vertices.get(i - 1), vertex), ignored -> new HashSet<>())
                    .add(line.lineIndex);
            }
        }

        RoadTarget best = null;
        RoadTarget bestSingle = null;
        for (ProjectedRoadLine line : candidates) {
            if (line.level < 0) continue;
            for (int startIndex = 0; startIndex < line.vertices.size() - 5; startIndex++) {
                int lastEnd = Math.min(line.vertices.size(), startIndex + MAX_LOCAL_SUBPATH_VERTICES);
                for (int endIndex = startIndex + 5; endIndex < lastEnd; endIndex++) {
                    List<ProjectedVertex> path = new ArrayList<>(line.vertices.subList(startIndex, endIndex + 1));
                    if (!safePath(path, width, height)) { projectionCounts.rejectedUnsafePaths++; continue; }
                    if (!sourceEdgesUnique(path, line.lineIndex, edgeOwners)) { projectionCounts.rejectedDuplicateEdges++; continue; }
                    projectionCounts.uniqueEdgePairs++;
                    ScreenPoint start = path.get(0).screen, end = path.get(path.size() - 1).screen;
                    double chord = distance(start, end);
                    if (chord < 24.0) { projectionCounts.rejectedShortChords++; continue; }
                    projectionCounts.chordPasses++;
                    double bend = 0.0;
                    for (int i = 1; i < path.size() - 1; i++)
                        bend = Math.max(bend, pointSegmentDistance(path.get(i).screen, start, end));
                    if (bend < 5.0) { projectionCounts.rejectedFlatPaths++; continue; }
                    projectionCounts.curvePasses++;
                    projectionCounts.singleCurveTargets++;
                    double score = chord * Math.min(bend, 80.0);
                    if (bestSingle != null && score <= bestSingle.score) continue;
                    RoadTarget target = new RoadTarget();
                    target.lineHash = sha256(line.id); target.lineIndex = line.lineIndex; target.secondLineIndex = -1;
                    target.startIndex = path.get(0).sourceIndex; target.endIndex = path.get(path.size() - 1).sourceIndex;
                    target.nodeIndex = path.size() / 2; target.connectedLines = false;
                    target.sameRoadName = false; target.roadNamePresent = !line.name.isEmpty();
                    target.roadLevel = line.level; target.nodeGapMeters = 0.0; target.nodeGapCssPx = 0.0;
                    target.nodeTurnDegrees = 0.0; target.firstLineCoordinates = path;
                    target.secondLineCoordinates = new ArrayList<>(); target.vertices = path;
                    target.chordPx = chord; target.bendPx = bend; target.score = score;
                    bestSingle = target;
                }
            }
        }
        final double maxNodeGapCss = 12.0;
        Set<String> seenContacts = new HashSet<>();
        Map<Long, Set<Long>> sharedNodeLocations = new HashMap<>();
        for (ProjectedRoadLine first : candidates) {
            if (first.level < 0) continue;
            for (int firstIndex = 0; firstIndex < first.vertices.size(); firstIndex++) {
                ProjectedVertex firstNode = first.vertices.get(firstIndex);
                int cellX = (int)Math.floor(firstNode.longitude / lonCellDegrees);
                int cellY = (int)Math.floor(firstNode.latitude / latCellDegrees);
                for (int dx = -1; dx <= 1; dx++) for (int dy = -1; dy <= 1; dy++) {
                    List<VertexRef> nearby = spatial.get(spatialCellKey(cellX + dx, cellY + dy));
                    if (nearby == null) continue;
                    for (VertexRef ref : nearby) {
                        ProjectedRoadLine second = ref.line;
                        int secondIndex = ref.index;
                        if (first.lineIndex >= second.lineIndex || first.level != second.level || first.id.equals(second.id)) continue;
                        ProjectedVertex secondNode = ref.vertex;
                        double nodeGapMeters = geodesicDistanceMeters(firstNode.latitude, firstNode.longitude,
                            secondNode.latitude, secondNode.longitude);
                        if (!Double.isFinite(nodeGapMeters) || nodeGapMeters > MAX_NODE_GAP_METERS) continue;
                        projectionCounts.sharedNodePairsWithin2m++;
                        // A nonzero gap would make the joined fixture imply a connector
                        // that neither source feature contains. Only colocated source
                        // vertices may form this QA continuation chain.
                        if (nodeGapMeters > COLOCATED_SOURCE_NODE_TOLERANCE_METERS) { projectionCounts.rejectedNonColocatedPairs++; continue; }
                        projectionCounts.exactColocatedPairs++;
                        String contactKey = first.lineIndex + ":" + firstIndex + ":" + second.lineIndex + ":" + secondIndex;
                        if (!seenContacts.add(contactKey)) continue;
                        long featurePairKey = ((long)first.lineIndex << 32) | (second.lineIndex & 0xffffffffL);
                        int locationX = (int)Math.floor(((firstNode.longitude + secondNode.longitude) * 0.5) / lonCellDegrees);
                        int locationY = (int)Math.floor(((firstNode.latitude + secondNode.latitude) * 0.5) / latCellDegrees);
                        sharedNodeLocations.computeIfAbsent(featurePairKey, ignored -> new HashSet<>())
                            .add(spatialCellKey(locationX, locationY));

                        if (!safe(firstNode.screen, width, height) || !safe(secondNode.screen, width, height) ||
                            distance(firstNode.screen, secondNode.screen) > maxNodeGapCss) { projectionCounts.rejectedUnsafeNodePairs++; continue; }
                        for (int firstDirection : new int[]{-1, 1}) {
                            int previousIndex = firstIndex + firstDirection;
                            if (previousIndex < 0 || previousIndex >= first.vertices.size()) continue;
                            ProjectedVertex beforeNode = first.vertices.get(previousIndex);
                            if (!safe(beforeNode.screen, width, height)) continue;
                            for (int secondDirection : new int[]{-1, 1}) {
                                int nextIndex = secondIndex + secondDirection;
                                if (nextIndex < 0 || nextIndex >= second.vertices.size()) continue;
                                ProjectedVertex afterNode = second.vertices.get(nextIndex);
                                if (!safe(afterNode.screen, width, height)) continue;
                                double turn = turnDegrees(beforeNode.screen, firstNode.screen, afterNode.screen);
                                projectionCounts.turnChecks++;
                                if (!Double.isFinite(turn) || turn < 30.0 || turn > 150.0) { projectionCounts.rejectedTurns++; continue; }
                                projectionCounts.acceptedTurns++;
                                int maxFirstLength = Math.min(MAX_LOCAL_SUBPATH_VERTICES,
                                    firstDirection < 0 ? firstIndex + 1 : first.vertices.size() - firstIndex);
                                int maxSecondLength = Math.min(MAX_LOCAL_SUBPATH_VERTICES,
                                    secondDirection > 0 ? second.vertices.size() - secondIndex : secondIndex + 1);
                                for (int firstLength = 2; firstLength <= maxFirstLength; firstLength++) {
                                    List<ProjectedVertex> firstPath = incomingSubpath(first, firstIndex, firstDirection, firstLength);
                                    if (firstPath == null || !safePath(firstPath, width, height)) continue;
                                    for (int secondLength = 2; secondLength <= maxSecondLength; secondLength++) {
                                        List<ProjectedVertex> secondPath = outgoingSubpath(second, secondIndex, secondDirection, secondLength);
                                        if (secondPath == null || !safePath(secondPath, width, height) ||
                                            firstPath.size() + secondPath.size() < 7) { projectionCounts.rejectedShortPaths++; continue; }
                                        projectionCounts.sufficientPathPairs++;
                                        if (!sourceEdgesUnique(firstPath, first.lineIndex, edgeOwners) ||
                                            !sourceEdgesUnique(secondPath, second.lineIndex, edgeOwners)) { projectionCounts.rejectedDuplicateEdges++; continue; }
                                        projectionCounts.uniqueEdgePairs++;

                                        List<ProjectedVertex> joined = new ArrayList<>(firstPath.size() + secondPath.size());
                                        joined.addAll(firstPath);
                                        if (nodeGapMeters < 0.001) joined.addAll(secondPath.subList(1, secondPath.size()));
                                        else joined.addAll(secondPath);
                                        if (joined.size() < 6 || !safePath(joined, width, height)) { projectionCounts.rejectedUnsafePaths++; continue; }
                                        projectionCounts.safeJoinedPaths++;
                                        ScreenPoint start = joined.get(0).screen, end = joined.get(joined.size() - 1).screen;
                                        double chord = distance(start, end);
                                        if (chord < 24.0) { projectionCounts.rejectedShortChords++; continue; }
                                        projectionCounts.chordPasses++;
                                        double bend = 0.0;
                                        for (int i = 1; i < joined.size() - 1; i++)
                                            bend = Math.max(bend, pointSegmentDistance(joined.get(i).screen, start, end));
                                        if (bend < 5.0) { projectionCounts.rejectedFlatPaths++; continue; }
                                        projectionCounts.curvePasses++;
                                        double nodeGapCss = distance(firstNode.screen, secondNode.screen);
                                        double score = chord * Math.min(bend, 80.0) - nodeGapCss * 20.0;
                                        projectionCounts.connectedTargets++;
                                        if (best != null && score <= best.score) continue;
                                        RoadTarget target = new RoadTarget();
                                        target.lineHash = sha256(first.id); target.secondLineHash = sha256(second.id);
                                        target.lineIndex = first.lineIndex; target.secondLineIndex = second.lineIndex;
                                        target.startIndex = firstPath.get(0).sourceIndex;
                                        target.endIndex = secondPath.get(secondPath.size() - 1).sourceIndex;
                                        target.nodeIndex = firstPath.size() - 1; target.connectedLines = true;
                                        target.sameRoadName = !first.name.isEmpty() && first.name.equals(second.name);
                                        target.roadNamePresent = !first.name.isEmpty() || !second.name.isEmpty();
                                        target.differentRoadNamesAtConnection = !first.name.isEmpty() && !second.name.isEmpty() &&
                                            !first.name.equals(second.name);
                                        target.roadLevel = first.level;
                                        target.nodeGapMeters = nodeGapMeters; target.nodeGapCssPx = nodeGapCss;
                                        target.nodeTurnDegrees = turn;
                                        target.firstLineCoordinates = firstPath;
                                        target.secondLineCoordinates = secondPath;
                                        target.chordPx = chord; target.bendPx = bend; target.score = score;
                                        projectionCounts.recordSafePath(joined);
                                        target.vertices = joined; best = target;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        if (best != null) {
            long key = ((long)best.lineIndex << 32) | (best.secondLineIndex & 0xffffffffL);
            Set<Long> locations = sharedNodeLocations.get(key);
            best.featurePairSharedNodeCount = locations == null ? 1 : locations.size();
            best.groundMeshSamples = projectionCounts.meshAnchors;
            best.groundFallbackSamples = projectionCounts.fallbackAnchors;
            return best;
        }
        if (bestSingle != null) {
            projectionCounts.recordSafePath(bestSingle.vertices);
            bestSingle.groundMeshSamples = projectionCounts.meshAnchors;
            bestSingle.groundFallbackSamples = projectionCounts.fallbackAnchors;
        }
        return bestSingle;
    }

    private static long spatialCellKey(int x, int y) {
        return ((long)x << 32) | (y & 0xffffffffL);
    }

    private static String sourceEdgeKey(ProjectedVertex a, ProjectedVertex b) {
        String first = Long.toHexString(Double.doubleToLongBits(a.longitude)) + ":" +
            Long.toHexString(Double.doubleToLongBits(a.latitude));
        String second = Long.toHexString(Double.doubleToLongBits(b.longitude)) + ":" +
            Long.toHexString(Double.doubleToLongBits(b.latitude));
        return first.compareTo(second) <= 0 ? first + "|" + second : second + "|" + first;
    }

    private static boolean sourceEdgesUnique(List<ProjectedVertex> path, int lineIndex,
        Map<String, Set<Integer>> edgeOwners) {
        for (int i = 1; i < path.size(); i++) {
            Set<Integer> owners = edgeOwners.get(sourceEdgeKey(path.get(i - 1), path.get(i)));
            if (owners == null || owners.size() != 1 || !owners.contains(lineIndex)) return false;
        }
        return true;
    }

    private static boolean safePath(List<ProjectedVertex> path, double width, double height) {
        for (ProjectedVertex vertex : path) if (!safe(vertex.screen, width, height)) return false;
        return true;
    }

    private static List<ProjectedVertex> incomingSubpath(ProjectedRoadLine line, int nodeIndex, int direction, int length) {
        if (direction < 0) {
            int start = nodeIndex - length + 1;
            if (start < 0) return null;
            return new ArrayList<>(line.vertices.subList(start, nodeIndex + 1));
        }
        int end = nodeIndex + length;
        if (end > line.vertices.size()) return null;
        List<ProjectedVertex> path = new ArrayList<>(line.vertices.subList(nodeIndex, end));
        java.util.Collections.reverse(path);
        return path;
    }

    private static List<ProjectedVertex> outgoingSubpath(ProjectedRoadLine line, int nodeIndex, int direction, int length) {
        if (direction > 0) {
            int end = nodeIndex + length;
            if (end > line.vertices.size()) return null;
            return new ArrayList<>(line.vertices.subList(nodeIndex, end));
        }
        int start = nodeIndex - length + 1;
        if (start < 0) return null;
        List<ProjectedVertex> path = new ArrayList<>(line.vertices.subList(start, nodeIndex + 1));
        java.util.Collections.reverse(path);
        return path;
    }

    private static List<ProjectedVertex> oriented(List<ProjectedVertex> vertices, boolean reverse) {
        List<ProjectedVertex> out = new ArrayList<>(vertices);
        if (reverse) java.util.Collections.reverse(out);
        return out;
    }

    private static List<ScreenPoint> screens(List<ProjectedVertex> vertices) {
        List<ScreenPoint> out = new ArrayList<>(vertices.size());
        for (ProjectedVertex vertex : vertices) out.add(vertex.screen);
        return out;
    }

    private static JSONObject captureCssViewport(Native149Instrumentation parent, View mapView, double cssScale) throws Exception {
        String script = "(()=>{const e=document.querySelector('.map-canvas[data-native-map-id=\\\"main\\\"]'),r=e?.getBoundingClientRect();"
            + "return JSON.stringify({width:document.documentElement.clientWidth||innerWidth,height:document.documentElement.clientHeight||innerHeight,dpr:devicePixelRatio||1,mapRect:r?{x:r.x,y:r.y,width:r.width,height:r.height}:null})})()";
        JSONObject dom = new JSONObject(String.valueOf(call(parent, "evalJs", script)));
        JSONObject rect = dom.optJSONObject("mapRectCss");
        if (rect == null) rect = dom.optJSONObject("mapRect");
        if (rect == null) {
            Object entry = field(parent, "entry"), viewport = field(entry, "viewport");
            rect = viewport instanceof JSONObject ? ((JSONObject)viewport).optJSONObject("cssRect") : null;
        }
        return new JSONObject().put("cssViewport", new JSONObject()
                .put("width", dom.optDouble("width", 0.0)).put("height", dom.optDouble("height", 0.0))
                .put("devicePixelRatio", dom.optDouble("dpr", 0.0)))
            .put("mapRectCss", rect == null ? JSONObject.NULL : new JSONObject(rect.toString()))
            .put("mapViewPhysicalPx", new JSONArray().put(mapView.getWidth()).put(mapView.getHeight()))
            .put("cssToNativeScale", cssScale);
    }

    private static JSONObject buildReferenceFixture(String runId, JSONObject camera, JSONObject viewport,
        JSONObject initialProbe, boolean roadSnapping, List<ScreenPoint> aimPath, RoadTarget target,
        InputTrace anchorTrace, InputTrace continuationTrace, JSONArray snapStages, JSONObject finalState,
        JSONObject geometrySummary) throws Exception {
        return new JSONObject().put("schemaVersion", 1).put("qaRunId", runId)
            .put("providerPublicName", "OpenFreeMap")
            .put("roadLayerVisible", initialProbe.optBoolean("roadDisplayEnabled", false))
            .put("roadLayerVisibilityKnown", initialProbe.has("roadDisplayEnabled"))
            .put("roadSnappingEnabled", roadSnapping)
            .put("camera", cameraFixture(camera)).put("viewport", viewport)
            .put("target", targetFixture(target))
            .put("input", new JSONObject().put("anchorTap", anchorTrace.toJson("anchor-tap"))
                .put("continuation", continuationTrace.toJson("road-continuation")))
            .put("aimPathCss", screenPointsJson(aimPath))
            .put("snapStages", new JSONArray(snapStages.toString()))
            .put("continuationSnapStatusAudit", summarizeContinuationSnapStages(snapStages))
            .put("finalDraftGeometry", qaDraftGeometry(finalState))
            .put("sameRoadAndConnectionSummary", geometryFixture(geometrySummary));
    }

    private static JSONObject cameraFixture(JSONObject camera) throws Exception {
        JSONArray center = camera.optJSONArray("center");
        JSONObject out = new JSONObject().put("source", "map-camera-not-gps");
        if (center != null && center.length() >= 2)
            out.put("center", new JSONArray().put(center.optDouble(0, Double.NaN)).put(center.optDouble(1, Double.NaN)));
        for (String key : new String[]{"zoom", "pitch", "bearing"})
            if (camera.has(key)) out.put(key, camera.optDouble(key, Double.NaN));
        return out;
    }

    private static JSONObject targetFixture(RoadTarget target) throws Exception {
        JSONObject firstLine = new JSONObject().put("anonymousIdSha256", target.lineHash)
            .put("sourceFeatureIndex", target.lineIndex).put("sourceVertexStart", target.startIndex)
            .put("sourceVertexEnd", target.firstLineCoordinates.get(target.firstLineCoordinates.size() - 1).sourceIndex)
            .put("coordinates", coordinatesJson(target.firstLineCoordinates));
        JSONObject out = new JSONObject().put("coordinateOrder", "longitude-latitude-degrees")
            .put("kind", target.connectedLines ? "connected-two-feature-road-chain" : "single-feature-road-curve")
            .put("level", target.roadLevel).put("sameRoadName", target.sameRoadName)
            .put("roadNamePresent", target.roadNamePresent)
            .put("differentRoadNamesAtConnection", target.differentRoadNamesAtConnection)
            .put("nodeGapMeters", target.nodeGapMeters).put("nodeGapCssPx", target.nodeGapCssPx)
            .put("nodeTurnDegreesIncomingToOutgoing", target.nodeTurnDegrees)
            .put("featurePairSharedNodeCount", target.featurePairSharedNodeCount)
            .put("joinUsesOriginalVerticesOnly", true)
            .put("firstLine", firstLine);
        if (target.connectedLines) out.put("secondLine", new JSONObject().put("anonymousIdSha256", target.secondLineHash)
                .put("sourceFeatureIndex", target.secondLineIndex)
                .put("sourceVertexStart", target.secondLineCoordinates.get(0).sourceIndex)
                .put("sourceVertexEnd", target.endIndex)
                .put("coordinates", coordinatesJson(target.secondLineCoordinates)));
        else out.put("secondLine", JSONObject.NULL).put("singleLineTarget", true);
        return out;
    }

    private static JSONArray coordinatesJson(List<ProjectedVertex> vertices) throws Exception {
        JSONArray coordinates = new JSONArray();
        if (vertices != null) for (ProjectedVertex vertex : vertices)
            coordinates.put(new JSONArray().put(vertex.longitude).put(vertex.latitude));
        return coordinates;
    }

    private static JSONArray screenPointsJson(List<ScreenPoint> points) throws Exception {
        JSONArray out = new JSONArray();
        for (ScreenPoint point : points) out.put(new JSONArray().put(point.x).put(point.y));
        return out;
    }

    private static JSONObject readPointSnapOutcome(Native149Instrumentation parent) throws Exception {
        final String pendingDefaultHint = "准星定点 · 松手连接 · 双指控图";
        final long startedAt = SystemClock.uptimeMillis();
        String hint = "";
        String lastRecordedHint = null;
        JSONArray hintSamples = new JSONArray();
        long elapsed;
        do {
            Object value = call(parent, "evalJs", "(()=>{const e=document.querySelector('.track-draw-hint');if(!e)return '';const s=getComputedStyle(e),r=e.getBoundingClientRect();if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0||r.width<=0||r.height<=0)return '';return(e.textContent||'').trim()})()");
            hint = value == null ? "" : String.valueOf(value).trim();
            elapsed = SystemClock.uptimeMillis() - startedAt;
            if (!hint.equals(lastRecordedHint)) {
                hintSamples.put(new JSONObject().put("elapsedMs", Math.min(elapsed, 1_000L))
                    .put("rawHint", hint).put("visible", !hint.isEmpty()));
                lastRecordedHint = hint;
            }
            boolean pending = hint.isEmpty() || pendingDefaultHint.equals(hint);
            if (!pending || elapsed >= 1_000L) break;
            SystemClock.sleep(25L);
        } while (true);
        String outcome = "unknown";
        if (hint.contains("吸附计算受限")) outcome = "limited";
        else if (hint.contains("不连通")) outcome = "disconnected";
        else if (hint.contains("跨越断路") || hint.contains("直线跨越") || hint.contains("跨越")) outcome = "crossing";
        else if (hint.contains("数据加载中")) outcome = "loading";
        else if (hint.contains("数据不可用")) outcome = "unavailable";
        else if (hint.contains("附近没有")) outcome = "no-match";
        else if (hint.contains("吸附已关闭")) outcome = "hidden";
        else if (hint.contains("已吸附道路") || hint.contains("整段沿道路连接")) outcome = "ready";
        else if (hint.contains("已吸附节点")) outcome = "node";
        return new JSONObject().put("snapOutcome", outcome).put("snapHintRaw", hint)
            .put("snapHintVisible", !hint.isEmpty()).put("snapHintWaitMs", Math.min(elapsed, 1_000L))
            .put("snapHintSamples", hintSamples);
    }

    private static JSONObject snapStage(String name, JSONObject probe) throws Exception {
        String oldHint = probe.optString("hintKind", "unknown");
        String outcome = "limited".equals(oldHint) || "disconnected".equals(oldHint) || "crossing".equals(oldHint) ||
            "loading".equals(oldHint) || "no-match".equals(oldHint) ? oldHint : "unknown";
        return snapStage(name, probe, outcome);
    }

    private static JSONObject snapStage(String name, JSONObject probe, String snapOutcome) throws Exception {
        return new JSONObject().put("stage", name)
            .put("snapHintStatus", probe.optString("hintKind", "unknown"))
            .put("snapOutcome", snapOutcome == null ? "unknown" : snapOutcome)
            .put("snapOutcomeCapturedDuringAim", true)
            .put("draftPointCount", probe.optInt("draftPoints", -1))
            .put("roadSnapshotStatus", probe.optString("roadSnapshotStatus", "unknown"))
            .put("roadSnapshotLineCount", probe.optInt("roadSnapshotLineCount", -1));
    }

    private static JSONObject snapStage(String name, JSONObject probe, JSONObject snapEvidence) throws Exception {
        JSONObject stage = snapStage(name, probe, snapEvidence.optString("snapOutcome", "unknown"));
        stage.put("snapHintRaw", snapEvidence.optString("snapHintRaw", ""))
            .put("snapHintVisible", snapEvidence.optBoolean("snapHintVisible"))
            .put("snapHintWaitMs", snapEvidence.optLong("snapHintWaitMs", 0L))
            .put("snapHintSamples", snapEvidence.optJSONArray("snapHintSamples") == null
                ? new JSONArray() : snapEvidence.optJSONArray("snapHintSamples"));
        return stage;
    }

    private static JSONObject summarizeContinuationSnapStages(JSONArray stages) throws Exception {
        JSONObject counts = new JSONObject(), rejectedCounts = new JSONObject();
        int continuationCount = 0, unresolved = 0;
        for (int i = 0; i < stages.length(); i++) {
            JSONObject stage = stages.optJSONObject(i);
            if (stage == null || !stage.optString("stage", "").startsWith("continuation-point-")) continue;
            continuationCount++;
            String outcome = stage.optString("snapOutcome", "unknown");
            counts.put(outcome, counts.optInt(outcome) + 1);
            if (!"ready".equals(outcome) && !"node".equals(outcome)) {
                unresolved++;
                rejectedCounts.put(outcome, rejectedCounts.optInt(outcome) + 1);
            }
        }
        return new JSONObject().put("continuationStageCount", continuationCount)
            .put("outcomeCounts", counts).put("rejectedOutcomeCounts", rejectedCounts)
            .put("unresolvedContinuationStageCount", unresolved)
            .put("allContinuationStagesAccepted", continuationCount > 0 && unresolved == 0)
            .put("allContinuationStagesRoadReady", continuationCount > 0 && unresolved == 0 && counts.optInt("node") == 0);
    }

    private static JSONArray qaDraftGeometry(JSONObject state) throws Exception {
        JSONObject overlay = state.optJSONObject("trackOverlay");
        JSONArray draft = overlay == null ? null : overlay.optJSONArray("draft");
        JSONArray safeSegments = new JSONArray();
        int count = 0;
        if (draft != null) for (int i = 0; i < draft.length(); i++) {
            JSONArray segment = draft.optJSONArray(i), safeSegment = new JSONArray();
            if (segment != null) for (int j = 0; j < segment.length(); j++) {
                JSONArray point = segment.optJSONArray(j);
                if (point == null || point.length() < 2) continue;
                double lon = point.optDouble(0, Double.NaN), lat = point.optDouble(1, Double.NaN);
                if (Double.isFinite(lon) && Double.isFinite(lat)) {
                    safeSegment.put(new JSONArray().put(lon).put(lat));
                    if (++count > MAX_SOURCE_POINTS) throw new IllegalStateException("qa-draft-fixture-point-limit-exceeded");
                }
            }
            safeSegments.put(safeSegment);
        }
        return new JSONArray().put(new JSONObject().put("type", "LineStringSegments")
            .put("coordinateOrder", "longitude-latitude-degrees").put("segments", safeSegments).put("pointCount", count));
    }

    private static JSONObject geometryFixture(JSONObject source) throws Exception {
        String[] keys = {"sameRoadWithinReleaseRadius", "maxDeviationFromSelectedSameRoadCssPx", "retainsCurve",
            "exactTargetPathToleranceCssPx", "exactTargetPathWithinTolerance", "draftStartEndpointDistanceCssPx",
            "draftEndEndpointDistanceCssPx", "draftStartEndpointGroundDistanceMeters", "draftEndEndpointGroundDistanceMeters",
            "draftStartCommittedAtTarget", "draftEndCommittedAtTarget", "targetEndpointToleranceCssPx",
            "draftCoordinateCount", "allDraftVerticesGroundProjected",
            "sourcePathLengthMeters", "draftPathLengthMeters", "draftToSourcePathLengthRatio", "maxAllowedPathLengthRatio",
            "routeLengthWithinBudget", "sourceProgressStartMeters", "sourceProgressEndMeters", "sourceProgressBacktrackThresholdMeters",
            "sourceProgressBacktrackCount", "maxSourceProgressBacktrackMeters", "sourceProgressMonotonic", "maxCrossTrackFromSourceMeters",
            "draftSegmentGapMeters", "maxDraftSegmentGapMeters",
            "maxDeviationFromEndpointChordCssPx", "connectedNodeWithinReleaseRadius", "nearestConnectedNodeDraftDistanceCssPx",
            "firstLineDraftPoints", "secondLineDraftPoints", "sameNativeRoadSnapshotChain", "sameRoadName",
            "roadNamePresent", "differentRoadNamesAtConnection", "matchingRoadLevel", "freshDownAfterMultitouch"};
        JSONObject out = new JSONObject();
        for (String key : keys) if (source.has(key)) out.put(key, source.opt(key));
        return out;
    }

    private static void writeReferenceFixture(File evidence, JSONObject fixture) throws Exception {
        File file = new File(evidence, "reference-fixture.json");
        try (FileOutputStream output = new FileOutputStream(file)) {
            output.write(fixture.toString(2).getBytes("UTF-8"));
        }
    }

    /** Writes only ready public road geometry for offline connected-chain selection. */
    private static void writeReadyRoadSnapshotGeoJson(File evidence, JSONObject payload) throws Exception {
        JSONObject road = payload == null ? null : payload.optJSONObject("road");
        JSONArray lines = road == null ? null : road.optJSONArray("lines");
        if (!"ready".equals(roadStatus(payload)) || lines == null)
            throw new IllegalStateException("ready-road-snapshot-unavailable");
        JSONArray features = new JSONArray();
        for (int lineIndex = 0; lineIndex < lines.length(); lineIndex++) {
            JSONObject line = lines.optJSONObject(lineIndex);
            JSONArray sourceCoordinates = line == null ? null : line.optJSONArray("coordinates");
            if (sourceCoordinates == null || sourceCoordinates.length() < 2) continue;
            JSONArray coordinates = new JSONArray();
            boolean valid = true;
            for (int vertexIndex = 0; vertexIndex < sourceCoordinates.length(); vertexIndex++) {
                JSONArray sourceCoordinate = sourceCoordinates.optJSONArray(vertexIndex);
                if (sourceCoordinate == null || sourceCoordinate.length() < 2) { valid = false; break; }
                double longitude = sourceCoordinate.optDouble(0, Double.NaN);
                double latitude = sourceCoordinate.optDouble(1, Double.NaN);
                if (!Double.isFinite(longitude) || !Double.isFinite(latitude)) { valid = false; break; }
                coordinates.put(new JSONArray().put(longitude).put(latitude));
            }
            if (!valid) continue;
            JSONObject properties = new JSONObject()
                .put("lineIdSha256", sha256(line.optString("id", "line-" + lineIndex)))
                .put("lineIndex", lineIndex)
                .put("level", line.optInt("level", -1))
                .put("name", line.optString("name", ""));
            features.put(new JSONObject().put("type", "Feature")
                .put("properties", properties)
                .put("geometry", new JSONObject().put("type", "LineString").put("coordinates", coordinates)));
        }
        JSONObject collection = new JSONObject().put("type", "FeatureCollection")
            .put("features", features);
        File file = new File(evidence, "ready-road-snapshot.geojson");
        try (FileOutputStream output = new FileOutputStream(file)) {
            output.write(collection.toString().getBytes("UTF-8"));
        }
    }

    private static String actionName(int action) {
        if (action == MotionEvent.ACTION_DOWN) return "DOWN";
        if (action == MotionEvent.ACTION_MOVE) return "MOVE";
        if (action == MotionEvent.ACTION_UP) return "UP";
        if (action == MotionEvent.ACTION_CANCEL) return "CANCEL";
        return "OTHER";
    }

    private static double geodesicDistanceMeters(double latitudeA, double longitudeA, double latitudeB, double longitudeB) {
        double latA = Math.toRadians(latitudeA), latB = Math.toRadians(latitudeB);
        double dLat = latB - latA, dLon = Math.toRadians(longitudeB - longitudeA);
        double sinLat = Math.sin(dLat * 0.5), sinLon = Math.sin(dLon * 0.5);
        double h = sinLat * sinLat + Math.cos(latA) * Math.cos(latB) * sinLon * sinLon;
        return 2.0 * 6371008.8 * Math.asin(Math.sqrt(Math.max(0.0, Math.min(1.0, h))));
    }

    private static SourceProgress nearestSourceProgress(double pointX, double pointY,
        double[] sourceX, double[] sourceY, double[] sourceCumulative) {
        if (sourceX.length == 0) return new SourceProgress(Double.NaN, Double.POSITIVE_INFINITY);
        if (sourceX.length == 1) return new SourceProgress(0.0,
            Math.hypot(pointX - sourceX[0], pointY - sourceY[0]));
        double bestDistanceSquared = Double.POSITIVE_INFINITY;
        double bestProgress = 0.0;
        for (int i = 1; i < sourceX.length; i++) {
            double ax = sourceX[i - 1], ay = sourceY[i - 1];
            double dx = sourceX[i] - ax, dy = sourceY[i] - ay;
            double lengthSquared = dx * dx + dy * dy;
            double t = lengthSquared <= 1e-12 ? 0.0 :
                Math.max(0.0, Math.min(1.0, ((pointX - ax) * dx + (pointY - ay) * dy) / lengthSquared));
            double offsetX = pointX - (ax + t * dx), offsetY = pointY - (ay + t * dy);
            double distanceSquared = offsetX * offsetX + offsetY * offsetY;
            if (distanceSquared < bestDistanceSquared) {
                bestDistanceSquared = distanceSquared;
                double segmentLength = Math.sqrt(lengthSquared);
                bestProgress = sourceCumulative[i - 1] + segmentLength * t;
            }
        }
        return new SourceProgress(bestProgress, Math.sqrt(bestDistanceSquared));
    }

    private static double turnDegrees(ScreenPoint before, ScreenPoint node, ScreenPoint after) {
        double ax = node.x - before.x, ay = node.y - before.y;
        double bx = after.x - node.x, by = after.y - node.y;
        double lengths = Math.hypot(ax, ay) * Math.hypot(bx, by);
        if (lengths <= 1e-9) return Double.NaN;
        double cosine = Math.max(-1.0, Math.min(1.0, (ax * bx + ay * by) / lengths));
        return Math.toDegrees(Math.acos(cosine));
    }

    private static JSONObject verifyBridgeGroundProjection(Native149Instrumentation parent, View view, double cssScale, List<ScreenPoint> aims) throws Exception {
        Object controller = field(field(parent, "entry"), "controller");
        Method unproject = findMethod(controller.getClass(), "unprojectCoordinate", 2);
        unproject.setAccessible(true);
        final double[] maxError = {0}; final int[] valid = {0};
        GroundProjectionCounts counts = new GroundProjectionCounts();
        AtomicHolder<GroundProjectionContext> projection = new AtomicHolder<>();
        parent.runOnMainSync(() -> {
            try { projection.value = createGroundProjectionContext(parent, counts); }
            catch (Throwable failure) { counts.failureStage = "projection-context"; counts.failureType = failure.getClass().getSimpleName(); }
            for (ScreenPoint aim : aims) {
                try {
                    if (projection.value == null) continue;
                    Object pair = unproject.invoke(controller, (float)(aim.x * cssScale), (float)(aim.y * cssScale));
                    if (pair == null) continue;
                    double lat = ((Number)pairNumber(pair, "first", "getFirst")).doubleValue();
                    double lon = ((Number)pairNumber(pair, "second", "getSecond")).doubleValue();
                    if (!Double.isFinite(lat) || !Double.isFinite(lon)) continue;
                    ScreenPoint roundTrip = projectRenderedGroundCss(projection.value, lat, lon, cssScale, counts);
                    if (roundTrip == null) continue;
                    valid[0]++; maxError[0] = Math.max(maxError[0], distance(aim, roundTrip));
                } catch (Throwable ignored) { }
            }
        });
        return new JSONObject().put("sampleCount", aims.size()).put("finiteRoundTrips", valid[0])
            .put("allFinite", valid[0] == aims.size()).put("maxRoundTripCssPx", valid[0] == 0 ? JSONObject.NULL : maxError[0])
            .put("projectionApi", "NativeController.unprojectCoordinate+WorldWind-rendered-terrain-surface")
            .put("renderedTerrainMeshSamples", counts.meshAnchors).put("clampToGroundElevationFallbackSamples", counts.fallbackAnchors)
            .put("projectionFailureStage", counts.failureStage).put("projectionFailureType", counts.failureType);
    }

    private static JSONObject analyzeDraftAgainstTarget(Native149Instrumentation parent, JSONObject state, RoadTarget target, double cssScale) throws Exception {
        JSONObject overlay = state.optJSONObject("trackOverlay");
        JSONArray draft = overlay == null ? null : overlay.optJSONArray("draft");
        if (draft == null) return new JSONObject().put("sameRoadWithinReleaseRadius", false).put("retainsCurve", false).put("draftPointCount", 0);
        List<double[]> draftCoordinates = new ArrayList<>();
        double draftPathLengthMeters = 0.0, totalSegmentGapMeters = 0.0, maxSegmentGapMeters = 0.0;
        double[] previousSegmentEnd = null;
        int draftSegmentCount = 0;
        for (int i = 0; i < draft.length(); i++) {
            JSONArray segment = draft.optJSONArray(i);
            if (segment == null || segment.length() == 0) continue;
            double[] previous = null;
            double[] first = null;
            for (int j = 0; j < segment.length(); j++) {
                JSONArray coordinate = segment.optJSONArray(j);
                if (coordinate == null || coordinate.length() < 2) continue;
                double longitude = coordinate.optDouble(0, Double.NaN), latitude = coordinate.optDouble(1, Double.NaN);
                if (!Double.isFinite(longitude) || !Double.isFinite(latitude)) continue;
                double[] current = {longitude, latitude};
                if (first == null) first = current;
                if (previous != null) draftPathLengthMeters += geodesicDistanceMeters(previous[1], previous[0], current[1], current[0]);
                draftCoordinates.add(current);
                previous = current;
            }
            if (first != null && previous != null) {
                if (previousSegmentEnd != null) {
                    double gap = geodesicDistanceMeters(previousSegmentEnd[1], previousSegmentEnd[0], first[1], first[0]);
                    totalSegmentGapMeters += gap;
                    maxSegmentGapMeters = Math.max(maxSegmentGapMeters, gap);
                }
                previousSegmentEnd = previous;
                draftSegmentCount++;
            }
        }

        int sourceCount = target.vertices.size();
        double sourcePathLengthMeters = 0.0;
        double sourceReferenceLatitude = 0.0;
        double sourceReferenceLongitude = sourceCount == 0 ? 0.0 : target.vertices.get(0).longitude;
        for (ProjectedVertex vertex : target.vertices) sourceReferenceLatitude += vertex.latitude;
        if (sourceCount > 0) sourceReferenceLatitude /= sourceCount;
        double[] sourceX = new double[sourceCount], sourceY = new double[sourceCount], sourceCumulative = new double[sourceCount];
        double latitudeCosine = Math.cos(Math.toRadians(sourceReferenceLatitude));
        for (int i = 0; i < sourceCount; i++) {
            ProjectedVertex vertex = target.vertices.get(i);
            sourceX[i] = Math.toRadians(vertex.longitude - sourceReferenceLongitude) * 6371008.8 * latitudeCosine;
            sourceY[i] = Math.toRadians(vertex.latitude - sourceReferenceLatitude) * 6371008.8;
            if (i > 0) {
                ProjectedVertex previous = target.vertices.get(i - 1);
                sourcePathLengthMeters += geodesicDistanceMeters(previous.latitude, previous.longitude, vertex.latitude, vertex.longitude);
                sourceCumulative[i] = sourcePathLengthMeters;
            }
        }
        int sourceBacktrackCount = 0;
        double maxSourceBacktrackMeters = 0.0, maxSourceOffsetMeters = 0.0;
        double firstSourceProgressMeters = Double.NaN, lastSourceProgressMeters = Double.NaN;
        double previousSourceProgress = Double.NaN;
        double[] draftProgress = new double[draftCoordinates.size()];
        for (int i = 0; i < draftCoordinates.size(); i++) {
            double[] coordinate = draftCoordinates.get(i);
            double pointX = Math.toRadians(coordinate[0] - sourceReferenceLongitude) * 6371008.8 * latitudeCosine;
            double pointY = Math.toRadians(coordinate[1] - sourceReferenceLatitude) * 6371008.8;
            SourceProgress progress = nearestSourceProgress(pointX, pointY, sourceX, sourceY, sourceCumulative);
            draftProgress[i] = progress.distanceMeters;
            maxSourceOffsetMeters = Math.max(maxSourceOffsetMeters, progress.offsetMeters);
            if (Double.isNaN(firstSourceProgressMeters)) firstSourceProgressMeters = progress.distanceMeters;
            if (!Double.isNaN(previousSourceProgress)) {
                double delta = progress.distanceMeters - previousSourceProgress;
                if (delta < -MAX_SOURCE_PROGRESS_BACKTRACK_METERS) {
                    sourceBacktrackCount++;
                    maxSourceBacktrackMeters = Math.max(maxSourceBacktrackMeters, -delta);
                }
            }
            previousSourceProgress = progress.distanceMeters;
            lastSourceProgressMeters = progress.distanceMeters;
        }
        double routeLengthRatio = sourcePathLengthMeters > 0.0 ? draftPathLengthMeters / sourcePathLengthMeters : Double.POSITIVE_INFINITY;
        double startEndpointGroundDistanceMeters = draftCoordinates.isEmpty() || sourceCount == 0 ? Double.POSITIVE_INFINITY :
            geodesicDistanceMeters(draftCoordinates.get(0)[1], draftCoordinates.get(0)[0],
                target.vertices.get(0).latitude, target.vertices.get(0).longitude);
        double endEndpointGroundDistanceMeters = draftCoordinates.isEmpty() || sourceCount == 0 ? Double.POSITIVE_INFINITY :
            geodesicDistanceMeters(draftCoordinates.get(draftCoordinates.size() - 1)[1], draftCoordinates.get(draftCoordinates.size() - 1)[0],
                target.vertices.get(sourceCount - 1).latitude, target.vertices.get(sourceCount - 1).longitude);
        final double[] maxRoadDistance = {0}, maxChordDeviation = {0}, nearestNodeDistance = {Double.POSITIVE_INFINITY};
        final int[] count = {0}, firstLineCount = {0}, secondLineCount = {0};
        final ScreenPoint[] firstDraftScreen = {null}, lastDraftScreen = {null};
        ScreenPoint start = target.vertices.get(0).screen, end = target.vertices.get(target.vertices.size() - 1).screen;
        parent.runOnMainSync(() -> {
            GroundProjectionCounts projectionCounts = new GroundProjectionCounts();
            GroundProjectionContext projection = null;
            try { projection = createGroundProjectionContext(parent, projectionCounts); }
            catch (Throwable ignored) { }
            for (int i = 0; i < draft.length(); i++) {
                JSONArray segment = draft.optJSONArray(i); if (segment == null) continue;
                for (int j = 0; j < segment.length(); j++) {
                    JSONArray coordinate = segment.optJSONArray(j); if (coordinate == null || coordinate.length() < 2) continue;
                    if (projection == null) continue;
                    ScreenPoint screen = projectRenderedGroundCss(projection, coordinate.optDouble(1, Double.NaN), coordinate.optDouble(0, Double.NaN), cssScale, projectionCounts);
                    if (screen == null) continue;
                    if (firstDraftScreen[0] == null) firstDraftScreen[0] = screen;
                    lastDraftScreen[0] = screen;
                    count[0]++;
                    double nearest = Double.POSITIVE_INFINITY;
                    int nearestSegment = -1;
                    for (int k = 1; k < target.vertices.size(); k++) {
                        double distance = pointSegmentDistance(screen, target.vertices.get(k - 1).screen, target.vertices.get(k).screen);
                        if (distance < nearest) { nearest = distance; nearestSegment = k - 1; }
                    }
                    if (nearestSegment >= 0 && nearestSegment < target.nodeIndex) firstLineCount[0]++;
                    else if (nearestSegment >= target.nodeIndex) secondLineCount[0]++;
                    double anchorDistance = target.connectedLines
                        ? Math.min(distance(screen, target.firstLineCoordinates.get(target.firstLineCoordinates.size() - 1).screen),
                            distance(screen, target.secondLineCoordinates.get(0).screen))
                        : distance(screen, target.vertices.get(target.nodeIndex).screen);
                    nearestNodeDistance[0] = Math.min(nearestNodeDistance[0], anchorDistance);
                    maxRoadDistance[0] = Math.max(maxRoadDistance[0], nearest);
                    maxChordDeviation[0] = Math.max(maxChordDeviation[0], pointSegmentDistance(screen, start, end));
                }
            }
        });
        double startEndpointCssDistance = firstDraftScreen[0] == null ? Double.POSITIVE_INFINITY : distance(firstDraftScreen[0], start);
        double endEndpointCssDistance = lastDraftScreen[0] == null ? Double.POSITIVE_INFINITY : distance(lastDraftScreen[0], end);
        boolean exactTargetPathWithinTolerance = count[0] >= 3 && maxRoadDistance[0] <= TARGET_PATH_TOLERANCE_CSS;
        boolean allDraftVerticesProjected = count[0] == draftCoordinates.size() && count[0] > 0;
        boolean draftStartCommittedAtTarget = allDraftVerticesProjected && startEndpointCssDistance <= TARGET_ENDPOINT_TOLERANCE_CSS;
        boolean draftEndCommittedAtTarget = allDraftVerticesProjected && endEndpointCssDistance <= TARGET_ENDPOINT_TOLERANCE_CSS;
        boolean sourceProgressMonotonic = sourceBacktrackCount == 0;
        boolean routeLengthWithinBudget = Double.isFinite(routeLengthRatio) && routeLengthRatio <= MAX_TARGET_PATH_LENGTH_RATIO;
        return new JSONObject().put("draftPointCount", count[0]).put("draftCoordinateCount", draftCoordinates.size())
            .put("allDraftVerticesGroundProjected", allDraftVerticesProjected).put("draftSegmentCount", draftSegmentCount)
            .put("maxDeviationFromSelectedSameRoadCssPx", count[0] == 0 ? JSONObject.NULL : maxRoadDistance[0])
            .put("sameRoadWithinReleaseRadius", count[0] >= 3 && maxRoadDistance[0] <= ROAD_RELEASE_CSS)
            .put("exactTargetPathToleranceCssPx", TARGET_PATH_TOLERANCE_CSS)
            .put("exactTargetPathWithinTolerance", exactTargetPathWithinTolerance)
            .put("draftStartEndpointDistanceCssPx", Double.isFinite(startEndpointCssDistance) ? startEndpointCssDistance : JSONObject.NULL)
            .put("draftEndEndpointDistanceCssPx", Double.isFinite(endEndpointCssDistance) ? endEndpointCssDistance : JSONObject.NULL)
            .put("draftStartEndpointGroundDistanceMeters", Double.isFinite(startEndpointGroundDistanceMeters) ? startEndpointGroundDistanceMeters : JSONObject.NULL)
            .put("draftEndEndpointGroundDistanceMeters", Double.isFinite(endEndpointGroundDistanceMeters) ? endEndpointGroundDistanceMeters : JSONObject.NULL)
            .put("draftStartCommittedAtTarget", draftStartCommittedAtTarget).put("draftEndCommittedAtTarget", draftEndCommittedAtTarget)
            .put("targetEndpointToleranceCssPx", TARGET_ENDPOINT_TOLERANCE_CSS)
            .put("maxDeviationFromEndpointChordCssPx", count[0] == 0 ? JSONObject.NULL : maxChordDeviation[0])
            .put("retainsCurve", count[0] >= 3 && maxChordDeviation[0] >= Math.min(4.0, target.bendPx * 0.5))
            .put("sourcePathLengthMeters", sourcePathLengthMeters).put("draftPathLengthMeters", draftPathLengthMeters)
            .put("draftToSourcePathLengthRatio", Double.isFinite(routeLengthRatio) ? routeLengthRatio : JSONObject.NULL)
            .put("maxAllowedPathLengthRatio", MAX_TARGET_PATH_LENGTH_RATIO).put("routeLengthWithinBudget", routeLengthWithinBudget)
            .put("sourceProgressStartMeters", Double.isFinite(firstSourceProgressMeters) ? firstSourceProgressMeters : JSONObject.NULL)
            .put("sourceProgressEndMeters", Double.isFinite(lastSourceProgressMeters) ? lastSourceProgressMeters : JSONObject.NULL)
            .put("sourceProgressBacktrackThresholdMeters", MAX_SOURCE_PROGRESS_BACKTRACK_METERS)
            .put("sourceProgressBacktrackCount", sourceBacktrackCount).put("maxSourceProgressBacktrackMeters", maxSourceBacktrackMeters)
            .put("sourceProgressMonotonic", sourceProgressMonotonic).put("maxCrossTrackFromSourceMeters", maxSourceOffsetMeters)
            .put("draftSegmentGapMeters", totalSegmentGapMeters).put("maxDraftSegmentGapMeters", maxSegmentGapMeters)
            .put("sameSourceLineAnchored", !target.connectedLines).put("sameNativeRoadSnapshotChain",
                target.connectedLines && target.lineHash != null && target.secondLineHash != null &&
                    !target.lineHash.equals(target.secondLineHash) && target.roadLevel >= 0 &&
                    target.nodeGapMeters <= MAX_NODE_GAP_METERS)
            .put("sameRoadName", target.sameRoadName).put("roadNamePresent", target.roadNamePresent)
            .put("differentRoadNamesAtConnection", target.differentRoadNamesAtConnection)
            .put("matchingRoadLevel", target.roadLevel)
            .put("connectedNodeWithinReleaseRadius", target.connectedLines && count[0] > 0 && nearestNodeDistance[0] <= ROAD_RELEASE_CSS)
            .put("nearestConnectedNodeDraftDistanceCssPx", Double.isFinite(nearestNodeDistance[0]) ? nearestNodeDistance[0] : JSONObject.NULL)
            .put("firstLineDraftPoints", firstLineCount[0]).put("secondLineDraftPoints", secondLineCount[0])
            .put("sourceVertexCount", target.vertices.size());
    }

    private static JSONObject clearQaDraft(Native149Instrumentation parent, double cssScale, int initialSavedTracks) throws Exception {
        JSONObject initialProbe = (JSONObject)call(parent, "inspectDrawingMagnifier");
        int initialDraftPoints = initialProbe.optInt("draftPoints", -1);
        if (initialDraftPoints < 0 || initialProbe.optInt("savedTrackCount", -1) != initialSavedTracks)
            throw new IllegalStateException("qa-draft-cleanup-precondition-unavailable");
        JSONArray history = new JSONArray();
        int currentDraftPoints = initialDraftPoints;
        int undoTaps = 0;
        while (currentDraftPoints > 0) {
            if (undoTaps >= initialDraftPoints)
                throw new IllegalStateException("qa-draft-undo-budget-exhausted:" + currentDraftPoints);
            JSONObject beforeProbe = (JSONObject)call(parent, "inspectDrawingMagnifier");
            int before = beforeProbe.optInt("draftPoints", -1);
            if (before < 0 || before > currentDraftPoints || beforeProbe.optInt("savedTrackCount", -1) != initialSavedTracks)
                throw new IllegalStateException("qa-draft-undo-state-changed:" + before);
            if (before == 0) { currentDraftPoints = 0; break; }
            JSONObject undoButton = (JSONObject)call(parent, "tapDomButton", "button", "撤销", cssScale);
            undoTaps++;
            long deadline = SystemClock.elapsedRealtime() + 2_000L;
            JSONObject afterProbe = beforeProbe;
            int after = before;
            while (SystemClock.elapsedRealtime() < deadline) {
                afterProbe = (JSONObject)call(parent, "inspectDrawingMagnifier");
                after = afterProbe.optInt("draftPoints", -1);
                if (after < before || after < 0 || afterProbe.optInt("savedTrackCount", -1) != initialSavedTracks) break;
                SystemClock.sleep(80L);
            }
            if (after < 0 || after >= before || afterProbe.optInt("savedTrackCount", -1) != initialSavedTracks)
                throw new IllegalStateException("qa-draft-undo-did-not-decrease:" + before + ":" + after);
            history.put(new JSONObject().put("method", "real-ui-undo")
                .put("beforeDraftPoints", before).put("afterDraftPoints", after)
                .put("buttonHitTested", undoButton.optBoolean("hit"))
                .put("savedTracksUnchanged", afterProbe.optInt("savedTrackCount", -1) == initialSavedTracks));
            currentDraftPoints = after;
        }
        JSONObject finalProbe = (JSONObject)call(parent, "inspectDrawingMagnifier");
        int finalDraftPoints = finalProbe.optInt("draftPoints", -1);
        int finalSavedTracks = finalProbe.optInt("savedTrackCount", -1);
        if (finalDraftPoints != 0 || finalSavedTracks != initialSavedTracks)
            throw new IllegalStateException("qa-draft-cleanup-did-not-settle:" + finalDraftPoints);
        return new JSONObject().put("status", initialDraftPoints == 0 ? "QA_DRAFT_ALREADY_EMPTY" : "QA_ONLY_DRAFT_CLEARED_BY_REAL_UI_UNDO")
            .put("method", "real-ui-undo").put("initialDraftPoints", initialDraftPoints)
            .put("finalDraftPoints", finalDraftPoints).put("savedTracksBefore", initialSavedTracks)
            .put("savedTracksAfter", finalSavedTracks).put("undoTaps", undoTaps).put("history", history);
    }

    private static int awaitDraftPoints(Native149Instrumentation parent, int minimum, long timeout) throws Exception {
        long end = SystemClock.elapsedRealtime() + timeout; int last = -1;
        while (SystemClock.elapsedRealtime() < end) {
            JSONObject probe = (JSONObject)call(parent, "inspectDrawingMagnifier");
            last = probe.optInt("draftPoints", -1);
            if (last >= minimum) return last;
            SystemClock.sleep(90L);
        }
        return last;
    }

    private static JSONObject awaitDrawingProbe(Native149Instrumentation parent, int minimumDraftPoints, long timeout) throws Exception {
        long end = SystemClock.elapsedRealtime() + timeout; JSONObject last = new JSONObject();
        while (SystemClock.elapsedRealtime() < end) {
            last = (JSONObject)call(parent, "inspectDrawingMagnifier");
            if (last.optInt("draftPoints", -1) >= minimumDraftPoints) return last;
            SystemClock.sleep(100L);
        }
        return last;
    }

    private static List<ScreenPoint> evenlySample(List<ScreenPoint> points, int max) {
        List<ScreenPoint> out = new ArrayList<>();
        if (points.size() <= max) return points;
        for (int i = 0; i < max; i++) out.add(points.get((int)Math.round((double)i * (points.size() - 1) / (max - 1))));
        return out;
    }

    private static ScreenPoint projectCss(Object controller, Method project, double lat, double lon, double scale) {
        if (!Double.isFinite(lat) || !Double.isFinite(lon)) return null;
        try {
            Object pair = project.invoke(controller, lat, lon);
            if (pair == null) return null;
            double x = ((Number)pairNumber(pair, "first", "getFirst")).doubleValue() / scale;
            double y = ((Number)pairNumber(pair, "second", "getSecond")).doubleValue() / scale;
            return Double.isFinite(x) && Double.isFinite(y) ? new ScreenPoint(x, y) : null;
        } catch (Throwable ignored) { return null; }
    }

    /** Captures one current SDK terrain holder, the published row-major MVP, and viewport. */
    private static GroundProjectionContext createGroundProjectionContext(Native149Instrumentation parent,
        GroundProjectionCounts counts) throws Exception {
        Object controller = field(field(parent, "entry"), "controller");
        Object worldWindow = field(controller, "worldWindow");
        Object engine = field(worldWindow, "engine");
        Object frameController = field(engine, "frameController");
        ClassLoader loader = engine.getClass().getClassLoader();
        Class<?> vec3Class = Class.forName("earth.worldwind.geom.Vec3", false, loader);
        Object terrainMap = findRenderedTerrainMap(frameController, vec3Class, counts);
        if (!(terrainMap instanceof Map)) {
            if (counts != null) counts.failureStage = "terrain-map-unavailable";
            return null;
        }
        double[] mvp = copyMatrix(field(controller, "lastBridgeFrameMatrix"));
        if (mvp == null || mvp.length != 16 || !finite(mvp)) {
            if (counts != null) counts.failureStage = "published-mvp-unavailable";
            return null;
        }
        int[] viewport = viewport(field(engine, "viewport"));
        if (viewport[2] <= 0 || viewport[3] <= 0) {
            if (counts != null) counts.failureStage = "viewport-unavailable";
            return null;
        }
        return new GroundProjectionContext(engine, field(engine, "globe"), terrainMap, vec3Class, mvp, viewport);
    }

    /** Uses the rendered mesh anchor and SDK row-major MVP projection, with exact SDK clip rules. */
    private static ScreenPoint projectRenderedGroundCss(GroundProjectionContext context, double lat, double lon,
        double scale, GroundProjectionCounts counts) {
        if (counts != null) counts.attempted++;
        if (context == null || !Double.isFinite(lat) || !Double.isFinite(lon)) return null;
        String stage = "vec3";
        try {
            Object cartesian = context.vec3Class.getDeclaredConstructor().newInstance();
            boolean surfaceFound = false;
            for (Object terrain : ((Map<?, ?>)context.terrainMap).values()) {
                if (terrain == null) continue;
                Method surfacePoint = methodByTerrainSignature(terrain.getClass(), context.vec3Class);
                if (surfacePoint == null) continue;
                surfacePoint.setAccessible(true);
                stage = "terrain-surface";
                // Angle is an inline value class backed by inDegrees (Double), so JVM ABI inputs are degrees.
                if (Boolean.TRUE.equals(surfacePoint.invoke(terrain, lat, lon, cartesian))) { surfaceFound = true; break; }
            }
            if (!surfaceFound) {
                stage = "fallback-methods";
                Method getElevation = methodByElevationSignature(context.globe.getClass());
                Method toCartesian = methodByGlobeSignature(context.globe.getClass(), context.vec3Class);
                if (getElevation == null || toCartesian == null) { if (counts != null) counts.failureStage = stage; return null; }
                getElevation.setAccessible(true); toCartesian.setAccessible(true);
                stage = "fallback-elevation";
                Object elevation = getElevation.getParameterTypes().length == 3
                    ? getElevation.invoke(context.globe, lat, lon, false) : getElevation.invoke(context.globe, lat, lon);
                if (!(elevation instanceof Number) || !Double.isFinite(((Number)elevation).doubleValue())) {
                    if (counts != null) counts.failureStage = stage;
                    return null;
                }
                // RenderContext.CLAMP_TO_GROUND uses Globe.getElevation, then Globe.geographicToCartesian.
                toCartesian.invoke(context.globe, lat, lon, ((Number)elevation).doubleValue(), cartesian);
                if (counts != null) counts.fallbackAnchors++;
            } else if (counts != null) counts.meshAnchors++;

            stage = "vector-components";
            double x = ((Number)field(cartesian, "x")).doubleValue();
            double y = ((Number)field(cartesian, "y")).doubleValue();
            double z = ((Number)field(cartesian, "z")).doubleValue();
            ScreenPoint point = projectCartesianCss(context.mvp, context.viewport, x, y, z, scale);
            if (point == null) { if (counts != null) counts.failureStage = "clip-or-nonfinite"; return null; }
            if (counts != null) counts.record(point.x, point.y);
            return point;
        } catch (Throwable failure) {
            if (counts != null) { counts.failureStage = stage; counts.failureType = failure.getClass().getSimpleName(); }
            return null;
        }
    }

    /** Mirrors Matrix4.project and WorldWind.cartesianToScreenPoint, including only SDK Z clipping and Y flip. */
    private static ScreenPoint projectCartesianCss(double[] m, int[] viewport, double x, double y, double z, double scale) {
        if (m == null || m.length != 16 || viewport == null || viewport.length != 4 || !finite(m) ||
            viewport[2] <= 0 || viewport[3] <= 0 || !Double.isFinite(x) || !Double.isFinite(y) || !Double.isFinite(z)) return null;
        double clipX = m[0] * x + m[1] * y + m[2] * z + m[3];
        double clipY = m[4] * x + m[5] * y + m[6] * z + m[7];
        double clipZ = m[8] * x + m[9] * y + m[10] * z + m[11];
        double sw = m[12] * x + m[13] * y + m[14] * z + m[15];
        if (sw == 0.0) return null;
        double ndcX = clipX / sw, ndcY = clipY / sw, ndcZ = clipZ / sw;
        if (ndcZ < -1.0 || ndcZ > 1.0) return null;
        double pixelX = (ndcX * 0.5 + 0.5) * viewport[2] + viewport[0];
        double pixelY = viewport[3] - (ndcY * 0.5 + 0.5) * viewport[3] - viewport[1];
        double cssX = pixelX / scale, cssY = pixelY / scale;
        return Double.isFinite(cssX) && Double.isFinite(cssY) ? new ScreenPoint(cssX, cssY) : null;
    }

    private static double[] copyMatrix(Object value) {
        return value instanceof double[] ? ((double[])value).clone() : null;
    }

    private static int[] viewport(Object value) throws Exception {
        return new int[]{((Number)field(value, "x")).intValue(), ((Number)field(value, "y")).intValue(),
            ((Number)field(value, "width")).intValue(), ((Number)field(value, "height")).intValue()};
    }

    private static boolean finite(double[] values) {
        for (double value : values) if (!Double.isFinite(value)) return false;
        return true;
    }

    /** Finds the renderer's live terrain map across R8 variants without depending on a field name. */
    private static Object findRenderedTerrainMap(Object frameController, Class<?> vec3Class, GroundProjectionCounts counts) throws Exception {
        java.util.Set<Object> matches = java.util.Collections.newSetFromMap(new java.util.IdentityHashMap<>());
        // Prefer a retained SDK accessor. A throwing optimized getter is skipped without emitting
        // its exception text or any value contents.
        for (Class<?> type = frameController.getClass(); type != null; type = type.getSuperclass()) {
            for (Method method : type.getDeclaredMethods()) {
                if (method.getName().startsWith("getLastTerrains") && method.getParameterTypes().length == 0 &&
                    Map.class.isAssignableFrom(method.getReturnType())) {
                    try {
                        method.setAccessible(true);
                        Object value = method.invoke(frameController);
                        if (isRenderedTerrainMap(value, vec3Class)) matches.add(value);
                    } catch (Throwable ignored) { }
                }
            }
        }
        if (matches.size() == 1) { setTerrainMapCounts(counts, matches.size()); return matches.iterator().next(); }
        if (matches.size() > 1) { setTerrainMapCounts(counts, matches.size()); return null; }

        // R8 horizontal class merging can widen the retained holder field types to Object.
        // Inspect values by runtime type; accept only a non-empty map whose values expose the
        // WorldWind Terrain.surfacePoint contract. Never serialize or log any candidate value.
        for (Class<?> type = frameController.getClass(); type != null; type = type.getSuperclass()) {
            for (Field candidate : type.getDeclaredFields()) {
                if (java.lang.reflect.Modifier.isStatic(candidate.getModifiers())) continue;
                try {
                    candidate.setAccessible(true);
                    Object value = candidate.get(frameController);
                    if (isRenderedTerrainMap(value, vec3Class)) matches.add(value);
                } catch (Throwable ignored) { }
            }
        }
        if (matches.size() == 1) { setTerrainMapCounts(counts, matches.size()); return matches.iterator().next(); }
        if (matches.size() > 1) { setTerrainMapCounts(counts, matches.size()); return null; }

        // Last fallback is signature-based for a retained but renamed getter; only accept maps
        // whose values expose the SDK terrain surface-point contract. This is attempted only
        // when neither a named getter nor a unique backing field yielded the terrain map.
        for (Class<?> type = frameController.getClass(); type != null; type = type.getSuperclass()) {
            for (Method method : type.getDeclaredMethods()) {
                if (method.getParameterTypes().length != 0 || !Map.class.isAssignableFrom(method.getReturnType())) continue;
                try {
                    method.setAccessible(true);
                    Object value = method.invoke(frameController);
                    if (isRenderedTerrainMap(value, vec3Class)) matches.add(value);
                } catch (Throwable ignored) { }
            }
        }
        setTerrainMapCounts(counts, matches.size());
        return matches.size() == 1 ? matches.iterator().next() : null;
    }

    private static void setTerrainMapCounts(GroundProjectionCounts counts, int candidateCount) {
        if (counts != null) {
            counts.terrainMapCandidates = candidateCount;
            counts.terrainMapUnique = candidateCount == 1;
        }
    }

    private static boolean isRenderedTerrainMap(Object value, Class<?> vec3Class) {
        if (!(value instanceof Map) || ((Map<?, ?>)value).isEmpty()) return false;
        for (Object terrain : ((Map<?, ?>)value).values())
            if (terrain != null && methodByTerrainSignature(terrain.getClass(), vec3Class) != null) return true;
        return false;
    }

    private static Method methodByTerrainSignature(Class<?> type, Class<?> vec3Class) {
        for (Method method : type.getMethods()) {
            Class<?>[] p = method.getParameterTypes();
            if (p.length == 3 && p[0] == double.class && p[1] == double.class && p[2].isAssignableFrom(vec3Class) &&
                (method.getReturnType() == boolean.class || method.getReturnType() == Boolean.class)) return method;
        }
        for (Method method : type.getDeclaredMethods()) {
            Class<?>[] p = method.getParameterTypes();
            if (p.length == 3 && p[0] == double.class && p[1] == double.class && p[2].isAssignableFrom(vec3Class) &&
                (method.getReturnType() == boolean.class || method.getReturnType() == Boolean.class)) return method;
        }
        return null;
    }

    private static Method methodByElevationSignature(Class<?> type) {
        for (Method method : type.getMethods()) {
            Class<?>[] p = method.getParameterTypes();
            if ((p.length == 2 || p.length == 3) && p[0] == double.class && p[1] == double.class &&
                (p.length == 2 || p[2] == boolean.class) && Number.class.isAssignableFrom(box(method.getReturnType()))) return method;
        }
        for (Method method : type.getDeclaredMethods()) {
            Class<?>[] p = method.getParameterTypes();
            if ((p.length == 2 || p.length == 3) && p[0] == double.class && p[1] == double.class &&
                (p.length == 2 || p[2] == boolean.class) && Number.class.isAssignableFrom(box(method.getReturnType()))) return method;
        }
        return null;
    }

    private static Method methodByGlobeSignature(Class<?> type, Class<?> vec3Class) {
        for (Method method : type.getMethods()) {
            Class<?>[] p = method.getParameterTypes();
            if (p.length == 4 && p[0] == double.class && p[1] == double.class && p[2] == double.class && p[3].isAssignableFrom(vec3Class)) return method;
        }
        for (Method method : type.getDeclaredMethods()) {
            Class<?>[] p = method.getParameterTypes();
            if (p.length == 4 && p[0] == double.class && p[1] == double.class && p[2] == double.class && p[3].isAssignableFrom(vec3Class)) return method;
        }
        return null;
    }

    private static Class<?> box(Class<?> type) {
        if (!type.isPrimitive()) return type;
        if (type == double.class) return Double.class;
        if (type == float.class) return Float.class;
        if (type == long.class) return Long.class;
        if (type == int.class) return Integer.class;
        return type;
    }

    private static boolean safe(ScreenPoint point, double width, double height) {
        return point != null && point.x >= 36 && point.x <= width - 36 && point.y >= 105 && point.y <= height - AIM_OFFSET_CSS - 56;
    }

    private static double pointSegmentDistance(ScreenPoint p, ScreenPoint a, ScreenPoint b) {
        double dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
        if (length2 <= 1e-9) return distance(p, a);
        double t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2));
        return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    }

    private static double distance(ScreenPoint a, ScreenPoint b) { return Math.hypot(a.x - b.x, a.y - b.y); }

    private static int draftPointCount(JSONObject state) {
        JSONObject overlay = state.optJSONObject("trackOverlay"); JSONArray draft = overlay == null ? null : overlay.optJSONArray("draft");
        int count = 0;
        if (draft != null) for (int i = 0; i < draft.length(); i++) {
            JSONArray segment = draft.optJSONArray(i); if (segment != null) count += segment.length();
        }
        return count;
    }

    private static String roadStatus(JSONObject payload) {
        JSONObject road = payload == null ? null : payload.optJSONObject("road");
        return road == null ? "missing" : road.optString("status", "missing");
    }

    private static double cameraZoom(JSONObject camera) {
        if (camera == null) return Double.NaN;
        return camera.optDouble("zoom", camera.optDouble("detailZoom", Double.NaN));
    }

    private static boolean cameraCenterMoved(JSONObject a, JSONObject b) {
        if (a == null || b == null) return false;
        JSONArray ca = a.optJSONArray("center"), cb = b.optJSONArray("center");
        if (ca != null && cb != null && ca.length() >= 2 && cb.length() >= 2)
            return centerDistanceMeters(ca.optDouble(0), ca.optDouble(1), cb.optDouble(0), cb.optDouble(1)) > 1.0;
        double lonA = a.optDouble("longitude", Double.NaN), latA = a.optDouble("latitude", Double.NaN);
        double lonB = b.optDouble("longitude", Double.NaN), latB = b.optDouble("latitude", Double.NaN);
        return Double.isFinite(lonA + latA + lonB + latB) && centerDistanceMeters(lonA, latA, lonB, latB) > 1.0;
    }

    private static double centerDistanceMeters(double lonA, double latA, double lonB, double latB) {
        double meanLatitudeRadians = Math.toRadians((latA + latB) * 0.5);
        double east = Math.toRadians(lonB - lonA) * 6371008.8 * Math.cos(meanLatitudeRadians);
        double north = Math.toRadians(latB - latA) * 6371008.8;
        return Math.hypot(east, north);
    }

    private static double rendererCssScale(Native149Instrumentation parent) throws Exception {
        try { return ((Number)call(parent, "rendererCssScale")).doubleValue(); }
        catch (Throwable ignored) { return ((Number)call(parent, "viewportScale")).doubleValue(); }
    }

    private static Method findMethod(Class<?> type, String prefix, int parameterCount) throws NoSuchMethodException {
        for (Class<?> current = type; current != null; current = current.getSuperclass())
            for (Method method : current.getDeclaredMethods())
                if (method.getName().startsWith(prefix) && method.getParameterTypes().length == parameterCount) return method;
        throw new NoSuchMethodException(prefix + "/" + parameterCount);
    }

    private static Object pairNumber(Object pair, String fieldName, String getterName) throws Exception {
        try { return pair.getClass().getMethod(getterName).invoke(pair); } catch (ReflectiveOperationException ignored) { }
        for (Class<?> type = pair.getClass(); type != null; type = type.getSuperclass()) {
            try { Field field = type.getDeclaredField(fieldName); field.setAccessible(true); return field.get(pair); }
            catch (NoSuchFieldException ignored) { }
        }
        throw new NoSuchFieldException(fieldName);
    }

    private static String sha256(String value) {
        try {
            byte[] bytes = MessageDigest.getInstance("SHA-256").digest(value.getBytes("UTF-8"));
            StringBuilder out = new StringBuilder(); for (byte b : bytes) out.append(String.format(java.util.Locale.ROOT, "%02x", b & 0xff)); return out.toString();
        } catch (Exception ignored) { return "unavailable"; }
    }

    private static String safeError(String value) {
        if (value == null) return "unknown";
        String sanitized = value.replaceAll("[\\r\\n]", " ");
        return sanitized.substring(0, Math.min(180, sanitized.length()));
    }

    private static Object call(Object owner, String name, Object... args) throws Exception {
        Method method = findMethod(owner.getClass(), name, args.length); method.setAccessible(true);
        try { return method.invoke(owner, args); }
        catch (java.lang.reflect.InvocationTargetException error) {
            Throwable cause = error.getCause(); if (cause instanceof Exception) throw (Exception)cause; throw error;
        }
    }

    private static boolean targetAlreadyAttached(Native149Instrumentation parent) {
        try {
            Object activityValue = field(parent, "activity"), host = field(parent, "host"), entry = field(parent, "entry");
            Object maps = host == null ? null : field(host, "maps");
            return activityValue instanceof Activity && !((Activity)activityValue).isFinishing() && !((Activity)activityValue).isDestroyed() &&
                "com.guanyun.weather.NativeReactActivity".equals(activityValue.getClass().getName()) &&
                host != null && "com.shantu.nativeapp.hybrid.NativeReactMapHost".equals(host.getClass().getName()) &&
                maps instanceof java.util.Map && ((java.util.Map<?, ?>)maps).get("main") == entry &&
                entry != null && field(entry, "controller") != null && field(entry, "renderState") instanceof JSONObject;
        } catch (Throwable ignored) { return false; }
    }

    private static Object field(Object owner, String name) throws Exception {
        for (Class<?> type = owner.getClass(); type != null; type = type.getSuperclass()) {
            try { Field field = type.getDeclaredField(name); field.setAccessible(true); return field.get(owner); }
            catch (NoSuchFieldException ignored) { }
        }
        throw new NoSuchFieldException(name);
    }

    private static void set(Object owner, String name, Object value) throws Exception {
        for (Class<?> type = owner.getClass(); type != null; type = type.getSuperclass()) {
            try { Field field = type.getDeclaredField(name); field.setAccessible(true); field.set(owner, value); return; }
            catch (NoSuchFieldException ignored) { }
        }
        throw new NoSuchFieldException(name);
    }

    private static final class AtomicHolder<T> { T value; }
}
