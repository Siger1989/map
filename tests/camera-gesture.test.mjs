import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import {
  createCameraGestureFrame,
  orbitCamera,
  canStartRingDrag,
  ringAngle,
  rotateCameraRing,
  shapeOrbitDisplacement,
  wrapBearing,
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
    bearing: wrapBearing(shapeOrbitDisplacement(20)),
  });
  assert.deepEqual(orbitCamera({ pitch: 40, bearing: 0 }, 0, -20), {
    pitch: 40 + shapeOrbitDisplacement(20),
    bearing: 0,
  });
  assert.deepEqual(orbitCamera({ pitch: 40, bearing: 0 }, 20, -20), {
    pitch: 40 + shapeOrbitDisplacement(20),
    bearing: wrapBearing(shapeOrbitDisplacement(20)),
  });
});

test('model drag filters touch jitter and eases small inputs while preserving reversals and large movement', () => {
  assert.equal(shapeOrbitDisplacement(1), 0, 'sub-deadzone input is ignored');
  assert.equal(shapeOrbitDisplacement(-1), 0, 'deadzone is symmetric');
  const small = shapeOrbitDisplacement(4);
  assert.ok(small > 0 && small < 4 * 1.35 * 0.5, 'small intentional motion has a softer response');
  assert.equal(shapeOrbitDisplacement(-4), -small, 'changing direction remains symmetric and reversible');
  const atEaseEnd = shapeOrbitDisplacement(11.5);
  assert.ok(Math.abs(shapeOrbitDisplacement(12.5) - atEaseEnd - 1.35) < 1e-12, 'full gain resumes smoothly after the low-input range');
  assert.ok(shapeOrbitDisplacement(40) > 40, 'deliberate large drags retain substantial camera travel');
  assert.deepEqual(orbitCamera({ pitch: 40, bearing: 10 }, 4, -4), {
    pitch: 40 + small,
    bearing: 10 + small,
  });
});

test('camera drag clamps tilt and wraps direction at north without blocking the other axis', () => {
  assert.deepEqual(orbitCamera({ pitch: 80, bearing: 175 }, 20, -100), {
    pitch: 80,
    bearing: wrapBearing(175 + shapeOrbitDisplacement(20)),
  });
  assert.deepEqual(orbitCamera({ pitch: 0, bearing: -175 }, -20, 100), {
    pitch: 0,
    bearing: wrapBearing(-175 - shapeOrbitDisplacement(20)),
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

test('rendered gizmo accepts model drags in the ring deadzone while keeping ring start and cancellation rules', async (t) => {
  const { parseHTML } = await import('linkedom');
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  const captures = new WeakMap();
  window.PointerEvent = window.Event;
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  let nextFrame = 1;
  const frames = new Map();
  globalThis.requestAnimationFrame = callback => { const id = nextFrame++; frames.set(id, callback); return id; };
  globalThis.cancelAnimationFrame = id => frames.delete(id);
  const frame = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(0)); };
  await build({
    entryPoints: ['modules/controls/CameraGizmo.tsx'],
    outfile: '.openai/camera-gizmo-test/CameraGizmo.js',
    bundle: true,
    format: 'esm',
    platform: 'node',
    packages: 'external',
    jsx: 'automatic',
  });
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { CameraGizmo } = await import('../.openai/camera-gizmo-test/CameraGizmo.js');
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await React.act(async () => root.unmount());
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    delete globalThis.requestAnimationFrame;
    delete globalThis.cancelAnimationFrame;
  });
  const calls = [];
  await React.act(async () => root.render(React.createElement(CameraGizmo, {
    view: { pitch: 40, bearing: 0, zoom: 12, latitude: 0, longitude: 0 },
    onView() {},
    onGestureView: (pitch, bearing, phase) => calls.push({ pitch, bearing, phase }),
  })));
  const svg = document.querySelector('.camera-gizmo svg');
  svg.setPointerCapture = id => captures.set(svg, id);
  svg.hasPointerCapture = id => captures.get(svg) === id;
  svg.releasePointerCapture = id => { if (captures.get(svg) === id) captures.delete(svg); };
  svg.getScreenCTM = () => ({ inverse: () => ({}) });
  svg.createSVGPoint = () => ({ x: 0, y: 0, matrixTransform() { return this; } });
  const pointer = (type, id, x, y) => {
    const event = new window.Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { pointerId: id, pointerType: 'touch', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y });
    return event;
  };
  const model = () => document.querySelector('.camera-model');
  const ring = () => document.querySelector('.camera-ring');

  await React.act(async () => {
    model().dispatchEvent(pointer('pointerdown', 1, 55, 81));
    svg.dispatchEvent(pointer('pointermove', 1, 65, 71));
    svg.dispatchEvent(pointer('pointerup', 1, 65, 71));
  });
  assert.deepEqual(calls, [{ pitch: 40 + shapeOrbitDisplacement(10), bearing: wrapBearing(shapeOrbitDisplacement(10)), phase: 'end' }], 'the model can tilt and rotate from a point inside the ring deadzone');
  assert.equal(svg.hasPointerCapture(1), false, 'pointerup releases capture');

  await React.act(async () => ring().dispatchEvent(pointer('pointerdown', 2, 55, 81)));
  assert.equal(svg.hasPointerCapture(2), false, 'the bearing ring still rejects a deadzone start');

  await React.act(async () => {
    model().dispatchEvent(pointer('pointerdown', 3, 55, 81));
    svg.dispatchEvent(pointer('pointermove', 3, 60, 81));
    frame();
    svg.dispatchEvent(pointer('lostpointercapture', 3, 60, 81));
  });
  assert.equal(calls.at(-1).phase, 'cancel', 'lost pointer capture cancels an active model gesture');
  assert.equal(svg.hasPointerCapture(3), false);

  await React.act(async () => {
    model().dispatchEvent(pointer('pointerdown', 4, 55, 81));
    svg.dispatchEvent(pointer('pointermove', 4, 55, 76));
    frame();
    svg.dispatchEvent(pointer('pointercancel', 4, 55, 76));
  });
  assert.equal(calls.at(-1).phase, 'cancel', 'pointercancel cancels an active model gesture');
  assert.equal(svg.hasPointerCapture(4), false);
});
