import test from 'node:test';
import assert from 'node:assert/strict';
import { objectProjector } from '../modules/objectTransform/projection.ts';

test('object gizmo projects WGS84 poses through native ECEF frame and preserves local ray/axis contract', () => {
  const viewProjection = [
    1 / 6378137, 0, 0, 0,
    0, 1 / 6378137, 0, 0,
    0, 0, 1 / 6378137, 0,
    -1, 0, 0, 1,
  ];
  const nativeFrame = {
    sequence: 1,
    camera: { center: [0, 0], zoom: 8, pitch: 0, bearing: 0 },
    viewProjection,
    inverseViewProjection: invert(viewProjection),
    viewport: { x: 400, y: 100, width: 200, height: 100 },
    cssScale: 2,
    clipDepth: 'minusOneToOne',
    demRevision: 0,
    capturedAt: 1,
  };
  const projector = objectProjector({ matrix: viewProjection, nativeFrame, width: 100, height: 50, longitude: 0 }, {
    coordinates: [0, 0], altitude: 0, rotation: [0, 0, 0, 1], size: [10, 20, 30],
  });
  assert.ok(Math.abs(projector.center.x - 50) < 1e-6);
  assert.ok(Math.abs(projector.center.y - 25) < 1e-6);
  assert.equal(projector.center.visible, true);
  assert.equal(projector.axes.length, 3);
  assert.ok(projector.radius > 0);
  const ray = projector.ray({ x: 50, y: 25 });
  assert.ok(ray.origin.toArray().every(Number.isFinite));
  assert.ok(ray.direction.toArray().every(Number.isFinite));
  assert.ok(Math.abs(ray.direction.length() - 1) < 1e-10);
});

function invert(m) {
  const inv = [
    6378137,0,0,0,
    0,6378137,0,0,
    0,0,6378137,0,
    6378137,0,0,1,
  ];
  return inv;
}
