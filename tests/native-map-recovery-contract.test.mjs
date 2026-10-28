import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldNotifyNativeMapReady } from '../modules/map/native/readiness.ts';


test('native onReady waits for both initial ACK and a valid frame in either arrival order', () => {
  const frame = { sequence: 1 };
  let created = false;
  let currentFrame = null;
  let notified = false;
  const notify = () => {
    if (!shouldNotifyNativeMapReady(created, currentFrame, notified)) return false;
    notified = true;
    return true;
  };

  // Frame arrives first: it must wait until create, viewport, and initial state ACK.
  currentFrame = frame;
  assert.equal(notify(), false);
  created = true;
  assert.equal(notify(), true);
  assert.equal(notify(), false, 'onReady is delivered at most once');

  // ACK arrives first: no readiness until the renderFrame event supplies a frame.
  created = true;
  currentFrame = null;
  notified = false;
  assert.equal(notify(), false);
  currentFrame = frame;
  assert.equal(notify(), true);
});
