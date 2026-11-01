import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeDemCache } from '../modules/map/native/geometry.ts';

test('same-camera DEM replacement invalidates projected caches while stale/rejected writes do not', () => {
  const cache = new NativeDemCache();
  const tile = height => ({ id: 'tile', west: -1, east: 1, south: -1, north: 1, width: 2, height: 2, heights: Array(4).fill(height) });
  assert.equal(cache.replace(4, [tile(0)]), true);
  const initialVersion = cache.dataVersion;
  assert.equal(cache.sample(0, 0), 0);
  assert.equal(cache.replace(4, [tile(250)]), true);
  assert.equal(cache.revision, 4);
  assert.equal(cache.sample(0, 0), 250);
  assert.notEqual(cache.dataVersion, initialVersion, 'same camera revision must not keep a zero-height projected index');
  const version = cache.dataVersion;
  assert.equal(cache.replace(3, [tile(500)]), false);
  assert.equal(cache.replace(4, [{ ...tile(500), width: 0 }]), false);
  assert.equal(cache.dataVersion, version);
  assert.equal(cache.clear(4), true);
  assert.equal(cache.sample(0, 0), null);
  assert.notEqual(cache.dataVersion, version);
});
