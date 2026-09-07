import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSession,
  advance,
  rejoinTarget,
  freshFix,
} from '../modules/guidance/session.ts';
import {
  pathOf,
  project,
  pointAt,
  nextInstruction,
} from '../modules/guidance/geometry.ts';
import { metresBetween } from '../modules/navigation/types.ts';
import { GuidanceLayer } from '../modules/guidance/GuidanceLayer.ts';
import { validateRejoinEndpoints } from '../modules/guidance/rejoin.ts';
const route = (
  points = [
    [0, 0],
    [0.005, 0],
    [0.01, 0],
  ],
  via = [],
) => ({
  mode: 'pedestrian',
  coordinates: points,
  distance: 1112,
  duration: 800,
  steps: [
    {
      instruction: '出发',
      distance: 556,
      duration: 400,
      elapsedSeconds: 0,
      coordinates: points.slice(0, 2),
    },
    {
      instruction: '右转',
      distance: 556,
      duration: 400,
      elapsedSeconds: 400,
      coordinates: points.slice(1),
    },
  ],
  snapped: [points[0], ...via, points.at(-1)],
  createdAt: 1,
});
const fix = (x, y = 0, seconds = 0, accuracy = 5) => ({
  coordinates: [x, y],
  timestamp: 100000 + seconds * 1000,
  accuracy,
});
const step = (s, f, error = '') => advance(s, f, f.timestamp, error);
const approx = (a, b, tolerance = 1) =>
  assert.ok(Math.abs(a - b) < tolerance, `${a} vs ${b}`);
test('navigation starts at zero walked distance; accepted GPS fixes update distance and remaining route', () => {
  let s = createSession(route(), 100000);
  s = step(s, fix(0));
  assert.equal(s.travelled, 0);
  assert.equal(s.quality, '');
  s = step(s, fix(0.001, 0, 20));
  approx(s.travelled, 111.2);
  approx(s.progress, 111.2);
  assert.equal(s.offRoute, false);
  approx(s.path.length - s.progress, 1000.8);
  assert.equal(
    nextInstruction(s.route, s.progress, s.path.length).text,
    '右转',
  );
});
test('jitter, duplicate timestamps, poor accuracy and implausible jumps never fabricate walking distance', () => {
  let s = step(createSession(route()), fix(0));
  for (let i = 1; i < 8; i++) s = step(s, fix(i % 2 ? 0.000005 : 0, 0, i));
  assert.equal(s.travelled, 0);
  const duplicate = s;
  assert.equal(advance(s, s.last, s.last.timestamp + 3000), duplicate);
  s = step(s, fix(0.008, 0.004, 10, 150));
  assert.equal(s.travelled, 0);
  assert.match(s.quality, /精度/);
  s = step(s, fix(0.008, 0, 11));
  assert.equal(s.travelled, 0);
  assert.match(s.quality, /跳动/);
  s = step(s, fix(0, 0, 12));
  assert.equal(s.travelled, 0);
});
test('stale, missing, future and permission-denied fixes cannot advance or confirm a deviation', () => {
  let s = step(createSession(route()), fix(0));
  for (const f of [
    null,
    { ...fix(0.001), timestamp: NaN },
    fix(0.001, 0, 100),
    fix(0.001, 0, 0, -1),
  ])
    assert.equal(freshFix(f, 100000), false);
  const stale = advance(s, fix(0.005), 121000);
  assert.match(stale.quality, /过期/);
  assert.equal(stale.travelled, 0);
  const denied = step(s, fix(0.001, 0, 10), '定位权限未允许');
  assert.equal(denied.progress, 0);
  assert.equal(denied.offRoute, false);
});
test('two distinct reliable fixes over three seconds confirm departure; repeated ticks do not', () => {
  let s = step(createSession(route()), fix(0));
  s = step(s, fix(0, 0.0006, 10));
  assert.equal(s.offRoute, false);
  s = advance(s, s.last, s.last.timestamp + 4000);
  assert.equal(s.offRoute, false);
  s = step(s, fix(0, 0.0006, 14));
  assert.equal(s.offRoute, true);
  assert.ok(rejoinTarget(s).offset > 60);
  s = step(s, fix(0, 0, 25));
  assert.equal(s.offRoute, false);
  assert.equal(s.offSince, null);
});
test('an inaccurate fix interrupts deviation confirmation; a real backtrack increases remaining distance', () => {
  let s = step(createSession(route()), fix(0));
  s = step(s, fix(0.002, 0, 25));
  const forward = s.progress;
  s = step(s, fix(0.001, 0, 40));
  assert.ok(s.progress < forward);
  s = step(s, fix(0.001, 0.0006, 50));
  s = step(s, fix(0.001, 0.0006, 52, 100));
  s = step(s, fix(0.001, 0.0006, 54));
  assert.equal(s.offRoute, false);
  s = step(s, fix(0.001, 0.0006, 58));
  assert.equal(s.offRoute, true);
});
test('GPS gaps restart the distance anchor instead of joining unseen travel', () => {
  let s = step(createSession(route()), fix(0));
  s = step(s, fix(0.004, 0, 60));
  assert.equal(s.travelled, 0);
  assert.equal(s.gap, true);
  s = step(s, fix(0.0045, 0, 70));
  approx(s.travelled, 55.6);
});
test('next unvisited waypoint bounds matching and the rejoin target', () => {
  const r = route(undefined, [[0.005, 0]]);
  let s = step(createSession(r), fix(0.008, 0.001));
  assert.equal(s.nextCheckpoint, 0);
  assert.ok(rejoinTarget(s).distance <= s.checkpoints[0].distance);
  s = step(s, fix(0.005, 0, 60));
  assert.equal(s.nextCheckpoint, 1);
  s = step(s, fix(0.008, 0, 100));
  assert.ok(s.progress > s.checkpoints[0].distance);
});
test('closed routes do not report arrival at their start and crossings prefer nearby progress', () => {
  const r = route([
    [0, 0],
    [0.01, 0],
    [0.01, 0.01],
    [0, 0.01],
    [0, 0],
  ]);
  let s = step(createSession(r), fix(0));
  s = step(s, fix(0, 0, 5));
  assert.equal(s.arrived, false);
  assert.equal(s.progress, 0);
  const p = pathOf([
    [0, 0],
    [0.01, 0.01],
    [0, 0.01],
    [0.01, 0],
  ]);
  const first = project(p, [0.005, 0.005], 0, p.length, 0),
    last = project(p, [0.005, 0.005], 0, p.length, p.length);
  assert.ok(last.distance - first.distance > 1000);
  assert.equal(
    project(p, [0.005, 0.005], first.distance - 50, first.distance + 50)
      .distance,
    first.distance,
  );
});
test('arrival requires two current fixes near the end; completion preserves the summary', () => {
  let s = step(createSession(route()), fix(0.0099));
  assert.equal(s.arrived, false);
  s = step(s, fix(0.0099, 0, 4));
  assert.equal(s.arrived, true);
  assert.equal(s.progress, s.path.length);
  assert.equal(step(s, fix(0, 0, 100)), s);
});
test('antimeridian route projection and interpolation follow the short segment', () => {
  const p = pathOf([
    [179.99, 0],
    [-179.99, 0],
  ]);
  approx(p.length, 2223.9, 1);
  const hit = project(p, [-180, 0.001]);
  approx(hit.distance, p.length / 2);
  approx(hit.offset, 111.2);
  assert.ok(metresBetween(pointAt(p, p.length / 2), [-180, 0]) < 0.01);
  assert.throws(
    () =>
      createSession(
        route([
          [0, 0],
          [0, 0],
        ]),
      ),
    /太短/,
  );
});
test('return path has its own source and is removed on stop without modifying the planned route', () => {
  const sources = new Map(),
    layers = new Map();
  const map = {
    getSource: (id) => sources.get(id),
    addSource(id) {
      sources.set(id, {
        setData(data) {
          this.data = data;
        },
      });
    },
    getLayer: (id) => layers.get(id),
    addLayer(layer) {
      layers.set(layer.id, layer);
    },
    moveLayer() {},
  };
  const layer = new GuidanceLayer(map);
  layer.sync({
    coordinates: [
      [0, 0],
      [0.001, 0],
    ],
    target: [0.001, 0],
  });
  assert.equal(sources.get('route-guidance').data.features.length, 2);
  assert.equal(sources.has('planned-route'), false);
  assert.equal(layers.get('guidance-path').paint['line-color'], '#ffb052');
  layer.sync(null);
  assert.equal(sources.get('route-guidance').data.features.length, 0);
});
test('road snapping may not invent a connection over a large gap or stop short of rejoining', () => {
  const r = route(),
    target = { point: [0.01, 0], distance: 1112, offset: 0 };
  validateRejoinEndpoints(r, fix(0), target);
  assert.throws(
    () => validateRejoinEndpoints(r, fix(0, 0.001), target),
    /无法接到/,
  );
  assert.throws(
    () =>
      validateRejoinEndpoints(r, fix(0), { ...target, point: [0.01, 0.00025] }),
    /无法接到/,
  );
  const join = {
    ...r,
    steps: [
      { ...r.steps[0], distance: 1112 },
      { ...r.steps[1], distance: 0, instruction: '到达终点' },
    ],
  };
  assert.equal(nextInstruction(join, 100, 1112, true).text, '接回原路线');
});
