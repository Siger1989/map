import test from 'node:test';
import assert from 'node:assert/strict';
import {
  routeElevationScale,
  elevationColor,
  elevationEdgeColors,
} from '../modules/routeAnalysis/elevationColors.ts';
import { ANALYSIS_POLICY } from '../modules/routeAnalysis/config.ts';
import { metricLineParts } from '../modules/routeAnalysis/metrics.ts';
import {
  withTerrainHeights,
  trackHeights,
} from '../modules/routeDisplay/elevation.ts';
import { normalizeRouteDisplay } from '../modules/routeDisplay/preferences.ts';
import { normalizeTrackStyle } from '../modules/tracks/style.ts';
const track = {
  id: 'a',
  name: 'a',
  createdAt: 1,
  segments: [
    [
      [0, 0],
      [0.001, 0],
      [0.002, 0],
    ],
    [
      [1, 0],
      [1.001, 0],
    ],
  ],
  samples: [
    [
      { time: 1, altitude: -30 },
      { time: 2, altitude: 0 },
      { time: 3, altitude: 30 },
    ],
    [
      { time: 4, altitude: null },
      { time: 5, altitude: 20 },
    ],
  ],
};
test('elevation ramp accepts negative and flat heights, missing values stay gray', () => {
  const scale = routeElevationScale(track);
  assert.deepEqual(scale, { min: -30, max: 30 });
  assert.notEqual(elevationColor(-30, scale), elevationColor(30, scale));
  assert.equal(elevationColor(null, scale), ANALYSIS_POLICY.missingColor);
  assert.equal(elevationColor(NaN, scale), ANALYSIS_POLICY.missingColor);
  assert.match(elevationColor(0, { min: 0, max: 0 }), /^#[\da-f]{6}$/);
  const colors = elevationEdgeColors(track);
  assert.equal(colors[1][0], ANALYSIS_POLICY.missingColor);
  const parts = metricLineParts(track, 'elevation');
  assert.equal(parts.length, 3);
  assert.deepEqual(parts[2].coordinates, track.segments[1]);
  assert.deepEqual(
    normalizeTrackStyle({ colorMode: 'elevation' }).colorMode,
    'elevation',
  );
});
test('display DEM heights preserve original samples and timestamps without bridging holes or parts', () => {
  const source = {
    ...track,
    samples: [
      [
        { time: 11, altitude: 5 },
        { time: 22, altitude: null },
        { time: 33, altitude: null },
      ],
      [
        { time: null, altitude: null },
        { time: null, altitude: null },
      ],
    ],
  };
  const before = JSON.stringify(source),
    raw = trackHeights(source);
  const profile = raw.map((p, i) => ({
    ...p,
    elevation: [100, null, 300, 700, 800][i],
  }));
  const result = withTerrainHeights(source, profile);
  assert.equal(JSON.stringify(source), before);
  assert.equal(result.segments, source.segments);
  assert.equal(result.samples[0][0], source.samples[0][0]);
  assert.deepEqual(result.samples[0][1], { time: 22, altitude: null });
  assert.deepEqual(result.samples[0][2], { time: 33, altitude: 300 });
  assert.deepEqual(
    result.samples[1].map((s) => s.altitude),
    [700, 800],
  );
});
test('display options normalize independently and retain an explicit off selection', () => {
  assert.deepEqual(
    normalizeRouteDisplay({
      mode: 'elevation',
      legend: false,
      statistics: true,
      profile: 'yes',
      coordinates: true,
      unknown: true,
    }),
    {
      mode: 'elevation',
      legend: false,
      statistics: true,
      profile: false,
      steep: false,
      coordinates: true,
    },
  );
  assert.equal(normalizeRouteDisplay({ mode: 'invalid' }).mode, 'original');
});

test('missing GPX heights gain display slope without changing source points', () => {
  const original = { ...track, segments: [[[104.059, 30.657], [104.061, 30.657]]], samples: [[{time: 1, altitude: null}, {time: 60001, altitude: null}]] };
  const before = JSON.stringify(original);
  const points = trackHeights(original);
  const derived = withTerrainHeights(original, points.map((p, i) => ({...p, elevation: 496 + i})));
  assert.equal(JSON.stringify(original), before);
  assert.deepEqual(derived.segments, original.segments);
  assert.ok(metricLineParts(derived, 'slope').every(p => p.color !== ANALYSIS_POLICY.missingColor));
  assert.deepEqual(derived.samples[0].map(p => p.time), [1, 60001]);
});
