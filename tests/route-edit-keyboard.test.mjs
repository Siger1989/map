import test from 'node:test';
import assert from 'node:assert/strict';
import { routeEditKeyboardOcclusion } from '../modules/tracks/useRouteEditKeyboardFocus.ts';

test('route edit keyboard occlusion follows a resized visual viewport', () => {
  assert.equal(routeEditKeyboardOcclusion(857, 557), 300);
  assert.equal(routeEditKeyboardOcclusion(480, 250), 230);
  assert.equal(routeEditKeyboardOcclusion(857, 857), 0);
  assert.equal(routeEditKeyboardOcclusion(557, 557), 0, 'resized layout already excludes keyboard');
});

test('route edit keyboard occlusion accounts for viewport offset and overlay keyboards', () => {
  assert.equal(routeEditKeyboardOcclusion(857, 557, 20), 280);
  assert.equal(routeEditKeyboardOcclusion(857, 857, 0, 520), 337);
  assert.equal(routeEditKeyboardOcclusion(857, 557, 0, 600), 300);
});
