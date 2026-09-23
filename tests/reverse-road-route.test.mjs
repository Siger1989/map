import test from 'node:test';
import assert from 'node:assert/strict';
import { reverseRoadRoute } from '../modules/guidance/reverseRoadRoute.ts';
import { createSession } from '../modules/guidance/session.ts';
import { nextInstruction } from '../modules/guidance/geometry.ts';
import { validFavorite } from '../modules/navigation/favorites.ts';

const a = [103, 30], b = [103.001, 30], c = [103.002, 30];

function roadRoute() {
  return {
    mode: 'auto',
    coordinates: [a, b, c],
    snapped: [a, b, c],
    distance: 240,
    duration: 36,
    accessDistance: 20,
    accessDuration: 18,
    createdAt: 123,
    routingSource: { kind: 'offline', name: '测试路网', createdAt: 99 },
    segments: [
      { kind: 'access', coordinates: [a, a] },
      { kind: 'road', coordinates: [a, b] },
      { kind: 'road', coordinates: [b, c] },
    ],
    roadLegs: [[a, b], [b, c]],
    trackNetwork: [[a, b], [b, c]],
    preferredTrackPath: [a, b, c],
    stops: [
      { name: '起点', detail: 'A', coordinates: a },
      { name: '途经点', coordinates: b },
      { name: '终点', coordinates: c },
    ],
    steps: [
      { kind: 'road', legIndex: 0, instruction: '右转进入旧路', distance: 100, duration: 10, elapsedSeconds: 0, coordinates: [a, b] },
      { kind: 'road', legIndex: 1, instruction: '左转到达终点', distance: 140, duration: 26, elapsedSeconds: 10, coordinates: [b, c] },
    ],
  };
}

test('reversed road route begins at the old end and reverses all directional geometry', () => {
  const route = roadRoute();
  const reversed = reverseRoadRoute(route);

  assert.deepEqual(reversed.coordinates, [c, b, a]);
  assert.deepEqual(reversed.snapped, [c, b, a]);
  assert.deepEqual(reversed.roadLegs, [[c, b], [b, a]]);
  assert.deepEqual(reversed.segments.map((segment) => segment.coordinates), [[c, b], [b, a], [a, a]]);
  assert.deepEqual(reversed.stops.map((stop) => stop.name), ['终点', '途经点', '起点']);
  assert.deepEqual(reversed.preferredTrackPath, [c, b, a]);
  assert.equal(reversed.distance, route.distance);
  assert.equal(reversed.duration, route.duration);
  assert.equal(reversed.accessDistance, route.accessDistance);
  assert.equal(reversed.accessDuration, route.accessDuration);
});

test('reversed road route clears stale forward maneuvers for generic guidance', () => {
  const reversed = reverseRoadRoute(roadRoute());

  assert.deepEqual(reversed.steps, []);
  assert.equal(reversed.distance, 240);
  assert.equal(reversed.duration, 36);
  const session = createSession(reversed);
  assert.deepEqual(session.path.points[0], c);
  assert.ok(Math.abs(session.checkpoints[0].point[0] - b[0]) < 1e-9);
  assert.ok(Math.abs(session.checkpoints[0].point[1] - b[1]) < 1e-9);
  assert.equal(nextInstruction(reversed, 0, session.path.length).text, '沿路线到达终点');
  assert.equal(validFavorite({
    id: 'reverse-test', name: '返程', savedAt: 123,
    start: reversed.stops[0], end: reversed.stops.at(-1), route: reversed,
  }), true);
});

test('reversal does not mutate or share mutable route geometry with the saved route', () => {
  const route = roadRoute();
  const before = JSON.stringify(route);
  const reversed = reverseRoadRoute(route);
  reversed.coordinates[0][0] = 0;
  reversed.segments[0].coordinates[0][0] = 0;
  reversed.roadLegs[0][0][0] = 0;
  reversed.stops[0].coordinates[0] = 0;
  reversed.trackNetwork[0][0][0] = 0;

  assert.equal(JSON.stringify(route), before);
});
