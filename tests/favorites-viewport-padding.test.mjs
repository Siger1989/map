import test from 'node:test';
import assert from 'node:assert/strict';
import { favoritesViewportPadding } from '../modules/collections/favoritesViewportPadding.ts';

const rect = (top, right, bottom, left) => ({ top, right, bottom, left });

test('favorites viewport padding handles portrait overlap and preserves a useful map area', () => {
  const padding = favoritesViewportPadding(rect(0, 390, 857, 0), rect(0, 390, 445, 0), 390, 857);
  assert.deepEqual(padding, { top: 461, right: 0, bottom: 0, left: 0 });
  assert.ok(857 - padding.top >= 857 * 0.35);
});

test('favorites viewport padding handles landscape left overlay without vertical inset', () => {
  const padding = favoritesViewportPadding(rect(0, 1280, 720, 0), rect(0, 460, 650, 0), 1280, 720);
  assert.deepEqual(padding, { top: 0, right: 0, bottom: 0, left: 476 });
});

test('favorites viewport padding is absent when the panel does not overlap the map', () => {
  assert.equal(favoritesViewportPadding(rect(400, 390, 857, 0), rect(0, 390, 400, 0), 390, 457), null);
});

test('large panel and caller padding cannot consume the remaining visible map', () => {
  const padding = favoritesViewportPadding(rect(0, 360, 480, 0), rect(0, 360, 400, 0), 360, 480, 16,
    { top: 56, right: 20, bottom: 48, left: 12 });
  assert.equal(padding.top, 312);
  assert.equal(padding.bottom, 0);
  assert.equal(padding.left, 12);
  assert.equal(padding.right, 20);
  assert.equal(480 - padding.top - padding.bottom, 168);
});
