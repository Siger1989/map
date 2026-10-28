import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeAnnotationNavigationPins } from '../modules/map/native/annotationNavigation.ts';

const pin = { id: 'pin-a', kind: 'pin', name: '测点', color: '#336699', coordinates: [103, 31], visible: true };
const frame = { camera: { zoom: 9 }, viewport: { x: 360, y: 120, width: 780, height: 1714 }, cssScale: 2 };
const geometry = (overrides = {}) => ({
  elevation: () => ({ status: 'ready', value: 100 }),
  project: () => ({ status: 'ready', value: { x: 150, y: 300 } }),
  unproject: () => ({ status: 'ready', value: { coordinate: [103, 31] } }),
  ...overrides,
});

test('shows a visible label-mode pin at its real local projected coordinate', () => {
  const result = nativeAnnotationNavigationPins([pin], null, frame, geometry());
  assert.equal(result.length, 1);
  assert.deepEqual({ x: result[0].x, y: result[0].y, id: result[0].annotation.id }, { x: 150, y: 300, id: 'pin-a' });
});

test('uses the original zoom/selection label threshold and requires a ready DEM sample', () => {
  assert.equal(nativeAnnotationNavigationPins([pin], null, { ...frame, camera: { zoom: 8.5 } }, geometry()).length, 0);
  assert.equal(nativeAnnotationNavigationPins([pin], 'pin-a', { ...frame, camera: { zoom: 4 } }, geometry()).length, 1);
  assert.equal(nativeAnnotationNavigationPins([pin], null, frame, geometry({ elevation: () => ({ status: 'blocked', reason: 'dem-missing' }) })).length, 0);
  assert.equal(nativeAnnotationNavigationPins([pin], null, { ...frame, terrainEnabled: false }, geometry({ elevation: () => ({ status: 'blocked', reason: 'no-terrain-required' }) })).length, 1);
});

test('hides labels outside the viewport or behind nearer terrain', () => {
  assert.equal(nativeAnnotationNavigationPins([pin], null, frame, geometry({ project: () => ({ status: 'ready', value: { x: 500, y: 300 } }) })).length, 0);
  assert.equal(nativeAnnotationNavigationPins([pin], null, frame, geometry({ unproject: () => ({ status: 'ready', value: { coordinate: [103.002, 31] } }) })).length, 0);
  assert.equal(nativeAnnotationNavigationPins([pin], null, frame, geometry({ unproject: () => ({ status: 'blocked', reason: 'dem-unavailable' }) })).length, 0);
});
