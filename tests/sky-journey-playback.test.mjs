import assert from "node:assert/strict";
import test from "node:test";
import { metresBetween } from "../modules/navigation/types.ts";
import { resolveJourneyCamera } from "../modules/sky/journeyCamera.ts";
import { createJourneyPlayback, getJourneyPlaybackFrame, plannedRouteSkyJourney, savedTrackSkyJourney } from "../modules/sky/journeyPlayback.ts";

const point = (lon, lat, elevationM, timeMs) => ({ coordinates: [lon, lat], elevationM, timeMs });

test("samples real cumulative distance, looks forward, and offsets the camera behind and above", () => {
  const journey = createJourneyPlayback({ name: "fixture", segments: [
    [point(104, 30.6, 500), point(104, 30.601, 520), point(104, 30.611, 620)],
  ] });
  assert.ok(journey.totalDistanceM > 1200 && journey.totalDistanceM < 1230);
  const frame = getJourneyPlaybackFrame(journey, 55);
  assert.ok(frame.coordinates[1] > 30.6004 && frame.coordinates[1] < 30.6006);
  assert.ok(frame.cameraCoordinates[1] < frame.coordinates[1]);
  assert.ok(frame.lookAt[1] > frame.coordinates[1]);
  assert.ok(frame.cameraElevationM > frame.elevationM);
  assert.ok(frame.headingDeg < 0.001);
});

test("separate segments do not add gap distance, look ahead or interpolate across it", () => {
  const journey = createJourneyPlayback({ name: "fixture", segments: [
    [point(179.9, 0, 0), point(-179.9, 0, 10)],
    [point(25, 45, 200), point(25, 45.001, 210)],
  ] });
  const boundary = journey.segments[0].endDistanceM;
  assert.ok(boundary > 22000 && boundary < 22500);
  assert.ok(journey.totalDistanceM - boundary < 120);
  assert.ok(Math.abs(getJourneyPlaybackFrame(journey, boundary / 2).coordinates[0]) > 179.99);
  const before = getJourneyPlaybackFrame(journey, boundary - 0.1);
  assert.equal(before.segmentIndex, 0);
  assert.deepEqual(before.lookAt, [-179.9, 0]);
  const after = getJourneyPlaybackFrame(journey, boundary + 0.1);
  assert.equal(after.segmentIndex, 1);
  assert.ok(after.cameraCoordinates[1] < 45);
  assert.ok(Math.abs(after.cameraCoordinates[0] - 25) < 0.00001);
  assert.ok(Math.abs(metresBetween(after.cameraCoordinates, after.coordinates) - 90) < 1);
});

test("recorded timestamps cross midnight monotonically and unknown height stays unknown", () => {
  const first = Date.parse("2026-11-20T23:59:00+08:00");
  const second = Date.parse("2026-11-21T00:03:00+08:00");
  const journey = createJourneyPlayback({ name: "fixture", segments: [
    [point(104, 30.6, 450, first), point(104.01, 30.6, null, second)],
  ] });
  const halfway = getJourneyPlaybackFrame(journey, journey.totalDistanceM / 2);
  assert.equal(halfway.timeMs, Date.parse("2026-11-21T00:01:00+08:00"));
  assert.equal(halfway.elevationM, null);
  assert.equal(halfway.cameraElevationM, null);
  assert.equal(getJourneyPlaybackFrame(journey, 0).elevationM, 450);
});

test("empty and singleton routes never fake motion or direction", () => {
  const empty = createJourneyPlayback({ name: "empty", segments: [[], [point(NaN, 0)]] });
  assert.equal(getJourneyPlaybackFrame(empty, 0), null);

  const single = createJourneyPlayback({ name: "single", segments: [[point(10, 20, null)]] });
  const frame = getJourneyPlaybackFrame(single, 20);
  assert.equal(frame.distanceM, 0);
  assert.equal(frame.headingDeg, null);
  assert.deepEqual(frame.coordinates, [10, 20]);
  assert.deepEqual(frame.cameraCoordinates, [10, 20]);
  assert.equal(frame.cameraElevationM, null);
});

test("a moving journey ignores isolated or repeated-point segments without adding a connection", () => {
  const moving = [point(103.5, 30.9), point(103.51, 30.9)];
  const source = { name: "multi-part", segments: [
    [point(104, 31)],
    [point(105, 31), point(105, 31)],
    moving,
    [point(106, 31)],
  ] };
  const model = createJourneyPlayback(source);
  assert.equal(model.segments.length, 1);
  assert.equal(source.segments.length, 4);
  assert.equal(model.totalDistanceM, metresBetween(moving[0].coordinates, moving[1].coordinates));
  const first = getJourneyPlaybackFrame(model, 0);
  assert.deepEqual(first.coordinates, moving[0].coordinates);
  assert.notEqual(first.headingDeg, null);
  assert.notDeepEqual(first.cameraCoordinates, first.coordinates);
  assert.deepEqual(getJourneyPlaybackFrame(model, model.totalDistanceM).coordinates, moving[1].coordinates);
});

test("invalid coordinates separate valid segments rather than joining across missing points", () => {
  const model = createJourneyPlayback({
    name: "gap", segments: [[point(0, 0), point(0, 0.001), point(181, 0), point(20, 30), point(20, 30.001)]],
  });
  assert.equal(model.segments.length, 2);
  assert.equal(model.pointCount, 4);
  assert.ok(model.totalDistanceM > 200 && model.totalDistanceM < 230);
});

test("saved track adapter preserves recorded data by original segment and point", () => {
  const original = {
    name: "recorded",
    segments: [[[104, 30], [104.1, 30]], [[107, 31]]],
    samples: [[{ time: 10, altitude: 450 }, { time: 20, altitude: null }], [{ time: 30, altitude: 600 }]],
  };
  assert.deepEqual(savedTrackSkyJourney(original), {
    name: "recorded",
    segments: [
      [point(104, 30, 450, 10), point(104.1, 30, null, 20)],
      [point(107, 31, 600, 30)],
    ],
  });
});

test("planned adapter joins shared endpoints and omits temporary saved-track bridges", () => {
  const first = { kind: "road", coordinates: [[104, 30], [104.1, 30]] };
  const connector = { kind: "access", coordinates: [[104.1, 30], [107, 31]] };
  const second = { kind: "road", coordinates: [[107, 31], [107.01, 31]] };
  const route = { name: "plan", segments: [first, connector, second] };
  assert.equal(plannedRouteSkyJourney(route, "unused").segments.length, 1);
  const savedPlan = plannedRouteSkyJourney({ ...route, geometryKind: "track" }, "unused");
  assert.equal(savedPlan.segments.length, 2);
  assert.deepEqual(savedPlan.segments[0].at(-1).coordinates, first.coordinates.at(-1));
  assert.deepEqual(savedPlan.segments[1][0].coordinates, second.coordinates[0]);
});
test("launch and finish remain 90 metres behind their own local heading even at the date line", () => {
  const route = createJourneyPlayback({ name: "crossing", segments: [
    [point(179.9998, 0, 10), point(-179.998, 0, 20)],
  ] });
  for (const station of [0, route.totalDistanceM]) {
    const frame = getJourneyPlaybackFrame(route, station);
    assert.ok(frame.cameraCoordinates[0] >= -180 && frame.cameraCoordinates[0] < 180);
    assert.ok(Math.abs(metresBetween(frame.cameraCoordinates, frame.coordinates) - 90) < 0.5);
    assert.ok(Math.abs(frame.headingDeg - 90) < 0.01);
    assert.equal(frame.cameraElevationM - frame.elevationM, 43);
  }
});

test("a hairpin and nearby parallel segment use their own forward edges independently", () => {
  const model = createJourneyPlayback({ name: "separate", segments: [
    [point(0, 0), point(.002, 0), point(.0001, .00004)],
    [point(.002, .00012), point(0, .00012)],
  ] });
  const bend = model.segments[0].points[1].distanceM;
  const boundary = model.segments[0].endDistanceM;
  assert.ok(getJourneyPlaybackFrame(model, bend - 2).headingDeg < 100);
  assert.ok(getJourneyPlaybackFrame(model, bend).headingDeg > 250);
  const outbound = getJourneyPlaybackFrame(model, bend + 2);
  assert.ok(outbound.cameraCoordinates[0] > outbound.coordinates[0]);
  const next = getJourneyPlaybackFrame(model, boundary + 1);
  assert.equal(next.segmentIndex, 1);
  assert.ok(next.headingDeg > 250);
  assert.ok(Math.abs(next.cameraCoordinates[1] - .00012) < 0.000001);
});

const optics = { horizontalFov: 32, verticalFov: 65 };
const cameraRoute = createJourneyPlayback({ name: "terrain", segments: [
  [point(104, 30), point(104, 30.005)],
] });

test("third person uses DEM height and leaves about 29 percent sky after HUD exclusion", () => {
  const frame = getJourneyPlaybackFrame(cameraRoute, 150);
  const resolved = resolveJourneyCamera(frame, optics, { heightAt: () => 700 });
  assert.equal(resolved.groundKnown, true);
  assert.equal(resolved.altitude, 743);
  assert.equal(resolved.subjectAltitude, 701);
  assert.ok(Math.abs((resolved.skyFraction - .055) / .853 - .29) < .01);
  assert.ok(resolved.pose.altitude < -12 && resolved.pose.altitude > -22);
  assert.equal(resolved.subjectOccluded, false);
});

test("terrain between the eye and route raises the eye within a budget and reports remaining occlusion", () => {
  const frame = getJourneyPlaybackFrame(cameraRoute, 150);
  const ridge = (frame.coordinates[1] + frame.cameraCoordinates[1]) / 2;
  const withHeight = elevation => ({
    heightAt: (_, latitude) => Math.abs(latitude - ridge) < .000075 ? elevation : 700,
  });
  const clear = resolveJourneyCamera(frame, optics, withHeight(729));
  assert.ok(clear.altitude > 743 && clear.altitude < 823);
  assert.equal(clear.subjectOccluded, false);
  const impassable = resolveJourneyCamera(frame, optics, withHeight(880));
  assert.ok(impassable.altitude >= 809 && impassable.altitude <= 823);
  assert.equal(impassable.subjectOccluded, true);
});

test("known high skyline tilts the camera while keeping subject framing within bounds", () => {
  const frame = getJourneyPlaybackFrame(cameraRoute, 150);
  const flat = resolveJourneyCamera(frame, optics, { heightAt: () => 700, horizonAt: () => 0 });
  const mountain = resolveJourneyCamera(frame, optics, { heightAt: () => 700, horizonAt: () => 10 });
  assert.ok(mountain.pose.altitude > flat.pose.altitude + 6);
  assert.ok(mountain.skyFraction >= .23 && mountain.skyFraction <= .33);
});

test("an uphill skyline adjusts boom or height and still keeps the subject clear of the HUD", () => {
  const frame = getJourneyPlaybackFrame(cameraRoute, 150);
  const terrain = {
    heightAt: (_, lat) => 700 - (lat - frame.coordinates[1]) * 111320 * .15,
    horizonAt: () => 14,
  };
  const adjusted = resolveJourneyCamera(frame, optics, terrain);
  assert.ok(adjusted.skyFraction > .27);
  const distance = metresBetween(adjusted.position, frame.coordinates);
  assert.ok(distance >= 89.9 && distance <= 158);
  assert.ok(adjusted.altitude >= terrain.heightAt(...adjusted.position) + 29);
  const subjectAngle = Math.atan2(adjusted.subjectAltitude - adjusted.altitude, distance);
  const fraction = .5 - .5 * Math.tan(subjectAngle - adjusted.pose.altitude * Math.PI / 180) /
    Math.tan(optics.verticalFov * Math.PI / 360);
  assert.ok(fraction > .57 && fraction < .82);
});

test("untextured DEM may anchor the eye but never supplies a visible ridge when mesh sampling is supplied", () => {
  const frame = getJourneyPlaybackFrame(cameraRoute, 150);
  const terrainHeight = (lng, lat) => metresBetween(frame.cameraCoordinates, [lng, lat]) > 300 ? 890 : 700;
  const allDem = resolveJourneyCamera(frame, optics, { heightAt: terrainHeight });
  const visibleMesh = resolveJourneyCamera(frame, optics, { heightAt: terrainHeight, skylineHeightAt: () => 700 });
  assert.equal(visibleMesh.altitude, 743);
  assert.equal(visibleMesh.subjectAltitude, 701);
  assert.ok(allDem.pose.altitude > visibleMesh.pose.altitude + 7);
});
