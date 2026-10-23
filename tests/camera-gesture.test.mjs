import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCameraGestureFrame,
  orbitCamera,
  canStartRingDrag,
  ringAngle,
  rotateCameraRing,
} from '../modules/controls/cameraGesture.ts';

test('bearing ring accepts its touch band and rejects the centre and distant points', () => {
  for (const [x, y] of [[0, 0], [2, -1], [20, 5], [80, 0], [0, 40]])
    assert.equal(canStartRingDrag(x, y), false);
  for (const [x, y] of [[46, 0], [-46, 0], [0, -23], [0, 30], [0, 36], [30, 0]])
    assert.equal(canStartRingDrag(x, y), true);
});

test('bearing ring pauses around its centre and reanchors without jumping on re-entry', () => {
  let state = { angle: 90, bearing: 35, ringPoint: { x: 46, y: 0 } };
  for (const [x, y] of [[2, 1], [-2, -1], [0, 0]]) {
    state = rotateCameraRing(state, x, y);
    assert.equal(state.bearing, 35);
    assert.equal(state.angle, null);
  }
  state = rotateCameraRing(state, -46, 0);
  assert.equal(state.bearing, 35);
  state = rotateCameraRing(state, -46 * Math.cos(Math.PI / 18), -23 * Math.sin(Math.PI / 18));
  assert.ok(Math.abs(state.bearing - 45) < 1e-9);
});

test('bearing ring does not flip when a fast drag skips over the centre', () => {
  const state = { angle: 90, bearing: 15, ringPoint: { x: 46, y: 0 } };
  assert.equal(rotateCameraRing(state, -46, 0).bearing, 15);
});

test('normal ring motion wraps north and stays independent of pitch', () => {
  const point = (degrees) => ({ x: 46 * Math.sin(degrees * Math.PI / 180), y: -23 * Math.cos(degrees * Math.PI / 180) });
  const start = point(179), next = point(-179);
  const state = rotateCameraRing({ angle: ringAngle(start.x, start.y), bearing: 179, ringPoint: start }, next.x, next.y);
  assert.equal(state.bearing, -179);
});

test('model drag accepts horizontal, vertical and diagonal camera movement', () => {
  assert.deepEqual(orbitCamera({ pitch: 40, bearing: 0 }, 20, 0), {
    pitch: 40,
    bearing: 27,
  });
  assert.deepEqual(orbitCamera({ pitch: 40, bearing: 0 }, 0, -20), {
    pitch: 67,
    bearing: 0,
  });
  assert.deepEqual(orbitCamera({ pitch: 40, bearing: 0 }, 20, -20), {
    pitch: 67,
    bearing: 27,
  });
});

test('camera drag clamps tilt and wraps direction at north without blocking the other axis', () => {
  assert.deepEqual(orbitCamera({ pitch: 80, bearing: 175 }, 20, -100), {
    pitch: 80,
    bearing: -158,
  });
  assert.deepEqual(orbitCamera({ pitch: 0, bearing: -175 }, -20, 100), {
    pitch: 0,
    bearing: 158,
  });
});

function fakeFrames() {
  let next = 1;
  const queued = new Map();
  return {
    request(callback) {
      const id = next++;
      queued.set(id, callback);
      return id;
    },
    cancel(id) {
      queued.delete(id);
    },
    flush() {
      const callbacks = [...queued.values()];
      queued.clear();
      callbacks.forEach((cb) => cb(0));
    },
    get size() {
      return queued.size;
    },
  };
}

test('camera gesture publishes the latest pose once per frame and flushes the final pointer pose', () => {
  const frames = fakeFrames(),
    calls = [];
  const gesture = createCameraGestureFrame(
    (pose, phase) => calls.push({ ...pose, phase }),
    (callback) => frames.request(callback),
    (id) => frames.cancel(id),
  );
  gesture.move({ pitch: 10, bearing: 5 });
  gesture.move({ pitch: 20, bearing: 15 });
  assert.equal(frames.size, 1);
  frames.flush();
  assert.deepEqual(calls, [{ pitch: 20, bearing: 15, phase: 'move' }]);
  gesture.move({ pitch: 30, bearing: 25 });
  gesture.end({ pitch: 32, bearing: 27 });
  assert.equal(frames.size, 0);
  assert.deepEqual(calls.at(-1), { pitch: 32, bearing: 27, phase: 'end' });
});

test('camera gesture cancellation drops pending moves and signals cancellation after an applied move', () => {
  const frames = fakeFrames(),
    calls = [];
  const gesture = createCameraGestureFrame(
    (pose, phase) => calls.push({ ...pose, phase }),
    (callback) => frames.request(callback),
    (id) => frames.cancel(id),
  );
  gesture.move({ pitch: 12, bearing: 6 });
  gesture.cancel();
  assert.equal(frames.size, 0);
  assert.deepEqual(calls, []);
  gesture.move({ pitch: 18, bearing: 9 });
  frames.flush();
  gesture.cancel();
  assert.deepEqual(calls, [
    { pitch: 18, bearing: 9, phase: 'move' },
    { pitch: 18, bearing: 9, phase: 'cancel' },
  ]);
});
