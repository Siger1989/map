import test from 'node:test';
import assert from 'node:assert/strict';
import { orbitCamera } from '../modules/controls/cameraGesture.ts';

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
