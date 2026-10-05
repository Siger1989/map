import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudTileBounds, cloudSourceRow } from '../modules/weather/cloudProjection.ts';

test('cloud tiles use Web Mercator bounds with matching neighbours and antimeridian edges', () => {
  const left = cloudTileBounds(2, 0, 1), right = cloudTileBounds(2, 1, 1), below = cloudTileBounds(2, 0, 2);
  assert.equal(left[0], -180);
  assert.equal(left[2], right[0]);
  assert.equal(left[1], below[3]);
  assert.equal(cloudTileBounds(2, 3, 1)[2], 180);
  assert.throws(() => cloudTileBounds(2, 4, 0));
});

test('projection maps Mercator equator and latitudes to a geographic global image', () => {
  const global = [-180, -90, 180, 90];
  const world = cloudTileBounds(0, 0, 0);
  assert.ok(Math.abs(cloudSourceRow(world, 127.5, 256, 1024, global) - 511.5) < 1e-8);
  assert.ok(cloudSourceRow(world, 0, 256, 1024, global) < 30);
  assert.ok(cloudSourceRow(world, 255, 256, 1024, global) > 990);
  const northern = cloudTileBounds(2, 0, 0);
  assert.ok(cloudSourceRow(northern, 0, 256, 1024, global) < cloudSourceRow(northern, 255, 256, 1024, global));
});
