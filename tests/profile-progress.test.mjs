import test from 'node:test';
import assert from 'node:assert/strict';
import { profilePointAt, profileProgress } from '../modules/routeDisplay/profileProgress.ts';

const sample = (distance, elevation, part = 0) => ({
  coordinates: [distance / 1000, 0], distance, part, elevation,
});

test('progress interpolates an exact elevation and closes fill at the traveled boundary', () => {
  const result = profileProgress([sample(0, 100), sample(100, 200)], 25);
  assert.equal(result.distance, 25);
  assert.equal(result.elevation, 125);
  assert.deepEqual(result.fillSegments, [[
    { distance: 0, elevation: 100 },
    { distance: 25, elevation: 125 },
  ]]);
});

test('null or non-finite progress produces neither a marker nor fill', () => {
  const samples = [sample(0, 10), sample(100, 30)];
  for (const progress of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
    const result = profileProgress(samples, progress);
    assert.equal(result.distance, null);
    assert.equal(result.elevation, null);
    assert.deepEqual(result.fillSegments, []);
  }
  assert.equal(profilePointAt(samples, Number.NaN), null);
});

test('fill and point interpolation stop at missing elevations and segment boundaries', () => {
  const samples = [
    sample(0, 10), sample(50, null), sample(100, 20),
    sample(100, 40, 1), sample(200, 60, 1),
  ];
  assert.deepEqual(profileProgress(samples, 75).fillSegments, []);
  assert.deepEqual(profilePointAt(samples, 75), { distance: 75, elevation: null });
  assert.deepEqual(profileProgress(samples, 150).fillSegments, [[
    { distance: 100, elevation: 40 },
    { distance: 150, elevation: 50 },
  ]]);
});

test('progress and browsed points clamp to route endpoints', () => {
  const samples = [sample(0, 10), sample(100, 20), sample(200, 30)];
  const afterEnd = profileProgress(samples, 500);
  assert.equal(afterEnd.distance, 200);
  assert.equal(afterEnd.elevation, 30);
  assert.deepEqual(afterEnd.fillSegments, [[
    { distance: 0, elevation: 10 },
    { distance: 100, elevation: 20 },
    { distance: 200, elevation: 30 },
  ]]);
  assert.deepEqual(profilePointAt(samples, -5), { distance: 0, elevation: 10 });
});
