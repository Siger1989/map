import test from 'node:test';
import assert from 'node:assert/strict';
import { segmentMetrics } from '../modules/measurement/data.ts';
import { markerPresentation } from '../modules/annotations/markerScale.ts';
import {
  nearestRoadPlaces,
  connectRoadAccess,
} from '../modules/navigation/roadAccess.ts';
import {
  rankSuggestions,
  readSuggestionHistory,
} from '../modules/input/suggestions.ts';
import { createSession } from '../modules/guidance/session.ts';
const point = (coordinates, altitude) => ({
  id: 'p',
  coordinates,
  altitude,
  heightSource: altitude === null ? 'unknown' : 'terrain',
});
test('two terrain points: inclination is distinct from compass bearing, missing height never zero', () => {
  const a = point([0, 0], 100),
    b = point([0.001, 0], 211.1950802335),
    m = segmentMetrics(a, b);
  assert.ok(Math.abs(m.inclination - 45) < 1e-6);
  assert.equal(m.bearing, 90);
  assert.ok(m.rise > 111);
  assert.ok(Math.abs(segmentMetrics(b, a).inclination - 45) < 1e-6);
  assert.equal(segmentMetrics(b, a).bearing, 270);
  assert.equal(segmentMetrics(a, point([0.001, 0], null)).inclination, null);
  assert.equal(segmentMetrics(a, a).inclination, null);
  assert.equal(segmentMetrics(a, point([0, 0], 200)).inclination, 90);
});
test('distant pins and models use common dot/icon states, selected item stays named', () => {
  assert.equal(markerPresentation(6, false), 'dot');
  assert.equal(markerPresentation(11, false), 'icon');
  assert.equal(markerPresentation(15, false), 'label');
  assert.equal(markerPresentation(6, true), 'label');
});
test('closest road candidate chosen by distance rather than provider order, empty results fail', () => {
  const stops = [{ name: 'a', coordinates: [0, 0] }];
  assert.deepEqual(
    nearestRoadPlaces(
      [
        {
          edges: [
            { correlated_lon: 0.02, correlated_lat: 0 },
            { correlated_lon: 0.001, correlated_lat: 0 },
          ],
        },
      ],
      stops,
    )[0].coordinates,
    [0.001, 0],
  );
  assert.throws(() => nearestRoadPlaces([{ edges: [] }], stops));
});
const road = (coordinates, extra = {}) => ({
  mode: 'pedestrian',
  coordinates,
  distance: 200,
  duration: 100,
  steps: [
    {
      instruction: '沿路',
      coordinates,
      distance: 200,
      duration: 100,
      elapsedSeconds: 0,
    },
  ],
  snapped: [coordinates[0], coordinates.at(-1)],
  createdAt: 1,
  ...extra,
});
test('off-road origin and destination connected with dashed segments, lengths and instruction clocks include access', () => {
  const original = road([
      [0, 0],
      [0.01, 0],
    ]),
    stops = [
      { name: 'a', coordinates: [0, 0.001] },
      { name: 'b', coordinates: [0.01, 0.002] },
    ];
  const r = connectRoadAccess(original, stops);
  assert.deepEqual(r.coordinates[0], stops[0].coordinates);
  assert.deepEqual(r.coordinates.at(-1), stops[1].coordinates);
  assert.deepEqual(
    r.segments.map((s) => s.kind),
    ['access', 'road', 'access'],
  );
  assert.ok(r.accessDistance > 333 && r.accessDistance < 334);
  assert.equal(r.distance, 200 + r.accessDistance);
  assert.equal(r.duration, 100 + r.accessDuration);
  assert.equal(r.steps[1].elapsedSeconds, r.steps[0].duration);
  assert.deepEqual(original.coordinates, [
    [0, 0],
    [0.01, 0],
  ]);
  const arrival = connectRoadAccess(
    {
      ...original,
      steps: [
        ...original.steps,
        {
          instruction: '到达终点',
          coordinates: [[0.01, 0]],
          distance: 0,
          duration: 0,
          elapsedSeconds: 100,
        },
      ],
    },
    stops,
  );
  assert.equal(
    arrival.steps.at(-2).instruction,
    '到达道路出口，继续前往标记点',
  );
});
test('off-road via is visited and then returns to road instead of shortcutting it', () => {
  const legs = [
    [
      [0, 0],
      [0.01, 0],
    ],
    [
      [0.01, 0],
      [0.02, 0],
    ],
  ];
  const r = connectRoadAccess(
    road(
      [
        [0, 0],
        [0.01, 0],
        [0.02, 0],
      ],
      {
        roadLegs: legs,
        snapped: [
          [0, 0],
          [0.01, 0],
          [0.02, 0],
        ],
      },
    ),
    [
      { name: 'a', coordinates: [0, 0] },
      { name: 'via', coordinates: [0.01, 0.001] },
      { name: 'b', coordinates: [0.02, 0] },
    ],
  );
  assert.deepEqual(r.coordinates, [
    [0, 0],
    [0.01, 0],
    [0.01, 0.001],
    [0.01, 0],
    [0.02, 0],
  ]);
  assert.deepEqual(
    r.segments.map((s) => s.kind),
    ['road', 'access', 'access', 'road'],
  );
  const session = createSession(r);
  assert.ok(session.checkpoints[0].distance > 1200);
  assert.ok(session.checkpoints[0].distance < 1230);
});
test('input suggestions deduplicate, prioritize prefixes, never require history to type', () => {
  assert.deepEqual(rankSuggestions('山', ['青山', '山路', '山路', '山']), [
    '山路',
    '青山',
  ]);
  assert.deepEqual(readSuggestionHistory('{bad'), []);
  assert.deepEqual(readSuggestionHistory('[1,"营地",null]'), ['营地']);
});
