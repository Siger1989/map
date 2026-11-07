import test from 'node:test';
import assert from 'node:assert/strict';
import { hideMatchingFavoriteRoute } from '../modules/navigation/routeVisibility.ts';

const route = (overrides = {}) => ({
  createdAt: 1_791_010_800_000,
  mode: 'pedestrian',
  coordinates: [[104.01, 30.62], [104.02, 30.63], [104.04, 30.65]],
  ...overrides,
});

const favorite = (id, plannedRoute, overrides = {}) => ({
  id,
  name: `路线 ${id}`,
  savedAt: 1_791_010_800_123,
  start: { name: '起点', coordinates: [104.01, 30.62] },
  end: { name: '终点', coordinates: [104.04, 30.65] },
  route: plannedRoute,
  ...overrides,
});

test('hides only visible favorites matching the planned route and preserves saved content', () => {
  const current = route({ style: { color: '#123456', width: 2.5 }, name: '完整名称' });
  const matching = favorite('match', structuredClone(current), { visible: true, note: 'keep metadata' });
  const alreadyHidden = favorite('hidden', structuredClone(current), { visible: false });
  const visibilityUnset = favorite('unset', structuredClone(current));
  const unrelated = favorite('other', route({ createdAt: current.createdAt + 1 }), { visible: true });
  const items = [matching, alreadyHidden, visibilityUnset, unrelated];

  const next = hideMatchingFavoriteRoute(items, current);

  assert.notEqual(next, items);
  assert.deepEqual(next.map((item) => item.visible), [false, false, undefined, true]);
  assert.equal(next[0].id, matching.id);
  assert.equal(next[0].name, matching.name);
  assert.equal(next[0].start, matching.start);
  assert.equal(next[0].end, matching.end);
  assert.equal(next[0].route.style, matching.route.style);
  assert.equal(next[0].note, 'keep metadata');
  assert.equal(next[1], alreadyHidden);
  assert.equal(next[2], visibilityUnset);
  assert.equal(next[3], unrelated);
  assert.equal(matching.visible, true, 'input favorites remain unchanged');
});

test('returns the original list when no visible favorite matches', () => {
  const current = route();
  const items = [
    favorite('hidden', structuredClone(current), { visible: false }),
    favorite('other', route({ mode: 'bicycle' }), { visible: true }),
  ];

  assert.equal(hideMatchingFavoriteRoute(items, current), items);
});
