import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { modelLabelAnchor } from '../modules/annotations/modelLabel.ts';

test('label stays six CSS pixels above the visible model at different heights and view angles', () => {
  const camera = new THREE.PerspectiveCamera(45, 390 / 844, 1, 10000);
  for (const geometry of [
    new THREE.BoxGeometry(60, 80, 100),
    new THREE.SphereGeometry(40, 24, 16),
    new THREE.CylinderGeometry(30, 30, 100, 24),
  ]) {
    const mesh = new THREE.Mesh(geometry);
    for (const elevation of [-200, 0, 500]) {
      mesh.position.set(10, 0, elevation);
      mesh.rotation.set(0.4, -0.3, 0.6);
      mesh.updateMatrixWorld(true);
      for (const angle of [0, 0.6, 1.1]) {
        camera.up.set(0, 0, 1);
        camera.position.set(200 * Math.sin(angle), -700 * Math.cos(angle), 850);
        camera.lookAt(mesh.position);
        camera.updateMatrixWorld(true);
        const projection = camera.projectionMatrix
          .clone()
          .multiply(camera.matrixWorldInverse);
        const anchor = modelLabelAnchor(mesh, projection, 390, 844);
        assert.ok(anchor);
        // Independently project geometry with Three's camera API.
        const vertices = [];
        const positions = geometry.attributes.position;
        for (let i = 0; i < positions.count; i++) {
          const p = new THREE.Vector3().fromBufferAttribute(positions, i);
          mesh.localToWorld(p);
          p.project(camera);
          vertices.push({ x: (p.x + 1) * 195, y: (1 - p.y) * 422 });
        }
        const top = vertices.reduce((a, b) => (a.y <= b.y ? a : b));
        assert.ok(Math.abs(top.y - anchor.y - 6) < 1e-6);
        assert.ok(
          vertices.some(
            (p) =>
              Math.abs(p.x - anchor.x) < 1e-6 &&
              Math.abs(p.y - anchor.y - 6) < 1e-6,
          ),
        );
      }
    }
    geometry.dispose();
    mesh.material.dispose();
  }
});

test('labels behind or crossing the camera near plane are hidden, never sent to infinity', () => {
  const camera = new THREE.PerspectiveCamera(45, 1, 1, 1000);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
  for (const z of [10, 0, -1.5]) {
    mesh.position.z = z;
    mesh.updateMatrixWorld(true);
    assert.equal(
      modelLabelAnchor(mesh, camera.projectionMatrix, 360, 780),
      null,
    );
  }
  mesh.position.z = -10;
  mesh.updateMatrixWorld(true);
  assert.ok(modelLabelAnchor(mesh, camera.projectionMatrix, 360, 780));
  mesh.geometry.dispose();
  mesh.material.dispose();
});
