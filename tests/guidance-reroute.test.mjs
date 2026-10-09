import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateReroute, remainingRoutePlaces, replacementSession, shouldAutoReroute, shouldReplaceTrackOnDeviation } from '../modules/guidance/reroute.ts';
import { createSession, advance } from '../modules/guidance/session.ts';
import { advanceNetwork } from '../modules/guidance/networkSession.ts';

const route = () => ({ mode: 'bicycle', coordinates: [[103, 30], [103.01, 30], [103.02, 30], [103.03, 30]], snapped: [[103, 30], [103.01, 30], [103.02, 30], [103.03, 30]], stops: [{name: '起点', coordinates: [103, 30]}, {name: '途经一', coordinates: [103.01, 30]}, {name: '途经二', coordinates: [103.02, 30]}, {name: '原终点', coordinates: [103.03, 30]}], distance: 2900, duration: 900, steps: [], createdAt: 1 });
test('replanning retains destination and unvisited checkpoints without changing the original route', () => {
  const original = route(), snapshot = structuredClone(original), session = createSession(original);
  session.nextCheckpoint = 1;
  const result = remainingRoutePlaces(session);
  assert.deepEqual(result.end, original.stops.at(-1));
  assert.equal(result.via.length, 1);
  assert.ok(Math.abs(result.via[0].coordinates[0] - original.stops[2].coordinates[0]) < 1e-10);
  assert.equal(result.via[0].coordinates[1], original.stops[2].coordinates[1]);
  assert.deepEqual(original, snapshot);
  session.nextCheckpoint = 2;
  assert.deepEqual(remainingRoutePlaces(session).via, []);
});
test('a manually replanned route cannot snap back to the old track network', () => {
  const session = createSession(route());
  session.replanned = true;
  session.originalRoute = { ...route(), trackNetwork: {} };
  const fix = { coordinates: [103, 30.001], timestamp: 100000, accuracy: 4 };
  const next = advanceNetwork(session, fix, fix.timestamp);
  assert.deepEqual(next, advance(session, fix, fix.timestamp));
  assert.equal(next.route, session.route);
  assert.equal(next.originalRoute, session.originalRoute);
});
test('replanning during an approach skips the synthetic old start but preserves actual via points', () => {
  const session = createSession(route());
  session.departureRoute = route();
  session.nextCheckpoint = 0;
  assert.equal(remainingRoutePlaces(session).via.length, 1);
  assert.deepEqual(remainingRoutePlaces(session).via[0].coordinates, session.checkpoints[1].point);
});

test('automatic reroute waits for confirmed off-route evidence, fresh fixes, foreground network and cooldown', () => {
  const now = Date.now();
  const fix = { coordinates: [103.001, 30.001], timestamp: now, accuracy: 5 };
  const session = createSession(route(), now);
  session.last = fix;
  session.quality = '';
  session.offRoute = true;
  const options = { now, online: true, hidden: false, pending: false, nextRequestAt: now };
  assert.equal(shouldAutoReroute(session, fix, options), true);
  assert.equal(shouldAutoReroute({ ...session, offRoute: false }, fix, options), false);
  assert.equal(shouldAutoReroute(session, { ...fix, coordinates: [103.01, 30] }, options), false);
  assert.equal(shouldAutoReroute(session, { ...fix, accuracy: 80 }, options), false);
  assert.equal(shouldAutoReroute(session, { ...fix, timestamp: now - 30000 }, options), false);
  assert.equal(shouldAutoReroute(session, fix, { ...options, nextRequestAt: now + 1000 }), false);
  assert.equal(shouldAutoReroute(session, fix, { ...options, pending: true }), false);
  assert.equal(shouldAutoReroute(session, fix, { ...options, hidden: true }), false);
  assert.equal(shouldAutoReroute(session, fix, { ...options, online: false }), false);
  assert.equal(shouldAutoReroute(session, fix, { ...options, locationError: '权限错误' }), false);
  assert.equal(shouldReplaceTrackOnDeviation({ ...session, route: { ...session.route, geometryKind: 'track' } }), false);
  assert.equal(shouldReplaceTrackOnDeviation({ ...session, route: { ...session.route, trackNetwork: [session.route.coordinates] } }), false);
  assert.equal(shouldReplaceTrackOnDeviation(session), true);
});

test('automatic reroute uses the current travel mode and remaining checkpoints, then adopts only a route that still fits live location', async () => {
  const now = Date.now();
  const session = createSession(route(), now);
  session.nextCheckpoint = 1;
  const origin = { coordinates: [103.004, 30.001], timestamp: now, accuracy: 5 };
  let live = origin;
  let request;
  const planned = { ...route(), coordinates: [origin.coordinates, [103.01, 30.001], [103.02, 30.001], [103.03, 30.001]], snapped: [origin.coordinates, [103.01, 30.001], [103.02, 30.001], [103.03, 30.001]] };
  const result = await calculateReroute(session, origin, new AbortController().signal, () => live, async (...args) => { request = args; return planned; });
  assert.deepEqual(request[0], { name: '当前位置', coordinates: origin.coordinates });
  assert.equal(request[2], 'bicycle');
  assert.deepEqual(request[4].map((place) => place.coordinates), [session.checkpoints[1].point]);
  assert.deepEqual(request[1].coordinates, route().stops.at(-1).coordinates);
  assert.equal(result.route, planned);
  assert.equal(result.fix, origin);

  const snapshot = structuredClone(session);
  live = { coordinates: [103.015, 30.01], timestamp: now + 100, accuracy: 5 };
  await assert.rejects(calculateReroute(session, origin, new AbortController().signal, () => live, async () => planned), /位置已变化/);
  assert.deepEqual(session, snapshot);
});

test('aborted reroute cannot reach the planner or adopt an in-flight stale route', async () => {
  const now = Date.now();
  const session = createSession(route(), now);
  const origin = { coordinates: [103, 30.001], timestamp: now, accuracy: 5 };
  const controller = new AbortController();
  controller.abort();
  let called = false;
  await assert.rejects(calculateReroute(session, origin, controller.signal, () => origin, async () => { called = true; return route(); }));
  assert.equal(called, false);

  const inFlight = new AbortController();
  let release;
  const pendingRoute = new Promise((resolve) => { release = resolve; });
  const pending = calculateReroute(session, origin, inFlight.signal, () => origin, async () => pendingRoute);
  inFlight.abort();
  release(route());
  await assert.rejects(pending, (error) => error?.name === 'AbortError');
});

test('route replacement keeps active timing and distance, adopts the exact target and latest valid fix', () => {
  const now = Date.now();
  const previous = createSession(route(), now - 10000);
  previous.travelled = 340;
  previous.last = { coordinates: [103.001, 30], timestamp: now - 1000, accuracy: 4 };
  const target = { ...route(), coordinates: [[104, 30], [104.01, 30]], snapped: [[104, 30], [104.01, 30]] };
  const latest = { coordinates: [104.001, 30], timestamp: now, accuracy: 3 };
  const next = replacementSession(previous, target, latest, now);
  assert.equal(next.route, target);
  assert.equal(next.originalRoute, target);
  assert.equal(next.startedAt, previous.startedAt);
  assert.equal(next.travelled, 340);
  assert.equal(next.last, latest);
  assert.equal(next.anchor, latest);
  assert.equal(next.quality, '');
  assert.throws(() => replacementSession(previous, { ...target, coordinates: [[104, 30]] }, latest, now), /路线/);
});
