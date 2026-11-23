import assert from 'node:assert/strict';
import { test } from 'node:test';
import { drawWeatherRegions, planWeatherClouds } from '../modules/weather/drawWeatherRegions.ts';

const corners = [
  { x: 30, y: 10 },
  { x: 140, y: 50 },
  { x: 100, y: 140 },
  { x: 0, y: 100 },
];
const baseWeather = { rainMm: 0, snowCm: 0, cloudCover: 15, interval: 900 };

function draw(weather, elapsedSeconds) {
  const calls = [];
  let clipActive = false;
  const ctx = {
    clearRect: (...args) => calls.push(['clearRect', ...args]),
    save: () => calls.push(['save']),
    restore: () => { clipActive = false; calls.push(['restore']); },
    beginPath: () => calls.push(['beginPath']),
    moveTo: (...args) => calls.push(['moveTo', ...args]),
    lineTo: (...args) => calls.push(['lineTo', ...args]),
    closePath: () => calls.push(['closePath']),
    clip: () => { clipActive = true; calls.push(['clip']); },
    arc: (...args) => calls.push(['arc', ...args]),
    fill: () => { assert.ok(clipActive); calls.push(['fill']); },
    stroke: () => { assert.ok(clipActive); calls.push(['stroke']); },
  };
  drawWeatherRegions(ctx, 180, 180, [{ id: 'mountain', corners, weather }], elapsedSeconds);
  return calls;
}

test('dry and low-cloud regions only clear the weather canvas', () => {
  assert.deepEqual(draw(baseWeather, 3), [['clearRect', 0, 0, 180, 180]]);
});

test('mixed precipitation animates deterministically under its projected polygon clip', () => {
  const weather = { ...baseWeather, rainMm: 0.6, snowCm: 0.21 };
  const frame = draw(weather, 3);
  assert.deepEqual(frame.slice(3, 9), [
    ['moveTo', 30, 10], ['lineTo', 140, 50], ['lineTo', 100, 140], ['lineTo', 0, 100],
    ['closePath'], ['clip'],
  ]);
  assert.ok(frame.some(([name]) => name === 'stroke'));
  assert.ok(frame.some(([name]) => name === 'fill'));
  assert.deepEqual(frame, draw(weather, 3));
  assert.notDeepEqual(frame, draw(weather, 4));
});

const rectangle = (left, right) => [
  { x: left, y: 0 }, { x: right, y: 0 }, { x: right, y: 800 }, { x: left, y: 800 },
];

test('adjacent weather cells use the same irregular cloud field at their boundary', () => {
  const whole = planWeatherClouds(rectangle(0, 400), [10, 20, 10.4, 20.8], 400, 800, 85, 5);
  const left = planWeatherClouds(rectangle(0, 200), [10, 20, 10.2, 20.8], 400, 800, 85, 5);
  const right = planWeatherClouds(rectangle(200, 400), [10.2, 20, 10.4, 20.8], 400, 800, 85, 5);
  assert.ok(whole.length > 10);
  const crossesBoundary = puff => puff.x - puff.radius < 200 && puff.x + puff.radius > 200;
  const seam = whole.filter(crossesBoundary);
  assert.ok(seam.length > 0);
  for (const puff of seam) {
    for (const cell of [left, right]) {
      const same = cell.find(candidate => candidate.seed === puff.seed && Math.abs(candidate.radius - puff.radius) < 0.001);
      assert.ok(same, 'a cloud crossing the grid boundary must be present in both clips');
      assert.ok(Math.abs(same.x - puff.x) < 1e-6);
      assert.ok(Math.abs(same.y - puff.y) < 1e-6);
      assert.ok(Math.abs(same.opacity - puff.opacity) < 1e-6);
    }
  }
  assert.ok(new Set(whole.map(puff => Math.round(puff.radius))).size > 5, 'cloud banks must vary in size');
  assert.deepEqual(whole, planWeatherClouds(rectangle(0, 400), [10, 20, 10.4, 20.8], 400, 800, 85, 5));
});

test('cloud geography survives world-copy wrapping and stays bounded at close zoom', () => {
  const bounds = [10, 20, 10.4, 20.8];
  const frame = planWeatherClouds(rectangle(0, 400), bounds, 400, 800, 100, 3);
  const wrapped = planWeatherClouds(rectangle(0, 400), [370, 20, 370.4, 20.8], 400, 800, 100, 3);
  assert.equal(wrapped.length, frame.length);
  for (let i = 0; i < frame.length; i++) {
    assert.equal(wrapped[i].seed, frame[i].seed);
    assert.ok(Math.abs(wrapped[i].x - frame[i].x) < 1e-6);
  }
  const giant = [{ x: -10000, y: -10000 }, { x: 10000, y: -10000 }, { x: 10000, y: 10000 }, { x: -10000, y: 10000 }];
  const close = planWeatherClouds(giant, [10, 20, 10.1, 20.1], 390, 857, 100, 3);
  assert.ok(close.length > 0 && close.length < 500);
  assert.deepEqual(planWeatherClouds(rectangle(0, 400), bounds, 400, 800, 0, 3), []);
});

test('cloudy neighbours smoothly share cloud opacity without spreading precipitation', () => {
  const calls = [];
  const ctx = {
    clearRect() {}, save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, clip() {},
    translate(...values) { calls.push(['cloud', ...values]); }, scale() {}, fillRect() {},
    createRadialGradient() { return { addColorStop(...values) { calls.push(['alpha', ...values]); } }; },
    stroke() { throw Error('cloud interpolation must not invent rain'); },
    fill() { throw Error('cloud interpolation must not invent snow'); },
  };
  drawWeatherRegions(ctx, 400, 800, [
    { id: 'cloudy', bounds: [10, 20, 10.2, 20.8], corners: rectangle(0, 200), weather: { ...baseWeather, cloudCover: 95 } },
    { id: 'clear', bounds: [10.2, 20, 10.4, 20.8], corners: rectangle(200, 400), weather: { ...baseWeather, cloudCover: 0 } },
  ], 3);
  assert.ok(calls.some(call => call[0] === 'cloud'));
  assert.ok(calls.filter(call => call[0] === 'alpha').length > 10);
});
