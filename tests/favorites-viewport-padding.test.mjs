import test from 'node:test';
import assert from 'node:assert/strict';
import { favoritesViewportCenterOffset, favoritesViewportPadding, favoritesViewportPaddingForOcclusions } from '../modules/collections/favoritesViewportPadding.ts';

const rect = (top, right, bottom, left) => ({ top, right, bottom, left });

test('favorites viewport padding handles portrait overlap and preserves a useful map area', () => {
  const padding = favoritesViewportPadding(rect(0, 390, 857, 0), rect(0, 390, 445, 0), 390, 857);
  assert.deepEqual(padding, { top: 461, right: 0, bottom: 0, left: 0 });
  assert.ok(857 - padding.top >= 857 * 0.35);
  const offset = favoritesViewportCenterOffset(padding);
  assert.equal(offset.y, 230.5);
  assert.equal(857 / 2 + offset.y, (padding.top + (857 - padding.bottom)) / 2);
});

test('favorites viewport padding handles landscape left overlay without vertical inset', () => {
  const padding = favoritesViewportPadding(rect(0, 1280, 720, 0), rect(0, 460, 650, 0), 1280, 720);
  assert.deepEqual(padding, { top: 0, right: 0, bottom: 0, left: 476 });
  assert.deepEqual(favoritesViewportCenterOffset(padding), { x: 238, y: 0 });
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

test('occlusion inset replaces a smaller fit margin instead of being added twice', () => {
  const padding = favoritesViewportPadding(rect(0, 390, 600, 0), rect(0, 390, 100, 0), 390, 600, 16,
    { top: 56, right: 0, bottom: 40, left: 0 });
  assert.deepEqual(padding, { top: 116, right: 0, bottom: 40, left: 0 });
});

test('favorites focus centers between the sheet and visible bottom toolbar with symmetric margins', () => {
  const padding = favoritesViewportPaddingForOcclusions(
    rect(0, 390, 857, 0), 390, 857,
    rect(0, 390, 440, 0), rect(801, 390, 857, 0),
  );
  assert.deepEqual(padding, { top: 456, right: 0, bottom: 72, left: 0 });
  const offset = favoritesViewportCenterOffset(padding);
  assert.equal(offset.y, 192);
  assert.equal(857 / 2 + offset.y, (456 + 785) / 2);
  assert.equal(857 / 2 + offset.y, 620.5);
});

test('favorites map already below the sheet gets only a top gap and overlapping footer inset', () => {
  const padding = favoritesViewportPaddingForOcclusions(
    rect(440, 390, 857, 0), 390, 417,
    rect(0, 390, 440, 0), rect(801, 390, 857, 0),
  );
  assert.deepEqual(padding, { top: 16, right: 0, bottom: 72, left: 0 });
  assert.equal(440 + 417 / 2 + favoritesViewportCenterOffset(padding).y, 620.5);
});

test('footer outside the map viewport is not deducted again', () => {
  const padding = favoritesViewportPaddingForOcclusions(
    rect(0, 390, 801, 0), 390, 801,
    rect(0, 390, 440, 0), rect(801, 390, 857, 0),
  );
  assert.deepEqual(padding, { top: 456, right: 0, bottom: 0, left: 0 });
});

test('explicit caller padding is unchanged when neither overlay intersects the viewport', () => {
  const base = { top: 32, right: 24, bottom: 20, left: 16 };
  assert.deepEqual(favoritesViewportPaddingForOcclusions(rect(0, 390, 857, 0), 390, 857, null, null, 16, base), base);
});
