import test from 'node:test';
import assert from 'node:assert/strict';
import { importCoordinate } from '../modules/dataTransfer/coordinateSystem.ts';
import coordtransform from 'coordtransform';
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
test('standalone importer keeps coordtransform 2.1.2 results without a CommonJS runtime chunk', () => {
  for (const [lng, lat] of [
    [73.66, 3.86], [116.404, 39.915], [104.0668, 30.5728],
    [121.4737, 31.2304], [87.6177, 43.7928], [135.05, 53.55], [-73, 40],
  ]) {
    const actual = importCoordinate([lng, lat], 'gcj02');
    const expected = coordtransform.gcj02towgs84(lng, lat);
    assert.ok(Math.abs(actual[0] - expected[0]) < 1e-12);
    assert.ok(Math.abs(actual[1] - expected[1]) < 1e-12);
  }
});
