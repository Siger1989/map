import assert from 'node:assert/strict';
import { test } from 'node:test';
import { drawWeatherRegions } from '../modules/weather/drawWeatherRegions.ts';

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
