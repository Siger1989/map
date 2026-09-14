import test from 'node:test';
import assert from 'node:assert/strict';
import { routePointMetrics } from '../modules/routeAnalysis/pointMetrics.ts';
import { metresBetween } from '../modules/navigation/types.ts';
const sample = (altitude, time = null) => ({ altitude, time });
const track = {
  id: 'walk',
  name: '行程',
  createdAt: 1,
  segments: [
    [
      [0, 0],
      [0.001, 0],
      [0.002, 0],
    ],
  ],
  samples: [[sample(100, 100000), sample(120, 160000), sample(110, 220000)]],
};
const point = (coordinate, distance = 0) => ({
  trackId: 'walk',
  coordinate,
  distance,
});
test('selected recorded points show actual chainage, elevation, signed segment grade, time and interval speed', () => {
  const before = JSON.stringify(track),
    result = routePointMetrics(track, point([0.001, 0]));
  assert.ok(
    Math.abs(result.distance - metresBetween([0, 0], [0.001, 0])) < 0.1,
  );
  assert.equal(result.pointIndex, 1);
  assert.equal(result.elevation, 120);
  assert.equal(result.elevationSource, 'original');
  assert.equal(result.timestamp, 160000);
  assert.ok(result.slopePercent > 17 && result.slopePercent < 19);
  assert.ok(result.speedKmh > 6 && result.speedKmh < 7);
  assert.equal(JSON.stringify(track), before);
});
test('points between vertices interpolate only existing data and label interpolation', () => {
  const result = routePointMetrics(track, point([0.0005, 0]));
  assert.equal(result.pointIndex, null);
  assert.ok(Math.abs(result.elevation - 110) < 0.01);
  assert.equal(result.elevationSource, 'interpolated');
  assert.ok(Math.abs(result.timestamp - 130000) < 1);
  assert.equal(result.timeInterpolated, true);
  const gap = {
    ...track,
    samples: [[sample(100, 1000), sample(120, 901000), sample(110, 961000)]],
  };
  const missing = routePointMetrics(gap, point([0.0005, 0]));
  assert.equal(missing.timestamp, null);
  assert.equal(missing.speedKmh, null);
});
test('terrain fallback supplies height and slope but never fabricates record timestamps or speed', () => {
  const empty = { ...track, samples: undefined },
    terrain = {
      ...track,
      samples: track.samples.map((line) => line.map((p) => sample(p.altitude))),
    };
  const before = JSON.stringify(empty),
    result = routePointMetrics(empty, point([0.001, 0]), terrain);
  assert.equal(result.elevation, 120);
  assert.equal(result.elevationSource, 'terrain');
  assert.ok(result.slopePercent > 0);
  assert.equal(result.timestamp, null);
  assert.equal(result.speedKmh, null);
  assert.equal(JSON.stringify(empty), before);
  const missing = routePointMetrics(empty, point([0.001, 0]));
  assert.equal(missing.elevation, null);
  assert.equal(missing.slopePercent, null);
});
test('separate parts and singleton points preserve their own data without inventing a connecting slope', () => {
  const disconnected = {
    ...track,
    segments: [
      [
        [0, 0],
        [0.001, 0],
      ],
      [
        [1, 1],
        [1.001, 1],
      ],
      [[2, 2]],
    ],
    samples: [
      [sample(10), sample(20)],
      [sample(500), sample(480)],
      [sample(900)],
    ],
  };
  const result = routePointMetrics(disconnected, point([1.001, 1]));
  assert.equal(result.part, 1);
  assert.equal(result.elevation, 480);
  assert.ok(result.slopePercent < 0);
  const singleton = routePointMetrics(disconnected, point([2, 2]));
  assert.equal(singleton.part, 2);
  assert.equal(singleton.elevation, 900);
  assert.equal(singleton.slopePercent, null);
});
