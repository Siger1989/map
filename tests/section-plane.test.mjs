import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
const bundled = await build({
  stdin: {
    contents:
      "export * from './modules/section/planeMath.ts';export * from './modules/section/terrainClip.ts';export * from './modules/section/planeModels.ts';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  external: ['three'],
});
// Keep package resolution rooted in this test, avoiding node's data URL resolution.
const source = bundled.outputFiles[0].text.replaceAll(
  'from "three"',
  `from "${new URL('../node_modules/three/build/three.module.js', import.meta.url).href}"`,
);
const {
  planeBasis,
  removedByPlane,
  clipFaceTriangle,
  localMatrix,
  injectTerrainClip,
  clipModelPolygon,
  applyModelPlane,
} = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);
const settings = {
  enabled: true,
  altitude: 1000,
  color: '#ffffff',
  plane: { center: [103, 31], width: 100, height: 80, heading: 0, tilt: 0 },
};
test('finite plane preserves terrain outside rectangle and switches only near side', () => {
  for (const heading of [-170, -24, 0, 90, 180])
    for (const tilt of [-90, -30, 0, 45, 90]) {
      const s = { ...settings, plane: { ...settings.plane, heading, tilt } },
        b = planeBasis(heading, tilt);
      assert.ok(Math.abs(b.u.dot(b.v)) < 1e-12);
      assert.ok(Math.abs(b.n.length() - 1) < 1e-12);
      assert.equal(removedByPlane(b.n.clone().multiplyScalar(10), s, 1), true);
      assert.equal(
        removedByPlane(b.n.clone().multiplyScalar(10), s, -1),
        false,
      );
      assert.equal(
        removedByPlane(
          b.n.clone().multiplyScalar(10).addScaledVector(b.u, 51),
          s,
          1,
        ),
        false,
      );
      assert.equal(
        removedByPlane(
          b.n.clone().multiplyScalar(10).addScaledVector(b.v, 41),
          s,
          1,
        ),
        false,
      );
    }
});
test('cap triangle intersects slope, preserves fully inside and rejects missing samples', () => {
  const p = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(10, 0, 0),
    new THREE.Vector3(0, 0, 10),
  ];
  const cut = clipFaceTriangle(p, [-5, -5, 5]);
  assert.equal(cut.polygon.length, 4);
  assert.equal(cut.rim.length, 2);
  assert.ok(cut.rim.every((v) => Math.abs(v.z - 5) < 1e-8));
  assert.equal(clipFaceTriangle(p, [-1, -2, -3]).polygon.length, 3);
  assert.equal(clipFaceTriangle(p, [1, 2, 3]).polygon.length, 0);
  assert.equal(clipFaceTriangle(p, [NaN, -2, 3]).polygon.length, 0);
});
test('GPU shader adapter matches installed terrain shaders but leaves picking depth unchanged', async () => {
  const root = 'node_modules/maplibre-gl/src/shaders/glsl/';
  for (const [file, vertex] of [
    ['terrain.vertex.glsl', true],
    ['terrain.fragment.glsl', false],
  ]) {
    const source = await readFile(root + file, 'utf8'),
      modified = injectTerrainClip(source, vertex);
    assert.notEqual(modified, source);
    assert.equal((modified.match(/void main/g) || []).length, 1);
    assert.match(
      modified,
      vertex ? /u_section_inverse \* gl_Position/ : /discard/,
    );
  }
  for (const [file, vertex] of [
    ['terrain_depth.vertex.glsl', true],
    ['terrain_depth.fragment.glsl', false],
    ['raster.fragment.glsl', false],
  ]) {
    const source = await readFile(root + file, 'utf8');
    assert.equal(injectTerrainClip(source, vertex), source);
  }
});
test('local projection roundtrip remains stable at model scale', () => {
  const matrix = localMatrix(settings),
    p = new THREE.Vector3(10, 30, 50);
  assert.ok(
    p
      .clone()
      .applyMatrix4(matrix)
      .applyMatrix4(matrix.clone().invert())
      .distanceTo(p) < 1e-6,
  );
});
test('model cap polygon respects the finite rectangle edge', () => {
  const polygon = [
    [-100, -20],
    [100, -20],
    [100, 20],
    [-100, 20],
  ].map(([x, y]) => new THREE.Vector3(x, y, 0));
  const cut = clipModelPolygon(polygon, new THREE.Vector3(1, 0, 0), 50);
  assert.equal(cut.length, 4);
  assert.ok(cut.every((p) => p.x <= 50));
  assert.equal(
    clipModelPolygon(polygon, new THREE.Vector3(1, 0, 0), -150).length,
    0,
  );
});

test('all solid shapes receive a bounded cap and clipping restores cleanly', () => {
  for (const kind of ['box', 'sphere', 'cylinder'])
    for (const tilt of [0, 35, 90]) {
      const scene = new THREE.Scene(),
        geometry =
          kind === 'box'
            ? new THREE.BoxGeometry(20, 30, 40)
            : kind === 'sphere'
              ? new THREE.SphereGeometry(15, 24, 16)
              : new THREE.CylinderGeometry(12, 12, 30, 24);
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({ color: '#3399aa' }),
      );
      mesh.userData.annotationId = 'test';
      mesh.rotation.set(0.2, 0.1, 0.3);
      scene.add(mesh);
      const s = {
        ...settings,
        altitude: 0,
        plane: {
          ...settings.plane,
          center: [0, 0],
          width: 14,
          height: 18,
          tilt,
        },
      };
      const origin = {
        x: 0.5,
        y: 0.5,
        meterInMercatorCoordinateUnits: () => 1 / 40075016.68557849,
      };
      applyModelPlane(scene, origin, s, 1);
      assert.equal(mesh.material.clippingPlanes.length, 5);
      assert.equal(mesh.material.clipIntersection, true);
      const cap = scene.getObjectByName('free-section-cap');
      assert.ok(cap, `${kind}/${tilt}`);
      const positions = cap.geometry.getAttribute('position'),
        basis = planeBasis(0, tilt);
      for (let i = 0; i < positions.count; i++) {
        const p = new THREE.Vector3().fromBufferAttribute(positions, i);
        assert.ok(Math.abs(p.dot(basis.n)) < 1e-5);
        assert.ok(Math.abs(p.dot(basis.u)) <= 7.001);
        assert.ok(Math.abs(p.dot(basis.v)) <= 9.001);
      }
      const inside = new THREE.Vector3(0, -2, 0);
      if (tilt === 0)
        assert.ok(
          mesh.material.clippingPlanes.every(
            (plane) => plane.distanceToPoint(inside) < 0,
          ),
          'all five planes jointly remove the near volume',
        );
      applyModelPlane(scene, origin, null, 1);
      assert.equal(mesh.material.clippingPlanes.length, 0);
      assert.equal(scene.getObjectByName('free-section-cap'), undefined);
    }
});
