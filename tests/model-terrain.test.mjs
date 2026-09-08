import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Matrix4, Vector3, Raycaster } from 'three';
import {
  newAnnotation,
  altitudeRange,
  validAnnotation,
  volume,
} from '../modules/annotations/data.ts';
import {
  modelGeometry,
  modelRotation,
} from '../modules/annotations/modelGeometry.ts';
import { validFootprint } from '../modules/annotations/footprint.ts';
import { outlineModel } from '../modules/areas/extrude.ts';
import { modelColumn, terrainPatch } from '../modules/modelTerrain/geometry.ts';
import { injectModelMask } from '../modules/modelTerrain/terrainMask.ts';
import { modelSectionLoops } from '../modules/section/models.ts';

const base = {
  ...newAnnotation('box', [104, 30], 100, 'box'),
  width: 20,
  length: 30,
  height: 10,
};
test('vertical solid intervals and missing terrain never invent excavation', () => {
  assert.deepEqual(modelColumn(base).intervals(0, 0), [[100, 110]]);
  assert.deepEqual(modelColumn(base).intervals(50, 0), []);
  const buried = { ...base, placement: 'underground', offset: 5 };
  assert.deepEqual(modelColumn(buried).intervals(0, 0), [[85, 95]]);
  const patch = terrainPatch(buried, () => 100, 8);
  assert.ok(patch.mask.every((v) => v === 255));
  assert.ok(patch.walls.length && patch.faces.length && patch.rim.length);
  const disabled = terrainPatch({ ...buried, terrainCut: false }, () => 100, 8);
  assert.ok(disabled.mask.every((v) => !v));
  const missing = terrainPatch(buried, () => null, 8);
  assert.equal(missing.valid, 0);
  assert.equal(missing.faces.length, 0);
  assert.equal(missing.walls.length, 0);
  assert.ok(missing.mask.every((v) => !v));
  const hillside = terrainPatch(
    { ...base, terrainCut: true },
    ([lng]) => 105 + (lng - 104) * 1e5,
    16,
  );
  assert.ok(hillside.faces.length > 0);
  assert.ok(hillside.mask.some((v) => v) && hillside.mask.some((v) => !v));
});
test('rotated sphere, cylinder, box and concave prism use the same real vertical extent as their mesh', () => {
  for (const kind of ['box', 'cylinder', 'sphere', 'prism']) {
    const item = {
      ...newAnnotation(kind, [104, 30], 100, kind),
      width: 20,
      length: 30,
      height: 10,
      pitch: 28,
      roll: 36,
      heading: 15,
      placement: 'underground',
    };
    const range = altitudeRange(item),
      g = modelGeometry(item),
      rot = new Matrix4().makeRotationFromEuler(modelRotation(item));
    for (let i = 0; i < g.attributes.position.count; i++) {
      const p = new Vector3()
        .fromBufferAttribute(g.attributes.position, i)
        .applyMatrix4(rot);
      p.z += range.center;
      assert.ok(p.z >= range.bottom - 1e-5 && p.z <= range.top + 1e-5, kind);
    }
    assert.equal(range.top, 100);
    assert.ok(modelColumn(item).intervals(0, 0).length > 0, kind);
    g.dispose();
  }
});
test('outline extrusion preserves concavity and rejects self-crossing imports', () => {
  const ring = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0],
    [0, 0],
    [0, 0.5],
    [-0.5, 0.5],
  ];
  const prism = {
    ...newAnnotation('prism', [104, 30], 100, 'prism'),
    width: 20,
    length: 20,
    height: 10,
    footprint: ring,
  };
  assert.ok(validAnnotation(prism));
  assert.equal(volume(prism), 3000);
  assert.deepEqual(modelColumn(prism).intervals(5, -5), []);
  assert.deepEqual(modelColumn(prism).intervals(-5, 5), [[100, 110]]);
  const loops = modelSectionLoops(prism, 105);
  assert.equal(loops.length, 1);
  const area =
    Math.abs(
      loops[0].reduce((sum, p, i) => {
        const q = loops[0][(i + 1) % loops[0].length];
        return sum + p[0] * q[1] - q[0] * p[1];
      }, 0),
    ) / 2;
  assert.ok(
    Math.abs(area - 300) < 0.001,
    'section must not convex-fill the notch',
  );
  assert.equal(
    validFootprint([
      [-0.5, -0.5],
      [0.5, 0.5],
      [-0.5, 0.5],
      [0.5, -0.2],
    ]),
    false,
  );
  const outline = {
    name: 'L形',
    color: '#ffee00',
    boundary: [
      ...ring.map(([x, y]) => [104 + x * 0.001, 30 + y * 0.001]),
      [103.9995, 29.9995],
    ],
  };
  const converted = outlineModel(outline, 20);
  assert.ok(validFootprint(converted.footprint));
  assert.equal(converted.footprint.length, 6);
  assert.ok(converted.width > 90 && converted.width < 100);
});
test('terrain shader adapter matches installed colour shaders and leaves picking/depth sampling untouched', () => {
  const read = (name) =>
    readFileSync(
      `node_modules/maplibre-gl/src/shaders/glsl/${name}.glsl`,
      'utf8',
    );
  const vertex = injectModelMask(read('terrain.vertex'), true),
    fragment = injectModelMask(read('terrain.fragment'), false);
  assert.match(vertex, /v_model_point = modelPoint.xyz/);
  assert.match(fragment, /discard/);
  assert.equal(
    injectModelMask(read('terrain_depth.vertex'), true),
    read('terrain_depth.vertex'),
  );
  assert.equal(
    injectModelMask(read('terrain_depth.fragment'), false),
    read('terrain_depth.fragment'),
  );
});
