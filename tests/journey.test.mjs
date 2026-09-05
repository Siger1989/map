import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import {
  sampleTerrain,
  lineLength,
  pointAlong,
  weatherStops,
  elevationStats,
} from '../modules/journey/metrics.ts';
import {
  parseForecast,
  matchForecast,
  fetchRouteWeather,
} from '../modules/journey/weatherProvider.ts';
const a = [104, 30],
  b = [104.01, 30],
  c = [105, 31],
  d = [105.01, 31];
test('profile preserves endpoints and discontinuities under a bounded sample budget', () => {
  const samples = sampleTerrain([
    [a, b],
    [c, d],
  ]);
  assert.equal(samples.length <= 192, true);
  assert.deepEqual(samples[0].coordinates, a);
  assert.deepEqual(samples.at(-1).coordinates, d);
  assert.ok(
    Math.abs(
      samples.at(-1).distance - lineLength([a, b]) - lineLength([c, d]),
    ) < 1e-6,
  );
  const edge = samples.findIndex((s) => s.part === 1);
  assert.equal(samples[edge].distance, samples[edge - 1].distance);
  assert.deepEqual(samples[edge].coordinates, c);
});
test('weather sampling caps requests and uses travel distance including endpoints', () => {
  const stops = weatherStops([a, [105, 30], [106, 30]]);
  assert.equal(stops.length, 6);
  assert.deepEqual(stops[0].coordinates, a);
  assert.deepEqual(stops.at(-1).coordinates, [106, 30]);
  assert.ok(
    Math.abs(
      pointAlong(
        [
          [179, 0],
          [-179, 0],
        ],
        lineLength([
          [179, 0],
          [-179, 0],
        ]) / 2,
      )[0],
    ) > 179.9,
  );
});
const profile = (elevations) =>
  elevations.map((elevation, i) => ({
    coordinates: a,
    distance: i * 30,
    part: 0,
    elevation,
  }));
test('elevation rise/descent, noise, and missing samples do not produce fabricated totals', () => {
  const stats = elevationStats(profile([100, 150, 120]));
  assert.equal(stats.ascent, 50);
  assert.equal(stats.descent, 30);
  assert.equal(stats.change, 20);
  assert.equal(stats.min, 100);
  assert.equal(stats.max, 150);
  assert.equal(elevationStats(profile([100, 101, 100, 101, 100])).ascent, 0);
  assert.equal(elevationStats(profile([100, 101, 102, 103, 104])).ascent, 4);
  const missing = elevationStats(profile([100, null, 200]));
  assert.equal(missing.ascent, null);
  assert.equal(missing.available, 2);
  assert.equal(missing.complete, false);
  const parts = [
    ...profile([100, 110]),
    ...profile([1000, 1010]).map((s) => ({ ...s, part: 1 })),
  ];
  assert.equal(elevationStats(parts).ascent, 20);
  assert.equal(elevationStats(parts).change, null);
});
const hour = (time) => ({
  time: time / 1000,
  temperature_2m: 20,
  precipitation: null,
});
test('forecast UTC timestamps match next-day Beijing arrivals, null rain stays unknown', () => {
  const t = Date.parse('2026-09-05T23:00:00+08:00');
  const payload = {
    hourly: {
      time: [t / 1000, t / 1000 + 3600, t / 1000 + 7200],
      temperature_2m: [19, 18, 17],
      precipitation: [0, null, 3],
      wind_speed_10m: [1, 2, 3],
      weather_code: [1, 3, 61],
    },
  };
  const hours = parseForecast(payload, 1)[0],
    arrived = Date.parse('2026-09-06T00:10:00+08:00');
  assert.equal(matchForecast(hours, arrived).temperature, 18);
  assert.equal(matchForecast(hours, arrived).precipitation, null);
  assert.equal(matchForecast(hours, t - 1), null);
  assert.equal(matchForecast(hours, t + 4 * 3600000), null);
  assert.throws(() => parseForecast([payload], 2));
});
test('multi-location provider requests forecast variables, retains nulls, and caches repeated points', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls++;
    const u = new URL(url);
    assert.equal(u.searchParams.get('latitude'), '30.00000,30.00000');
    assert.equal(u.searchParams.get('timeformat'), 'unixtime');
    return Response.json(
      Array.from({ length: 2 }, () => ({
        hourly: {
          time: [1788570000],
          temperature_2m: [null],
          precipitation: [0],
          wind_speed_10m: [2],
          weather_code: [3],
        },
      })),
    );
  };
  try {
    const stops = weatherStops([a, b]),
      signal = new AbortController().signal;
    const data = await fetchRouteWeather(stops, signal);
    assert.equal(data.points.length, 2);
    assert.equal(data.points[0][0].temperature, null);
    await fetchRouteWeather(stops, signal);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
test('DEM sampler groups same tile, decodes once, and leaves failed tiles missing', async () => {
  const compiled = await build({
    entryPoints: ['modules/journey/elevationProvider.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
  });
  const { readProfile, terrainPixel } = await import(
    `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
  );
  const old = {
    fetch: globalThis.fetch,
    createImageBitmap: globalThis.createImageBitmap,
    document: globalThis.document,
  };
  let calls = 0,
    decodes = 0;
  const bytes = new Uint8ClampedArray(256 * 256 * 4);
  for (let i = 0; i < bytes.length; i += 4) {
    bytes[i] = 129;
    bytes[i + 1] = 244;
    bytes[i + 3] = 255;
  }
  globalThis.fetch = async (url) => {
    calls++;
    return new Response('image', { status: calls === 1 ? 200 : 404 });
  };
  globalThis.createImageBitmap = async () => {
    decodes++;
    return { close() {} };
  };
  globalThis.document = {
    createElement: () => ({
      getContext: () => ({
        drawImage() {},
        getImageData: () => ({ data: bytes }),
      }),
    }),
  };
  try {
    assert.equal(terrainPixel([180, 0]).x, 0);
    const points = [a, [104.00001, 30.00001], c].map((coordinates, i) => ({
      coordinates,
      distance: i,
      part: 0,
    }));
    const result = await readProfile(points, new AbortController().signal);
    assert.deepEqual(
      result.map((s) => s.elevation),
      [500, 500, null],
    );
    assert.equal(calls, 2);
    assert.equal(decodes, 1);
  } finally {
    Object.assign(globalThis, old);
  }
});
