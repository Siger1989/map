import assert from 'node:assert/strict';
import test from 'node:test';
import { lineLength } from '../modules/journey/metrics.ts';
import {
  buildWeatherRoute,
  analyzeWeatherRoute,
  hourlyRainBand,
} from '../modules/journey/routeWeatherAnalysis.ts';

const HOUR = 3600000;
const hour = (time, precipitation) => ({ time, precipitation });
const forecast = (...points) => ({ fetchedAt: 0, points });

test('shares distinct dry, rain intensity and missing bands across the map and timeline', () => {
  assert.deepEqual(
    [null, NaN, -1, 0, 0.1, 0.2, 0.49, 0.5, 2, 5, 16].map(hourlyRainBand),
    ['unknown', 'unknown', 'unknown', 'dry', 'trace', 'light', 'light', 'moderate', 'heavy', 'intense', 'intense'],
  );
});

test('splits the real geometry while retaining bends and disconnected runs', () => {
  const bend = [0.009, 0];
  const first = [[0, 0], bend, [0.009, 0.009], [0.018, 0.009]];
  const second = [
    [30, 40],
    [30.005, 40],
  ];
  const route = buildWeatherRoute([
    { coordinates: first, durationSeconds: 600 },
    { coordinates: second, durationSeconds: 240 },
  ]);
  assert.ok(route.segments.length > 2);
  const a = route.segments.slice(0, -1);
  const b = route.segments.at(-1);
  assert.deepEqual(a[0].coordinates[0], first[0]);
  assert.deepEqual(a.at(-1).coordinates.at(-1), first.at(-1));
  assert.ok(a.some(({ coordinates }) => coordinates.includes(bend)));
  for (let i = 1; i < a.length; i++) {
    assert.deepEqual(a[i].coordinates[0], a[i - 1].coordinates.at(-1));
    assert.equal(a[i].startMeters, a[i - 1].endMeters);
    assert.equal(a[i].startSeconds, a[i - 1].endSeconds);
  }
  assert.deepEqual(b.coordinates, second);
  assert.equal(b.startSeconds, 600);
  assert.equal(b.endSeconds, 840);
  assert.equal(route.durationSeconds, 840);
  assert.ok(
    Math.abs(route.totalMeters - lineLength(first) - lineLength(second)) < 1e-8,
  );
});

test('uses the accumulation window containing arrival and treats omitted hours as unknown', () => {
  const points = [
    [0, 0],
    [0.005, 0],
  ];
  const route = buildWeatherRoute([
    { coordinates: points, durationSeconds: 0 },
  ]);
  const weather = forecast([
    hour(HOUR, 3),
    hour(2 * HOUR, 0),
    hour(4 * HOUR, 8),
  ]);
  const rain = (arrival) =>
    analyzeWeatherRoute(route, weather, arrival);
  assert.equal(rain(0).maxRain, 3);
  assert.equal(rain(HOUR - 1).wetMeters, route.totalMeters);
  assert.equal(rain(HOUR).maxRain, 0);
  assert.equal(rain(HOUR).wetMeters, 0);
  assert.equal(rain(2 * HOUR).unknownMeters, route.totalMeters);
  assert.equal(rain(3 * HOUR).maxRain, 8);
  assert.equal(rain(4 * HOUR).maxRain, null);
  assert.equal(rain(-1).maxRain, null);
});

test('limits requests to ten samples and leaves disconnected unsampled lines unknown', () => {
  const route = buildWeatherRoute(
    Array.from({ length: 12 }, (_, i) => ({
      coordinates: [
        [i, 0],
        [i + 0.005, 0],
      ],
      durationSeconds: 0,
    })),
  );
  assert.equal(route.segments.length, 12);
  assert.equal(route.stops.length, 10);
  const result = analyzeWeatherRoute(
    route,
    forecast(...route.stops.map(() => [hour(HOUR, 2)])),
    0,
  );
  assert.equal(result.segments.filter(({ rain }) => rain === null).length, 2);
  assert.ok(
    Math.abs(result.unknownMeters + result.wetMeters - route.totalMeters) <
      1e-8,
  );
});

test('breaks a malformed line and ignores duplicate points and invalid forecast amounts', () => {
  const route = buildWeatherRoute([
    {
      coordinates: [
        [0, 0],
        [0, 0],
      ],
      durationSeconds: 20,
    },
    {
      coordinates: [
        [0, 0],
        [0.005, 0],
        [NaN, 0],
        [5, 0],
        [5.005, 0],
      ],
      durationSeconds: NaN,
    },
  ]);
  assert.equal(route.durationSeconds, 20);
  assert.equal(route.segments.length, 2);
  assert.deepEqual(route.segments[1].coordinates[0], [5, 0]);
  assert.equal(route.segments[0].startSeconds, 20);
  const result = analyzeWeatherRoute(
    route,
    forecast([hour(HOUR, -1)], [hour(HOUR, NaN)]),
    0,
  );
  assert.equal(result.maxRain, null);
  assert.equal(result.unknownMeters, route.totalMeters);
  assert.deepEqual(buildWeatherRoute([]), {
    segments: [],
    stops: [],
    totalMeters: 0,
    durationSeconds: 0,
  });
});

test('splits at arrival-hour transitions without adding a forecast request', () => {
  const bend = [0.005, 0];
  const route = buildWeatherRoute([
    { coordinates: [[0, 0], bend, [0.005, 0.005]], durationSeconds: 7200 },
  ]);
  assert.equal(route.stops.length, 1);
  const weather = forecast([
    hour(HOUR, 4),
    { ...hour(2 * HOUR, 9), liquidRain: 1 },
    { ...hour(3 * HOUR, 9), liquidRain: null },
  ]);
  const result = analyzeWeatherRoute(route, weather, HOUR / 2);
  assert.deepEqual(
    result.segments.map(({ arrival }) => arrival),
    [HOUR * 0.75, HOUR * 1.5, HOUR * 2.25],
  );
  assert.deepEqual(
    result.segments.map(({ rain }) => rain),
    [4, 1, null],
  );
  assert.deepEqual(
    result.segments.map(({ sampleIndex }) => sampleIndex),
    [0, 0, 0],
  );
  assert.ok(result.segments[1].coordinates.includes(bend));
  assert.deepEqual(
    result.segments[0].coordinates.at(-1),
    result.segments[1].coordinates[0],
  );
  assert.deepEqual(
    result.segments[1].coordinates.at(-1),
    result.segments[2].coordinates[0],
  );
  assert.ok(Math.abs(result.wetMeters - route.totalMeters * 0.75) < 1e-8);
  assert.ok(Math.abs(result.unknownMeters - route.totalMeters * 0.25) < 1e-8);
});
