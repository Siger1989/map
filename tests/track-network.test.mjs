import test from 'node:test';
import assert from 'node:assert/strict';
import {
  insertTrackNode,
  removeTrackNode,
  connectTrackNodes,
} from '../modules/tracks/nodeOperations.ts';
import { trackNavigation } from '../modules/guidance/savedRoute.ts';
import {
  networkPath,
  connectedNetwork,
  routeOnNetwork,
  vertexKey,
} from '../modules/guidance/network.ts';
import { orientTrack } from '../modules/guidance/direction.ts';
import { createSession } from '../modules/guidance/session.ts';
import { advanceNetwork } from '../modules/guidance/networkSession.ts';
import { validFavorite } from '../modules/navigation/favorites.ts';
import { parseSavedTracks } from '../modules/tracks/drawing.ts';
const A = [103, 30],
  J = [103.002, 30],
  B = [103.004, 30],
  C = [103.002, 30.002],
  D = [103.004, 30.002];
const track = (id, segments) => ({
  id,
  name: id,
  source: 'manual',
  createdAt: 1,
  segments,
  nodes: segments.flat(),
});
const primary = track('primary', [[A, J, B]]),
  alternative = track('branch', [[J, C, D, B]]);
const now = 1800000000000;

test('legacy endpoint tolerance remains navigable after joining saved segments', () => {
  const almostJ = [J[0] + 0.0000001, J[1]];
  const nav = trackNavigation(
    track('legacy', [
      [A, J],
      [almostJ, B],
    ]),
    now,
  );
  assert.equal(validFavorite(nav), true);
  assert.deepEqual(nav.route.coordinates, [A, J, B]);
});
test('closed loops retain full geometry when choosing either direction', () => {
  const loop = trackNavigation(track('loop', [[A, J, C, A]]), now);
  const forward = orientTrack(loop, loop.start, loop.end, 'pedestrian');
  const reverse = orientTrack(loop, loop.start, loop.end, 'pedestrian', true);
  assert.deepEqual(forward.route.coordinates, [A, J, C, A]);
  assert.deepEqual(reverse.route.coordinates, [A, C, J, A]);
  assert.equal(validFavorite(reverse), true);
});
test('invalid optional navigation networks are rejected at the favorite boundary', () => {
  const nav = trackNavigation(primary, now);
  for (const network of [null, {}, [[[NaN, 30], B]], [[A]]])
    assert.equal(
      validFavorite({ ...nav, route: { ...nav.route, trackNetwork: network } }),
      false,
    );
});

test('plus inserts a middle vertex; minus makes the neighbours one direct segment; source unchanged', () => {
  const before = JSON.stringify(primary),
    p = [103.001, 30];
  const inserted = insertTrackNode(primary, p);
  assert.deepEqual(inserted.segments, [[A, p, J, B]]);
  assert.ok(inserted.nodes.some((n) => vertexKey(n) === vertexKey(p)));
  const removed = removeTrackNode(inserted, J);
  assert.deepEqual(removed.segments, [[A, p, B]]);
  assert.equal(JSON.stringify(primary), before);
  assert.equal(parseSavedTracks(JSON.stringify([removed])).length, 1);
});
test('recorded GPS/time series is immutable and last two vertices cannot be reduced', () => {
  const recorded = { ...primary, source: 'recorded', samples: [[{}, {}, {}]] };
  assert.throws(() => insertTrackNode(recorded, [103.001, 30]), /副本/);
  assert.throws(() => removeTrackNode(recorded, J), /副本/);
  assert.throws(() => removeTrackNode(track('two', [[A, B]]), A), /两个/);
});
test('connection explicitly bridges selected nodes in a new route, preserving both original archives', () => {
  const detached = track('other', [[C, D]]),
    before = JSON.stringify([primary, detached]);
  const merged = connectTrackNodes(primary, J, detached, C, 'merged');
  assert.deepEqual(merged.segments.at(-1), [J, C]);
  assert.equal(merged.id, 'merged');
  assert.equal(JSON.stringify([primary, detached]), before);
  const nav = trackNavigation(merged, now);
  assert.equal(validFavorite(nav), true);
  assert.ok(
    networkPath(nav.route.trackNetwork, C, B).coordinates.some(
      (p) => vertexKey(p) === vertexKey(J),
    ),
  );
});
test('interior junction branches navigate and disconnected nearby routes are excluded', () => {
  const stranger = track('unrelated', [
    [
      [103.002, 30.0001],
      [103.004, 30.0001],
    ],
  ]);
  const network = connectedNetwork(primary, [primary, alternative, stranger]);
  assert.equal(network.length, 2);
  const nav = trackNavigation(primary, now, 'pedestrian', [
    alternative,
    stranger,
  ]);
  const nearest = routeOnNetwork(nav.route, [103.003, 30.002]);
  assert.ok(nearest.offset < 0.01);
  assert.equal(vertexKey(nearest.route.coordinates.at(-1)), vertexKey(B));
  assert.ok(
    nearest.route.coordinates.some((p) => vertexKey(p) === vertexKey(D)),
  );
  assert.ok(
    !nearest.route.coordinates.some((p) => vertexKey(p) === vertexKey(A)),
  );
});
test('crossing line geometry without a saved shared vertex does not form a junction', () => {
  const cross = track('cross', [
    [
      [103.001, 29.999],
      [103.001, 30.001],
    ],
  ]);
  assert.equal(connectedNetwork(primary, [cross]).length, 1);
  assert.throws(
    () =>
      connectedNetwork(
        track('broken', [...primary.segments, ...cross.segments]),
        [],
      ),
    /不相接/,
  );
});
test('nearest entry starts in the middle and reverse direction keeps new destination and source intact', () => {
  const original = trackNavigation(primary, now, 'bicycle', [alternative]),
    before = JSON.stringify(original);
  const nearest = routeOnNetwork(original.route, J);
  assert.ok(nearest.route.distance < original.route.distance);
  assert.equal(vertexKey(nearest.route.coordinates[0]), vertexKey(J));
  const reversed = orientTrack(
    original,
    original.end,
    original.start,
    'bicycle',
  );
  assert.equal(validFavorite(reversed), true);
  assert.equal(vertexKey(reversed.route.coordinates.at(-1)), vertexKey(A));
  assert.equal(
    vertexKey(routeOnNetwork(reversed.route, C).route.coordinates.at(-1)),
    vertexKey(A),
  );
  assert.equal(JSON.stringify(original), before);
});
test('branch endpoint can be explicitly selected as destination without altering the saved geometry', () => {
  const nav = trackNavigation(
    track('tree', [
      [A, J, B],
      [J, C],
    ]),
    now,
  );
  const picked = orientTrack(
    nav,
    nav.start,
    { name: '分叉终点', coordinates: C },
    'pedestrian',
  );
  assert.equal(validFavorite(picked), true);
  assert.equal(vertexKey(picked.route.coordinates.at(-1)), vertexKey(C));
  assert.throws(
    () => orientTrack(nav, nav.start, nav.start, 'pedestrian'),
    /20米/,
  );
});
test('fresh plausible positions switch to connected branch, keeping destination and walked distance', () => {
  const nav = trackNavigation(primary, now, 'pedestrian', [alternative]);
  let s = createSession(nav.route, now);
  s = advanceNetwork(s, { coordinates: J, accuracy: 3, timestamp: now }, now);
  s = advanceNetwork(
    s,
    { coordinates: [103.002, 30.0002], accuracy: 3, timestamp: now + 5000 },
    now + 5000,
  );
  assert.notEqual(s.route, nav.route);
  assert.equal(s.originalRoute, nav.route);
  assert.ok(s.route.coordinates.some((p) => vertexKey(p) === vertexKey(C)));
  assert.equal(vertexKey(s.route.coordinates.at(-1)), vertexKey(B));
  assert.ok(s.travelled > 20);
  assert.equal(s.offRoute, false);
});
test('inaccurate, stale, duplicate and impossible jumps never trigger branch switching', () => {
  const nav = trackNavigation(primary, now, 'pedestrian', [alternative]);
  const s = advanceNetwork(
    createSession(nav.route, now),
    { coordinates: J, accuracy: 3, timestamp: now },
    now,
  );
  for (const [fix, time] of [
    [{ coordinates: C, accuracy: 100, timestamp: now + 5000 }, now + 5000],
    [{ coordinates: C, accuracy: 3, timestamp: now - 50000 }, now + 5000],
    [{ coordinates: C, accuracy: 3, timestamp: now }, now],
    [{ coordinates: C, accuracy: 3, timestamp: now + 1000 }, now + 1000],
  ])
    assert.equal(advanceNetwork(s, fix, time).route, nav.route);
});
test('nearby parallel geometry inside GPS uncertainty retains current route', () => {
  const nav = trackNavigation(primary, now, 'pedestrian', [alternative]);
  let s = advanceNetwork(
    createSession(nav.route, now),
    { coordinates: J, accuracy: 10, timestamp: now },
    now,
  );
  s = advanceNetwork(
    s,
    { coordinates: [103.002, 30.00005], accuracy: 10, timestamp: now + 5000 },
    now + 5000,
  );
  assert.equal(s.route, nav.route);
});
