import assert from 'node:assert/strict';
import test from 'node:test';
import { getLocalDayBounds } from '../modules/sky/astronomy.ts';
import { makeTrackProjector, sampleSkyTracks, trackVisibility } from '../modules/sky/skyTrackGeometry.ts';

const optics = { horizontalFov: 60, verticalFov: 90 };
const dimensions = [360, 780];
const point = (azimuthDeg, altitudeDeg = 0) => ({ azimuthDeg, altitudeDeg });
const approximately = (actual, expected) => assert.ok(
  Math.abs(actual - expected) < 1e-8, `expected ${actual} to approximate ${expected}`,
);

test('the camera center, portrait roll and zenith follow the shader basis', () => {
  const center = makeTrackProjector({ azimuth: 42, altitude: 17, roll: 90 }, optics, ...dimensions);
  const projected = center.point(point(42, 17));
  approximately(projected.x, 180);
  approximately(projected.y, 390);

  const tilted = makeTrackProjector({ azimuth: 0, altitude: 0, roll: 90 }, optics, ...dimensions);
  assert.ok(tilted.point(point(0, 10)).x > 180);
  approximately(tilted.point(point(0, 10)).y, 390);
  assert.ok(tilted.point(point(10)).y > 390);
  approximately(tilted.point(point(10)).x, 180);

  const zenith = makeTrackProjector({ azimuth: 0, altitude: 90, roll: 113 }, optics, ...dimensions);
  approximately(zenith.point(point(137, 90)).x, 180);
  approximately(zenith.point(point(137, 90)).y, 390);
});

test('clip visible endpoints and reject segments behind the near plane', () => {
  const camera = makeTrackProjector({ azimuth: 0, altitude: 0, roll: 0 }, optics, ...dimensions);
  const middle = camera.segment(point(350), point(10));
  assert.ok(middle[0].x < 180 && middle[1].x > 180);
  const clipped = camera.segment(point(0), point(120));
  approximately(clipped[0].x, 180);
  approximately(clipped[1].x, 360);
  assert.equal(camera.point(point(180)), null);
  assert.equal(camera.segment(point(125), point(235)), null);
  assert.equal(camera.segment(point(55), point(67)), null);
});

test('ephemeris includes the selected 25-hour day without a next-date label', () => {
  const day = getLocalDayBounds('2026-11-01', 'America/New_York');
  assert.equal(day.endMs - day.startMs, 25 * 3600_000);
  const samples = sampleSkyTracks(day, { latitude: 40.7, longitude: -74, elevationM: 10 });
  assert.equal(samples[0].timeMs, day.startMs);
  assert.equal(samples.at(-1).timeMs, day.endMs - 1);
  assert.equal(samples.at(-1).label, false);
  assert.equal(samples.filter(sample => sample.label).length, 13);
  assert.ok(samples.every(({ sun, moon }) => [sun, moon].every(body => Number.isFinite(body.altitudeDeg))));
});

test('partial terrain preserves unknown coverage independently from hidden track', () => {
  assert.equal(trackVisibility(point(103, 20), () => 21), 'hidden');
  assert.equal(trackVisibility(point(103, 20), () => 20), 'visible');
  assert.equal(trackVisibility(point(103, 20), () => null), 'unknown');
});
