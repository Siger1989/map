import assert from 'node:assert/strict';
import test from 'node:test';
import { selectPrintTracks } from '../modules/terrainPrint/printTracks.ts';
import { selectionGroundSize } from '../modules/terrainPrint/groundSize.ts';

const rectangle = { shape: 'rectangle', bounds: { west: 0, south: 0, east: 1, north: 1 } };

test('clips a segment crossing from outside both ends and places north first', () => {
  const paths = [
    [[-1, 0.75], [2, 0.75]],
    [[0.25, 2], [0.25, 0.75], [0.25, -1]],
    [[-5, -5], [-4, -4]],
  ];
  assert.deepEqual(selectPrintTracks(rectangle, paths), [
    [[0, 0.25], [1, 0.25]],
    [[0.25, 0], [0.25, 0.25], [0.25, 1]],
  ]);
});

test('leaves outside excursions and invalid samples disconnected and ignores repeated points', () => {
  const paths = [[[0.5, 0.5], [1.5, 0.5], [1.5, 0.75], [0.5, 0.75],
    [NaN, 0.5], [0.25, 0.25], [0.25, 0.25], [0.75, 0.25]]];
  assert.deepEqual(selectPrintTracks(rectangle, paths), [
    [[0.5, 0.5], [1, 0.5]],
    [[1, 0.25], [0.5, 0.25]],
    [[0.25, 0.75], [0.75, 0.75]],
  ]);
});

test('clips to the circle in model coordinates and drops corner-only strokes', () => {
  const circle = { shape: 'circle', bounds: { west: 3, south: 60, east: 4, north: 61 } };
  const ground = selectionGroundSize(circle);
  const radiusY = Math.min(ground.width, ground.height) / (2 * ground.height);
  const lines = selectPrintTracks(circle, [[[3.5, 62], [3.5, 59]], [[3, 61], [3.1, 60.95]]]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0][0][0], 0.5);
  assert.equal(lines[0][1][0], 0.5);
  assert.ok(Math.abs(lines[0][0][1] - (0.5 - radiusY)) < 1e-9);
  assert.ok(Math.abs(lines[0][1][1] - (0.5 + radiusY)) < 1e-9);
});

test('follows the short wrapped path through the selected edge of the date line', () => {
  const paths = [[[179, 0.5], [-179, 0.5]]];
  assert.deepEqual(selectPrintTracks(rectangle, paths), []);
  assert.deepEqual(selectPrintTracks({ shape: 'rectangle', bounds: { west: 179.5, south: 0, east: 180, north: 1 } }, paths),
    [[[0, 0.5], [1, 0.5]]]);
  assert.deepEqual(selectPrintTracks({ shape: 'rectangle', bounds: { west: -180, south: 0, east: -179.5, north: 1 } }, paths),
    [[[0, 0.5], [1, 0.5]]]);
});
