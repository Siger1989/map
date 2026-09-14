import test from 'node:test';
import assert from 'node:assert/strict';
import { importCoordinate } from '../modules/dataTransfer/coordinateSystem.ts';
test('Ovi coordinate conversion requires explicit source and matches published GCJ example', () => {
  assert.throws(() => importCoordinate([116.404, 39.915], 'auto'), /坐标系/);
  const p = [116.404, 39.915];
  assert.deepEqual(importCoordinate(p, 'cgcs2000'), p);
  assert.notEqual(importCoordinate(p, 'cgcs2000'), p);
  const gps = importCoordinate(p, 'gcj02');
  assert.ok(Math.abs(gps[0] - 116.39775550083061) < 1e-9);
  assert.ok(Math.abs(gps[1] - 39.91359571849836) < 1e-9);
  assert.deepEqual(importCoordinate([-73, 40], 'gcj02'), [-73, 40]);
});
