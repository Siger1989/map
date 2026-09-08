import test from 'node:test';
import assert from 'node:assert/strict';
import { atStart, connectDeparture } from '../modules/guidance/departure.ts';
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
    /无法接到/,
  );
});
