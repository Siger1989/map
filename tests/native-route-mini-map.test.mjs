import test from 'node:test';
import assert from 'node:assert/strict';
import { fitNativeRouteMiniMap, nativeMiniRouteLines, ROUTE_MINI_PADDING } from '../modules/guidance/nativeMiniMapGeometry.ts';

test('native route mini fit preserves original padding and caps zoom at 16', () => {
  const fit = fitNativeRouteMiniMap([[0, 0], [0.00001, 0.00001]], 320, 196);
  assert.ok(fit);
  assert.equal(fit.zoom, 16);
  assert.deepEqual(ROUTE_MINI_PADDING, { top: 30, right: 86, bottom: 30, left: 30 });
});

test('native route mini fit handles antimeridian bounds and preserves current view pose', () => {
  const fit = fitNativeRouteMiniMap([[179.6, 10], [-179.7, 10.2]], 400, 196, { pitch: 32, bearing: 71 });
  assert.ok(fit);
  assert.ok(Math.abs(fit.center[0]) > 170, `center should remain near the dateline: ${fit.center[0]}`);
  assert.equal(fit.pitch, 32);
  assert.equal(fit.bearing, 71);
});

test('native route lines keep alternate opacity, selected outline, access dash, and route-specific opacity', () => {
  const lines = nativeMiniRouteLines([
    { id: 'alt', coordinates: [[0, 0], [1, 1]], color: '#123456' },
    { id: 'chosen', coordinates: [[0, 0], [1, 1]], color: '#abcdef', opacity: 0.35, segments: [
      { kind: 'road', coordinates: [[0, 0], [0.5, 0.5]] },
      { kind: 'access', coordinates: [[0.5, 0.5], [1, 1]] },
    ] },
  ], 'chosen');
  assert.deepEqual(lines.map(({ selected, access, width, opacity }) => ({ selected, access, width, opacity })), [
    { selected: false, access: false, width: 3, opacity: 0.5 },
    { selected: true, access: false, width: 7, opacity: 0.35 },
    { selected: true, access: true, width: 4, opacity: 0.35 },
  ]);
});
