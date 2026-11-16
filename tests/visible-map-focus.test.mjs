import test from 'node:test';
import assert from 'node:assert/strict';
import { largestClearMapRect } from '../modules/map/visibleFocusArea.ts';

test('route sheets and map controls move the focal region into open map space', () => {
  const rect = (left, top, right, bottom) => ({ left, top, right, bottom });
  const top = rect(0, 0, 390, 48);
  const bottom = rect(0, 758, 390, 815);
  const routePanel = rect(0, 48, 310, 440);
  const search = rect(0, 440, 310, 510);
  const rail = rect(334, 315, 390, 748);
  assert.deepEqual(largestClearMapRect(390, 815, [top, bottom, routePanel, search, rail]), rect(0, 510, 334, 758));
  assert.deepEqual(largestClearMapRect(390, 815, [top, bottom, routePanel, rail]), rect(0, 440, 334, 758));
});

test('a bottom parked panel keeps the subject in the available area above it', () => {
  assert.deepEqual(largestClearMapRect(360, 480, [
    { left: 0, top: 200, right: 278, bottom: 440 },
    { left: 0, top: 440, right: 360, bottom: 480 },
  ]), { left: 0, top: 0, right: 360, bottom: 200 });
});
