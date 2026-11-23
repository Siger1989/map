import assert from 'node:assert/strict';
import test from 'node:test';
import { drawJourneyRain } from '../modules/sky/journeyRain.ts';

function drawFrame(rain, time = 0, width = 390, height = 857) {
  const commands = [];
  const context = {
    save: () => commands.push(['save']),
    restore: () => commands.push(['restore']),
    beginPath: () => {},
    moveTo: () => {},
    lineTo: (x, y) => commands.push(['line', x, y]),
    arc: (x, y, radius) => commands.push(['drop', x, y, radius]),
    stroke: () => commands.push(['stroke', context.lineWidth, context.strokeStyle]),
    fill: () => commands.push(['fill', context.fillStyle]),
  };
  drawJourneyRain(context, width, height, rain, time);
  return commands;
}

test('dry or invalid frames leave the canvas untouched', () => {
  for (const rain of [0, -0.1, NaN, Infinity]) {
    assert.deepEqual(drawFrame(rain), []);
  }
  assert.deepEqual(drawFrame(1, NaN), []);
  assert.deepEqual(drawFrame(1, 0, 0), []);
});

test('light rain draws two streak layers and droplets on phone viewports', () => {
  for (const [width, height] of [[390, 857], [360, 780]]) {
    const frame = drawFrame(0.1, 0, width, height);
    assert.equal(frame[0][0], 'save');
    assert.equal(frame.at(-1)[0], 'restore');
    assert.equal(frame.filter(([type]) => type === 'stroke').length, 2);
    assert.equal(frame.filter(([type]) => type === 'fill').length, 1);
    const visible = ([, x, y]) => x >= 0 && x <= width && y >= 0 && y <= height;
    assert.ok(frame.filter(command => command[0] === 'line' && visible(command)).length >= 24);
    assert.ok(frame.filter(command => command[0] === 'drop' && visible(command)).length >= 3);
  }
});

test('playhead changes the rain pose and seeking back restores it exactly', () => {
  const firstFrame = drawFrame(5, 1.25);
  assert.notDeepEqual(drawFrame(5, 1.27), firstFrame);
  assert.deepEqual(drawFrame(5, 1.25), firstFrame);
});

test('density rises with rain and frame drawing stays capped at high rates and viewport sizes', () => {
  assert.ok(drawFrame(8).length > drawFrame(0.1).length);
  const capped = drawFrame(40, 1, 1600, 900);
  assert.deepEqual(drawFrame(500, 1, 1600, 900), capped);
  assert.ok(capped.filter(([type]) => type === 'line' || type === 'drop').length <= 232);
});
