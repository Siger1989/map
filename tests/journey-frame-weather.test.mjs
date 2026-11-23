import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchRouteWeather, journeyForecastHours, journeyWeatherForArrival, parseForecast } from '../modules/journey/weatherProvider.ts';

const payload = {
  hourly: {
    time: [0, 3600, 7200, 14400],
    precipitation: [0, 1, 0, 0],
    rain: [0, 0.2, 0, 0],
    showers: [0, 0.1, 0, 0],
    snowfall: [0, 1.2, 0, -1],
    cloud_cover: [0, 80, 100, 101],
  },
};

test('uses future ending rain and snow totals with interpolated instantaneous cloud cover', () => {
  const [hours] = parseForecast(payload, 1, false, true);
  assert.deepEqual(journeyWeatherForArrival(hours, 1_800_000), { rainMm: 0.3, snowCm: 1.2, cloudCover: 40 });
  assert.deepEqual(journeyWeatherForArrival(hours, 3_600_000), { rainMm: 0, snowCm: 0, cloudCover: 80 });
});

test('keeps missing snapshots, invalid values and missing accumulation hours unknown', () => {
  const [hours] = parseForecast(payload, 1, false, true);
  assert.deepEqual(journeyWeatherForArrival(hours, 9_000_000), { rainMm: null, snowCm: null, cloudCover: null });
  assert.deepEqual(journeyWeatherForArrival(hours, 12_600_000), { rainMm: 0, snowCm: null, cloudCover: null });
  assert.deepEqual(journeyWeatherForArrival(hours, 7_200_000), { rainMm: null, snowCm: null, cloudCover: 100 });
  const [defaultHours] = parseForecast(payload, 1);
  assert.equal('snowfall' in defaultHours[0], false);
  assert.equal('cloudCover' in defaultHours[0], false);
});

test('the overnight journey requests both UTC brackets, retries temporary failures, and reuses covered hours', async (t) => {
  const start = Date.parse('2026-11-23T23:25:00Z');
  const end = Date.parse('2026-11-24T01:00:00Z');
  const hours = journeyForecastHours(start, end);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls++;
    const params = new URL(url).searchParams;
    assert.equal(params.get('timezone'), 'GMT');
    assert.equal(params.get('start_hour'), '2026-11-23T23:00');
    assert.equal(params.get('end_hour'), '2026-11-24T02:00');
    assert.equal(params.has('forecast_days'), false);
    if (calls === 1) return new Response(null, { status: 503 });
    return Response.json({ hourly: {
      ...payload.hourly,
      time: [0, 1, 2, 3].map(i => hours.startHour / 1000 + i * 3600),
      rain: [0, 0.2, 0.3, 0.4],
      showers: [0, 0, 0, 0],
    } });
  });
  const signal = new AbortController().signal;
  const stops = [{ coordinates: [103.57, 30.90], distance: 0, part: 0 }];
  const forecast = await fetchRouteWeather(stops, signal, { journeySky: true, hours });
  assert.equal(journeyWeatherForArrival(forecast.points[0], end).rainMm, 0.4);
  assert.equal(await fetchRouteWeather(stops, signal, {
    journeySky: true, hours: journeyForecastHours(start, end - 1),
  }), forecast);
  assert.equal(calls, 2);
});

test('journey weather does not retry a rate-limit response or caller cancellation', async (t) => {
  const hours = journeyForecastHours(Date.now(), Date.now() + 3_600_000);
  const stops = [{ coordinates: [103.571, 30.90], distance: 0, part: 0 }];
  const controller = new AbortController();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    if (calls === 1) return new Response(null, { status: 429 });
    controller.abort();
    throw new TypeError('connection reset');
  });
  await assert.rejects(fetchRouteWeather(stops, controller.signal, { journeySky: true, hours }), { status: 429 });
  await assert.rejects(fetchRouteWeather(stops, controller.signal, { journeySky: true, hours }), { name: 'AbortError' });
  assert.equal(calls, 2);
});

test('an off-window forecast cannot poison the selected journey cache', async (t) => {
  const hours = journeyForecastHours(Date.now(), Date.now() + 3_600_000);
  const stops = [{ coordinates: [103.572, 30.90], distance: 0, part: 0 }];
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json(payload));
  const signal = new AbortController().signal;
  await assert.rejects(fetchRouteWeather(stops, signal, { journeySky: true, hours }), /未返回所选行程时段/);
  fetch.mock.mockImplementation(async () => Response.json({ hourly: { time: [hours.startHour / 1000], cloud_cover: [50] } }));
  const result = await fetchRouteWeather(stops, signal, { journeySky: true, hours });
  assert.equal(result.points[0][0].cloudCover, 50);
  assert.equal(fetch.mock.callCount(), 2);
});
