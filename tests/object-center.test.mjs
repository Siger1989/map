import test from 'node:test';
import assert from 'node:assert/strict';
import { objectCenter, objectFocusZoom, objectRecenterPlan } from '../modules/map/objectCenter.ts';

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

test('route recenter plans fit every route coordinate instead of focusing its midpoint', () => {
  const route = [[-122.5, 37.1], [-121.7, 37.8], [-120.9, 38.4]];
  assert.deepEqual(objectRecenterPlan(route, 'route', 16), {
    kind: 'fitCollection',
    coordinates: route,
  });
  assert.equal(objectRecenterPlan([], 'route', 16), null);
});

test('non-route recenter plans retain point focus and zoom behavior', () => {
  assert.deepEqual(objectRecenterPlan([[12, 20], [14, 24]], 'area', 12), {
    kind: 'focusPoint',
    coordinate: [13, 22],
    zoom: 15,
  });
});
