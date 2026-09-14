import test from 'node:test';
import assert from 'node:assert/strict';
import { terrainProfileTrack } from '../modules/routeAnalysis/terrainProfileTrack.ts';
import { trackHeights } from '../modules/routeAnalysis/trackElevation.ts';
import {
  metricLineParts,
  analyzeRoute,
} from '../modules/routeAnalysis/metrics.ts';
import { routeElevationScale } from '../modules/routeAnalysis/elevationColors.ts';
import { ANALYSIS_POLICY } from '../modules/routeAnalysis/config.ts';

const source = {
  id: 'sparse',
  name: 'sparse',
  createdAt: 0,
  segments: [
    [
      [0, 0],
      [0.004, 0],
    ],
  ],
  samples: [
    [
      { time: 0, altitude: null },
      { time: 60000, altitude: null },
    ],
  ],
};
const hill = [500, 501, 520, 560, 500].map((elevation, i) => ({
  coordinates: [0.001 * i, 0],
  distance: (trackHeights(source)[1].distance * i) / 4,
  part: 0,
  elevation,
}));

test('a sparse DEM route retains the intermediate hill and changes elevation and slope colours', () => {
  const before = structuredClone(source);
  const profile = terrainProfileTrack(source, hill);
  assert.deepEqual(source, before);
  assert.deepEqual(
    profile.segments[0],
    hill.map((p) => p.coordinates),
  );
  assert.deepEqual(
    profile.samples[0].map((p) => p.time),
    [0, null, null, null, 60000],
  );
  assert.deepEqual(routeElevationScale(profile), { min: 500, max: 560 });
  assert.ok(
    new Set(metricLineParts(profile, 'elevation').map((p) => p.color)).size > 3,
  );
  assert.equal(
    new Set(metricLineParts(profile, 'slope').map((p) => p.color)).size,
    3,
  );
  assert.ok(analyzeRoute(profile).maximumSlopePercent > 30);
  assert.equal(
    analyzeRoute(profile).maximumSpeedKmh,
    null,
    'synthetic terrain points have no invented speeds',
  );
  assert.ok(analyzeRoute(source).maximumSpeedKmh > 0);
});

test('DEM gaps and pause segments remain disconnected; original measured heights win', () => {
  const track = {
    ...source,
    segments: [
      ...source.segments,
      [
        [1, 0],
        [1.002, 0],
      ],
    ],
    samples: [
      ...source.samples,
      [
        { time: 90000, altitude: 100 },
        { time: 120000, altitude: 200 },
      ],
    ],
  };
  const raw = trackHeights(track);
  const samples = [
    ...hill.map((p, i) => ({ ...p, elevation: i === 2 ? null : p.elevation })),
    { ...raw[2], elevation: 800 },
    {
      coordinates: [1.001, 0],
      distance: (raw[2].distance + raw[3].distance) / 2,
      part: 1,
      elevation: 900,
    },
    { ...raw[3], elevation: 1000 },
  ];
  const before = structuredClone(track),
    profile = terrainProfileTrack(track, samples);
  assert.deepEqual(track, before);
  assert.deepEqual(profile.segments[1], track.segments[1]);
  assert.deepEqual(profile.samples[1], track.samples[1]);
  assert.equal(profile.samples[0][2].altitude, null);
  for (const mode of ['elevation', 'slope']) {
    const parts = metricLineParts(profile, mode);
    assert.ok(parts.some((p) => p.color === ANALYSIS_POLICY.missingColor));
    assert.ok(
      parts.every(
        (p) =>
          p.coordinates.every((c) => c[0] < 0.01) ||
          p.coordinates.every((c) => c[0] >= 1),
      ),
    );
  }
});

test('two measured endpoints produce a bounded elevation gradient, including the antimeridian', () => {
  const track = {
    ...source,
    segments: [
      [
        [179.99, 10],
        [-179.99, 10],
      ],
    ],
    samples: [
      [
        { time: 0, altitude: -100 },
        { time: 60000, altitude: 900 },
      ],
    ],
  };
  const before = structuredClone(track),
    parts = metricLineParts(track, 'elevation');
  assert.deepEqual(track, before);
  assert.ok(new Set(parts.map((p) => p.color)).size > 20);
  assert.ok(parts.length <= 32);
  assert.deepEqual(parts[0].coordinates[0], track.segments[0][0]);
  assert.deepEqual(parts.at(-1).coordinates.at(-1), track.segments[0][1]);
  assert.ok(
    parts.every((p) => p.coordinates.every((c) => Math.abs(c[0]) >= 179.98)),
  );
  const flat = {
    ...track,
    samples: [
      [
        { time: 0, altitude: 0 },
        { time: 1, altitude: 0 },
      ],
    ],
  };
  assert.equal(metricLineParts(flat, 'elevation').length, 1);
  assert.notEqual(
    metricLineParts(flat, 'elevation')[0].color,
    ANALYSIS_POLICY.missingColor,
  );
  const dense = {
    ...source,
    segments: [Array.from({ length: 6001 }, (_, i) => [i / 100000, 0])],
    samples: [
      Array.from({ length: 6001 }, (_, i) => ({
        time: null,
        altitude: (i % 2) * 1000,
      })),
    ],
  };
  const count = metricLineParts(dense, 'elevation').reduce(
    (n, p) => n + p.coordinates.length - 1,
    0,
  );
  assert.ok(count <= 12000, `render subdivision budget exceeded: ${count}`);
});
