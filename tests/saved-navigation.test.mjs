import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RouteDisconnectedError,
  RouteEndpointRequiredError,
  trackNavigation,
} from '../modules/guidance/savedRoute.ts';
import { validFavorite } from '../modules/navigation/favorites.ts';
import { createSession, advance } from '../modules/guidance/session.ts';
import { nextInstruction } from '../modules/guidance/geometry.ts';

const now = 1800000000000;
const line = [
  [103, 30],
  [103.001, 30],
  [103.001, 30.002],
];
const track = (segments = [line]) => ({
  id: 'drawn',
  name: '测试山路',
  createdAt: now - 50000,
  segments,
});

test('saved manual geometry becomes a navigable walking route without modifying the archive', () => {
  const original = track();
  const before = JSON.stringify(original);
  const favorite = trackNavigation(original, now);
  assert.equal(validFavorite(favorite), true);
  assert.deepEqual(favorite.route.coordinates, line);
  assert.equal(favorite.route.mode, 'pedestrian');
  assert.equal(favorite.route.steps.length, 0);
  assert.deepEqual(favorite.route.snapped, [line[0], line.at(-1)]);
  const session = createSession(favorite.route, now);
  assert.equal(session.quality, '等待当前位置…');
  assert.equal(
    nextInstruction(favorite.route, 0, session.path.length).text,
    '沿路线到达终点',
  );
  const started = advance(
    session,
    { coordinates: line[1], timestamp: now, accuracy: 5 },
    now,
  );
  assert.ok(started.progress > 90);
  assert.equal(started.offRoute, false);
  assert.equal(started.quality, '');
  favorite.route.coordinates[0][0] = 0;
  assert.equal(JSON.stringify(original), before);
});

test('connected saved segments join but detached segments and lone points are never bridged', () => {
  const connected = trackNavigation(
    track([
      [line[0], line[1]],
      [line[2], line[1]],
    ]),
    now,
  );
  assert.deepEqual(connected.route.coordinates, line);
  assert.throws(
    () =>
      trackNavigation(
        track([
          line,
          [
            [104, 31],
            [104.01, 31],
          ],
        ]),
        now,
      ),
    /不相接/,
  );
  assert.throws(
    () => trackNavigation(track([line, [[104, 31]]]), now),
    /不相接/,
  );
  assert.throws(() => trackNavigation(track([]), now), /不相接/);
  assert.throws(
    () =>
      trackNavigation(
        track([
          [
            [103, 30],
            [103, 30],
          ],
        ]),
        now,
      ),
    /不足20米/,
  );
  assert.throws(
    () =>
      trackNavigation(
        track([
          [
            [NaN, 30],
            [103, 30],
          ],
        ]),
        now,
      ),
    /坐标无效/,
  );
});

test('connected forks and a point on a shared interior vertex are not reported as gaps', () => {
  const center = [103, 30];
  const fork = track([
    [center, [103.001, 30]],
    [center, [103, 30.001]],
    [center, [102.999, 30]],
  ]);
  assert.throws(
    () => trackNavigation(fork, now),
    (error) => error instanceof RouteEndpointRequiredError && !(error instanceof RouteDisconnectedError),
  );

  const sharedInteriorPoint = track([line, [line[1]]]);
  const route = trackNavigation(sharedInteriorPoint, now);
  assert.deepEqual(route.route.coordinates, line);
});

test('disconnected components carry the nearest real gap regardless of segment order or direction', () => {
  const far = [[104, 31], [104.001, 31]];
  const reversedNear = [[103.001, 30], [103, 30]];
  const close = [[103.0012, 30], [103.002, 30]];
  let disconnected;
  assert.throws(
    () => trackNavigation(track([far, close, reversedNear]), now),
    (error) => {
      disconnected = error;
      return error instanceof RouteDisconnectedError;
    },
  );
  assert.equal(disconnected.message, '轨迹含不相接的线段，请先连接成连续路线再导航。');
  assert.deepEqual(disconnected.gap.from, close[0]);
  assert.deepEqual(disconnected.gap.to, reversedNear[0]);

  let isolated;
  assert.throws(
    () => trackNavigation(track([line, [[104, 31]]]), now),
    (error) => {
      isolated = error;
      return error instanceof RouteDisconnectedError;
    },
  );
  assert.deepEqual(isolated.gap.from, line.at(-1));
  assert.deepEqual(isolated.gap.to, [104, 31]);
});

test('empty or unlocatable geometry keeps the compatible error without inventing a gap', () => {
  let disconnected;
  assert.throws(
    () => trackNavigation(track([]), now),
    (error) => {
      disconnected = error;
      return error instanceof RouteDisconnectedError;
    },
  );
  assert.equal(disconnected.gap, null);
  assert.equal(disconnected.message, '轨迹含不相接的线段，请先连接成连续路线再导航。');

  assert.throws(
    () => trackNavigation(track([[[104, 31]]]), now),
    (error) => error instanceof RouteDisconnectedError && error.gap === null,
  );
});

test('favorite navigation keeps mode, intermediate checkpoint and original road instructions', () => {
  const favorite = trackNavigation(track(), now);
  favorite.route.mode = 'bicycle';
  favorite.route.snapped = line;
  favorite.route.stops = line.map((coordinates, i) => ({
    name: String(i),
    coordinates,
  }));
  favorite.start = favorite.route.stops[0];
  favorite.end = favorite.route.stops.at(-1);
  favorite.route.steps = [
    {
      instruction: '沿山路前进',
      distance: favorite.route.distance,
      duration: 60,
      elapsedSeconds: 0,
      coordinates: line,
    },
  ];
  assert.equal(validFavorite(favorite), true);
  const session = createSession(favorite.route, now);
  assert.equal(session.route, favorite.route);
  assert.equal(session.route.mode, 'bicycle');
  assert.equal(session.checkpoints.length, 1);
  assert.equal(session.route.steps[0].instruction, '沿山路前进');
});
