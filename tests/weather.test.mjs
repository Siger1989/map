import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GRID_STEP,
  gridPoints,
  nearestCell,
  normalizeWeather,
  numberOrNull,
  describeWeather,
  weatherViewportGrid,
} from '../modules/weather/data.ts';
const points = gridPoints(103.28, 31.08);
const records = () =>
  points.map(() => ({
    elevation: 2000,
    hourly: {
      time: [1788573600, 1788577200],
      temperature_2m: [null, 20],
      rain: [0, null],
      showers: [0, 0],
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
test('viewport weather grid covers view plus a full interval within the 9-by-9 budget', () => {
  const bounds = [103.01, 30.71, 104.13, 31.42];
  const grid = weatherViewportGrid(bounds);
  assert.ok(grid);
  assert.ok(grid.columns >= 2 && grid.columns <= 9);
  assert.ok(grid.rows >= 2 && grid.rows <= 9);
  assert.ok(grid.points.length <= 81);
  assert.ok(grid.step[0] >= 0.32 && grid.step[1] >= 0.32);
  assert.equal(grid.points.length, grid.rows * grid.columns);
  for (let row = 0; row < grid.rows; row++) {
    const line = grid.points.slice(row * grid.columns, (row + 1) * grid.columns);
    assert.ok(line.every((point, i) => i === 0 || point.lng > line[i - 1].lng));
    assert.ok(line.every(point => point.lat === line[0].lat));
  }
  assert.ok(grid.points[0].lng <= bounds[0] - grid.step[0] + 1e-6);
  assert.ok(grid.points[grid.columns - 1].lng >= bounds[2] + grid.step[0] - 1e-6);
  assert.ok(grid.points[0].lat <= bounds[1] - grid.step[1] + 1e-6);
  assert.ok(grid.points.at(-1).lat >= bounds[3] + grid.step[1] - 1e-6);
  const expectedBounds = [
    grid.points[0].lng - grid.step[0] / 2,
    Math.max(-85, grid.points[0].lat - grid.step[1] / 2),
    grid.points[grid.columns - 1].lng + grid.step[0] / 2,
    Math.min(85, grid.points.at(-1).lat + grid.step[1] / 2),
  ];
  grid.bounds.forEach((value, i) => assert.ok(Math.abs(value - expectedBounds[i]) < 1e-6));
});
test('viewport grid key stays stable within one snapped cell and unwraps date-line bounds', () => {
  const first = weatherViewportGrid([100.01, 20.01, 100.81, 20.61]);
  const nudge = weatherViewportGrid([100.02, 20.02, 100.82, 20.62]);
  assert.equal(first.key, nudge.key);
  assert.deepEqual(first.points, nudge.points);

  const crossing = weatherViewportGrid([170, -8, -170, 8]);
  assert.ok(crossing);
  assert.ok(crossing.points[0].lng < 170);
  assert.ok(crossing.points.at(-1).lng > 190);
  for (let row = 0; row < crossing.rows; row++) {
    const line = crossing.points.slice(row * crossing.columns, (row + 1) * crossing.columns);
    assert.ok(line.every((point, i) => i === 0 || point.lng >= line[i - 1].lng));
  }
  const global = weatherViewportGrid([-180, -85, 180, 85]);
  assert.ok(global.points.length <= 81);
  assert.ok(global.bounds[0] < -180 && global.bounds[2] > 180);
  assert.ok(global.points.every(point => point.lat >= -85 && point.lat <= 85));
  assert.ok(global.step[1] >= GRID_STEP);
  assert.equal(global.bounds[1], -85);
  assert.equal(global.bounds[3], 85);
  const polar = weatherViewportGrid([140, 80, 160, 90]);
  assert.ok(polar.points.every(point => point.lat >= -85 && point.lat <= 85));
  assert.ok(polar.rows <= 9 && polar.bounds[3] === 85);
});
test('invalid viewport bounds return null and normalized anchors use arbitrary grid extent', () => {
  assert.equal(weatherViewportGrid([0, 0, Number.NaN, 1]), null);
  const grid = weatherViewportGrid([100, 20, 101, 21]);
  const normalized = normalizeWeather(grid.points.map(() => records()[0]), grid.points, 1);
  assert.deepEqual(normalized.anchor, [
    (grid.points[0].lng + grid.points[grid.columns - 1].lng) / 2,
    (grid.points[0].lat + grid.points.at(-1).lat) / 2,
  ]);
});
test('Partial grid responses fail instead of assigning weather to wrong places', () => {
  assert.throws(() => normalizeWeather(records().slice(1), points), /不完整/);
  const data = normalizeWeather(records(), points);
  assert.equal(nearestCell(data, 120, 30), null);
  assert.deepEqual(data.anchor, [103.28, 31.08]);
  assert.equal(nearestCell(data, 103.28, 31.08)?.lng, 103.28);
});
test('Rain combines large-scale rain and convective showers', () => {
  const input = records();
  input.forEach(record => {
    record.hourly.rain = [0, 1.25];
    record.hourly.showers = [2.5, 0.75];
  });
  const data = normalizeWeather(input, points, 1);
  assert.equal(data.cells[0].hours[0].rain, 2.5, 'pure showers are visible as rain');
  assert.equal(data.cells[0].hours[1].rain, 2, 'large-scale rain and showers are accumulated');
});
test('Rain is unknown when either precipitation component is missing or invalid', () => {
  for (const [key, value] of [
    ['rain', null],
    ['showers', undefined],
    ['rain', -0.1],
    ['showers', -0.1],
    ['rain', Number.NaN],
  ]) {
    const input = records();
    input.forEach(record => {
      record.hourly.rain = [0, 1];
      record.hourly.showers = [0, 1];
      record.hourly[key][0] = value;
    });
    assert.equal(normalizeWeather(input, points, 1).cells[0].hours[0].rain, null,
      `${key}=${String(value)} cannot be treated as zero`);
  }
});
test('Snow is described separately from rain', () => {
  assert.equal(describeWeather(73), '降雪');
  assert.equal(describeWeather(85), '阵雪');
  assert.equal(describeWeather(63), '降雨');
});
