import test from 'node:test';
import assert from 'node:assert/strict';
import { samePlannedRoute } from '../modules/navigation/routeVisibility.ts';

const route = (overrides = {}) => ({
  id: 'planned-1',
  name: '晚间路线',
  createdAt: 1_791_010_800_000,
  mode: 'pedestrian',
  coordinates: [[104.01, 30.62], [104.02, 30.63], [104.04, 30.65]],
  segments: [],
  ...overrides,
});

test('hiding a planned route excludes only its restored favorite clone', () => {
  const planned = route();
  const restoredFavoriteClone = structuredClone(planned);

  assert.notEqual(restoredFavoriteClone, planned);
  assert.equal(samePlannedRoute(planned, restoredFavoriteClone), true);
  assert.equal(samePlannedRoute(planned, null), false);

  const differentIdentityOrGeometry = [
    route({ createdAt: planned.createdAt + 1 }),
    route({ mode: 'bicycle' }),
    route({ coordinates: [[104.01, 30.62], [104.02, 30.63], [104.041, 30.65]] }),
    route({ coordinates: [[104.011, 30.62], [104.02, 30.63], [104.04, 30.65]] }),
    route({ coordinates: [[104.01, 30.62], [104.04, 30.65], [104.041, 30.65]] }),
    route({ coordinates: [[104.01, 30.62], [104.02, 30.63]] }),
  ];

  for (const unrelated of differentIdentityOrGeometry) {
    assert.equal(samePlannedRoute(planned, unrelated), false);
  }
});
