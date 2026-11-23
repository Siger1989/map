import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchRegionWeather, planWeatherRegions } from '../modules/weather/liveWeatherRegions.ts';

test('phone viewport at zoom 10 uses a bounded geographic grid stable across small pans', () => {
  const halfLongitude = 390 / (512 * 1024) * 180;
  const halfLatitude = 857 / (512 * 1024) * 180 * Math.cos(31 * Math.PI / 180);
  const bounds = [103.5 - halfLongitude, 31 - halfLatitude, 103.5 + halfLongitude, 31 + halfLatitude];
  const regions = planWeatherRegions(bounds);
  assert.ok(regions.length >= 6 && regions.length <= 32);
  assert.deepEqual(planWeatherRegions(bounds.map((value) => value + 0.001)), regions);
  for (const { bounds: [west, south, east, north], center: [longitude, latitude] } of regions) {
    assert.ok(east - west >= 0.0625);
    assert.ok(west < longitude && longitude < east && south < latitude && latitude < north);
  }
  assert.deepEqual(planWeatherRegions([-180, -85, 180, 85]), []);
});

test('wrapped and unwrapped views share canonical weather IDs but preserve map positions', () => {
  const wrapped = planWeatherRegions([179.8, 0, -179.8, 0.2]);
  const unwrapped = planWeatherRegions([179.8, 0, 180.2, 0.2]);
  const otherWorldCopy = planWeatherRegions([-180.2, 0, -179.8, 0.2]);
  assert.ok(wrapped.length > 1);
  assert.deepEqual(wrapped, unwrapped);
  assert.deepEqual(wrapped.map(({ id, center }) => [id, center]), otherWorldCopy.map(({ id, center }) => [id, center]));
  assert.ok(wrapped.some(({ bounds, center }) => bounds[0] >= 180 && center[0] < -179));
  const polar = planWeatherRegions([10, 85, 10.1, 86]);
  assert.ok(polar.length);
  assert.ok(polar.every(({ bounds }) => bounds[3] <= 85.05112878));
});

test('a single batched request preserves per-location missing data and rejects shortened responses', async (t) => {
  const samples = planWeatherRegions([103.5, 31, 103.625, 31.0625]).slice(0, 2);
  const valid = { current: { rain: 0, showers: 0.2, snowfall: 0, cloud_cover: 40, is_day: 1, time: 1780000000, interval: 900 } };
  const request = t.mock.method(globalThis, 'fetch', async () => Response.json([null, valid]));
  const controller = new AbortController();
  const result = await fetchRegionWeather(samples, controller.signal);
  assert.equal(request.mock.callCount(), 1);
  const [url, options] = request.mock.calls[0].arguments;
  const params = new URL(url).searchParams;
  assert.deepEqual(params.get('longitude').split(',').map(Number), samples.map(({ center }) => center[0]));
  assert.deepEqual(params.get('latitude').split(',').map(Number), samples.map(({ center }) => center[1]));
  assert.equal(options.signal, controller.signal);
  assert.equal(result.has(samples[0].id), false);
  assert.deepEqual(result.get(samples[1].id), {
    rainMm: 0.2, snowCm: 0, cloudCover: 40, isDay: true, time: 1780000000, interval: 900,
  });

  request.mock.mockImplementation(async () => Response.json([valid]));
  assert.equal((await fetchRegionWeather(samples, controller.signal)).size, 0);
  assert.equal((await fetchRegionWeather([samples[1]], controller.signal)).get(samples[1].id).cloudCover, 40);
});
