import assert from "node:assert/strict";
import test from "node:test";
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
  assert.deepEqual(after.cameraCoordinates, [25, 45]);
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