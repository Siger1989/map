import { connectRoadAccess } from '../modules/navigation/roadAccess.ts';
import { validateRejoinEndpoints } from '../modules/guidance/rejoin.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { atStart, connectDeparture, isNoPassableRoute, referenceDeparture } from '../modules/guidance/departure.ts';
import { trackNavigation } from '../modules/guidance/savedRoute.ts';
import {
  advance,
  createSession,
  rejoinTarget,
} from '../modules/guidance/session.ts';
import { pathOf } from '../modules/guidance/geometry.ts';
import { routeURL } from '../modules/navigation/provider.ts';
const now = Date.now(),
  start = [103, 30],
  mid = [103.004, 30],
  end = [103.01, 30];
const original = trackNavigation(
  {
    id: 'test',
    name: '测试轨迹',
    createdAt: now,
    segments: [[start, mid, end]],
  },
  now,
  'bicycle',
).route;
const fix = { coordinates: mid, accuracy: 5, timestamp: now };
const approach = {
  ...original,
  coordinates: [mid, start],
  distance: pathOf([mid, start]).length,
  duration: 90,
  snapped: [mid, start],
  stops: [
    { name: '当前位置', coordinates: mid },
    { name: '起点', coordinates: start },
  ],
  steps: [],
};
test('starting near the middle still plans to the original start in the same mode', () => {
  assert.equal(atStart(original, fix), false);
  const query = JSON.parse(
    new URL(
      routeURL(approach.stops[0], approach.stops[1], original.mode),
    ).searchParams.get('json'),
  );
  assert.equal(query.costing, 'bicycle');
  assert.equal(query.locations[1].lon, start[0]);
  const before = JSON.stringify(original),
    combined = connectDeparture(original, approach, fix);
  assert.deepEqual(combined.route.coordinates.slice(-3), original.coordinates);
  assert.equal(combined.route.mode, 'bicycle');
  assert.equal(JSON.stringify(original), before);
  let session = createSession(combined.route, now);
  session = advance(session, fix, now);
  assert.ok(session.progress < 1);
  assert.equal(session.nextCheckpoint, 0);
  assert.ok(rejoinTarget(session).distance <= session.checkpoints[0].distance);
  session = advance(
    session,
    { ...fix, coordinates: start, timestamp: now + 120000 },
    now + 120000,
  );
  assert.equal(session.nextCheckpoint, 1);
  session = advance(
    session,
    { ...fix, coordinates: mid, timestamp: now + 240000 },
    now + 240000,
  );
  assert.ok(session.progress > combined.length);
});
test('same-start bypass and endpoint gaps cannot invent a road connection', () => {
  assert.equal(atStart(original, { ...fix, coordinates: start }), true);
  assert.throws(
    () => connectDeparture(original, { ...approach, mode: 'auto' }, fix),
    /方式/,
  );
  assert.throws(
    () =>
      connectDeparture(
        original,
        { ...approach, coordinates: [mid, [102.9, 30]] },
        fix,
      ),
    /接入段不完整/,
  );
});

test('only explicit no-road results create a dashed straight reference and preserve the planned route', () => {
  const before = JSON.stringify(original);
  const result = referenceDeparture(original, fix.coordinates, now);
  assert.equal(result.referenceOnly, true);
  assert.deepEqual(result.route.segments.slice(0, 1), [{ kind: 'access', coordinates: [mid, start] }]);
  assert.deepEqual(result.route.segments.at(-1), { kind: 'road', coordinates: original.coordinates });
  assert.deepEqual(result.route.coordinates.slice(-original.coordinates.length), original.coordinates);
  assert.match(result.route.steps[0].instruction, /不代表可通行道路/);
  assert.ok(result.length > 0);
  assert.equal(JSON.stringify(original), before);
  assert.equal(isNoPassableRoute(new Error('没有找到可通行路线，请更换地点')), true);
  assert.equal(isNoPassableRoute(new Error('附近道路无法连通')), true);
  assert.equal(isNoPassableRoute(new Error('路线服务网络连接失败')), false);
  assert.equal(isNoPassableRoute(Object.assign(new Error('附近道路无法连通'), { name: 'AbortError' })), false);
  assert.equal(isNoPassableRoute(new Error('没有可用的离线路线')), false);
});


test('off-road departure keeps the real road and dashed connectors at both ends', () => {
  const roadStart = [103.005, 30.002], roadEnd = [103.001, 30.002];
  const road = { ...approach, coordinates: [roadStart, roadEnd], snapped: [roadStart, roadEnd],
    segments: undefined, distance: pathOf([roadStart, roadEnd]).length, duration: 100, steps: [] };
  const connected = connectRoadAccess(road, approach.stops);
  const target = { point: start, distance: 0, offset: 0 };
  assert.doesNotThrow(() => validateRejoinEndpoints(connected, fix, target));
  const before = JSON.stringify(original);
  const result = connectDeparture(original, connected, fix);
  assert.deepEqual(result.route.segments.slice(0, 3).map(s => s.kind), ['access', 'road', 'access']);
  assert.deepEqual(result.route.segments[1].coordinates, [roadStart, roadEnd]);
  assert.deepEqual(result.route.segments[0].coordinates, [mid, roadStart]);
  assert.deepEqual(result.route.segments[2].coordinates, [roadEnd, start]);
  assert.ok(result.route.accessDistance > 400);
  assert.ok(Math.abs(result.route.accessDuration - result.route.accessDistance / 1.2) < 1e-8);
  assert.equal(result.route.stops[1].coordinates, original.stops[0].coordinates);
  assert.deepEqual(result.route.coordinates.slice(-3), original.coordinates);
  assert.equal(JSON.stringify(original), before);
  for (const invalid of [
    { ...connected, segments: undefined },
    { ...connected, segments: connected.segments.map(s => ({ ...s, kind: 'road' })) },
    { ...connected, segments: connected.segments.map((s, i) => i === 1 ? { ...s, coordinates: [[103.02, 30], roadEnd] } : s) },
    { ...connected, coordinates: [mid, start] },
    { ...connected, snapped: [[102, 30], roadEnd] },
    { ...connected, segments: connected.segments.map((s, i) => i === 0 ? { ...s, coordinates: [[NaN, 30], roadStart] } : s) },
  ]) assert.throws(() => validateRejoinEndpoints(invalid, fix, target), /接入段不完整/);
});

test('two off-road endpoints can share a single nearest routable point', () => {
  const point = [103.002, 30.002];
  const connected = connectRoadAccess({ ...approach, coordinates: [point, point], snapped: [point, point],
    segments: undefined, distance: 0, duration: 0, steps: [] }, approach.stops);
  assert.doesNotThrow(() => connectDeparture(original, connected, fix));
  assert.deepEqual(connected.segments.map(s => s.kind), ['access', 'road', 'access']);
});
