import test from 'node:test';
import assert from 'node:assert/strict';
import { objectCenter, objectFocusZoom } from '../modules/map/objectCenter.ts';

test('object center uses a minimal longitude arc across the antimeridian', () => {
  assert.deepEqual(objectCenter([[179, 10], [-179, 14]]), [-180, 12]);
  assert.deepEqual(objectCenter([[181, 0], [183, 2]]), [-178, 1]);
});

test('marker centers remain exact and empty objects do not move the map', () => {
  assert.deepEqual(objectCenter([[12.5, -4.25]]), [12.5, -4.25]);
  assert.equal(objectCenter([]), null);
});

test('explicit object recenter moves to common detail scales without zooming back out', () => {
  assert.equal(objectFocusZoom(8, 'marker'), 16);
  assert.equal(objectFocusZoom(12, 'route'), 15);
  assert.equal(objectFocusZoom(17, 'area'), 17);
  assert.equal(objectFocusZoom(14, 'other'), 16);
});
