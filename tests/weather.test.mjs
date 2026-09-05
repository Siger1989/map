import test from 'node:test';
import assert from 'node:assert/strict';
import {
  gridPoints,
  nearestCell,
  normalizeWeather,
  numberOrNull,
  describeWeather,
} from '../modules/weather/data.ts';
const points = gridPoints(103.28, 31.08);
const records = () =>
  points.map(() => ({
    elevation: 2000,
    hourly: {
      time: [1788573600, 1788577200],
      temperature_2m: [null, 20],
      rain: [0, null],
      cloud_cover_low: [0, 70],
      cloud_cover_mid: [null, 30],
      cloud_cover_high: [0, 0],
    },
  }));
test('Missing values remain distinct from dry weather and clear skies', () => {
  const data = normalizeWeather(records(), points, 1);
  assert.equal(data.cells[0].hours[0].temperature, null);
  assert.equal(data.cells[0].hours[0].rain, 0);
  assert.equal(data.cells[0].hours[1].rain, null);
  assert.equal(data.cells[0].hours[0].low, 0);
  assert.equal(data.cells[0].hours[0].mid, null);
  assert.equal(numberOrNull('0'), null);
});
test('Epoch seconds are normalized consistently and bad timestamps rejected', () => {
  assert.equal(normalizeWeather(records(), points).times[0], 1788573600000);
  const bad = records();
  bad[1].hourly.time[1] += 3600;
  assert.throws(() => normalizeWeather(bad, points), /时段不一致/);
});
test('Partial grid responses fail instead of assigning weather to wrong places', () => {
  assert.throws(() => normalizeWeather(records().slice(1), points), /不完整/);
  const data = normalizeWeather(records(), points);
  assert.equal(nearestCell(data, 120, 30), null);
  assert.deepEqual(data.anchor, [103.28, 31.08]);
  assert.equal(nearestCell(data, 103.28, 31.08)?.lng, 103.28);
});
test('Snow is described separately from rain', () => {
  assert.equal(describeWeather(73), '降雪');
  assert.equal(describeWeather(85), '阵雪');
  assert.equal(describeWeather(63), '降雨');
});
