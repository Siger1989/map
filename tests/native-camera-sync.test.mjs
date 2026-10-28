import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeCameraSync } from '../modules/map/native/cameraSync.ts';

const camera = (patch = {}) => ({ center: [102.9, 31], zoom: 12, pitch: 55, bearing: 20, ...patch });

test('repeated frames after a linked apply never echo back or alter the shared target zoom', () => {
  const main = new NativeCameraSync(), auxiliary = new NativeCameraSync();
  const target = camera(), before = JSON.stringify(target);
  main.apply(target, camera({ zoom: 11 })); auxiliary.apply(target, camera({ center: [102, 30] }));
  let echoes = 0;
  for (let frame = 0; frame < 100; frame++) {
    for (const sync of [main, auxiliary]) {
      const actual = camera({ center: [102.9 + 1e-10, 31 - 1e-10], zoom: 12 + 1e-12 });
      if (!sync.isProgrammatic(actual)) echoes++;
    }
  }
  assert.equal(echoes, 0);
  assert.equal(JSON.stringify(target), before);
});

test('queued old native frames before applying the new camera do not bounce the old view back', () => {
  const sync = new NativeCameraSync(), previous = camera({ zoom: 7 });
  sync.apply(camera(), previous);
  assert.equal(sync.isProgrammatic(previous), true);
  assert.equal(sync.isProgrammatic(camera()), true);
  assert.equal(sync.isProgrammatic(camera()), true);
});

test('real user DOWN releases programmatic suppression even at the same camera then forwards the gesture', () => {
  const sync = new NativeCameraSync(); sync.apply(camera(), null);
  assert.equal(sync.isProgrammatic(camera()), true);
  sync.beginUserGesture();
  assert.equal(sync.isProgrammatic(camera()), false);
  assert.equal(sync.isProgrammatic(camera({ pitch: 65, bearing: 35 })), false);
});

test('clearly different unscripted camera changes publish and snapshots do not alias targets', () => {
  const sync = new NativeCameraSync(), target = camera(); sync.apply(target, null);
  target.center[0] = 100; target.zoom = 7;
  assert.equal(sync.isProgrammatic(camera()), true);
  assert.equal(sync.isProgrammatic(camera({ zoom: 13 })), false);
  assert.equal(sync.isProgrammatic(camera()), false);
});

test('native wrapped bearings do not echo an equivalent negative or cross-180 heading', () => {
  const sync = new NativeCameraSync();
  sync.apply(camera({ bearing: -25 }), null);
  assert.equal(sync.isProgrammatic(camera({ bearing: 335 })), true);
  sync.apply(camera({ bearing: 181 }), null);
  assert.equal(sync.isProgrammatic(camera({ bearing: -179 })), true);
  assert.equal(sync.isProgrammatic(camera({ bearing: -178 })), false);
});
