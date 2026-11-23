import assert from 'node:assert/strict';
import test from 'node:test';
import { journeyWeatherForArrival, parseForecast } from '../modules/journey/weatherProvider.ts';

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
