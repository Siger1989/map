import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { modelSection } from '../modules/section/models.ts';
import { newAnnotation, altitudeRange } from '../modules/annotations/data.ts';
const close = (a, b, error = 1e-7) =>
  assert.ok(Math.abs(a - b) <= error, `${a} differs from ${b}`);
const area = (points) =>
  Math.abs(
    points.reduce((sum, p, i) => {
      const q = points[(i + 1) % points.length];
      return sum + p[0] * q[1] - p[1] * q[0];
    }, 0),
  ) / 2;
test('horizontal cuboid sections use real altitude, dimensions, orientation and underground depth', () => {
  const item = {
    ...newAnnotation('box', [104, 30], 1000, 'box'),
    width: 8,
    length: 20,
    height: 6,
  };
  close(area(modelSection(item, 1003)), 160);
  close(area(modelSection(item, 1000)), 160);
  assert.deepEqual(modelSection(item, 999), []);
  assert.deepEqual(modelSection(item, 1007), []);
  const pitched = { ...item, pitch: 90 };
  close(area(modelSection(pitched, altitudeRange(pitched).center)), 48);
  const rolled = { ...item, roll: 90 };
  close(area(modelSection(rolled, altitudeRange(rolled).center)), 120);
  const rotated = modelSection({ ...item, heading: 90 }, 1003);
  close(
    Math.max(...rotated.map((p) => p[0])) -
      Math.min(...rotated.map((p) => p[0])),
    20,
  );
  const underground = { ...item, placement: 'underground', offset: 10 };
  close(area(modelSection(underground, 987)), 160);
  assert.deepEqual(modelSection(underground, 991), []);
});
test('arbitrary box rotations agree with the actual Three.js model transform', () => {
  const item = {
    ...newAnnotation('box', [104, 30], 1000, 'box'),
    width: 8,
    length: 20,
    height: 6,
    pitch: 33,
    roll: -21,
    heading: 127,
  };
  const range = altitudeRange(item),
    inverse = new THREE.Matrix4()
      .makeRotationFromEuler(
        new THREE.Euler(
          (item.pitch * Math.PI) / 180,
          (item.roll * Math.PI) / 180,
          (-item.heading * Math.PI) / 180,
          'ZYX',
        ),
      )
      .invert();
  for (const ratio of [0.1, 0.5, 0.9]) {
    const height = range.bottom + (range.top - range.bottom) * ratio;
    const polygon = modelSection(item, height);
    assert.ok(area(polygon) > 0);
    for (const [x, y] of polygon) {
      const p = new THREE.Vector3(x, y, height - range.center).applyMatrix4(
        inverse,
      );
      const margins = [
        4 - Math.abs(p.x),
        10 - Math.abs(p.y),
        3 - Math.abs(p.z),
      ];
      assert.ok(margins.every((m) => m >= -1e-7));
      assert.ok(
        Math.min(...margins) < 1e-7,
        'intersection vertex lies on the solid surface',
      );
    }
  }
});
test('sphere and cylinder sections change size correctly and do not appear without an intersection', () => {
  const sphere = newAnnotation('sphere', [104, 30], 1000, 'sphere');
  close(area(modelSection(sphere, 1005)), Math.PI * 25, 0.2);
  close(area(modelSection(sphere, 1008)), Math.PI * 16, 0.15);
  assert.deepEqual(modelSection(sphere, 1010), []);
  const cylinder = {
    ...newAnnotation('cylinder', [104, 30], 1000, 'cylinder'),
    height: 20,
  };
  close(area(modelSection(cylinder, 1010)), Math.PI * 25, 0.2);
  const sideways = { ...cylinder, pitch: 90 };
  close(area(modelSection(sideways, altitudeRange(sideways).center)), 200);
  assert.deepEqual(modelSection({ ...sphere, visible: false }, 1005), []);
  assert.deepEqual(
    modelSection({ ...sphere, groundElevation: null }, 1005),
    [],
  );
  assert.deepEqual(
    modelSection(newAnnotation('pin', [104, 30], 1000, 'pin'), 1000),
    [],
  );
});
