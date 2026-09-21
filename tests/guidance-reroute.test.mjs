import test from 'node:test';
import assert from 'node:assert/strict';
import { remainingRoutePlaces } from '../modules/guidance/reroute.ts';
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
