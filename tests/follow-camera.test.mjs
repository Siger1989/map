import test from 'node:test';
import assert from 'node:assert/strict';
import { followPositionCamera, focusPointCamera } from '../modules/map/cameraSync.ts';
import { installFollowPanHandler } from '../modules/map/followGestures.ts';

test('position follow recenters for initial and later fixes without changing the user zoom', () => {
  let zoom = 9.25;
  const calls = [];
  const map = {
    easeTo(options, eventData) {
      calls.push({ options, eventData });
      if (options.zoom !== undefined) zoom = options.zoom;
    },
  };

  followPositionCamera(map, [104, 30], false);
  followPositionCamera(map, [104.001, 30], true);

  assert.equal(zoom, 9.25);
  assert.deepEqual(calls.map(({ options }) => options.center), [[104, 30], [104.001, 30]]);
  assert.ok(calls.every(({ options }) => !('zoom' in options)));
  assert.ok(calls.every(({ eventData }) => eventData.positionFollow));
});

test('only a single-pointer user pan pauses follow; wheel and two-finger zoom do not', () => {
  const listeners = new Map();
  let pauses = 0;
  const map = {
    on(type, listener) { listeners.set(type, listener); },
    off(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
  };
  const release = installFollowPanHandler(map, () => pauses++);
  const dragstart = listeners.get('dragstart');

  dragstart({ originalEvent: { touches: [{ identifier: 1 }] } });
  dragstart({ originalEvent: { touches: [{ identifier: 1 }, { identifier: 2 }] } });
  assert.equal(listeners.has('wheel'), false);
  assert.equal(listeners.has('touchstart'), false);
  assert.equal(pauses, 1);

  release();
  assert.equal(listeners.size, 0);
});

test('center-only navigation focus preserves zoom while explicit focus zoom remains available', () => {
  const calls = [];
  const map = { flyTo: options => calls.push(options) };

  focusPointCamera(map, [104, 30]);
  focusPointCamera(map, [105, 31], 14);

  assert.ok(!('zoom' in calls[0]));
  assert.equal(calls[1].zoom, 14);
});
