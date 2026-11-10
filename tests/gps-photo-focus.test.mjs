import test from 'node:test';
import assert from 'node:assert/strict';
import { focusGpsPhotoMarkers } from '../modules/photos/focusGpsMarkers.ts';

function view(zoom = 12) {
  const calls = [];
  return { calls, cameraSnapshot: () => ({ zoom }),
    focusPoint: (...args) => calls.push(['point', ...args]),
    fitCollection: (...args) => calls.push(['collection', ...args]) };
}

test('single photo or a merged group focuses its saved marker at a useful zoom', () => {
  const map = view();
  assert.equal(focusGpsPhotoMarkers(map, [[104, 30], [104, 30]]), true);
  assert.deepEqual(map.calls, [['point', [104, 30], 16]]);
  const close = view(18);
  focusGpsPhotoMarkers(close, [[104, 30]]);
  assert.equal(close.calls[0][2], 18);
});

test('multiple groups fit the batch with clearance for the import result panel', () => {
  const map = view();
  const points = [[179.9, 30], [-179.9, 30]];
  focusGpsPhotoMarkers(map, points);
  assert.equal(map.calls[0][0], 'collection');
  assert.deepEqual(map.calls[0][1], points);
  assert.ok(map.calls[0][2].top >= 200);
  assert.ok(map.calls[0][2].right >= 80);
});

test('missing GPS, an unavailable map, and camera errors never become photo-save errors', () => {
  const map = view();
  assert.equal(focusGpsPhotoMarkers(map, []), false);
  assert.equal(focusGpsPhotoMarkers(map, [[NaN, 30], [181, 30]]), false);
  assert.deepEqual(map.calls, []);
  assert.equal(focusGpsPhotoMarkers(null, [[104, 30]]), false);
  assert.equal(focusGpsPhotoMarkers({ ...map, focusPoint: () => { throw new Error('camera not ready'); } }, [[104, 30]]), false);
});
