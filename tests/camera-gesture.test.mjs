import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCameraGestureFrame,
  orbitCamera,
} from '../modules/controls/cameraGesture.ts';

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
