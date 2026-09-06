import test from 'node:test';
import assert from 'node:assert/strict';
import { moveStop } from '../modules/navigation/stops.ts';
import { routeURL } from '../modules/navigation/provider.ts';
import { validFavorite } from '../modules/navigation/favorites.ts';
import { routePositionIndex, railFraction } from '../modules/journey/scrub.ts';
const a = { name: '起', coordinates: [104, 30] },
  b = { name: '途', coordinates: [104.01, 30] },
  c = { name: '终', coordinates: [104.02, 30] };
test('reordering moves whole places across endpoint roles and rejects invalid targets', () => {
  const rows = [a, b, c];
  assert.deepEqual(moveStop(rows, 0, 2), [b, c, a]);
  assert.deepEqual(rows, [a, b, c]);
  assert.equal(moveStop(rows, 0, -1), rows);
  const ordered = moveStop(rows, 2, 1),
    q = JSON.parse(
      new URL(
        routeURL(ordered[0], ordered.at(-1), 'auto', ordered.slice(1, -1)),
      ).searchParams.get('json'),
    );
  assert.deepEqual(
    q.locations.map((p) => [p.lon, p.lat]),
    [a.coordinates, c.coordinates, b.coordinates],
  );
  assert.ok(q.locations.every((p) => p.type === 'break'));
});
test('multi-stop validation checks every leg and allows a round trip', () => {
  assert.doesNotThrow(() => routeURL(a, a, 'pedestrian', [b]));
  assert.throws(() => routeURL(a, c, 'auto', [a]));
  assert.throws(() =>
    routeURL(a, c, 'auto', [{ ...b, coordinates: [Infinity, 30] }]),
  );
  assert.throws(() => routeURL(a, c, 'auto', Array(9).fill(b)));
});
test('old two-point favorites and ordered multi-stop favorites survive validation', () => {
  const route = {
    mode: 'auto',
    coordinates: [a.coordinates, b.coordinates, c.coordinates],
    distance: 2000,
    duration: 1000,
    steps: [],
    snapped: [a.coordinates, c.coordinates],
    createdAt: 1,
  };
  const saved = { id: 'x', name: 'x', savedAt: 1, start: a, end: c, route };
  assert.equal(validFavorite(saved), true);
  const multi = {
    ...saved,
    route: {
      ...route,
      stops: [a, b, c],
      snapped: [a.coordinates, b.coordinates, c.coordinates],
    },
  };
  assert.equal(validFavorite(multi), true);
  assert.equal(
    validFavorite({
      ...multi,
      route: { ...multi.route, snapped: [a.coordinates, c.coordinates] },
    }),
    false,
  );
  assert.equal(
    validFavorite({ ...multi, route: { ...multi.route, stops: [c, b, a] } }),
    false,
  );
});
test('continuous scrub follows geometry, clamps endpoints and handles the dateline', () => {
  const locate = routePositionIndex([
    [104, 30],
    [104.01, 30],
    [104.02, 30],
  ]);
  assert.deepEqual(locate(-1), [104, 30]);
  assert.deepEqual(locate(1), [104.02, 30]);
  assert.ok(Math.abs(locate(0.5)[0] - 104.01) < 1e-8);
  assert.ok(
    Math.abs(
      Math.abs(
        routePositionIndex([
          [179, 0],
          [-179, 0],
        ])(0.5)[0],
      ) - 180,
    ) < 1e-8,
  );
  assert.equal(routePositionIndex([])(0.5), null);
  assert.equal(railFraction(50, 100, 400), 0);
  assert.equal(railFraction(300, 100, 400), 0.5);
  assert.equal(railFraction(900, 100, 400), 1);
});
