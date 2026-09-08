import test from 'node:test';
import assert from 'node:assert/strict';
import { trackNavigation } from '../modules/guidance/savedRoute.ts';
import { orientTrack } from '../modules/guidance/direction.ts';
import { trackAlternatives } from '../modules/tracks/alternatives.ts';
import { routeOnNetwork } from '../modules/guidance/network.ts';
import { preferredPath } from '../modules/guidance/preferredPath.ts';
import { validFavorite } from '../modules/navigation/favorites.ts';
const A = [103, 30],
  B = [103.002, 30],
  C = [103.004, 30],
  D = [103.006, 30],
  E = [103.002, 30.002],
  F = [103.004, 30.002],
  G = [103.006, 30.002];
const track = {
  id: 'route',
  name: '测试',
  createdAt: 1,
  segments: [
    [A, B, C, D],
    [B, E, F, C],
    [D, G],
  ],
};
test('selected detour replaces the main interval and reversal preserves that exact shape', () => {
  const variants = trackAlternatives(track.segments),
    alt = variants[1];
  const target = trackNavigation(track, 1, 'pedestrian', [], alt.id);
  assert.deepEqual(target.route.coordinates, alt.coordinates);
  const reversed = orientTrack(target, target.end, target.start, 'pedestrian');
  assert.deepEqual(
    reversed.route.coordinates,
    alt.coordinates.slice().reverse(),
  );
  assert.equal(validFavorite(reversed), true);
  assert.ok(reversed.route.distance > trackNavigation(track).route.distance);
});
test('nearest entry on the selected main prefix retains the longer selected detour', () => {
  const target = trackNavigation(
    track,
    1,
    'pedestrian',
    [],
    trackAlternatives(track.segments)[1].id,
  );
  const entry = routeOnNetwork(target.route, [103.001, 30]);
  assert.ok(
    entry.route.coordinates.some((p) => p[0] === E[0] && p[1] === E[1]),
  );
  assert.deepEqual(entry.route.coordinates.at(-1), target.end.coordinates);
});
test('changing an endpoint extends only connected geometry and keeps selected detour', () => {
  const base = [
      [A, B, C, D],
      [B, E, F, C],
      [D, G],
    ],
    selected = [A, B, E, F, C, D];
  assert.deepEqual(preferredPath(base, selected, A, G), [...selected, G]);
  assert.throws(() => preferredPath(base, selected, A, [104, 31]), /节点/);
});
test('hidden saved routes cannot introduce shortcuts or new navigable branches', () => {
  const target = trackNavigation(
    { ...track, segments: [[A, B, C, D]] },
    1,
    'pedestrian',
    [
      {
        id: 'hidden',
        name: 'hidden',
        createdAt: 1,
        hidden: true,
        segments: [[B, E, F, C]],
      },
    ],
  );
  assert.equal(
    target.route.trackNetwork.flat().some((p) => p[1] === 30.002),
    false,
  );
});
test('closed itinerary can be shortened at a visible node without reversing its initial direction', () => {
  assert.deepEqual(preferredPath([[A, B, E, A]], [A, B, E, A], A, E), [
    A,
    B,
    E,
  ]);
});
