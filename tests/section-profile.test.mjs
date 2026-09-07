import test from 'node:test';
import assert from 'node:assert/strict';
import { Matrix4, PerspectiveCamera, Vector3 } from 'three';
import {
  newAnnotation,
  altitudeRange,
  validAnnotation,
  parseAnnotations,
} from '../modules/annotations/data.ts';
import {
  mercator,
  planeBasis,
  planePoint,
} from '../modules/section/planeMath.ts';
import {
  objectProjector,
  transformAt,
} from '../modules/objectTransform/projection.ts';
import { loadedTerrainSampler } from '../modules/section/loadedTerrain.ts';
import {
  triangleCrossing,
  clipSegment,
  stitchSegments,
  modelSegments,
  contours,
  sampleSection,
  pointOnContour,
} from '../modules/section/contours.ts';
import {
  planePose,
  applyPlanePose,
  annotationPose,
  applyAnnotationPose,
  rotationDegrees,
  withRotationAxis,
  uprightPose,
} from '../modules/objectTransform/math.ts';
const settings = {
  enabled: true,
  altitude: 105,
  color: '#ffffff',
  plane: {
    center: [0, 0],
    width: 40,
    height: 40,
    heading: 0,
    tilt: 0,
    roll: 0,
  },
};
const near = (a, b, eps = 1e-5) =>
  assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const box = { ...newAnnotation('box', [0, 0], 100, 'box'), length: 10 };

test('old annotations stay relative; absolute centre survives parse and rejects nonfinite values', () => {
  near(altitudeRange(box).center, 105);
  const moved = { ...box, centerAltitude: 80, pitch: 40 };
  near(altitudeRange(parseAnnotations(JSON.stringify([moved]))[0]).center, 80);
  assert.equal(validAnnotation({ ...box, centerAltitude: NaN }), false);
  assert.equal(validAnnotation({ ...box, centerAltitude: Infinity }), false);
  assert.ok(altitudeRange({ ...moved, groundElevation: null }));
});
test('box centre section is a closed 10m square with actual sea altitudes', () => {
  const paths = contours(
    modelSegments(box, settings),
    settings,
    'model',
    'box',
    'box',
  );
  assert.equal(paths.length, 1);
  assert.equal(paths[0].closed, true);
  near(paths[0].length, 40);
  near(paths[0].min, 100);
  near(paths[0].max, 110);
  for (const p of paths[0].points) {
    near(p.local[1], 0);
    assert.ok(Math.max(Math.abs(p.u), Math.abs(p.v)) <= 5.00001);
  }
});
test('finite rectangle clips actual segments without inventing closing edges', () => {
  const small = { ...settings, plane: { ...settings.plane, width: 6 } };
  const curves = contours(
    modelSegments(box, small),
    small,
    'model',
    'box',
    'box',
  );
  assert.equal(curves.length, 2);
  curves.forEach((c) => {
    near(c.length, 6);
    assert.equal(c.closed, false);
  });
  const segment = clipSegment(
    [new Vector3(-100, 0, 0), new Vector3(100, 0, 0)],
    small,
  );
  near(segment[0].x, -3);
  near(segment[1].x, 3);
});
test('rotated model and arbitrary plane share the rendered mesh coordinate system', () => {
  const item = {
    ...box,
    pitch: 31,
    roll: -24,
    heading: 49,
    centerAltitude: 105,
  };
  const s = {
    ...settings,
    plane: { ...settings.plane, heading: 37, tilt: 22, roll: 43 },
  };
  const segments = modelSegments(item, s),
    n = planeBasis(37, 22, 43).n;
  assert.ok(segments.length > 3);
  for (const p of segments.flat()) near(p.dot(n), 0);
  const curve = contours(segments, s, 'model', 'box', 'b');
  assert.equal(curve.length, 1);
  assert.equal(curve[0].closed, true);
});
test('sphere and cylinder contours have the same dimensions as visible solids', () => {
  for (const kind of ['sphere', 'cylinder']) {
    const item = { ...box, kind };
    const curves = contours(
      modelSegments(item, settings),
      settings,
      'model',
      kind,
      kind,
    );
    assert.equal(curves.length, 1);
    assert.equal(curves[0].closed, true);
    near(curves[0].min, 100, 0.03);
    near(curves[0].max, 110, 0.03);
    near(curves[0].length, kind === 'sphere' ? Math.PI * 10 : 40, 0.1);
  }
});
test('coplanar triangle and tangent vertex do not invent a crossing', () => {
  const p = [new Vector3(), new Vector3(1, 0, 0), new Vector3(0, 0, 1)];
  assert.equal(triangleCrossing(p, [0, 0, 0]), null);
  assert.equal(triangleCrossing(p, [0, 1, 1]), null);
  assert.ok(triangleCrossing(p, [0, 0, 1]));
  assert.equal(triangleCrossing(p, [NaN, 0, 1]), null);
});
test('missing terrain splits curves; scrubber never crosses a data gap', () => {
  const s = {
    ...settings,
    altitude: 100,
    plane: { ...settings.plane, width: 1000, height: 100 },
  };
  const data = sampleSection(s, [], (ll) =>
    Math.abs(ll[0]) < 0.001 ? null : 100,
  );
  assert.equal(data.phase, 'partial');
  assert.equal(data.curves.length, 2);
  for (const c of data.curves) {
    for (const f of [0, 0.1, 0.5, 0.9, 1]) {
      const p = pointOnContour(c, f, s);
      near(p.altitude, 100, 0.001);
      assert.ok(Math.abs(p.coordinates[0]) >= 0.001);
      near(p.distance, c.length * f);
    }
  }
});
test('all unknown terrain yields no fabricated zero-elevation contour; model remains available', () => {
  const data = sampleSection(settings, [box], () => null);
  assert.equal(data.valid, 0);
  assert.equal(data.curves.length, 1);
  assert.equal(data.curves[0].source, 'model');
});
test('duplicate edges and branches stay distinct without joining unrelated lines', () => {
  const a = new Vector3(0, 0, 0),
    b = new Vector3(1, 0, 0),
    c = new Vector3(2, 0, 0),
    d = new Vector3(1, 0, 1);
  assert.equal(
    stitchSegments([
      [a, b],
      [b, a],
      [b, c],
      [b, d],
    ]).length,
    3,
  );
});
test('plane quaternion roundtrips through tilt poles and arbitrary rotations', () => {
  for (const heading of [-145, 0, 71])
    for (const tilt of [-90, -44, 0, 58, 90])
      for (const roll of [-138, 0, 73]) {
        const s = {
            ...settings,
            plane: { ...settings.plane, heading, tilt, roll },
          },
          round = applyPlanePose(s, planePose(s));
        near(
          planePoint(s, 3, 7).distanceTo(planePoint(round, 3, 7)),
          0,
          0.00001,
        );
      }
});
test('numeric rotation preserves position and size and agrees with rendered plane geometry', () => {
  const pose = planePose(settings);
  for (const axis of [0, 1, 2]) {
    const edited = withRotationAxis(pose, axis, 32.5);
    near(rotationDegrees(edited)[axis], 32.5, 0.00001);
    assert.deepEqual(edited.coordinates, pose.coordinates);
    assert.deepEqual(edited.size, pose.size);
    assert.equal(edited.altitude, pose.altitude);
    const converted = planePose(applyPlanePose(settings, edited));
    for (const basis of [new Vector3(1, 0, 0), new Vector3(0, 1, 0)]) {
      const a = basis
        .clone()
        .applyQuaternion({
          x: edited.rotation[0],
          y: edited.rotation[1],
          z: edited.rotation[2],
          w: edited.rotation[3],
        });
      const b = basis
        .clone()
        .applyQuaternion({
          x: converted.rotation[0],
          y: converted.rotation[1],
          z: converted.rotation[2],
          w: converted.rotation[3],
        });
      near(a.distanceTo(b), 0, 0.00001);
    }
  }
  for (const value of [NaN, Infinity, -361, 361])
    assert.equal(withRotationAxis(pose, 0, value), pose);
});
test('upright reset restores north-facing vertical plane without moving or resizing it', () => {
  const tilted = {
    ...settings,
    altitude: 1234,
    plane: {
      ...settings.plane,
      center: [103, 31],
      width: 278,
      height: 95,
      heading: 48,
      tilt: 35,
      roll: 63,
    },
  };
  const reset = applyPlanePose(tilted, uprightPose(planePose(tilted), 'plane'));
  near(reset.plane.heading, 0, 0.00001);
  near(reset.plane.tilt, 0, 0.00001);
  near(reset.plane.roll, 0, 0.00001);
  assert.deepEqual(reset.plane.center, tilted.plane.center);
  assert.equal(reset.plane.width, 278);
  assert.equal(reset.plane.height, 95);
  assert.equal(reset.altitude, 1234);
  for (const angle of rotationDegrees(uprightPose(planePose(tilted), 'box')))
    near(angle, 0, 0.00001);
});
test('on-object rays translate along the rendered local axes and keep the opposite coordinates', () => {
  const pose = annotationPose({ ...box, centerAltitude: 0 }),
    m = mercator(pose.coordinates),
    camera = new PerspectiveCamera(50, 390 / 844, 0.1, 1000);
  camera.position.set(40, -70, 60);
  camera.up.set(0, 0, 1);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const world = new Matrix4()
    .makeTranslation(m.x, m.y, 0)
    .scale(new Vector3(m.unit, -m.unit, m.unit));
  const frame = {
    width: 390,
    height: 844,
    longitude: 0,
    matrix: camera.projectionMatrix
      .clone()
      .multiply(camera.matrixWorldInverse)
      .multiply(world.invert())
      .toArray(),
  };
  const p = objectProjector(frame, pose),
    from = p.project(new Vector3(12, 0, 0)),
    to = p.project(new Vector3(17, 0, 0));
  const next = transformAt(
    pose,
    p,
    { mode: 'move', axis: 'x' },
    from,
    to,
    'box',
  );
  near((mercator(next.coordinates).x - m.x) / m.unit, 5, 0.00001);
  near(next.altitude, 0);
  near(next.coordinates[1], 0);
  const rotated = transformAt(
    pose,
    p,
    { mode: 'rotate', axis: 'z' },
    p.project(new Vector3(10, 0, 0)),
    p.project(new Vector3(0, 10, 0)),
    'box',
  );
  near(applyAnnotationPose(box, rotated).heading, -90, 0.00001);
  near(rotated.altitude, 0);
});
test('unloaded DEM placeholder is unknown; genuinely loaded sea level remains a valid zero', () => {
  const tile = new Map([['0/0/0/0', null]]),
    map = {
      terrain: {
        getCoverageIndex: () => ({ zooms: [0], samplerPerTile: tile }),
      },
      getCenter: () => ({ lng: 0 }),
    };
  assert.equal(loadedTerrainSampler(map)([0, 0]), null);
  tile.set('0/0/0/0', () => 0);
  assert.equal(loadedTerrainSampler(map)([0, 0]), 0);
  tile.clear();
  assert.equal(loadedTerrainSampler(map)([0, 0]), null);
});
